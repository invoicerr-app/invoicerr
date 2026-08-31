import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { CreateCurrencyRateDto } from './dto/currency-rate.dto';
import { CurrencyRatesService } from './currency-rates.service';

/**
 * Minimal CRUD for manually-entered exchange rates (item 9, root TODO) — GET to list, POST to add
 * one. No PATCH/DELETE: a mis-entered rate is corrected by entering a NEW one with a later `asOf`
 * (it simply outranks the old one at resolution time — see convert.ts's `resolveLatestRate`), the
 * same "never mutate history, add a new fact" posture settlement/payments.ts already holds for
 * `DocumentPayment` (see that file's own header).
 */
@ApiTags('company')
@Controller('company/currency-rates')
export class CurrencyRatesController {
  constructor(private readonly currencyRatesService: CurrencyRatesService) {}

  @Get()
  @ApiOperation({
    summary: 'List currency rates',
    description: 'Returns every manually-entered exchange rate for the current company, newest first.',
  })
  @ApiResponse({ status: 200, description: 'Currency rates retrieved' })
  async list(@ActiveCompany() companyId: string) {
    return this.currencyRatesService.list(companyId);
  }

  @Post()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Add a currency rate',
    description:
      'Records a manually-entered exchange rate (source: "manual"). Rejects rate <= 0 and from === to.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Currency converted FROM, e.g. "USD"' },
        to: { type: 'string', description: 'Currency converted TO, e.g. "EUR"' },
        rate: { type: 'number', description: 'Units of "to" per one unit of "from"' },
        asOf: { type: 'string', description: 'ISO date-time this rate became true; defaults to now' },
      },
      required: ['from', 'to', 'rate'],
    },
  })
  @ApiResponse({ status: 201, description: 'Currency rate created' })
  async create(@ActiveCompany() companyId: string, @Body() body: CreateCurrencyRateDto) {
    return this.currencyRatesService.create({
      companyId,
      from: body.from,
      to: body.to,
      rate: body.rate,
      asOf: body.asOf ? new Date(body.asOf) : new Date(),
    });
  }
}
