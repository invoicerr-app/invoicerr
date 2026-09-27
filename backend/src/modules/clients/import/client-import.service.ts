/**
 * Client CSV import - the SERVER side. The browser owns decoding the file (encoding/BOM/delimiter,
 * `frontend/src/lib/csv-parse.ts`) and the first pass of per-row validation (the same zod schema the
 * create wizard uses, `frontend/src/lib/client-schema.ts`), then sends the parsed rows here as plain
 * JSON. This service is the AUTHORITY, exactly like `createClient` already is for a single client:
 * `preview` and `confirm` both re-run every check from scratch and never trust that the browser's own
 * pass already caught everything - a row the form's zod schema would accept but the server's own
 * `assertClientCreatable`/required-identifiers catalog would refuse (a stale client bundle, a
 * scripted caller bypassing the browser entirely) is rejected here exactly as it would be by
 * `POST /clients`.
 *
 * SCOPE DECISIONS (asked for explicitly by the issue, answered here so they are not re-litigated in
 * review):
 *  - IDENTIFIERS: flattened as one `identifier:<SCHEME>` column per scheme (`identifier:SIRET`,
 *    `identifier:VAT`, …) rather than a fixed list. Country-identifiers schemes are open-ended and
 *    country-specific (`country-identifiers/data/*.json`, one file per country, no shared enum) - a
 *    fixed column set would need editing every time a new country's catalog ships. The prefix
 *    convention costs nothing when a scheme is unused (the column is simply absent) and needs no
 *    schema migration to support tomorrow's country.
 *  - CUSTOM FIELDS: explicitly OUT OF SCOPE for this import. A company's custom fields have
 *    per-definition KINDS (text/number/boolean/select - see `company-custom-fields/persistence.ts`'s
 *    own `CORE_FIELD_KINDS`), and a CSV cell is always a string: mapping "42" to a NUMBER field,
 *    "true"/"vrai"/"1" to a BOOLEAN one, or a free-text cell to a SELECT field's own option ids is a
 *    column-mapping UI of its own, not a byproduct of this feature. An imported client's custom
 *    fields start empty and are editable afterward through the ordinary edit form, exactly like a
 *    client created by hand with none filled in yet.
 *  - DUPLICATES: reuses `ClientsService.findDuplicates`'s own rule verbatim (see below) so an import
 *    skips exactly what the create wizard would already have warned about - never a second,
 *    independently-drifting definition of "the same client".
 *  - VIES: never called from inside the confirm transaction (see `confirm`'s own comment) - a VAT
 *    identifier is stored with its SYNTAX already checked (the same gate `upsertPartyIdentifiers`
 *    applies) but its `validationStatus` left `null` ("never checked", the schema's own documented
 *    meaning - see `PartyIdentifier.validationStatus`'s schema.prisma comment), and validated against
 *    VIES asynchronously right after commit, the same one-call-per-identifier shape
 *    `upsertPartyIdentifiers` already uses for a single client, just run in a loop after the
 *    transaction closes rather than inside it.
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

// Every import above THIS line, deliberately - `VALID_CURRENCIES` below runs `Object.values(Currency)`
// at MODULE LOAD time, and `nest start --watch`'s webpack-based compiler (unlike a plain `tsc` build)
// emits `require()` calls in the SOURCE ORDER they appear, not hoisted to the top the way ESM imports
// are: a `Currency` import declared further down than its first use throws
// "Cannot access '...' before initialization" the moment this file actually loads (a `nest build`
// alone never catches this - it only compiles, it does not execute). Every other file in this codebase
// that computes an `Object.values(Currency)` constant (`descriptors/invoice.descriptor.ts` and
// its siblings) keeps that same import first for the same reason.

/** ISO 4217 codes this build's Prisma schema actually declares, as a plain string set - the runtime
 *  membership check `row.currency` needs (the wire shape carries it as a free `string`, not the
 *  generated `Currency` union, since it comes from a CSV cell). */
const VALID_CURRENCIES = new Set<string>(Object.values(Currency));
const VALID_TYPES = new Set(['COMPANY', 'INDIVIDUAL']);
const VALID_KINDS = new Set(['BUSINESS', 'GOVERNMENT']);
/** The template's own stated format (`client-import-template.ts`) - the ONLY one this import
 *  accepts. Deliberately narrower than `new Date(...)`'s own permissive parsing (which would read
 *  "01/02/2020" as an ambiguous MM/DD-or-DD/MM guess): a CSV import must never silently reinterpret
 *  what a user typed, so anything that is not exactly this shape is a REJECTED row, never a guess. */
