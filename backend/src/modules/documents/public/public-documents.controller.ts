/**
 * The PUBLIC half of the share-link feature — the one controller in this module `AuthGuard`
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
import { Throttle } from '@nestjs/throttler';
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

  /**
   * 10 requests per minute per IP — the SAME figure `PublicSignaturesController`'s own
   * `GET :token/document` carries, and for the same reason stated there: an anonymous caller can make
   * this route start a real Chromium render. The global default (120/min, `app.module.ts`'s
   * `ThrottlerModule.forRoot`) is sized for ordinary JSON handlers and is the wrong bound for the
   * most expensive thing an unauthenticated request can ask this product to do.
   *
   * This route is in fact the costlier of the two: its sibling freezes what it renders and serves the
   * same bytes on every later call, whereas `renderInstancePdf` only skips the render when the
   * document already has a send-time archive — an issued-but-never-sent document has none, so every
   * call re-renders (and re-signs, when the company has a PAdES certificate). So 10/min is a ceiling
   * here, not a generous allowance; a recipient opening or reloading their own invoice stays far
   * below it.
   *
   * The renderer now starts its browser at process boot (rendering/pdf-renderer-warmup.service.ts),
   * which changes the SHAPE of the cost but not the need for this limit: what a burst consumes is
   * `PDF_RENDER_CONCURRENCY` slots (render-pdf.ts, default 4), and that semaphore QUEUES rather than
   * rejects — so unbounded anonymous renders do not fail loudly, they push every other PDF on the
   * instance (authenticated downloads included) behind them.
   */
  @Public()
  @Get(':token/pdf')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Download a shared document PDF — no session required',
    description:
      'Resolves `token` by its hash (never logged, never stored in the clear — see ' +
      'share-links/share-link-token.ts) and, if it is still valid, serves EXACTLY the same PDF the ' +
      'authenticated GET /api/documents/:id/pdf would — documents.service.ts#renderInstancePdf, never ' +
      'a second implementation, and never a second Chromium launch on THIS route either: an ' +
      'already-sent document is served straight from its own send-time archive; only a document with ' +
      'nothing archived yet renders fresh (still the same rendering + PAdES signing pipeline). ' +
      'An unknown token, an EXPIRED one, and a REVOKED one all answer the exact same 404, with the ' +
      'exact same body: this endpoint never lets a caller distinguish "this link once existed" from ' +
      '"this link was never real". No company data beyond the PDF itself is ever exposed here. ' +
      '`Cache-Control: private, no-store`, the same header the signature route ' +
      '(public-signatures.controller.ts) sets for the same reason: a real invoice or quote must not ' +
      "be written to any cache, least of all a shared machine's own browser disk cache, where it " +
      'would reopen without the token.',
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
    // The SAME header the signature route already sets (public-signatures.controller.ts), for the
    // same reason and now with the same words. `no-store` is the operative half: it forbids WRITING
    // the response to any cache at all, which is what keeps a real invoice out of the browser's own
    // disk cache on a shared machine, where it would reopen later with no token in sight. `private`
    // adds the narrower promise — no SHARED cache may hold it — and is kept for the intermediaries
    // that honour it while treating `no-store` loosely. Never `no-cache`: that one permits storing
    // and only demands revalidation, which is not the promise this response needs.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdfBuffer);
  }
}
