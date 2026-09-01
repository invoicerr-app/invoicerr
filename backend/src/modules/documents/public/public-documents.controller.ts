/**
 * The PUBLIC half of root TODO item 24 — the one controller in this module `AuthGuard`
 * (src/guards/auth.guard.ts) never gates. Deliberately its OWN controller/module rather than a
 * `@Public()` route bolted onto `DocumentsController`: every other route on that controller is
 * `@ActiveCompany()`-scoped company data, and keeping the one unauthenticated route in a file of its
 * own makes "does this controller require a session" a per-file fact, not a per-method one someone
 * has to read every handler to be sure of.
 *
 * `@Public()` here is `@thallesp/nestjs-better-auth`'s own decorator — NOT
 * `@/decorators/public.decorator.ts` (dead code: nothing in this codebase imports it, and it sets a
 * DIFFERENT metadata key than the one `AuthGuard` actually reads). `AuthGuard`'s own comment says so
 * ("Use the same metadata key as @thallesp/nestjs-better-auth"); `HealthController` and
 * `InvitationsController` already import `Public` from the same place — this follows the ONE
 * decorator that is actually wired to the guard, not the one that merely looks like it is.
 */
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { Public } from '@thallesp/nestjs-better-auth';

import { DocumentsService } from '../documents.service';
import { ShareLinksService } from '../share-links/share-links.service';

@ApiTags('public-documents')
@Controller('public/documents')
export class PublicDocumentsController {
  constructor(
    private readonly shareLinksService: ShareLinksService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Public()
  @Get(':token/pdf')
  @ApiOperation({
    summary: 'Download a shared document PDF — no session required',
    description:
      'Resolves `token` by its hash (never logged, never stored in the clear — see ' +
      'share-links/share-link-token.ts) and, if it is still valid, renders EXACTLY the same PDF the ' +
      'authenticated GET /api/documents/:id/pdf would (byte-for-byte the same rendering + PAdES ' +
      'signing pipeline — documents.service.ts#renderInstancePdf — never a second implementation). ' +
      'An unknown token, an EXPIRED one, and a REVOKED one all answer the exact same 404, with the ' +
      'exact same body: this endpoint never lets a caller distinguish "this link once existed" from ' +
      '"this link was never real". No company data beyond the PDF itself is ever exposed here.',
  })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'PDF retrieved', schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 404, description: 'Unknown, expired, or revoked token — indistinguishable' })
  async getSharedPdf(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const resolved = await this.shareLinksService.resolvePublicToken(token);
    if (!resolved) {
      // The SAME NotFoundException, the SAME message, whichever of the three reasons applies — see
      // `resolvePublicToken`'s own header for why all three cost the same amount of work upstream.
      throw new NotFoundException('Link not found or expired.');
    }

    const pdfBuffer = await this.documentsService.renderInstancePdf(
      resolved.companyId,
      resolved.typeId,
      resolved.documentId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${resolved.typeId}-${resolved.documentId}.pdf"`);
    res.send(pdfBuffer);
  }
}
