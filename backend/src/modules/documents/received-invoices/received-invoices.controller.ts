import { RequiresScope } from '@/utils/scope-check';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { memoryStorage } from 'multer';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { ReceivedInvoiceOcrResult } from '../queue/received-invoice-ocr.dispatcher';
import { DEFAULT_TOLERANCE_PERCENT, ReconciliationService } from '../reconciliation/reconciliation.service';
import { ReconciliationSettings } from '../reconciliation/reconciliation-settings';
import { ReceivedInvoiceReconciliationResult } from '../reconciliation/resolve-received-invoice-reconciliation';
import { ReceivedInvoicesService, UploadReceivedInvoicePreview } from './received-invoices.service';
import { MAX_RECEIVED_INVOICE_BYTES } from './upload-validation';

/** What `fileRef` route params in this controller must look like — `computeArtifactHash`'s own SHA-256
 *  hex output (`archive/hashing.ts`), the exact same pattern `storage.ts#assertValidContentHash`
 *  enforces before it ever becomes a filesystem path/S3 key. Checked HERE, at the HTTP boundary,
 *  before a malformed value ever reaches `ReceivedInvoiceOcrDispatcher`/BullMQ — a 400, never a
 *  confusing 404 for "this isn't shaped like a fileRef at all". */
const FILE_REF_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Two bespoke routes — everything else about "received-invoice" (listing,
 * the "receive"/"approve"/"reject"/"delete" actions, the descriptor itself) goes through the fully
 * generic `documents.controller.ts`/`DocumentsService`, exactly like every other document type. Only
 * uploading a file and downloading it back are genuinely NEW operations with no generic-document
 * counterpart, which is why they live here — the same reasoning
 * `company/signing-certificates/signing-certificates.controller.ts` already documents for its own
 * small, type-adjacent controller.
 *
 * Purchase orders & goods receipts, second pass ("three-way match") added the FOUR routes below —
 * genuinely new operations too (a 3-way-match RESULT is not a document instance itself, and neither
 * is a company-wide setting), so they live here on the same "bespoke, type-adjacent" reasoning, rather
 * than being shoehorned through `documents.controller.ts`'s generic action-runner
 * (`POST /documents/types/:typeId/actions/:actionId`) — see `reconciliation-settings.ts`'s own header
 * for why the tolerance setting itself is stored the way it is, without a schema migration.
 */

/**
 * The exact shape `multer`'s `memoryStorage()` engine hands a `@UploadedFile()` parameter — see
 * `documents.controller.ts`'s own identical interface for why this is duplicated rather than shared
 * (independent callers, no `@types/multer` devDependency pulled in just for a type).
 */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('documents')
