/**
 * Streaming AES-256-GCM for backup artifacts — the encryption this whole module was missing:
 * `backup-destination.ts#upload` used to `PutObjectCommand` a file's raw bytes straight into the
 * destination bucket. Anyone holding `BACKUP_S3_*` credentials (a leaked access key, not a stolen
 * disk — the provider's own server-side encryption already covers the disk) could read every backed
 * up document outright. Every artifact this module uploads now passes through
 * `createBackupEncryptStream()` first; nothing written to `BACKUP_S3_BUCKET` is ever plaintext again.
 *
 * ## Same algorithm and env-var convention as `utils/secret-crypto.ts`, a DIFFERENT key
 * `secret-crypto.ts` already established AES-256-GCM and "hex-64 or base64, must decode to exactly
 * 32 bytes" as this codebase's convention for an application-managed encryption key — reused here
 * verbatim rather than inventing a second convention for the same problem. What is deliberately NOT
 * reused is `CREDENTIALS_ENCRYPTION_KEY` itself: `BACKUP_ENCRYPTION_KEY` is its own, separate secret.
 * The key-parsing logic below is a small, deliberate duplication of `secret-crypto.ts#resolveKey`
 * rather than an import from it — this module and the credentials module protect different things
 * with different lifetimes and different operators, and importing across that boundary would tie
 * backup key resolution to a file another workstream may change for credentials-only reasons.
 *
 * Two independent keys, on purpose:
 * - **Different blast radius.** `CREDENTIALS_ENCRYPTION_KEY` decrypts every company's live channel
 *   credentials (KSeF/PDP/SdI tokens) — a key an attacker wants in order to act as this instance
 *   RIGHT NOW. `BACKUP_ENCRYPTION_KEY` decrypts historical file backups — a key an attacker wants in
 *   order to read PAST documents. Sharing one key would mean a credentials leak also exposes every
 *   backup ever taken, and a backup-key leak (e.g. an ex-operator who had bucket+key access for a
 *   restore drill) would also expose the running instance's live credentials.
 * - **Different lifetime, and this is the operational reason that matters most.** An operator
 *   restoring a backup onto a BRAND NEW instance — the entire scenario an off-site backup exists
 *   for, i.e. the original instance and its own `.env` are gone — must be able to decrypt it with
 *   nothing but this key and the artifact. If backups were encrypted under `CREDENTIALS_ENCRYPTION_KEY`
 *   instead, restoring would require also recovering the OLD instance's credentials key, coupling two
 *   secrets that have no reason to travel together. `BACKUP_ENCRYPTION_KEY` is meant to be stored
 *   wherever the operator keeps disaster-recovery material — deliberately NOT only inside the
 *   Kubernetes Secret the running instance itself reads from — see
 *   `documentation/docs/user-guide/backups.md`'s own "Restoring" section.
 * - Rotating one must never force rotating the other: rotating `CREDENTIALS_ENCRYPTION_KEY` (a
 *   credential-leak response) does not invalidate a single already-written backup, and rotating
 *   `BACKUP_ENCRYPTION_KEY` does not touch how the running app talks to its channel providers.
 *
 * ## Missing key: FAIL the run loudly, never disable the module and never upload in the clear
 * `secret-crypto.ts`'s own convention for a missing `CREDENTIALS_ENCRYPTION_KEY` is to fail SILENTLY
 * — `isEncryptionAvailable()` returns false and the whole channel-credentials feature just quietly
 * stops working, on purpose, because losing that key is recoverable (re-enter the credentials) and
 * the feature itself is optional. Neither is true here: a backup exists specifically so disaster
 * recovery works, so a backup module that goes silently inert IS the disaster nobody notices until
 * the day they need a restore. `createBackupEncryptStream()`/`createBackupDecryptStream()` therefore
 * both THROW when the key is missing/invalid, and `backup-runner.ts` checks
 * `isBackupEncryptionAvailable()` before enumerating a single source, failing the ENTIRE sweep with
 * one clear, named error (surfaced as a FAILED run in `GET /api/backup/status`) rather than either
 * silently uploading plaintext or leaving an operator to notice 40 identical per-file errors.
 *
 * ## Format: `[12-byte IV][ciphertext][16-byte tag]`, one AES-256-GCM invocation per artifact
 * A purpose-built chunked/segmented AEAD format (age, libsodium's `secretstream`, the AWS Encryption
 * SDK) authenticates the plaintext in independent segments, so a decrypting reader never needs the
 * LAST bytes of the file before it can start and a truncated stream is caught mid-way rather than
 * only at the very end. That complexity is worth it for a stream of unbounded, unknown-in-advance
 * size. It was not worth a new dependency here: every artifact this module ever encrypts is either
 * one already content-hash-addressed document file (`backup-runner.ts`'s own header — kilobytes to
 * low tens of megabytes in practice) or a single database dump (see this file's own CLI, used for the
 * hand-run `pg_dump | gzip` procedure `documentation/docs/user-guide/backups.md` documents) — nowhere
 * near AES-GCM's ~64 GiB single-invocation limit for a 96-bit IV. Node's own `crypto` module already
 * hands out `Cipheriv`/`Decipheriv` as `stream.Transform` instances, so the CRYPTOGRAPHY streams for
 * free; the only hand-rolled part below is this trivial three-field framing (a fixed-size header, a
 * fixed-size trailer), not the primitive itself. A truncated artifact is still caught: `_flush` below
 * rejects unless it collected exactly `TAG_LEN` trailing bytes, and `decipher.final()` itself throws
 * on a tag that does not authenticate — Node requires `setAuthTag()` before `final()` but NOT before
 * `update()`, which is exactly what makes streaming decryption possible without buffering the whole
 * ciphertext: only the final `TAG_LEN` bytes are ever held back, decided by looking at what has NOT
 * yet arrived, not at the whole artifact's length.
 */
