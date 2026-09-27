/**
 * "Channel mandated by country" — evaluates whether a country's channel-policy MANDATE
 * (schema.ts's `ChannelPolicyFact.requirement === 'mandated'`) has come into force for one particular
 * invoice. Kept in its own small file (not folded into `registry.ts`'s plain lookup, nor into
 * `invoice-actions.ts` itself) because the DATE COMPARISON below is the one genuinely new piece of
 * logic this file adds, and it deserves its own focused tests (`mandate.spec.ts`) independent of the
 * catalog's own loading tests (`registry.spec.ts`) and of `invoice-actions.ts`'s own preflight wiring
 * (`actions/invoice-channel-mandate.spec.ts`).
 *
 * THE ONE DECISION THIS FILE EXISTS TO MAKE EXPLICIT AND TESTABLE: a mandate is evaluated against the
 * INVOICE's own `issueDate` field, never against the server's current date (`new Date()`). Two
 * reasons, both real, not merely defensive:
 *
 *  1. Legally, the mandate is a fact about WHEN AN OPERATION WAS CARRIED OUT, not about when someone
 *     happens to click "Send". France's own CGI art. 289 bis phrases its e-invoicing mandate as
 *     applying to operations "à compter du" a date — the operation's date is the invoice's own
 *     `issueDate`, exactly the field the (removed) compliance engine's `TransactionContext.issueDate`
 *     keyed its own temporal `validFrom`/`validTo` windows on at the reference
 *     (`compliance/profiles/data/fr.ts`, `avant-refonte-documents`) before this branch's demolition —
 *     this module continues that precedent rather than inventing a new one that happens to be
 *     simpler to write.
 *  2. Practically, `invoice-actions.ts`'s own "send" is ASYNCHRONOUS
 *     (`actions/async-send.ts`): a worker can replay `deliver()` seconds — or, after a BullMQ retry,
 *     much LATER — than the original click that moved the record to "sending". If the mandate were
 *     judged by `new Date()` at delivery time, the exact same invoice could be judged "free" at
 *     enqueue (the preflight) and "mandated" at delivery a few seconds later purely because a clock
 *     tick crossed midnight on `mandatedFrom` — the document's own legal status would then depend on
 *     how long it happened to sit in a queue, which has nothing to do with the document itself. Keying
 *     on `issueDate` instead makes the decision a pure function of the INVOICE — stable across
 *     retries, across workers, and across however long a job waits — exactly the same "the retry IS
 *     the action itself, not a separate mechanism" property `async-send.ts`'s own header already
 *     holds for numbering.
 *
 * `issueDate` is carried as a plain ISO string throughout this codebase — sometimes bare
 * ("2026-09-01", what a hand-typed form or a Cypress fixture sends), sometimes a full timestamp
 * ("2026-09-01T00:00:00.000Z", what `new Date().toISOString()` produces, e.g.
 * `actions/convert-to-invoice.ts`). `isOnOrAfter` below compares both the same way (as calendar
 * instants), so it makes no difference which shape a given caller happens to have on hand.
 */
import { LegalProvenance } from '../../country-policy/schema';
import { ChannelPolicyCatalog, defaultChannelPolicyCatalog } from './registry';
import { ChannelPolicyFact, ChannelPolicyScope } from './schema';

export interface ActiveChannelMandate {
  providerId: string;
  mandatedFrom: string;
  provenance: LegalProvenance;
  /** Passed through verbatim from `ChannelPolicyFact.scope` - WHICH invoices this mandate binds.
   *  Carried on the result (rather than consumed and discarded) so a caller holding an
   *  `ActiveChannelMandate` can still see that the mandate it is looking at is a CONDITIONAL one:
   *  `activeChannelMandateFor` below answers the country-level question and applies no narrowing at
   *  all, so its result would otherwise look identical to an unconditional mandate. */
  scope?: ChannelPolicyScope;
  /** Passed through verbatim from `ChannelPolicyFact.equivalentProviderIds` (schema.ts's own header) —
   *  other transport ids that ALSO satisfy this mandate. Absent for every mandate that has exactly one
   *  satisfying transport (still the overwhelming majority, e.g. FR/pdp). This file only carries the
   *  fact through; `invoice-actions.ts`'s own preflight is what actually treats a listed id as
   *  equally compliant with `providerId` itself. */
  equivalentProviderIds?: string[];
}

/** The literal "YYYY-MM-DD" prefix of an ISO date/datetime string — see `isOnOrAfter` below for why
 *  this is read off the string as WRITTEN rather than through `Date`'s own timezone conversion. */
function calendarDatePart(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}/.exec(value.trim())?.[0];
}

