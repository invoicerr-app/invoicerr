import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { ChannelCredentialsService, UpsertChannelConfigBody } from './channels.service';

/**
 * Item 10 (root TODO), "transports nationaux" — the settings screen this backs is "Canaux"
 * (company settings): connect/disconnect a national transport (PDP today; KSeF/SdI, wave 2, are
 * more rows the exact same three endpoints already cover). Scoped to the caller's ACTIVE company
 * (`@ActiveCompany()`) the same way every other company-settings route in this codebase is — never
 * the URL, which carries no company id at all.
 */
@ApiTags('company')
@Controller('company/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelCredentialsService) {}

  /**
   * GET /api/company/channels — what is connected (status only — see `ChannelConfigStatus`'s own
   * header: never a credential value, masked or not) plus what this company's OWN country says about
   * each channel (`suggested` — the field KEPT its item-10 name for backward compatibility, but each
   * entry may now be a bare `suggested` hint OR a sourced `mandated` requirement, item 11 — see
   * `channel-policy/schema.ts`'s header on the difference and `channels.service.ts`'s own
   * `ChannelPolicyStatus` for the exact shape).
   */
  @Get()
  @ApiOperation({
    summary: 'List channel connections',
    description:
      "Returns this company's connected channels (status only — never a credential value) and " +
      "this company's own country channel policy (suggested and/or mandated, item 11).",
  })
  @ApiResponse({ status: 200, description: 'Channel status retrieved' })
  async list(@ActiveCompany() companyId: string) {
    const [configured, suggested] = await Promise.all([
      this.channels.listCompanyChannels(companyId),
      this.channels.suggestedChannels(companyId),
    ]);
    return { configured, suggested };
  }

  /**
   * PUT /api/company/channels/:providerId — connect or update a channel. Encrypts the config blob
   * before storing; the response is status-only (see `channels.service.ts#upsertChannelConfig`) —
   * never an echo of the secret this same request just carried.
   */
  @Put(':providerId')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Connect/update a channel',
    description:
      'Creates or updates this company\'s configuration for one provider (e.g. "pdp"). The config ' +
      'blob is encrypted at rest and never logged.',
  })
  @ApiParam({ name: 'providerId', type: String, example: 'pdp' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        environment: { type: 'string', enum: ['TEST', 'PROD'], default: 'TEST' },
        config: { type: 'object', additionalProperties: true },
        isActive: { type: 'boolean', default: true },
      },
      required: ['config'],
    },
  })
  @ApiResponse({ status: 200, description: 'Channel connected' })
  async upsert(
    @ActiveCompany() companyId: string,
    @Param('providerId') providerId: string,
    @Body() body: UpsertChannelConfigBody,
  ) {
    return this.channels.upsertChannelConfig(companyId, providerId, body);
  }

  /** DELETE /api/company/channels/:providerId — disconnects the channel entirely (every
   *  environment's row for this provider — see `deleteChannelConfig`'s own header). */
  @Delete(':providerId')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Disconnect a channel',
    description: "Removes this company's configuration for one provider, every environment included.",
  })
  @ApiParam({ name: 'providerId', type: String, example: 'pdp' })
  @ApiResponse({ status: 200, description: 'Channel disconnected' })
  async remove(@ActiveCompany() companyId: string, @Param('providerId') providerId: string) {
    return this.channels.deleteChannelConfig(companyId, providerId);
  }
}
