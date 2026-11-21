import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';
import { RequiresDocumentTypeScope } from '@/utils/scope-check';

import { PaymentLedgerService } from './payment-ledger.service';

function sendFile(res: Response, contentType: string, fileName: string, body: string, sha256?: string): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  if (sha256) res.setHeader('X-Content-SHA256', sha256);
  res.send(body);
}

@ApiTags('payment-ledger')
@Controller('payment-ledger')
export class PaymentLedgerController {
  constructor(private readonly service: PaymentLedgerService) {}

  @Get('verify')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({ summary: 'Recompute every hash and signature of the payment ledger and its closures' })
  verify(@ActiveCompany() companyId: string) {
    return this.service.verify(companyId);
  }

  @Get('closures')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({ summary: 'Daily, monthly and yearly closures, writing those of elapsed periods first' })
  @ApiQuery({ name: 'kind', required: false, enum: ['DAILY', 'MONTHLY', 'YEARLY'] })
  closures(@ActiveCompany() companyId: string, @Query('kind') kind: string | undefined) {
    return this.service.listClosures(companyId, kind);
  }

  @Post('payments/:id/reverse')
  @RequiresDocumentTypeScope('write', 'every-type')
  @ApiOperation({ summary: 'Cancel a payment by recording its negative counterpart; the original is kept' })
  reverse(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string; paidAt?: string },
  ) {
    const paidAt = body?.paidAt ? new Date(body.paidAt) : undefined;
    if (paidAt && Number.isNaN(paidAt.getTime())) throw new BadRequestException('paidAt is not a valid date');
    return this.service.reverse(companyId, id, { reason: body?.reason ?? '', paidAt });
  }

  @Get('obligation')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({ summary: "The company's country rules for cash-recording software, or null" })
  obligation(@ActiveCompany() companyId: string) {
    return this.service.obligation(companyId);
  }

  @Get('attestation')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({ summary: "The publisher attestation following the company's country model, as text" })
  @ApiResponse({ status: 200, schema: { type: 'string' } })
  async attestation(@ActiveCompany() companyId: string, @Res() res: Response): Promise<void> {
    const attestation = await this.service.attestation(companyId);
    res.setHeader('X-Attestation-Missing', attestation.missing.join(','));
    sendFile(res, 'text/plain; charset=utf-8', `${attestation.fileName}.txt`, attestation.text);
  }

  @Get('archives')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({ summary: 'Every archive generated so far, newest first' })
  archives(@ActiveCompany() companyId: string) {
    return this.service.listArchives(companyId);
  }

  @Post('archives')
  @RequiresDocumentTypeScope('write', 'every-type')
  @ApiOperation({ summary: 'Generate, keep and download the archive of one calendar year' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  async generateArchive(
    @ActiveCompany() companyId: string,
    @User() user: CurrentUser,
    @Query('year') year: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.service.generateArchive(companyId, Number(year), user?.id ?? null);
    sendFile(res, 'application/json; charset=utf-8', file.fileName, file.body, file.sha256);
  }

  @Get('archives/:id')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({ summary: 'Download an archive exactly as it was generated' })
  async downloadArchive(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.service.getArchive(companyId, id);
    sendFile(res, 'application/json; charset=utf-8', file.fileName, file.body, file.sha256);
  }
}
