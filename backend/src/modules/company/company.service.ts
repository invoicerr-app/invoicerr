import {
  BadRequestException,
  ConflictException,
  Injectable,
  MethodNotAllowedException,
  NotFoundException,
} from '@nestjs/common';
import { EditCompanyDto, IdentifierEntry } from '@/modules/company/dto/company.dto';
import {
  normalizeRevenueBasis,
  normalizeRevenuePeriod,
  resolveRevenueSettings,
} from '@/modules/company/revenue-basis/resolve-revenue-basis';
import { MailTemplateType, Prisma, WebhookEvent } from '../../../prisma/generated/prisma/client';

import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { createHash } from 'node:crypto';
import { logger } from '@/logger/logger.service';
import { sanitizeEmailHtml } from '@/mail/sanitize-email-html';
import {
  describeSystemEmailVocabulary,
  resolveSystemEmailTemplate,
  SYSTEM_EMAIL_FAMILIES,
  SystemEmailFamily,
  systemEmailFamilyLabel,
} from '@/mail/system-email-templates';
import { renderEmailTemplate } from '@/modules/documents/actions/email-template';
import { formatDocumentNumber } from '@/modules/documents/numbering/format-number';
import { periodKeyFor, resolveNumberFormatFor } from '@/modules/documents/numbering/company-number-format';
import {
  extractTrailingNumber,
  inferNumberPatternFromExample,
  parseNumberFromPattern,
  parsePortugueseSeriesIdentifier,
} from '@/modules/documents/numbering/declare-last-number';
import { seedSequenceStart } from '@/modules/documents/numbering/sequence';
import { constraintsFor, patternViolations } from '@/modules/documents/country-policy/number-formats';
import { defaultCountryPolicyCatalog } from '@/modules/documents/country-policy/registry';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import {
  CompanyNumberFormats,
  DeclareLastNumberInferRequest,
  DeclareLastNumberInferResponse,
  DeclareLastNumberRequest,
  DeclareLastNumberResponse,
} from './dto/number-formats.dto';
import { assertIdentifierValueMatchesPattern } from '@/modules/documents/country-identifiers/validate-identifier-value';
import { ensureDefaultExpenseCategoriesSeeded } from '@/modules/documents/expense-categories/persistence';
import { withSeatReservation } from '@/modules/billing/seat-sync';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import { syncPolarCustomerOnCompanyChange } from '@/modules/billing/customer-sync';
import prisma from '@/prisma/prisma.service';

/**
 * One SYSTEM email template, as this module's settings routes hand it over — the signature request and
 * the verification code only. A DOCUMENT type's email is a different mechanism, keyed by type rather
 * than by a closed enum: see `documents/actions/company-email-templates.ts` and
 * `GET /api/documents/email-templates`.
 */
export interface EmailTemplate {
  /** The stored override's row id, or '' when this company has none and the shipped default applies —
   *  which is what makes `source` below worth reporting rather than inferring from a string compare. */
  dbId: string;
  id: SystemEmailFamily;
  companyId: string;
  name: string;
  subject: string;
  /** HTML — see `MailTemplate.body`'s own schema comment. The text/plain alternative is derived from it
   *  at send time (`email-template.ts#deriveTextFromHtml`), never stored twice. */
  body: string;
  source: 'company' | 'default';
  variables: Record<string, string>;
}

/** Where the sample `{appUrl}` in a preview points, and what the senders interpolate — one fallback,
 *  spelled once. */
function appUrl(): string {
  return process.env.APP_URL || 'http://localhost:3000';
}

/**
 * The only `Company` columns a caller may ever set through `EditCompanyDto` — the single allow-list
 * BOTH `createCompany` and `editCompanyInfo` write through, so the two can never drift into accepting
 * different fields. `EditCompanyDto` is a TypeScript interface (erased at compile time) and this API
 * has no `ValidationPipe`, so this function is the only thing standing between the raw JSON request
 * body and `prisma.company.create`/`update`. Without it, a caller-named `subscription`, `documents`,
 * `clients`, `signingCertificates`, `channelConfigs`, `id`, or any of the ~30 other relations
 * `CompanyCreateInput`/`CompanyUpdateInput` accept would reach Prisma verbatim — and because the
 * foreign key on a one-to-many/one-to-one relation lives on the CHILD row, a nested `connect` there
 * REASSIGNS an existing row (someone else's active subscription, signing certificate, or transmission
 * channel) to the caller's own company rather than merely failing. Every field named here is a plain
 * scalar column with no such nested-write surface. Each key is always present on the returned object
 * (possibly `undefined`) — Prisma treats an `undefined` value exactly like an absent key for both
 * `create` and `update`, so this matches `editCompanyInfo`'s pre-existing literal-object write below.
 */
