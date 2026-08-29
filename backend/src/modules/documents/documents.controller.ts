import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { DocumentsService } from './documents.service';
import { RunActionDto } from './dto/documents.dto';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // Static segments ('types', 'references/:entity/search') are declared before the dynamic
  // ':id'/':refId' routes at the same depth so Nest/Express match the literal first — see
  // documents.module.ts's comment header for why this ordering matters here.

  @Get('types')
  @ApiOperation({
    summary: 'List document types',
    description: 'Every registered document type descriptor, id and label only.',
  })
  @ApiResponse({ status: 200, description: 'Document types retrieved' })
  listTypes() {
    return this.documentsService.listTypes();
  }

  @Get('types/:typeId')
  @ApiOperation({
    summary: 'Get a document type descriptor',
    description: 'The full descriptor (fields, actions) a frontend renders a form from.',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiResponse({ status: 200, description: 'Descriptor retrieved' })
  @ApiResponse({ status: 404, description: 'Unknown document type' })
  getType(@Param('typeId') typeId: string) {
    return this.documentsService.getType(typeId);
  }

  @Get('references/:entity/search')
  @ApiOperation({
    summary: 'Search a reference entity',
    description: 'Generic search behind a "reference" field, regardless of which entity it targets.',
  })
  @ApiParam({ name: 'entity', type: String, description: 'e.g. "client"' })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Matching options retrieved' })
  @ApiResponse({ status: 404, description: 'Unknown reference entity' })
  searchReferences(
    @ActiveCompany() companyId: string,
    @Param('entity') entity: string,
    @Query('q') q: string,
  ) {
    return this.documentsService.searchReferences(companyId, entity, q);
  }

  @Get('references/:entity/:refId')
  @ApiOperation({
    summary: 'Resolve a reference value',
    description: 'The {id, label} for one entity id — used to display an already-set reference field.',
  })
  @ApiParam({ name: 'entity', type: String })
  @ApiParam({ name: 'refId', type: String })
  @ApiResponse({ status: 200, description: 'Option retrieved (or null if the id does not resolve)' })
  @ApiResponse({ status: 404, description: 'Unknown reference entity' })
  resolveReference(
    @ActiveCompany() companyId: string,
    @Param('entity') entity: string,
    @Param('refId') refId: string,
  ) {
    return this.documentsService.resolveReference(companyId, entity, refId);
  }

  @Post('types/:typeId/actions/:actionId')
  @ApiOperation({
    summary: 'Run a document action',
    description:
      'Runs one action declared on a document type (e.g. "save-draft"), native or attached by a ' +
      'third party. 501 if the action is declared but has no registered implementation.',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiParam({ name: 'actionId', type: String })
  @ApiResponse({ status: 200, description: 'Action ran, a result envelope (document/changed/message)' })
  @ApiResponse({ status: 400, description: "Document data, or the action's own params, are invalid" })
  @ApiResponse({ status: 404, description: 'Unknown type, or action not declared on it' })
  @ApiResponse({ status: 409, description: "Action not available for the record's current status" })
  @ApiResponse({ status: 501, description: 'Action declared but not implemented' })
  runAction(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Param('actionId') actionId: string,
    @Body() body: RunActionDto,
  ) {
    return this.documentsService.runAction(companyId, typeId, actionId, body);
  }

  @Post('types/:typeId/actions/:actionId/params/defaults')
  @ApiOperation({
    summary: "Get default values for an action's own parameters",
    description:
      'Optional pre-fill for the action params form (e.g. "send" pre-filling the recipient from ' +
      "the document's client) — {} when the action declares no defaults resolver, never an error.",
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiParam({ name: 'actionId', type: String })
  @ApiResponse({ status: 200, description: 'Default param values retrieved (possibly empty)' })
  @ApiResponse({ status: 404, description: 'Unknown type, or action not declared on it' })
  resolveActionParamsDefaults(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Param('actionId') actionId: string,
    @Body() body: RunActionDto,
  ) {
    return this.documentsService.resolveActionParamsDefaults(companyId, typeId, actionId, body);
  }

  @Get()
  @ApiOperation({
    summary: 'List document instances',
    description: 'Saved instances for the active company, newest first.',
  })
  @ApiQuery({ name: 'typeId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Instances retrieved' })
  listDocuments(@ActiveCompany() companyId: string, @Query('typeId') typeId?: string) {
    return this.documentsService.listDocuments(companyId, typeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a document instance', description: 'One saved document instance by id.' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Instance retrieved' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  getDocument(@ActiveCompany() companyId: string, @Param('id') id: string, @Query('typeId') typeId: string) {
    return this.documentsService.getDocument(companyId, typeId, id);
  }
}
