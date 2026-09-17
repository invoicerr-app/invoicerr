import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { DocumentInstanceResult } from '../actions/action-registry';
import { findClientReferenceField } from '../actions/email-template';
import { resolveDocumentCustomFieldDescriptors } from '../company-custom-fields/persistence';
import { DocumentFieldDescriptor, DocumentTypeDescriptor } from '../descriptors/types';
import { extractCrossBorderMentions } from '../formats/shared-build';
import {
  resolveInvoiceNotes,
  ResolvedInvoiceNote,
  UnresolvedInvoiceNotePlaceholderError,
} from '../mentions/invoice-notes';
import { defaultMentionsCatalog } from '../mentions/registry';
import { resolveEnabledPaymentMethodPresentations } from '../payment-methods/persistence';
import { PaymentMethodPresentation } from '../payment-methods/types';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { computeDocumentTotals, DocumentTotals } from '../totals/compute-totals';
import { RenderLanguage } from './language/supported-languages';
import { resolveRecipientLanguage } from './language/resolve-recipient-language';
import { logoDataUriFor } from './branding/logo-storage';
import { renderDocumentHtml } from './render-html';
import { renderPdf } from './render-pdf';
import { buildEpcPayload, renderSepaQrDataUri } from './sepa-qr';

export interface RenderDocumentInstanceDeps {
  referenceRegistry: EntityReferenceRegistry;
}

/**
 * "Mentions obligatoires" — resolves the printed footer block for ONE instance.
 * Gated on `descriptor.usesLegalMentions` (types.ts's own header on why this is a document-TYPE
 * flag, not inferred from field presence): every non-invoice type today returns `[]` unconditionally,
 * so its own PDF is byte-for-byte unchanged by the legal mentions.
 *
 * `company.country` is the free-text column the country picker writes (the same field
 * `formats/semantic/build-semantic-invoice.ts`'s own `guessCountryCode` resolves for the CII/UBL
 * export) — but UNLIKE that bridge, this function does NOT fall back to 'FR' when the country cannot
 * be resolved: that bridge's fallback is a pre-existing, documented product default for its own
 * concern (a party's postal address always needs SOME country code to serialize); inventing the same
 * default here, for a DIFFERENT concern (which country's law applies), would be a guess the
 * "never invent a rule" discipline forbids. A company with a genuinely unresolvable country
 * simply prints no mentions in its PDF — never a throw, and never a silently-assumed jurisdiction.
 *
 * `issueDate` is read from the instance's own `data.issueDate` — the same field name
 * `formats/shared-build.ts` reads for BT-2, invoice-specific by construction (see that file's own
 * header): a document TYPE with no such field never sets `usesLegalMentions` in the first place, so
 * this function is never asked to resolve one for it. A missing or unparseable value returns `[]`
 * rather than guessing "today" — resolveInvoiceNotes` must be handed the document's OWN issue date,
 * never a stand-in, or the freeze property (`mentions/schema.ts`'s own header) would be silently
 * broken for exactly the record that most needs it (a document with bad data on file).
 *
 * APPENDED (2026-09-13) — `data.__crossBorderMentions`, the SAME sidecar
 * `formats/shared-build.ts#extractCrossBorderMentions` already reads for the semantic XML export (a
 * cross-border invoice's reverse-charge/intra-Community/export mention, or a domestic invoice from a
 * seller under a non-STANDARD tax scheme — `tax/resolve-invoice-tax.ts#applyDomesticTaxScheme`, the
 * fix for a company ticking "VAT exempt" in Settings). Before this, the PDF's own footer never showed
 * either kind of mention at all — only the downloaded EN 16931 XML did — so a seller mailing the PDF
 * straight to a customer (the common case; not everyone downloads the XML) would omit a mention the
 * law requires printed. Reused, never re-filtered a second way, and APPENDED after the
 * country-mandated mentions above — the SAME order `build-semantic-invoice.ts`'s own BG-1 already
 * uses. `subjectCode` is left unset for these (a `LegalMention` never carries a UNTDID 4451 subject
 * code, same as that bridge's own comment on this), which `ResolvedInvoiceNote` already allows as an
 * optional field — no separate type needed to satisfy `RenderableLegalMention` below.
 */
