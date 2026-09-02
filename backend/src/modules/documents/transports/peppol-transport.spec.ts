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
 *
 * "THE FORMAT OVERRIDE" describe block below is root TODO "le trou allemand du B2G" — see
 * `peppol-transport.ts`'s own header for the full contract: `ctx.formatOverride` absent (every test
 * ABOVE that block) is unmodified, unchanged behavior — the REAL proof this new mechanism does not
 * regress a single pre-existing case; present-but-unwired is a NAMED refusal, never a silent
 * Peppol-BIS substitute; present-and-wired (`xrechnung`) runs the REAL `xrechnungFormatProvider`
 * (never mocked) against a complete German government-buyer fixture and asserts the CustomizationID
 * actually reaching the Access Point is XRechnung's, never Peppol BIS's — the exact "mutation #1"
 * target this task's own brief names.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { peppolBisFormatProvider } from '../formats/peppol-bis-provider';
import { xrechnungFormatProvider } from '../formats/xrechnung-provider';
import { PeppolApHttpClient, PEPPOL_DOC_TYPES } from './peppol/peppol-client';
import { buildPeppolTransport, PeppolFormatOverride } from './peppol-transport';
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
  formatOverrides?: Record<string, PeppolFormatOverride>;
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
  return {
    channelCredentials,
    peppolBisFormatProvider: overrides?.formatProvider ?? fallbackFormatProvider,
    formatOverrides: overrides?.formatOverrides,
  };
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

/** ISO 13616's own published example IBAN (Deutsche Bundesbank) — checksum-valid, never a real
 *  account — the SAME fixture value `xrechnung-provider.spec.ts`'s own master proof already uses.
 *  Required for the FORMAT OVERRIDE tests below: `xrechnungFormatProvider`'s own BR-DE-1. */
const TEST_IBAN = 'DE89370400440532013000';

/** A COMPLETE German seller — contact (phone/email) AND an IBAN on file, everything
 *  `xrechnungFormatProvider` needs to accept the document (`xrechnung-provider.ts`'s own BR-DE-*). */
const GERMAN_SELLER_WITH_IBAN = { ...GERMAN_SELLER, iban: TEST_IBAN };

/** A German PUBLIC-SECTOR buyer, addressed on the Peppol network under EAS `0204` ("Peppol-Leitweg-ID"
 *  — see `b2g-routing/data/de.json`'s own ADDENDUM for the sourced citation) — the SAME generic
 *  `PEPPOL_ENDPOINT` mechanism `FRENCH_BUYER_WITH_ENDPOINT` above already uses, never a DE-specific
 *  code path. */