import { createCipheriv, createDecipheriv, type DecipherGCM, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96 bits — recommended for GCM, same as `secret-crypto.ts`
const TAG_LEN = 16; // 128-bit auth tag

/** Every encrypted object is exactly this many bytes larger than its plaintext — a fixed IV prefix
 *  plus a fixed tag suffix, no padding (GCM is a stream cipher under the hood). `backup-runner.ts`'s
 *  own incremental size-diff needs this to compare a source file's plaintext size against the
 *  CIPHERTEXT size already sitting at the destination. */
export const BACKUP_ENCRYPTION_OVERHEAD_BYTES = IV_LEN + TAG_LEN;

function resolveBackupKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) return null;

  // Accept hex (64 chars) or base64 (44 chars raw) — identical acceptance rule to
  // `secret-crypto.ts#resolveKey`, deliberately duplicated rather than imported (see this file's own
  // header on why the two modules do not share code across that boundary).
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }
  if (buf.length !== 32) return null;
  return buf;
}

/** Gate for `backup-runner.ts` to check ONCE, before enumerating any source — see this file's own
 *  header on why a missing key fails the whole sweep loudly instead of disabling the module. */
export function isBackupEncryptionAvailable(): boolean {
  return resolveBackupKey() !== null;
}

function requireBackupKey(): Buffer {
  const key = resolveBackupKey();
  if (!key) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY is missing or invalid (must be 32 bytes, hex or base64) — refusing to ' +
        'read/write backup artifacts in the clear. Generate one with: openssl rand -hex 32 — and store ' +
        'it somewhere that survives the loss of THIS instance: losing this key loses every backup ' +
        'encrypted with it, permanently (see documentation/docs/user-guide/backups.md).',
    );
  }
  return key;
}

/**
 * A `Transform` that turns a plaintext byte stream into `[iv][ciphertext][tag]`. The IV is generated
 * once, per call, and prefixed to the FIRST chunk of output (or emitted alone in `_flush` for a
 * zero-byte input — an empty backup file is still a valid file). Never buffers more than the one
 * chunk it was just handed — `cipher.update()` returns exactly the ciphertext for that chunk.
 */
export function createBackupEncryptStream(): Transform {
  const key = requireBackupKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  let headerSent = false;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const parts: Buffer[] = [];
        if (!headerSent) {
          parts.push(iv);
          headerSent = true;
        }
        parts.push(cipher.update(chunk));
        callback(null, Buffer.concat(parts));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        const parts: Buffer[] = [];
        if (!headerSent) {
          parts.push(iv); // a zero-byte source still yields a well-formed [iv][][tag] artifact
          headerSent = true;
        }
        parts.push(cipher.final());
        parts.push(cipher.getAuthTag());
        callback(null, Buffer.concat(parts));
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/**
 * The inverse of `createBackupEncryptStream()` — reads `[iv][ciphertext][tag]` and yields plaintext.
 * Holds back at most `TAG_LEN` (16) bytes at any given time (the "is this the tag yet?" window): every
 * byte received beyond that trailing window is immediately decrypted and pushed downstream, so this
 * never buffers more than one input chunk plus 16 bytes regardless of the artifact's total size.
 * `decipher.setAuthTag()` is called only once the source has ended and the true trailing 16 bytes are
 * known — Node allows that any time before `final()`, which is what makes this streamable at all
 * (contrast with `secret-crypto.ts#decryptJson`, which can only afford to read the whole blob first
 * because it is never more than a few kilobytes of JSON).
 */
export function createBackupDecryptStream(): Transform {
  const key = requireBackupKey();
  let ivBuffer = Buffer.alloc(0);
  // Typed `DecipherGCM` explicitly (not `ReturnType<typeof createDecipheriv>`, which resolves to the
  // generic `Decipher` overload and loses `setAuthTag`) — `createDecipheriv` is called below with a
  // literal `'aes-256-gcm'` and an `authTagLength` option, which is what selects the GCM overload at
  // the actual call site.
  let decipher: DecipherGCM | null = null;
  let tail = Buffer.alloc(0); // the last <=TAG_LEN bytes seen so far, not yet known to be ciphertext

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        let data = chunk;
        if (!decipher) {
          ivBuffer = Buffer.concat([ivBuffer, data]);
          if (ivBuffer.length < IV_LEN) {
            callback(); // still gathering the IV header — nothing to emit yet
            return;
          }
          const iv = ivBuffer.subarray(0, IV_LEN);
          decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
          data = ivBuffer.subarray(IV_LEN);
        }

        const combined = Buffer.concat([tail, data]);
        if (combined.length <= TAG_LEN) {
          // Everything received so far could still turn out to be the trailing tag — hold it all.
          tail = combined;
          callback();
          return;
        }
        const ciphertext = combined.subarray(0, combined.length - TAG_LEN);
        tail = combined.subarray(combined.length - TAG_LEN);
        callback(null, decipher.update(ciphertext));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        if (!decipher) {
          callback(new Error('backup artifact is shorter than its IV header — corrupt or truncated'));
          return;
        }
        if (tail.length !== TAG_LEN) {
          callback(new Error('backup artifact is missing its authentication tag — corrupt or truncated'));
          return;
        }
        decipher.setAuthTag(tail);
        // Throws on a tampered ciphertext or a wrong key — GCM's whole point, never swallowed here.
        callback(null, decipher.final());
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}
