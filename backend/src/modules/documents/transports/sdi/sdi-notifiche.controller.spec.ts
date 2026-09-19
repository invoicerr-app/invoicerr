/**
 * `SdiNotificheController` in isolation — `@thallesp/nestjs-better-auth`'s `Public` is mocked to a
 * no-op decorator, same discipline `public-documents.controller.spec.ts` already holds (that
 * package's own ESM-only transitive dependency doesn't parse under ts-jest — see that spec's own
 * comment). `SdiNotificheService` is mocked wholesale: this spec proves the HTTP-SHAPE contract only
 * (always 200, the raw body reaches the service unmodified once authenticated) — the service's OWN
 * journal/reconcile logic is `sdi-notifiche.service.spec.ts`'s job.
 */
import { vi } from 'vitest';
import { PassThrough } from 'node:stream';

vi.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

import { SdiNotificheController } from './sdi-notifiche.controller';
import { SdiNotificheService } from './sdi-notifiche.service';

const SHARED_SECRET = 'test-shared-secret-0123456789';

function fakeRequest(
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/xml', 'x-sdi-notifica-secret': SHARED_SECRET },
) {
  const req = new PassThrough() as unknown as import('express').Request & PassThrough;
  (req as unknown as { headers: Record<string, string> }).headers = headers;
  req.end(body, 'utf-8');
  return req as unknown as import('express').Request;
}

describe('SdiNotificheController.receiveNotifica', () => {
  const originalSecret = process.env.SDI_NOTIFICHE_SHARED_SECRET;

  beforeEach(() => {
    process.env.SDI_NOTIFICHE_SHARED_SECRET = SHARED_SECRET;
  });

  afterAll(() => {
    process.env.SDI_NOTIFICHE_SHARED_SECRET = originalSecret;
  });

  it('reads the raw XML body and hands it to the service, verbatim, once authenticated', async () => {
    const handleNotifica = vi.fn().mockResolvedValue({ journaled: true });
    const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

    await controller.receiveNotifica(fakeRequest('<ricevutaConsegna/>'));

    expect(handleNotifica).toHaveBeenCalledWith('<ricevutaConsegna/>');
  });

  it('answers cleanly (never throws) even when the service itself throws — 200 always, per this file’s own header', async () => {
    const handleNotifica = vi.fn().mockRejectedValue(new Error('database unreachable'));
    const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

    await expect(controller.receiveNotifica(fakeRequest('<ricevutaConsegna/>'))).resolves.toBeUndefined();
  });

  // THE MUTATION TARGET: the endpoint used to be `@Public()` with no check whatsoever — a caller
  // that knows a real (non-secret) `IdentificativoSdI` could forge an authority event for someone
  // else's document. These prove the service is never even reached without the shared secret.
  describe('authentication', () => {
    it('never reaches the service when SDI_NOTIFICHE_SHARED_SECRET is not configured at all — deny by default', async () => {
      delete process.env.SDI_NOTIFICHE_SHARED_SECRET;
      const handleNotifica = vi.fn();
      const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

      await controller.receiveNotifica(fakeRequest('<ricevutaConsegna/>'));

      expect(handleNotifica).not.toHaveBeenCalled();
    });

    it('never reaches the service when the header carries the wrong secret', async () => {
      const handleNotifica = vi.fn();
      const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

      await controller.receiveNotifica(
        fakeRequest('<ricevutaConsegna/>', {
          'content-type': 'text/xml',
          'x-sdi-notifica-secret': 'not-the-right-secret',
        }),
      );

      expect(handleNotifica).not.toHaveBeenCalled();
    });

    it('never reaches the service when the header is absent entirely', async () => {
      const handleNotifica = vi.fn();
      const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

      await controller.receiveNotifica(fakeRequest('<ricevutaConsegna/>', { 'content-type': 'text/xml' }));

      expect(handleNotifica).not.toHaveBeenCalled();
    });

    it('still answers 200 (resolves, never throws) on a rejected caller — never confirms the endpoint exists', async () => {
      delete process.env.SDI_NOTIFICHE_SHARED_SECRET;
      const handleNotifica = vi.fn();
      const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

      await expect(controller.receiveNotifica(fakeRequest('<ricevutaConsegna/>'))).resolves.toBeUndefined();
    });
  });

  describe('Content-Type filtering', () => {
    it('never reaches the service (and never attempts to read the body) for an application/json request', async () => {
      const handleNotifica = vi.fn();
      const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

      await controller.receiveNotifica(
        fakeRequest('{"malicious":true}', {
          'content-type': 'application/json',
          'x-sdi-notifica-secret': SHARED_SECRET,
        }),
      );

      expect(handleNotifica).not.toHaveBeenCalled();
    });

    it('accepts application/soap+xml (with a charset suffix), same as text/xml', async () => {
      const handleNotifica = vi.fn().mockResolvedValue({ journaled: true });
      const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

      await controller.receiveNotifica(
        fakeRequest('<ricevutaConsegna/>', {
          'content-type': 'application/soap+xml; charset=UTF-8',
          'x-sdi-notifica-secret': SHARED_SECRET,
        }),
      );

      expect(handleNotifica).toHaveBeenCalledWith('<ricevutaConsegna/>');
    });
  });

  describe('body size cap', () => {
    it('rejects a body over the hard byte cap and never reaches the service', async () => {
      const handleNotifica = vi.fn();
      const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);
      const oversized = 'a'.repeat(6 * 1024 * 1024); // over MAX_NOTIFICA_BODY_BYTES (5 MB)

      await expect(controller.receiveNotifica(fakeRequest(oversized))).resolves.toBeUndefined();
      expect(handleNotifica).not.toHaveBeenCalled();
    });
  });
});