const FOUNDED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves a row's own country to the single ISO-3166 alpha-2 code every downstream check (required
 * identifiers, identifier pattern, the created `Client.countryCode`) must key off. Fixes the exact
 * drift the wizard can never produce: before this, `assertClientCreatable`'s identifier-pattern check
 * used `row.countryCode || row.country` (falling back to the free-text NAME when no code column was
 * filled in) while the required-identifiers lookup used `row.countryCode` alone (nothing at all when
 * only `country` was filled in) - two DIFFERENT answers to "what country is this row" in the same
 * evaluation, and passing a country NAME (not a code) to either one made the country-identifiers
 * catalog find no matching row and silently enforce NOTHING for that party, precisely because
 * `resolveRequiredIdentifiers`/`assertIdentifierValueMatchesPattern` both key their lookup on an ISO
 * code column, never a display name. A row `country=France` with no `countryCode` used to sail
 * through with no SIREN/SIRET requirement enforced at all; the wizard, by contrast, can NEVER produce
 * a client with a `country` set and `countryCode` null (`CountrySelect`'s own `onCountryCodeChange`
 * fires from the same picker that sets `country`), so that combination should never be accepted here
 * either.
 *
 * Every caller of this function must use its resolved `iso` for every country-keyed check from here
 * on - never `row.countryCode`/`row.country` directly - so this is the ONE place "which country is
 * this row" gets decided.
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

/** A client's own "duplicate identity" per `ClientsService.findDuplicates`'s rule: same `contactEmail`
 *  (case-insensitive), OR same `name` + same `country` (both case-insensitive). For an INDIVIDUAL
 *  client `name` is stored empty (`ClientsService.createClient` blanks it - see there) - using the
 *  empty string here would make EVERY individual client in the same country collide with every
 *  other one the moment none of them has an email, which is not "the same client", it is "the same
 *  shape of record". So the name half of the match uses `contactFirstname + ' ' + contactLastname`
 *  for an individual, which is exactly what `client-upsert.tsx`'s own summary step already shows as
 *  that client's "name" - the human-visible identity the duplicate rule is meant to approximate. */
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
  /** The ISO code `resolveCountryIso` settled on for this row - `undefined` when the row's own
   *  country could not be resolved (that row is always `rejected`, see `evaluate`). `confirm` uses
   *  this, never `row.countryCode` raw, when creating the `Client` row. */
  resolvedCountryIso?: string;
}

