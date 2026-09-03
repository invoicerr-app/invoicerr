import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Sse } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Observable } from 'rxjs';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { DocumentsService } from './documents.service';
import { RunActionDto } from './dto/documents.dto';
import { DocumentEventMessage } from './queue/document-events';
import { DocumentEventsBridge } from './queue/document-events-bridge';
import { CreateDocumentScheduleDto, UpdateDocumentScheduleDto } from './schedules/schedule.dto';
import { DocumentSchedulesService } from './schedules/schedules.service';
import { ShareLinksService } from './share-links/share-links.service';

/** Well under common proxy/load-balancer idle timeouts (nginx's own default `proxy_read_timeout` is
 *  60s; many managed load balancers sit at 30-60s too) — see `streamEvents`'s own header for why a
 *  live byte still has to cross the wire periodically even though headers alone disable buffering. */
const DOCUMENT_EVENTS_HEARTBEAT_MS = 20_000;

/** The one shape `streamEvents` below ever emits — either a real nudge (`data` is a
 *  `DocumentEventMessage`, default "message" event type) or a heartbeat (`data: {}`, `type:
 *  "heartbeat"`) — mirrors `logger.controller.ts`'s own local `MessageEvent` (this codebase's chosen
 *  pattern for an `@Sse()` handler, deliberately copied rather than re-derived). */
