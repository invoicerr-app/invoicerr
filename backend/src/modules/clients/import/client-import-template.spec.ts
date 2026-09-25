/**
 * The template's own example row must actually import cleanly - caught the hard way once already
 * (see `client-import-template.ts`'s own header): an earlier version named its identifier column
 * `identifier:SIRET`, the human LABEL rather than the country-identifiers catalog's actual scheme key
 * (`LEGAL_ID` for France), so the shipped example carried an identifier nothing ever matched against
 * its own required LEGAL_ID and would have been rejected by the very import it was meant to
 * demonstrate.
 */
import { vi } from 'vitest';

vi.mock('../../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { ClientImportService } from './client-import.service';
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../../documents/tax/vat-validation';
import { seedCountryIdentifierRequirements } from '../../documents/country-identifiers/seed';
import prisma from '@/prisma/prisma.service';
import { buildClientImportTemplateCsv, CLIENT_IMPORT_TEMPLATE_HEADERS } from './client-import-template';
import { ClientImportRow } from './client-import.types';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;
const fakeVatValidator: VatValidationPort = {
  validate: vi.fn().mockResolvedValue({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' }),
};

/** Parses the two CSV lines `buildClientImportTemplateCsv` produces into a `ClientImportRow` - a tiny,
 *  purpose-built reader (never the browser's own `parseCsv`, which lives in the frontend project),
 *  proving only that the HEADER/VALUE pairing this test cares about survives, exactly as the browser
 *  would hand it to `preview`. */
function parseTemplateExampleRow(): ClientImportRow {
  const [headerLine, exampleLine] = buildClientImportTemplateCsv().split('\r\n');
  const headers = headerLine.split(',');
  const values = exampleLine.split(',');
  const byHeader = new Map(headers.map((h, i) => [h, values[i]]));

  const identifiers = headers
    .filter((h) => h.startsWith('identifier:'))
    .map((h) => ({ scheme: h.slice('identifier:'.length), value: byHeader.get(h) ?? '' }))
    .filter((entry) => entry.value.trim() !== '');

  return {
    rowNumber: 2,
    type: byHeader.get('type') as ClientImportRow['type'],
    kind: byHeader.get('kind') as ClientImportRow['kind'],
    isSupplier: byHeader.get('isSupplier') === 'true',
    name: byHeader.get('name'),
    contactEmail: byHeader.get('contactEmail'),
    contactPhone: byHeader.get('contactPhone')?.replace(/^'/, ''), // undo the formula guard, same as the browser's own stripFormulaGuard
    address: byHeader.get('address'),
    postalCode: byHeader.get('postalCode'),
    city: byHeader.get('city'),
    country: byHeader.get('country'),
    countryCode: byHeader.get('countryCode'),
    currency: byHeader.get('currency'),
    foundedAt: byHeader.get('foundedAt'),
    identifiers,
  };
}

describe('client-import-template.ts - the shipped example must actually import', () => {
  beforeAll(async () => {
    await seedCountryIdentifierRequirements(prisma);
  });

  it('declares an identifier:LEGAL_ID column, not the human label identifier:SIRET', () => {
    expect(CLIENT_IMPORT_TEMPLATE_HEADERS).toContain('identifier:LEGAL_ID');
    expect(CLIENT_IMPORT_TEMPLATE_HEADERS).not.toContain('identifier:SIRET');
  });

  it('previews the template example row as valid, once its own formula guard is undone', async () => {
    const service = new ClientImportService(fakeWebhookDispatcher, fakeVatValidator);
    const company = await prisma.company.create({
      data: {
        name: 'Template Round-Trip Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '75001',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+330000000000',
        email: `template-roundtrip-${Date.now()}@example.com`,
      },
    });
    try {
      const row = parseTemplateExampleRow();
      const result = await service.preview(company.id, [row]);
      expect(result.rows[0].status).toBe('valid');
    } finally {
      await prisma.company.delete({ where: { id: company.id } });
    }
  });
});
