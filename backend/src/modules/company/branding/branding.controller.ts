import { BadRequestException, Body, Controller, Delete, Get, Post, Put, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { SetBrandingDto, UploadBrandingLogoDto } from './branding.dto';
import { BrandingService } from './branding.service';

/**
 * Chantier B — document branding settings: accent color, one font from a
 * closed embedded catalog, and a logo, plus the named presets that set both color and font at once.
 * The PDF itself stays a FIXED document (no user-editable content ever reaches it) — see
 * `branding.service.ts`'s own header. GET routes are open to any active-company member (the same
 * posture `channels.controller.ts` already holds for its own GET); only a write touching stored data
 * — the color/font/preset PUT, and both logo mutations — is gated OWNER/ADMIN.
 */
@ApiTags('company')
@Controller('company/branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  @ApiOperation({
    summary: "Get this company's document branding",
    description:
      'Current accent color / font / preset, whether a logo is uploaded, and the full catalog of ' +
      'presets and fonts the settings screen can offer — the catalogs are the single source of ' +
      'truth, never duplicated on the frontend.',
  })
  @ApiResponse({ status: 200, description: 'Branding status retrieved' })
  async get(@ActiveCompany() companyId: string) {
    return this.branding.getBranding(companyId);
  }

  @Put()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Set the accent color, font and/or preset',
    description:
      'A named "preset" sets accentColor/font to that preset\'s own values — UNLESS this same call ' +
      'already carries an explicit accentColor/font, which then wins. Every field is independently ' +
      'nullable: null clears it back to the pre-branding default; a key simply absent from the body ' +
      'leaves the existing stored value untouched.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        preset: { type: 'string', nullable: true, example: 'modern' },
        accentColor: { type: 'string', nullable: true, example: '#1d4ed8' },
        font: { type: 'string', nullable: true, example: 'dmSans' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Branding updated' })
  @ApiResponse({ status: 400, description: 'Unknown preset/font, or accentColor is not a hex color' })
  async set(@ActiveCompany() companyId: string, @Body() body: SetBrandingDto) {
    return this.branding.setBranding(companyId, body ?? {});
  }

  @Post('logo')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Upload the company logo',
    description:
      'Same validation as documents/attachments: image/jpeg, image/png or image/webp only, up to ' +
      '750 KiB. Replaces any previously uploaded logo.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        mime: { type: 'string', example: 'image/png' },
        base64: { type: 'string', description: 'Base64-encoded raw file bytes.' },
      },
      required: ['mime', 'base64'],
    },
  })
  @ApiResponse({ status: 201, description: 'Logo uploaded' })
  @ApiResponse({ status: 400, description: 'Missing mime/base64, an empty file, or a disallowed mime' })
  @ApiResponse({ status: 413, description: 'The file is over the size limit' })
  async uploadLogo(@ActiveCompany() companyId: string, @Body() body: UploadBrandingLogoDto) {
    if (!body?.mime || !body?.base64) {
      throw new BadRequestException('mime and base64 are required.');
    }
    return this.branding.uploadLogo(companyId, body);
  }

  @Delete('logo')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Remove the company logo' })
  @ApiResponse({ status: 200, description: 'Logo removed' })
  async removeLogo(@ActiveCompany() companyId: string) {
    return this.branding.clearLogo(companyId);
  }

  @Get('logo')
  @ApiOperation({ summary: "The company logo's raw stored bytes" })
  @ApiResponse({
    status: 200,
    description: 'Logo bytes, verbatim',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 404, description: 'No logo uploaded for this company' })
  async getLogo(@ActiveCompany() companyId: string, @Res() res: Response): Promise<void> {
    const { bytes, mime } = await this.branding.getLogoBytes(companyId);
    res.setHeader('Content-Type', mime);
    res.send(bytes);
  }

  @Get('preview')
  @ApiOperation({
    summary: 'A sample document rendered with this branding applied',
    description:
      'A fixed sample invoice — never a real document — rendered through the exact same HTML ' +
      "pipeline a real PDF uses, with this company's CURRENT accent color/font/logo applied. Returns " +
      '{ html }; the frontend sanitizes it (DOMPurify) before display.',
  })
  @ApiResponse({ status: 200, description: 'Sample HTML' })
  async preview(@ActiveCompany() companyId: string) {
    const html = await this.branding.preview(companyId);
    return { html };
  }
}
