import { Controller, Get, HttpException, HttpStatus, Logger, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ComplianceService } from '../operations/compliance-service';

@Controller('compliance')
export class AuditExportController {
  private readonly logger = new Logger(AuditExportController.name);

  constructor(private readonly complianceService: ComplianceService) {}

  @Get('audit-export')
  async exportAudit(@Res() res: Response) {
    try {
      const docs = await this.complianceService.list();

      const rows: string[] = [
        'DocumentID,Kind,Direction,Status,Number,ImmutableHash,PreviousHash,CreatedAt,UpdatedAt,EventID,EventType,EventAt,EventActor,EventDetail',
      ];

      for (const doc of docs) {
        const base = [
          doc.id,
          doc.kind,
          doc.direction,
          doc.status,
          doc.number ?? '',
          doc.immutableHash ?? '',
          doc.previousHash ?? '',
          doc.createdAt,
          doc.updatedAt,
        ].map(escapeCsv).join(',');

        if (doc.events.length === 0) {
          rows.push(base + ',,,,,');
        } else {
          for (const ev of doc.events) {
            rows.push(base + ',' + [
              ev.id,
              ev.type,
              ev.at,
              ev.actor ?? '',
              ev.detail ?? '',
            ].map(escapeCsv).join(','));
          }
        }
      }

      const csv = '\uFEFF' + rows.join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="compliance-audit-export.csv"');
      res.status(200).send(csv);
    } catch (error) {
      this.logger.error('Failed to generate audit export', { error: String(error) });
      throw new HttpException('Failed to generate audit export', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
