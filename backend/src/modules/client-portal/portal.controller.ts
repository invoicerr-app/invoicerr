import { Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { Public } from '@thallesp/nestjs-better-auth';

import { ActivePortalClient } from './active-portal-client.decorator';
import { PortalAuthGuard, PortalIdentity } from './portal-auth.guard';
import { PortalProfile, PortalQuoteRow, PortalService } from './portal.service';

/**
 * The CLIENT-facing half of the portal — every route here is `@Public()` from the GLOBAL `AuthGuard`'s
 * point of view (there is no better-auth session, no API key — see `PortalAuthGuard`'s own header for
 * why that guard, applied class-wide right below, is what ACTUALLY protects every one of these
 * routes) and takes its `companyId`/`clientId` EXCLUSIVELY from `@ActivePortalClient()` — never from a
 * `:clientId` path/query parameter a browser could supply. This is the whole boundary this controller
 * exists to hold: every handler below delegates to `PortalService`, unchanged, with those two values.
 */
@ApiTags('client-portal')
@Controller('portal')
@Public()
@UseGuards(PortalAuthGuard)
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in client and company display names' })
  @ApiResponse({ status: 200, description: 'Profile resolved' })
  getProfile(@ActivePortalClient() { companyId, clientId }: PortalIdentity): Promise<PortalProfile> {
    return this.portalService.getProfile(companyId, clientId);
  }

  @Get('statement')
  @ApiOperation({
    summary: "This client's own account statement",
    description:
      'Exactly `GET /clients/:id/statement` (settlement/client-statement.ts), scoped to the ' +
      "session's own clientId — never a recomputation of the balance.",
  })
  @ApiResponse({ status: 200, description: 'Statement computed' })
  getStatement(@ActivePortalClient() { companyId, clientId }: PortalIdentity) {
    return this.portalService.getStatement(companyId, clientId);
  }

  @Get('quotes')
  @ApiOperation({ summary: 'Every quote awaiting, or already answered by, this client' })
  @ApiResponse({ status: 200, description: 'Quotes listed' })
  listQuotes(@ActivePortalClient() { companyId, clientId }: PortalIdentity): Promise<PortalQuoteRow[]> {
    return this.portalService.listQuotes(companyId, clientId);
  }

  @Post('quotes/:id/request-signature')
  @ApiOperation({
    summary: 'Starts the EXISTING, OTP-hardened signature request for this quote',
    description:
      'Never signs anything itself — it mints the same signature request ' +
      '`SignaturesService.requestSignature` already sends for a company-triggered request, emailing ' +
      'the client the `/signature/:token` link they still have to open and complete.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Quote ID' })
  @ApiResponse({ status: 200, description: 'Signature request sent' })
  @ApiResponse({ status: 404, description: 'Not this client’s quote' })
  @ApiResponse({ status: 409, description: 'Quote no longer awaiting a decision' })
  requestQuoteSignature(
    @ActivePortalClient() { companyId, clientId }: PortalIdentity,
    @Param('id') quoteId: string,
  ) {
    return this.portalService.requestQuoteSignature(companyId, clientId, quoteId);
  }

  @Post('quotes/:id/refuse')
  @ApiOperation({ summary: 'Declines a quote — a reversible preference, not a signature' })
  @ApiParam({ name: 'id', type: String, description: 'Quote ID' })
  @ApiResponse({ status: 200, description: 'Quote refused' })
  @ApiResponse({ status: 404, description: 'Not this client’s quote' })
  @ApiResponse({ status: 409, description: 'Quote no longer awaiting a decision' })
  refuseQuote(@ActivePortalClient() { companyId, clientId }: PortalIdentity, @Param('id') quoteId: string) {
    return this.portalService.refuseQuote(companyId, clientId, quoteId);
  }

  @Post('documents/invoice/:id/checkout-session')
  @ApiOperation({
    summary: "Opens a payment checkout session for this client's own invoice",
    description:
      'The Pay link (online payment). Delegates to `PaymentSessionsService` — never writes a ' +
      "DocumentPayment or touches a provider secret itself. See that service's own header for the " +
      'amount guard (always the fresh outstanding balance), the provider connectivity check (501), and ' +
      'the status check (409) this route can surface.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Invoice ID' })
  @ApiResponse({ status: 200, description: 'Checkout session opened' })
  @ApiResponse({ status: 404, description: 'Not this client’s invoice' })
  @ApiResponse({ status: 409, description: 'Invoice not "sent", or already fully settled' })
  @ApiResponse({ status: 501, description: 'No payment provider connected for this company' })
  createCheckoutSession(
    @ActivePortalClient() { companyId, clientId, token }: PortalIdentity,
    @Param('id') invoiceId: string,
  ) {
    return this.portalService.createInvoiceCheckoutSession(companyId, clientId, invoiceId, token);
  }

  @Get('documents/:typeId/:id/pdf')
  @ApiOperation({
    summary: "One of this client's own documents, as a PDF",
    description:
      'Byte-for-byte the same rendering pipeline the staff-facing download and the public share ' +
      'link both already use. 404s — never 403 — for a document belonging to another client of this ' +
      'same company, or parked in a status this type never exposes to a portal at all.',
  })
  @ApiParam({ name: 'typeId', type: String, description: 'invoice | quote | credit-note' })
  @ApiParam({ name: 'id', type: String, description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Not this client’s document' })
  async getDocumentPdf(
    @ActivePortalClient() { companyId, clientId }: PortalIdentity,
    @Param('typeId') typeId: string,
    @Param('id') documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.portalService.getDocumentPdf(companyId, clientId, typeId, documentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${typeId}-${documentId}.pdf"`);
    res.send(pdf);
  }
}
