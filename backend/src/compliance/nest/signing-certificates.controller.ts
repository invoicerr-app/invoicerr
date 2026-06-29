/**
 * SigningCertificatesController — CRUD for per-company signing certs.
 *
 * All endpoints are on /compliance/signing-certificates/companies/:id.
 * Secret material (PFX bytes, private key, password) is NEVER returned —
 * list/get endpoints return metadata only.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CertificateMetaResponse,
  SigningCertificatesService,
  UploadCertificateBody,
} from '@/modules/signing-certificates/signing-certificates.service';

@ApiTags('signing-certificates')
@Controller('compliance/signing-certificates/companies')
export class SigningCertificatesController {
  constructor(private readonly certs: SigningCertificatesService) {}

  /**
   * GET /compliance/signing-certificates/companies/:id
   * List signing certs for a company — metadata only, no secrets.
   */
  @Get(':id')
  @ApiOperation({ summary: 'List signing certificates for a company (metadata only)' })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Certificate list (no PFX / no password)' })
  listCerts(@Param('id') companyId: string): Promise<CertificateMetaResponse[]> {
    return this.certs.listForCompany(companyId);
  }

  /**
   * POST /compliance/signing-certificates/companies/:id
   * Upload a PFX (PKCS#12) signing certificate.
   * The PFX and password are encrypted at rest. Only metadata is returned.
   */
  @Post(':id')
  @ApiOperation({ summary: 'Upload a signing certificate (PFX + password, write-only)' })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
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
  async uploadCert(
    @Param('id') companyId: string,
    @Body() body: UploadCertificateBody,
  ): Promise<CertificateMetaResponse> {
    if (!body.pfxBase64 || !body.pfxPassword) {
      throw new BadRequestException('pfxBase64 and pfxPassword are required');
    }
    try {
      return await this.certs.upload(companyId, body);
    } catch (err) {
      throw new BadRequestException(
        `Failed to store signing certificate: ${(err as Error).message}`,
      );
    }
  }

  /**
   * DELETE /compliance/signing-certificates/companies/:id/:certId
   * Hard-delete a signing certificate.
   */
  @Delete(':id/:certId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a signing certificate' })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiParam({ name: 'certId', type: String, description: 'Certificate record ID' })
  @ApiResponse({ status: 204, description: 'Certificate deleted' })
  async deleteCert(
    @Param('id') companyId: string,
    @Param('certId') certId: string,
  ): Promise<void> {
    return this.certs.delete(companyId, certId);
  }
}