export function legalMentionsFor(
  descriptor: DocumentTypeDescriptor,
  companyCountry: string | null | undefined,
  data: Record<string, unknown>,
): ResolvedInvoiceNote[] {
  if (!descriptor.usesLegalMentions) return [];

  const countryMandated = ((): ResolvedInvoiceNote[] => {
    const rawIssueDate = data.issueDate;
    if (typeof rawIssueDate !== 'string' && typeof rawIssueDate !== 'number') return [];
    const issueDate = new Date(rawIssueDate);
    if (Number.isNaN(issueDate.getTime())) return [];

    const countryCode = guessCountryCode(companyCountry ?? undefined);
    return resolveInvoiceNotes(defaultMentionsCatalog.fileFor(countryCode), issueDate);
  })();

  const crossBorder: ResolvedInvoiceNote[] = extractCrossBorderMentions(data).map((m) => ({
    text: m.text,
    legalRef: m.code,
  }));

  return [...countryMandated, ...crossBorder];
}

/**
 * "QR SEPA / GiroCode" — resolves the SEPA-payment QR block for ONE
 * instance, gated the same layered way `legalMentionsFor` above is: EVERY condition must hold before a
 * QR is even attempted — the document TYPE opts in (`descriptor.usesPaymentQr`), the seller has an
 * IBAN on file, the document's own `currency` field is EUR (SEPA Credit Transfer moves nothing else),
 * and the computed total is actually positive (nothing to collect on a zero or negative document —
 * `totals.grossMinor` is the SAME figure the totals block on the PDF already shows, never a separately
 * re-derived one). Any single condition failing returns `undefined` — no QR at all, never a broken
 * one — the same discipline `buildEpcPayload` itself holds internally for its own, narrower checks
 * (amount bounds, payload length).
 *
 * `displayNumber` is a separate parameter from `data`, deliberately: it lives on the INSTANCE
 * (`instance.displayNumber`, assigned by `numbering/` at issuance), not inside the document's own
 * user-editable `data` object — the exact same split `RenderDocumentHtmlInput.instance` vs `.company`/
 * `.totals` already draws below, and the reason `render-html.ts`'s own header gives for why
 * `displayNumber` is optional there too (absent/null before numbering, or for a type that never
 * numbers at all).
 */
export async function sepaPaymentQrFor(
  descriptor: DocumentTypeDescriptor,
  company: { name: string; iban?: string | null },
  totals: DocumentTotals,
  data: Record<string, unknown>,
  displayNumber: string | null | undefined,
): Promise<{ dataUri: string } | undefined> {
  if (!descriptor.usesPaymentQr) return undefined;
  if (!company.iban) return undefined;
  if (data.currency !== 'EUR') return undefined;
  if (!(totals.grossMinor > 0)) return undefined;

  const payload = buildEpcPayload({
    beneficiaryName: company.name,
    iban: company.iban,
    amountMinor: totals.grossMinor,
    currency: 'EUR',
    remittance: displayNumber,
  });
  // buildEpcPayload already re-checks amount bounds and the overall payload length — a `null` here
  // means one of ITS OWN guards tripped despite every gate above passing (e.g. a total over the
  // EPC069-12 ceiling), and the same "never a broken QR" rule applies: render nothing.
  if (!payload) return undefined;

  return { dataUri: await renderSepaQrDataUri(payload) };
}

/**
 * "Payment methods" — resolves the "how to pay" block for ONE instance, gated
 * the same layered way `sepaPaymentQrFor` right above is: this document TYPE must opt in
 * (`descriptor.usesPaymentMethods`), and even then, an empty array (no method the company has
 * ENABLED — `payment-methods/persistence.ts`) is a perfectly normal outcome, not an error — see that
 * function's own header, and `render-html.ts`'s own "nothing, not an empty frame" rule for `paymentMethods`.
 *
 * `amountMinor` is passed only when POSITIVE — the exact same guard `sepaPaymentQrFor` holds for its
 * own QR — so a zero/negative-total document (nothing owed) never hands a method a nonsensical amount
 * to build a "pay X" link from; every built-in method already degrades to "no link" without one (see
 * `PaymentMethodRenderContext`'s own header), this is only the belt to that braces.
 */
