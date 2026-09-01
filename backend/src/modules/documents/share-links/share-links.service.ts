/**
 * Root TODO item 24 ("liens publics de téléchargement") — the CRUD half of a public, unauthenticated
 * download link for one document instance's PDF. On the model of `DocumentSchedulesService`
 * (schedules/schedules.service.ts): a small class that reuses `DocumentsService.getType`/
 * `getDocument` for the exact same tenant-scoped 404s every other entry point into this module
 * already gets, rather than re-implementing them.
 *
 * "share-link" is declared as an ACTION on the invoice/quote/credit-note descriptors (see
 * invoice.descriptor.ts's own comment on that choice) purely so the country-action policy and the
 * status lifecycle get an opinion on it — but, like "download-xml"
 * (`documents.service.ts#downloadDocumentFormat`), it is NEVER run through `ActionRegistry`/
 * `runAction`: `create`/`list`/`revoke` below are REST resources
 * ("/documents/:id/share-link[s]"), not a single POST-and-forget action. This class runs the two
 * gates that actually apply by hand (country policy 403, status 409) — see `create`'s own header for
 * why only two of `downloadDocumentFormat`'s four ever fire here.
 *
 * Default expiry (`DEFAULT_TTL_MS`): deliberately NOT the repère's own 1 hour
 * (pdf-links.service.ts's `TOKEN_TTL_MS`, git tag `avant-refonte-documents`). That number was
 * calibrated for a categorically different consumer — the repère's own header says so explicitly:
 * "minted by the MCP PDF tools so a chat client... can still offer the user a clickable URL", a
 * single-conversation, throwaway link with no screen to ever see it again. THIS feature is the
 * opposite on purpose: a persistent, LISTED (see `list` below), REVOCABLE (see `revoke`) link a
 * company hands to a client to actually open an invoice — an hour would make "list the active links,
 * revoke one" nearly pointless (most links would already be dead before anyone thought to revoke
 * them). 30 days is the "reasonable default" this ticket allows when the repère's own number doesn't
 * transfer to the new use case.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { evaluateCountryPolicy } from '../country-policy/country-policy';
import { isActionAvailable } from '../descriptors/types';
import { DocumentsService } from '../documents.service';
import { generateShareLinkToken, hashShareLinkToken } from './share-link-token';
import {
  createShareLinkToken,
  findOwnedShareLinkToken,
  findShareLinkTokenByHash,
  listShareLinkTokens,
  revokeShareLinkToken,
  ShareLinkTokenRecord,
} from './share-link.persistence';

const SHARE_LINK_ACTION_ID = 'share-link';

/** 30 days — see this file's own header for why the repère's 1-hour TTL was not reused. */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreatedShareLink {
  id: string;
  /** The RAW token, exposed exactly ONCE — the create response is the only place this codebase ever
   *  hands it back. The frontend combines this with its own known backend origin (the same
   *  `VITE_BACKEND_URL` mechanism `authenticatedFetch` already uses — see that hook's own header on
   *  why a bare relative path here would silently resolve against the WRONG origin in dev/test,
   *  the "third dead button of this family" trap document-list.tsx's own PDF button already
   *  documents) to build the actual copyable URL; this service only ever knows the API-relative
   *  path, never which origin externally reaches it. */
  token: string;
  /** "/api/public/documents/:token/pdf" — see `PublicDocumentsController`. */
  path: string;
  expiresAt: Date;
}

export interface ShareLinkSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Derived, never stored: `!revokedAt && expiresAt > now`. What the screen actually filters
   *  "active" links by. */
  active: boolean;
}

export interface ResolvedShareLink {
  companyId: string;
  typeId: string;
  documentId: string;
}

function toSummary(record: ShareLinkTokenRecord, now: Date): ShareLinkSummary {
  return {
    id: record.id,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    active: !record.revokedAt && record.expiresAt > now,
  };
}

function publicPathFor(token: string): string {
  return `/api/public/documents/${token}/pdf`;
}

@Injectable()
export class ShareLinksService {
  constructor(private readonly documentsService: DocumentsService) {}

  /** 404s for an unknown type OR a type that never declared "share-link" at all — same message shape
   *  `documents.service.ts`'s own private `resolveAction` uses for "download-xml". */
  private resolveShareLinkAction(typeId: string) {
    const descriptor = this.documentsService.getType(typeId); // 404s for an unknown typeId.
    const action = descriptor.actions.find((candidate) => candidate.id === SHARE_LINK_ACTION_ID);
    if (!action) {
      throw new NotFoundException(`Document type "${typeId}" has no action "${SHARE_LINK_ACTION_ID}".`);
    }
    return action;
  }

