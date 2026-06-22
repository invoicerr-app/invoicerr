import { SignaturesService } from '@/modules/signatures/signatures.service';
import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { Response } from 'express';

@ApiTags('signatures')
@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) { }

  @Get('/:id')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Get signature status', description: 'Returns the signature request details and status (public, no auth required).' })
  @ApiParam({ name: 'id', type: String, description: 'Signature request ID' })
  @ApiResponse({ status: 200, description: 'Signature retrieved' })
  async getSignature(@Param('id') signatureId: string) {
    return (await this.signaturesService.getSignature(signatureId)) || {};
  }

  @Get('/:id/pdf')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Get signature PDF', description: 'Returns the PDF document to be signed (public, no auth required).' })
  @ApiParam({ name: 'id', type: String, description: 'Signature request ID' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Signature not found' })
  async getSignaturePdf(@Param('id') signatureId: string, @Res() res: Response) {
    const pdfBuffer = await this.signaturesService.getSignaturePdf(signatureId);
    if (!pdfBuffer) {
      res.status(404).send('Signature not found or PDF generation failed');
      return;
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="signature-${signatureId}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(Buffer.from(pdfBuffer));
  }

  @Post('/')
  @ApiOperation({ summary: 'Create a signature request', description: 'Creates a new electronic signature request for a quote.' })
  @ApiResponse({ status: 201, description: 'Signature request created' })
  @ApiBody({ schema: { type: 'object', properties: { quoteId: { type: 'string', description: 'ID of the quote to request a signature for' } } } })
  async createSignature(@Body('quoteId') quoteId: string) {
    return this.signaturesService.createSignature(quoteId);
  }

  @Post('/:id/otp')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Generate OTP code', description: 'Generates and sends a one-time passcode to the signer (public, no auth required).' })
  @ApiParam({ name: 'id', type: String, description: 'Signature request ID' })
  @ApiResponse({ status: 201, description: 'OTP sent' })
  async generateOTPCode(@Param('id') signatureId: string) {
    return this.signaturesService.generateOTPCode(signatureId);
  }

  @Post('/:id/sign')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Sign a quote', description: 'Completes the signature using the OTP code (public, no auth required).' })
  @ApiParam({ name: 'id', type: String, description: 'Signature request ID' })
  @ApiResponse({ status: 201, description: 'Quote signed' })
  @ApiBody({ schema: { type: 'object', properties: { otpCode: { type: 'string', description: 'One-time passcode sent to the signer' } } } })
  async signQuote(
    @Param('id') signatureId: string,
    @Body('otpCode') otpCode: string,
  ) {
    return this.signaturesService.signQuote(signatureId, otpCode);
  }
}