export async function paymentMethodsFor(
  descriptor: DocumentTypeDescriptor,
  companyId: string,
  totals: DocumentTotals,
  data: Record<string, unknown>,
  displayNumber: string | null | undefined,
): Promise<PaymentMethodPresentation[]> {
  if (!descriptor.usesPaymentMethods) return [];

  const currency = typeof data.currency === 'string' ? data.currency : undefined;
  return resolveEnabledPaymentMethodPresentations(companyId, {
    amountMinor: totals.grossMinor > 0 ? totals.grossMinor : undefined,
    currency,
    reference: displayNumber ?? undefined,
  });
}

/**
 * Custom fields — resolves the "additional fields" block for ONE
 * instance: every DOCUMENT-target custom field definition for `companyId`/`typeId` that ACTUALLY
 * CARRIES A VALUE on `data`, paired with the raw value itself (`render-html.ts`'s own block formats
 * it, by kind — see `RenderDocumentHtmlInput.customFields`'s own header for why this hands over the
 * descriptor+value pair rather than a pre-formatted string).
 *
 * Resolved with `includeArchived: true`, deliberately UNLIKE the create/edit FORM's own fetch
 * (`company-custom-fields.controller.ts`'s `GET .../resolved`, active-only): a PDF is regenerated
 * on demand, every time it is downloaded, from whatever is CURRENTLY in `data` — an already-issued
 * document that has a value for a definition a company later archived (renamed away, or retired)
 * must keep printing that value on every future re-download, exactly as it always did, which is only
 * possible if archived definitions still resolve here. Never a live/DB round trip surprise for a
 * company with none defined at all: `resolveDocumentCustomFieldDescriptors` returns `[]` instantly
 * when this company has no DOCUMENT-target rows for this type, the routine case.
 */
async function companyCustomFieldsFor(
  companyId: string,
  typeId: string,
  data: Record<string, unknown>,
): Promise<{ field: DocumentFieldDescriptor; value: unknown }[]> {
  const fields = await resolveDocumentCustomFieldDescriptors(companyId, typeId, { includeArchived: true });
  return fields
    .map((field) => ({ field, value: data[field.key] }))
    .filter(({ value }) => value !== undefined && value !== null && value !== '');
}

/**
 * Per-recipient document language — resolves the document's own
 * recipient language, ahead of the render, from the SAME client id `referenceLabels` above already
 * resolves a display name for (`findClientReferenceField`, the one rule `actions/email-template.ts`
 * owns — see its own updated header). A document type with no "client" reference field at all
 * (`expense` has none; `credit-note`/`received-invoice` don't reference one either) simply never has a
 * client to ask, and falls straight to `company.language` — never a lookup on an id that doesn't exist.
 *
 * A dangling/unresolvable client id (the same defensive case the `referenceLabels` loop above already
 * tolerates) is read the same way: a scoped lookup returning `null` is not an error here, just "no
 * client-level preference available" — this function must never THROW over a language choice, the
 * same "a rendering gap must never block issuing/sending the document itself" discipline that loop's
 * own comment states. Scoped by `companyId` for the SAME reason `referenceLabels`' own lookup above
 * goes through the company-scoped `EntityReferenceRegistry` rather than a bare Prisma call: `clientId`
 * is read straight off the document's own reference field, never checked for existence at write time
 * (descriptors/field-kinds.ts's own comment on the 'reference' kind) — an id naming ANOTHER company's
 * client must fall back to `companyLanguage` exactly like a dangling one already does, never actually
 * resolve to that other tenant's own language preference.
 */
async function recipientLanguageFor(
  companyId: string,
  descriptor: DocumentTypeDescriptor,
  companyLanguage: string | null | undefined,
  data: Record<string, unknown>,
): Promise<RenderLanguage> {
  const clientField = findClientReferenceField(descriptor);
  const clientId = clientField ? data[clientField.key] : undefined;

  if (typeof clientId !== 'string' || clientId === '') {
    return resolveRecipientLanguage(undefined, companyLanguage);
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { language: true },
  });
  return resolveRecipientLanguage(client?.language, companyLanguage);
}

