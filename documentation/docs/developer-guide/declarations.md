---
sidebar_position: 6.8
---

# Declarations

A declaration is what a seller owes a tax authority about its own operations, independently of how
an invoice reached its buyer: Portugal's invoice communication to the AT, France's e-reporting of
B2C and payment data, an EC sales list, a VAT return. Delivery to the buyer is covered by
[Operators and channels](./operators-and-channels.md); this page covers the declaration side.

The model is being rebuilt in five steps (issues #766 to #770). This page describes the v2
**obligation format** (#767), the catalog API that reads it, the contracts a declaration adapter
implements, and the document events that fire it (#768). The shipped country files
are written in v2, and every consumer reads the v2 catalog (`reporting/obligation-catalog.ts`). A
section still written in legacy `reporting` facts is accepted and upgraded on load by
`upgradeLegacyFacts`, until #769 removes that shape.

## When a declaration is enqueued

One hook, `reporting/on-document-event.ts`, is called by every document event that can make a
declaration due. It never throws: the event has already happened.

| Event | Called from | Fires obligations whose trigger is |
| --- | --- | --- |
| `issued` | the invoice "validate" action, once the invoice is numbered and locked without being sent | `issued` |
| `sent` | `actions/async-send.ts`, after delivery and the "sent" write | `issued`, `sent` |
| `payment` | the invoice "record-payment" action, after the payment row is written | `payment` |

A `period-end` obligation is never fired by a document event (#770).

For each event the hook takes the seller country's provider-discharged obligations with a matching
trigger, classifies each against the operation (`classify.ts`), and enqueues the first one that
covers it. When none covers it but one could not be decided (no client type, no company size
category), it journals `report:blocked` with the reason instead of declaring on a guess.

A `sent` event also fires `issued` obligations, because a document sent straight from draft is
issued by that send. A document validated first and sent later therefore fires the same obligation
twice. The runner (`reporting-runner.ts`) declares it once: before declaring, it looks for an
authority result already journaled for that document and provider, and skips the job if one exists.
That check does not apply to a provider that also has a `payment` obligation on the same document
type, because its invoice and payment results share status codes; such a provider's document
obligations are triggered by `sent` only.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Obligation | One legal duty to tell an authority something. Identified by its `id`, unique within its country file. |
| Kind | `data` (per-document data, such as Portugal's invoice communication), `summary` (a recapitulative statement, such as an EC sales list) or `return` (a tax return). |
| Trigger | What makes it due: a document event (`issued`, `sent`, `payment`) or the end of a period (`period-end`). |
| Scope | The document types it covers and, optionally, the transaction slices (B2B domestic, B2C, international, payments) with their buyer conditions. |
| Seller conditions | Answers from the company profile the seller must match for the obligation to bind at all. |
| Applicability window | A dated window (`from` inclusive, `until` exclusive), optionally conditioned on the company profile. France's e-reporting starts on different dates for different company sizes. |
| Legal basis | Where the duty comes from, with its own provenance and the validity dates of the cited text. |
| Timing | Either a deadline in days after the trigger, or the period a declaration covers (`month`, `quarter`, `year`). |
| Channel | One way to discharge the obligation. An obligation may list several equivalent channels. |

## Channels

Each channel says who discharges it and what one discharge covers.

| `dischargedBy` | Meaning |
| --- | --- |
| `transport` | The delivery channel carries the data to the authority as a legal side effect of sending the document (France's accredited platform for a B2B-domestic invoice, CGI art. 289 E). Nothing is enqueued for it. |
| `provider` | A declaration provider the app calls itself (`reporting/declaration-provider.ts`), such as Portugal's `pt-at`. |
| `export` | The app produces a file that the user files with the authority. |
| `manual` | The user files it themselves; the app only records that it is owed. |

`unit` is `document` (one discharge per document) or `period` (one discharge covers a whole period).

## Format

```json
{
  "id": "pt-at:invoice",
  "authority": { "countryCode": "PT" },
  "kind": "data",
  "trigger": "sent",
  "scope": { "documentTypes": ["invoice"] },
  "legalBasis": {
    "provenance": { "kind": "legal", "sourceText": "...", "sourceCheckedAt": "2026-11-13" }
  },
  "channels": [{ "dischargedBy": "provider", "id": "pt-at", "unit": "document" }]
}
```

Optional fields: `authority.name`, `scope.transactions`, `sellerConditions`, `applicability`,
`legalBasis.validFrom` and `validUntil`, `timing`, `timingNote` (free text, never parsed) and `notes`.
A channel may carry `platformId` when two channels are the same legal entity seen from two registries:
France's accredited platform (PA) is both the `pdp` transport, for a B2B-domestic invoice, and the
`fr-pa` declaration provider, for B2C, international and payment data. Both channels carry
`"platformId": "fr-pa"`, so the settings card shows one platform with all its moments. It is display
data only: nothing at send time reads it.

`reporting/obligation-v2.ts` validates every obligation at load. Each rule refuses with a named
error whose message names the file and the obligation:

- `id` present and unique in its file; `authority.countryCode` an uppercase ISO 3166-1 alpha-2 code;
- `kind`, `trigger`, every document type, transaction category, discharger, unit and period from its
  closed list;
- no empty list anywhere (document types, transactions, profile conditions, windows, channels), and
  no document type or channel listed twice; a `platformId`, when present, is not empty;
- every date a real `YYYY-MM-DD` date, and every end after its start;
- a provenance on the legal basis and on each window (`legal` with its source text and check date,
  or `unverified` with a resolution note);
- `timing` holds exactly one of `deadline` or `period`, and a deadline is a whole number of days;
- a `period` channel needs `timing.period`, and a `period-end` trigger accepts only `period` channels.

## Legacy facts

`upgradeLegacyFacts` turns one legacy `reporting` section into v2, one obligation per fact:

| Legacy | v2 |
| --- | --- |
| `providerId`, `appliesTo`, scope categories | `id`, e.g. `pt-at:invoice`, `fr-pa:invoice:b2c` |
| the file's `countryCode` | `authority.countryCode` |
| (every legacy fact is per-document data) | `kind: "data"`, `unit: "document"` |
| a `payments` scope, or anything else | `trigger: "payment"`, or `trigger: "sent"`, as the legacy runner applied them |
| `appliesTo`, `scope` | `scope.documentTypes`, `scope.transactions` |
| `provenance` | `legalBasis.provenance` |
| `applicableFrom`, `applicability` | `applicability` windows |
| `dischargedBy`, `providerId` | one channel |
| `periodicity`, `notes` | `timingNote`, `notes` |

A legacy fact that mixes `payments` with other categories is refused: one obligation has one trigger,
and splitting it would invent ids the country file never declared. Two facts that would get the same
id are refused too.

## Catalog API

`reporting/obligation-catalog.ts` exposes `ReportingObligationCatalogV2`, built once from the composed
country catalog (`defaultReportingObligationCatalogV2`). Every file is upgraded or validated at that
moment, so a malformed file fails at boot with a named error, never at the first send. A country is
declared at most once. Lookups never fall back: a country with no file, or no country code, has no
obligation.

| Query | Answers | Read by |
| --- | --- | --- |
| `countries()` | The countries that have a reporting section, in load order | `list-declarations.ts` |
| `obligationsFor(country)` | Every obligation of a country, in file order | `list-declarations.ts`, `profile-sync.ts`, `channels.service.ts` (settings Declarations card) |
| `providerObligationsFor(country, type)` | Obligations covering a document type with a `provider` channel, scoped or not | `on-document-event.ts` |
| `providerChannelId(obligation)` | The id of an obligation's `provider` channel, the id a report job is enqueued under | `on-document-event.ts` |
| `obligation(country, id)` | One obligation by its id | specs only for now |
| `obligationsForProvider(provider, type)` | Every obligation, across countries, a provider discharges for a type | `reporting-runner.ts` |
| `unscopedProviderObligationFor(country, type)` | The first provider obligation with no transaction scope | specs only for now |

`obligation-catalog.spec.ts` pins each query against the legacy facts as they last shipped
(`__fixtures__/legacy-reporting-files.json`): Portugal's job id is unchanged, and the Declarations rows
are the same as with the legacy facts.

## Adapter contracts

A `provider` channel names a `DeclarationProvider` registered in `DeclarationProviderRegistry`
(`reporting/declaration-provider.ts`, wired in `reporting/providers/build-registry.ts`). One provider
per national obligation (`pt-at`, `fr-pa`), never one per vendor:

```ts
interface DeclarationProvider {
  readonly providerId: string;
  declare(companyId: string, invoice: DeclaredInvoice): Promise<DeclarationResult>;
  declarePayment?(companyId: string, payment: DeclaredPayment): Promise<DeclarationResult>;
  syncCompanyProfile?(companyId: string): Promise<void>;
}
```

- `DeclaredInvoice` and `DeclaredPayment` are built once (`build-declared-invoice.ts`,
  `report-payment.ts`) from the computed totals. A provider never recomputes a figure.
- `declarePayment` is optional. When a country asks for payment data and the provider cannot declare
  it, the runner journals `report:blocked`; it never treats the payment as declared.
- `ChannelNotConnectedError` means no usable credentials: journaled `report:blocked`, never retried.
  Any other error propagates, so the queue retries it before `report:failed` is journaled.
- The registry wraps every method with the demo-mode guard, optional ones included.

A declaration returns a `DeclarationResult`: the authority event, plus a required, non-empty
`authorityId` and its `referenceKind`. The runner refuses an empty `authorityId` or an unknown kind
before journaling anything (`reporting-runner.ts`).

| `referenceKind` | Who minted `authorityId` |
| --- | --- |
| `authority` (default when absent) | The tax administration itself (NAV, myDATA). |
| `platform` | An intermediary's own record id; the platform transmits to the administration later. |
| `synthesized` | This code, because the authority returns none. Portugal's AT reports `synthesized`: never show it as the administration's confirmation number. |

When several operators can carry the same legal channel, the provider resolves the company's connected
operator and delegates to an `EReportingAdapter` (`reporting/ereporting-adapter.ts`), one per platform
API, keyed by transport id. See
[Operators and channels](./operators-and-channels.md#declarative-reporting-ereporting) for that
resolution and the SuperPDP adapter.

## Buyer establishment

`BuyerEstablishment` (`country-identifiers/schema.ts`) is where the buyer is established, seen from the
seller: `DOMESTIC`, `OTHER_UNION_MEMBER` (another member of the seller's tax union, such as the EU) or
`NON_UNION` (a known foreign buyer outside it, such as an export buyer). Country identifier rules use it
to say which identifiers a document must print. Before `NON_UNION` existed, an export buyer had no
establishment at all and no rule could name it. A buyer with no country still has none, and a rule
that names an establishment never matches it.

The reporting scope keeps its own, coarser `buyerEstablishment` (`domestic` or `foreign`,
`reporting/schema.ts`): a declaration slice only needs to know whether the buyer is in the seller's
country.
