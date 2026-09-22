import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { RequiresScope } from '@/utils/scope-check';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { CompanyCustomFieldsService } from './company-custom-fields.service';
import {
  CompanyCustomFieldTarget,
  CreateCompanyCustomFieldInput,
  UpdateCompanyCustomFieldInput,
} from './types';

/**
 * Custom fields — the settings screen's own controller, the same
 * "bespoke top-level path, company-authenticated, no generic-document counterpart" placement
 * `PaymentMethodsController` already holds: a custom field DEFINITION is a company-level setting, not
 * a `DocumentInstance`, and has no business inside the generic document controller. `GET .../resolved`
 * is the one exception — read by the DOCUMENT FORM and the CLIENT form alike, never by the settings
 * screen itself (which reads the plain list below).
 *
 * Gated on `company:*` + `@Roles(OWNER, ADMIN)` for the writes, because of what a definition IS: not
 * one person's own note on one record, but a rule imposed on every document and every client of the
 * company, retroactively and for everyone. Creating one with `required: true` makes every colleague's
 * next action fail validation until they fill in a field they never asked for — `documents.service.ts
 * #runAction` checks EVERY action's data against the definitions of the moment, "send" included, so
 * this reaches documents already in flight, not just new drafts. Archiving one takes a field other
 * people are actively filling straight off the create/edit form. Renaming a label rewrites what the
 * PDF the customer receives calls that value, on documents already issued, because
 * `rendering/render-instance-pdf.ts` re-resolves the definitions at render time. That is a
 * company-configuration write, the same class as an expense category or the branding
 * (`expense-categories.controller.ts`, `branding.controller.ts` — both OWNER/ADMIN already), and the
 * settings menu has always presented this tab as one. The route simply never said so, which left a
 * plain MEMBER — and any API key at all, whatever narrow purpose it was minted for — able to impose
 * a mandatory field on the whole company, or to remove one, through a single unguarded call.
 *
 * Reads stay open to every active-company ROLE: the document form and the client form need the
 * resolved descriptors to render at all, and a definition is not a secret. They still name
 * `company:read`, so a key minted for one narrow resource does not get this company's form shape
 * thrown in for free.
 */
@ApiTags('custom-fields')
@Controller('custom-fields')
export class CompanyCustomFieldsController {
  constructor(private readonly customFields: CompanyCustomFieldsService) {}

  @Get()
  @RequiresScope('company:read')
  @ApiOperation({
    summary: "Every custom field definition for this company (settings screen's own list)",
    description:
      'Includes archived rows unless `includeArchived=false` is passed — the settings screen shows ' +
      'them (greyed out, with a "restore" action) so a definition disappearing is never a silent ' +
      "deletion from this screen's point of view.",
  })
  @ApiQuery({ name: 'target', required: false, enum: ['CLIENT', 'DOCUMENT'] })
  @ApiQuery({ name: 'documentTypeId', required: false, type: String })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Custom field definitions retrieved' })
  list(
    @ActiveCompany() companyId: string,
    @Query('target') target?: CompanyCustomFieldTarget,
    @Query('documentTypeId') documentTypeId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.customFields.list(companyId, {
      target,
      documentTypeId,
      includeArchived: includeArchived === undefined ? true : includeArchived !== 'false',
    });
  }

  @Get('resolved')
  @RequiresScope('company:read')
  @ApiOperation({
    summary: 'Definitions for one target, as ready-to-render DocumentFieldDescriptor[]',
    description:
      'What the document form (`target=DOCUMENT&typeId=invoice`), the document LIST, and the client ' +
      'form (`target=CLIENT`) all fetch and render through the exact same generic field-renderer ' +
      'registry every native field already uses. `includeArchived=false` (the default — what the ' +
      'CREATE/EDIT form asks for) excludes archived rows; the LIST (document-list.tsx) asks with ' +
      "`includeArchived=true` instead, so an archived definition's already-recorded value keeps " +
      "showing (see persistence.ts's own header).",
  })
  @ApiQuery({ name: 'target', required: true, enum: ['CLIENT', 'DOCUMENT'] })
  @ApiQuery({ name: 'typeId', required: false, type: String })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Resolved field descriptors' })
  resolved(
    @ActiveCompany() companyId: string,
    @Query('target') target: CompanyCustomFieldTarget,
    @Query('typeId') typeId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.customFields.resolved(companyId, target, typeId, includeArchived === 'true');
  }

  @Post()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Create a new custom field definition',
    description:
      '`key` is never accepted here — it is derived from `label` and frozen forever (see ' +
      "schema.prisma's own `CompanyCustomField.key` header).",
  })
  @ApiResponse({ status: 201, description: 'Custom field definition created' })
  @ApiResponse({ status: 403, description: 'Not an OWNER/ADMIN, or an API key without company:write' })
  create(@ActiveCompany() companyId: string, @Body() body: CreateCompanyCustomFieldInput) {
    return this.customFields.create(companyId, body);
  }

  @Patch(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Update a custom field definition — label/options/required/order only',
    description:
      '`key`/`kind`/`target`/`documentTypeId` are immutable after creation — not part of this ' +
      "request body at all (see UpdateCompanyCustomFieldInput's own header).",
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Custom field definition updated' })
  @ApiResponse({ status: 403, description: 'Not an OWNER/ADMIN, or an API key without company:write' })
  update(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Body() body: UpdateCompanyCustomFieldInput,
  ) {
    return this.customFields.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Archive (soft-delete) a custom field definition',
    description:
      'Never a hard delete — an already-recorded value for this field, on any document or client, ' +
      "keeps rendering forever (see persistence.ts's own header). Disappears from the create/edit " +
      'surface only.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Custom field definition archived' })
  @ApiResponse({ status: 403, description: 'Not an OWNER/ADMIN, or an API key without company:write' })
  archive(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.customFields.archive(companyId, id);
  }

  @Post(':id/restore')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({ summary: 'Un-archive a previously archived custom field definition' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Custom field definition restored' })
  @ApiResponse({ status: 403, description: 'Not an OWNER/ADMIN, or an API key without company:write' })
  restore(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.customFields.restore(companyId, id);
  }
}