const GERMAN_GOV_BUYER_WITH_ENDPOINT = {
  id: 'client-2',
  name: 'Stadt Testhausen',
  address: 'Rathausplatz 1',
  city: 'Testhausen',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'PEPPOL_ENDPOINT', value: '0204:04011000-1234512345-06' }],
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

  // Root TODO "le trou allemand du B2G" — see `peppol-transport.ts`'s own header, "THE FORMAT
  // OVERRIDE". `CTX_DE_GOV` mirrors `CTX` exactly (same document shape, same `buyerReference`) but
  // names the German government buyer instead — so a test in this block differs from one above it by
  // EXACTLY one variable: whether `ctx.formatOverride`/`deps.formatOverrides` are involved at all.
  describe('send() — THE FORMAT OVERRIDE (a B2G rule imposing a different CONTENT over the same Peppol channel)', () => {
    const CTX_DE_GOV: DocumentTransportContext = {
      ...CTX,
      document: {
        ...CTX.document,
        data: { ...(CTX.document.data as Record<string, unknown>), client: 'client-2' },
      },
    };

    beforeEach(() => {
      mockedPrisma.company.findUnique.mockResolvedValue(GERMAN_SELLER_WITH_IBAN);
      mockedPrisma.client.findUnique.mockResolvedValue(GERMAN_GOV_BUYER_WITH_ENDPOINT);
    });

    it('no `ctx.formatOverride` — REGRESSION: unaffected by `deps.formatOverrides` merely being wired, still sends peppol-bis exactly as every test above', async () => {
      // A REAL local stub server (never a `jest.spyOn(PeppolApHttpClient.prototype, 'send')` left
      // mocked) — spying on a SHARED prototype method here would leak into whichever test in this
      // file runs next (`jest.clearAllMocks()` in `beforeEach` clears call history, never a spy's own
      // mocked implementation), exactly the kind of cross-test pollution this suite's own "REAL local
      // stub" convention (this file's own header) already avoids everywhere else.
      const { server, url } = await startStubServer((_req, res) => {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messageId: 'msg-x', status: 'SENT' }));
      });

      try {
        const build = jest
          .fn()
          .mockResolvedValue({ bytes: new Uint8Array([9]), validation: { valid: true, errors: [] } });
        const deps = buildDeps({
          build,
          resolveActive: jest.fn().mockResolvedValue({
            ...CONNECTED_CONFIG,
            config: { ...CONNECTED_CONFIG.config, accessPointUrl: url },
          }),
          formatOverrides: { xrechnung: { provider: xrechnungFormatProvider, documentTypeId: 'unused' } },
        });
        const transport = buildPeppolTransport(deps);

        const result = await transport.send({ ...CTX_DE_GOV, formatOverride: undefined });

        expect(build).toHaveBeenCalledTimes(1); // the DEFAULT (mocked peppol-bis) provider, never xrechnung
        expect(result.artifacts).toEqual([
          { role: 'peppol-bis', mime: 'application/xml', bytes: new Uint8Array([9]) },
        ]);
      } finally {
        await closeServer(server);
      }
    });

    // "peppol-bis" NAMES ITSELF — the landmine `documents-core.module.ts`'s own header now documents
    // (found while wiring the B2G audit wave, BE/CY/EE/GR/LT/LU/LV/MT/SE): `resolveB2gInvoiceTransport`
    // ALWAYS sets `ctx.formatOverride` for EVERY B2G rule, including one naming the plain, no-CIUS
    // "peppol-bis" syntax — so THIS transport must resolve that override to the exact same
    // provider/documentTypeId the no-override branch already uses, never a spurious "no override
    // wired" refusal for a format it already sends by default. Proven against a REAL local stub
    // server (captures the actual request body), never a mocked `PeppolApHttpClient`.
    it('`ctx.formatOverride` is "peppol-bis" itself, WIRED as its own override — IDENTICAL to no override at all: same provider, same documentTypeId reaching the Access Point', async () => {
      const { server, url } = await startStubServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          receivedBody = raw;
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messageId: 'msg-self-override', status: 'SENT' }));
        });
      });
      let receivedBody = '';

      try {
        const build = jest
          .fn()
          .mockResolvedValue({ bytes: new Uint8Array([7]), validation: { valid: true, errors: [] } });
        // The SAME object reference used both as `deps.peppolBisFormatProvider` (the no-override
        // default) and as the "peppol-bis" override's own `provider` — mirroring EXACTLY how
        // `documents-core.module.ts#buildTransportRegistry` wires it in production (a single
        // `peppolBisFormatProvider` constant, referenced twice), never two independent instances.
        const sharedProvider: DocumentFormatProvider = {
          id: 'peppol-bis',
          syntax: 'PEPPOL_BIS_BILLING_3',
          mime: 'application/xml',
          build,
        };
        const deps = buildDeps({
          build,
          formatProvider: sharedProvider,
          resolveActive: jest.fn().mockResolvedValue({
            ...CONNECTED_CONFIG,
            config: { ...CONNECTED_CONFIG.config, accessPointUrl: url },
          }),
          formatOverrides: {
            'peppol-bis': { provider: sharedProvider, documentTypeId: PEPPOL_DOC_TYPES.INVOICE_UBL },
          },
        });
        const transport = buildPeppolTransport(deps);

        const result = await transport.send({ ...CTX_DE_GOV, formatOverride: 'peppol-bis' });

        expect(build).toHaveBeenCalledTimes(1);
        expect(result.artifacts).toEqual([
          { role: 'peppol-bis', mime: 'application/xml', bytes: new Uint8Array([7]) },
        ]);
        expect(JSON.parse(receivedBody).documentTypeId).toBe(PEPPOL_DOC_TYPES.INVOICE_UBL);
      } finally {
        await closeServer(server);
      }
    });

    it('`ctx.formatOverride` names a format this transport has NO override wired for — refuses, NAMED, and the Access Point is NEVER called (never a silent fall back to Peppol BIS)', async () => {
      const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
      const deps = buildDeps(); // no `formatOverrides` at all
      const transport = buildPeppolTransport(deps);

      const action = transport.send({ ...CTX_DE_GOV, formatOverride: 'some-other-format' });
      await expect(action).rejects.toThrow(BadRequestException);
      await expect(action).rejects.toThrow(/"some-other-format"/);
      await expect(action).rejects.toThrow(/no Peppol format override wired/);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    // MUTATION TARGET #1 (this task's own brief): if `send()` ever stopped reading `ctx.formatOverride`
    // (or read it but kept calling `deps.peppolBisFormatProvider.build` regardless), this test is what
    // would catch it — the REAL `xrechnungFormatProvider` (never mocked) is run, and the assertion is
    // on the actual CustomizationID inside the bytes the (real local stub) Access Point receives.
    describe('the REAL xrechnung-provider, wired as the override — the CustomizationID proof', () => {
      it('sends XRechnung — never Peppol BIS — when `ctx.formatOverride` is "xrechnung": CustomizationID, documentTypeId, and artifact role all agree', async () => {
        let receivedBody = '';
        const { server, url } = await startStubServer((req, res) => {
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            receivedBody = Buffer.concat(chunks).toString('utf-8');
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ messageId: 'msg-xrechnung-001', status: 'SENT' }));
          });
        });

        try {
          const deps = buildDeps({
            resolveActive: jest.fn().mockResolvedValue({
              ...CONNECTED_CONFIG,
              config: { ...CONNECTED_CONFIG.config, accessPointUrl: url },
            }),
            formatOverrides: {
              xrechnung: {
                provider: xrechnungFormatProvider,
                documentTypeId: PEPPOL_DOC_TYPES.INVOICE_XRECHNUNG_UBL,
              },
            },
          });
          const transport = buildPeppolTransport(deps);

          const result = await transport.send({ ...CTX_DE_GOV, formatOverride: 'xrechnung' });

          expect(result.artifacts?.[0]?.role).toBe('xrechnung');
          expect(result.artifacts?.[0]?.mime).toBe('application/xml');

          const body = JSON.parse(receivedBody) as { document: string; documentTypeId: string };
          expect(body.documentTypeId).toBe(PEPPOL_DOC_TYPES.INVOICE_XRECHNUNG_UBL);
          const xml = Buffer.from(body.document, 'base64').toString('utf-8');
          // THE ASSERTION — XRechnung's own CustomizationID reached the Access Point, Peppol BIS's
          // never did.
          expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0');
          expect(xml).not.toContain('urn:fdc:peppol.eu:2017:poacc:billing:3.0');
          // The RECEIVER GATE read the SAME generic `PEPPOL_ENDPOINT` mechanism, addressed under EAS
          // `0204` — `b2g-routing/data/de.json`'s own ADDENDUM.
          const parsedBody = JSON.parse(receivedBody) as { receiver: string };
          expect(parsedBody.receiver).toBe('0204:04011000-1234512345-06');
        } finally {
          await closeServer(server);
        }
      });

      it('the FORMAT GATE still applies under the override — a German seller with NO IBAN refuses, named (BR-DE-1), before the Access Point is ever called', async () => {
        mockedPrisma.company.findUnique.mockResolvedValue(GERMAN_SELLER); // no `iban` — the ONE fact missing
        const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');
        const deps = buildDeps({
          formatOverrides: {
            xrechnung: {
              provider: xrechnungFormatProvider,
              documentTypeId: PEPPOL_DOC_TYPES.INVOICE_XRECHNUNG_UBL,
            },
          },
        });
        const transport = buildPeppolTransport(deps);

        const action = transport.send({ ...CTX_DE_GOV, formatOverride: 'xrechnung' });
        await expect(action).rejects.toThrow(BadRequestException);
        await expect(action).rejects.toThrow(/failed validation/);
        const error = await action.catch((e) => e);
        expect(error.response.errors.join(' ')).toContain('BR-DE-1');
        expect(sendSpy).not.toHaveBeenCalled();
      });
    });

    // A fixed-format transport (email/pdp/ksef/sdi/chorus-pro/face/anaf — every OTHER transport in
    // this directory) simply never reads `ctx.formatOverride` at all — nothing to prove HERE beyond
    // what each of THOSE transports' own specs already prove (their own `send()` never even accepts
    // this field). The contract itself (`transport-registry.ts`'s own header) is documentation, not a
    // shared runtime code path this suite would exercise a second time.
  });
});
