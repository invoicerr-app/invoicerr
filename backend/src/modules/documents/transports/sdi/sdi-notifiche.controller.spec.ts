/**
 * `SdiNotificheController` in isolation — `@thallesp/nestjs-better-auth`'s `Public` is mocked to a
 * no-op decorator, same discipline `public-documents.controller.spec.ts` already holds (that
 * package's own ESM-only transitive dependency doesn't parse under ts-jest — see that spec's own
 * comment). `SdiNotificheService` is mocked wholesale: this spec proves the HTTP-SHAPE contract only
 * (always 200, the raw body reaches the service unmodified) — the service's OWN journal/reconcile
 * logic is `sdi-notifiche.service.spec.ts`'s job.
 */
import { PassThrough } from 'node:stream';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

import { SdiNotificheController } from './sdi-notifiche.controller';
import { SdiNotificheService } from './sdi-notifiche.service';

function fakeRequest(body: string) {
  const req = new PassThrough();
  req.end(body, 'utf-8');
  return req as unknown as import('express').Request;
}

describe('SdiNotificheController.receiveNotifica', () => {
  it('reads the raw XML body and hands it to the service, verbatim', async () => {
    const handleNotifica = jest.fn().mockResolvedValue({ journaled: true });
    const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

    await controller.receiveNotifica(fakeRequest('<ricevutaConsegna/>'));

    expect(handleNotifica).toHaveBeenCalledWith('<ricevutaConsegna/>');
  });

  it('answers cleanly (never throws) even when the service itself throws — 200 always, per this file’s own header', async () => {
    const handleNotifica = jest.fn().mockRejectedValue(new Error('database unreachable'));
    const controller = new SdiNotificheController({ handleNotifica } as unknown as SdiNotificheService);

    await expect(controller.receiveNotifica(fakeRequest('<ricevutaConsegna/>'))).resolves.toBeUndefined();
  });
});
