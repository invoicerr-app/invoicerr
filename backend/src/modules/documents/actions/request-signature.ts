import { SignaturesService } from '../signatures/signatures.service';
import { ActionRegistry } from './action-registry';

/**
 * "request-signature" (see schema.prisma's own `Signature` model header
 * for the full "why" and the GHSA-vhjw-gwc5-pjfp advisory this hardens against). Registered on the
 * "quote" type exactly like "request-deposit"/"convert-to-invoice" (quote.descriptor.ts): no
 * `transitions` — this action's entire effect is a brand-new `Signature` row plus an email, it never
 * changes the QUOTE's own status itself (the client's own eventual OTP verification does that, via
 * the wholly separate PUBLIC flow — `public/public-signatures.controller.ts` — which is why THAT path
 * runs its own hand-checked status guard rather than `runAction`'s: there is no authenticated caller
 * there to run it as).
 *
 * Everything this handler needs already ran BEFORE it: `DocumentsService.runAction` has already
 * checked country policy (403), the quote's own status against `availableWhen: ['sent']` (409, see
 * quote.descriptor.ts's own comment on why only a SENT quote may be asked to sign — the identical
 * reasoning `request-deposit.ts`'s own header holds), that AN implementation is registered at all
 * (501 otherwise — this file existing and being wired into `documents-core.module.ts`'s
 * `buildActionRegistry` is what makes that true), and this action's own `data`/`params` shapes (400 —
 * it declares no `params` at all, so there is nothing to fail). This handler is therefore a thin
 * wrapper: delegate to `SignaturesService.requestSignature` (the actual token-mint/email work,
 * `signatures/signatures.service.ts`), and translate its result into the standard `ActionResult`
 * envelope every other action already returns.
 *
 * ## The 501 extension point this capability's own header promises
 *
 * `SignaturesService.requestSignature` implements exactly ONE eIDAS tier: a Simple Electronic
 * Signature (SES) via an emailed link plus an OTP — the lowest tier, and the only one any founding
 * country's own `country-policy/data/*.json` currently requires for signing a QUOTE (a product
 * convenience, not a legally-encumbered act — see each file's own "request-signature" rule). Should a
 * future country's data ever declare that signing needs a HIGHER tier (Advanced/Qualified — AES/QES,
 * a certificate-backed signature this OTP mechanism structurally cannot produce), the correct
 * response is for THIS handler — or a per-country strategy resolved the same way
 * `transports/transport-registry.ts` resolves a channel — to refuse LOUDLY with `NotImplementedException`
 * (the exact same 501 vocabulary `runAction` already gives a document type that declares an action with
 * no registered handler at all), never to silently hand back an SES result under a stronger name. No
 * such data exists in this codebase today, so there is nothing to branch on yet — this comment is the
 * marker for whoever adds the first one.
 */
export function registerRequestSignatureAction(
  registry: ActionRegistry,
  signaturesService: SignaturesService,
): void {
  registry.register('quote', 'request-signature', async ({ companyId, typeId, documentId }) => {
    if (!documentId) {
      // Unreachable in practice — `availableWhen: ['sent']` already refuses this before the handler
      // runs (a never-saved record has no status to match) — but a handler never trusts that alone,
      // the same defensive posture `invoice-actions.ts`'s own "cancel" already holds.
      throw new Error('Cannot request a signature for a document that has not been saved yet.');
    }

    const { message } = await signaturesService.requestSignature(companyId, typeId, documentId);
    return { changed: false, message };
  });
}
