/**
 * A client created with only a name and a country is stored without an address, and completing it
 * later keeps everything already on file. Real Prisma, no Nest.
 */
import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import prisma from '@/prisma/prisma.service';
import {
  NAME_ONLY_CLIENT_FIELDS,
  createClientsServiceForTest,
  createTestCompany,
} from '../documents/__tests__/issuable-client';

describe('ClientsService - a client created with a name and a country only', () => {
  const service = createClientsServiceForTest();
  let companyId: string;

  beforeAll(async () => {
    companyId = (await createTestCompany('Quick Create Co')).id;
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('is stored with no address, postal code or city, never an empty string', async () => {
    const created = await service.createClient(companyId, {
      name: 'Name Only SARL',
      address: '',
      postalCode: '',
      city: '',
      ...NAME_ONLY_CLIENT_FIELDS,
    } as never);

    const row = await prisma.client.findUniqueOrThrow({ where: { id: created.id } });
    expect([row.address, row.postalCode, row.city]).toEqual([null, null, null]);
  });

  it('can be completed later without losing what was already on file', async () => {
    const created = await service.createClient(companyId, {
      name: 'Completed Later SARL',
      ...NAME_ONLY_CLIENT_FIELDS,
    } as never);

    await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Completed Later SARL',
      address: '2 Rue Complète',
      postalCode: '75002',
      city: 'Paris',
      ...NAME_ONLY_CLIENT_FIELDS,
    } as never);

    const row = await prisma.client.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ name: 'Completed Later SARL', address: '2 Rue Complète', city: 'Paris' });
  });
});
