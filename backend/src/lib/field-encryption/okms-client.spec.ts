import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OkmsClient, OkmsError } from './okms-client';

interface Pem {
  cert: string;
  key: string;
}

function issue(
  subject: string,
  issuer: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } | null,
  extensions: object[],
): Pem & { forgeCert: forge.pki.Certificate; forgeKey: forge.pki.rsa.PrivateKey } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `0${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 3_600_000);
  const attrs = [{ name: 'commonName', value: subject }];
  cert.setSubject(attrs);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : attrs);
  cert.setExtensions(extensions);
  cert.sign(issuer ? issuer.key : keys.privateKey, forge.md.sha256.create());
  return {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey),
    forgeCert: cert,
    forgeKey: keys.privateKey,
  };
}

let dir: string;
let ca: Pem;
let server: Server;
let endpoint: string;
let certPath: string;
let keyPath: string;
let handler: (req: IncomingMessage, body: string, res: ServerResponse) => void;
let seenClientCn: string | undefined;

beforeAll(async () => {
  const caFull = issue('test-ca', null, [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true },
  ]);
  ca = caFull;
  const issuer = { cert: caFull.forgeCert, key: caFull.forgeKey };
  const serverCert = issue('localhost', issuer, [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ],
    },
    { name: 'extKeyUsage', serverAuth: true },
  ]);
  const clientCert = issue('invoicerr-test-client', issuer, [{ name: 'extKeyUsage', clientAuth: true }]);

  dir = mkdtempSync(join(tmpdir(), 'okms-client-spec-'));
  certPath = join(dir, 'client.crt');
  keyPath = join(dir, 'client.key');
  writeFileSync(certPath, clientCert.cert);
  writeFileSync(keyPath, clientCert.key);

  server = createServer(
    { cert: serverCert.cert, key: serverCert.key, ca: ca.cert, requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      seenClientCn = (req.socket as import('node:tls').TLSSocket).getPeerCertificate().subject?.CN as string;
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => handler(req, body, res));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}/api/okms-id`;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  seenClientCn = undefined;
});

function client(timeoutMs = 2000, attempts = 3): OkmsClient {
  return new OkmsClient(
    { endpoint, serviceKeyId: 'svc key', certPath, keyPath, timeoutMs },
    { ca: ca.cert, attempts, backoffMs: 1 },
  );
}

describe('OkmsClient', () => {
  it('unwraps a data key over mTLS with the service key in the path', async () => {
    const key = Buffer.alloc(32, 7);
    let seen: { method?: string; url?: string; body?: unknown } = {};
    handler = (req, body, res) => {
      seen = { method: req.method, url: req.url, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ plaintext: key.toString('base64') }));
    };
    await expect(client().unwrapDataKey('wrapped-value')).resolves.toEqual(key);
    expect(seen).toEqual({
      method: 'POST',
      url: '/api/okms-id/v1/servicekey/svc%20key/datakey/decrypt',
      body: { key: 'wrapped-value' },
    });
    expect(seenClientCn).toBe('invoicerr-test-client');
  });

  it('retries a 5xx and then succeeds', async () => {
    let calls = 0;
    handler = (_req, _body, res) => {
      calls++;
      if (calls < 3) {
        res.writeHead(503);
        res.end('busy');
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ plaintext: Buffer.alloc(32, 1).toString('base64') }));
    };
    await expect(client().unwrapDataKey('w')).resolves.toHaveLength(32);
    expect(calls).toBe(3);
  });

  it('fails at once on a 4xx: a configuration error is not retried', async () => {
    let calls = 0;
    handler = (_req, _body, res) => {
      calls++;
      res.writeHead(403);
      res.end('forbidden');
    };
    const error = await client()
      .unwrapDataKey('w')
      .catch((err) => err);
    expect(error).toBeInstanceOf(OkmsError);
    expect(error.message).toContain('HTTP 403');
    expect(calls).toBe(1);
  });

  it('aborts a request that does not answer within the timeout, on every attempt', async () => {
    let calls = 0;
    handler = () => {
      calls++;
    };
    const started = Date.now();
    const error = await client(150, 2)
      .unwrapDataKey('w')
      .catch((err) => err);
    expect(error).toBeInstanceOf(OkmsError);
    expect(error.message).toMatch(/did not answer .* within 150 ms after 2 attempts/);
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('rejects an answer without a plaintext key', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200);
      res.end('{}');
    };
    await expect(client().unwrapDataKey('w')).rejects.toThrow(/without a plaintext key/);
  });

  it('cannot reach a KMS that does not trust its certificate', async () => {
    const stranger = issue('stranger', null, [{ name: 'extKeyUsage', clientAuth: true }]);
    const otherCert = join(dir, 'stranger.crt');
    const otherKey = join(dir, 'stranger.key');
    writeFileSync(otherCert, stranger.cert);
    writeFileSync(otherKey, stranger.key);
    handler = (_req, _body, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ plaintext: Buffer.alloc(32).toString('base64') }));
    };
    const untrusted = new OkmsClient(
      { endpoint, serviceKeyId: 'svc', certPath: otherCert, keyPath: otherKey, timeoutMs: 2000 },
      { ca: ca.cert, attempts: 1, backoffMs: 1 },
    );
    await expect(untrusted.unwrapDataKey('w')).rejects.toBeInstanceOf(OkmsError);
  });
});
