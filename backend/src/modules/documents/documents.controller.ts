import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { Observable } from 'rxjs';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { ActiveRole } from '@/decorators/active-role.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';
import { RequiresDocumentTypeScope } from '@/utils/scope-check';

import {
  ALLOWED_ATTACHMENT_MIMES,
  AttachmentRef,
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
} from './attachments/attachments.service';
import { DocumentsService } from './documents.service';
import { parseDashboardQuery, RawDashboardQuery } from './dto/dashboard-query.dto';
import { RunActionDto, UpdateDocumentEmailTemplateDto } from './dto/documents.dto';
import {
  DOCUMENT_LIST_DEFAULT_PAGE_SIZE,
  DOCUMENT_LIST_MAX_PAGE_SIZE,
  DOCUMENT_LIST_SETTLEMENT_VALUES,
  firstValue,
  parseListDocumentsQuery,
  RawListDocumentsQuery,
} from './dto/list-documents.dto';
import { DOCUMENT_LIST_SORT_FIELDS } from './persistence';
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

/**
 * The exact shape `multer`'s `memoryStorage()` engine hands a `@UploadedFile()` parameter — narrower
 * than the library's own `Express.Multer.File` (which this backend would otherwise need an extra
 * `@types/multer` devDependency purely for typings, since multer 2.x ships none of its own) but
 * exactly the four fields `uploadAttachment` below reads. Duplicated verbatim in
 * `received-invoices.controller.ts` rather than shared — the two upload routes are independent
 * concerns that only happen to read the same multer shape, the same reasoning `upload-validation.ts`'s
 * own header already gives for not importing its sibling allow-list either.
 */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Every route below carries `@RequiresDocumentTypeScope('read'|'write')` (`utils/scope-check.ts`) —
