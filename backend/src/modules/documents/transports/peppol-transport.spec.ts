/**
 * The "peppol" transport in isolation — root TODO item 10 remainder. `@/prisma/prisma.service` is
 * mocked (company/client rows); the Access Point itself is exercised TWO ways in this one file:
 *
 *  - a REAL local HTTP stub (`node:http`, no TLS needed — the generic AP is plain Bearer-token REST)
 *    for the tests that actually reach the network (the happy path, an empty-messageId AP response,
 *    a real HTTP failure) — proving the actual request/response wiring, not a mocked module;
 *  - a `jest.spyOn(PeppolApHttpClient.prototype, 'send')` left UNCALLED for every test that must
 *    prove the network is never even reached (no channel connected, no valid client, no Peppol
 *    endpoint on the client, or an artifact that failed the format gate).
 *
 * This proves the ORCHESTRATION plus the two facts this task's own mutations target: an empty AP
 * message id is NEVER a success, and the transport SENDS THE PEPPOL-BIS PAYLOAD (never a plain UBL
 * that skipped the delta gate) — see the "peppol-bis-provider — R002" describe block below, which
 * runs the REAL format provider (not mocked) against a French seller to prove that a document the
 * Peppol BIS delta refuses is NEVER handed to the Access Point.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { peppolBisFormatProvider } from '../formats/peppol-bis-provider';
import { PeppolApHttpClient } from './peppol/peppol-client';
import { buildPeppolTransport } from './peppol-transport';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'peppol',
  channel: 'PEPPOL',
  environment: 'TEST' as const,
  isActive: true,
  config: { accessPointUrl: 'http://127.0.0.1:1', apiKey: 'ap-key', participantId: '0009:11112222' },
};

function buildDeps(overrides?: {
  resolveActive?: jest.Mock;
  build?: jest.Mock;
  formatProvider?: DocumentFormatProvider;
}) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? jest.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const fallbackFormatProvider: DocumentFormatProvider = {
    id: 'peppol-bis',
    syntax: 'PEPPOL_BIS_BILLING_3',
    mime: 'application/xml',
    build:
      overrides?.build ??
      jest.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
  };
  return { channelCredentials, peppolBisFormatProvider: overrides?.formatProvider ?? fallbackFormatProvider };
}

const GERMAN_SELLER = {
  id: 'company-1',
  name: 'Muster GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  email: 'contact@muster.example',
  phone: '+49301234567',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

const FRENCH_BUYER_WITH_ENDPOINT = {
  id: 'client-1',
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR12345678901' },
    { scheme: 'PEPPOL_ENDPOINT', value: '9957:FR12345678901' },
  ],
};

const CTX: DocumentTransportContext = {
  companyId: 'company-1',
  label: 'Invoice',
  document: {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data: {
      client: 'client-1',
      issueDate: '2026-08-30',
      dueDate: '2026-09-30',
      currency: 'EUR',
      buyerReference: 'PO-2026-00042',
      lines: [{ description: 'Beratungsleistung', quantity: 5, unit: 'hour', unitPrice: 200, vatRate: '19' }],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'INV-2026-0002',
  },
};

/** Waits for the real `'listening'` event before reading `.address()` — same race
 *  `peppol/peppol-client.spec.ts`'s own identical helper documents (discovered running THIS spec). */
function startStubServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** `closeAllConnections()` forcibly drops any lingering keep-alive socket — see
 *  `peppol/peppol-client.spec.ts`'s own identical helper for why. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

