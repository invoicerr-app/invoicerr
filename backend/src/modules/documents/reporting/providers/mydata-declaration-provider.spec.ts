/**
 * `buildMyDataDeclarationProvider` against a REAL local HTTP stub — same "never an in-process mock of
 * the HTTP layer" discipline `nav-declaration-provider.spec.ts` already holds for its own sibling.
 */
import * as http from 'node:http';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError, DeclaredInvoice } from '../declaration-provider';
import { buildMyDataDeclarationProvider, MYDATA_PROVIDER_ID } from './mydata-declaration-provider';
import { MyDataApiError } from './mydata-client';

const CREDENTIALS = { userId: 'testuser', subscriptionKey: 'sub-key-123' };

const FIXTURE_INVOICE: DeclaredInvoice = {
  documentId: 'doc-1',
  typeId: 'invoice',
  number: 'INV-2026-0001',
  issueDate: '2026-09-02',
  currency: 'EUR',
  seller: {
    name: 'Acme AE',
    countryCode: 'GR',
    vatNumber: 'EL123456789',
    legalId: undefined,
    address: 'Ermou 1',
    city: 'Athens',
    postalCode: '10563',
  },
  buyer: {
    name: 'Buyer AE',
    countryCode: 'GR',
    vatNumber: 'EL987654321',
    legalId: undefined,
    address: 'Panepistimiou 2',
    city: 'Athens',
    postalCode: '10564',
  },
  lines: [
    {
      description: 'Service',
      quantity: 1,
      unitPrice: 100,
      vatRatePercent: 24,
      netAmount: 100,
      vatAmount: 24,
      grossAmount: 124,
    },
  ],
  netTotal: 100,
  vatTotal: 24,
  grossTotal: 124,
};

interface MyDataStub {
  baseUrl: string;
  close: () => Promise<void>;
  lastHeaders?: http.IncomingHttpHeaders;
  lastBody?: string;
}

function startMyDataStub(options: { reject?: boolean } = {}): Promise<MyDataStub> {
  return new Promise((resolvePromise, reject) => {
    const state: { lastHeaders?: http.IncomingHttpHeaders; lastBody?: string } = {};
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        state.lastHeaders = req.headers;
        state.lastBody = body;
        res.writeHead(200, { 'content-type': 'text/xml' });
        if (options.reject) {
          res.end(
            '<ResponseDoc><response><index>1</index><statusCode>ValidationError</statusCode>' +
              '<errors><error><code>202</code><message>fixture rejection</message></error></errors></response></ResponseDoc>',
          );
          return;
        }
        res.end(
          '<ResponseDoc><response><index>1</index><invoiceUid>UID1</invoiceUid>' +
            '<invoiceMark>400000000000123</invoiceMark><statusCode>Success</statusCode></response></ResponseDoc>',
        );
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('myDATA stub did not bind'));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
        get lastHeaders() {
          return state.lastHeaders;
        },
        get lastBody() {
          return state.lastBody;
        },
      });
    });
  });
}

describe('buildMyDataDeclarationProvider — the full SendInvoices flow', () => {
  let stub: MyDataStub;

  afterEach(async () => {
    await stub?.close();
  });

  function channelCredentialsFor(baseUrl: string): ChannelCredentialsService {
    return {
      resolveActive: jest.fn().mockResolvedValue({
        providerId: MYDATA_PROVIDER_ID,
        channel: 'MYDATA',
        environment: 'TEST',
        isActive: true,
        config: { ...CREDENTIALS, baseUrl },
      }),
    } as unknown as ChannelCredentialsService;
  }

  it('declares successfully: journals the MARK (invoiceMark) as authorityId', async () => {
    stub = await startMyDataStub();
    const provider = buildMyDataDeclarationProvider({
      channelCredentials: channelCredentialsFor(stub.baseUrl),
    });

    const result = await provider.declare('company-1', FIXTURE_INVOICE);

    expect(result.authorityId).toBe('400000000000123');
    expect(result.statusCode).toBe('Success');
    expect(result.rawPayload).toEqual(
      expect.objectContaining({ invoiceMark: '400000000000123', invoiceUid: 'UID1' }),
    );
  });

  it('sends the right authentication headers (aade-user-id, ocp-apim-subscription-key)', async () => {
    stub = await startMyDataStub();
    const provider = buildMyDataDeclarationProvider({
      channelCredentials: channelCredentialsFor(stub.baseUrl),
    });

    await provider.declare('company-1', FIXTURE_INVOICE);

    expect(stub.lastHeaders?.['aade-user-id']).toBe(CREDENTIALS.userId);
    expect(stub.lastHeaders?.['ocp-apim-subscription-key']).toBe(CREDENTIALS.subscriptionKey);
    expect(stub.lastBody).toContain('<InvoicesDoc');
    expect(stub.lastBody).toContain('EL123456789'); // the seller's own VAT number, in the request
  });

  it('an AADE rejection propagates as a named MyDataApiError, never a silent success', async () => {
    stub = await startMyDataStub({ reject: true });
    const provider = buildMyDataDeclarationProvider({
      channelCredentials: channelCredentialsFor(stub.baseUrl),
    });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(MyDataApiError);
  });

  it('no myDATA channel connected: declare() throws ChannelNotConnectedError, never attempts an HTTP call', async () => {
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue(null),
    } as unknown as ChannelCredentialsService;
    const provider = buildMyDataDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(ChannelNotConnectedError);
  });

  it('an incomplete myDATA config (missing subscriptionKey) is treated the same as not connected', async () => {
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue({
        providerId: MYDATA_PROVIDER_ID,
        channel: 'MYDATA',
        environment: 'TEST',
        isActive: true,
        config: { userId: 'x' },
      }),
    } as unknown as ChannelCredentialsService;
    const provider = buildMyDataDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(ChannelNotConnectedError);
  });
});
