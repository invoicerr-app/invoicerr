import { vi, type Mock } from 'vitest';
import { ActionRegistry } from './action-registry';
import { registerRequestSignatureAction } from './request-signature';

/**
 * Direct coverage of the handler itself — the same style `request-deposit.spec.ts` already uses
 * (resolve the handler, call it with a hand-built `ActionContext`) rather than going through the full
 * `DocumentsService`: the four gates (country policy, status, implementation, validation) are already
 * covered generically by `documents.service.spec.ts`; this file is about what THIS handler itself
 * does once they have all passed — delegate to `SignaturesService.requestSignature` and translate its
 * result into the standard envelope. `SignaturesService` itself is a plain hand-built fake here
 * (never the real class) — its own behavior is `signatures.service.spec.ts`'s job.
 */
function buildRegistry(signaturesService: { requestSignature: Mock }) {
  const registry = new ActionRegistry();
  registerRequestSignatureAction(registry, signaturesService as any);
  return registry;
}

describe('request-signature (action handler)', () => {
  it('delegates to SignaturesService.requestSignature with the runAction-provided companyId/typeId/documentId', async () => {
    const signaturesService = {
      requestSignature: vi.fn().mockResolvedValue({ message: 'Signature request sent to a@b.com.' }),
    };
    const handler = buildRegistry(signaturesService).resolve('quote', 'request-signature')!;

    const result = await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: {},
    });

    expect(signaturesService.requestSignature).toHaveBeenCalledWith('company-1', 'quote', 'quote-1');
    // NO `document` in the result — this action never touches the QUOTE's own record (see this
    // handler's own header: the eventual "sent" -> "signed" transition happens entirely through the
    // separate public flow, never through this action) — and therefore `changed: false`.
    expect(result).toEqual({ changed: false, message: 'Signature request sent to a@b.com.' });
  });

  it('refuses (defensively) a document that has not been saved yet — unreachable via runAction, still guarded', async () => {
    const signaturesService = { requestSignature: vi.fn() };
    const handler = buildRegistry(signaturesService).resolve('quote', 'request-signature')!;

    await expect(
      handler({ companyId: 'company-1', typeId: 'quote', documentId: undefined, data: {}, params: {} }),
    ).rejects.toThrow('Cannot request a signature for a document that has not been saved yet.');
    expect(signaturesService.requestSignature).not.toHaveBeenCalled();
  });

  it('propagates a failure from SignaturesService.requestSignature verbatim (e.g. no client email on file)', async () => {
    const signaturesService = {
      requestSignature: vi.fn().mockRejectedValue(new Error('no contact email on file')),
    };
    const handler = buildRegistry(signaturesService).resolve('quote', 'request-signature')!;

    await expect(
      handler({ companyId: 'company-1', typeId: 'quote', documentId: 'quote-1', data: {}, params: {} }),
    ).rejects.toThrow('no contact email on file');
  });
});