@Injectable()
export class ClientImportService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    @Inject('VAT_VALIDATION_CLIENT') private readonly vatValidationClient: VatValidationPort,
  ) {}

  /** Runs the create-wizard-parity checks (`assertClientCreatable` + required-identifiers) and the
   *  duplicate rule against every row in one pass, shared by `preview` and `confirm` - the ONE place
   *  either endpoint decides a row's fate, so the two can never disagree about the same file. */
  private async evaluate(companyId: string, rows: ClientImportRow[]): Promise<RowVerdict[]> {
    // Rows already matched to an EXISTING active client, keyed by whichever identity they matched on
    // - a single query for the whole file rather than one `findDuplicates` round-trip per row (the
    // brief's own "without N queries" requirement): every row's email and every row's name+country
    // pair are collected up front, then ONE query each finds every existing client any row could
    // possibly match, and the per-row loop below only ever does an in-memory lookup against that.
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
      // The email half of the rule matches the PRIMARY contact's email specifically (#415) - a
      // secondary contact's inbox shared with an unrelated existing client is not "the same client".
      if (emails.size > 0) {
        or.push({
          contacts: { some: { isPrimary: true, email: { in: Array.from(emails), mode: 'insensitive' } } },
        });
      }
      // Prisma has no "IN over a composite pair" - OR-ing one clause per distinct pair keeps this a
      // single round-trip; the file is capped at MAX_IMPORT_ROWS so this is at most that many small
      // equality clauses, not an unbounded query.
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

    // Required-identifiers decisions are cached per (countryCode, partyType) pair - a file importing
    // 500 French companies asks the catalog once, not 500 times.
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

    // Within-file duplicates: the SECOND row with a given identity is the duplicate, matching how a
    // human reading top-to-bottom would call it - the first occurrence is the one that would actually
    // get created.
    const seenInFile = new Map<string, ClientImportRow>();

    const verdicts: RowVerdict[] = [];
    for (const row of rows) {
      const errors: string[] = [];
      const partyType: PartyType = row.type === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY';

      // Country resolution FIRST, and its single answer used everywhere below - see
      // `resolveCountryIso`'s own header for the drift this fixes. A row whose country cannot be
      // resolved, or whose `country`/`countryCode` disagree, is rejected outright: the required-
      // identifiers and pattern checks below would otherwise silently run against the WRONG country
      // (or none at all) rather than refusing.
      const countryResolution = resolveCountryIso(row);
      const resolvedCountryIso = 'iso' in countryResolution ? countryResolution.iso : undefined;
      if ('error' in countryResolution) errors.push(countryResolution.error);

      // Closed-set columns - an EMPTY cell defaults (COMPANY/BUSINESS/false/no date), same as the
      // wizard's own defaults; any OTHER value the wizard's own pickers could never produce is a
      // REJECTED row naming the column and the value, never a silent coercion to the default (a typo
      // "Individuel" must never quietly become a COMPANY, the exact failure mode this replaces).
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
            // Custom fields are out of scope for import (see this file's own header) - always `{}`,
            // so `assertClientCustomFieldValuesValid` only ever refuses a row here for a company that
            // has a REQUIRED custom field, which no import can ever satisfy; that is an honest
            // rejection ("this company needs a value this file cannot carry"), not a bug.
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
            // Same wording `client-upsert.tsx`'s own superRefine uses for the identical case, so a row
            // rejected here reads exactly like the wizard's own validation would have.
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

      // Which of the two rules actually tripped, checked in the SAME priority order
      // `ClientsService.findDuplicates` reports it in (email first) - `matchedOn` below is never a
      // guess, it names the exact rule that matched, so the preview can say WHICH fact makes this row
      // a duplicate rather than just THAT it is one.
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
   * All-or-nothing: every row is re-validated from scratch (never trusts the preview response, which
   * a caller could have replayed unchanged after the underlying data moved), then every VALID,
   * NON-DUPLICATE row is created in ONE `prisma.$transaction` - a failure on any one row leaves ZERO
   * rows behind, not a partial import a human then has to reconcile by hand.
   *
   * VIES is called AFTER the transaction commits, never inside it: a transaction holds row locks for
   * as long as it runs, and VIES is a third-party SOAP service this codebase already treats as
   * "regularly saturated" (see `clients.module.ts`'s own comment on why `ViesVatValidationClient`'s
   * failure mode is UNAVAILABLE, never an exception) - awaiting it once per VAT identifier inside an
   * open transaction would hold those locks for however long the European Commission takes to answer,
   * multiplied by however many VAT identifiers the file carries. A VAT identifier is instead stored
   * with `validationStatus: null` ("never checked" - see `PartyIdentifier.validationStatus`'s own
   * schema.prisma comment) if its syntax passes, or `'INVALID'` if it does not (the same syntax-first
   * gate `upsertPartyIdentifiers` already applies), and validated against VIES right after commit -
   * an import behaves exactly like creating each client by hand one after another would have, just
   * without serializing the whole import behind however many VIES round-trips that implies.
   */
  async confirm(companyId: string, rows: ClientImportRow[]): Promise<ClientImportConfirmResult> {
    this.assertWithinCaps(rows);
    const verdicts = await this.evaluate(companyId, rows);
    const toCreate = verdicts.filter((v) => v.result.status === 'valid');

    const created = await prisma.$transaction(async (tx) => {
      const createdClients: { id: string; countryCode: string | null; country: string }[] = [];
      for (const { row, resolvedCountryIso } of toCreate) {
        const type = row.type || 'COMPANY';
        // `resolvedCountryIso` is never undefined here: `evaluate` rejects any row whose country
        // could not be resolved to an ISO code, and only 'valid' rows reach `toCreate` - so this
        // client, unlike a hypothetical row with a country name but no code, always gets the SAME
        // (country, countryCode) SHAPE the wizard's own `CountrySelect` always produces (a display
        // name plus its own ISO code, never one without the other). `country` keeps the user's own
        // typed text verbatim (this import has no per-locale display-name table to translate it
        // through, unlike the wizard's own `Intl.DisplayNames` picker) - `countryCode` is always the
        // resolved code, never null.
        // The row's four contact columns still mean "the primary contact" (#415 - the template's own
        // columns are unchanged, see this module's own header): created as a nested `ClientContact`
        // row rather than through `writeClientContacts` (that helper is for the two API write paths;
        // an import already builds its own transaction here) - only when at least one of the four is
        // filled in, matching the migration's own "no row for an empty legacy contact" rule so an
        // imported client behaves exactly like one hand-created through the wizard with nothing typed
        // into the contact step.
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
            // No forced default: `Client.currency` is optional (schema.prisma) and the wizard itself
            // never silently defaults a blank currency to EUR (it leaves the field for the user to
            // pick) - an import matches that rather than inventing a currency nobody typed.
            currency: row.currency ? (row.currency.toUpperCase() as Currency) : undefined,
            language: row.language,
            description: row.description,
            foundedAt: row.foundedAt ? new Date(row.foundedAt) : undefined,
            isActive: true,
          },
        });

        for (const entry of row.identifiers ?? []) {
          // Same syntax-first gate `upsertPartyIdentifiers` runs before ever asking VIES - see this
          // method's own header for why VIES itself never runs in here. `client.countryCode` is
          // already `resolvedCountryIso` (see above), never a free-text name needing a second
          // `guessCountryCode` pass.
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

    // Post-commit work - never allowed to roll back a create that already succeeded (see this
    // method's own header). A webhook or a VIES failure here is logged, not thrown: the import itself
    // already succeeded from the caller's point of view.
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
