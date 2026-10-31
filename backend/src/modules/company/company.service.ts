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
import { normalizeDueDays, normalizeDueMode } from '@/modules/company/payment-terms/resolve-payment-terms';
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
  applyCompanyProfileInput,
  InvalidCompanyProfileValueError,
  parseCompanyProfileValues,
} from '@/modules/documents/company-profile/profile';
import { defaultCompanyProfileCatalog } from '@/modules/documents/company-profile/registry';
import { CompanyProfileValues } from '@/modules/documents/company-profile/schema';
import {
  CompanyNumberFormats,
  DeclareLastNumberInferRequest,
  DeclareLastNumberInferResponse,
  DeclareLastNumberRequest,
  DeclareLastNumberResponse,
} from './dto/number-formats.dto';
import { assertIdentifierValueMatchesPattern } from '@/modules/documents/country-identifiers/validate-identifier-value';
import {
  InvalidCompanyLawDetailsError,
  normalizeCompanyLawDetails,
} from '@/modules/documents/company-law/company-law';
import { ensureDefaultExpenseCategoriesSeeded } from '@/modules/documents/expense-categories/persistence';
import { withSeatReservation } from '@/modules/billing/seat-sync';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import { syncPolarCustomerOnCompanyChange } from '@/modules/billing/customer-sync';
import prisma from '@/prisma/prisma.service';
import { sessionCache } from '@/lib/session-cache';
import { companyMemberIds } from '@/modules/companies/company-member-ids';
import { loadPaymentTerms } from '@/modules/company/payment-terms/load-payment-terms';
import { NEW_COMPANY_TEMPLATE } from '@/modules/documents/rendering/branding/templates';

/**
 * One system email template as the settings routes hand it over: the signature request and the
 * verification code only. A document type's email is a different mechanism, keyed by type.
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
 * The only `Company` columns a caller may set, the single allow-list both `createCompany` and
 * `editCompanyInfo` write through.
 *
 * The DTO is an erased interface and the API has no `ValidationPipe`, so this function is the only
 * barrier between the raw body and Prisma. Without it a caller could name a relation, and because the
 * foreign key lives on the child row, a nested `connect` would reassign someone else's subscription,
 * certificate or channel to their own company rather than fail.
 */
// `Pick<EditCompanyDto, ...>` preserves each field's optionality, so `createCompany` can spread this
// after its own fallback values without TypeScript marking them as always overwritten.
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
  | 'quoteDueDays'
  | 'quoteDueMode'
  | 'invoiceDueDays'
  | 'invoiceDueMode'
>;

/**
 * `distanceSalesRegime` accepts exactly two values or nothing. With no runtime validation, a typo would
 * be stored and then read back as "not declared", leaving the company believing it declared something
 * while every cross-border B2C sale was refused. `undefined` keeps the column, null clears it.
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

function normalizeCompanyLaw(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  try {
    const details = normalizeCompanyLawDetails(value);
    if (details === undefined) return undefined;
    return details === null ? Prisma.DbNull : (details as Prisma.InputJsonValue);
  } catch (error) {
    if (error instanceof InvalidCompanyLawDetailsError) throw new BadRequestException(error.message);
    throw error;
  }
}

/**
 * The company profile to store after this edit, or `undefined` to leave the column untouched. Values
 * are checked against the attributes of the country the company has AFTER the edit, and a country
 * change drops the values the new country does not ask for.
 */
function nextReportingProfile(
  existing: { country: string; countryCode: string | null; reportingProfile: unknown },
  input: Pick<EditCompanyDto, 'country' | 'countryCode' | 'reportingProfile'>,
): CompanyProfileValues | undefined {
  const existingCountry = resolveCountryCode(existing.countryCode, existing.country);
  const nextCountry = resolveCountryCode(
    input.countryCode === null ? null : (input.countryCode ?? existing.countryCode),
    input.country ?? existing.country,
  );
  if (input.reportingProfile === undefined && nextCountry === existingCountry) return undefined;
  try {
    return applyCompanyProfileInput(
      parseCompanyProfileValues(existing.reportingProfile),
      input.reportingProfile === undefined ? {} : input.reportingProfile,
      defaultCompanyProfileCatalog.attributesFor(nextCountry),
    );
  } catch (error) {
    if (error instanceof InvalidCompanyProfileValueError) throw new BadRequestException(error.message);
    throw error;
  }
}

function resolveCountryCode(
  countryCode: string | null | undefined,
  country: string | null | undefined,
): string {
  return (countryCode || guessCountryCode(country ?? undefined) || '').trim().toUpperCase();
}

