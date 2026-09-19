/**
 * `DocumentsController.downloadAttachment` — the response headers, in isolation from
 * `AttachmentsService` (mocked directly, same construction pattern as
 * `documents.controller.events.spec.ts`).
 *
 * The vulnerability this reproduces: `AttachmentsService.download` echoes back whatever `mime` the
 * QUERY STRING named, unchanged — it never re-derives it from what is actually stored. Combined with
 * a DIFFERENT upload route sharing the same content-addressed storage but no mime allowlist
 * (`received-invoices.service.ts#upload`, out of this file's scope), a caller can have this endpoint
 * hand a browser `Content-Type: text/html` for a file whose bytes it fully controls, served from the
 * app's own origin — a stored-XSS primitive. This file proves the endpoint now never echoes an
 * untrusted mime, and always sets the two defense-in-depth headers regardless.
 */
import { vi } from 'vitest';

import { Response } from 'express';

import { AttachmentsService } from './attachments/attachments.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentEventsBridge } from './queue/document-events-bridge';
import { DocumentSchedulesService } from './schedules/schedules.service';
import { ShareLinksService } from './share-links/share-links.service';

const COMPANY_ID = 'company-1';
const FILE_REF = 'deadbeef'.repeat(8); // sha256-shaped, content doesn't matter to this spec

function buildController(attachmentsService: Partial<AttachmentsService>): DocumentsController {
  return new DocumentsController(
    {} as unknown as DocumentsService,
    {} as unknown as DocumentSchedulesService,
    {} as unknown as ShareLinksService,
    {} as unknown as DocumentEventsBridge,
    attachmentsService as AttachmentsService,
  );
}

/** A minimal Express `Response` double — just enough of the surface this handler touches. */
function fakeResponse() {
  const headers: Record<string, string> = {};
  let body: unknown;
  return {
    res: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      send: (b: unknown) => {
        body = b;
      },
    } as unknown as Response,
    headers,
    body: () => body,
  };
}

describe('DocumentsController.downloadAttachment — Content-Type is never the raw caller-supplied mime', () => {
  it('echoes back an allowed mime (a real PDF upload) unchanged', async () => {
    const download = vi.fn().mockResolvedValue({ bytes: Buffer.from('%PDF-1.4'), mime: 'application/pdf' });
    const controller = buildController({ download });
    const { res, headers } = fakeResponse();

    await controller.downloadAttachment(COMPANY_ID, FILE_REF, 'application/pdf', res);

    expect(download).toHaveBeenCalledWith(COMPANY_ID, FILE_REF, 'application/pdf');
    expect(headers['Content-Type']).toBe('application/pdf');
  });

  it.each([
    'text/html',
    'image/svg+xml',
    'application/javascript',
    'text/plain',
  ])('never echoes a disallowed mime (%s) — serves application/octet-stream instead', async (untrustedMime) => {
    // `AttachmentsService.download` faithfully returns whatever mime it was asked for — this is the
    // exact shape a query-string-controlled `?mime=` produces against a file the caller could not
    // have uploaded as that type through THIS controller's own upload route (which enforces the
    // allowlist), but could through a different one sharing the same storage.
    const download = vi
      .fn()
      .mockResolvedValue({ bytes: Buffer.from('<script>evil</script>'), mime: untrustedMime });
    const controller = buildController({ download });
    const { res, headers } = fakeResponse();

    await controller.downloadAttachment(COMPANY_ID, FILE_REF, untrustedMime, res);

    expect(headers['Content-Type']).toBe('application/octet-stream');
  });

  it('always sets X-Content-Type-Options: nosniff', async () => {
    const download = vi.fn().mockResolvedValue({ bytes: Buffer.from('x'), mime: 'image/png' });
    const controller = buildController({ download });
    const { res, headers } = fakeResponse();

    await controller.downloadAttachment(COMPANY_ID, FILE_REF, 'image/png', res);

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('always sets Content-Disposition: attachment — never rendered inline, even for a trusted mime', async () => {
    const download = vi.fn().mockResolvedValue({ bytes: Buffer.from('x'), mime: 'image/jpeg' });
    const controller = buildController({ download });
    const { res, headers } = fakeResponse();

    await controller.downloadAttachment(COMPANY_ID, FILE_REF, 'image/jpeg', res);

    expect(headers['Content-Disposition']).toBe('attachment');
  });

  it('still serves the actual bytes, even when the mime is downgraded to octet-stream', async () => {
    const bytes = Buffer.from('<script>evil</script>');
    const download = vi.fn().mockResolvedValue({ bytes, mime: 'text/html' });
    const controller = buildController({ download });
    const { res, body } = fakeResponse();

    await controller.downloadAttachment(COMPANY_ID, FILE_REF, 'text/html', res);

    expect(body()).toBe(bytes);
  });

  it('rejects with no mime query param before ever calling the service', async () => {
    const download = vi.fn();
    const controller = buildController({ download });
    const { res } = fakeResponse();

    await expect(controller.downloadAttachment(COMPANY_ID, FILE_REF, undefined, res)).rejects.toThrow(
      /mime.*required/i,
    );
    expect(download).not.toHaveBeenCalled();
  });
});
