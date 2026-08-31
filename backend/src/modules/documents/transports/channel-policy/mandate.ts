/**
 * Root TODO item 11, "canal imposé par pays" — evaluates whether a country's channel-policy MANDATE
 * (schema.ts's `ChannelPolicyFact.requirement === 'mandated'`) has come into force for one particular
 * invoice. Kept in its own small file (not folded into `registry.ts`'s plain lookup, nor into
 * `invoice-actions.ts` itself) because the DATE COMPARISON below is the one genuinely new piece of
 * logic this item adds, and it deserves its own focused tests (`mandate.spec.ts`) independent of the
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
 *     keyed its own temporal `validFrom`/`validTo` windows on at the repère
 *     (`compliance/profiles/data/fr.ts`, `avant-refonte-documents`) before this branch's demolition —
 *     this module continues that precedent rather than inventing a new one that happens to be
 *     simpler to write.
 *  2. Practically, `invoice-actions.ts`'s own "send" is ASYNCHRONOUS (TODO.md item 22,
 *     `actions/async-send.ts`): a worker can replay `deliver()` seconds — or, after a BullMQ retry,
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

export interface ActiveChannelMandate {
  providerId: string;
  mandatedFrom: string;
  provenance: LegalProvenance;
}

/**
 * True when `issueDate` is on or after `mandatedFrom`. An `issueDate` that is missing or fails to
 * parse returns `false` — NEVER `true`: this function only ever concludes a mandate is ALREADY active
 * from a genuine, parseable date that has actually reached it. It never treats "I don't know the
 * invoice's own issue date" as license to assume the mandate must already apply — inventing a date to
 * enforce against would be exactly the kind of guess this codebase's own ⚖ discipline forbids, and an
 * invoice descriptor's `issueDate` is a REQUIRED field validated at "save-draft" in the first place
 * (`descriptors/invoice.descriptor.ts`), so this branch is expected to be unreachable in practice, not
 * a normal case this function is designed to paper over.
 */
function isOnOrAfter(issueDate: string | undefined, mandatedFrom: string): boolean {
  if (!issueDate) return false;
  const issued = new Date(issueDate).getTime();
  const startsAt = new Date(mandatedFrom).getTime();
  if (Number.isNaN(issued) || Number.isNaN(startsAt)) return false;
  return issued >= startsAt;
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
      return {
        providerId: fact.providerId,
        mandatedFrom: fact.mandatedFrom!,
        provenance: fact.provenance as LegalProvenance,
      };
    }
  }
  return undefined;
}
