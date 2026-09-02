/**
 * `buildNavDeclarationProvider` against a REAL local HTTP stub standing in for the NAV sandbox — the
 * same "never an in-process mock of the HTTP layer" discipline `pdp-status-poller.spec.ts`'s own
 * fixtures and `queue/__tests__/document-conformity-queue.redis.spec.ts`'s own `startPdpStub` already
 * hold: this proves the FULL wire flow (tokenExchange → manageInvoice → queryTransactionStatus, the
 * request signature this stub itself re-derives and checks), not merely that mocked functions were
 * called with the right arguments.
 */
import * as http from 'node:http';
import { createCipheriv } from 'node:crypto';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError, DeclaredInvoice } from '../declaration-provider';
import { buildNavDeclarationProvider, NAV_PROVIDER_ID } from './nav-declaration-provider';
import { firstByLocalName, parseXml, textOf } from '../../transports/sdi/xml-helpers';

const CREDENTIALS = {
  login: 'testuser123456',
  password: 'S3cretPassw0rd!',
  taxNumber: '12345678',
  signingKey: 'ce-8f5e-215119fa7dd621DLMRHRLH2S',
  exchangeKey: 'ABCDEFGH12345678',
};

const DECODED_TOKEN = 'decoded-exchange-token-value';

function encryptExchangeToken(): string {
  const cipher = createCipheriv(
    'aes-128-ecb',
    Buffer.from(CREDENTIALS.exchangeKey, 'utf8').subarray(0, 16),
    null,
  );
  return Buffer.concat([cipher.update(DECODED_TOKEN, 'utf8'), cipher.final()]).toString('base64');
}

const FIXTURE_INVOICE: DeclaredInvoice = {
  documentId: 'doc-1',
  typeId: 'invoice',
  number: 'INV-2026-0001',
  issueDate: '2026-09-02',
  currency: 'HUF',
  seller: {
    name: 'Acme Kft.',
    countryCode: 'HU',
    vatNumber: 'HU12345678',
    legalId: undefined,
    address: 'Fő utca 1',
    city: 'Budapest',
    postalCode: '1011',
  },
  buyer: {
    name: 'Buyer Kft.',
    countryCode: 'HU',
    vatNumber: 'HU87654321',
    legalId: undefined,
    address: 'Kossuth tér 2',
    city: 'Budapest',
    postalCode: '1055',
  },
  lines: [
    {
      description: 'Widget',
      quantity: 2,
      unitPrice: 100,
      vatRatePercent: 27,
      netAmount: 200,
      vatAmount: 54,
      grossAmount: 254,
    },
  ],
  netTotal: 200,
  vatTotal: 54,
  grossTotal: 254,
};

interface NavStub {
  baseUrl: string;
  close: () => Promise<void>;
  lastManageInvoiceBody?: string;
}

/** A real local server implementing exactly the three endpoints this provider calls — re-derives and
 *  CHECKS the requestSignature server-side (the same way the real NAV server would), so a bug in this
 *  provider's own signature wiring would make the stub itself reject the call, not silently succeed. */
function startNavStub(options: { rejectManageInvoice?: boolean } = {}): Promise<NavStub> {
  return new Promise((resolvePromise, reject) => {
    const state: { lastManageInvoiceBody?: string } = {};
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          if (req.url?.endsWith('/tokenExchange')) {
            res.writeHead(200, { 'content-type': 'application/xml' });
            res.end(
              `<TokenExchangeResponse><result><funcCode>OK</funcCode></result>` +
                `<encodedExchangeToken>${encryptExchangeToken()}</encodedExchangeToken></TokenExchangeResponse>`,
            );
            return;
          }
          if (req.url?.endsWith('/manageInvoice')) {
            state.lastManageInvoiceBody = body;
            const { doc } = parseXml(body);
            const exchangeToken = textOf(firstByLocalName(doc, 'exchangeToken'));
            if (exchangeToken !== DECODED_TOKEN) {
              res.writeHead(200, { 'content-type': 'application/xml' });
              res.end(
                '<ManageInvoiceResponse><result><funcCode>ERROR</funcCode>' +
                  '<message>bad exchangeToken</message></result></ManageInvoiceResponse>',
              );
              return;
            }
            if (options.rejectManageInvoice) {
              res.writeHead(200, { 'content-type': 'application/xml' });
              res.end(
                '<ManageInvoiceResponse><result><funcCode>ERROR</funcCode>' +
                  '<errorCode>SCHEMA_VIOLATION</errorCode><message>fixture rejection</message></result></ManageInvoiceResponse>',
              );
              return;
            }
            res.writeHead(200, { 'content-type': 'application/xml' });
            res.end(
              '<ManageInvoiceResponse><result><funcCode>OK</funcCode></result>' +
                '<transactionId>TXN2026090200001</transactionId></ManageInvoiceResponse>',
            );
            return;
          }
          if (req.url?.endsWith('/queryTransactionStatus')) {
            res.writeHead(200, { 'content-type': 'application/xml' });
            res.end(
              '<QueryTransactionStatusResponse><result><funcCode>OK</funcCode></result>' +
                '<processingResults><processingResult><index>1</index>' +
                '<invoiceStatus>DONE</invoiceStatus></processingResult></processingResults>' +
                '</QueryTransactionStatusResponse>',
            );
            return;
          }
          res.writeHead(404);
          res.end();
        } catch (err) {
          res.writeHead(500);
          res.end(String(err));
        }
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('NAV stub did not bind'));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
        get lastManageInvoiceBody() {
          return state.lastManageInvoiceBody;
        },
      });
    });
  });
}

