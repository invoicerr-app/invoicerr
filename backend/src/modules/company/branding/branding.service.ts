/**
 * Chantier B (2026-09-15 product decision) — "the PDF stays a FIXED
 * document, only THREE brand fields personalize it: logo, accent color, font". This is the
 * `Controller → Service → Prisma` surface for `Company.brandingLogoId`/`brandingAccentColor`/
 * `brandingFont`/`brandingPreset` — `branding.controller.ts` never touches Prisma or the logo store
 * directly. The catalogs this reads from (`FONT_CATALOG`, `BRANDING_PRESETS`) live under
 * `documents/rendering/branding/` — plain, DI-free modules reused here by IMPORT, never by Nest
 * injection, so `CompanyModule` gains no dependency on `DocumentsModule`/`DocumentsCoreModule` (the
 * same avoid-a-cross-module-cycle reasoning `mail-settings/company-mail-settings.resolver.ts`'s own
 * header documents for why IT never imports `MailService` either).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { DocumentTypeDescriptor } from '@/modules/documents/descriptors/types';
import {
  BrandingFontCatalogEntry,
  FONT_CATALOG,
  isBrandingFontKey,
} from '@/modules/documents/rendering/branding/font-catalog';
import {
  logoDataUriFor,
  readLogo,
  uploadLogo as storeLogo,
} from '@/modules/documents/rendering/branding/logo-storage';
import {
  BRANDING_PRESETS,
  BrandingPreset,
  brandingPresetById,
} from '@/modules/documents/rendering/branding/presets';
import { renderDocumentHtml } from '@/modules/documents/rendering/render-html';
import prisma from '@/prisma/prisma.service';

import { SetBrandingDto, UploadBrandingLogoDto } from './branding.dto';
import {
  SAMPLE_PREVIEW_DESCRIPTOR,
  SAMPLE_PREVIEW_INSTANCE,
  SAMPLE_PREVIEW_TOTALS,
} from './sample-preview-document';

/** Same shape `render-html.ts`'s `DEFAULT_ACCENT_COLOR` is validated against — `#` plus exactly six
 *  hex digits, never a 3-digit shorthand or a named CSS color: `render-html.ts` drops this straight
 *  into an inline `style` attribute with no further parsing, so the stored value must already be
 *  exactly what CSS expects. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

interface BrandingColumns {
  brandingAccentColor: string | null;
  brandingFont: string | null;
  brandingPreset: string | null;
  brandingLogoId: string | null;
}

export interface BrandingStatus {
  accentColor: string | null;
  font: string | null;
  preset: string | null;
  hasLogo: boolean;
  /** The full catalog, so the frontend never hardcodes a second copy of either list — see this
   *  module's own header on why both catalogs live under `documents/rendering/branding/`. */
  presets: readonly BrandingPreset[];
  fonts: { key: string; label: string }[];
}

@Injectable()
export class BrandingService {
  async getBranding(companyId: string): Promise<BrandingStatus> {
    const company = await this.findCompanyOrThrow(companyId);
    return this.toStatus(company);
  }

  /**
   * Sets accent color / font / preset. A named `preset` is only ever a STARTING point (see
   * `Company.brandingPreset`'s own schema.prisma comment): its `accentColor`/`font` apply ONLY where
   * this SAME call does not already carry an explicit one, which is what lets a single "pick a preset
   * and tweak the color before saving" submit apply both in one write. `preset` itself is stored
   * verbatim regardless — even when overridden — as the label of where the two started from; only an
   * UNKNOWN preset id is refused, never one that happens to be about to have its own values overridden.
   */
  async setBranding(companyId: string, dto: SetBrandingDto): Promise<BrandingStatus> {
    await this.findCompanyOrThrow(companyId);

    let accentColor = dto.accentColor;
    let font = dto.font;

    if (dto.preset) {
      const preset = brandingPresetById(dto.preset);
      if (!preset) {
        throw new BadRequestException(
          `Unknown branding preset "${dto.preset}" — expected one of: ` +
            `${BRANDING_PRESETS.map((p) => p.id).join(', ')}.`,
        );
      }
      accentColor = accentColor === undefined ? preset.accentColor : accentColor;
      font = font === undefined ? preset.font : font;
    }

    if (accentColor !== undefined && accentColor !== null && !HEX_COLOR_PATTERN.test(accentColor)) {
      throw new BadRequestException('accentColor must be a hex color like "#1a2b3c".');
    }
    if (font !== undefined && font !== null && !isBrandingFontKey(font)) {
      throw new BadRequestException(
        `Unknown font "${font}" — expected one of: ${FONT_CATALOG.map((f) => f.key).join(', ')}.`,
      );
    }

    // Each of the three columns is written ONLY when this call actually carries a value for it
    // (`undefined` — the key simply absent from the body — must leave the existing stored value
    // untouched; only an explicit `null` clears it). Built up rather than a bare object literal so
    // TypeScript's own `exactOptionalPropertyTypes`-adjacent concern never arises: a key that is
    // never assigned is a key Prisma never sees, not a key present with value `undefined`.
    const data: {
      brandingAccentColor?: string | null;
      brandingFont?: string | null;
      brandingPreset?: string | null;
    } = {};
    if (accentColor !== undefined) data.brandingAccentColor = accentColor;
    if (font !== undefined) data.brandingFont = font;
    if (dto.preset !== undefined) data.brandingPreset = dto.preset;

    const updated = await prisma.company.update({
      where: { id: companyId },
      data,
    });

    logger.info('Company branding updated', { category: 'company', details: { companyId } });
    return this.toStatus(updated);
  }