/**
 * True when `issueDate` is on or after `mandatedFrom`, compared as CALENDAR DATES — the literal
 * "YYYY-MM-DD" each ISO string starts with — never as epoch instants. An `issueDate` carrying an
 * explicit non-UTC offset (`"2026-09-01T00:00:00+02:00"` — never a shape this codebase's own date
 * field produces, but reachable via a third-party import or API) converts, through `getTime()`, to an
 * EARLIER UTC instant (2026-08-31T22:00:00Z) than `mandatedFrom`'s own bare-date UTC midnight
 * (2026-09-01T00:00:00Z) — so an epoch comparison would judge a mandate that legally already applies
 * on this invoice's own issue day as not yet in force, missing it by exactly one day. The question
 * this file exists to answer ("was this OPERATION carried out on or after the mandate's date") is
 * about a calendar day, not a millisecond: the string already states which day it is, so this reads
 * that day literally rather than translating it through any timezone at all. `getTime()` is used only
 * to reject a genuinely unparseable value (unchanged from before) — never to decide the >= itself.
 *
 * An `issueDate` that is missing or fails to parse returns `false` — NEVER `true`: this function only
 * ever concludes a mandate is ALREADY active from a genuine, parseable date that has actually reached
 * it. It never treats "I don't know the invoice's own issue date" as license to assume the mandate
 * must already apply — inventing a date to enforce against would be exactly the kind of guess this
 * codebase's own ⚖ discipline forbids, and an invoice descriptor's `issueDate` is a REQUIRED field
 * validated at "save-draft" in the first place (`descriptors/invoice.descriptor.ts`), so this branch
 * is expected to be unreachable in practice, not a normal case this function is designed to paper over.
 */
function isOnOrAfter(issueDate: string | undefined, mandatedFrom: string): boolean {
  if (!issueDate) return false;
  if (Number.isNaN(new Date(issueDate).getTime()) || Number.isNaN(new Date(mandatedFrom).getTime())) {
    return false;
  }
  const issuedDay = calendarDatePart(issueDate);
  const startsDay = calendarDatePart(mandatedFrom);
  if (!issuedDay || !startsDay) return false;
  return issuedDay >= startsDay;
}

/**
 * The (at most one) channel a country's policy MANDATES for an invoice issued on `issueDate` —
 * undefined when the country has no file, no `mandated` fact at all, or every `mandated` fact's own
 * `mandatedFrom` is still in the future relative to `issueDate` (i.e. today it is merely `suggested`
 * in effect, even though the file already declares it `mandated` from a known future date — see
 * schema.ts's own header on why that is the intended, ordinary state, not an edge case).
 *
 * Never returns more than one fact even if a country's file somehow declared several `mandated`
 * entries (the FIRST active one in file order wins — the same "in file order" convention
 * `registry.ts`'s own `factsFor` already documents); no shipped file does this today.
 *
 * ## THIS FUNCTION APPLIES NO `scope` NARROWING, AND MUST NEVER BE USED TO GATE A SEND
 *
 * It answers the COUNTRY-LEVEL question - "does this country declare a mandated channel, and has
 * that mandate come into force for an invoice issued on this date" - which is exactly what
 * `company/channels/channels.service.ts` (the settings screen's "your country requires this channel"
 * prompt) needs and all it can answer: that screen has no invoice and no buyer, so there is no
 * operation to narrow against. A mandate narrowed by `ChannelPolicyFact.scope` (e.g.
 * `parties: 'domestic'`) is still genuinely declared and in force for the country, and the settings
 * screen is still right to tell the company to connect the channel.
 *
 * Deciding whether a mandate binds ONE PARTICULAR INVOICE is `activeChannelMandateForOperation`
 * below, and that is the only one `actions/invoice-actions.ts`'s send preflight calls.
 *
 * `catalog` defaults to the shipped singleton (`defaultChannelPolicyCatalog`) — every real caller
 * (`invoice-actions.ts`, `channels.service.ts`) relies on that default and never passes one. The
 * parameter exists purely for `mandate.spec.ts` to exercise the date arithmetic against a FIXTURE
 * catalog without needing to touch the real, shipped `fr.json` — the same constructor-injection
 * testability `ChannelPolicyCatalog` itself, and `country-policy/seed.ts`'s own `catalog` parameter,
 * already establish for this exact reason.
 */
export function activeChannelMandateFor(
  countryCode: string,
  issueDate: string | undefined,
  catalog: ChannelPolicyCatalog = defaultChannelPolicyCatalog,
): ActiveChannelMandate | undefined {
  for (const fact of catalog.factsFor(countryCode)) {
    if (fact.requirement !== 'mandated') continue;
    // schema.ts's `assertValidChannelPolicyFact` — run for every shipped file at load time, see
    // data/all.ts — guarantees a 'mandated' fact always carries a non-empty `mandatedFrom` and
    // 'legal' provenance; a fact that failed either check never made it into the catalog at all, so
    // the non-null assertions below are backed by that load-time gate, not by hope.
    if (isOnOrAfter(issueDate, fact.mandatedFrom!)) {
      return toActiveMandate(fact);
    }
  }
  return undefined;
}

