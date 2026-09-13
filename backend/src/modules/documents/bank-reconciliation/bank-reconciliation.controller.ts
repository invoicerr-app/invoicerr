import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { ActiveRole } from '@/decorators/active-role.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { BankReconciliationService } from './bank-reconciliation.service';
import { ImportBankStatementDto, ReconcileBankStatementLineDto } from './bank-reconciliation.dto';

/**
 * TODO_FEATURES.md rank 5 ("rapprochement bancaire par import de relevé"). Three bespoke routes —
 * importing a statement and reconciling one line have no generic-document counterpart at all (the
 * same reasoning `received-invoices.controller.ts`'s own header gives for its own two bespoke
 * routes), and listing/reading a statement's own lines is this feature's own read model, not a
 * `DocumentInstance` at all.
 */
@ApiTags('bank-reconciliation')
@Controller('bank-reconciliation')
export class BankReconciliationController {
  constructor(private readonly bankReconciliation: BankReconciliationService) {}

  @Post('statements')
  @ApiOperation({
    summary: 'Import a bank statement (CSV or OFX)',
    description:
      'Parses the file and stores one row per transaction line — never a persisted match: a line ' +
      'only ever produces a real payment once a human confirms one via POST .../lines/:id/reconcile. ' +
      'A CSV file additionally requires `mapping` (see CsvColumnMapping) — OFX is self-describing.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', example: 'releve-2026-08.csv' },
        base64: { type: 'string', description: 'Base64-encoded raw file bytes.' },
        currency: { type: 'string', example: 'EUR' },
        mapping: { type: 'object', description: 'Required for a CSV file, ignored for OFX.' },
      },
      required: ['fileName', 'base64', 'currency'],
    },
  })
  @ApiResponse({ status: 201, description: 'Statement stored, one row per readable transaction line' })
  @ApiResponse({ status: 400, description: 'Missing fields, an invalid mapping, or an unparseable file' })
  async importStatement(@ActiveCompany() companyId: string, @Body() body: ImportBankStatementDto) {
    if (!body?.fileName || !body?.base64 || !body?.currency) {
      throw new BadRequestException('fileName, base64 and currency are required');
    }
    return this.bankReconciliation.importStatement(
      companyId,
      body.fileName,
      body.base64,
      body.currency,
      body.mapping,
    );
  }

  @Get('statements')
  @ApiOperation({ summary: 'List every imported bank statement for the active company' })
  @ApiResponse({ status: 200, description: 'Statements, most recently imported first' })
  listStatements(@ActiveCompany() companyId: string) {
    return this.bankReconciliation.listStatements(companyId);
  }

  @Get('statements/:id/lines')
  @ApiOperation({
    summary: "One statement's own lines, each with its live suggested matches",
    description:
      'Suggestions are computed fresh on every read, never stored — see BankReconciliationService.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'The statement, its outstanding-invoice candidate pool, and its lines',
  })
  @ApiResponse({ status: 404, description: 'Statement not found for this company' })
  getStatementLines(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.bankReconciliation.getStatementLines(companyId, id);
  }

  @Post('lines/:id/reconcile')
  @ApiOperation({
    summary: 'Confirm a match: creates a real invoice payment from a bank statement line',
    description:
      'Runs through the exact same "record-payment" action a hand-entered payment uses — see ' +
      'BankReconciliationService.reconcileLine for why. Refuses (409) a line already reconciled.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({
    schema: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] },
  })
  @ApiResponse({ status: 201, description: 'Reconciled — a DocumentPayment now exists for this line' })
  @ApiResponse({ status: 400, description: 'documentId missing, or the line is a debit (money-out) row' })
  @ApiResponse({ status: 404, description: 'Line, or the named invoice, not found for this company' })
  @ApiResponse({ status: 409, description: 'This line has already been reconciled' })
  reconcileLine(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Body() body: ReconcileBankStatementLineDto,
    @ActiveRole() role: CompanyRole | undefined,
  ) {
    if (!body?.documentId) {
      throw new BadRequestException('documentId is required');
    }
    return this.bankReconciliation.reconcileLine(companyId, id, body.documentId, role);
  }
}
