import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { VendorImportController } from './vendor-import.controller';

function controller() {
  const service = { preview: vi.fn().mockResolvedValue({ detected: false, kind: 'invoices' }) };
  return { instance: new VendorImportController(service as never), preview: service.preview };
}

describe('VendorImportController', () => {
  it('refuses a vendor export read as anything but an invoice', () => {
    const { instance, preview } = controller();
    expect(() =>
      instance.previewDocuments('company-1', {
        typeId: 'credit-note',
        headers: ['Numéro', 'Date', 'Client', 'Montant TTC', 'Échéance'],
        rows: [],
      }),
    ).toThrow(BadRequestException);
    expect(preview).not.toHaveBeenCalled();
  });

  it('reads an invoice export', async () => {
    const { instance, preview } = controller();
    await instance.previewDocuments('company-1', {
      typeId: 'invoice',
      headers: ['Numéro', 'Date', 'Client', 'Montant TTC', 'Échéance'],
      rows: [],
    });
    expect(preview).toHaveBeenCalledWith('company-1', 'invoices', expect.anything());
  });
});
