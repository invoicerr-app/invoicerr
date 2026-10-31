/**
 * Server side of the client CSV import. The browser parses the file, but `preview` and `confirm`
 * re-run every check from scratch and are the authority, exactly like `POST /clients`.
 * Identifiers use open-ended `identifier:<SCHEME>` columns; custom fields are out of scope; duplicate
 * detection reuses `ClientsService.findDuplicates`; VIES runs after the confirm transaction, never
 * inside it.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { Currency, Prisma, WebhookEvent } from '../../../../prisma/generated/prisma/client';
import { resolveRequiredIdentifiers } from '../../documents/country-identifiers/country-identifiers';
import { PartyType } from '../../documents/country-identifiers/schema';
import { validateVat } from '../../documents/tax/vat-syntax';
import { VatValidationPort } from '../../documents/tax/vat-validation';
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service';
import { assertClientCreatable } from '../client-validation';
import { withDerivedContactFields } from '../primary-contact';
import {
  ClientImportConfirmResult,
  ClientImportPreviewResult,
  ClientImportRow,
  ClientImportRowResult,
  MAX_IMPORT_ROWS,
} from './client-import.types';

// Keep imports above the module-load-time `Object.values(Currency)`: `nest start --watch` emits
// require() calls in source order, so a later `Currency` import throws before initialization.

/** ISO 4217 codes this Prisma schema declares, as a runtime set for a free-text CSV cell. */
const VALID_CURRENCIES = new Set<string>(Object.values(Currency));
const VALID_TYPES = new Set(['COMPANY', 'INDIVIDUAL']);
const VALID_KINDS = new Set(['BUSINESS', 'GOVERNMENT']);
/** The template's only accepted date shape; anything else is rejected, never guessed. */
const FOUNDED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves a row's country to one ISO alpha-2 code, from either the name or the code column. Every
 * country-keyed check and the created `Client.countryCode` use this answer, never the raw columns.
 */
function resolveCountryIso(row: {
  country?: string;
  countryCode?: string;
}): { iso: string } | { error: string } {
  const rawCode = row.countryCode?.trim();
  const rawName = row.country?.trim();
  if (!rawCode && !rawName) {
    return { error: 'Country is required (column "country" or "countryCode").' };
  }
  const isoFromCode = rawCode ? guessCountryCode(rawCode) : undefined;
  const isoFromName = rawName ? guessCountryCode(rawName) : undefined;
  if (rawCode && !isoFromCode) {
    return { error: `Unknown country code: "${rawCode}" (column "countryCode").` };
  }
  if (rawName && !isoFromName) {
    return { error: `Unknown country: "${rawName}" (column "country").` };
  }
  if (isoFromCode && isoFromName && isoFromCode !== isoFromName) {
    return {
      error:
        `Country "${rawName}" (column "country") and country code "${rawCode}" (column ` +
        `"countryCode") do not match.`,
    };
  }
  return { iso: (isoFromCode ?? isoFromName) as string };
}

/** The name half of the duplicate rule: an individual has no stored company name, so use their full
 *  contact name rather than colliding every unnamed individual in the same country. */
function duplicateIdentityName(row: {
  type?: string;
  name?: string;
  contactFirstname?: string;
  contactLastname?: string;
}): string {
  if (row.type === 'INDIVIDUAL') {
    return `${row.contactFirstname ?? ''} ${row.contactLastname ?? ''}`.trim();
  }
  return (row.name ?? '').trim();
}

interface RowVerdict {
  result: ClientImportRowResult;
  row: ClientImportRow;
  /** The resolved ISO code; undefined when the country could not be resolved (always rejected). */
  resolvedCountryIso?: string;
}

