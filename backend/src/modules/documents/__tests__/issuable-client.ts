import { vi } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { ClientsService } from '../../clients/clients.service';
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../tax/vat-validation';

/** Columns of a client an invoice can be issued to: address, city and the identifier the country
 *  catalog requires. Spread into `prisma.client.create`'s `data`. */
export const ISSUABLE_CLIENT_FIELDS = {
  address: '1 Client Street',
  postalCode: '75001',
  city: 'Paris',
  country: 'France',
  countryCode: 'FR',
  partyIdentifiers: { create: { scheme: 'LEGAL_ID', value: '732829320' } },
};

/** A client that names only its country, as the quick-create form produces. */
export const NAME_ONLY_CLIENT_FIELDS = { country: 'France', countryCode: 'FR' };

/** A French company row, enough for any spec that needs an owner for its clients. */
export function createTestCompany(name: string) {
  return prisma.company.create({
    data: {
      name,
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '75001',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${Math.random()}@example.com`,
    },
  });
}

/** `ClientsService` over real Prisma with the webhook dispatcher and VAT validator faked. The spec
 *  must `vi.mock('../webhooks/webhook-dispatcher.service')` itself, the mock is hoisted per file. */
export function createClientsServiceForTest() {
  const dispatcher = {
    dispatch: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebhookDispatcherService;
  const vatValidator: VatValidationPort = {
    validate: vi.fn().mockResolvedValue({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' }),
  };
  return new ClientsService(dispatcher, vatValidator);
}
