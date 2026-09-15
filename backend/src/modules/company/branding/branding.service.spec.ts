/**
 * `BrandingService` in isolation — Prisma is mocked at its own entry point (the same discipline
 * `channels.service.spec.ts` already holds), so this proves the SERVICE's own logic: preset
 * resolution precedence, hex/font validation, and the undefined-vs-null write semantics. The LOGO
 * store itself is exercised for REAL against a temp `DOCUMENTS_INBOUND_DIR` (like
 * `logo-storage.spec.ts`) rather than mocked — a service test that mocked its own storage layer too
 * would prove nothing beyond "this service calls that function", which `logo-storage.spec.ts` already
 * covers more directly; wiring the two together for real is the thing THIS file needs to prove.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { BrandingService } from './branding.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock; update: jest.Mock };
};

const BASE_COMPANY = {
  name: 'Acme Corp',
  address: '1 Main St',
  city: 'Springfield',
  postalCode: '12345',
  country: 'France',
  brandingAccentColor: null as string | null,
  brandingFont: null as string | null,
  brandingPreset: null as string | null,
  brandingLogoId: null as string | null,
};

describe('BrandingService', () => {
  let service: BrandingService;
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BrandingService();
    dir = mkdtempSync(join(tmpdir(), 'branding-service-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
    mockedPrisma.company.findUnique.mockResolvedValue({ ...BASE_COMPANY });
    mockedPrisma.company.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...BASE_COMPANY, ...data }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
  });

  describe('getBranding', () => {
    it('returns the stored status PLUS the full preset/font catalogs', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({
        ...BASE_COMPANY,
        brandingAccentColor: '#1d4ed8',
        brandingFont: 'inter',
        brandingPreset: 'classic',
        brandingLogoId: 'abc',
      });

      const status = await service.getBranding('company-1');

      expect(status.accentColor).toBe('#1d4ed8');
      expect(status.font).toBe('inter');
      expect(status.preset).toBe('classic');
      expect(status.hasLogo).toBe(true);
      expect(status.presets.map((p) => p.id)).toEqual(['classic', 'modern', 'minimal', 'bold']);
      expect(status.fonts).toHaveLength(5);
    });

    it('a company with NO branding at all reports null/false for everything', async () => {
      const status = await service.getBranding('company-1');
      expect(status).toMatchObject({ accentColor: null, font: null, preset: null, hasLogo: false });
    });

    it('404s, named, for an unknown company', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue(null);
      await expect(service.getBranding('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setBranding', () => {
    it('writes an explicit accentColor and font directly', async () => {
      await service.setBranding('company-1', { accentColor: '#b91c1c', font: 'lora' });

      expect(mockedPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { brandingAccentColor: '#b91c1c', brandingFont: 'lora' },
      });
    });

    it('a key simply absent from the body is never sent to Prisma at all', async () => {
      await service.setBranding('company-1', { accentColor: '#b91c1c' });

      const call = mockedPrisma.company.update.mock.calls[0][0];
      expect(call.data).toEqual({ brandingAccentColor: '#b91c1c' });
      expect('brandingFont' in call.data).toBe(false);
    });

    it('an explicit null CLEARS the field back to the pre-branding default', async () => {
      await service.setBranding('company-1', { accentColor: null });
      expect(mockedPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { brandingAccentColor: null },
      });
    });

    it('rejects an invalid hex color, named', async () => {
      await expect(service.setBranding('company-1', { accentColor: 'blue' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setBranding('company-1', { accentColor: '#fff' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an unknown font key, named', async () => {
      await expect(service.setBranding('company-1', { font: 'comic-sans' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an unknown preset id, named', async () => {
      await expect(service.setBranding('company-1', { preset: 'not-a-real-preset' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('a named preset sets BOTH accentColor and font to its own values', async () => {
      await service.setBranding('company-1', { preset: 'modern' });

      expect(mockedPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { brandingAccentColor: '#0f766e', brandingFont: 'dmSans', brandingPreset: 'modern' },
      });
    });

    it('an explicit accentColor in the SAME call wins over the preset default', async () => {
      await service.setBranding('company-1', { preset: 'modern', accentColor: '#000000' });

      const call = mockedPrisma.company.update.mock.calls[0][0];
      expect(call.data.brandingAccentColor).toBe('#000000');
      // The font side of the SAME preset still applies — only the overridden field changes.
      expect(call.data.brandingFont).toBe('dmSans');
      expect(call.data.brandingPreset).toBe('modern');
    });
  });

  describe('logo upload / clear / read', () => {
    it('uploadLogo stores the bytes and writes the resulting id onto brandingLogoId', async () => {
      const base64 = Buffer.from('logo bytes', 'utf-8').toString('base64');
      const status = await service.uploadLogo('company-1', { mime: 'image/png', base64 });

      expect(status.hasLogo).toBe(true);
      const call = mockedPrisma.company.update.mock.calls[0][0];
      expect(call.data.brandingLogoId).toMatch(/^[0-9a-f]{64}$/);
    });

    it('getLogoBytes reads back exactly what uploadLogo wrote', async () => {
      const base64 = Buffer.from('logo bytes', 'utf-8').toString('base64');
      await service.uploadLogo('company-1', { mime: 'image/png', base64 });
      const logoId = mockedPrisma.company.update.mock.calls[0][0].data.brandingLogoId;
      mockedPrisma.company.findUnique.mockResolvedValue({ ...BASE_COMPANY, brandingLogoId: logoId });

      const { bytes, mime } = await service.getLogoBytes('company-1');
      expect(bytes.toString('utf-8')).toBe('logo bytes');
      expect(mime).toBe('image/png');
    });

    it('getLogoBytes 404s, named, when no logo was ever uploaded', async () => {
      await expect(service.getLogoBytes('company-1')).rejects.toThrow(NotFoundException);
    });

    it('clearLogo sets brandingLogoId back to null', async () => {
      await service.clearLogo('company-1');
      expect(mockedPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { brandingLogoId: null },
      });
    });
  });

  describe('preview', () => {
    it('renders the sample document through the real render-html pipeline, with this branding applied', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({
        ...BASE_COMPANY,
        brandingAccentColor: '#b91c1c',
        brandingFont: 'lora',
      });

      const html = await service.preview('company-1');

      expect(html).toContain('Acme Corp');
      expect(html).toContain('Sample Client SARL');
      expect(html.split('#b91c1c').length - 1).toBe(4);
      expect(html).toContain('InvoicerrBrandLora');
    });

    it('a company with no branding previews the exact pre-branding default', async () => {
      const html = await service.preview('company-1');
      expect(html.split('#007bff').length - 1).toBe(4);
      expect(html).not.toContain('@font-face');
    });
  });
});
