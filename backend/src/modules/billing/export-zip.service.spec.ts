import { vi, type Mock } from 'vitest';

import JSZip = require('jszip');

import { BillingExportService, ExportZipTimedOutError, ExportZipTooLargeError } from './export-zip.service';
import { listAllDocuments } from '../documents/persistence';

vi.mock('../documents/persistence');

const listAllDocumentsMock = listAllDocuments as Mock;

function fakeDocumentsService(overrides: Partial<{ renderInstancePdf: Mock }> = {}) {
  return {
    renderInstancePdf: overrides.renderInstancePdf ?? vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  } as unknown as import('../documents/documents.service').DocumentsService;
}

describe('BillingExportService.buildCompanyZip', () => {
  afterEach(() => vi.resetAllMocks());

  it('reads every document of every type — no cap of any size, not even a very large one', async () => {
    listAllDocumentsMock.mockResolvedValue([]);
    const service = new BillingExportService(fakeDocumentsService());

    await service.buildCompanyZip('company-1');

    // `listAllDocuments` pages until the set is exhausted; there is no `take` to get wrong. The
    // previous shape passed a 1 000 000 row cap to stand in for "no cap", which is still a cap —
    // one nothing would ever report hitting on a company that crossed it.
    expect(listAllDocumentsMock).toHaveBeenCalledWith('company-1');
  });

  it('writes one JSON + one PDF per renderable document', async () => {
    listAllDocumentsMock.mockResolvedValue([
      { id: 'doc-1', typeId: 'invoice', number: 42, data: { foo: 'bar' } },
    ]);
    const render = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4'));
    const service = new BillingExportService(fakeDocumentsService({ renderInstancePdf: render }));

    const buffer = await service.buildCompanyZip('company-1');
    const zip = await JSZip.loadAsync(buffer);
    const filenames = Object.keys(zip.files).filter((name) => !name.endsWith('/'));

    expect(filenames.sort()).toEqual(['invoice/42.json', 'invoice/42.pdf']);
    expect(render).toHaveBeenCalledWith('company-1', 'invoice', 'doc-1');
  });

  it('still includes the JSON when PDF rendering fails for one document, without throwing', async () => {
    listAllDocumentsMock.mockResolvedValue([{ id: 'doc-1', typeId: 'quote', number: null, data: {} }]);
    const render = vi.fn().mockRejectedValue(new Error('cannot render draft'));
    const service = new BillingExportService(fakeDocumentsService({ renderInstancePdf: render }));

    const buffer = await service.buildCompanyZip('company-1');
    const zip = await JSZip.loadAsync(buffer);
    const filenames = Object.keys(zip.files).filter((name) => !name.endsWith('/'));

    expect(filenames).toEqual(['quote/doc-1.json']);
  });

  it('falls back to the document id in the filename when it has no number yet', async () => {
    listAllDocumentsMock.mockResolvedValue([{ id: 'doc-9', typeId: 'expense', number: undefined, data: {} }]);
    const service = new BillingExportService(fakeDocumentsService());

    const buffer = await service.buildCompanyZip('company-1');
    const zip = await JSZip.loadAsync(buffer);
    const filenames = Object.keys(zip.files).filter((name) => !name.endsWith('/'));

    expect(filenames).toContain('expense/doc-9.json');
  });

  it('aborts with a named ExportZipTooLargeError once the archive crosses the byte cap, instead of finishing an unbounded build', async () => {
    listAllDocumentsMock.mockResolvedValue([
      { id: 'doc-1', typeId: 'invoice', number: 1, data: { text: 'x'.repeat(10_000) } },
    ]);
    const service = new BillingExportService(fakeDocumentsService());

    await expect(service.buildCompanyZip('company-1', { maxBytes: 1 })).rejects.toMatchObject({
      name: 'ExportZipTooLargeError',
      companyId: 'company-1',
      maxBytes: 1,
    });
    await expect(service.buildCompanyZip('company-1', { maxBytes: 1 })).rejects.toBeInstanceOf(
      ExportZipTooLargeError,
    );
  });

  it('aborts with a named ExportZipTimedOutError once the build exceeds the time cap', async () => {
    listAllDocumentsMock.mockResolvedValue([{ id: 'doc-1', typeId: 'invoice', number: 1, data: {} }]);
    const service = new BillingExportService(fakeDocumentsService());
    // A constant clock (elapsed always 0) combined with a negative cap makes the very first chunk
    // trip the timeout deterministically — no reliance on real wall-clock timing in this spec.
    const constantClock = () => 0;

    await expect(
      service.buildCompanyZip('company-1', { maxDurationMs: -1, now: constantClock }),
    ).rejects.toBeInstanceOf(ExportZipTimedOutError);
  });

  it('still builds normally once bytes and duration stay within the (generous, default) bounds', async () => {
    listAllDocumentsMock.mockResolvedValue([{ id: 'doc-1', typeId: 'invoice', number: 1, data: {} }]);
    const service = new BillingExportService(fakeDocumentsService());

    const buffer = await service.buildCompanyZip('company-1');

    expect(buffer.length).toBeGreaterThan(0);
  });
});
