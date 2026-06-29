/**
 * Webhook authenticity helpers.
 *
 * Provides per-channel HMAC-SHA256 signature verification + optional IP allowlist,
 * replacing the coarse shared-secret gate in the inbound webhook controller.
 *
 * Config (environment variables):
 *   WEBHOOK_SECRET_PDP      — HMAC secret for PDP webhooks
 *   WEBHOOK_SECRET_SDI      — HMAC secret for SdI notifica webhooks
 *   WEBHOOK_SECRET_PEPPOL   — HMAC secret for Peppol MLR webhooks
 *   WEBHOOK_SECRET_GENERIC  — HMAC secret for generic inbound webhooks
 *   COMPLIANCE_WEBHOOK_SECRET — legacy fallback (used when no per-channel secret set)
 *   WEBHOOK_ALLOWLIST_PDP      — comma-separated exact IPs for PDP (e.g. "1.2.3.4,5.6.7.8")
 *   WEBHOOK_ALLOWLIST_SDI      — comma-separated exact IPs for SdI
 *   WEBHOOK_ALLOWLIST_PEPPOL   — comma-separated exact IPs for Peppol
 *
 * Signature scheme:
 *   Header: X-Signature: sha256=<lowercase_hex_digest>
 *   HMAC is computed over the raw request body bytes (not the JSON-parsed object).
 *
 * Never log secrets.
 */

import * as crypto from 'crypto';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

const logger = new Logger('WebhookAuth');

// Track which channels have already emitted the "no secret" warning to avoid log spam.
const warnedChannels = new Set<string>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function channelSecret(channel: string): string | undefined {
  const key = channel.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[`WEBHOOK_SECRET_${key}`] ?? process.env.COMPLIANCE_WEBHOOK_SECRET;
}

function channelAllowlist(channel: string): string[] {
  const key = channel.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const raw = process.env[`WEBHOOK_ALLOWLIST_${key}`];
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Exported primitives (used in tests)
// ---------------------------------------------------------------------------

/**
 * Verify an HMAC-SHA256 signature header against a payload buffer.
 *
 * @param payload  Raw request body bytes.
 * @param sigHeader  Value of the X-Signature header (e.g. "sha256=abc123...").
 * @param secret   HMAC secret.
 * @returns true if signature is valid, false otherwise (never throws).
 */
export function verifyHmacSignature(payload: Buffer, sigHeader: string, secret: string): boolean {
  if (!sigHeader.startsWith('sha256=')) return false;
  const theirHex = sigHeader.slice(7);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  // Both buffers must have equal length for timingSafeEqual; guard against malformed input.
  if (theirHex.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(theirHex, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Check whether a remote IP is in an allowlist.
 * Supports exact IPv4/IPv6 matching only (no CIDR expansion).
 * An empty allowlist means "allow all".
 */
export function isIpAllowed(remoteIp: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.includes(remoteIp);
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

export interface WebhookAuthOpts {
  /** Channel identifier, e.g. "PDP", "SDI", "PEPPOL", "GENERIC". */
  channel: string;
  /** Raw request body bytes — used for HMAC computation. */
  rawBody: Buffer;
  /** Value of the X-Signature header, if present. */
  signatureHeader?: string;
  /** Value of the X-Compliance-Secret header (legacy shared-secret), if present. */
  sharedSecretHeader?: string;
  /** Remote IP of the caller (used for allowlist check). */
  remoteIp?: string;
}

/**
 * Assert webhook authenticity. Throws HTTP 403 on failure.
 *
 * Priority:
 *   1. IP allowlist checked independently (first, cheapest).
 *   2. If a per-channel or global secret is configured:
 *      a. X-Signature present → HMAC-SHA256 verification (constant-time).
 *      b. X-Signature absent, X-Compliance-Secret present → shared-secret compare.
 *      c. Neither present → reject 403.
 *   3. No secret configured at all → allow (backward-compat) + log warning once per channel.
 */
export function assertWebhookAuth(opts: WebhookAuthOpts): void {
  const { channel, rawBody, signatureHeader, sharedSecretHeader, remoteIp } = opts;

  // --- IP allowlist (independent of signature) ---
  const allowlist = channelAllowlist(channel);
  if (allowlist.length > 0) {
    const ip = remoteIp ?? '';
    if (!isIpAllowed(ip, allowlist)) {
      // Do not log the IP to avoid PII concerns; just reject.
      throw new HttpException(`Forbidden: IP not in allowlist for channel ${channel}`, HttpStatus.FORBIDDEN);
    }
  }

  // --- Secret / signature ---
  const secret = channelSecret(channel);

  if (!secret) {
    // No secret configured: backward-compat, log once per channel.
    if (!warnedChannels.has(channel)) {
      logger.warn(
        `[${channel}] No webhook secret configured ` +
        `(WEBHOOK_SECRET_${channel.toUpperCase()} or COMPLIANCE_WEBHOOK_SECRET). ` +
        `Accepting without signature verification — configure a secret in production.`,
      );
      warnedChannels.add(channel);
    }
    return;
  }

  // HMAC path (preferred)
  if (signatureHeader) {
    if (!verifyHmacSignature(rawBody, signatureHeader, secret)) {
      throw new HttpException('Forbidden: invalid webhook signature', HttpStatus.FORBIDDEN);
    }
    return;
  }

  // Legacy shared-secret fallback
  if (sharedSecretHeader) {
    // Constant-time compare to prevent timing attacks even on the legacy path.
    const secretBuf = Buffer.from(secret, 'utf-8');
    const providedBuf = Buffer.from(sharedSecretHeader, 'utf-8');
    const match =
      secretBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(secretBuf, providedBuf);
    if (!match) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return;
  }

  // Neither header present
  throw new HttpException('Forbidden: missing X-Signature or X-Compliance-Secret header', HttpStatus.FORBIDDEN);
}