@Injectable()
export class ClientImportService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    @Inject('VAT_VALIDATION_CLIENT') private readonly vatValidationClient: VatValidationPort,
  ) {}

  /** The one place a row's fate is decided, shared by preview and confirm. */
  private async evaluate(companyId: string, rows: ClientImportRow[]): Promise<RowVerdict[]> {
    // Collect identities first, then match the whole file in one query instead of one per row.
    const emails = new Set<string>();
    const nameCountryPairs = new Set<string>();
    for (const row of rows) {
      const email = row.contactEmail?.trim().toLowerCase();
      if (email) emails.add(email);
      const name = duplicateIdentityName(row).toLowerCase();
      const country = row.country?.trim().toLowerCase();
      if (name && country) nameCountryPairs.add(`${name}\u0000${country}`);
    }

    const existingByEmail = new Map<string, { id: string; name: string; contactEmail: string | null }>();
    const existingByNameCountry = new Map<
      string,
      { id: string; name: string; contactEmail: string | null }
    >();
    if (emails.size > 0 || nameCountryPairs.size > 0) {
      const or: Prisma.ClientWhereInput[] = [];
      // Only the primary contact's email counts: that is the address delivery actually uses.
      if (emails.size > 0) {
        or.push({
          contacts: { some: { isPrimary: true, email: { in: Array.from(emails), mode: 'insensitive' } } },
        });
      }
      // Prisma has no IN over a composite pair; the row cap bounds how many clauses this adds.
      for (const pair of nameCountryPairs) {
        const [name, country] = pair.split('\u0000');
        or.push({
          name: { equals: name, mode: 'insensitive' },
          country: { equals: country, mode: 'insensitive' },
        });
      }
      const existing = await prisma.client.findMany({
        where: { companyId, isActive: true, OR: or },
        select: {
          id: true,
          name: true,
          country: true,
          contacts: { where: { isPrimary: true }, select: { email: true }, take: 1 },
        },
      });
      for (const row of existing) {
        const client = { id: row.id, name: row.name, contactEmail: row.contacts[0]?.email ?? null };
        if (client.contactEmail) existingByEmail.set(client.contactEmail.toLowerCase(), client);
        existingByNameCountry.set(`${row.name.toLowerCase()}\u0000${row.country.toLowerCase()}`, client);
      }
    }

    // Required-identifier decisions are cached per (country, party type) pair.
    const requiredIdentifiersCache = new Map<
      string,
      Awaited<ReturnType<typeof resolveRequiredIdentifiers>>['requirements']
    >();
    async function requiredIdentifiersFor(countryCode: string | undefined, partyType: PartyType) {
      const key = `${countryCode ?? ''}\u0000${partyType}`;
      if (!requiredIdentifiersCache.has(key)) {
        const decision = await resolveRequiredIdentifiers(countryCode, partyType);
        requiredIdentifiersCache.set(key, decision.requirements);
      }
      return requiredIdentifiersCache.get(key)!;
    }

    // The first row with an identity is created; later rows with the same identity are duplicate.
    const seenInFile = new Map<string, ClientImportRow>();

    const verdicts: RowVerdict[] = [];
    for (const row of rows) {
      const errors: string[] = [];
      const partyType: PartyType = row.type === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY';

      // Resolve the country first and reject a missing/mismatched pair, rather than checking against
      // the wrong country below.
      const countryResolution = resolveCountryIso(row);
      const resolvedCountryIso = 'iso' in countryResolution ? countryResolution.iso : undefined;
      if ('error' in countryResolution) errors.push(countryResolution.error);

      // Closed-set columns: empty defaults, any other value is rejected, never coerced.
      if (row.type !== undefined && !VALID_TYPES.has(row.type)) {
        errors.push(`Unknown type: "${row.type}" (column "type", expected COMPANY or INDIVIDUAL).`);
      }
      if (row.kind !== undefined && !VALID_KINDS.has(row.kind)) {
        errors.push(`Unknown kind: "${row.kind}" (column "kind", expected BUSINESS or GOVERNMENT).`);
      }
      if (row.currency && !VALID_CURRENCIES.has(row.currency.toUpperCase())) {
        errors.push(`Unknown currency: "${row.currency}" (column "currency", expected an ISO 4217 code).`);
      }
      if (row.foundedAt && !FOUNDED_AT_PATTERN.test(row.foundedAt)) {
        errors.push(`Invalid date: "${row.foundedAt}" (column "foundedAt", expected YYYY-MM-DD).`);
      } else if (row.foundedAt && Number.isNaN(new Date(row.foundedAt).getTime())) {
        errors.push(`Invalid date: "${row.foundedAt}" (column "foundedAt") is not a real calendar day.`);
      }

      try {
        await assertClientCreatable(
          companyId,
          {
            type: row.type,
            name: row.name,
            contactFirstname: row.contactFirstname,
            contactLastname: row.contactLastname,
            // Import cannot carry custom fields, so a required one honestly rejects the row.
            customFields: {},
          },
          row.identifiers,
          resolvedCountryIso,
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }

      if (resolvedCountryIso) {
        const requirements = await requiredIdentifiersFor(resolvedCountryIso, partyType);
        for (const req of requirements) {
          if (!req.required) continue;
          const value = row.identifiers?.find((i) => i.scheme === req.scheme)?.value;
          if (!value || value.trim() === '') {
            // Same wording as the wizard's own validation.
            errors.push(`${req.label} is required`);
          }
        }
      }

      if (errors.length > 0) {
        verdicts.push({
          row,
          resolvedCountryIso,
          result: { rowNumber: row.rowNumber, status: 'rejected', errors },
        });
        continue;
      }

      const email = row.contactEmail?.trim().toLowerCase();
      const identityName = duplicateIdentityName(row).toLowerCase();
      const country = row.country?.trim().toLowerCase();
      const nameCountryKey = identityName && country ? `${identityName}\u0000${country}` : undefined;

      // Email first, matching `ClientsService.findDuplicates`'s priority.
      const existingByEmailMatch = email ? existingByEmail.get(email) : undefined;
      const existingByNameCountryMatch = nameCountryKey
        ? existingByNameCountry.get(nameCountryKey)
        : undefined;
      const existingMatch = existingByEmailMatch ?? existingByNameCountryMatch;
      if (existingMatch) {
        verdicts.push({
          row,
          resolvedCountryIso,
          result: {
            rowNumber: row.rowNumber,
            status: 'duplicate',
            duplicateOf: {
              kind: 'existing',
              matchedOn: existingByEmailMatch ? 'email' : 'name_country',
              id: existingMatch.id,
              name: existingMatch.name,
              contactEmail: existingMatch.contactEmail,
            },
          },
        });
        continue;
      }

      const fileKey = email ? `email:${email}` : nameCountryKey ? `namecountry:${nameCountryKey}` : undefined;
      const earlierRow = fileKey ? seenInFile.get(fileKey) : undefined;
      if (earlierRow) {
        verdicts.push({
          row,
          resolvedCountryIso,
          result: {
            rowNumber: row.rowNumber,
            status: 'duplicate',
            duplicateOf: {
              kind: 'file',
              matchedOn: fileKey?.startsWith('email:') ? 'email' : 'name_country',
              rowNumber: earlierRow.rowNumber,
              name: duplicateIdentityName(earlierRow) || (earlierRow.name ?? ''),
              contactEmail: earlierRow.contactEmail ?? null,
            },
          },
        });
        continue;
      }
      if (fileKey) seenInFile.set(fileKey, row);

      verdicts.push({ row, resolvedCountryIso, result: { rowNumber: row.rowNumber, status: 'valid' } });
    }

    return verdicts;
  }

  private assertWithinCaps(rows: ClientImportRow[]): void {
    if (rows.length === 0) {
      throw new BadRequestException('The file has no data rows to import.');
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `This file has ${rows.length} rows, over the ${MAX_IMPORT_ROWS}-row limit a single import can process.`,
      );
    }
  }

  async preview(companyId: string, rows: ClientImportRow[]): Promise<ClientImportPreviewResult> {
    this.assertWithinCaps(rows);
    const verdicts = await this.evaluate(companyId, rows);
    const results = verdicts.map((v) => v.result);
    return {
      rows: results,
      summary: {
        total: results.length,
        willCreate: results.filter((r) => r.status === 'valid').length,
        duplicates: results.filter((r) => r.status === 'duplicate').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
      },
    };
  }

  /**
   * All-or-nothing: re-validate every row, then create the valid, non-duplicate ones in one
   * transaction, so a failure leaves no partial import. VIES runs after commit, never inside the
   * transaction, so a slow public service cannot hold row locks.
   */
  async confirm(companyId: string, rows: ClientImportRow[]): Promise<ClientImportConfirmResult> {
    this.assertWithinCaps(rows);
    const verdicts = await this.evaluate(companyId, rows);
    const toCreate = verdicts.filter((v) => v.result.status === 'valid');

    const created = await prisma.$transaction(async (tx) => {
      const createdClients: { id: string; countryCode: string | null; country: string }[] = [];
      for (const { row, resolvedCountryIso } of toCreate) {
        const type = row.type || 'COMPANY';
        // `resolvedCountryIso` is set for every valid row. The four contact columns still mean "the
        // primary contact"; create it only when one of them is filled in.
        const hasContact =
          !!(type === 'INDIVIDUAL' ? row.contactFirstname : undefined) ||
          !!(type === 'INDIVIDUAL' ? row.contactLastname : undefined) ||
          !!row.contactEmail ||
          !!row.contactPhone;
        const client = await tx.client.create({
          data: {
            companyId,
            type,
            kind: row.kind ?? 'BUSINESS',
            isSupplier: row.isSupplier ?? false,
            name: type === 'INDIVIDUAL' ? '' : (row.name ?? ''),
            contacts: hasContact
              ? {
                  create: {
                    firstName: type === 'INDIVIDUAL' ? row.contactFirstname || null : null,
                    lastName: type === 'INDIVIDUAL' ? row.contactLastname || null : null,
                    email: row.contactEmail || null,
                    phone: row.contactPhone || null,
                    isPrimary: true,
                    position: 0,
                  },
                }
              : undefined,
            address: row.address ?? '',
            addressLine2: row.addressLine2,
            postalCode: row.postalCode ?? '',
            city: row.city ?? '',
            state: row.state,
            country: row.country ?? '',
            countryCode: resolvedCountryIso,
            // No forced default: a blank cell stays blank, as in the wizard.
            currency: row.currency ? (row.currency.toUpperCase() as Currency) : undefined,
            language: row.language,
            description: row.description,
            foundedAt: row.foundedAt ? new Date(row.foundedAt) : undefined,
            isActive: true,
          },
        });

        for (const entry of row.identifiers ?? []) {
          // Syntax only here; VIES runs after commit. `countryCode` is already the resolved ISO.
          let validationStatus: string | null = null;
          const iso = client.countryCode ?? undefined;
          if (entry.scheme === 'VAT' && iso) {
            const syntax = validateVat(entry.value, iso);
            if (!syntax.valid) validationStatus = 'INVALID';
          }
          await tx.partyIdentifier.create({
            data: {
              clientId: client.id,
              scheme: entry.scheme,
              value: entry.value,
              validationStatus,
              validatedAt: validationStatus === 'INVALID' ? new Date() : undefined,
              validationSource: validationStatus === 'INVALID' ? 'syntax-check' : undefined,
            },
          });
        }

        createdClients.push({ id: client.id, countryCode: client.countryCode, country: client.country });
      }
      return createdClients;
    });

    logger.info('Clients imported from CSV', {
      category: 'client',
      details: {
        companyId,
        created: created.length,
        rejected: verdicts.filter((v) => v.result.status === 'rejected').length,
      },
    });

    // Post-commit work: a webhook or VIES failure is logged, never allowed to fail the import.
    for (const client of created) {
      try {
        const full = await prisma.client.findUnique({
          where: { id: client.id },
          include: { partyIdentifiers: true, contacts: true },
        });
        if (full) {
          await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_CREATED, {
            companyId,
            client: withDerivedContactFields(full),
          });
        }
      } catch (error) {
        logger.error('Failed to dispatch CLIENT_CREATED webhook for imported client', {
          category: 'client',
          details: { error, clientId: client.id },
        });
      }

      const vatIdentifier = await prisma.partyIdentifier.findFirst({
        where: { clientId: client.id, scheme: 'VAT', validationStatus: null },
      });
      if (vatIdentifier && client.countryCode) {
        const iso = guessCountryCode(client.countryCode) ?? client.countryCode.toUpperCase();
        try {
          const result = await this.vatValidationClient.validate(iso, vatIdentifier.value);
          await prisma.partyIdentifier.update({
            where: { id: vatIdentifier.id },
            data: {
              validationStatus: result.status,
              validatedAt: result.checkedAt,
              validationSource: result.source,
            },
          });
        } catch (error) {
          logger.error('Post-import VAT validation failed', {
            category: 'client',
            details: { error, clientId: client.id },
          });
        }
      }
    }

    return {
      created: created.length,
      duplicates: verdicts.filter((v) => v.result.status === 'duplicate').length,
      rejected: verdicts.filter((v) => v.result.status === 'rejected').length,
    };
  }
}
