import { vi } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Browser, chromium, Page } from 'playwright-core';

import { renderPdf } from './render-pdf';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { log: { create: vi.fn().mockResolvedValue({}) } },
}));

vi.setConfig({ testTimeout: 30_000 });

async function firstPageSize(pdf: Buffer): Promise<{ width: number; height: number }> {
  const task = getDocument({ data: new Uint8Array(pdf), isEvalSupported: false });
  const [, , width, height] = (await (await task.promise).getPage(1)).view;
  await task.destroy();
  return { width, height };
}

/** Everything a page could carry from one document to the next besides its content. */
async function stateOf(page: Page) {
  return {
    cookies: await page.context().cookies(),
    viewport: page.viewportSize(),
    environment: await page.evaluate(() => {
      const storage = (read: () => Storage) => {
        try {
          return read().length;
        } catch {
          return 'unavailable';
        }
      };
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        print: window.matchMedia('print').matches,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        localStorage: storage(() => window.localStorage),
        sessionStorage: storage(() => window.sessionStorage),
      };
    }),
  };
}

async function textOf(pdf: Buffer): Promise<string> {
  const task = getDocument({ data: new Uint8Array(pdf), isEvalSupported: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return pages.join(' ');
}

const FIRST_DOCUMENT = `<html><head><style>body::after { content: 'LEAKCSS'; }</style></head><body>
  LEAKBODY
  <script>
    window.name = 'LEAKNAME';
    window.leaked = 'LEAKGLOBAL';
    setInterval(function () { if (document.body) document.body.append('LEAKTIMER'); }, 1);
  </script>
</body></html>`;

const SECOND_DOCUMENT = `<html><body>
  SECOND
  <script>document.write(window.name + ' ' + window.leaked);</script>
</body></html>`;

const STATEFUL_DOCUMENT = `<html><head>
  <meta http-equiv="set-cookie" content="leak=1; path=/">
  <meta name="viewport" content="width=320">
  <meta name="color-scheme" content="dark">
  <style>@page { size: A3 landscape; }</style>
</head><body>STATEFUL</body></html>`;

// A developer machine may have no Chromium at all; CI always does, so it never skips there.
let rendererAvailable = true;
let browser: Browser;
beforeAll(async () => {
  const launch = vi.spyOn(chromium, 'launch');
  try {
    await renderPdf('<html><body>warm-up</body></html>');
    // The LAST launch is the browser renderPdf kept: in CHROMIUM_SANDBOX=auto a host that refuses the
    // sandbox (AppArmor-restricted user namespaces on the Ubuntu CI runner) rejects the first,
    // sandboxed launch and render-pdf.ts falls back to a second, --no-sandbox one.
    browser = await launch.mock.results[launch.mock.results.length - 1].value;
  } catch (error) {
    if (process.env.CI || !String(error).includes('PDF renderer unavailable')) throw error;
    rendererAvailable = false;
  }
}, 180_000);

describe('PDF rendering on a reused page', () => {
  beforeEach((context) => {
    if (!rendererAvailable) context.skip();
  });

  it('shows nothing of the document rendered before it', async () => {
    await renderPdf(FIRST_DOCUMENT);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const text = await textOf(await renderPdf(SECOND_DOCUMENT));

    expect(text).toContain('SECOND');
    expect(text).not.toMatch(/LEAK/);
  });

  it('renders the same document to the same text whatever was rendered before it', async () => {
    const alone = await textOf(
      await renderPdf('<html><body><h1>Invoice 42</h1><p>Total 120.00 EUR</p></body></html>'),
    );
    await renderPdf(FIRST_DOCUMENT);

    const afterAnother = await textOf(
      await renderPdf('<html><body><h1>Invoice 42</h1><p>Total 120.00 EUR</p></body></html>'),
    );

    expect(afterAnother).toBe(alone);
  });

  it('leaves cookies, storage, viewport and emulated media exactly as a fresh page has them', async () => {
    const fresh = await browser.newPage({ javaScriptEnabled: false });
    const expected = await stateOf(fresh);
    await fresh.close();

    await renderPdf(STATEFUL_DOCUMENT);

    const pooled = browser.contexts().flatMap((context) => context.pages());
    expect(pooled.length).toBeGreaterThan(0);
    for (const page of pooled) expect(await stateOf(page)).toEqual(expected);
  });

  it('prints the next document on A4 whatever page size the previous one asked for', async () => {
    await renderPdf(STATEFUL_DOCUMENT);

    const { width, height } = await firstPageSize(await renderPdf('<html><body>NEXT</body></html>'));

    expect(width).toBeCloseTo(596, -1);
    expect(height).toBeCloseTo(843, -1);
  });

  it('lets the next document reach the network untouched: no request interception carries over', async () => {
    let requests = 0;
    const server: Server = createServer((_request, response) => {
      requests++;
      response.writeHead(204).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await renderPdf(STATEFUL_DOCUMENT);

      await renderPdf(`<html><body><img src="http://127.0.0.1:${port}/pixel.png">NEXT</body></html>`);

      await vi.waitFor(() => expect(requests).toBe(1));
    } finally {
      server.close();
    }
  });
});
