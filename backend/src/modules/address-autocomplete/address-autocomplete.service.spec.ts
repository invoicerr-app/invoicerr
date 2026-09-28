import * as http from 'node:http';

import { AddressAutocompleteService } from './address-autocomplete.service';

async function withPhotonStub(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Photon stub did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Read at CALL TIME by the service under test (mirrors `OCR_SERVICE_URL` - see that service's own
 *  header), which is exactly what lets this spec flip the env var per test instead of rebuilding a
 *  Nest testing module for each case. Always restored, even on a failing assertion. */
function withEnv(value: string | undefined, run: () => Promise<void> | void) {
  const original = process.env.ADDRESS_AUTOCOMPLETE_URL;
  if (value === undefined) delete process.env.ADDRESS_AUTOCOMPLETE_URL;
  else process.env.ADDRESS_AUTOCOMPLETE_URL = value;
  return Promise.resolve(run()).finally(() => {
    if (original === undefined) delete process.env.ADDRESS_AUTOCOMPLETE_URL;
    else process.env.ADDRESS_AUTOCOMPLETE_URL = original;
  });
}

describe('AddressAutocompleteService', () => {
  describe('capability()', () => {
    it('is disabled when ADDRESS_AUTOCOMPLETE_URL is unset - the self-hosted default', async () => {
      await withEnv(undefined, () => {
        expect(new AddressAutocompleteService().capability()).toEqual({ enabled: false });
      });
    });

    it('is disabled when the variable is set to blank/whitespace only', async () => {
      await withEnv('   ', () => {
        expect(new AddressAutocompleteService().capability()).toEqual({ enabled: false });
      });
    });

    it('is enabled once an operator points it at a Photon server', async () => {
      await withEnv('https://photon.komoot.io', () => {
        expect(new AddressAutocompleteService().capability()).toEqual({ enabled: true });
      });
    });
  });

  describe('search()', () => {
    it('makes NO request at all when ADDRESS_AUTOCOMPLETE_URL is unset - never merely an empty result', async () => {
      await withEnv(undefined, async () => {
        // No stub server is started in this case on purpose: if the service tried to reach ANY
        // URL, this test would hang or ECONNREFUSED instead of resolving fast with [].
        await expect(new AddressAutocompleteService().search('12 rue de la paix')).resolves.toEqual([]);
      });
    });

    it('rejects a query under 3 characters before ever calling Photon', async () => {
      let calls = 0;
      await withPhotonStub(
        (_req, res) => {
          calls++;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ features: [] }));
        },
        async (baseUrl) => {
          await withEnv(baseUrl, async () => {
            await expect(new AddressAutocompleteService().search('12')).resolves.toEqual([]);
            expect(calls).toBe(0);
          });
        },
      );
    });

    it('proxies a real request to the configured Photon server and maps the result', async () => {
      await withPhotonStub(
        (req, res) => {
          expect(req.url).toContain('/api/?q=');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              features: [
                {
                  properties: {
                    housenumber: '10',
                    street: 'Downing Street',
                    postcode: 'SW1A 2AA',
                    city: 'London',
                    country: 'United Kingdom',
                    countrycode: 'GB',
                  },
                },
              ],
            }),
          );
        },
        async (baseUrl) => {
          await withEnv(baseUrl, async () => {
            const suggestions = await new AddressAutocompleteService().search('10 downing street');
            expect(suggestions).toEqual([
              {
                label: '10 Downing Street, SW1A 2AA London, United Kingdom',
                street: 'Downing Street',
                houseNumber: '10',
                postalCode: 'SW1A 2AA',
                city: 'London',
                country: 'United Kingdom',
                countryCode: 'GB',
              },
            ]);
          });
        },
      );
    });

    it('degrades to an empty list, never a thrown error, when the configured server is unreachable', async () => {
      await withEnv('http://127.0.0.1:1', async () => {
        await expect(new AddressAutocompleteService().search('12 rue de la paix')).resolves.toEqual([]);
      });
    });

    // The timeout mechanism itself (a hung server, a short deadline) is proven in
    // `photon-client.spec.ts`, at the transport layer this service calls - not repeated here with
    // the service's own several-second production default, which would only slow this suite down
    // for the same assertion `search()` already makes twice below (unreachable / non-2xx -> []).

    it('degrades to an empty list when the configured server answers with a non-2xx status', async () => {
      await withPhotonStub(
        (_req, res) => {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('boom');
        },
        async (baseUrl) => {
          await withEnv(baseUrl, async () => {
            await expect(new AddressAutocompleteService().search('12 rue de la paix')).resolves.toEqual([]);
          });
        },
      );
    });
  });
});
