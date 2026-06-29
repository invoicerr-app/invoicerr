import 'dotenv/config'

import * as puppeteer from 'puppeteer';

export function getInvertColor(hex: string): string {
    let cleanHex = hex.replace(/^#/, '');
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split('').map(c => c + c).join('');
    }

    const r = parseInt(cleanHex.slice(0, 2), 16);
    const g = parseInt(cleanHex.slice(2, 4), 16);
    const b = parseInt(cleanHex.slice(4, 6), 16);

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    return luminance > 186 ? '#000000' : '#ffffff';
}

export const getPDF = async (html: string) => {
    let browser: puppeteer.Browser;
    if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
    } else {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    }
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

    await browser.close();

    return pdfBuffer;
}