export interface RenderedDocumentInstance {
  pdf: Buffer;
  /** REUSED by the send path's email template (`actions/email-template.ts`'s `totalGross`) — this is
   *  the ONE `computeDocumentTotals` call for a given send, never a second one. */
  totals: DocumentTotals;
  /** REUSED the same way, for `recipientName` — see `buildEmailTemplateParts`. */
  referenceLabels: Record<string, string>;
  /** REUSED for `companyName` — the exact name already fetched to put in the PDF's own header. */
  companyName: string;
  /** REUSED by the send path (`actions/send-document-email.ts`) to resolve the SAME language the PDF
   *  was just rendered in for the accompanying email's own default template — see
   *  `language/resolve-recipient-language.ts`. Computed once, here, never twice. */
  language: RenderLanguage;
  /** REUSED by the send path the exact same way `totals`/`referenceLabels`/`companyName` already are
   *  — the SAME "Payment methods" presentations just printed on the PDF, appended to the covering
   *  email (`actions/send-document-email.ts`) so the two never disagree about which methods a company
   *  currently offers. Empty for a type that never opts in (`descriptor.usesPaymentMethods`), or one
   *  that opts in with nothing currently enabled — see `paymentMethodsFor`'s own header. */
  paymentMethods: PaymentMethodPresentation[];
}

/**
 * The ONE place the HTML->PDF pipeline (renderDocumentHtml + renderPdf), the reference-label
 * resolution, and the totals computation are composed for a single document instance. Extracted out
 * of `DocumentsService.renderInstancePdf` (documents.service.ts, now a thin wrapper around this
 * function) so the document-SEND paths — the quote's own "send" (actions/generic-actions.ts) and the
 * invoice's "email" transport (transports/email-transport.ts) — attach the EXACT SAME PDF a user gets
 * from "GET /documents/:id/pdf", instead of a second implementation of any of this (see
 * actions/send-document-email.ts, the shared caller both of those go through).
 *
 * Takes the DESCRIPTOR already resolved by the caller, deliberately, rather than a `typeId` plus a
 * `DocumentTypeRegistry`: `DocumentsService`'s own "GET .../pdf" route resolves the MERGED descriptor
 * (native fields + whatever a third party attached via `ActionExtensionRegistry` — see
 * `mergedDescriptor`); the send paths resolve only the type's NATIVE one
 * (`DocumentTypeRegistry.resolve`). Both are the SAME descriptor for rendering purposes — an
 * extension only ever adds to `actions`, never to `fields` (`ActionExtensionRegistry`'s own shape
 * proves it: it stores nothing but `DocumentActionDescriptor`s), and `fields` is all this function
 * (and `computeDocumentTotals`) ever reads. Depending on `ActionExtensionRegistry` here to compute
 * the merge anyway would also be a genuine CIRCULAR dependency, not a shortcut: that registry is
 * itself built FROM `ActionRegistry` (documents.module.ts's `buildActionExtensionRegistry`), which is
 * exactly where the send actions this function serves are registered. Accepting an already-resolved
 * descriptor sidesteps the question instead of fighting it.
 */