interface MessageEvent {
  data: unknown;
  type?: string;
}

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly schedulesService: DocumentSchedulesService,
    private readonly shareLinksService: ShareLinksService,
    private readonly eventsBridge: DocumentEventsBridge,
  ) {}

  // Static segments ('types', 'transports', 'references/:entity/search', 'schedules') are declared
  // before the dynamic ':id'/':refId' routes at the same depth so Nest/Express match the literal
  // first — see documents.module.ts's comment header for why this ordering matters here.

  @Get('schedules')
  @ApiOperation({
    summary: 'List recurrences',
    description: 'Every DocumentSchedule for the active company — optionally narrowed to one document type.',
  })
  @ApiQuery({ name: 'typeId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Schedules retrieved' })
  listSchedules(@ActiveCompany() companyId: string, @Query('typeId') typeId?: string) {
    return this.schedulesService.list(companyId, typeId);
  }

  @Post('schedules')
  @ApiOperation({
    summary: 'Create a recurrence',
    description:
      'Replays `actionId` on `sourceDocumentId` at the given cadence, starting at `firstOccurrenceAt` ' +
      '(may be in the past — it becomes due at the very next sweep pass).',
  })
  @ApiResponse({ status: 201, description: 'Schedule created' })
  @ApiResponse({ status: 400, description: 'Unknown cadence, or an unparseable firstOccurrenceAt' })
  @ApiResponse({ status: 404, description: 'Unknown type/action, or the source document does not exist' })
  createSchedule(@ActiveCompany() companyId: string, @Body() body: CreateDocumentScheduleDto) {
    return this.schedulesService.create(companyId, body);
  }

  @Patch('schedules/:id')
  @ApiOperation({
    summary: 'Enable or disable a recurrence',
    description:
      'The only write the screen offers on an EXISTING schedule — cadence/source/action are fixed at creation.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Schedule updated' })
  @ApiResponse({ status: 404, description: 'Not found for this company' })
  updateSchedule(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Body() body: UpdateDocumentScheduleDto,
  ) {
    return this.schedulesService.setEnabled(companyId, id, body);
  }

  @Delete('schedules/:id')
  @ApiOperation({ summary: 'Delete a recurrence' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Schedule deleted' })
  @ApiResponse({ status: 404, description: 'Not found for this company' })
  deleteSchedule(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.schedulesService.remove(companyId, id);
  }

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
    description:
      'The full descriptor (fields, actions) a frontend renders a form from. Each action carries a ' +
      "policyBlockedReason when the active company's country document-action policy refuses it — " +
      'absent when the action is allowed. Optional `clientId`: when it names a GOVERNMENT client ' +
      "(Client.kind) whose own country declares a B2G routing rule, that rule's own " +
      '`requiredDocumentFields` are folded into `fields` too (e.g. a French company invoicing a ' +
      "German public body sees the Leitweg-ID input even though this company's own country has no " +
      "field overlay for it — see documents.service.ts#describeTypeForCompany's own header).",
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiQuery({ name: 'clientId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Descriptor retrieved' })
  @ApiResponse({ status: 404, description: 'Unknown document type' })
  getType(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.documentsService.describeTypeForCompany(companyId, typeId, clientId);
  }

  @Get('types/:typeId/fields/:fieldKey/rows')
  @ApiOperation({
    summary: "A 'rowSelection' field's currently selectable rows",
    description:
      "The rows a 'rowSelection' field may currently offer, given the live value of its " +
      "sourceField sibling (?sourceId=...) — an empty list, never an error, when that source isn't " +
      'resolvable yet; the actual block on an invalid selection happens at save time (runAction).',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiParam({ name: 'fieldKey', type: String })
  @ApiQuery({ name: 'sourceId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Selectable rows retrieved (possibly empty)' })
  @ApiResponse({ status: 404, description: 'Unknown type, or no such field on it' })
  @ApiResponse({ status: 400, description: "The field exists but isn't a valid 'rowSelection' field" })
  listSelectableRows(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Param('fieldKey') fieldKey: string,
    @Query('sourceId') sourceId?: string,
  ) {
    return this.documentsService.listSelectableRows(companyId, typeId, fieldKey, sourceId);
  }

  @Get('available-types')
  @ApiOperation({
    summary: "List document types available for the active company's country",
    description:
      'Which document types the Documents sidebar group should show, id and label only — see ' +
      "country-policy/country-policy.ts's resolveAvailableDocumentTypes. `reason` is present, and " +
      '`types` empty, when the country cannot be resolved or has no document-type policy declared ' +
      'at all — never a silently empty list.',
  })
  @ApiResponse({ status: 200, description: 'Available types retrieved (possibly empty, with a reason)' })
  listAvailableTypes(@ActiveCompany() companyId: string) {
    return this.documentsService.listAvailableTypes(companyId);
  }

  @Get('required-identifiers')
  @ApiOperation({
    summary: 'Legal identifier requirements for a country and party type',
    description:
      'Which identifier schemes (e.g. "LEGAL_ID", "VAT") a party of the given type must supply for ' +
      "the given country — see country-identifiers/country-identifiers.ts's " +
      'resolveRequiredIdentifiers. `reason` is present, and `requirements` empty, only when the ' +
      'country has NO identifier-requirements file declared at all; `requirements` can also be ' +
      'legitimately empty WITHOUT a reason when the file exists but declares nothing for this ' +
      'specific party type — never a silently empty form either way. Not scoped by ' +
      "@ActiveCompany(): the country in question is the CALLER's own country picker (a client, " +
      'the company itself, or a not-yet-created company during onboarding), never the active ' +
      "company's.",
  })
  @ApiQuery({ name: 'countryCode', required: true, type: String })
  @ApiQuery({ name: 'partyType', required: true, enum: ['COMPANY', 'INDIVIDUAL'] })
  @ApiResponse({ status: 200, description: 'Requirements retrieved (possibly empty, with a reason)' })
  listRequiredIdentifiers(@Query('countryCode') countryCode: string, @Query('partyType') partyType: string) {
    return this.documentsService.listRequiredIdentifiers(countryCode, partyType);
  }

  @Get('b2g-routing')
  @ApiOperation({
    summary: 'The B2G routing rule declared for a country, if any',
    description:
      'What sending an invoice to a GOVERNMENT client of the given country requires — the imposed ' +
      'channel/format, any required client identifiers, and any required invoice fields (see ' +
      "b2g-routing/b2g-routing.ts's resolveB2gRoutingRule). `null` means no B2G rule is declared for " +
      'this country YET — the client edit screen shows this as help, never a block: a client can ' +
      'still be marked GOVERNMENT and saved, the actual refusal only happens when an invoice to it ' +
      "is sent (see actions/invoice-actions.ts's own B2G precedence). Not scoped by @ActiveCompany() " +
      "— same reasoning as 'required-identifiers' above: this is the CLIENT's own country, unrelated " +
      "to the active company's.",
  })
  @ApiQuery({ name: 'countryCode', required: true, type: String })
  @ApiResponse({ status: 200, description: 'The rule, or null when none is declared for this country' })
  async getB2gRoutingRule(@Query('countryCode') countryCode: string) {
    return (await this.documentsService.getB2gRoutingRule(countryCode)) ?? null;
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard widgets',
    description:
      'Every widget every document type contributes to the dashboard — see contributions/. A type ' +
      'that declares a dashboard contribution but has none implemented shows up as an explicit ' +
      '"unimplemented" widget, never a silent gap.',
  })
  @ApiResponse({ status: 200, description: 'Widgets retrieved' })
  listDashboardWidgets(@ActiveCompany() companyId: string) {
    return this.documentsService.collectWidgets(companyId, 'dashboard');
  }

  @Get('statistics')
  @ApiOperation({
    summary: 'Statistics widgets',
    description: 'Same mechanism as GET documents/dashboard, for the Statistics screen.',
  })
  @ApiResponse({ status: 200, description: 'Widgets retrieved' })
  listStatisticsWidgets(@ActiveCompany() companyId: string) {
    return this.documentsService.collectWidgets(companyId, 'statistics');
  }

  @Get('transports')
  @ApiOperation({
    summary: 'List document transports',
    description:
      'Every registered document transport, id and label only — what a company chooses from for ' +
      'Company.invoiceTransportId. Never scoped by country: the choice is a company setting.',
  })
  @ApiResponse({ status: 200, description: 'Transports retrieved' })
  listTransports() {
    return this.documentsService.listTransports();
  }

  /**
   * Live document status/conformity nudges — TODO_PRODUIT.md T1 / PLAN-V2 R8: the screen used to keep
   * an async "send"'s OLD status until a manual reload, because nothing pushed the change to the
   * browser once the worker (a separate PROCESS once `WORKER_INLINE=false`) persisted it. See
   * `queue/document-events-publisher.ts`'s own header for the worker→API bridge (Redis pub/sub —
   * never an in-process EventEmitter, which `WORKER_INLINE=false` would silently break) this stream
   * is fed from.
   *
   * Every message is `{documentId, typeId, kind}` ONLY (`queue/document-events.ts`) — a NUDGE, never
   * a second source of truth: the frontend's `useSse` consumer invalidates the matching TanStack
   * queries on receipt and lets the ordinary REST GET (already tenant-scoped, already authoritative)
   * supply the actual state.
   *
   * Scoped by `@ActiveCompany()` exactly like every other route on this controller — a tenant NEVER
   * receives another tenant's events: `DocumentEventsBridge.subscribeCompany` dispatches strictly on
   * this exact companyId (see that method's own header for why that is structurally impossible to
   * get wrong, not merely a filter that could be forgotten).
   *
   * Nest's own `SseStream` already forces `X-Accel-Buffering: no` on every `@Sse()` response
   * (`@nestjs/core/router/sse-stream.js`, `commitHeaders()`) — nginx sits in front of this API in
   * production (`entrypoint.sh`) and buffers a response by default without it, which would turn this
   * stream into one big, delayed batch instead of a live one. Nothing to add here for that; documented
   * so a future refactor off `@Sse()` doesn't silently lose it.
   *
   * The periodic `heartbeat`-typed message below exists purely to keep an otherwise-idle connection
   * alive through a proxy that drops silent sockets (see `DOCUMENT_EVENTS_HEARTBEAT_MS`'s own
   * comment) — it is deliberately never the DEFAULT SSE "message" type, so the frontend's `useSse`
   * (`EventSource.onmessage` only fires for the unnamed default event type) never mistakes a
   * heartbeat for a real document event and never invalidates a query over one.
   */
  @Sse('events')
  @ApiOperation({
    summary: 'Live document status/conformity events (SSE)',
    description:
      'One message per persisted transition (sending/sent/send_failed) or newly-journaled ' +
      'authority-event batch, scoped to the active company — {documentId, typeId, kind} only, never ' +
      'the resulting state. See queue/document-events-publisher.ts for the worker→API Redis pub/sub ' +
      'bridge this is fed from.',
  })
  @ApiResponse({
    status: 200,
    description: 'text/event-stream — JSON document events plus periodic "heartbeat"-typed keep-alives',
  })
  streamEvents(@ActiveCompany() companyId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.eventsBridge.subscribeCompany(companyId, (message: DocumentEventMessage) => {
        subscriber.next({ data: message });
      });
      const heartbeat = setInterval(() => {
        subscriber.next({ data: {}, type: 'heartbeat' });
      }, DOCUMENT_EVENTS_HEARTBEAT_MS);

      // Runs when the client disconnects (browser tab closed, network drop) — the request's own
      // `close` event, handled by `@nestjs/core`'s own SSE plumbing (`router-response-controller.js`)
      // unsubscribing this Observable. Both the interval and this tenant's own listener registration
      // must be torn down here, or a churn of short-lived SSE connections would leak both a live
      // interval and an EventEmitter listener per connection, forever, on the ONE bridge instance.
      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
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

  @Get('references/:entity/:refId/fields')
  @ApiOperation({
    summary: "A reference entity's own raw fields, for prefilling a row",
    description:
      "The raw field values behind a field declaring `prefillFrom` (e.g. an article's " +
      'name/unitPrice/vatRate) — null when the id does not resolve, or when this entity has no ' +
      "prefill data to offer at all (most reference entities do not; see EntityReferenceProvider's " +
      'optional `getFields`).',
  })
  @ApiParam({ name: 'entity', type: String })
  @ApiParam({ name: 'refId', type: String })
  @ApiResponse({ status: 200, description: 'Fields retrieved (or null)' })
  @ApiResponse({ status: 404, description: 'Unknown reference entity' })
  getReferenceFields(
    @ActiveCompany() companyId: string,
    @Param('entity') entity: string,
    @Param('refId') refId: string,
  ) {
    return this.documentsService.getReferenceFields(companyId, entity, refId);
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
  @ApiResponse({
    status: 403,
    description: "The active company's country document-action policy forbids this action",
  })
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

  @Get(':id/totals')
  @ApiOperation({
    summary: 'Compute document totals',
    description: 'Computes net, VAT, and gross totals (in minor units) for a document instance.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'Totals computed',
  })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  computeTotals(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.computeTotals(companyId, typeId, id);
  }

  @Get(':id/settlement')
  @ApiOperation({
    summary: "Compute a document instance's payment settlement",
    description:
      'Totals, the payments recorded against this document, and the resulting balance (paid / ' +
      'outstanding / overpaid — see settlement/compute-settlement.ts). Same mould as GET .../totals.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Settlement computed' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  getSettlement(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.getSettlement(companyId, typeId, id);
  }

  @Get(':id/correction-routes')
  @ApiOperation({
    summary: "A document's correction routes, for its SELLER country",
    description:
      'TODO_CORRECTION.md C1. Every correction route (CREDIT_NOTE, INTERNAL_CREDIT_NOTE, …) the ' +
      "active company's own country declares for this document, each with its status " +
      '(required/allowed/forbidden/unverified), its legal label VERBATIM (never a summary), and ' +
      'whether this repo actually implements it today — only INTERNAL_CREDIT_NOTE does. `limitation` ' +
      'always names the seller-only scope of this read (see ' +
      "correction-routes/correction-routes.ts's own header on the unwritten seller×buyer " +
      'composition, task P3-U02). V1 only answers for typeId="invoice".',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Correction routes retrieved' })
  @ApiResponse({
    status: 404,
    description: 'Unknown document type, document not found, or no correction-routes rule for this country',
  })
  @ApiResponse({
    status: 409,
    description: 'The document is still a "draft" — nothing issued to correct yet',
  })
  @ApiResponse({ status: 501, description: 'typeId is not "invoice" — not supported by this endpoint yet' })
  getCorrectionRoutes(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.getCorrectionRoutes(companyId, typeId, id);
  }

  @Get(':id/pdf')
  @ApiOperation({
    summary: 'Get a document instance as PDF',
    description: 'Renders a document instance as a PDF file.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'PDF generated', schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  @ApiResponse({ status: 500, description: 'PDF rendering failed' })
  async renderPdf(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdfBuffer = await this.documentsService.renderInstancePdf(companyId, typeId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${typeId}-${id}.pdf"`);
    res.send(pdfBuffer);
  }

  @Get(':id/formats/:syntax')
  @ApiOperation({
    summary: 'Get a normalized EN 16931 export of a document instance',
    description:
      'Builds and validates a normalized XML export (CII or UBL — see the "download-xml" action\'s ' +
      'own `syntax` param) on demand, same mould as GET .../pdf. Never serves an artifact that ' +
      'failed EN 16931 validation.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'syntax', type: String, description: 'e.g. "cii" or "ubl"' })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'XML generated', schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  @ApiResponse({ status: 403, description: "The active company's country document-action policy forbids it" })
  @ApiResponse({
    status: 409,
    description: "Not available for the record's current status (e.g. still a draft)",
  })
  @ApiResponse({ status: 501, description: 'Unknown/unimplemented format' })
  @ApiResponse({
    status: 400,
    description: 'The generated document failed EN 16931 validation, or could not be built',
  })
  async downloadFormat(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Param('syntax') syntax: string,
    @Query('typeId') typeId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, mime, filename } = await this.documentsService.downloadDocumentFormat(
      companyId,
      typeId,
      id,
      syntax,
    );
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(bytes));
  }

  @Get(':id/archives')
  @ApiOperation({
    summary: 'List the legal archives of a document instance',
    description:
      'Root TODO item 14 ("archivage légal ⚖") — every archive written for this document, most ' +
      'recent first: one row per successful delivery that produced at least one artifact.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Archives retrieved (possibly empty)' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  listDocumentArchives(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.listDocumentArchives(companyId, typeId, id);
  }

  @Get(':id/authority-events')
  @ApiOperation({
    summary: 'List the post-deposit conformity events of a document instance',
    description:
      "Root TODO item 10's own named remainder — every event the ISSUING PLATFORM itself reported " +
      "(e.g. PDP's fr:200/201/202/213), most recent first, append-only. Empty for a document sent " +
      'by a channel with no conformity poller (e.g. "email", or "sdi" — push-only notifiche).',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Events retrieved (possibly empty)' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  listAuthorityEvents(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.listAuthorityEvents(companyId, typeId, id);
  }

  @Post(':id/archives/:archiveId/verify')
  @ApiOperation({
    summary: 'Verify one legal archive’s integrity',
    description:
      'RE-HASHES the bytes actually stored on disk and compares them against the hash recorded at ' +
      'archive time — never a bare re-read of the stored hash. Never mutates the archive row, even ' +
      'when it reports a corruption.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'archiveId', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: '"intact", or "corrupted" with the mismatching artifact(s) named',
  })
  @ApiResponse({ status: 404, description: 'Not found for this company/type, or unknown archiveId' })
  verifyDocumentArchive(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Param('archiveId') archiveId: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.verifyDocumentArchive(companyId, typeId, id, archiveId);
  }

  @Post(':id/share-link')
  @ApiOperation({
    summary: 'Create a public share link',
    description:
      'Root TODO item 24. Mints a new, high-entropy token (see share-links/share-link-token.ts) and ' +
      'returns the PUBLIC url ONCE — the raw token is never stored (only its hash) and this ' +
      'response is the only time this API ever hands it back; GET .../share-links afterwards shows ' +
      'only metadata (createdAt/expiresAt/revokedAt), never the token itself. Same four-gate story ' +
      'as "download-xml" (documents.service.ts#downloadDocumentFormat) — only country policy (403) ' +
      'and status (409) ever fire for this action: a draft document has no number and no legal ' +
      'existence to share yet.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 201, description: 'Link created — the token is shown here, and only here' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type, or type has no such action' })
  @ApiResponse({ status: 403, description: "The active company's country document-action policy forbids it" })
  @ApiResponse({ status: 409, description: "Not available for the record's current status (e.g. a draft)" })
  createShareLink(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.shareLinksService.create(companyId, typeId, id);
  }

  @Get(':id/share-links')
  @ApiOperation({
    summary: 'List the public share links of a document instance',
    description:
      'Metadata only (id/createdAt/expiresAt/revokedAt/active) — never the token or its hash. See ' +
      'POST .../share-link for the one-time creation response that DOES carry the token.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Share links retrieved (possibly empty)' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  listShareLinks(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.shareLinksService.list(companyId, typeId, id);
  }

  @Delete(':id/share-link/:tokenId')
  @ApiOperation({
    summary: 'Revoke a public share link',
    description:
      'A SOFT delete — sets `revokedAt`, never removes the row (who shared what, and when it was ' +
      'pulled back, is information worth keeping). The public url stops resolving immediately: ' +
      'GET /api/public/documents/:token/pdf answers the exact same 404 a revoked token gets as an ' +
      'expired or an unknown one.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'tokenId', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Link revoked' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type, or unknown share link' })
  revokeShareLink(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
    @Query('typeId') typeId: string,
  ) {
    return this.shareLinksService.revoke(companyId, typeId, id, tokenId);
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
