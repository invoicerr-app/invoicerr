import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EditCompanyDto, IdentifierEntry } from '@/modules/company/dto/company.dto';
import { MailTemplateType, WebhookEvent } from '../../../prisma/generated/prisma/client';

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
import { assertValidNumberPattern } from '@/modules/documents/numbering/format-number';
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
>;

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
    return await prisma.company.findUnique({ where: { id: companyId }, include: { partyIdentifiers: true } });
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
    // `id`, `createdAt`, and, directly relevant to numbering, `numberFormats` itself, which would
    // bypass `assertValidNumberPattern` (the check `updateNumberFormat` below always runs) and let an
    // invalid pattern sit in the database until it fails loudly, far from here, at issuance. Every
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
   * Sets ONE document type's own number-format PATTERN (`Company.numberFormats`,
   * `documents/numbering/format-number.ts`). Deliberately its OWN small endpoint/method, never folded
   * into `editCompanyInfo`'s `EditCompanyDto` above: `numberFormats` must only ever be written through
   * a path that runs `assertValidNumberPattern` — see `editCompanyInfo`'s own comment on why its
   * allow-list deliberately excludes this column. Two callers merge into the same JSON blob today: the
   * Portuguese ATCUD settings screen (`documents/numbering/atcud.ts#parseAtcudPattern` requires a
   * "/{number...}"-shaped pattern) and the main company settings screen's "Number formats" card, one
   * `PUT` per type (quote, then invoice) rather than a single multi-type call — see that screen's own
   * `onSubmit` for why the two are sequenced rather than fired concurrently.
   *
   * MERGES into the existing JSON blob (read-modify-write) rather than replacing it outright — a
   * future second type writing through this same method must never silently erase what a prior call
   * stored for a DIFFERENT typeId. `assertValidNumberPattern` is the SAME eager check
   * `numbering/format-number.ts#resolveNumberFormat` re-applies at issuance time — reject here, at
   * SAVE time, rather than let a company store a pattern that would only fail loudly the next time it
   * tries to issue anything.
   */
  async updateNumberFormat(
    companyId: string,
    typeId: string,
    pattern: string,
  ): Promise<Record<string, string>> {
    const trimmedTypeId = typeId?.trim();
    const trimmedPattern = pattern?.trim();
    if (!trimmedTypeId) throw new BadRequestException('typeId is required.');
    if (!trimmedPattern) throw new BadRequestException('pattern is required.');

    try {
      assertValidNumberPattern(trimmedPattern, `for document type "${trimmedTypeId}"`);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const existingCompany = await prisma.company.findUnique({
      where: { id: companyId },
      select: { numberFormats: true },
    });
    if (!existingCompany) {
      throw new NotFoundException('Company not found');
    }

    const existingFormats = (existingCompany.numberFormats as Record<string, string> | null) ?? {};
    const numberFormats = { ...existingFormats, [trimmedTypeId]: trimmedPattern };

    await prisma.company.update({ where: { id: companyId }, data: { numberFormats } });

    logger.info('Company number format updated', {
      category: 'company',
      details: { companyId, typeId: trimmedTypeId },
    });

    return numberFormats;
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