// `Pick<EditCompanyDto, ...>` rather than letting the return type be inferred: it preserves each
// field's own OPTIONALITY exactly as `EditCompanyDto` declares it (`phone?: string`, not the
// mandatory-but-possibly-`undefined` `phone: string | undefined` a bare object-literal return type
// would infer). That distinction is what lets `createCompany` spread this result AFTER its own
// `phone: ''`/`email: ''`/... fallbacks without TypeScript flagging every one of them as "always
// overwritten by an `undefined`-typed spread" — Prisma's generated `CompanyCreateInput` itself marks
// these columns as optional-with-a-caller-can-omit-them semantics for exactly this reason.
type PickedCompanyInput = Pick<
  EditCompanyDto,
  | 'description'
  | 'foundedAt'
  | 'name'
  | 'currency'
  | 'exemptVat'
  | 'address'
  | 'addressLine2'
  | 'postalCode'
  | 'city'
  | 'state'
  | 'country'
  | 'countryCode'
  | 'language'
  | 'phone'
  | 'email'
  | 'iban'
  | 'invoiceTransportId'
  | 'paymentProviderId'
  | 'referenceCurrency'
  | 'approvalThresholdMinor'
  | 'remindersEnabled'
  | 'distanceSalesRegime'
  | 'revenueBasis'
  | 'revenuePeriod'
>;

/**
 * `Company.distanceSalesRegime` is one of exactly two values or nothing at all (see its own
 * schema.prisma comment for the Directive articles that close the set). This API has no
 * `ValidationPipe` — `EditCompanyDto` is an erased TypeScript interface — so a typo'd or invented
 * value would otherwise be stored happily and then read back as "not declared" by
 * `documents/tax/resolve-invoice-tax.ts#parseDistanceSalesRegime`, leaving the company convinced it
 * declared something while every cross-border B2C sale of goods kept being refused. Rejecting at SAVE
 * time, named, is the same posture `updateNumberFormat` below already holds for a number pattern.
 * `undefined` (key absent) leaves the column untouched; `null`/`''` clears it back to "never
 * declared", which is a legitimate state to return to.
 */
function normalizeDistanceSalesRegime(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized !== 'ORIGIN' && normalized !== 'DESTINATION') {
    throw new BadRequestException(
      `distanceSalesRegime must be "ORIGIN" or "DESTINATION" (or empty to leave it undeclared), not ` +
        `"${value}".`,
    );
  }
  return normalized;
}

export function pickCompanyInput(input: EditCompanyDto): PickedCompanyInput {
  return {
    description: input.description,
    foundedAt: input.foundedAt,
    name: input.name,
    currency: input.currency,
    exemptVat: input.exemptVat,
    address: input.address,
    addressLine2: input.addressLine2,
    postalCode: input.postalCode,
    city: input.city,
    state: input.state,
    country: input.country,
    countryCode: input.countryCode,
    language: input.language,
    phone: input.phone,
    email: input.email,
    iban: input.iban,
    invoiceTransportId: input.invoiceTransportId,
    paymentProviderId: input.paymentProviderId,
    referenceCurrency: input.referenceCurrency,
    approvalThresholdMinor: input.approvalThresholdMinor,
    remindersEnabled: input.remindersEnabled,
    distanceSalesRegime: normalizeDistanceSalesRegime(input.distanceSalesRegime),
    revenueBasis: normalizeRevenueBasis(input.revenueBasis),
    revenuePeriod: normalizeRevenuePeriod(input.revenuePeriod),
  };
}

@Injectable()
export class CompanyService {
  private lastCompanyHash?: string;

  private computeHash(payload: any): string {
    try {
      const hash = createHash('sha1');
      hash.update(JSON.stringify(payload));
      return hash.digest('hex');
    } catch (e) {
      return String(Date.now());
    }
  }

  constructor(private readonly webhookDispatcher: WebhookDispatcherService) {}

