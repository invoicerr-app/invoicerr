/**
 * Pure unit coverage for `backup-crypto.ts` — no S3, no network, no MinIO (see
 * `backup-destination.live.spec.ts` for the real round-trip that also proves the S3 leg). This file's
 * job is the crypto primitive and its streaming framing in isolation: round-trips, tamper detection,
 * key handling, and evidence that encryption never buffers a whole artifact.
 */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  BACKUP_ENCRYPTION_OVERHEAD_BYTES,
  createBackupDecryptStream,
  createBackupEncryptStream,
  isBackupEncryptionAvailable,
} from './backup-crypto';

const VALID_KEY_HEX = '3'.repeat(64); // 64 hex chars — decodes to exactly 32 bytes
const originalKey = process.env.BACKUP_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
  else process.env.BACKUP_ENCRYPTION_KEY = originalKey;
});

async function encrypt(plaintext: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const encrypted = Readable.from(plaintext).pipe(createBackupEncryptStream());
  for await (const chunk of encrypted) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function decrypt(ciphertext: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const decrypted = Readable.from(ciphertext).pipe(createBackupDecryptStream());
  for await (const chunk of decrypted) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Feeds `data` through the encrypt/decrypt Transforms in chunks of `chunkSize` bytes — deliberately
 *  smaller than `BACKUP_ENCRYPTION_OVERHEAD_BYTES` (28) in some tests, to exercise the "is this the IV
 *  header / trailing tag yet?" buffering logic across many small `_transform` calls rather than one
 *  convenient whole-buffer call. */
async function* chunksOf(data: Buffer, chunkSize: number): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    yield data.subarray(offset, Math.min(offset + chunkSize, data.length));
  }
}

