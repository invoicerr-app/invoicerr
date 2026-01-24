/**
 * PDF Renderer
 * Converts HTML to PDF using Puppeteer
 */

import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { IDocumentRenderer, OutputFormat, RenderOptions } from '../document.types';

@Injectable()
export class PDFRenderer implements IDocumentRenderer {
  private readonly logger = new Logger(PDFRenderer.name);

  /**
   * Render HTML to PDF
   */
  async render(
    html: string,
    format: OutputFormat,
    options?: RenderOptions,
  ): Promise<Buffer> {
    let browser: Browser | null = null;

    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();

      // Set content
      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      // Generate PDF
      const pdfOptions: Parameters<typeof page.pdf>[0] = {
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm',
        },
      };

      // For PDF/A compliance (used in Factur-X)
      if (options?.pdfACompliant) {
        pdfOptions.tagged = true;
      }

      const pdfBuffer = await page.pdf(pdfOptions);

      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error('Failed to render PDF', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Render HTML to PDF with custom page size
   */
  async renderWithSize(
    html: string,
    width: string,
    height: string,
  ): Promise<Buffer> {
    let browser: Browser | null = null;

    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        width,
        height,
        printBackground: true,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
