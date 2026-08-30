import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '@/logger/logger.service';

/**
 * Shared browser instance — launched lazily on first call, never closed between renders.
 * Multiple pages are created per render and closed after PDF generation.
 */
let browserInstance: Browser | null = null;

/**
 * Initializes the shared browser instance. Throws with a clear message if launch fails.
 */
async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  try {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
    logger.debug('PDF renderer browser launched', { category: 'documents' });
    return browserInstance;
  } catch (error) {
    logger.error('PDF renderer browser launch failed', {
      category: 'documents',
      details: { message: error instanceof Error ? error.message : String(error) },
    });
    throw new Error(
      `PDF renderer unavailable: Chrome/Chromium could not be launched. ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Renders HTML to PDF buffer using Puppeteer. Throws if the PDF engine fails.
 */
export async function renderPdf(html: string): Promise<Buffer> {
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set content and wait for network to be idle
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    logger.error('PDF rendering failed', {
      category: 'documents',
      details: { message: error instanceof Error ? error.message : String(error) },
    });
    if (error instanceof Error && error.message.includes('PDF renderer unavailable')) {
      throw error;
    }
    throw new Error(`PDF rendering failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    // Always close the page, but never close the browser (shared instance)
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        logger.debug('Page close error (non-fatal)', {
          category: 'documents',
          details: { message: closeError instanceof Error ? closeError.message : String(closeError) },
        });
      }
    }
  }
}