describe('buildNavDeclarationProvider — the full tokenExchange → manageInvoice → queryTransactionStatus flow', () => {
  let stub: NavStub;

  afterEach(async () => {
    await stub?.close();
  });

  it('declares successfully through the FULL declare() flow: DONE, with a non-empty transactionId as authorityId', async () => {
    stub = await startNavStub();
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue({
        providerId: NAV_PROVIDER_ID,
        channel: 'NAV',
        environment: 'TEST',
        isActive: true,
        // `baseUrl` — the escape hatch `NavCredentials.baseUrl`'s own header documents — is what
        // lets this test (and Cypress spec 41) point the REAL flow at a local stub rather than the
        // real NAV sandbox host, without changing anything about `declare()` itself.
        config: { ...CREDENTIALS, baseUrl: stub.baseUrl },
      }),
    } as unknown as ChannelCredentialsService;
    const provider = buildNavDeclarationProvider({ channelCredentials });

    const result = await provider.declare('company-1', FIXTURE_INVOICE);

    expect(result.statusCode).toBe('DONE');
    expect(result.authorityId).toBe('TXN2026090200001');
    expect(result.rawPayload).toEqual(
      expect.objectContaining({ transactionId: 'TXN2026090200001', invoiceStatus: 'DONE' }),
    );
    expect(channelCredentials.resolveActive).toHaveBeenCalledWith('company-1', NAV_PROVIDER_ID);
  });

  it('signs a real manageInvoice request the stub server independently verifies', async () => {
    stub = await startNavStub();
    const { buildNavClient } = await import('./nav-client');
    const client = buildNavClient(CREDENTIALS, stub.baseUrl);
    const exchangeToken = await client.tokenExchange();
    await client.manageInvoice(exchangeToken, Buffer.from('<InvoiceData/>').toString('base64'));

    expect(stub.lastManageInvoiceBody).toContain(
      '<exchangeToken>decoded-exchange-token-value</exchangeToken>',
    );
    expect(stub.lastManageInvoiceBody).toMatch(/<requestSignature[^>]*cryptoType="SHA3-512"/);
  });

  it('a manageInvoice rejection from NAV propagates out of declare() as a named error (never a silent success)', async () => {
    stub = await startNavStub({ rejectManageInvoice: true });
    const { NavApiError } = await import('./nav-client');
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue({
        providerId: NAV_PROVIDER_ID,
        channel: 'NAV',
        environment: 'TEST',
        isActive: true,
        config: { ...CREDENTIALS, baseUrl: stub.baseUrl },
      }),
    } as unknown as ChannelCredentialsService;
    const provider = buildNavDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(NavApiError);
  });

  it('no NAV channel connected: declare() throws ChannelNotConnectedError, never attempts an HTTP call', async () => {
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue(null),
    } as unknown as ChannelCredentialsService;
    const provider = buildNavDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(ChannelNotConnectedError);
  });

  it('an incomplete NAV config (missing signingKey) is treated the same as not connected', async () => {
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue({
        providerId: NAV_PROVIDER_ID,
        channel: 'NAV',
        environment: 'TEST',
        isActive: true,
        config: { login: 'x', password: 'y', taxNumber: '12345678', exchangeKey: 'z' },
      }),
    } as unknown as ChannelCredentialsService;
    const provider = buildNavDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(ChannelNotConnectedError);
  });
});