export async function renderDocumentInstance(
  deps: RenderDocumentInstanceDeps,
  companyId: string,
  descriptor: DocumentTypeDescriptor,
  instance: Pick<DocumentInstanceResult, 'id' | 'status' | 'data' | 'createdAt' | 'displayNumber' | 'atcud'>,
): Promise<RenderedDocumentInstance> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    // `iban: true` — "QR SEPA / GiroCode": read here for `sepaPaymentQrFor`
    // below, never rendered directly in the company header block (`render-html.ts` has no field for
    // it there). `language: true` — the FALLBACK layer for `recipientLanguageFor` below, read
    // unconditionally (it's one column on a row this function fetches anyway). The three
    // `branding*` columns (chantier B) feed `render-html.ts`'s own `branding` input below.
    // `exemptVat: true` — read here for `computeDocumentTotals`'s own `sellerExemptVat` option below
    // (`DocumentTotals.showVat`), never rendered directly in `render-html.ts`'s company header block.
    select: {
      name: true,
      address: true,
      city: true,
      postalCode: true,
      country: true,
      iban: true,
      language: true,
      exemptVat: true,
      brandingAccentColor: true,
      brandingFont: true,
      brandingLogoId: true,
    },
  });
  if (!company) {
    throw new NotFoundException(`Company "${companyId}" not found.`);
  }

  const instanceData = (instance.data as Record<string, unknown>) || {};
  const referenceLabels: Record<string, string> = {};

  for (const field of descriptor.fields) {
    if (field.kind !== 'reference' || (!field.entity && !field.entities)) continue;

    const value = instanceData[field.key];
    if (!value) continue;

    let entityName: string | undefined;
    let refId: string | undefined;

    if (field.entities) {
      // Multi-target reference: value is { entity, id }
      const multiValue = value as { entity?: string; id?: string } | undefined;
      entityName = multiValue?.entity;
      refId = multiValue?.id;
    } else {
      // Single-target reference: value is just an id string
      entityName = field.entity;
      refId = String(value);
    }

    if (!entityName || !refId) continue;

    try {
      const resolved = await deps.referenceRegistry.resolve(entityName).resolve(companyId, refId);
      if (resolved?.label) {
        referenceLabels[field.key] = resolved.label;
      }
    } catch {
      // Gracefully fall back to the raw id if resolution fails (an unregistered entity, a dangling
      // reference) — a rendering gap must never block issuing/sending the document itself, the same
      // discipline DocumentsService.renderInstancePdf always held here.
      referenceLabels[field.key] = refId;
    }
  }

  // A franchise-base seller's DRAFT can still carry a stray non-zero line rate until "send" rewrites
  // every line to 0% (`tax/resolve-invoice-tax.ts#applyDomesticTaxScheme`) — `sellerExemptVat` hides
  // the redundant VAT row on THIS PDF (draft preview or final) without waiting for that resolution,
  // and without touching a single net/vat/gross figure (see `DocumentTotals.showVat`'s own header).
  const totals = computeDocumentTotals(descriptor, instanceData, { sellerExemptVat: company.exemptVat });
  const language = await recipientLanguageFor(companyId, descriptor, company.language, instanceData);
  const paymentMethods = await paymentMethodsFor(
    descriptor,
    companyId,
    totals,
    instanceData,
    instance.displayNumber,
  );
  const customFields = await companyCustomFieldsFor(companyId, descriptor.id, instanceData);

  // A mention whose own placeholder cannot be resolved for this issue date
  // (`mentions/invoice-notes.ts#UnresolvedInvoiceNotePlaceholderError` — a catalog with no value
  // covering the date, e.g. a pre-2026 French invoice against `lateFeeRate`, or a maintenance lapse
  // past the catalog's own last dated window) is a DATA problem the caller can act on — a wrong or
  // stale legal mention, never a server bug — so it becomes a named 400 here, the exact same
  // "isInvoiceTaxBlockError-shaped" treatment `invoice-actions.ts`'s own cross-border-tax preflight
  // already gives `UnresolvedBuyerCountryError`/`ForeignVatRateError` and their siblings. Left
  // uncaught, this would otherwise surface as a bare 500 to whoever downloads or is sent this PDF —
  // exactly the "silent break" this named error type exists to prevent from happening TWICE (once as
  // a printed `{token}`, once as an unexplained crash).
  let legalMentions: ResolvedInvoiceNote[];
  try {
    legalMentions = legalMentionsFor(descriptor, company.country, instanceData);
  } catch (error) {
    if (error instanceof UnresolvedInvoiceNotePlaceholderError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  const html = renderDocumentHtml({
    descriptor,
    instance: {
      id: instance.id,
      status: instance.status,
      data: instanceData,
      createdAt: instance.createdAt,
      displayNumber: instance.displayNumber,
      atcud: instance.atcud,
    },
    company,
    referenceLabels,
    totals,
    language,
    legalMentions,
    paymentQr: await sepaPaymentQrFor(descriptor, company, totals, instanceData, instance.displayNumber),
    paymentMethods,
    customFields,
    branding: {
      accentColor: company.brandingAccentColor,
      font: company.brandingFont,
      logoDataUri: logoDataUriFor(companyId, company.brandingLogoId),
    },
  });

  // Portugal's ATCUD "on every page" (Portaria n.º 195/2020, art. 4.º n.º 3) — the SAME string just
  // printed once in the body above, additionally repeated as a PDF footer on every page Chromium lays
  // out (see `renderPdf`'s own header on why this needs Chromium's native footer mechanism rather than
  // anything expressible in the main document's own HTML/CSS). Absent for every document with no
  // `atcud` at all — every non-Portuguese, or non-invoice, PDF keeps the exact page setup it always had.
  const pdf = await renderPdf(html, instance.atcud ? { footerText: instance.atcud } : {});

  return { pdf, totals, referenceLabels, companyName: company.name, language, paymentMethods };
}