  /**
   * Creates a new public link — the ONE write in this class that actually needs the country-policy
   * gate (listing/revoking a link this company ALREADY holds is cleanup, not a new grant; see
   * `documents.service.ts`'s own `listDocumentArchives`/`verifyDocumentArchive`, neither of which
   * re-checks country policy either). Runs, in order:
   *  1. type/action known at all -> 404 (`resolveShareLinkAction`)
   *  2. country policy -> 403 (`evaluateCountryPolicy`, identical check to `runAction`'s own)
   *  3. the document exists and belongs to this company -> 404 (`getDocument`)
   *  4. status -> 409, EITHER because the descriptor's own `availableWhen` refuses a draft (named
   *     reason: "a draft has no number and no legal existence to share") OR because the country
   *     policy narrows further (`restrictedToStatuses`) — same composition
   *     `downloadDocumentFormat` already documents. There is no 501 (no per-format provider to
   *     resolve — a share link has no "syntax") and no 400 (nothing to build or validate) — this
   *     action's own four-gate story only ever has two gates with something to say.
   */
  async create(companyId: string, typeId: string, documentId: string): Promise<CreatedShareLink> {
    const action = this.resolveShareLinkAction(typeId);

    const policyDecision = await evaluateCountryPolicy(companyId, typeId, SHARE_LINK_ACTION_ID);
    if (!policyDecision.allowed) {
      throw new ForbiddenException(policyDecision.reason);
    }

    const instance = await this.documentsService.getDocument(companyId, typeId, documentId);

    if (!isActionAvailable(action, instance.status)) {
      throw new ConflictException(
        `Cannot create a public share link for a document with status "${instance.status}" — a draft ` +
          'has no number and no legal existence yet to hand a stranger a link to.',
      );
    }
    if (
      policyDecision.restrictedToStatuses &&
      !policyDecision.restrictedToStatuses.includes(instance.status)
    ) {
      throw new ConflictException(
        `Action "${SHARE_LINK_ACTION_ID}" of document type "${typeId}" is restricted by this company's ` +
          `country policy to status(es) ${policyDecision.restrictedToStatuses.join(', ')}, not "${instance.status}".`,
      );
    }

    const { token, tokenHash } = generateShareLinkToken();
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
    const record = await createShareLinkToken({ companyId, typeId, documentId, tokenHash, expiresAt });

    return { id: record.id, token, path: publicPathFor(token), expiresAt: record.expiresAt };
  }

  /** Metadata only — see `ShareLinkTokenRecord`/`ShareLinkSummary`: there is no `token`/`tokenHash`
   *  field on this return shape at all, not even redacted, so a re-consultation of the raw token is
   *  not merely refused, it is impossible to express through this method's own return type. */
  async list(companyId: string, typeId: string, documentId: string): Promise<ShareLinkSummary[]> {
    await this.documentsService.getDocument(companyId, typeId, documentId); // tenant-scoped 404.
    const records = await listShareLinkTokens(companyId, documentId);
    const now = new Date();
    return records.map((record) => toSummary(record, now));
  }

  /** Soft-revoke — see share-link.persistence.ts's own header on why `revokedAt`, never a delete. */
  async revoke(
    companyId: string,
    typeId: string,
    documentId: string,
    tokenId: string,
  ): Promise<{ revoked: true }> {
    await this.documentsService.getDocument(companyId, typeId, documentId); // tenant-scoped 404.
    const owned = await findOwnedShareLinkToken(companyId, documentId, tokenId);
    if (!owned) {
      throw new NotFoundException(`Share link "${tokenId}" not found for this document.`);
    }
    await revokeShareLinkToken(owned.id);
    return { revoked: true };
  }

  /**
   * The PUBLIC resolution path (`PublicDocumentsController`) — returns `null`, uniformly, for an
   * unknown token, an expired one, AND a revoked one. This is the entire point of the method: the
   * three cases run the EXACT SAME work (one `findUnique` by hash, then a couple of in-memory
   * comparisons — no extra query, no extra branch that could cost more or less time) and produce the
   * exact same signal to the caller, which is what lets the controller answer all three with one
   * identical 404 — never a hint that would let a caller distinguish "this token once existed" from
   * "this token was never real".
   */
  async resolvePublicToken(token: string): Promise<ResolvedShareLink | null> {
    const record = await findShareLinkTokenByHash(hashShareLinkToken(token));
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt <= new Date()) return null;
    return { companyId: record.companyId, typeId: record.typeId, documentId: record.documentId };
  }
}