export function pickCompanyInput(
  input: EditCompanyDto,
): PickedCompanyInput & { companyLaw?: Prisma.InputJsonValue | typeof Prisma.DbNull } {
  return {
    companyLaw: normalizeCompanyLaw(input.companyLaw),
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
    quoteDueDays: normalizeDueDays('quoteDueDays', input.quoteDueDays),
    quoteDueMode: normalizeDueMode('quoteDueMode', input.quoteDueMode),
    invoiceDueDays: normalizeDueDays('invoiceDueDays', input.invoiceDueDays),
    invoiceDueMode: normalizeDueMode('invoiceDueMode', input.invoiceDueMode),
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

    // The country's own `documentValidationCode` fact (ATCUD for Portugal) belongs here, so the
    // frontend never maps country codes to it.
    const countryCode = resolveCountryCode(result.countryCode, result.country);
    return {
      ...result,
      documentValidationCode: defaultCountryPolicyCatalog.documentValidationCodeFor(countryCode) ?? null,
      companyProfileAttributes: defaultCompanyProfileCatalog
        .attributesFor(countryCode)
        .map(({ key, label, help, values }) => ({ key, label, help, values })),
    };
  }

  /** 404 rather than a 500 when the company does not exist: a resolved-settings caller always expects
   *  an object, never a shape it has to special-case. */
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

  async getPaymentTerms(companyId: string) {
    return loadPaymentTerms(companyId);
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

    // Explicit allow-list, never `...rest`: no request validation runs at runtime, so `rest` is raw
    // caller JSON. Spreading it would let a caller write any Company column by name, including
    // `numberFormats`, whose running series must never be written again. Every writable field is named
    // once, in `pickCompanyInput`, shared with `createCompany`.
    const updatedCompany = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...pickCompanyInput(rest),
        reportingProfile: nextReportingProfile(existingCompany, rest),
      },
    });
    if (existingCompany.name !== updatedCompany.name) {
      await sessionCache.invalidateUsers(await companyMemberIds(prisma, companyId));
    }

    await this.upsertPartyIdentifiers(
      companyId,
      identifiers,
      updatedCompany.countryCode ?? updatedCompany.country,
    );

    // A rename or a changed email is what this company's Polar customer should show, pushed in the same
    // request and best-effort. Only those two fields have a counterpart worth a network call on save.
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
   * Refuses every change: a format is fixed per (country, document type) by the rules that constrain
   * it. The endpoint stays as a 405 with the reason, so an old API client learns why instead of
   * meeting a bare 404.
   */
  updateNumberFormat(): never {
    throw new MethodNotAllowedException(
      'Document number formats can no longer be changed: they are defined per country and document ' +
        'type from the rules that constrain them (law, e-invoicing formats, clearance platforms). ' +
        'GET /api/company/number-formats shows the format that applies to each document type and why.',
    );
  }

  /**
   * The format each numbered type uses and why, the read-only settings card. Each entry is resolved the
   * way numbering resolves it, running series included, and its next number comes from the real counter.
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

    // A document issued today lands on the counter row `periodKeyFor` names, so read every row rather
    // than filtering by year: one round trip, and the map picks the right one.
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
   * Step 1 of "declare your last number issued": a pure, no-write suggestion shown as an editable
   * pattern. The write below re-derives everything from the confirmed pattern, never from this guess.
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
   * Step 2, the write. Usable without importing a document, since a company migrating its numbering
   * needs the counter to resume where the old tool stopped. Only a counter that has never numbered
   * anything can be seeded; refused otherwise.
   *
   * Portugal is handled separately: FAQ 4319 forbids reusing the previous tool's series identifier,
   * so a new series is always opened under the country's own shape.
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

    // Read the country's fact rather than a literal 'PT': Portugal is today the only country declaring
    // it.
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
   * Portugal never resumes the previous tool's series (FAQ 4319 forbids reusing a validation code), so
   * the pattern is not checked against the shipped format: a new series opens in the country's own
   * shape. If the old number already used identifier "A", a dated one ("A2026") avoids the collision.
   * The counter still resumes at `last + 1` (FAQ 4318: the identifier may not repeat, numbering does
   * not restart at 1).
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

    // PT's format never carries `{year}` (a series counts continuously once registered), so the year is
    // always the sentinel here.
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

  // Creates a company and makes the calling user its OWNER, for onboarding and for an additional
  // company.
  async createCompany(userId: string, editCompanyDto: EditCompanyDto) {
    const { identifiers, ...data } = editCompanyDto;

    // Checked before the row exists: `upsertPartyIdentifiers` needs a companyId, and a refusal after
    // create would leave an orphan company and its OWNER membership behind.
    if (identifiers) {
      for (const entry of identifiers) {
        await assertIdentifierValueMatchesPattern({
          countryCode: data.countryCode ?? data.country,
          scheme: entry.scheme,
          value: entry.value,
        });
      }
    }

    // Same allow-list as `editCompanyInfo`, never `...data`: this route is open to any authenticated
    // user, so an unchecked spread would let a caller create an ACTIVE subscription with no customer
    // behind it or connect another tenant's row. See `pickCompanyInput`.
    const picked = pickCompanyInput(data);
    const newCompany = await prisma.company.create({
      data: {
        ...picked,
        foundedAt: picked.foundedAt ?? new Date(),
        // Blank defaults for fields the simplified onboarding does not collect. `??` rather than a
        // spread after a literal: an explicit `undefined` in the spread would otherwise override the
        // blank and reach a non-nullable column.
        address: picked.address ?? '',
        postalCode: picked.postalCode ?? '',
        city: picked.city ?? '',
        phone: picked.phone ?? '',
        email: picked.email ?? '',
        brandingTemplate: NEW_COMPANY_TEMPLATE,
      },
    });

    // The creator is the company's first seat on the office plan.
    await withSeatReservation(newCompany.id, userId, (tx) =>
      tx.userCompany.create({ data: { userId, companyId: newCompany.id, role: 'OWNER' } }),
    );
    await sessionCache.invalidateUsers([userId]);
    // A no-op for a new company, kept for a row created for one already billed elsewhere.
    await syncCompanyMemberOnMembershipChange(newCompany.id, userId);

    // Seeds the default expense categories. Idempotent, and the same function also backfills lazily on
    // first read, so no data migration was needed.
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
   * The two system emails as they actually apply: the company's own override when one exists, else the
   * copy shipped in code. Driven by the family enum, so a new family cannot be silently missing.
   *
   * No row means "the shipped default applies", never "unconfigured", so nothing is seeded and a
   * company whose rows were deleted still sends both emails.
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
   * Saves the company's override of one system email. The family comes from `id` or from `dbId`, resolved
   * tenant-scoped so another company's row id is simply not found. An upsert, since the first override
   * has no row yet.
   *
   * A blank subject or empty body is refused. An unknown placeholder is only reported, so a typo never
   * stops a verification code from reaching someone.
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
