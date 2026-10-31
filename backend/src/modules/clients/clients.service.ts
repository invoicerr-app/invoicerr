import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

/** A VALID verdict is re-asked after this long; UNAVAILABLE is retried on every edit. */
const REVALIDATE_AFTER_DAYS = 90;

function needsRevalidation(row?: { validationStatus: string | null; validatedAt: Date | null }): boolean {
  if (!row) return true;
  if (row.validationStatus !== 'VALID') return true;
  if (!row.validatedAt) return true;
  const ageDays = (Date.now() - row.validatedAt.getTime()) / 86_400_000;
  return ageDays > REVALIDATE_AFTER_DAYS;
}

/** Keeps the duplicate match a fixed-cost equality check; longer values are treated as absent. */
const MAX_MATCH_VALUE_LENGTH = 300;

function boundedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_MATCH_VALUE_LENGTH) return undefined;
  return trimmed;
}

import {
  ClientDuplicateMatch,
  DuplicateMatchReason,
  EditClientsDto,
  FindDuplicatesQuery,
  IdentifierEntry,
} from '@/modules/clients/dto/clients.dto';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { Prisma, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { VatValidationPort } from '../documents/tax/vat-validation';
import { validateVat } from '../documents/tax/vat-syntax';
import { assertIdentifierValueMatchesPattern } from '../documents/country-identifiers/validate-identifier-value';
import { assertClientCustomFieldValuesValid } from '../documents/company-custom-fields/persistence';
import { ClientStatement, resolveClientStatement } from '../documents/settlement/client-statement';
import { assertClientCreatable, assertIndividualIdentity } from './client-validation';
import { writeClientContacts } from './contacts/client-contacts';
import { withDerivedContactFields } from './primary-contact';

/** Primary first, then position: the order every client read expects. */
const CONTACTS_INCLUDE = {
  orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
} satisfies Prisma.Client$contactsArgs;

@Injectable()
export class ClientsService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    @Inject('VAT_VALIDATION_CLIENT') private readonly vatValidationClient: VatValidationPort,
  ) {}

  /** Single client by id, scoped to the company; also backs generic reference resolution. */
  async getClientById(companyId: string, id: string) {
    const client = await prisma.client.findFirst({
      where: { id, companyId },
      include: { partyIdentifiers: true, contacts: CONTACTS_INCLUDE },
    });
    return client ? withDerivedContactFields(client) : null;
  }

  /** The client's statement. The ownership check comes first: `resolveClientStatement` itself never
   *  reads `Client`, so a guessed id must not reach another tenant's invoices. */
  async getStatement(companyId: string, id: string): Promise<ClientStatement> {
    const client = await prisma.client.findFirst({ where: { id, companyId } });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return resolveClientStatement(companyId, id);
  }

  async getClients(companyId: string, page: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    const clients = await prisma.client.findMany({
      where: { companyId },
      skip,
      take: pageSize,
      orderBy: {
        name: 'asc',
      },
      include: { partyIdentifiers: true, contacts: CONTACTS_INCLUDE },
    });

    const totalClients = await prisma.client.count({ where: { companyId } });

    return {
      pageCount: Math.ceil(totalClients / pageSize),
      clients: clients.map(withDerivedContactFields),
    };
  }

  /** `excludeSuppliers` is for the invoice/quote client picker; every other caller sees all roles. */
  async searchClients(companyId: string, query: string, options?: { excludeSuppliers?: boolean }) {
    const supplierFilter = options?.excludeSuppliers ? { isSupplier: false } : {};

    if (!query) {
      const clients = await prisma.client.findMany({
        where: { companyId, isActive: true, ...supplierFilter },
        take: 10,
        orderBy: {
          name: 'asc',
        },
        include: { partyIdentifiers: true, contacts: CONTACTS_INCLUDE },
      });
      return clients.map(withDerivedContactFields);
    }

    const results = await prisma.client.findMany({
      where: {
        companyId,
        isActive: true,
        ...supplierFilter,
        OR: [
          { name: { contains: query } },
          // Contacts live on their own relation; `some` matches any of them, not only the primary.
          { contacts: { some: { firstName: { contains: query } } } },
          { contacts: { some: { lastName: { contains: query } } } },
          { contacts: { some: { email: { contains: query } } } },
          { contacts: { some: { phone: { contains: query } } } },
          { address: { contains: query } },
          { postalCode: { contains: query } },
          { city: { contains: query } },
          { country: { contains: query } },
        ],
      },
      take: 10,
      orderBy: {
        name: 'asc',
      },
      include: { partyIdentifiers: true, contacts: CONTACTS_INCLUDE },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_SEARCHED, {
        companyId,
        query,
        results: results.length,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_SEARCHED webhook', { category: 'client', details: { error } });
    }

    return results.map(withDerivedContactFields);
  }

  /** Duplicate detection only informs, never blocks: matching primary email, or name + country. */
  async findDuplicates(companyId: string, query: FindDuplicatesQuery): Promise<ClientDuplicateMatch[]> {
    const email = boundedOrUndefined(query.email);
    const name = boundedOrUndefined(query.name);
    const country = boundedOrUndefined(query.country);
    const excludeId = boundedOrUndefined(query.excludeId);
    const hasNameCountry = !!name && !!country;
    if (!email && !hasNameCountry) return [];

    // Only the primary contact's email counts: that is the address delivery actually uses.
    const or: Prisma.ClientWhereInput[] = [];
    if (email)
      or.push({ contacts: { some: { isPrimary: true, email: { equals: email, mode: 'insensitive' } } } });
    if (hasNameCountry) {
      or.push({
        name: { equals: name, mode: 'insensitive' },
        country: { equals: country, mode: 'insensitive' },
      });
    }

    const rows = await prisma.client.findMany({
      where: {
        companyId,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: or,
      },
      select: {
        id: true,
        name: true,
        country: true,
        contacts: { where: { isPrimary: true }, select: { email: true }, take: 1 },
      },
      take: 10,
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => {
      const primaryEmail = row.contacts[0]?.email ?? null;
      const matchedOn: DuplicateMatchReason[] = [];
      if (email && primaryEmail && primaryEmail.toLowerCase() === email.toLowerCase()) {
        matchedOn.push('email');
      }
      if (
        hasNameCountry &&
        row.name.toLowerCase() === name!.toLowerCase() &&
        row.country.toLowerCase() === country!.toLowerCase()
      ) {
        matchedOn.push('name_country');
      }
      return { id: row.id, name: row.name, contactEmail: primaryEmail, country: row.country, matchedOn };
    });
  }

  private async upsertPartyIdentifiers(
    clientId: string,
    identifiers: IdentifierEntry[] | undefined,
    // VIES is addressed per member state, so the client's country is needed to ask at all.
    countryCode: string | null | undefined,
  ) {
    if (!identifiers) return;

    const existing = await prisma.partyIdentifier.findMany({
      where: { clientId },
    });

    // Validate every entry before writing any: a later failure must not leave earlier rows changed.
    for (const entry of identifiers) {
      const before = existing.find((r) => r.scheme === entry.scheme);
      await assertIdentifierValueMatchesPattern({
        countryCode,
        scheme: entry.scheme,
        value: entry.value,
        previousValue: before?.value,
      });
    }

    const incomingSchemes = new Set(identifiers.map((i) => i.scheme));

    for (const row of existing) {
      if (!incomingSchemes.has(row.scheme)) {
        await prisma.partyIdentifier.delete({ where: { id: row.id } });
      }
    }

    for (const entry of identifiers) {
      const before = existing.find((r) => r.scheme === entry.scheme);
      const row = await prisma.partyIdentifier.upsert({
        where: { clientId_scheme: { clientId, scheme: entry.scheme } },
        create: { clientId, scheme: entry.scheme, value: entry.value },
        update: { value: entry.value },
      });

      // Validated on entry, never at issuance: a saturated VIES must not block an invoice. A changed
      // value invalidates the previous verdict.
      const valueChanged = before?.value !== entry.value;
      if (entry.scheme === 'VAT' && countryCode && (valueChanged || needsRevalidation(before))) {
        // Syntax before network: an invalid number is B2C and never worth a VIES round-trip.
        const iso = guessCountryCode(countryCode) ?? countryCode.toUpperCase();
        const syntax = validateVat(entry.value, iso);

        if (!syntax.valid) {
          await prisma.partyIdentifier.update({
            where: { id: row.id },
            data: { validationStatus: 'INVALID', validatedAt: new Date(), validationSource: 'syntax-check' },
          });
          logger.warn('VAT number failed its own syntax check — treated as unverified (B2C)', {
            category: 'client',
            details: { clientId, value: entry.value, countryCode: iso, reason: syntax.reason },
          });
          continue;
        }

        const result = await this.vatValidationClient.validate(iso, entry.value);
        await prisma.partyIdentifier.update({
          where: { id: row.id },
          data: {
            validationStatus: result.status,
            validatedAt: result.checkedAt,
            validationSource: result.source,
          },
        });
        if (result.status !== 'VALID') {
          logger.warn('VAT number not verified', {
            category: 'client',
            details: { clientId, value: entry.value, countryCode: iso, status: result.status },
          });
        }
      }
    }
  }

  async createClient(companyId: string, editClientsDto: EditClientsDto) {
    // `contacts` is a relation, written only by `writeClientContacts` inside this transaction.
    const { id, identifiers, contacts, ...data } = editClientsDto;

    const type = (data as any).type || 'COMPANY';

    if (type === 'INDIVIDUAL') {
      data.name = ``;
    } else if (contacts === undefined) {
      // Legacy-shape COMPANY callers always had their flat first/last name discarded; keep that.
      data.contactFirstname = undefined;
      data.contactLastname = undefined;
    }

    // Shared with the CSV import. Checked before the row exists so a rejection leaves no orphan.
    try {
      await assertClientCreatable(
        companyId,
        { ...data, contacts },
        identifiers,
        data.countryCode ?? data.country,
      );
    } catch (error) {
      logger.error('Client rejected by pre-create checks', { category: 'client', details: { error } });
      throw error;
    }

    // `assertClientCreatable` still needs the legacy fields above; Prisma must not see them.
    const clientData = { ...data };
    for (const key of ['address', 'postalCode', 'city'] as const) {
      if (clientData[key]?.trim() === '') clientData[key] = null;
    }
    delete clientData.contactFirstname;
    delete clientData.contactLastname;
    delete clientData.contactEmail;
    delete clientData.contactPhone;

    const created = await prisma.$transaction(async (tx) => {
      const newClient = await tx.client.create({ data: { ...clientData, companyId } });
      // `data`, not `editClientsDto`: the blanking above must reach the contacts write too.
      await writeClientContacts(tx, newClient.id, data as unknown as Record<string, unknown>, contacts);
      return newClient;
    });

    await this.upsertPartyIdentifiers(created.id, identifiers, created.countryCode ?? created.country);

    const newClient = await this.getClientById(companyId, created.id);

    logger.info('Client created', { category: 'client', details: { clientId: created.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_CREATED, {
        companyId,
        client: newClient,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_CREATED webhook', { category: 'client', details: { error } });
    }

    return newClient;
  }

  async editClientsInfo(companyId: string, editClientsDto: EditClientsDto) {
    if (!editClientsDto.id) {
      logger.error('Client ID is required for editing', { category: 'client' });
      throw new BadRequestException('Client ID is required for editing');
    }

    const existingClient = await prisma.client.findFirst({
      where: { id: editClientsDto.id, companyId },
    });
    if (!existingClient) {
      logger.error('Client not found', { category: 'client', details: { id: editClientsDto.id } });
      throw new NotFoundException('Client not found');
    }

    const { identifiers, contacts, ...dataFields } = editClientsDto;
    const data = { ...dataFields } as any;
    // Prefer explicit type in payload, otherwise fall back to existing client's type
    const type = data.type || existingClient.type || 'COMPANY';

    if (type === 'INDIVIDUAL') {
      // Same identity gate as create; `data` carries the raw keys its presence check needs.
      try {
        assertIndividualIdentity({ ...data, contacts }, data);
      } catch (error) {
        logger.error('Client rejected by edit-time identity checks', {
          category: 'client',
          details: { error },
        });
        throw error;
      }
    } else {
      if (!data.name || (data.name as string).trim() === '') {
        logger.error('Company name is required for company clients', { category: 'client' });
        throw new BadRequestException('Company name is required for company clients');
      }
    }

    // `undefined` means "not edited", so a required custom field is not re-checked.
    await assertClientCustomFieldValuesValid(companyId, dataFields.customFields);

    // Explicit allow-list, never `...dataFields`: the API has no runtime validation, so a spread
    // would let a caller rewrite `id` or `companyId`. Contacts are written by `writeClientContacts`.
    const updatedClient = await prisma.$transaction(async (tx) => {
      const updated = await tx.client.update({
        where: { id: editClientsDto.id },
        data: {
          description: dataFields.description,
          foundedAt: dataFields.foundedAt,
          name: dataFields.name,
          address: dataFields.address,
          addressLine2: dataFields.addressLine2,
          postalCode: dataFields.postalCode,
          city: dataFields.city,
          state: dataFields.state,
          country: dataFields.country,
          countryCode: dataFields.countryCode,
          language: dataFields.language,
          currency: dataFields.currency,
          type: dataFields.type,
          kind: dataFields.kind,
          isSupplier: dataFields.isSupplier,
          isActive: true,
          // A submitted value replaces the stored snapshot; `undefined` leaves it untouched.
          customFields: dataFields.customFields,
        },
      });
      await writeClientContacts(
        tx,
        updated.id,
        editClientsDto as unknown as Record<string, unknown>,
        contacts,
      );
      return updated;
    });

    await this.upsertPartyIdentifiers(
      updatedClient.id,
      identifiers,
      updatedClient.countryCode ?? updatedClient.country,
    );

    const fullClient = await this.getClientById(companyId, updatedClient.id);

    logger.info('Client updated', { category: 'client', details: { clientId: updatedClient.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_UPDATED, {
        companyId,
        client: fullClient,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_UPDATED webhook', { category: 'client', details: { error } });
    }

    return fullClient;
  }

  async deleteClient(companyId: string, id: string) {
    const existingClient = await this.getClientById(companyId, id);

    if (!existingClient) {
      logger.error('Client not found', { category: 'client', details: { id } });
      throw new NotFoundException('Client not found');
    }

    const deletedClient = await prisma.client.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Client deleted', { category: 'client', details: { clientId: id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.CLIENT_DELETED, {
        companyId,
        client: existingClient,
      });
    } catch (error) {
      logger.error('Failed to dispatch CLIENT_DELETED webhook', { category: 'client', details: { error } });
    }

    return deletedClient;
  }
}