  async getCompanyInfo(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });
    if (!company) {
      logger.warn('No company found', { category: 'company', details: { companyId } });
      return null;
    }
    // Compute hash and log only on init or when company data changed
    const companyData = company;
    const hash = this.computeHash(companyData);
    if (!this.lastCompanyHash) {
      this.lastCompanyHash = hash;
      logger.info('Company fetch initialized', {
        category: 'company',
        details: { companyId: company.id, hash },
      });
    } else if (this.lastCompanyHash !== hash) {
      this.lastCompanyHash = hash;
      logger.info('Company fetched data changed', {
        category: 'company',
        details: { companyId: company.id, hash },
      });
    }
    const result = await prisma.company.findUnique({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });
    if (!result) return null;

    // Issue #603: expose the country's own `documentValidationCode` fact (e.g. Portugal's ATCUD)
    // instead of letting the frontend decide from `country`/`countryCode` itself - see
    // country-policy/schema.ts's own header. Replaces the settings tab's and the ATCUD settings
    // screen's own `=== "PT"` / `=== "PORTUGAL"` checks, which read this same endpoint.
    const countryCode = (result.countryCode || guessCountryCode(result.country ?? undefined) || '')
      .trim()
      .toUpperCase();
    return {
      ...result,
      documentValidationCode: defaultCountryPolicyCatalog.documentValidationCodeFor(countryCode) ?? null,
    };
  }

  /** Issue #516 - see `company.controller.ts#getRevenueSettings`'s own header. A 404 rather than a
   *  thrown 500 when the company somehow doesn't exist, matching `getCompanyInfo`'s own posture for
   *  the same case (that one logs and returns null; a resolved-settings caller always expects an
   *  object, so this one 404s instead of a shape the frontend would have to special-case). */
  async getRevenueSettings(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { revenueBasis: true, revenuePeriod: true, countryCode: true },
    });
    if (!company) {
      throw new NotFoundException(`Company "${companyId}" not found.`);
    }
    return resolveRevenueSettings(company);
  }

  private async upsertPartyIdentifiers(
    companyId: string,
    identifiers: IdentifierEntry[] | undefined,
    // The active company's own country — needed to resolve a declared `pattern`, exactly like
    // `clients.service.ts`'s own `upsertPartyIdentifiers` needs the client's.
    countryCode: string | null | undefined,
  ) {
    if (!identifiers) return;

    const existing = await prisma.partyIdentifier.findMany({
      where: { companyId },
    });

    // Every entry is checked against the country's declared `pattern` BEFORE any write below — see
    // clients.service.ts's own identical comment and validate-identifier-value.ts's header for why
    // this refuses rather than warns, and why an unchanged value is exempt.
    for (const entry of identifiers) {
      const before = existing.find((r) => r.scheme === entry.scheme);
      await assertIdentifierValueMatchesPattern({
        countryCode,
        scheme: entry.scheme,
        value: entry.value,
        previousValue: before?.value,
      });
    }

    const incomingSchemes = new Set(identifiers.map((i) => i.scheme));

    // Delete rows whose scheme is no longer present
    for (const row of existing) {
      if (!incomingSchemes.has(row.scheme)) {
        await prisma.partyIdentifier.delete({ where: { id: row.id } });
      }
    }

    // Upsert each submitted entry
    for (const entry of identifiers) {
      await prisma.partyIdentifier.upsert({
        where: { companyId_scheme: { companyId, scheme: entry.scheme } },
        create: { companyId, scheme: entry.scheme, value: entry.value },
        update: { value: entry.value },
      });
    }
  }

  async editCompanyInfo(companyId: string, editCompanyDto: EditCompanyDto) {
    // `rest` below is never spread wholesale — see the explicit allow-list a few lines down — so
    // `identifiers` only needs pulling out here because it is written through its own upsert instead.
    const { identifiers, ...rest } = editCompanyDto;

    const existingCompany = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existingCompany) {
      throw new NotFoundException('Company not found');
    }

    // Explicit allow-list, never `...rest`: there is no runtime request validation anywhere in this
    // API (no ValidationPipe, no class-validator — `EditCompanyDto` is a TypeScript `interface`,
    // erased at compile time), so `rest` is really just the raw, caller-supplied JSON body with two
    // keys deleted. Spreading it wholesale would let a caller write ANY Company column by naming it —
    // `id`, `createdAt`, and, directly relevant to numbering, `numberFormats` itself: since issue #496
    // that column holds a company's frozen RUNNING SERIES (see `documents/numbering/
    // company-number-format.ts`), which nothing may write any more, and a caller naming it here would
    // silently change the format its next documents are numbered with. Every
    // field this settings screen is actually allowed to write is named once, in `pickCompanyInput`
    // above — shared with `createCompany` so the two paths can never diverge.
    const updatedCompany = await prisma.company.update({
      where: { id: companyId },
      data: pickCompanyInput(rest),
    });

    await this.upsertPartyIdentifiers(
      companyId,
      identifiers,
      updatedCompany.countryCode ?? updatedCompany.country,
    );

    // A rename or a changed contact email is also what this company's Polar CUSTOMER should show —
    // pushed in the same request rather than waiting for the next lifecycle-sweep tick, best-effort
    // (never blocks this write — see `customer-sync.ts`'s own header). Only fired when one of the two
    // actually changed: every OTHER field this screen writes (address, currency, IBAN…) has no Polar
    // customer counterpart worth a network call on every save.
    if (existingCompany.name !== updatedCompany.name || existingCompany.email !== updatedCompany.email) {
      await syncPolarCustomerOnCompanyChange(companyId, {
        name: updatedCompany.name,
        email: updatedCompany.email,
        billingEmail: updatedCompany.billingEmail,
      });
    }

    logger.info('Company info updated', { category: 'company', details: { companyId: updatedCompany.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_UPDATED, {
        company: updatedCompany,
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_UPDATED webhook', { category: 'company', details: { error } });
    }

    return updatedCompany;
  }

  /**
   * Issue #496 - REFUSES every change. A document number format is defined per (country, document
   * type) in `documents/country-policy/data/xx.json`'s `numberFormats`, with the rules that constrain
   * it and their sources; the owner's decision of 2026-09-27 is that a company can no longer change it.
   * The endpoint stays, answering 405 with the reason, so an API client that used to set a format
   * learns why it cannot rather than meeting a bare 404. `GET /api/company/number-formats`
   * (`getNumberFormats` below) says which format applies and why.
   */
  updateNumberFormat(): never {
    throw new MethodNotAllowedException(
      'Document number formats can no longer be changed: they are defined per country and document ' +
        'type from the rules that constrain them (law, e-invoicing formats, clearance platforms). ' +
        'GET /api/company/number-formats shows the format that applies to each document type and why.',
    );
  }

  /**
   * The format each numbered document type of this company is numbered with, and why - the read-only
   * settings card. One entry per format the company's country declares, each resolved exactly as
   * numbering resolves it (`numbering/company-number-format.ts#resolveNumberFormatFor`, the running
   * series included), with the NEXT number it would print: read from the real counter, never
   * invented, so the screen shows the series continuing where it stands.
   */
  async getNumberFormats(companyId: string): Promise<CompanyNumberFormats> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { country: true, countryCode: true, numberFormats: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const countryCode =
      (company.countryCode || guessCountryCode(company.country ?? undefined) || '').trim().toUpperCase() ||
      null;
    const formats = countryCode ? defaultCountryPolicyCatalog.numberFormatsFor(countryCode) : undefined;
    if (!countryCode || !formats) {
      return {
        countryCode,
        runningSeries: null,
        formats: [],
        unavailableReason: countryCode
          ? `No document number formats are defined for country "${countryCode}".`
          : "The company's country could not be resolved, so no number format applies yet.",
      };
    }

    // Issue #515: `year` is part of `DocumentNumberSequence`'s own key now, so "the next number"
    // depends on which counter row a document issued TODAY would land on - see `periodKeyFor`'s own
    // header. Reading every row (never filtering by year in the query) keeps this one round trip: the
    // map below picks, per format, the row `periodKeyFor(resolved, now)` names.
    const sequences = await prisma.documentNumberSequence.findMany({
      where: { companyId },
      select: { typeId: true, year: true, nextNumber: true },
    });
    const now = new Date();

    return {
      countryCode,
      runningSeries: formats.runningSeries,
      unavailableReason: null,
      formats: formats.formats.map((format) => {
        const resolved = resolveNumberFormatFor(
          countryCode,
          format.typeId,
          company.numberFormats as Record<string, unknown> | null,
        );
        const year = periodKeyFor(resolved, now);
        const nextNumber =
          sequences.find((row) => row.typeId === format.typeId && row.year === year)?.nextNumber ?? 1;
        return {
          typeId: resolved.typeId,
          pattern: resolved.pattern,
          source: resolved.source,
          countryPattern: resolved.countryPattern,
          nextNumber,
          nextDisplayNumber: formatDocumentNumber(resolved.pattern, { number: nextNumber, date: now }),
          rationale: resolved.rationale,
          unconstrained: resolved.unconstrained ?? null,
          supersededRunningSeries: resolved.supersededRunningSeries ?? null,
          constraints: resolved.constraints.map((c) => ({
            id: c.id,
            summary: c.summary,
            maxLength: c.maxLength ?? null,
            provenance: c.provenance,
          })),
          reset: resolved.reset,
          resetProvenance: resolved.resetProvenance,
        };
      }),
    };
  }

  /**
   * Issue #340 - "declare your last number issued", step 1: a pure, no-write suggestion the frontend
   * shows as an EDITABLE pattern before the company confirms anything (`declareLastNumberIssued`
   * below re-derives everything from the CONFIRMED pattern, never from this guess). No country/DB
   * lookup needed - `inferNumberPatternFromExample` is a pure function of the example and its date.
   */
  inferLastNumberPattern(request: DeclareLastNumberInferRequest): DeclareLastNumberInferResponse {
    const referenceDate = new Date(request.lastIssueDate);
    if (Number.isNaN(referenceDate.getTime())) {
      throw new BadRequestException(`"${request.lastIssueDate}" is not a valid date.`);
    }
    const pattern = inferNumberPatternFromExample(request.lastNumber, referenceDate);
    return { pattern: pattern ?? null };
  }

  /**
   * Issue #340 - "declare your last number issued", step 2: the write. Usable WITHOUT importing any
   * document (the owner's own decision) - a company migrating its numbering by hand still needs the
   * counter to resume where the old tool left off. See `numbering/declare-last-number.ts`'s own
   * header for the full design, and `numbering/sequence.ts#seedSequenceStart`'s own header for why
   * this can only ever seed a counter that has NEVER numbered anything - refused otherwise (the
   * owner's own decision, §2 point 6: "once the first Invoicerr document is issued, nothing can
   * change").
   *
   * Portugal is handled first and separately: FAQ 4319 makes reusing the previous tool's own series
   * identifier illegal outright (a validation code, once used by ANY software, is never reused), so
   * this never even tries to resolve `pattern` against the country's shipped format the way every
   * other country does - see `declarePortugalNewSeries` below.
   */
  async declareLastNumberIssued(
    companyId: string,
    request: DeclareLastNumberRequest,
  ): Promise<DeclareLastNumberResponse> {
    if (request.typeId !== 'invoice' && request.typeId !== 'credit-note') {
      throw new BadRequestException(
        `"${request.typeId}" cannot be declared - issue #340's v1 covers "invoice" and "credit-note" only.`,
      );
    }
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { country: true, countryCode: true, numberFormats: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const countryCode = (company.countryCode || guessCountryCode(company.country ?? undefined) || '')
      .trim()
      .toUpperCase();
    if (!countryCode) {
      throw new BadRequestException(
        "The company's country could not be resolved, so no number format applies yet.",
      );
    }
    const formats = defaultCountryPolicyCatalog.numberFormatsFor(countryCode);
    const format = formats?.formats.find((f) => f.typeId === request.typeId);
    if (!formats || !format) {
      throw new BadRequestException(
        `"${request.typeId}" has no defined number format for "${countryCode}" - it may not be an ` +
          'issuable, numbered document type in this country.',
      );
    }

    const alreadyStarted = await prisma.documentNumberSequence.findFirst({
      where: { companyId, typeId: request.typeId },
      select: { companyId: true },
    });
    if (alreadyStarted) {
      throw new ConflictException(
        `Numbering has already started for "${request.typeId}" - the last number issued can only be ` +
          'declared once, before the first Invoicerr document of this type.',
      );
    }

    const referenceDate = new Date(request.lastIssueDate);
    if (Number.isNaN(referenceDate.getTime())) {
      throw new BadRequestException(`"${request.lastIssueDate}" is not a valid date.`);
    }
    const lastNumber = request.lastNumber?.trim();
    if (!lastNumber) {
      throw new BadRequestException('The last number issued is required.');
    }

    // Issue #603: read from the country's own `documentValidationCode` fact instead of a literal
    // 'PT' - behaviourally identical today, since Portugal is still the only country declaring that
    // fact (see this fact's own header in country-policy/schema.ts).
    const documentValidationCode = defaultCountryPolicyCatalog.documentValidationCodeFor(countryCode);
    if (documentValidationCode?.scheme === 'ATCUD') {
      return this.declarePortugalNewSeries(companyId, request.typeId, format, lastNumber, referenceDate);
    }

    const pattern = request.pattern?.trim();
    if (!pattern) {
      throw new BadRequestException('A number pattern is required (the inferred one, or your own).');
    }
    const declaredNumber = parseNumberFromPattern(pattern, referenceDate, lastNumber);
    if (declaredNumber === undefined) {
      throw new BadRequestException(
        `The pattern "${pattern}" does not reproduce "${lastNumber}" on ${request.lastIssueDate} - ` +
          'adjust it so it does before confirming.',
      );
    }

    const constraints = constraintsFor(formats, format);
    const violations = patternViolations(pattern, constraints);
    const keepsAsRunningSeries = violations.length === 0 && pattern !== format.pattern;

    if (keepsAsRunningSeries) {
      const existing = (company.numberFormats as Record<string, unknown> | null) ?? {};
      await prisma.company.update({
        where: { id: companyId },
        data: { numberFormats: { ...existing, [request.typeId]: pattern } as Prisma.InputJsonValue },
      });
    }

    const runningSeries = keepsAsRunningSeries
      ? { ...((company.numberFormats as Record<string, unknown> | null) ?? {}), [request.typeId]: pattern }
      : (company.numberFormats as Record<string, unknown> | null);
    const resolved = resolveNumberFormatFor(countryCode, request.typeId, runningSeries);
    const year = periodKeyFor(resolved, new Date());
    await seedSequenceStart(prisma, companyId, request.typeId, year, declaredNumber + 1);

    return {
      typeId: request.typeId,
      pattern: resolved.pattern,
      source: resolved.source,
      nextNumber: declaredNumber + 1,
      violations: violations.length > 0 ? violations : null,
      atcudSeriesToRegister: null,
    };
  }

  /**
   * Portugal never resumes the previous tool's own series (AT FAQ 4319: "Um código de validação de
   * série não poderá ser reutilizado ..."), whatever pattern that tool used - so, unlike every other
   * country, this NEVER tries `request.pattern`/`patternViolations` against the shipped format at
   * all. It always opens a brand-new series under the country's own shape (`FT A/{number}` /
   * `NC A/{number}`, `format.pattern`) UNLESS the previous tool's own last number shows it already
   * used identifier "A" (Invoicerr's own default) - parsed from `lastNumber` by the same
   * `TYPE SERIES/NUMBER` shape AT FAQ 4310 mandates (`numbering/atcud.ts#parseAtcudPattern` reads the
   * identical shape for a PATTERN; this reads it off one REAL NUMBER instead). In that one case the
   * fallback identifier is dated - "A" + the year this is declared, e.g. "A2026" - so it can never
   * collide with whatever the previous tool already registered, per the owner's own decision in #340.
   * Either way the counter still resumes at `last + 1` (FAQ 4318: a series' own numbering, once
   * communicated, keeps counting - it is the IDENTIFIER that may never repeat, not the requirement to
   * start over at 1).
   */
  private async declarePortugalNewSeries(
    companyId: string,
    typeId: 'invoice' | 'credit-note',
    format: { pattern: string },
    lastNumber: string,
    referenceDate: Date,
  ): Promise<DeclareLastNumberResponse> {
    const declaredNumber = extractTrailingNumber(lastNumber);
    if (declaredNumber === undefined) {
      throw new BadRequestException(
        `"${lastNumber}" carries no digits to resume numbering from - check the last number issued.`,
      );
    }

    const previousSeriesId = parsePortugueseSeriesIdentifier(lastNumber);
    const typePrefix = typeId === 'invoice' ? 'FT' : 'NC';
    const defaultSeriesId = 'A';
    const usesDatedFallback = previousSeriesId?.toUpperCase() === defaultSeriesId;
    const seriesId = usesDatedFallback ? `${defaultSeriesId}${referenceDate.getFullYear()}` : defaultSeriesId;
    const pattern = `${typePrefix} ${seriesId}/{number}`;
    const usesCountryDefault = pattern === format.pattern;

    if (!usesCountryDefault) {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { numberFormats: true },
      });
      const existing = (company?.numberFormats as Record<string, unknown> | null) ?? {};
      await prisma.company.update({
        where: { id: companyId },
        data: { numberFormats: { ...existing, [typeId]: pattern } as Prisma.InputJsonValue },
      });
    }

    // PT's own format never carries `{year}` (reset: "never" - a series counts continuously once
    // registered, FAQ 4317/4318), so `year` is always the `year: 0` sentinel here - no need to
    // resolve/periodKeyFor for a country this file already knows the answer for.
    await seedSequenceStart(prisma, companyId, typeId, 0, declaredNumber + 1);

    return {
      typeId,
      pattern,
      source: usesCountryDefault ? 'country-policy' : 'running-series',
      nextNumber: declaredNumber + 1,
      violations: null,
      atcudSeriesToRegister: seriesId,
    };
  }

  // Creates a brand-new company and makes the creating user its OWNER —
  // used both for a first-time user's onboarding and for an existing user
  // starting an additional company from the company switcher.
  async createCompany(userId: string, editCompanyDto: EditCompanyDto) {
    const { identifiers, ...data } = editCompanyDto;

    // Checked BEFORE the company row itself is created — same reasoning as
    // `clients.service.ts#createClient`'s identical guard: `upsertPartyIdentifiers` cannot run
    // first (no `companyId` yet), and a refusal surfacing only after create would leave an orphan
    // company (and its OWNER `UserCompany` row) behind.
    if (identifiers) {
      for (const entry of identifiers) {
        await assertIdentifierValueMatchesPattern({
          countryCode: data.countryCode ?? data.country,
          scheme: entry.scheme,
          value: entry.value,
        });
      }
    }

    // Same allow-list `editCompanyInfo` writes through — never `...data` (the raw JSON body minus
    // `identifiers`). This is the ONE route on this DTO open to any authenticated user regardless of
    // company membership (`companies.controller.ts`'s own comment), so an unchecked spread here was
    // the more exploitable half of the mass-assignment hole: a caller who knows no other id at all
    // can hand Prisma a nested `subscription: { create: { status: 'ACTIVE', ... } } }` and get an
    // ACTIVE subscription with no Polar customer behind it, or a `connect` naming another tenant's
    // row (subscription, signing certificate, channel config, client, document) and reassign it here
    // on creation. See `pickCompanyInput`'s own header.
    const picked = pickCompanyInput(data);
    const newCompany = await prisma.company.create({
      data: {
        ...picked,
        foundedAt: picked.foundedAt ?? new Date(),
        // Sensible blanks for the fields the simplified onboarding (name + country only) doesn't
        // collect — the user fills these in later via Settings. `??`, not the previous
        // spread-after-literal ordering, because `Company`'s columns are non-nullable `string`
        // (`prisma/generated/prisma/models/Company.ts`) while `pickCompanyInput`'s fields are all
        // OPTIONAL (`EditCompanyDto`): the old `{ city: '', ...picked }` shape let an explicit
        // `city: undefined` key from the spread silently win over the blank default — which
        // `tsc` catches as a type error (`picked.city` is `string | undefined`, the column wants
        // `string`) precisely because it WOULD have reached Prisma as `undefined`, i.e. "field not
        // provided" — throwing at runtime on a required column with no schema default, the exact
        // simplified-onboarding path (name + country only) this comment says must stay blank instead.
        address: picked.address ?? '',
        postalCode: picked.postalCode ?? '',
        city: picked.city ?? '',
        phone: picked.phone ?? '',
        email: picked.email ?? '',
      },
    });

    // A brand-new company's own OWNER is its first seat — assigned desk 1 on the generative office
    // plan (`billing/seat-sync.ts#withSeatReservation`, a no-op entirely when billing is disabled).
    await withSeatReservation(newCompany.id, userId, (tx) =>
      tx.userCompany.create({ data: { userId, companyId: newCompany.id, role: 'OWNER' } }),
    );
    // Practically always a no-op here (a brand-new company has no `polarSubscriptionId` yet), kept
    // for the rare case a company row is created for one already billed elsewhere — see
    // `billing/member-sync.ts`'s own header.
    await syncCompanyMemberOnMembershipChange(newCompany.id, userId);

    // Enriched expense categories ("notes de frais enrichies") — this brand-new company's default
    // expense category set (the ten categories + "Other" `expense.descriptor.ts` used to hardcode).
    // Idempotent (`ensureDefaultExpenseCategoriesSeeded`'s own header) — count is trivially 0 here, so
    // this always inserts; the SAME function also runs lazily, on first read, for a company that
    // predates this feature (`expense-categories/persistence.ts#listExpenseCategories`), so no data
    // migration was needed to backfill existing companies.
    await ensureDefaultExpenseCategoriesSeeded(newCompany.id);

    await this.upsertPartyIdentifiers(
      newCompany.id,
      identifiers,
      newCompany.countryCode ?? newCompany.country,
    );

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_CREATED, {
        company: newCompany,
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_CREATED webhook', error);
    }

    return newCompany;
  }

  /**
   * The two SYSTEM emails, each resolved to what ACTUALLY applies: this company's own `MailTemplate`
   * override when it has one, else the copy shipped in code (`mail/system-email-templates.ts`). Driven by
   * `SYSTEM_EMAIL_FAMILIES` rather than a list written down here, so a family added to the enum cannot
   * be silently missing from this response.
   *
   * Nothing is seeded to make this work. A company whose rows were never created — or were deleted
   * (`danger.service.ts`'s reset does exactly that) — still gets both templates here and can still send
   * both emails: "no row" means "the shipped default applies", never "unconfigured". That is what
   * replaced the upsert this method's own caller used to fire on every read of a company's info.
   */
  async getEmailTemplates(companyId: string): Promise<EmailTemplate[]> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { emailTemplates: true },
    });
    if (!company) {
      logger.warn('No company found for email templates', { category: 'company', details: { companyId } });
      throw new NotFoundException('Company not found');
    }

    return SYSTEM_EMAIL_FAMILIES.map((family): EmailTemplate => {
      const row = company.emailTemplates.find((candidate) => candidate.type === family) ?? null;
      const template = resolveSystemEmailTemplate(family, row);

      return {
        dbId: row?.id ?? '',
        id: family,
        companyId: company.id,
        name: systemEmailFamilyLabel(family),
        subject: template.subject,
        // The html part: this is the field the settings editor writes, and `MailTemplate.body` has held
        // html since it existed. The text/plain alternative is never stored — it is derived from this at
        // send time (`email-template.ts#deriveTextFromHtml`).
        body: template.html ?? template.body,
        source: row ? 'company' : 'default',
        variables: describeSystemEmailVocabulary(family, appUrl()),
      };
    });
  }

  /**
   * Saves this company's override of one system email.
   *
   * The family is identified by `id` (the family name) or by `dbId`, the row id a screen holding an
   * already-stored override will have — resolved TENANT-SCOPED, so a `dbId` belonging to another company
   * is simply not found rather than updated. An upsert, not an update: the row IS the override, and a
   * company overriding a shipped default for the first time has no row yet.
   *
   * Refused (400): an unidentifiable family, a blank subject, an empty body — none of those is a
   * sendable email. REPORTED in `warnings`, never refused: an unknown `{placeholder}`, exactly as the
   * engine documents (`renderEmailTemplate`). A typo in a verification-code template must never be what
   * stops a code from reaching someone mid-signature.
   */
  async updateEmailTemplate(
    companyId: string,
    input: { id?: string; dbId?: string; subject: string; body: string },
  ): Promise<EmailTemplate & { warnings: string[] }> {
    const family = await this.resolveSystemEmailFamily(companyId, input);
    const subject = input.subject ?? '';
    // Sanitized BEFORE the emptiness check (`mail/sanitize-email-html.ts`), so markup that is nothing
    // but a script tag is refused as an empty body rather than stored as one.
    const body = sanitizeEmailHtml(input.body ?? '');
    if (subject.trim() === '') {
      throw new BadRequestException('An email template needs a subject.');
    }
    if (body.trim() === '') {
      throw new BadRequestException('An email template needs a body.');
    }

    const row = await prisma.mailTemplate.upsert({
      where: { companyId_type: { companyId, type: family } },
      create: { companyId, type: family, subject, body },
      update: { subject, body },
      include: { company: true },
    });

    const variables = describeSystemEmailVocabulary(family, appUrl());
    const { warnings } = renderEmailTemplate(resolveSystemEmailTemplate(family, row), variables);

    logger.info('Email template updated', {
      category: 'company',
      details: { templateId: row.id, family, warningCount: warnings.length },
    });
    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED, {
        company: row.company,
        template: { id: row.id, type: row.type, subject: row.subject, body: row.body },
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_EMAIL_TEMPLATE_UPDATED webhook', {
        category: 'company',
        details: { error },
      });
    }

    return {
      dbId: row.id,
      id: family,
      companyId,
      name: systemEmailFamilyLabel(family),
      subject: row.subject,
      body: row.body,
      source: 'company',
      variables,
      warnings,
    };
  }

  /** Which family a write targets — by name when the caller knows it, else by the row id of an override
   *  it already holds. The `dbId` lookup carries `companyId`, so it can only ever resolve a row this
   *  tenant owns; an id from another company falls through to the same refusal as a missing one. */
  private async resolveSystemEmailFamily(
    companyId: string,
    input: { id?: string; dbId?: string },
  ): Promise<SystemEmailFamily> {
    const named = SYSTEM_EMAIL_FAMILIES.find((family) => family === input.id);
    if (named) return named;

    if (input.dbId) {
      const row = await prisma.mailTemplate.findFirst({
        where: { id: input.dbId, companyId },
        select: { type: true },
      });
      if (row) return row.type;
    }

    throw new BadRequestException(
      `Unknown email template — identify it by id (${SYSTEM_EMAIL_FAMILIES.join(' | ')}) or by dbId.`,
    );
  }
}
