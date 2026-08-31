/**
 * Local artifact/signature shapes for the signing module — root TODO item 13.
 *
 * The repère (`avant-refonte-documents`, `compliance/execution/types.ts`) had `RenderedArtifact`/
 * `SignedArtifact` carry a `role` (AUTHORITATIVE/…) and a closed `DocumentSyntax` enum, because the
 * whole compliance engine reasoned about a PLAN of several artifacts per jurisdiction. That engine is
 * gone (see TODO.md's own header) — this module signs exactly ONE thing today, a rendered PDF (see
 * `sign-instance-pdf.ts`), so those two fields are dropped rather than carried over unused. `mime`
 * stays (a provider still needs to know/declare what it produced — CAdES turns a PDF/XML into
 * `application/pkcs7-mime`) and an optional `label` replaces `syntax` for log messages only — never
 * read for a business decision the way the old `syntax` was.
 */

export type SignAlgo = 'XAdES' | 'CAdES' | 'PAdES' | 'none';

/**
 * Baseline signature level per ETSI EN 319 132 / EN 319 122 / EN 319 102 — reprised verbatim from the
 * repère.
 *  BES  — Basic Electronic Signature (no timestamp).  Default; offline-safe.
 *  T    — Adds an RFC 3161 SignatureTimeStamp from a TSA.
 *  LT   — Adds revocation material (CRL/OCSP) embedding (seam — not yet implemented).
 *  LTA  — Adds an archive timestamp over the LT material (seam — not yet implemented).
 *
 * LT and LTA are documented seams: the constructors accept these values so the type is
 * forward-compatible, but the providers currently treat them as T (timestamp only) until revocation
 * embedding is implemented — unchanged from the repère, still true here.
 */
export type SignatureLevel = 'BES' | 'T' | 'LT' | 'LTA';

/** What a signing provider is handed and hands back. */
export interface SigningArtifact {
  /** e.g. "application/pdf", "application/xml". */
  mime: string;
  bytes: Uint8Array;
  /** Informational only — used in log messages, never read for a business decision. */
  label?: string;
}

export interface SignatureInfo {
  algo: SignAlgo;
  certRef: string;
}

export interface SignedArtifact extends SigningArtifact {
  signature?: SignatureInfo;
}