// GET/SSE get 'read', everything that creates or mutates gets 'write', matching the same HTTP-verb
// convention this codebase's other scope-gated controllers follow. `AuthGuard` resolves the ACTUAL
// scope at request time from whatever `typeId` the call names (a path param for most routes, a query
// string for the read side of a handful, the body for `POST .../schedules`) — a fixed `@RequiresScope`
// list cannot express "the required scope depends on the document type", the same reason
// `mcp/tools/scope-mapping.ts` already resolves it per call rather than at tool-registration time.
// Session (human) callers are unaffected by the SCOPE half: `request.scopes` is `null` for them,
// which every scope check in this codebase already treats as "always satisfied".
//
// The second argument says whether the route is about ONE type or spans every registered type.
// 'every-type' is written out on the aggregate routes (dashboard/statistics/types/declarations, the
// SSE stream, the reference and attachment helpers, the `GET /documents` list with its optional
// `typeId` filter); everything else keeps the fail-closed default, which makes a request that does
// not name a type a 400 instead of a lookup with the type predicate silently missing — see
// `AuthGuard#assertDocumentTypeNamed` for what an omitted `typeId` otherwise switches off. That
// refusal applies to sessions too, so a `:id/...` route answers about the type it was asked about,
// never about whatever type the id happens to be.
@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly schedulesService: DocumentSchedulesService,
    private readonly shareLinksService: ShareLinksService,
    private readonly eventsBridge: DocumentEventsBridge,
    private readonly attachmentsService: AttachmentsService,
  ) {}

  // Static segments ('types', 'transports', 'references/:entity/search', 'schedules') are declared
  // before the dynamic ':id'/':refId' routes at the same depth so Nest/Express match the literal
  // first — see documents.module.ts's comment header for why this ordering matters here.

  @Get('schedules')
  @RequiresDocumentTypeScope('read', 'every-type')
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
  @RequiresDocumentTypeScope('write')
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
  @RequiresDocumentTypeScope('write', 'every-type')
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
  @RequiresDocumentTypeScope('write', 'every-type')
  @ApiOperation({ summary: 'Delete a recurrence' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Schedule deleted' })
  @ApiResponse({ status: 404, description: 'Not found for this company' })
  deleteSchedule(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.schedulesService.remove(companyId, id);
  }

  @Get('types')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: 'List document types',
    description: 'Every registered document type descriptor, id and label only.',
  })
  @ApiResponse({ status: 200, description: 'Document types retrieved' })
  listTypes() {
    return this.documentsService.listTypes();
  }

  // Email templates, per document type. Declared HERE, among the other static segments, for the reason
  // this controller's own header gives: 'email-templates' would otherwise be swallowed by the dynamic
  // `@Get(':id')` route further down.

  @Get('email-templates')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: 'List every document type email template',
    description:
      "Each registered type's CURRENTLY APPLYING email template (the company's own override, else " +
      "the type's descriptor default, else the generic fallback — `source` says which), plus the " +
      '`variables` that type actually offers, mapped to sample values: the keys are the available- ' +
      'placeholder list, the values make a preview. Derived per type, so `recipientName` is absent ' +
      'for a type with no client reference and `totalGross` for a type with no money at all.',
  })
  @ApiResponse({ status: 200, description: 'Email templates retrieved' })
  listEmailTemplates(@ActiveCompany() companyId: string) {
    return this.documentsService.listEmailTemplates(companyId);
  }

  @Get('types/:typeId/email-template')
  @RequiresDocumentTypeScope('read')
  @ApiOperation({
    summary: "One document type's email template",
    description: 'The same resolved template and derived vocabulary as the list route, for one type.',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiResponse({ status: 200, description: 'Email template retrieved' })
  @ApiResponse({ status: 404, description: 'Unknown document type' })
  getEmailTemplate(@ActiveCompany() companyId: string, @Param('typeId') typeId: string) {
    return this.documentsService.getEmailTemplate(companyId, typeId);
  }

  @Put('types/:typeId/email-template')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: "Save one document type's email template",
    description:
      "Stores this company's own template for the type (`Company.documentEmailTemplates`). The html " +
      'part is sanitized server-side before storage. An unknown `{placeholder}` is REPORTED in ' +
      '`warnings`, never rejected — the same contract the send path holds, so a typo can never be ' +
      'what blocks a document from reaching a customer. A blank subject, or neither body nor html, ' +
      'IS refused: there would be no message to send.',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text part' },
        html: { type: 'string', description: 'Optional html part, sent alongside the text one' },
      },
      required: ['subject'],
    },
  })
  @ApiResponse({ status: 200, description: 'Template saved, with any placeholder warnings' })
  @ApiResponse({ status: 400, description: 'Blank subject, or neither a text body nor an html one' })
  @ApiResponse({ status: 404, description: 'Unknown document type' })
  updateEmailTemplate(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Body() body: UpdateDocumentEmailTemplateDto,
  ) {
    return this.documentsService.updateEmailTemplate(companyId, typeId, body);
  }

  @Delete('types/:typeId/email-template')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: "Revert one document type's email template to the shipped default",
    description:
      "Drops this company's own override for the type and returns what now applies. Reverting a " +
      'template that was never overridden is a no-op, never an error.',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiResponse({ status: 200, description: 'Override removed; the applying template is returned' })
  @ApiResponse({ status: 404, description: 'Unknown document type' })
  resetEmailTemplate(@ActiveCompany() companyId: string, @Param('typeId') typeId: string) {
    return this.documentsService.resetEmailTemplate(companyId, typeId);
  }

  @Get('types/:typeId')
  @RequiresDocumentTypeScope('read')
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
  @RequiresDocumentTypeScope('read')
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
  @RequiresDocumentTypeScope('read', 'every-type')
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
  @RequiresDocumentTypeScope('read', 'every-type')
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
  @RequiresDocumentTypeScope('read', 'every-type')
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

  @Get('declarations')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: "List the active company's declarative-reporting events",
    description:
      'Every DECLARATION journaled onto `DocumentAuthorityEvent` for the active company — see ' +
      "reporting/report-on-send.ts's own header: a country's own tax-authority declaration " +
      'obligation (e.g. Portugal’s "pt-at"), never an ordinary post-deposit conformity poll event ' +
      '(pdp/ksef/chorus-pro — those stay on `GET :id/authority-events` only). Paginated, most ' +
      'recent first, optionally narrowed to an exact `status` code. `hasObligation` is `false` for ' +
      'a country with no `reporting/data/*.json` fact at all (and `undefined` only when the ' +
      'company’s own country cannot even be resolved) — what lets the screen say so plainly instead ' +
      'of showing a permanently empty list with no explanation.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: String,
    description: 'Page number (1-indexed). Defaults to 1.',
  })
  @ApiQuery({ name: 'status', required: false, type: String, description: 'Exact statusCode filter.' })
  @ApiResponse({ status: 200, description: 'Declarations retrieved (possibly empty)' })
  listDeclarations(
    @ActiveCompany() companyId: string,
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    const pageNumber = parseInt(page ?? '', 10) || 1;
    return this.documentsService.listDeclarations(companyId, pageNumber, status);
  }

  @Get('dashboard')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: 'Dashboard widgets',
    description:
      'Every widget every document type contributes to the dashboard — see contributions/. A type ' +
      'that declares a dashboard contribution but has none implemented shows up as an explicit ' +
      '"unimplemented" widget, never a silent gap. `dateFrom`/`dateTo` (issue #418) restrict every ' +
      'period-aware widget to that inclusive range, resolved by the frontend from whatever preset ' +
      "the person picked (the browser's own local calendar) - this endpoint only ever sees concrete " +
      'dates. Omitted entirely, the response is byte-identical to before this feature existed.',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, inclusive. Requires dateTo.',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, inclusive. Requires dateFrom.',
  })
  @ApiResponse({ status: 200, description: 'Widgets retrieved' })
  @ApiResponse({
    status: 400,
    description: 'A malformed date, dateFrom after dateTo, or only one of the two given',
  })
  listDashboardWidgets(@ActiveCompany() companyId: string, @Query() rawQuery: RawDashboardQuery) {
    return this.documentsService.collectWidgets(companyId, 'dashboard', parseDashboardQuery(rawQuery));
  }

  @Get('statistics')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: 'Statistics widgets',
    description: 'Same mechanism as GET documents/dashboard, for the Statistics screen.',
  })
  @ApiResponse({ status: 200, description: 'Widgets retrieved' })
  listStatisticsWidgets(@ActiveCompany() companyId: string) {
    return this.documentsService.collectWidgets(companyId, 'statistics');
  }

  @Get('transports')
  @RequiresDocumentTypeScope('read', 'every-type')
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
   * Live document status/conformity nudges: the screen used to keep
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
  @RequiresDocumentTypeScope('read', 'every-type')
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
  @RequiresDocumentTypeScope('read', 'every-type')
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
  @RequiresDocumentTypeScope('read', 'every-type')
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
  @RequiresDocumentTypeScope('read', 'every-type')
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

  // Enriched expense categories ("notes de frais enrichies") — backs the 12th field kind, 'file'
  // (descriptors/types.ts). Company-scoped only, deliberately never document-id-scoped — see
  // AttachmentsService's own header for why this stays as generic as 'reference's own
  // "references/:entity/..." routes right above, rather than a bespoke "expense attachment" endpoint.
  // `memoryStorage()` (never `dest: ...`'s default disk storage) — the file never touches this
  // container's filesystem before `AttachmentsService.upload` content-addresses and writes it itself;
  // `limits.fileSize` is multer's OWN ceiling, enforced by busboy while the multipart stream is still
  // being read, so an oversized upload is aborted at the wire (a 413, via `FileInterceptor`'s built-in
  // `MulterError` translation — see `@nestjs/platform-express/multer/multer/multer.utils.js`) before
  // this handler, or even `AttachmentsService`, ever runs. `FileInterceptor`'s single-field contract
  // (`.single('file')`) already refuses more than one file per request on its own.
  @Post('attachments/upload')
  @RequiresDocumentTypeScope('write', 'every-type')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an attachment (a photo or PDF of a receipt, today)',
    description:
      'Stores the file content-addressed for the active company. Refused, named, for a disallowed ' +
      'mime type or a file over the size limit — see AttachmentsService for both.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'File stored — { fileRef, fileName, mime }' })
  @ApiResponse({
    status: 400,
    description: 'Missing file, an empty file, or a disallowed mime',
  })
  @ApiResponse({ status: 413, description: 'The file is over the size limit' })
  uploadAttachment(
    @ActiveCompany() companyId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ): Promise<AttachmentRef> {
    if (!file) {
      throw new BadRequestException('A file is required.');
    }
    return this.attachmentsService.upload(companyId, {
      fileName: file.originalname,
      mime: file.mimetype,
      bytes: file.buffer,
    });
  }

  @Get('attachments/:fileRef')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({ summary: "An attachment's original uploaded bytes" })
  @ApiParam({
    name: 'fileRef',
    type: String,
    description: "The attachment's own SHA-256, from the upload response",
  })
  @ApiQuery({
    name: 'mime',
    required: true,
    type: String,
    description: 'The mime the upload response carried',
  })
  @ApiResponse({
    status: 200,
    description: 'File bytes, verbatim',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 404, description: 'Not found for this company, or the file is no longer on disk' })
  async downloadAttachment(
    @ActiveCompany() companyId: string,
    @Param('fileRef') fileRef: string,
    @Query('mime') mime: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!mime) {
      throw new BadRequestException('The "mime" query parameter is required.');
    }
    const { bytes, mime: resolvedMime } = await this.attachmentsService.download(companyId, fileRef, mime);

    // `resolvedMime` is the CALLER-supplied `mime` query param, echoed straight back by
    // `AttachmentsService.download` (it never re-derives it from what is actually stored) — so a
    // caller who names a `fileRef` originally uploaded through a DIFFERENT route with no mime
    // allowlist (`received-invoices.service.ts#upload`, which maps an unrecognised type to a bare
    // `.bin` on the SAME shared, content-addressed storage — see `received-invoices/storage.ts`) can
    // ask for it back as `text/html` (or `image/svg+xml`, `application/javascript`…) and have this
    // endpoint hand a browser exactly that Content-Type on the app's own origin: a stored file becomes
    // a same-origin script execution the moment a victim opens the link. Only a mime this app itself
    // considers safe to render inline (`ALLOWED_ATTACHMENT_MIMES` — a closed set of a PDF and three
    // image types, none of which execute script under their own correct Content-Type) is ever echoed
    // back; anything else is served as an inert octet stream instead — the BYTES are still returned
    // (this is not an authorization check, `AttachmentsService.download` already scoped that), only
    // what the BROWSER is told they are changes. `Content-Disposition: attachment` and `nosniff` are
    // kept regardless, as defense in depth: even a mime this app trusts should not execute in a page
    // navigated to directly, and `nosniff` stops the browser from ever second-guessing either header.
    const safeMime = ALLOWED_ATTACHMENT_MIMES.includes(resolvedMime)
      ? resolvedMime
      : 'application/octet-stream';
    res.setHeader('Content-Type', safeMime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
    res.send(bytes);
  }

  @Post('types/:typeId/actions/:actionId')
  @RequiresDocumentTypeScope('write')
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
  @ApiResponse({
    status: 403,
    description:
      'A MEMBER ran "send" on a document whose gross total exceeds the ' +
      "company's configured approval threshold — an ADMIN or OWNER must send it instead",
  })
  runAction(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Param('actionId') actionId: string,
    @Body() body: RunActionDto,
    // Undefined only for API-key auth (see ActiveRole's own header) - `documentsService.runAction`
    // treats that exactly like OWNER/ADMIN for the approval-threshold gate (never re-gated).
    @ActiveRole() role: CompanyRole | undefined,
    // Both session AND API-key auth set `request.user` (`guards/auth.guard.ts`) - unlike `role`
    // above, this is never undefined for an authenticated call. See ActionContext.actor's own header
    // (actions/action-registry.ts) for why an action that needs to know WHO ran it (issue #421's
    // manual quote acceptance) reads this rather than a caller-supplied `params` field.
    @User() user: CurrentUser,
  ) {
    return this.documentsService.runAction(companyId, typeId, actionId, body, role, false, {
      id: user.id,
      name: `${user.firstname} ${user.lastname}`.trim(),
      email: user.email,
    });
  }

  @Post('types/:typeId/actions/:actionId/params/defaults')
  @RequiresDocumentTypeScope('read')
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
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: 'List document instances',
    description:
      'One PAGE of instances for the active company, filtered and sorted server-side — ' +
      '`{ items, total, page, pageSize }`, never a bare array. `clientId`/`dateFrom`/`dateTo`/`q` each ' +
      "read the named type's own descriptor (which field is its client reference, which its issuance " +
      'date, which of its `listItem.titleFields` are free text) and so all four REQUIRE `typeId` — a ' +
      '400 otherwise, and a 400 too for a filter naming a field this specific type has none of ' +
      '(never a silent, indistinguishable-from-"nothing matched" empty page).',
  })
  @ApiQuery({ name: 'typeId', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '1-indexed. Default 1.' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: `Default ${DOCUMENT_LIST_DEFAULT_PAGE_SIZE}, clamped to ${DOCUMENT_LIST_MAX_PAGE_SIZE}.`,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: [String],
    description: 'Repeatable, or one comma-separated value. OR-ed together.',
  })
  @ApiQuery({ name: 'clientId', required: false, type: String, description: 'Requires typeId.' })
  @ApiQuery({ name: 'dateFrom', required: false, type: String, description: 'YYYY-MM-DD, requires typeId.' })
  @ApiQuery({ name: 'dateTo', required: false, type: String, description: 'YYYY-MM-DD, requires typeId.' })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description: 'Case-insensitive: document number, title field(s), client name. Requires typeId.',
  })
  @ApiQuery({ name: 'sort', required: false, enum: DOCUMENT_LIST_SORT_FIELDS })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({
    name: 'settlement',
    required: false,
    enum: DOCUMENT_LIST_SETTLEMENT_VALUES,
    description:
      'Restricts to invoices matching this settlement state (settlement/unsettled-invoices.ts, the ' +
      'same predicate the dashboard\'s "pending"/"overdue" tiles use). Requires typeId=invoice.',
  })
  @ApiResponse({ status: 200, description: 'One page of instances retrieved' })
  @ApiResponse({
    status: 400,
    description:
      'A malformed page/pageSize/date, an unknown sort field, a descriptor filter with no typeId, or ' +
      'a settlement filter on a typeId other than "invoice"',
  })
  listDocuments(@ActiveCompany() companyId: string, @Query() rawQuery: RawListDocumentsQuery) {
    const { typeId, ...listQuery } = rawQuery;
    return this.documentsService.listDocuments(
      companyId,
      firstValue(typeId),
      parseListDocumentsQuery(listQuery),
    );
  }

  @Get(':id/totals')
  @RequiresDocumentTypeScope('read')
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
  @RequiresDocumentTypeScope('read')
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

  @Get(':id/tax-warnings')
  @RequiresDocumentTypeScope('read')
  @ApiOperation({
    summary: "A document's non-fatal tax caveats",
    description:
      "The warnings this invoice's own cross-border tax resolution records — a buyer VAT number " +
      'that could not be confirmed (so the sale was taxed as a consumer sale), a destination whose ' +
      'reduced rates are not modelled (so the line may be over-taxed), a line with no declared ' +
      'supply type. Never a refusal: a send is blocked by its own named 400, and a block is reported ' +
      'here as an empty list, not as an error. Recomputed on every read (see ' +
      'DocumentsService.getTaxWarnings); any type but "invoice" answers an empty list.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Tax warnings computed (possibly an empty list)' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  getTaxWarnings(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.getTaxWarnings(companyId, typeId, id);
  }

  @Get(':id/correction-routes')
  @RequiresDocumentTypeScope('read')
  @ApiOperation({
    summary: "A document's correction routes, for its SELLER country",
    description:
      'Every correction route (CREDIT_NOTE, INTERNAL_CREDIT_NOTE, …) the ' +
      "active company's own country declares for this document, each with its status " +
      '(required/allowed/forbidden/unverified), its legal label VERBATIM (never a summary), and ' +
      'whether this repo actually implements it today — only INTERNAL_CREDIT_NOTE does. `limitation` ' +
      'always names the seller-only scope of this read (see ' +
      "correction-routes/correction-routes.ts's own header on the unwritten seller×buyer " +
      'composition). V1 only answers for typeId="invoice".',
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
  @RequiresDocumentTypeScope('read')
  @ApiOperation({
    summary: 'Get a document instance as PDF',
    description:
      'Serves the document as a PDF — straight from its own send-time archive when one exists ' +
      '(documents.service.ts#renderInstancePdf), never re-rendering (no Chromium launched) in that ' +
      'case; a document with nothing archived yet (a draft, or one delivered through a channel with ' +
      'no plain-PDF artifact) renders fresh.',
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
  @RequiresDocumentTypeScope('read')
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
  @RequiresDocumentTypeScope('read')
  @ApiOperation({
    summary: 'List the legal archives of a document instance',
    description:
      'Every legal archive written for this document, most ' +
      'recent first: DELIVERY rows (one per successful send that produced at least one artifact) ' +
      "and, since 2026-09-06, VERDICT rows (the authority's own terminal verdict on a deposit — " +
      'see `DocumentArchive`’s own schema comment). Distinguish them via `kind`.',
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
  @RequiresDocumentTypeScope('read')
  @ApiOperation({
    summary: 'List the post-deposit conformity events of a document instance',
    description:
      'Every event the ISSUING PLATFORM itself reported ' +
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

  @Get(':id/manual-acceptance')
  @RequiresDocumentTypeScope('read')
  @ApiOperation({
    summary: "A quote's own manual-acceptance record, if any",
    description:
      'Issue #421 - the manifest actually archived when the issuer marked this quote accepted by ' +
      'some means other than the e-signature flow (method, actor, note, timestamp). `null` for a ' +
      'document never manually accepted. Never confused with an e-signature: that flow leaves no ' +
      'entry here at all.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Manual-acceptance record retrieved, or null' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  getManualAcceptance(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Query('typeId') typeId: string,
  ) {
    return this.documentsService.getManualAcceptance(companyId, typeId, id);
  }

  @Post(':id/archives/:archiveId/verify')
  @RequiresDocumentTypeScope('write')
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
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: 'Create a public share link',
    description:
      'Mints a new, high-entropy token (see share-links/share-link-token.ts) and ' +
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
  @RequiresDocumentTypeScope('read')
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
  @RequiresDocumentTypeScope('write')
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
  @RequiresDocumentTypeScope('read')
  @ApiOperation({ summary: 'Get a document instance', description: 'One saved document instance by id.' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'typeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Instance retrieved' })
  @ApiResponse({ status: 404, description: 'Not found for this company/type' })
  getDocument(@ActiveCompany() companyId: string, @Param('id') id: string, @Query('typeId') typeId: string) {
    return this.documentsService.getDocument(companyId, typeId, id);
  }
}
