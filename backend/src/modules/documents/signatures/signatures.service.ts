import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';

import { MailTemplateType, WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { MailService } from '@/mail/mail.service';
import {
  resolveSystemEmailTemplate,
  SystemEmailFamily,
  systemEmailFamilyLabel,
} from '@/mail/system-email-templates';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { DocumentEmailTemplate } from '../descriptors/types';
import {
  buildOtpEmailParts,
  buildSignatureRequestEmailParts,
  renderEmailTemplate,
} from '../actions/email-template';

import { findOwnedDocument, updateDocumentStatus } from '../persistence';
import {
  buildDocumentWebhookPayload,
  DOCUMENT_WEBHOOK_EMITTER,
  DocumentWebhookEmitter,
} from '../queue/document-webhooks';
import { generateOtpCode, hashOtpCode, otpCodeMatches } from './otp';
import { generateSignatureToken, hashSignatureToken } from './signature-token';
import {
  createSignatureForDocument,
  findSignatureByTokenHash,
  markSignatureSigned,
  mintOtpChallenge,
  recordFailedAttempt,
  SignatureRecord,
} from './signature.persistence';

/**
 * The hardened, dynamic replacement for the removed `modules/signatures/` module (git tag
 * `avant-refonte-documents`) — see schema.prisma's own `Signature` model header for the full "why"
 * and the exact vulnerability (GHSA-vhjw-gwc5-pjfp) this closes. Two entirely different callers use
 * this one class, on the SAME split `ShareLinksService` already establishes for its own two halves:
 *
 *  - `requestSignature` — the effect of the "request-signature" ActionRegistry action
 *    (`actions/request-signature.ts`). Called ONLY after `DocumentsService.runAction` has already run
 *    every one of its four gates (country policy, status, implementation, validation) — this method
 *    trusts `companyId`/`typeId`/`documentId` completely, the same trust `registerRequestDepositAction`
 *    places in its own `ctx`.
 *  - `resolvePublicSignature` / `requestOtp` / `verifyAndSign` — the PUBLIC flow
 *    (`public/public-signatures.controller.ts`, `@Public()`, no `companyId` known up front at all).
 *    Every one of these three starts by resolving the raw token through `resolveActiveOrThrow`, which
 *    is also where "unknown token" / "locked" / "already signed" collapse into ONE indistinguishable
 *    refusal — see that method's own header.
 *
 * ## The brute-force guarantee, precisely
 *
 * Over the ENTIRE LIFETIME of one `Signature` row, an attacker gets at most `MAX_FAILED_ATTEMPTS`
 * (`otp.ts`) guesses against a code space of `OTP_CODE_SPACE` — `otp.spec.ts`'s own "the guarantee"
 * test recomputes that fraction from the two exported constants directly, so widening the budget or
 * narrowing the code space fails CI. `MAX_OTP_MINTS` (also `otp.ts`) bounds how many times a fresh
 * code may be minted at all, but NEVER resets or grows that lifetime attempt budget — see
 * `signature.persistence.ts`'s own `recordFailedAttempt`/`mintOtpChallenge` headers for exactly how
 * both are enforced atomically against concurrent requests.
 *
 * ## Why every failure mode collapses to ONE message
 *
 * `GENERIC_BLOCK_MESSAGE` is returned, verbatim, for an unknown token, a locked one, an
 * already-signed one, an expired-or-never-minted OTP, and a wrong OTP code — five genuinely different
 * server-side facts, one indistinguishable client-side outcome. This is not merely tidiness: a
 * DISTINCT message per case would hand an attacker a free oracle (e.g. "is THIS specific 8-digit
 * guess wrong, or is the whole request already dead?" — precisely the kind of side channel a 5-guess
 * budget is supposed to make worthless to even try mapping out). `RESEND_CAP_MESSAGE` is
 * deliberately a SEPARATE, distinct message: reaching the resend cap is a fact about throttling a
 * still-perfectly-valid, active request, not a signal about which of 10^8 codes is correct — telling
 * a legitimate user "you've already requested the maximum number of codes" leaks nothing brute-forceable.
 */
const GENERIC_BLOCK_MESSAGE = 'This signature request is invalid, expired, or already used.';
const RESEND_CAP_MESSAGE = 'The maximum number of verification codes has already been sent for this request.';

export interface PublicSignatureView {
  typeId: string;
  /** The document's own frozen display number (numbering/format-number.ts) — null only for a record
   *  whose numbering somehow never took (see request-deposit.ts's own comment on the identical,
   *  never-really-exercised fallback); "request-signature" is only ever available once a quote is
   *  "sent", by which point it is always numbered (quote.descriptor.ts's own `numbering.onEnterStatus`). */
  displayNumber: string | null;
}

/**
 * The NARROW slice of `ClientsService` this file actually needs — injected through a Nest DI TOKEN
 * (`CLIENT_CONTACT_LOOKUP`), never the concrete `ClientsService` class, for the EXACT reason
 * `queue/document-webhooks.ts`'s own `DOCUMENT_WEBHOOK_EMITTER` header documents: `ClientsService`
 * (`modules/clients/clients.service.ts`) imports `WebhookDispatcherService` directly, which chains
 * into `webhooks.service.ts` → `drivers/discord.driver.ts` → `@teever/ez-hook`, the pure-ESM package
 * ts-jest cannot compile (the known "`ClientsModule` inimportable sous ts-jest" limit).
 * `quote-actions.ts`'s own `QuoteActionDeps.clientsService: ClientsService` gets away with importing
 * the concrete class because it is a BARE INTERFACE FIELD (erased entirely at compile time, no
 * decorator ever forces it to survive as a real value) — but THIS class is `@Injectable()`, and a
 * constructor parameter typed as the concrete class on a decorated class forces
 * `emitDecoratorMetadata` to embed a REAL reference to `ClientsService` in the compiled output,
 * which is exactly what would drag the whole chain into every spec that constructs a real
 * `SignaturesService` (`signatures.service.spec.ts`). A `Symbol` token and a locally-declared
 * interface have no such problem: `documents-core.module.ts` maps this token to the real
 * `ClientsService` with `useExisting` — the identical pattern `DOCUMENT_WEBHOOK_EMITTER` already
 * uses for `WebhookDispatcherService`.
 */
export const CLIENT_CONTACT_LOOKUP = Symbol('CLIENT_CONTACT_LOOKUP');

export interface ClientContactLookup {
  getClientById(companyId: string, id: string): Promise<{ contactEmail?: string | null } | null>;
}

@Injectable()
export class SignaturesService {
  constructor(
    @Inject(CLIENT_CONTACT_LOOKUP) private readonly clientsService: ClientContactLookup,
    private readonly mailService: MailService,
    @Inject(DOCUMENT_WEBHOOK_EMITTER) private readonly webhooks: DocumentWebhookEmitter,
  ) {}

  /**
   * The "request-signature" action's own effect — mints a fresh link, persists ONLY its hash
   * (`createSignatureForDocument`), and emails the client the RAW token embedded in a URL
   * (`${APP_URL}/signature/${token}`), NEVER the `Signature` row's own `id` (schema.prisma's own
   * header: that conflation was the removed module's actual break). Deactivates any previously active
   * request for the same document first — see `signature.persistence.ts`'s own header.
   */
  async requestSignature(
    companyId: string,
    typeId: string,
    documentId: string,
  ): Promise<{ message: string }> {
    const document = await findOwnedDocument(companyId, typeId, documentId);
    const data = (document.data ?? {}) as Record<string, unknown>;
    const clientId = typeof data.client === 'string' ? data.client : undefined;
    const client = clientId ? await this.clientsService.getClientById(companyId, clientId) : null;

    if (!client?.contactEmail) {
      throw new BadRequestException(
        `Cannot request a signature for ${typeId} "${documentId}" — its client has no contact email on file.`,
      );
    }

    const { token, tokenHash } = generateSignatureToken();
    const signature = await createSignatureForDocument({ companyId, typeId, documentId, tokenHash });

    await this.sendSignatureRequestEmail({
      companyId,
      signatureId: signature.id,
      token,
      recipient: client.contactEmail,
      displayNumber: document.displayNumber ?? document.id,
    });

    return { message: `Signature request sent to ${client.contactEmail}.` };
  }

  /** The page's own "who/what am I signing" view — see `resolveActiveOrThrow` for why an
   *  invalid/locked/signed token refuses here exactly like it does everywhere else in this class. */
  async resolvePublicSignature(token: string): Promise<PublicSignatureView> {
    const row = await this.resolveActiveOrThrow(token);
    const document = await findOwnedDocument(row.companyId, row.typeId, row.documentId).catch(() => null);
    return { typeId: row.typeId, displayNumber: document?.displayNumber ?? null };
  }

  /**
   * Mints and emails a fresh OTP — throttled to `MAX_OTP_MINTS` mints per signature, EVER (see
   * `otp.ts`'s own header: this never widens the lifetime attempt budget, only how many times a code
   * may be freshly issued). `@nestjs/throttler`'s per-IP limit on this same route
   * (`public-signatures.controller.ts`) is defense in depth on TOP of this — this per-row cap is what
   * actually bounds it regardless of how many IPs an attacker has.
   */
  async requestOtp(token: string): Promise<{ message: string }> {
    const row = await this.resolveActiveOrThrow(token);
    const code = generateOtpCode();
    const { minted } = await mintOtpChallenge(row.id, hashOtpCode(code));
    if (!minted) {
      throw new BadRequestException(RESEND_CAP_MESSAGE);
    }
    await this.sendOtpEmail(row, code);
    return { message: 'Verification code sent.' };
  }

  /**
   * Verifies a submitted code and, on success, actually signs the document — see this class's own
   * header, "The brute-force guarantee" and "Why every failure mode collapses to ONE message", for
   * the two things this method exists to hold. A code is "live" only while `otpCodeHash` is set AND
   * `otpExpiresAt` is still in the future — a code that was never minted, or has gone stale, can never
   * match, REGARDLESS of what is typed, which is why `codeIsLive` is checked before ever touching
   * `otpCodeMatches` at all (no digest comparison is even meaningful against a hash that no longer
   * represents "the current, live challenge").
   */
  async verifyAndSign(token: string, submittedCode: string): Promise<{ message: string }> {
    const row = await this.resolveActiveOrThrow(token);

    const codeIsLive = !!row.otpCodeHash && !!row.otpExpiresAt && row.otpExpiresAt.getTime() > Date.now();
    const matches = codeIsLive && otpCodeMatches(submittedCode ?? '', row.otpCodeHash as string);

    if (!matches) {
      // Every non-succeeding call against a resolvable, still-active row consumes one lifetime
      // attempt — whether the code was merely wrong, expired, or never minted at all. Folding all
      // three into the SAME counter keeps the guarantee this class's own header states simple to
      // both prove and test: "AT MOST MAX_FAILED_ATTEMPTS non-succeeding calls, ever" — not a
      // narrower claim that quietly excludes whichever of those three reasons someone forgot to wire
      // the counter up for.
      await recordFailedAttempt(row.id);
      throw new BadRequestException(GENERIC_BLOCK_MESSAGE);
    }

    await this.markSigned(row);
    return { message: 'Document signed.' };
  }

  /**
   * Collapses "unknown token" / "already locked" / "already signed" / "no longer active" into the
   * SAME refusal, via the SAME single query, for every public entry point — see this class's own
   * header, "Why every failure mode collapses to ONE message". `isActive` alone already catches the
   * lock (schema.prisma's own `Signature.lockedAt` header: both are set on the same write) and a
   * superseded-by-a-fresh-request row; `signedAt` is checked too, defensively, even though a
   * successful sign also flips `isActive` to false on the same write (`markSignatureSigned`) — two
   * independent reasons for the SAME conclusion, not one relying on the other never regressing.
   */
  private async resolveActiveOrThrow(token: string): Promise<SignatureRecord> {
    const row = await findSignatureByTokenHash(hashSignatureToken(token));
    if (!row?.isActive || row.lockedAt || row.signedAt) {
      throw new BadRequestException(GENERIC_BLOCK_MESSAGE);
    }
    return row;
  }

  /**
   * The terminal write on a successful verification — deliberately OUTSIDE `DocumentsService.
   * runAction`/`ActionRegistry` (there is no authenticated caller here to run it as): a defensive,
   * hand-checked status guard plays the role `checkTransitionResult` plays for an ordinary action (see
   * lifecycle.ts's own header on why a handler never trusts its own precondition alone), refusing to
   * sign a document this same mechanism did not itself leave "sent" (e.g. some OTHER path moved it on
   * in the meantime) with a 409, the same status-conflict vocabulary every other action in this module
   * already uses for the identical shape of problem.
   */
  private async markSigned(row: SignatureRecord): Promise<void> {
    const current = await findOwnedDocument(row.companyId, row.typeId, row.documentId);
    if (current.status !== 'sent') {
      throw new ConflictException(
        `Cannot sign a document with status "${current.status}" — it is no longer awaiting signature.`,
      );
    }

    const updated = await updateDocumentStatus(row.companyId, row.typeId, row.documentId, 'signed');
    await markSignatureSigned(row.id);

    try {
      await this.webhooks.dispatch(
        WebhookEvent.DOCUMENT_SIGNED,
        buildDocumentWebhookPayload(row.companyId, row.typeId, updated),
      );
    } catch (error) {
      logger.error('Failed to dispatch a DOCUMENT_SIGNED webhook — the document was still signed', {
        category: 'documents',
        details: {
          companyId: row.companyId,
          typeId: row.typeId,
          documentId: row.documentId,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * The company's own `MailTemplate` row for `SIGNATURE_REQUEST` when it has one, else the SHIPPED
   * default (`mail/system-email-templates.ts`) — the same "company override, else the template this
   * application ships" precedence `resolveEmailTemplate` applies to a document type. A missing row used
   * to be a hard refusal here, which was only ever safe because `company.service.ts#getCompanyInfo`
   * seeded one on every read of a company's own info; with the copy living in code instead, a company
   * with no row is an ordinary, fully functional state and a signature request can no longer be blocked
   * by a missing configuration row.
   *
   * `Company.documentEmailTemplates` is still a different mechanism, keyed by document type rather than
   * by family — see `actions/company-email-templates.ts`'s own header for which storage answers which
   * keying problem. The ENGINE below is the same one document sends use.
   */
  private async sendSignatureRequestEmail(input: {
    companyId: string;
    signatureId: string;
    token: string;
    recipient: string;
    displayNumber: string;
  }): Promise<void> {
    const appUrl = process.env.APP_URL || '';
    const template = await this.resolveSystemTemplate(MailTemplateType.SIGNATURE_REQUEST, input.companyId);
    const parts = buildSignatureRequestEmailParts({
      appUrl,
      signatureUrl: `${appUrl}/signature/${input.token}`,
      signatureId: input.signatureId,
      signatureNumber: input.displayNumber,
    });

    await this.sendTemplatedMail(template, parts, input.recipient, MailTemplateType.SIGNATURE_REQUEST);
  }

  /** Same mechanism as above, for `VERIFICATION_CODE`. The "XXXX-XXXX" split is purely cosmetic (easier
   *  for a human to read/type back), applied to the DISPLAYED code only — never to what is
   *  hashed/compared (`otp.ts` always works on the raw 8-digit string), which is why the split happens
   *  HERE, at the one point the code becomes prose, and never upstream of `mintOtpChallenge`. Resolves
   *  the recipient fresh from `row`'s own `documentId` (rather than threading it through from
   *  `requestSignature`) so a re-armed OTP, long after the initial request, still reaches the right
   *  inbox even if the underlying `Client` row's own `contactEmail` changed in the meantime. */
  private async sendOtpEmail(row: SignatureRecord, code: string): Promise<void> {
    const template = await this.resolveSystemTemplate(MailTemplateType.VERIFICATION_CODE, row.companyId);

    const document = await findOwnedDocument(row.companyId, row.typeId, row.documentId);
    const data = (document.data ?? {}) as Record<string, unknown>;
    const clientId = typeof data.client === 'string' ? data.client : undefined;
    const client = clientId ? await this.clientsService.getClientById(row.companyId, clientId) : null;
    if (!client?.contactEmail) {
      throw new BadRequestException('Signature request has no reachable recipient.');
    }

    const parts = buildOtpEmailParts({
      appUrl: process.env.APP_URL || '',
      otpCode: `${code.slice(0, 4)}-${code.slice(4, 8)}`,
    });
    await this.sendTemplatedMail(template, parts, client.contactEmail, MailTemplateType.VERIFICATION_CODE);
  }

  private async resolveSystemTemplate(
    family: SystemEmailFamily,
    companyId: string,
  ): Promise<DocumentEmailTemplate> {
    const override = await prisma.mailTemplate.findFirst({
      where: { type: family, companyId },
      select: { subject: true, body: true },
    });
    return resolveSystemEmailTemplate(family, override);
  }

  /**
   * Composes and sends one system email through the SHARED engine
   * (`actions/email-template.ts#renderEmailTemplate`): `{placeholder}` interpolation, an unknown
   * placeholder left exactly as written and WARNED about rather than thrown, and both parts on the
   * wire — the html the template carries plus the text part the engine guarantees (derived from that
   * html for a customised row, which only ever stored markup).
   *
   * Warnings are logged, never raised: a typo in a company's own signature-request subject must not be
   * what prevents a signature request — or a verification code — from being delivered. That is the same
   * contract the engine documents for document sends, applied here to the two emails where failing
   * closed would be worst.
   */
  private async sendTemplatedMail(
    template: DocumentEmailTemplate,
    parts: Record<string, string>,
    recipient: string,
    family: SystemEmailFamily,
  ): Promise<void> {
    const label = systemEmailFamilyLabel(family).toLowerCase();
    const { subject, body, html, warnings } = renderEmailTemplate(template, parts);

    for (const warning of warnings) {
      logger.warn(`System email template: ${warning}`, {
        category: 'documents',
        details: { family, recipient },
      });
    }

    try {
      await this.mailService.sendMail({
        to: recipient,
        subject,
        text: body,
        ...(html ? { html } : {}),
      });
    } catch (error) {
      logger.error(`Failed to send ${label} email`, {
        category: 'documents',
        details: { recipient, message: error instanceof Error ? error.message : String(error) },
      });
      throw new BadRequestException(`Failed to send ${label} email. Please check your SMTP configuration.`);
    }
  }
}
