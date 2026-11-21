import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FieldCipher,
  FieldDecryptionError,
  ciphertextKeyId,
  companyIndexScope,
  fieldAad,
  globalIndexScope,
  isFieldCiphertext,
  normalizeForIndex,
} from './field-cipher';

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const indexKey = randomBytes(32);
const cell = { model: 'ClientContact', column: 'email', id: 'row-1' };

function cipher(current = 'k1', keys: [string, Buffer][] = [['k1', k1]]): FieldCipher {
  return new FieldCipher(new Map(keys), current, indexKey);
}

describe('FieldCipher envelope', () => {
  it('round-trips and writes the v1.keyId.iv.ct.tag format', () => {
    const ct = cipher().encrypt('ada@example.com', cell);
    expect(ct.split('.')).toHaveLength(5);
    expect(ct.startsWith('v1.k1.')).toBe(true);
    expect(isFieldCiphertext(ct)).toBe(true);
    expect(ct).not.toContain('ada');
    expect(cipher().decrypt(ct, cell)).toBe('ada@example.com');
  });

  it('uses a fresh IV: the same value never encrypts twice to the same ciphertext', () => {
    const c = cipher();
    expect(c.encrypt('same', cell)).not.toBe(c.encrypt('same', cell));
  });

  it('round-trips the empty string and multi-byte text', () => {
    const c = cipher();
    expect(c.decrypt(c.encrypt('', cell), cell)).toBe('');
    expect(c.decrypt(c.encrypt('Zoë Łukasz 東京 🧾', cell), cell)).toBe('Zoë Łukasz 東京 🧾');
  });

  it('rejects a ciphertext moved to another row', () => {
    const c = cipher();
    const ct = c.encrypt('ada@example.com', cell);
    expect(() => c.decrypt(ct, { ...cell, id: 'row-2' })).toThrow(FieldDecryptionError);
  });

  it('rejects a ciphertext moved to another column or model', () => {
    const c = cipher();
    const ct = c.encrypt('ada@example.com', cell);
    expect(() => c.decrypt(ct, { ...cell, column: 'phone' })).toThrow(/moved from another row or column/);
    expect(() => c.decrypt(ct, { ...cell, model: 'User' })).toThrow(FieldDecryptionError);
  });

  it('rejects a tampered ciphertext', () => {
    const c = cipher();
    const parts = c.encrypt('ada@example.com', cell).split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 1;
    parts[3] = ct.toString('base64url');
    expect(() => c.decrypt(parts.join('.'), cell)).toThrow(FieldDecryptionError);
  });

  it('refuses plaintext and unknown key ids on read', () => {
    const c = cipher();
    expect(() => c.decrypt('ada@example.com', cell)).toThrow(/does not hold a v1 field ciphertext/);
    const foreign = cipher('k2', [['k2', k2]]).encrypt('x', cell);
    expect(() => c.decrypt(foreign, cell)).toThrow(/key "k2", which is not loaded/);
  });

  it('refuses a current key id that is not loaded, and keys of the wrong size', () => {
    expect(() => new FieldCipher(new Map([['k1', k1]]), 'k2', indexKey)).toThrow(/not loaded/);
    expect(() => new FieldCipher(new Map([['k1', randomBytes(16)]]), 'k1', indexKey)).toThrow(/16 bytes/);
    expect(() => new FieldCipher(new Map([['k1', k1]]), 'k1', randomBytes(16))).toThrow(/Blind index key/);
  });
});

describe('FieldCipher rotation', () => {
  it('reads old-key rows after rotation and re-encrypts them with the current key', () => {
    const before = cipher('k1', [['k1', k1]]).encrypt('FR7630006000011234567890189', cell);
    const after = cipher('k2', [
      ['k2', k2],
      ['k1', k1],
    ]);
    expect(after.needsRotation(before)).toBe(true);
    const rotated = after.reEncrypt(before, cell);
    expect(ciphertextKeyId(rotated)).toBe('k2');
    expect(after.needsRotation(rotated)).toBe(false);
    expect(after.decrypt(rotated, cell)).toBe('FR7630006000011234567890189');
    expect(after.reEncrypt(rotated, cell)).toBe(rotated);
  });

  it('does not flag plaintext as needing rotation', () => {
    expect(cipher().needsRotation('plain')).toBe(false);
    expect(ciphertextKeyId('plain')).toBeNull();
  });
});

describe('FieldCipher blind index', () => {
  it('matches equal values after normalisation', () => {
    const c = cipher();
    const scope = companyIndexScope('company-a', 'ClientContact', 'email');
    expect(c.blindIndex(' Ada@Example.COM ', scope)).toBe(c.blindIndex('ada@example.com', scope));
    expect(c.blindIndex('ada@example.com', scope)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives two companies different indexes for the same customer email', () => {
    const c = cipher();
    const a = c.blindIndex('ada@example.com', companyIndexScope('company-a', 'ClientContact', 'email'));
    const b = c.blindIndex('ada@example.com', companyIndexScope('company-b', 'ClientContact', 'email'));
    expect(a).not.toBe(b);
  });

  it('keeps one global index for User.email whatever the company', () => {
    const c = cipher();
    const scope = globalIndexScope('User', 'email');
    expect(scope).toBe('global:User.email');
    expect(c.blindIndex('ada@example.com', scope)).toBe(c.blindIndex('ADA@example.com', scope));
    expect(c.blindIndex('ada@example.com', scope)).not.toBe(
      c.blindIndex('ada@example.com', companyIndexScope('company-a', 'User', 'email')),
    );
  });

  it('does not depend on the data key: rotating it keeps every index', () => {
    const scope = companyIndexScope('company-a', 'Client', 'name');
    const before = cipher('k1', [['k1', k1]]).blindIndex('Acme', scope);
    const after = cipher('k2', [['k2', k2]]).blindIndex('Acme', scope);
    expect(after).toBe(before);
  });

  it('normalises Unicode compatibility forms and inner whitespace', () => {
    expect(normalizeForIndex('  ＡＣＭＥ   Corp\t')).toBe('acme corp');
  });
});

describe('FieldCipher key handling', () => {
  it('copies keys on construction and wipes its own copies on destroy', () => {
    const source = Buffer.from(k1);
    const c = new FieldCipher(new Map([['k1', source]]), 'k1', Buffer.from(indexKey));
    source.fill(0);
    const ct = c.encrypt('still works', cell);
    expect(c.decrypt(ct, cell)).toBe('still works');
    c.destroy();
    expect(() => c.encrypt('x', cell)).toThrow(/wiped/);
    expect(() => c.blindIndex('x', 'scope')).toThrow(/wiped/);
  });
});

describe('scopes and AAD', () => {
  it('builds Model.column.id and refuses unsafe names or a missing id', () => {
    expect(fieldAad(cell)).toBe('ClientContact.email.row-1');
    expect(() => fieldAad({ ...cell, column: 'email.id' })).toThrow(/Invalid column/);
    expect(() => fieldAad({ ...cell, id: '' })).toThrow(/row id/);
    expect(() => companyIndexScope('', 'Client', 'name')).toThrow(/company id/);
  });
});
