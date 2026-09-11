/**
 * The CANONICAL, dated representation of one TERMINAL authority verdict — decided
 * 2026-09-06 ("le poller de conformité PDP/KSeF n'archive PAS le VERDICT, seulement
 * le DÉPÔT"). This is the "content" half of the decision; `persistence.ts#createAuthorityVerdictArchive`
 * is the "write it under the same discipline as the deposit" half.
 *
 * The decision is explicit about what this content MUST be: "le payload brut de l'autorité tel que
 * reçu — jamais une reformulation — plus l'horodatage de réception et la référence au dépôt". Three
 * consequences follow directly:
 *
 *  - `rawPayload` is embedded VERBATIM (whatever the poller itself received — see
 *    `RawAuthorityEvent.rawPayload`'s own header in `conformity/authority-status-poller.ts`), never
 *    re-derived from the already-interpreted `statusCode`/`statusText`/`reason` columns this codebase
 *    also keeps. A future mapping bug in those columns would corrupt the OPERATIONAL journal but never
 *    this artifact, which is the whole point of keeping raw bytes at all.
 *  - `receivedAt` is stamped by the CALLER as "now" at write time (when THIS application actually
 *    archived the verdict), deliberately distinct from `observedAt` (when the AUTHORITY itself dated
 *    the event) — the same two-clocks distinction `DocumentAuthorityEvent.observedAt` vs `createdAt`
 *    already draws, just written into the artifact's OWN bytes this time, not left to a database
 *    column an auditor might not have access to.
 *  - `deposit` — the reference to the DELIVERY archive this verdict attests to — is embedded in the
 *    hashed content itself, not left to `DocumentArchive.parentArchiveId` alone: a foreign key can be
 *    read only with a working database and this schema; the artifact's own bytes, extracted to a
 *    plain file with nothing else, must still say what they are a verdict ABOUT. `contentHash` (the
 *    parent DELIVERY archive's own recorded hash) is the strongest single fact to embed — reproducing
 *    it independently would require the exact same deposit bytes this codebase already committed to.
 *
 * Deliberately excluded: nothing here names a country or a channel by special-casing it — `providerId`
 * is whatever the channel's own transport id is ('pdp' | 'ksef' | any future one), read verbatim off
 * the event, never branched on.
 */
import { ArchivedArtifactInput } from './hashing';

/** One TERMINAL event exactly as `conformity/authority-status-poller.ts#AuthorityStatusPoller.poll`
 *  returned it — narrowed to what this module needs so it never has to import the conformity module's
 *  own types (this file has no reason to know about pollers, registries, or eligibility). */
export interface TerminalAuthorityVerdict {
  providerId: string;
  statusCode: string;
  statusText?: string | null;
  reason?: string | null;
  /** WHEN THE AUTHORITY ITSELF recorded this event — see this file's own header. */
  observedAt: Date;
  rawPayload?: unknown;
}

/** The DELIVERY archive this verdict attests to — see this file's own header on why `contentHash` is
 *  embedded, not merely `archiveId`. */
export interface AttestedDeposit {
  documentId: string;
  archiveId: string;
  contentHash: string;
}

/** Builds the ONE artifact a VERDICT archive ever contains — see `DocumentArchive.artifacts`'s own
 *  schema comment. `role: 'authority-verdict'` is a new, dedicated role (never reusing 'pdf'/'facturx'
 *  /'fa3'/etc — see `hashing.ts`'s own header on why `role` already doubles as "what this artifact
 *  IS"): a verdict is not a rendering of the invoice, and must never be mistaken for one by anything
 *  that later reads `DocumentArchive.artifacts` looking for a deliverable format.
 */
export function buildVerdictArtifact(
  verdict: TerminalAuthorityVerdict,
  deposit: AttestedDeposit,
  receivedAt: Date,
): ArchivedArtifactInput {
  const canonical = {
    providerId: verdict.providerId,
    statusCode: verdict.statusCode,
    statusText: verdict.statusText ?? null,
    reason: verdict.reason ?? null,
    observedAt: verdict.observedAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    rawPayload: verdict.rawPayload ?? null,
    deposit: {
      documentId: deposit.documentId,
      archiveId: deposit.archiveId,
      contentHash: deposit.contentHash,
    },
  };
  return {
    role: 'authority-verdict',
    mime: 'application/json',
    bytes: new TextEncoder().encode(JSON.stringify(canonical)),
  };
}
