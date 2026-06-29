/**
 * CredentialAccessAudit — structured, secret-free audit log for every credential
 * and signing-certificate access event.
 *
 * §188: all resolution calls in ChannelCredentialsService and SigningCertificatesService
 * emit a CredentialAccessEvent here so there is a tamper-evident record of WHO accessed
 * WHAT credential and WITH WHAT OUTCOME — without ever logging a decrypted secret.
 *
 * SECURITY: the `emit` method must never receive or log:
 *   - Decrypted config values (clientSecret, apiKey, password, PFX bytes, private keys).
 *   - Plain-text passwords.
 *   - Raw encrypted blobs.
 * Only metadata (companyId, credentialRef, action, outcome) is permitted here.
 */

import { Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Every action that touches a stored credential or signing certificate. */
export type CredentialAccessAction =
  | 'RESOLVE'           // single-env credential lookup
  | 'RESOLVE_ACTIVE'    // active-env credential lookup
  | 'UPLOAD'            // new credential or cert uploaded
  | 'DEACTIVATE'        // credential or cert deactivated (soft-delete)
  | 'DELETE'            // hard delete
  | 'ROTATE';           // re-encrypt under new key / replace cert

/** Outcome of the action. */
export type CredentialAccessOutcome = 'HIT' | 'MISS' | 'ERROR';

export interface CredentialAccessEvent {
  /** The company the credential belongs to. */
  companyId: string;
  /**
   * Opaque reference to the specific credential:
   *   - Channel credentials: `{providerId}:{environment}` (e.g. "pdp:TEST")
   *   - Signing certs: `{certId}` or `{companyId}:{applicability}:{environment}`
   *
   * MUST NOT contain any secret values.
   */
  credentialRef: string;
  action: CredentialAccessAction;
  outcome: CredentialAccessOutcome;
  /** ISO 8601 timestamp at the moment of emission. */
  timestamp: string;
  /** Optional structured context (never secret values). */
  context?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

/**
 * Singleton-friendly audit emitter.  Instantiate once and inject where needed.
 *
 * In production the events are logged via NestJS Logger (structured JSON).
 * In tests, call `capture()` to intercept events without touching the logger.
 */
export class CredentialAccessAudit {
  private readonly logger = new Logger('CredentialAudit');

  /**
   * Optional override for tests — when set, events are pushed here instead of
   * (not in addition to) the logger.
   */
  private _capture: CredentialAccessEvent[] | null = null;

  // ---------------------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------------------

  emit(event: CredentialAccessEvent): void {
    if (this._capture !== null) {
      this._capture.push(event);
      return;
    }
    // SECURITY: log only the event object — never a raw credential value.
    // The structured log format makes it easy to ship to SIEM/audit store.
    this.logger.log(JSON.stringify(event), 'CredentialAccessAudit');
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /** Start capturing events into an array (returns a disposable). */
  capture(): CredentialAccessEvent[] {
    this._capture = [];
    return this._capture;
  }

  /** Stop capturing and clear the internal buffer. */
  stopCapture(): void {
    this._capture = null;
  }
}

/** Process-singleton used by the credential services (can be replaced in tests). */
export const credentialAudit = new CredentialAccessAudit();
