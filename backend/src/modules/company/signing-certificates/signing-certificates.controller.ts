import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import {
  CertificateMetaResponse,
  SigningCertificatesService,
  UploadCertificateBody,
} from './signing-certificates.service';

/**
 * Root TODO item 13 ("Signature électronique") — the settings screen this backs is "Signing
 * certificates" (company settings). Every handler is scoped to the caller's ACTIVE company
 * (`@ActiveCompany()`) — never a URL parameter — the exact same discipline `channels.controller.ts`
 * already holds, and the fix for the cross-tenant IDOR the repère's own
 * `signing-certificates.controller.spec.ts` regression-tested (`compliance/nest/`, git tag
 * `avant-refonte-documents`): that controller trusted `@Param('id')` for the company id. This one has
 * no such parameter to trust in the first place — GET/POST are company-scoped exactly like
 * `GET/PUT /api/company/channels`, and the only path param anywhere below (`:id` on DELETE) names a
 * CERTIFICATE, not a company, and `deactivate()` itself re-checks `companyId` in its own `WHERE`.
 *
 * Upload/deactivate are OWNER/ADMIN-only (`@Roles`) — this is the credential that signs this
 * company's outbound documents, the same sensitivity level `channels.controller.ts`'s own PUT/DELETE
 * already carry for transmission credentials.
 */
@ApiTags('company')
@Controller('company/signing-certificates')
export class SigningCertificatesController {
  constructor(private readonly certs: SigningCertificatesService) {}

  /**
   * GET /api/company/signing-certificates — metadata only (label, applicability, environment,
   * validity, serial, subject, isActive) — NEVER the PFX or the password, see
   * `signing-certificates.service.ts#toMeta`'s own header.
   */
  @Get()
  @ApiOperation({ summary: 'List signing certificates for the active company (metadata only)' })
  @ApiResponse({ status: 200, description: 'Certificate list (no PFX / no password)' })
  list(@ActiveCompany() companyId: string): Promise<CertificateMetaResponse[]> {
    return this.certs.listForCompany(companyId);
  }

  /**
   * POST /api/company/signing-certificates — upload a PFX (PKCS#12) signing certificate. The PFX and
   * password are encrypted at rest as two separate blobs; only metadata is returned. A corrupt file,
   * a wrong password, or an already-expired certificate all refuse NOISILY (400, named message) —
   * never a silently-stored, silently-unusable certificate.
   */
  @Post()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Upload a signing certificate (PFX + password, write-only)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        label: { type: 'string', example: 'FR production cert 2025' },
        applicability: {
          type: 'string',
          example: '*',
          description: '"*" for all algorithms, or "XAdES" / "CAdES" / "PAdES"',
        },
        environment: { type: 'string', enum: ['TEST', 'PROD'], default: 'TEST' },
        pfxBase64: {
          type: 'string',
          description: 'Base64-encoded PKCS#12 (.pfx) file — write-only, never returned.',
        },
        pfxPassword: {
          type: 'string',
          description: 'Password for the PKCS#12 bundle — write-only, never returned.',
        },
      },
      required: ['label', 'pfxBase64', 'pfxPassword'],
    },
  })
  @ApiResponse({ status: 201, description: 'Certificate stored (metadata returned, no secrets)' })
  async upload(
    @ActiveCompany() companyId: string,
    @Body() body: UploadCertificateBody,
  ): Promise<CertificateMetaResponse> {
    if (!body?.pfxBase64 || !body?.pfxPassword || !body?.label) {
      throw new BadRequestException('label, pfxBase64 and pfxPassword are required');
    }
    try {
      return await this.certs.upload(companyId, body);
    } catch (err) {
      throw new BadRequestException(`Failed to store signing certificate: ${(err as Error).message}`);
    }
  }

  /**
   * DELETE /api/company/signing-certificates/:id — deactivates the certificate (soft: `isActive:
   * false`, the row stays for audit history — see `signing-certificates.service.ts#deactivate`'s own
   * header for why this is not a hard delete the way `channels`'s own DELETE is).
   */
  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate a signing certificate' })
  @ApiParam({ name: 'id', type: String, description: 'Certificate record ID' })
  @ApiResponse({ status: 200, description: 'Certificate deactivated' })
  deactivate(
    @ActiveCompany() companyId: string,
    @Param('id') certId: string,
  ): Promise<{ deactivated: boolean }> {
    return this.certs.deactivate(companyId, certId);
  }
}