describe('buildPeppolTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue(GERMAN_SELLER);
    mockedPrisma.client.findUnique.mockResolvedValue(FRENCH_BUYER_WITH_ENDPOINT);
  });

  describe('preflight() — before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no Peppol channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildPeppolTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/Peppol channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing participantId)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { accessPointUrl: 'http://127.0.0.1:1', apiKey: 'ap-key' },
        }),
      });
      const transport = buildPeppolTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected — never touches the network', async () => {
      const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
      const deps = buildDeps();
      const transport = buildPeppolTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('send() — the receiver + format gates, before any Access Point call', () => {
    it('blocks (never calls the network) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildPeppolTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue(null);
      const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
      const deps = buildDeps();
      const transport = buildPeppolTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no valid client on file/);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    // THE PEPPOL_ENDPOINT GATE — this file's own header, and `peppol-transport.ts`'s own header on
    // why this is checked directly rather than through the format bridge's own best-effort fallback.
    it('refuses, NAMED, when the client has no Peppol endpoint on file — never guesses one', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue({
        ...FRENCH_BUYER_WITH_ENDPOINT,
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }], // no PEPPOL_ENDPOINT
      });
      const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
      const deps = buildDeps();
      const transport = buildPeppolTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no Peppol endpoint on file/);
      await expect(transport.send(CTX)).rejects.toThrow(/Peppol \/ electronic routing/);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('never sends an artifact that failed the format gate', async () => {
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['BR-CO-26: seller VAT missing'] },
      });
      const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
      const deps = buildDeps({ build });
      const transport = buildPeppolTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/failed validation/);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('send() — the REAL peppol-bis-provider — the vendor-FR/R002 case', () => {
    const FRENCH_SELLER = {
      id: 'company-1',
      name: 'Acme Consulting SARL',
      address: '1 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      email: 'contact@acme.example',
      phone: '+33100000000',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR12345678901' },
        { scheme: 'LEGAL_ID', value: '73282932000074' },
      ],
    };

    it('a French seller (three mandatory C. com. mentions) against a non-German buyer: PEPPOL-EN16931-R002 refuses the format, named — and the Access Point is NEVER called', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue(FRENCH_SELLER);
      // FRENCH_BUYER_WITH_ENDPOINT already carries a PEPPOL_ENDPOINT — the receiver gate passes, so
      // this test proves the FORMAT gate is what actually stops the send, not the endpoint check.
      const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
      const deps = buildDeps({ formatProvider: peppolBisFormatProvider }); // the REAL provider, not mocked
      const transport = buildPeppolTransport(deps);

      const action = transport.send(CTX);
      await expect(action).rejects.toThrow(BadRequestException);
      await expect(action).rejects.toThrow(/failed validation/);

      // The REAL, named Schematron rule — not a made-up error string. Same promise, re-awaited: jest
      // caches a rejected promise's outcome, so this does not re-run the send a third time.
      const error = await action.catch((e) => e);
      expect(error.response.errors.join(' ')).toContain('PEPPOL-EN16931-R002');
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('send() — delivery, against a REAL local Access Point stub', () => {
    it('succeeds and returns the REAL AP message id as `reference`, sending the peppol-bis bytes', async () => {
      let receivedBody = '';
      const { server, url } = await startStubServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          receivedBody = Buffer.concat(chunks).toString('utf-8');
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messageId: 'msg-real-001', status: 'SENT' }));
        });
      });

      try {
        const deps = buildDeps({
          resolveActive: jest.fn().mockResolvedValue({
            ...CONNECTED_CONFIG,
            config: { ...CONNECTED_CONFIG.config, accessPointUrl: url },
          }),
        });
        const transport = buildPeppolTransport(deps);

        const result = await transport.send(CTX);

        expect(result.reference).toBe('msg-real-001');
        expect(result.providerId).toBe('peppol');
        expect(result.message).toContain('msg-real-001');
        expect(result.artifacts).toEqual([
          { role: 'peppol-bis', mime: 'application/xml', bytes: new Uint8Array([1]) },
        ]);

        const body = JSON.parse(receivedBody) as { sender: string; receiver: string };
        expect(body.sender).toBe('0009:11112222');
        expect(body.receiver).toBe('9957:FR12345678901');
      } finally {
        await closeServer(server);
      }
    });

    // THE MUTATION TARGET (#1 in the task brief): an accepted AP response with an EMPTY message id
    // must be a FAILURE, never a silent success.
    it('treats an EMPTY AP message id as a FAILURE, never a success', async () => {
      const { server, url } = await startStubServer((_req, res) => {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'QUEUED' }));
      });

      try {
        const deps = buildDeps({
          resolveActive: jest.fn().mockResolvedValue({
            ...CONNECTED_CONFIG,
            config: { ...CONNECTED_CONFIG.config, accessPointUrl: url },
          }),
        });
        const transport = buildPeppolTransport(deps);

        await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
        await expect(transport.send(CTX)).rejects.toThrow(/no message id/);
      } finally {
        await closeServer(server);
      }
    });

    it('wraps a real network/HTTP failure from the Access Point into a named BadRequestException — never swallowed', async () => {
      const { server, url } = await startStubServer((_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      });

      try {
        const deps = buildDeps({
          resolveActive: jest.fn().mockResolvedValue({
            ...CONNECTED_CONFIG,
            config: { ...CONNECTED_CONFIG.config, accessPointUrl: url },
          }),
        });
        const transport = buildPeppolTransport(deps);

        await expect(transport.send(CTX)).rejects.toThrow(/Peppol send failed:/);
      } finally {
        await closeServer(server);
      }
    });
  });
});