function toActiveMandate(fact: ChannelPolicyFact): ActiveChannelMandate {
  return {
    providerId: fact.providerId,
    mandatedFrom: fact.mandatedFrom!,
    provenance: fact.provenance as LegalProvenance,
    equivalentProviderIds: fact.equivalentProviderIds,
    scope: fact.scope,
  };
}

/** The one operation a channel mandate is evaluated against: who issues, who receives, and when.
 *  `buyerCountryCode` is `undefined` when the invoice's own client cannot be resolved to an ISO code
 *  - see `activeChannelMandateForOperation` for why that case is deliberately treated as domestic. */
export interface ChannelMandateOperation {
  /** The ISSUING company's own country, already resolved to an ISO 3166-1 alpha-2 code. */
  sellerCountryCode: string;
  /** The country the BUYER is established in, already resolved to an ISO 3166-1 alpha-2 code, or
   *  `undefined` when it could not be resolved at all. */
  buyerCountryCode?: string;
  /** The INVOICE's own `issueDate`, never the server's clock - see this file's header. */
  issueDate?: string;
}

function isDomestic(operation: ChannelMandateOperation): boolean {
  const buyer = (operation.buyerCountryCode ?? '').trim().toUpperCase();
  // An UNRESOLVED buyer country is treated as domestic, i.e. the mandate still binds. This is the
  // fail-CLOSED direction on purpose: the alternative - "we could not tell, so assume the buyer is
  // abroad and let the invoice leave through any channel" - would let an unknown client silently
  // defeat a legal obligation, which is the one outcome that cannot be walked back once the invoice
  // is out. It also costs nothing in practice: this same "send" preflight already hard-blocks an
  // invoice whose buyer country cannot be resolved, one check further down
  // (`tax/resolve-invoice-tax.ts`'s own `UnresolvedBuyerCountryError`, a USER DECISION of
  // 2026-09-01), so an invoice reaching delivery with no buyer country does not exist today.
  if (!buyer) return true;
  return buyer === operation.sellerCountryCode.trim().toUpperCase();
}

/**
 * The (at most one) channel mandate that binds ONE PARTICULAR INVOICE - the seller's country, the
 * invoice's own issue date, AND the fact's own `ChannelPolicyFact.scope`. This is what
 * `actions/invoice-actions.ts`'s "send" preflight calls; `activeChannelMandateFor` above answers a
 * strictly wider, country-level question and must not be used to gate a send.
 *
 * ## Why a national channel mandate is not a property of the seller alone
 *
 * A national e-invoicing mandate governs a DOMESTIC operation. Both mandates shipped today say so in
 * the statutory text this catalog already quotes: France's plateforme agréée obligation is framed
 * between taxable persons established in France (CGI art. 289 bis), and Italy's SdI obligation
 * applies to supplies "tra soggetti residenti o stabiliti nel territorio dello Stato" (D.Lgs.
 * 127/2015 art. 1 comma 3). A French seller invoicing a buyer established in Italy is outside the
 * French invoicing mandate by construction - and it is not caught by the Italian one either, which
 * binds only parties established in Italy and puts the reporting of that inbound transaction on the
 * ITALIAN buyer, not on the French supplier. Deciding a mandate from the seller's country and the
 * date alone therefore refused a lawful invoice, which is a product failure of the exact kind
 * `channel-policy/data/pl.json`'s own notes already argue against for Poland's KSeF timetable.
 *
 * ## What this function deliberately does NOT do
 *
 * It does not implement, discharge, or even represent the DECLARATION each side may still owe its
 * own administration once the invoicing mandate falls away (France: e-reporting, CGI art. 290;
 * Italy: the art. 1 comma 3-bis transmission of data on operations with non-established subjects).
 * Those are separate obligations with their own means and their own deadlines. `reporting/` is where
 * such an obligation would live in this codebase, and its own data files already state which of
 * France's facts are unexecutable placeholders there. Nothing here should be read as "the product
 * handles the reporting side" - it does not.
 */
export function activeChannelMandateForOperation(
  operation: ChannelMandateOperation,
  catalog: ChannelPolicyCatalog = defaultChannelPolicyCatalog,
): ActiveChannelMandate | undefined {
  for (const fact of catalog.factsFor(operation.sellerCountryCode)) {
    if (fact.requirement !== 'mandated') continue;
    if (!isOnOrAfter(operation.issueDate, fact.mandatedFrom!)) continue;
    // A fact with no `scope` binds unconditionally - the behaviour every fact had before `scope` was
    // read at all (schema.ts's own header on that field).
    if (fact.scope?.parties === 'domestic' && !isDomestic(operation)) continue;
    return toActiveMandate(fact);
  }
  return undefined;
}
