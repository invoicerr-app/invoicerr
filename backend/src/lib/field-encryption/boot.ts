import { type FieldEncryptionConfig, type OkmsSettings, parseFieldEncryptionConfig } from './config';
import { FieldCipher } from './field-cipher';
import { OkmsClient } from './okms-client';

export interface EncryptedColumn {
  table: string;
  column: string;
}

/** SQL table and column names that hold field ciphertext. Grows as each scope is migrated. */
export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [];

export class FieldEncryptionBootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldEncryptionBootError';
  }
}

export interface KeyUnwrapper {
  unwrapDataKey(wrapped: string): Promise<Buffer>;
}

export interface FieldEncryptionBootDeps {
  env?: Record<string, string | undefined>;
  fileExists?: (path: string) => boolean;
  createKms?: (settings: OkmsSettings) => KeyUnwrapper;
  /** Counts stored ciphertext in the given columns. Only called when field encryption is off. */
  countCiphertext?: (columns: readonly EncryptedColumn[]) => Promise<number>;
  encryptedColumns?: readonly EncryptedColumn[];
  log?: { log(message: string): void; warn(message: string): void };
}

export interface FieldEncryptionState {
  cipher: FieldCipher | null;
  allowPlaintextRead: boolean;
}

let state: FieldEncryptionState = { cipher: null, allowPlaintextRead: false };

/** The in-memory cipher, or null when field encryption is off. */
export function getFieldCipher(): FieldCipher | null {
  return state.cipher;
}

export function isPlaintextReadAllowed(): boolean {
  return state.cipher === null || state.allowPlaintextRead;
}

export function resetFieldEncryptionForTests(): void {
  state.cipher?.destroy();
  state = { cipher: null, allowPlaintextRead: false };
}

/**
 * Applies the field encryption contract at boot. Off: no KMS call, but refuse to start while stored
 * ciphertext exists unless `FIELD_ENCRYPTION_FORCE_PLAINTEXT=true`. On: unwrap every key through the KMS
 * or refuse to start. Never returns in a state that would write plaintext while encryption is requested.
 */
export async function initFieldEncryption(deps: FieldEncryptionBootDeps = {}): Promise<FieldEncryptionState> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console;
  const config: FieldEncryptionConfig = parseFieldEncryptionConfig(env, deps.fileExists);

  if (!config.enabled) {
    await assertNoStoredCiphertext(config.forcePlaintext, deps, log);
    state.cipher?.destroy();
    state = { cipher: null, allowPlaintextRead: false };
    return state;
  }

  const kms = (deps.createKms ?? ((settings) => new OkmsClient(settings, { log: log.warn.bind(log) })))(
    config.okms,
  );
  const unwrap = async (label: string, wrapped: string): Promise<Buffer> => {
    try {
      return await kms.unwrapDataKey(wrapped);
    } catch (err) {
      throw new FieldEncryptionBootError(
        `Field encryption is enabled but ${label} could not be unwrapped through OKMS (${config.okms.endpoint}): ${(err as Error).message}. Refusing to start: without the data keys nothing can be encrypted or read.`,
      );
    }
  };

  const ids = [...config.wrappedFieldKeys.keys()];
  const unwrapped = await Promise.all([
    ...ids.map((id) => unwrap(`field key "${id}"`, config.wrappedFieldKeys.get(id)!)),
    unwrap('the blind index key', config.wrappedBlindIndexKey),
  ]);
  const blindIndexKey = unwrapped.pop()!;
  const keys = new Map(ids.map((id, i) => [id, unwrapped[i]]));

  let cipher: FieldCipher;
  try {
    cipher = new FieldCipher(keys, config.currentKeyId, blindIndexKey);
  } catch (err) {
    throw new FieldEncryptionBootError(
      `Field encryption keys returned by OKMS are unusable: ${(err as Error).message}`,
    );
  } finally {
    for (const key of [...keys.values(), blindIndexKey]) key.fill(0);
  }

  state.cipher?.destroy();
  state = { cipher, allowPlaintextRead: config.allowPlaintextRead };
  log.log(`Field encryption enabled: ${ids.length} data key(s) loaded, current key "${config.currentKeyId}"`);
  if (config.allowPlaintextRead) {
    log.warn(
      'ALLOW_PLAINTEXT_READ=true: plaintext values are still accepted on read. Use it only during the migration window, then remove it and restart.',
    );
  }
  return state;
}

async function assertNoStoredCiphertext(
  forcePlaintext: boolean,
  deps: FieldEncryptionBootDeps,
  log: NonNullable<FieldEncryptionBootDeps['log']>,
): Promise<void> {
  const columns = deps.encryptedColumns ?? ENCRYPTED_COLUMNS;
  if (forcePlaintext) {
    log.warn(
      'FIELD_ENCRYPTION_FORCE_PLAINTEXT=true: starting without field encryption even if ciphertext is stored.',
    );
    return;
  }
  if (columns.length === 0 || !deps.countCiphertext) return;
  const count = await deps.countCiphertext(columns);
  if (count > 0) {
    throw new FieldEncryptionBootError(
      `Field encryption is disabled but ${count} encrypted value(s) are stored in the database. Starting would serve ciphertext as data. Re-enable FIELD_ENCRYPTION_ENABLED with the same keys, or, only after decrypting every value, set FIELD_ENCRYPTION_FORCE_PLAINTEXT=true.`,
    );
  }
}

const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Builds the ciphertext probe. Identifiers come from `ENCRYPTED_COLUMNS` only, never from input. */
export function ciphertextCountSql(columns: readonly EncryptedColumn[]): string {
  return columns
    .map(({ table, column }) => {
      if (!SQL_IDENTIFIER_RE.test(table) || !SQL_IDENTIFIER_RE.test(column)) {
        throw new Error(`Invalid encrypted column identifier: ${table}.${column}`);
      }
      return `SELECT count(*)::int AS count FROM "${table}" WHERE "${column}" LIKE 'v1.%'`;
    })
    .join(' UNION ALL ');
}