@Controller('documents/received-invoices')
export class ReceivedInvoicesController {
  constructor(
    private readonly receivedInvoices: ReceivedInvoicesService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /**
   * GET /api/documents/received-invoices/reconciliation-settings — this company's own tolerance
   * (default `DEFAULT_TOLERANCE_PERCENT`, see `reconciliation-settings.ts`). A literal path segment,
   * declared BEFORE the `:id/...` routes further down for clarity — the two never actually collide
   * (different segment counts), but this keeps the more specific, fixed routes easy to find.
   */
  @Get('reconciliation-settings')
  @RequiresScope('received-invoices:read')
  @ApiOperation({ summary: "This company's own 3-way-match tolerance (percent)" })
  @ApiResponse({ status: 200, description: 'The configured tolerance, or the default if never set' })
  async getReconciliationSettings(@ActiveCompany() companyId: string): Promise<ReconciliationSettings> {
    return this.reconciliation.getSettings(companyId);
  }

  /**
   * PUT /api/documents/received-invoices/reconciliation-settings — OWNER/ADMIN only, the same gate
   * every other company-wide configuration write in this codebase holds (see e.g.
   * `signing-certificates.controller.ts`). `tolerancePercent` is a non-negative percentage; 0 is a
   * valid, meaningful value (see `reconciliation/three-way-match.ts`'s own header).
   */
  @Put('reconciliation-settings')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('received-invoices:write')
  @ApiOperation({ summary: "Set this company's own 3-way-match tolerance (percent)" })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { tolerancePercent: { type: 'number', example: DEFAULT_TOLERANCE_PERCENT } },
      required: ['tolerancePercent'],
    },
  })
  @ApiResponse({ status: 200, description: 'The newly saved tolerance' })
  @ApiResponse({ status: 400, description: 'tolerancePercent is missing, negative, or not a number' })
  async setReconciliationSettings(
    @ActiveCompany() companyId: string,
    @Body() body: { tolerancePercent?: number },
  ): Promise<ReconciliationSettings> {
    if (typeof body?.tolerancePercent !== 'number') {
      throw new BadRequestException('tolerancePercent is required and must be a number.');
    }
    return this.reconciliation.setSettings(companyId, body.tolerancePercent);
  }

  /**
   * GET /api/documents/received-invoices/upload/:fileRef/ocr — polled by the upload dialog while an
   * OCR job `upload()` just enqueued (`ocr: { outcome: 'pending' }`) is still running. Declared BEFORE
   * `:id/reconciliation`/`:id/file` below, and before every other `:id`-shaped GET route in this
   * controller, so a `fileRef` segment here is never at risk of being shadowed by an `:id` route
   * matching the same position — the same defensive ordering `reconciliation-settings` above already
   * follows for the identical reason, even though the two never actually collide (different segment
   * counts). Tenant isolation is enforced by `ReceivedInvoiceOcrDispatcher` itself, not by this route:
   * its own job id embeds `companyId` (`queue/received-invoice-ocr.dispatcher.ts`), so a company can
   * never read another's result even by guessing a real `fileRef`.
   */
  @Get('upload/:fileRef/ocr')
  @RequiresScope('received-invoices:read')
  @ApiOperation({ summary: 'Poll the asynchronous OCR result for a pending upload' })
  @ApiParam({
    name: 'fileRef',
    type: String,
    description: 'The 64-character lowercase-hex SHA-256 from the upload response',
  })
  @ApiResponse({
    status: 200,
    description: '{ status: "pending" } while running, or { status: "done", extraction, supplierMatch, ocr }',
  })
  @ApiResponse({ status: 400, description: 'fileRef is not a 64-character lowercase hex SHA-256' })
  @ApiResponse({
    status: 404,
    description: 'No OCR job exists for this company/fileRef — expired or never enqueued',
  })
  async getUploadOcrStatus(
    @ActiveCompany() companyId: string,
    @Param('fileRef') fileRef: string,
  ): Promise<ReceivedInvoiceOcrResult> {
    if (!FILE_REF_PATTERN.test(fileRef)) {
      throw new BadRequestException('fileRef must be a 64-character lowercase hex SHA-256.');
    }
    const result = await this.receivedInvoices.getOcrStatus(companyId, fileRef);
    if (!result) {
      throw new NotFoundException(`No OCR job found for fileRef "${fileRef}".`);
    }
    return result;
  }

  /**
   * GET /api/documents/received-invoices/:id/reconciliation — the FULL 3-way-match result for this
   * received invoice: `{ hasPurchaseOrder: false }` (never a 4xx) for the routine case where it
   * carries no `purchaseOrder` reference at all — see `resolve-received-invoice-reconciliation.ts`'s
   * own header for the full "why this is not an error" reasoning.
   */
  @Get(':id/reconciliation')
  @RequiresScope('received-invoices:read')
  @ApiOperation({ summary: 'The 3-way-match reconciliation for this received invoice' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'The reconciliation result (or hasPurchaseOrder: false)' })
  @ApiResponse({
    status: 404,
    description: 'Not found for this company, or its own purchase order is dangling',
  })
  async getReconciliation(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
  ): Promise<ReceivedInvoiceReconciliationResult> {
    return this.reconciliation.getReconciliation(companyId, id);
  }

  /**
   * POST /api/documents/received-invoices/:id/accept-variance — "A discrepancy is accepted by OWNER
   * or ADMIN" (product decision, 2026-09-15): role-gated the same way `setReconciliationSettings` above
   * is. Records WHO (`@User()`, this session's own authenticated identity — never trusted from the
   * request body) and WHEN (server clock, `variance-acceptance.ts`), plus an optional free-text
   * `reason`. Returns the FRESHLY re-resolved reconciliation, `overallVerdict`/every line's own
   * `verdict` already turned into `'accepted'` — the frontend panel needs no second round-trip.
   */
  @Post(':id/accept-variance')
  @RequiresScope('received-invoices:write')
  // Nest's default for POST is 201 (Created) — wrong here, this action creates nothing (see
  // `verifyDomain` in sso.controller.ts for the same "action, not creation" precedent).
  @HttpCode(200)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Accept the reconciliation variance for this received invoice' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({
    schema: { type: 'object', properties: { reason: { type: 'string' } } },
    required: false,
  })
  @ApiResponse({ status: 200, description: 'The freshly re-resolved reconciliation, now accepted' })
  @ApiResponse({ status: 404, description: 'Not found for this company' })
  async acceptVariance(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @User() user: CurrentUser,
    @Body() body: { reason?: string },
  ): Promise<ReceivedInvoiceReconciliationResult> {
    const label = [user.firstname, user.lastname].filter(Boolean).join(' ').trim() || user.email;
    return this.reconciliation.acceptVariance(companyId, id, user.id, label, body?.reason);
  }

  /**
   * POST /api/documents/received-invoices/upload — stores the file, refuses an exact repeat (named
   * 409), and returns a best-effort extraction PREVIEW — never a persisted document (see the
   * service's own header). The frontend's upload dialog feeds this response straight into a
   * pre-filled "create received-invoice" form; nothing is saved until the user actually confirms via
   * `POST /api/documents/types/received-invoice/actions/receive`.
   */
  // Same `memoryStorage()` + `limits.fileSize` story as `documents.controller.ts#uploadAttachment` —
  // see that route's own comment: an oversized deposit is aborted at the multipart wire (a 413, via
  // `FileInterceptor`'s built-in `MulterError` translation) before this handler, or
  // `ReceivedInvoicesService`, ever runs.
  @Post('upload')
  @RequiresScope('received-invoices:write')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_RECEIVED_INVOICE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an inbound invoice file (PDF, or XML CII/UBL, or Factur-X)',
    description:
      'Stores the file content-addressed and attempts structural field extraction — never refused ' +
      'for an unrecognized STRUCTURE (a plain scanned PDF still stores and returns empty fields), ' +
      'only for a disallowed mime, a magic-byte mismatch, an oversized file, or an exact repeat of ' +
      'an already-received file (same SHA-256) — see ReceivedInvoicesService/upload-validation.ts.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'File stored, extraction preview returned' })
  @ApiResponse({
    status: 400,
    description: 'Missing file, an empty file, a disallowed mime, or a magic-byte mismatch against it',
  })
  @ApiResponse({ status: 409, description: 'This exact file was already received (named, by hash)' })
  @ApiResponse({ status: 413, description: 'The file is over the size limit' })
  async upload(
    @ActiveCompany() companyId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ): Promise<UploadReceivedInvoicePreview> {
    if (!file) {
      throw new BadRequestException('A file is required.');
    }
    return this.receivedInvoices.upload(companyId, {
      fileName: file.originalname,
      mime: file.mimetype,
      bytes: file.buffer,
    });
  }

  /**
   * GET /api/documents/received-invoices/:id/file — the ORIGINAL uploaded bytes, verbatim, for an
   * already-saved received-invoice — the download link the list/detail screen offers next to every
   * record (frontend `custom/received-invoice-download-button.tsx`).
   */
  @Get(':id/file')
  @RequiresScope('received-invoices:read')
  @ApiOperation({ summary: "A received invoice's original uploaded file" })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'File bytes, verbatim',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 404, description: 'Not found for this company, or the file is no longer on disk' })
  async downloadFile(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, fileName, mime } = await this.receivedInvoices.downloadFile(companyId, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(bytes);
  }
}
