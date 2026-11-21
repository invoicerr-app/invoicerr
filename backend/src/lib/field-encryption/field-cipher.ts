import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const FORMAT_VERSION = 'v1';
const B64URL = '[A-Za-z0-9_-]';
const CIPHERTEXT_RE = new RegExp(
  `^v1\\.([A-Za-z0-9_-]{1,32})\\.(${B64URL}{16})\\.(${B64URL}*)\\.(${B64URL}{22})$`,
);
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class FieldDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldDecryptionError';
  }
}

export interface FieldLocation {
  model: string;
  column: string;
  id: string;
}

function assertIdentifier(kind: string, value: string): void {
  if (!IDENTIFIER_RE.test(value)) throw new Error(`Invalid ${kind} name for field encryption: "${value}"`);
}

/** Additional authenticated data `Model.column.id`: a ciphertext only decrypts in the cell it was written to. */
export function fieldAad({ model, column, id }: FieldLocation): string {
  assertIdentifier('model', model);
  assertIdentifier('column', column);
  if (!id) throw new Error('A field encryption AAD needs the row id');
  return `${model}.${column}.${id}`;
}

/** Blind index scope for a company-owned column: two companies never share an index value. */
export function companyIndexScope(companyId: string, model: string, column: string): string {
  if (!companyId) throw new Error('A company-scoped blind index needs the company id');
  assertIdentifier('model', model);
  assertIdentifier('column', column);
  return `${companyId}:${model}.${column}`;
}

/** Blind index scope shared by the whole instance. Reserved for `User.email`: one account spans companies. */
export function globalIndexScope(model: string, column: string): string {
  assertIdentifier('model', model);
  assertIdentifier('column', column);
  return `global:${model}.${column}`;
}

/** Equality-preserving normalisation: Unicode NFKC, trimmed, inner whitespace collapsed, lower case. */
export function normalizeForIndex(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isFieldCiphertext(value: unknown): value is string {
  return typeof value === 'string' && CIPHERTEXT_RE.test(value);
}

/** Key id of a ciphertext, or null when the value is not in the `v1.keyId.iv.ct.tag` format. */
export function ciphertextKeyId(value: string): string | null {
  return CIPHERTEXT_RE.exec(value)?.[1] ?? null;
}

/**
 * AES-256-GCM envelope for one field, plus the HMAC-SHA256 blind index. Holds unwrapped keys in memory
 * only; never imports Prisma so the persistence layer can change without touching the cryptography.
 */
export class FieldCipher {
  private readonly keys: Map<string, Buffer>;
  private readonly blindIndexKey: Buffer;
  private destroyed = false;

  constructor(
    keys: Map<string, Buffer>,
    readonly currentKeyId: string,
    blindIndexKey: Buffer,
  ) {
    if (!keys.has(currentKeyId)) throw new Error(`Current field key "${currentKeyId}" is not loaded`);
    for (const [id, key] of keys) {
      if (key.length !== KEY_LEN)
        throw new Error(`Field key "${id}" is ${key.length} bytes, ${KEY_LEN} expected`);
    }
    if (blindIndexKey.length < KEY_LEN) {
      throw new Error(`Blind index key is ${blindIndexKey.length} bytes, at least ${KEY_LEN} expected`);
    }
    this.keys = new Map([...keys].map(([id, key]) => [id, Buffer.from(key)]));
    this.blindIndexKey = Buffer.from(blindIndexKey);
  }

  get keyIds(): string[] {
    return [...this.keys.keys()];
  }

  encrypt(plaintext: string, location: FieldLocation): string {
    const key = this.key(this.currentKeyId);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
    cipher.setAAD(Buffer.from(fieldAad(location), 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      this.currentKeyId,
      iv.toString('base64url'),
      ct.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  decrypt(ciphertext: string, location: FieldLocation): string {
    const match = CIPHERTEXT_RE.exec(ciphertext);
    if (!match) throw new FieldDecryptionError(`${fieldAad(location)} does not hold a v1 field ciphertext`);
    const [, keyId, iv, ct, tag] = match;
    if (!this.keys.has(keyId)) {
      throw new FieldDecryptionError(
        `${fieldAad(location)} is encrypted with key "${keyId}", which is not loaded`,
      );
    }
    try {
      const decipher = createDecipheriv(ALGO, this.key(keyId), Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_LEN,
      });
      decipher.setAAD(Buffer.from(fieldAad(location), 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new FieldDecryptionError(
        `${fieldAad(location)} failed authentication: wrong key, tampered value, or a ciphertext moved from another row or column`,
      );
    }
  }

  /** True when the value is a ciphertext written with a key other than the current one. */
  needsRotation(ciphertext: string): boolean {
    const keyId = ciphertextKeyId(ciphertext);
    return keyId !== null && keyId !== this.currentKeyId;
  }

  /** Re-encrypts with the current key; returns the input unchanged when it already uses it. */
  reEncrypt(ciphertext: string, location: FieldLocation): string {
    if (!this.needsRotation(ciphertext)) {
      this.decrypt(ciphertext, location);
      return ciphertext;
    }
    return this.encrypt(this.decrypt(ciphertext, location), location);
  }

  /** Hex HMAC-SHA256 of the normalised value, bound to its scope. Use `companyIndexScope` or `globalIndexScope`. */
  blindIndex(value: string, scope: string): string {
    this.assertAlive();
    if (!scope) throw new Error('A blind index needs a scope');
    return createHmac('sha256', this.blindIndexKey)
      .update(scope, 'utf8')
      .update('\0')
      .update(normalizeForIndex(value), 'utf8')
      .digest('hex');
  }

  /** Zero-fills every key held in memory. The instance is unusable afterwards. */
  destroy(): void {
    for (const key of this.keys.values()) key.fill(0);
    this.blindIndexKey.fill(0);
    this.destroyed = true;
  }

  private key(id: string): Buffer {
    this.assertAlive();
    const key = this.keys.get(id);
    if (!key) throw new Error(`Field key "${id}" is not loaded`);
    return key;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('Field cipher keys have been wiped');
  }
}