describe('backup/backup-crypto', () => {
  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY = VALID_KEY_HEX;
  });

  describe('isBackupEncryptionAvailable', () => {
    it('is true for a valid 64-char hex key', () => {
      expect(isBackupEncryptionAvailable()).toBe(true);
    });

    it('is true for a valid base64-encoded 32-byte key', () => {
      process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
      expect(isBackupEncryptionAvailable()).toBe(true);
    });

    it('is false when unset', () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      expect(isBackupEncryptionAvailable()).toBe(false);
    });

    it('is false for a key that does not decode to exactly 32 bytes', () => {
      process.env.BACKUP_ENCRYPTION_KEY = 'deadbeef'; // valid hex, only 4 bytes
      expect(isBackupEncryptionAvailable()).toBe(false);
    });
  });

  describe('round-trip', () => {
    it('encrypts then decrypts an ordinary payload back to the exact original bytes', async () => {
      const plaintext = Buffer.from('a company document, or at least a stand-in for one');

      const ciphertext = await encrypt(plaintext);
      expect(ciphertext.length).toBe(plaintext.length + BACKUP_ENCRYPTION_OVERHEAD_BYTES);
      expect(ciphertext.subarray(12, 12 + plaintext.length)).not.toEqual(plaintext); // never in the clear

      await expect(decrypt(ciphertext)).resolves.toEqual(plaintext);
    });

    it('round-trips a zero-byte artifact — an empty file is still a valid file', async () => {
      const ciphertext = await encrypt(Buffer.alloc(0));
      expect(ciphertext.length).toBe(BACKUP_ENCRYPTION_OVERHEAD_BYTES);
      await expect(decrypt(ciphertext)).resolves.toEqual(Buffer.alloc(0));
    });

    it('produces a different ciphertext every time (a fresh random IV per artifact)', async () => {
      const plaintext = Buffer.from('same plaintext, twice');
      const [a, b] = await Promise.all([encrypt(plaintext), encrypt(plaintext)]);
      expect(a).not.toEqual(b);
      await expect(decrypt(a)).resolves.toEqual(plaintext);
      await expect(decrypt(b)).resolves.toEqual(plaintext);
    });

    it('round-trips correctly no matter how the ciphertext is chunked on the way in', async () => {
      const plaintext = randomBytes(10_000);
      const ciphertext = await encrypt(plaintext);

      for (const chunkSize of [1, 3, 11, 27, 28, 29, 4096]) {
        const decryptStream = createBackupDecryptStream();
        const out: Buffer[] = [];
        decryptStream.on('data', (chunk: Buffer) => out.push(chunk));
        await pipeline(Readable.from(chunksOf(ciphertext, chunkSize)), decryptStream);
        expect(Buffer.concat(out), `chunkSize=${chunkSize}`).toEqual(plaintext);
      }
    });
  });

  describe('tamper detection', () => {
    it('rejects a ciphertext whose auth tag was flipped', async () => {
      const ciphertext = await encrypt(Buffer.from('do not trust me'));
      ciphertext[ciphertext.length - 1] ^= 0xff; // corrupt the last byte of the trailing tag

      await expect(decrypt(ciphertext)).rejects.toThrow();
    });

    it('rejects a ciphertext whose body was flipped', async () => {
      const ciphertext = await encrypt(Buffer.from('do not trust me either'));
      ciphertext[15] ^= 0xff; // corrupt a byte inside the ciphertext body, past the IV header

      await expect(decrypt(ciphertext)).rejects.toThrow();
    });

    it('rejects decryption under the wrong key', async () => {
      const ciphertext = await encrypt(Buffer.from('encrypted under key A'));
      process.env.BACKUP_ENCRYPTION_KEY = '4'.repeat(64); // key B

      await expect(decrypt(ciphertext)).rejects.toThrow();
    });

    it('rejects an artifact truncated before a full IV header', async () => {
      const ciphertext = await encrypt(Buffer.from('x'));
      await expect(decrypt(ciphertext.subarray(0, 5))).rejects.toThrow(/IV header/);
    });

    it('rejects an artifact truncated to fewer bytes than IV + tag combined', async () => {
      const ciphertext = await encrypt(Buffer.from('needs its full 16-byte tag'));
      // Under `BACKUP_ENCRYPTION_OVERHEAD_BYTES` (28) total — there physically cannot be a full
      // 16-byte tag left once the 12-byte IV is accounted for, so this is caught structurally
      // (`tail.length !== TAG_LEN`) rather than by GCM's own authentication check.
      await expect(decrypt(ciphertext.subarray(0, 20))).rejects.toThrow(/authentication tag/);
    });

    it('rejects an artifact truncated by a few bytes off an otherwise well-formed tail', async () => {
      const ciphertext = await encrypt(Buffer.from('needs its full 16-byte tag'));
      // Long enough that the LAST 16 bytes received look like a well-formed tag structurally, but
      // they are not the real one — GCM's own tag check is what catches this, not the length guard.
      await expect(decrypt(ciphertext.subarray(0, ciphertext.length - 3))).rejects.toThrow();
    });
  });

  describe('missing/invalid key', () => {
    it('createBackupEncryptStream throws synchronously, before any data is processed', () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      expect(() => createBackupEncryptStream()).toThrow('BACKUP_ENCRYPTION_KEY');
    });

    it('createBackupDecryptStream throws synchronously, before any data is processed', () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      expect(() => createBackupDecryptStream()).toThrow('BACKUP_ENCRYPTION_KEY');
    });
  });

  describe('streaming — never buffers the whole artifact', () => {
    it('emits many small chunks for a large source instead of one chunk the size of the whole input', async () => {
      const chunkSize = 64 * 1024; // 64 KiB per generated chunk
      const chunkCount = 200; // 12.5 MiB total — comfortably "large" without slowing the suite down
      let produced = 0;

      // Generates data ON DEMAND — this generator itself never holds more than one 64 KiB chunk,
      // which is the point: if `createBackupEncryptStream()` buffered the whole artifact before
      // producing output, this test would have to wait for all 12.5 MiB to be generated up front
      // instead of seeing output arrive incrementally.
      async function* generate() {
        while (produced < chunkCount) {
          produced += 1;
          yield randomBytes(chunkSize);
        }
      }

      let emittedChunks = 0;
      let emittedBytes = 0;
      let largestSingleChunk = 0;
      const encryptStream = createBackupEncryptStream();
      encryptStream.on('data', (chunk: Buffer) => {
        emittedChunks += 1;
        emittedBytes += chunk.length;
        largestSingleChunk = Math.max(largestSingleChunk, chunk.length);
      });

      await pipeline(Readable.from(generate()), encryptStream);

      const totalPlaintextBytes = chunkCount * chunkSize;
      expect(emittedBytes).toBe(totalPlaintextBytes + BACKUP_ENCRYPTION_OVERHEAD_BYTES);
      // The real evidence: MANY output chunks, each close to the input chunk size — never one chunk
      // anywhere near the total artifact size, which is what "buffered whole, then emitted once"
      // would look like.
      expect(emittedChunks).toBeGreaterThan(50);
      expect(largestSingleChunk).toBeLessThan(totalPlaintextBytes / 10);
    });
  });
});
