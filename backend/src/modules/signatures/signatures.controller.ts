import { SignaturesService } from '@/modules/signatures/signatures.service';
import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { Response } from 'express';

@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) { }

  @Get('/:id')
  @AllowAnonymous()
  async getSignature(@Param('id') signatureId: string) {
    return (await this.signaturesService.getSignature(signatureId)) || {};
  }

  @Get('/:id/pdf')
  @AllowAnonymous()
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
  async createSignature(@Body('quoteId') quoteId: string) {
    return this.signaturesService.createSignature(quoteId);
  }

  @Post('/:id/otp')
  @AllowAnonymous()
  async generateOTPCode(@Param('id') signatureId: string) {
    return this.signaturesService.generateOTPCode(signatureId);
  }

  @Post('/:id/sign')
  @AllowAnonymous()
  async signQuote(
    @Param('id') signatureId: string,
    @Body('otpCode') otpCode: string,
  ) {
    return this.signaturesService.signQuote(signatureId, otpCode);
  }
}
