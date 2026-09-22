import { RequiresScope } from '@/utils/scope-check';
import { BadRequestException, Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { AtcudSeriesResponse, AtcudSeriesService, UpsertAtcudSeriesBody } from './atcud-series.service';

/**
 * "Séries ATCUD" — the settings screen this backs lets a Portuguese company record the AT-issued
 * validation code for each (série × tipo de documento) it registered on the Portal das Finanças,
 * BEFORE issuing any invoice in that series (AT FAQ 4308, quoted verbatim in `documents/
 * country-policy/data/pt.json`). Scoped to the caller's ACTIVE company (`@ActiveCompany()`) — never a
 * URL parameter — the same discipline `SigningCertificatesController`/`ChannelsController` already
 * hold; the only path param anywhere below (`:id` on DELETE) names a ROW, not a company, and
 * `remove()` itself re-checks `companyId` in its own `WHERE`.
 *
 * Upsert/delete are OWNER/ADMIN-only, same sensitivity tier `ChannelsController`'s own PUT/DELETE
 * already carry: this value gates whether a real invoice can even be issued.
 */
@ApiTags('company')
@Controller('company/atcud-series')
export class AtcudSeriesController {
  constructor(private readonly atcudSeries: AtcudSeriesService) {}

  /** GET /api/company/atcud-series — every series this company has registered. The validation code is
   *  NOT a secret (it is printed on every invoice — Portaria n.º 195/2020, art. 4.º n.º 1) so, unlike
   *  a signing certificate's metadata-only list, it is returned in full. */
  @Get()
  @RequiresScope('company:read')
  @ApiOperation({ summary: "List this company's registered ATCUD series validation codes" })
  @ApiResponse({ status: 200, description: 'ATCUD series list' })
  list(@ActiveCompany() companyId: string): Promise<AtcudSeriesResponse[]> {
    return this.atcudSeries.listForCompany(companyId);
  }

  /**
   * PUT /api/company/atcud-series — create or update the validation code for one (typeId, seriesId)
   * pair. `seriesId` is the exact series identifier this company's own invoice number format would
   * produce for the period being registered (e.g. "FT 2026" for a company numbering
   * "FT {year}/{number:4}") — see `documents/numbering/atcud.ts#parseAtcudPattern`'s own header for
   * how that format requirement is checked at issuance time.
   */
  @Put()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({ summary: 'Register (or update) an ATCUD series validation code' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        typeId: { type: 'string', example: 'invoice' },
        seriesId: { type: 'string', example: 'FT 2026' },
        validationCode: { type: 'string', example: 'JCVPTS0J' },
      },
      required: ['typeId', 'seriesId', 'validationCode'],
    },
  })
  @ApiResponse({ status: 200, description: 'Series validation code stored' })
  async upsert(
    @ActiveCompany() companyId: string,
    @Body() body: UpsertAtcudSeriesBody,
  ): Promise<AtcudSeriesResponse> {
    try {
      return await this.atcudSeries.upsert(companyId, body);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /** DELETE /api/company/atcud-series/:id — permanently removes one registered series (see
   *  `atcud-series.service.ts#remove`'s own header for why this is a hard delete, unlike a signing
   *  certificate's soft one). */
  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({ summary: 'Remove a registered ATCUD series validation code' })
  @ApiParam({ name: 'id', type: String, description: 'ATCUD series record ID' })
  @ApiResponse({ status: 200, description: 'Series removed' })
  remove(@ActiveCompany() companyId: string, @Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.atcudSeries.remove(companyId, id);
  }
}