  async uploadLogo(companyId: string, dto: UploadBrandingLogoDto): Promise<BrandingStatus> {
    await this.findCompanyOrThrow(companyId);
    if (!dto?.mime || !dto?.base64) {
      throw new BadRequestException('mime and base64 are required.');
    }

    const logoId = storeLogo(companyId, { mime: dto.mime, base64: dto.base64 });
    const updated = await prisma.company.update({
      where: { id: companyId },
      data: { brandingLogoId: logoId },
    });

    logger.info('Company branding logo uploaded', { category: 'company', details: { companyId } });
    return this.toStatus(updated);
  }

  async clearLogo(companyId: string): Promise<BrandingStatus> {
    await this.findCompanyOrThrow(companyId);
    const updated = await prisma.company.update({
      where: { id: companyId },
      data: { brandingLogoId: null },
    });
    logger.info('Company branding logo removed', { category: 'company', details: { companyId } });
    return this.toStatus(updated);
  }

  /** The raw stored logo bytes — backs `GET /api/company/branding/logo`, the source both the
   *  settings screen's own `<img>` and (via `logoDataUriFor`) the real PDF pipeline read from. */
  async getLogoBytes(companyId: string): Promise<{ bytes: Buffer; mime: string }> {
    const company = await this.findCompanyOrThrow(companyId);
    const logo = readLogo(companyId, company.brandingLogoId);
    if (!logo) {
      throw new NotFoundException('This company has no branding logo uploaded.');
    }
    return logo;
  }

  /**
   * A full sample document, rendered through the EXACT SAME `render-html.ts` a real invoice uses,
   * with this company's CURRENT branding applied — see `sample-preview-document.ts`'s own header for
   * why the sample is a fixed, self-contained descriptor rather than a real invoice.
   */
  async preview(companyId: string): Promise<string> {
    const company = await this.findCompanyOrThrow(companyId);
    return renderDocumentHtml({
      descriptor: SAMPLE_PREVIEW_DESCRIPTOR as DocumentTypeDescriptor,
      instance: SAMPLE_PREVIEW_INSTANCE,
      company: {
        name: company.name || 'Your Company',
        address: company.address,
        city: company.city,
        postalCode: company.postalCode,
        country: company.country,
      },
      referenceLabels: {},
      totals: SAMPLE_PREVIEW_TOTALS,
      branding: {
        accentColor: company.brandingAccentColor,
        font: company.brandingFont,
        logoDataUri: logoDataUriFor(companyId, company.brandingLogoId),
      },
    });
  }

  private async findCompanyOrThrow(
    companyId: string,
  ): Promise<
    BrandingColumns & { name: string; address: string; city: string; postalCode: string; country: string }
  > {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        address: true,
        city: true,
        postalCode: true,
        country: true,
        brandingAccentColor: true,
        brandingFont: true,
        brandingPreset: true,
        brandingLogoId: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  private toStatus(company: BrandingColumns): BrandingStatus {
    return {
      accentColor: company.brandingAccentColor,
      font: company.brandingFont,
      preset: company.brandingPreset,
      hasLogo: !!company.brandingLogoId,
      presets: BRANDING_PRESETS,
      fonts: FONT_CATALOG.map((entry: BrandingFontCatalogEntry) => ({ key: entry.key, label: entry.label })),
    };
  }
}
