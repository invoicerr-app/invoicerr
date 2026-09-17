/**
 * A client's email is only ever required where it is actually USED (sending a document
 * by email, the portal invite, dunning reminders — each of those already refuses/skips cleanly on a
 * missing `contactEmail`, see `transports/email-transport.spec.ts`, `client-portal/
 * portal-tokens.service.spec.ts` and `documents/reminders/reminder-sweep-runner.spec.ts`). This file
 * pins the OTHER half of that contract: the client record itself, `Client.contactEmail` already being
 * `String?` in schema.prisma, must accept creation/edit with no email at all — never a "field required"
 * refusal at the one layer (`ClientsService`) that actually enforces required-ness today (there is no
 * ValidationPipe/class-validator on this API — see `EditClientsDto`'s own header).
 *
 * Real Prisma, `ClientsService` constructed directly — the same "ClientsModule not importable under
 * ts-jest" pattern every other spec in this directory already uses (see
 * `clients.vat-validation.spec.ts`'s own header for why).
 */
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../documents/tax/vat-validation';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator: VatValidationPort = { validate: jest.fn() };

describe('ClientsService — contactEmail is optional', () => {
  let companyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Email Optional Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `email-optional-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('creates a COMPANY client with no contactEmail at all — persisted as null, never a thrown error', async () => {
    const client = await service.createClient(companyId, {
      name: 'No Email SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
    } as never);

    expect(client.contactEmail).toBeNull();
  });

  it('creates an INDIVIDUAL client with no contactEmail — the same optional-ness regardless of type', async () => {
    const client = await service.createClient(companyId, {
      contactFirstname: 'Jane',
      contactLastname: 'Doe',
      type: 'INDIVIDUAL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
    } as never);

    expect(client.contactEmail).toBeNull();
  });

  it('edits a client to REMOVE its email — an explicit blank is accepted, not silently ignored', async () => {
    const created = await service.createClient(companyId, {
      name: 'Had An Email SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: 'had-one@example.com',
    } as never);
    expect(created.contactEmail).toBe('had-one@example.com');

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Had An Email SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: '',
    } as never);

    expect(edited.contactEmail).toBe('');
  });
});
