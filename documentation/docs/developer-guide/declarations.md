---
sidebar_position: 6.8
---

# Declarations

A declaration is what a seller owes a tax authority about its own operations, independently of how
an invoice reached its buyer: Portugal's invoice communication to the AT, France's e-reporting of
B2C and payment data, an EC sales list, a VAT return. Delivery to the buyer is covered by
[Operators and channels](./operators-and-channels.md); this page covers the declaration side.

The model is being rebuilt in five steps (issues #766 to #770). This page describes the v2
**obligation format** (#767). It lives beside the legacy `reporting` facts and nothing reads it yet:
every country file still declares legacy facts, and `upgradeLegacyFacts` turns them into v2.

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

`reporting/obligation-v2.ts` validates every obligation at load. Each rule refuses with a named
error whose message names the file and the obligation:

- `id` present and unique in its file; `authority.countryCode` an uppercase ISO 3166-1 alpha-2 code;
- `kind`, `trigger`, every document type, transaction category, discharger, unit and period from its
  closed list;
- no empty list anywhere (document types, transactions, profile conditions, windows, channels), and
  no document type or channel listed twice;
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
| a `payments` scope, or anything else | `trigger: "payment"`, or `trigger: "sent"`, as the legacy runner already applies them |
| `appliesTo`, `scope` | `scope.documentTypes`, `scope.transactions` |
| `provenance` | `legalBasis.provenance` |
| `applicableFrom`, `applicability` | `applicability` windows |
| `dischargedBy`, `providerId` | one channel |
| `periodicity`, `notes` | `timingNote`, `notes` |

A legacy fact that mixes `payments` with other categories is refused: one obligation has one trigger,
and splitting it would invent ids the country file never declared. Two facts that would get the same
id are refused too.
