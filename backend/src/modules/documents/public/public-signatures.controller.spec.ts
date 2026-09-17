import { BadRequestException } from '@nestjs/common';

import { SignaturesService } from '../signatures/signatures.service';
import { PublicSignaturesController } from './public-signatures.controller';

// Same boundary `public-documents.controller.spec.ts` already mocks, for the identical reason: the
// real package ships an ESM-only transitive dependency (better-auth/dist/integrations/node.mjs)
// jest's ts-jest transform doesn't parse. `Public` only sets metadata `AuthGuard` reads — nothing
// this suite needs the real implementation of.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

/**
 * HTTP-layer proof for `GET :token/document` — the service's OWN freeze/reuse logic (render once,
 * serve the same bytes forever, the exact generic refusal for a dead token) is already exhaustively
 * covered in `signatures/signatures.service.spec.ts`; this file proves only what the CONTROLLER
 * itself is responsible for: which headers it sets, and that it relays the service's refusal
 * untouched rather than wrapping or reshaping it.
 */
function buildController(service: Partial<SignaturesService>) {
  return new PublicSignaturesController(service as SignaturesService);
}

function fakeResponse() {
  const res = {
    headers: {} as Record<string, string>,
    sentBody: undefined as Buffer | undefined,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(body: Buffer) {
      this.sentBody = body;
    },
  };
  return res;
}

describe('PublicSignaturesController — GET :token/document', () => {
  it('serves the bytes SignaturesService.getPublicDocument returns, with the right headers', async () => {
    const bytes = Buffer.from('%PDF-1.7 fake bytes');
    const getPublicDocument = jest.fn().mockResolvedValue({ bytes, typeId: 'quote', documentId: 'quote-1' });
    const controller = buildController({ getPublicDocument });
    const res = fakeResponse();

    await controller.getDocument('a-real-token', res as never);

    expect(getPublicDocument).toHaveBeenCalledWith('a-real-token');
    expect(res.sentBody).toBe(bytes);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toBe('inline; filename="quote-quote-1.pdf"');
    // Never cacheable — this is one specific, unauthenticated party's own document.
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  /**
   * A deliberate DEPARTURE from the literal 404/410 vocabulary this endpoint might otherwise use:
   * every other route on `PublicSignaturesController` (`resolve`, `otp`, `sign`) already collapses
   * "unknown", "expired", "locked" and "already used" into the exact same 400
   * `BadRequestException` — see that controller's own header, "Why every failure mode collapses to
   * ONE message". Splitting `document` off with its own distinct 404/410 codes would reopen exactly
   * the oracle that discipline exists to close (a scripted client could tell "this token never
   * existed" apart from "this token existed but is now dead" by which STATUS this one route answers,
   * even though every other route on the same controller refuses to say). This test proves the
   * controller does not reshape the service's exception into anything else — the uniform 400 IS the
   * contract.
   */
  it('relays the SAME 400 the rest of this controller returns — never a distinct 404/410', async () => {
    const getPublicDocument = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException('This signature request is invalid, expired, or already used.'),
      );
    const controller = buildController({ getPublicDocument });

    const action = controller.getDocument('dead-token', fakeResponse() as never);

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow('This signature request is invalid, expired, or already used.');
  });
});
