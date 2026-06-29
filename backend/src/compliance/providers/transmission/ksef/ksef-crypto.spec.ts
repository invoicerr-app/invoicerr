import { generateKeyPairSync } from 'crypto';
import {
  encryptKsefToken,
  generateSessionKey,
  encryptSymmetricKey,
  encryptXmlContent,
  sha256base64,
} from './ksef-crypto';

// Generate a test RSA key pair for round-trip tests
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('KSeF crypto helpers', () => {
  describe('encryptKsefToken', () => {
    it('produces a base64 string that decrypts to "{token}|{timestampMs}"', () => {
      const { privateDecrypt } = require('crypto');
      const token = 'test-ksef-token-abc123';
      const timestampMs = 1719600000000;

      const encrypted = encryptKsefToken(token, timestampMs, publicKey);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);

      // Decrypt and verify
      const decrypted = privateDecrypt(
        { key: privateKey, padding: 4, oaepHash: 'sha256' },
        Buffer.from(encrypted, 'base64'),
      );
      expect(decrypted.toString('utf8')).toBe(`${token}|${timestampMs}`);
    });

    it('produces different output for different timestamps', () => {
      const enc1 = encryptKsefToken('token', 1000, publicKey);
      const enc2 = encryptKsefToken('token', 2000, publicKey);
      expect(enc1).not.toBe(enc2);
    });
  });

  describe('generateSessionKey', () => {
    it('returns 32-byte key and 16-byte IV', () => {
      const key = generateSessionKey();
      expect(key.aesKey).toHaveLength(32);
      expect(key.iv).toHaveLength(16);
    });

    it('generates different keys each time', () => {
      const k1 = generateSessionKey();
      const k2 = generateSessionKey();
      expect(k1.aesKey.equals(k2.aesKey)).toBe(false);
    });
  });

  describe('encryptSymmetricKey', () => {
    it('produces a base64 string', () => {
      const key = Buffer.alloc(32, 0xab);
      const encrypted = encryptSymmetricKey(key, publicKey);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
    });
  });

  describe('encryptXmlContent', () => {
    it('round-trips via decrypt', () => {
      const { createDecipheriv } = require('crypto');
      const xml = '<?xml version="1.0"?><Faktura>test</Faktura>';
      const aesKey = Buffer.alloc(32, 0x42);
      const iv = Buffer.alloc(16, 0x24);

      const encrypted = encryptXmlContent(xml, aesKey, iv);
      expect(typeof encrypted).toBe('string');

      // Decrypt
      const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]);
      expect(decrypted.toString('utf8')).toBe(xml);
    });

    it('produces different ciphertext for different keys', () => {
      const xml = '<test>data</test>';
      const enc1 = encryptXmlContent(xml, Buffer.alloc(32, 1), Buffer.alloc(16, 1));
      const enc2 = encryptXmlContent(xml, Buffer.alloc(32, 2), Buffer.alloc(16, 2));
      expect(enc1).not.toBe(enc2);
    });
  });

  describe('sha256base64', () => {
    it('returns 44-char base64 string (SHA-256 = 32 bytes)', () => {
      const hash = sha256base64('hello world');
      expect(typeof hash).toBe('string');
      // 32 bytes → 44 base64 chars (with padding)
      expect(hash.length).toBeGreaterThanOrEqual(43);
      expect(hash.length).toBeLessThanOrEqual(44);
    });

    it('is deterministic', () => {
      expect(sha256base64('test')).toBe(sha256base64('test'));
    });

    it('differs for different inputs', () => {
      expect(sha256base64('a')).not.toBe(sha256base64('b'));
    });

    it('handles Buffer input', () => {
      const fromString = sha256base64('data');
      const fromBuffer = sha256base64(Buffer.from('data'));
      expect(fromString).toBe(fromBuffer);
    });
  });
});
