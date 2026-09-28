import * as http from 'node:http';

import { fetchPhotonSuggestions, PhotonClientError } from './photon-client';

/** A real `node:http` stub standing in for a Photon server - never a mocked `fetch`, the same
 *  discipline `ocr-service/local-client.spec.ts` uses for the OCR engine. The response bodies below
 *  are a real Photon `FeatureCollection` shape (https://photon.komoot.io/api/?q=...), trimmed to the
 *  properties this client reads. */
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

const FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.3364, 48.8698] },
      properties: {
        osm_id: 1,
        osm_type: 'N',
        housenumber: '12',
        street: 'Rue de la Paix',
        postcode: '75002',
        city: 'Paris',
        country: 'France',
        countrycode: 'FR',
        name: '12',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.29, 48.85] },
      properties: {
        osm_id: 2,
        osm_type: 'N',
        // No street/housenumber at all - a place-level match (a town, not a street address).
        town: 'Boulogne-Billancourt',
        country: 'France',
        countrycode: 'FR',
        name: 'Boulogne-Billancourt',
      },
    },
  ],
};

describe('fetchPhotonSuggestions', () => {
  it('GETs {baseUrl}/api/?q=...&limit=N and maps housenumber/street/postcode/city/country/countrycode', async () => {
    let receivedPath = '';
    await withPhotonStub(
      (req, res) => {
        receivedPath = req.url ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(FEATURE_COLLECTION));
      },
      async (baseUrl) => {
        const suggestions = await fetchPhotonSuggestions(baseUrl, '12 rue de la paix', 5);

        expect(receivedPath).toBe('/api/?q=12%20rue%20de%20la%20paix&limit=5');
        expect(suggestions).toHaveLength(2);
        expect(suggestions[0]).toEqual({
          label: '12 Rue de la Paix, 75002 Paris, France',
          street: 'Rue de la Paix',
          houseNumber: '12',
          postalCode: '75002',
          city: 'Paris',
          country: 'France',
          countryCode: 'FR',
        });
      },
    );
  });

  it('falls back to town/village/county when a candidate has no "city" property', async () => {
    await withPhotonStub(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(FEATURE_COLLECTION));
      },
      async (baseUrl) => {
        const suggestions = await fetchPhotonSuggestions(baseUrl, 'boulogne', 5);
        expect(suggestions[1].city).toBe('Boulogne-Billancourt');
        expect(suggestions[1].street).toBeUndefined();
        expect(suggestions[1].houseNumber).toBeUndefined();
      },
    );
  });

  it('tolerates a trailing slash on baseUrl', async () => {
    let receivedPath = '';
    await withPhotonStub(
      (req, res) => {
        receivedPath = req.url ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ features: [] }));
      },
      async (baseUrl) => {
        await fetchPhotonSuggestions(`${baseUrl}/`, 'x', 5);
        expect(receivedPath).toBe('/api/?q=x&limit=5');
      },
    );
  });

  it('an empty FeatureCollection is an empty array, not an error', async () => {
    await withPhotonStub(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'FeatureCollection', features: [] }));
      },
      async (baseUrl) => {
        await expect(fetchPhotonSuggestions(baseUrl, 'nowhere', 5)).resolves.toEqual([]);
      },
    );
  });

  it('a non-2xx response is a NAMED PhotonClientError carrying the real HTTP status', async () => {
    await withPhotonStub(
      (_req, res) => {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('Service Unavailable');
      },
      async (baseUrl) => {
        await expect(fetchPhotonSuggestions(baseUrl, 'x', 5)).rejects.toMatchObject({
          name: 'PhotonClientError',
          message: expect.stringContaining('503') as unknown as string,
        });
      },
    );
  });

  it('a malformed JSON body is a NAMED PhotonClientError', async () => {
    await withPhotonStub(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('not json');
      },
      async (baseUrl) => {
        await expect(fetchPhotonSuggestions(baseUrl, 'x', 5)).rejects.toBeInstanceOf(PhotonClientError);
      },
    );
  });

  it('an unreachable server is a NAMED failure, never a silent hang', async () => {
    await expect(fetchPhotonSuggestions('http://127.0.0.1:1', 'x', 5)).rejects.toBeInstanceOf(
      PhotonClientError,
    );
  });

  it('a request that never answers times out with a NAMED PhotonClientError', async () => {
    await withPhotonStub(
      () => {
        // Never responds - a hung / overloaded Photon instance.
      },
      async (baseUrl) => {
        await expect(fetchPhotonSuggestions(baseUrl, 'x', 5, 20)).rejects.toMatchObject({
          name: 'PhotonClientError',
          message: expect.stringContaining('timed out') as unknown as string,
        });
      },
    );
  });

  it('drops a candidate with nothing usable rather than returning a blank suggestion', async () => {
    await withPhotonStub(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ features: [{ properties: {} }] }));
      },
      async (baseUrl) => {
        await expect(fetchPhotonSuggestions(baseUrl, 'x', 5)).resolves.toEqual([]);
      },
    );
  });
});
