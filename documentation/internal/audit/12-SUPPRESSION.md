# 12 — Deletion Inventory

**This document is an inventory. No deletion has been made.** It states what leaves, what stays, and
what blocks each deletion. The figures are measured, not copied: every line carries the command that
produced it.

Sheets 00 through 11 live on `audit/compliance-truth`. This one is on `feat/compliance-engine-v2`,
because it precedes a code change on this branch.

Date: 2026-08-28. Tree: `feat/compliance-engine-v2` at `9f74e7e2`.

---

## 1. The measured state

### 1.1 The 62 transmission providers

The taxonomy already exists, in `providers/transmission/provider-maturity.spec.ts`, and it is guarded
by a test. I reuse it as-is rather than inventing a second one.

| Tier | Count | What it is |
| --- | --- | --- |
| `PROVEN` | **4** | `ksef`, `pdp`, `peppol`, `email` — a real round trip was observed |
| `IMPLEMENTED` | **17** | named, real protocol client, no credentials |
| Generic `STUB` | **37** | `buildGenericPortalProvider()`, no `httpPort` injected in production |
| Other `STUB` | **4** | `pac`, `ose`, `print`, `zatca` |

`4 + 17 + 37 + 4 = 62`. **58 transmit nothing.**

```
$ ls src/compliance/providers/transmission/portals/*.ts | wc -l      # 37
$ cat src/compliance/providers/transmission/portals/*.ts | wc -l     # 1475 lines
$ ls src/compliance/providers/transmission/*-client.ts | wc -l       # 18 files
$ cat src/compliance/providers/transmission/*-client.ts | wc -l      # 3698 lines
```

### 1.2 The 42 declared-and-empty national formats

```
$ ls src/compliance/providers/format/national/*.ts | wc -l           # 42
$ cat src/compliance/providers/format/national/*.ts | wc -l          # 589 lines
```

589 lines for 42 files: **14 lines each**. One full file:

```ts
export const AR_FE_FORMAT: NationalFormatSpec = {
  id: 'ar-fe',
  syntax: 'AR_FE',
  label: 'Argentina Factura Electrónica',
  buildHint: 'build ARCA/AFIP WSFE comprobante + request CAE; embed CAE + vencimiento',
};
```

None has a `build`. These are not partial implementations: they are **42 declarations of intent**
that the engine selects as though they were formats.

### 1.3 What must NOT be confused with them

`src/modules/invoice-rendering/national/` holds **14 files, 3846 lines**, and those produce real
bytes: `fattura-pa`, `cfdi`, `facturae`, `ksa-ubl`, `fa-vat`… Same word, "national", two directories,
two opposite natures. The confusion would be costly in both directions.

### 1.4 Published vs. implemented

```
$ ls src/compliance/profiles/data/*.ts | wc -l                       # 108 profiles
$ find documentation -name "*.md" -path "*compliance*" | wc -l       # 118 pages
```

F-004 put this at 106 public pages and 56 countries with zero output in force. The 106/118 gap comes
from sheets added since; the order of magnitude is the same.

---

## 2. What leaves

| Batch | Files | Lines | Why |
| --- | --- | --- | --- |
| Generic portals | 37 | 1,475 | `buildGenericPortalProvider()` with no `httpPort` in production: an object that accepts a document and sends it nowhere |
| Empty national formats | 42 | 589 | No `build`. The engine picks them by syntax and gets zero bytes — this is F-001's own mechanism |
| Dedicated portal clients | 18 | 3,698 | To be decided batch by batch; see §4. These contain real protocol work, this is not the same kind of deletion |

**Total of the certain scope: 79 files, 2,064 lines.** The batch of 18 clients (3,698 lines) is a
judgment call, not a settled item.

## 3. What stays

- **`profiles/data/*.ts` — the 108.** These are sourced rules: rate, regime, retention period,
  numbering, required identifiers. They hold value without transport, and this is the only place in
  the repository where the legal work is capitalized. The Ghanaian profile is eleven lines long and
  only one of them is fake: the `providerId`.
- **The engine, `resolve()`, profile composition, the runtime.** The audit established these as
  sound and under-extended. Out of scope, no exception.
- **The 14 builders in `modules/invoice-rendering/national/`.** They render real documents.
- **`email`, `print`, `peppol`, `pdp`, `ksef`.**

---

## 4. What blocks each deletion

### B1 — A profile cannot express "no transport" *(blocking, structural)*

`profiles/data-integrity.spec.ts`:

```ts
expect(p.transmission.length).toBeGreaterThan(0);
```

… and "every DocumentSyntax and channel providerId it references must resolve to a REAL provider".

Deleting the 37 portals therefore breaks the 37 profiles that name them. Repointing them to `EMAIL`
via the `noMandate` archetype would compile — and **lie**: a country under a clearance mandate
declaring the "email" channel claims a compliance that does not exist. The schema today has no state
for "a mandate exists, we have no output for it".

**This is the real blocker, and it is not a code-volume problem: it is a hole in the schema.** As
long as a profile cannot say "not served", the 58 stubs are the only way the repository knows how to
write that — badly, but no more dishonestly than an invented `EMAIL`.

The order therefore has to be: add the state, migrate the profiles, then delete.

### B2 — The 118 Docusaurus pages *(blocking, F-004)*

The site publishes a faceted browser with a "{count} countries" badge. Removing the code without
handling the pages produces exactly the inversion F-004 denounces: a site promising a hundred
countries above a repository that implements five. The fate of the pages is part of the deletion,
not its aftermath.

Three options, to be decided:

| | Effect | Cost |
| --- | --- | --- |
| Keep, with a per-country status banner | The documentation work survives, the promise is bounded | A status field to derive from the profile |
| Cut down to served countries | No ambiguity | Loss of 100+ research sheets |
| Move off the public site | Keeps everything, promises nothing | A move, a redirect |

`profiles/coverage.spec.ts` reads `documentation/compliance/*.md` and fails if a documented country
has no profile. As long as the profiles remain, this test does not block — but if the pages leave, it
loses its object and becomes a test that tests nothing.

### B3 — F-001 and F-004 must not disappear with the code

F-001 (a zero-byte document travels through the pipeline and is archived) has as its precise
mechanism the 42 empty formats. Deleting them **resolves** the finding — but if the deletion leaves
no trace, the next generation of stubs will recreate it. At the moment of deletion, there must be:

- a test that fails if a registered `FormatProvider` renders zero bytes while a renderer was wired in
  (the distinction established in P1-T04; the guard exists, it has to survive the cleanup);
- the explicit closing of F-001 and F-004 in `02-FINDINGS.md`, with the commit that closes them.

### B4 — Verifying derivation from the rate *(lifted)*

The scope rule said: nothing gets deleted before verifying, across the 58, that deriving a VAT
category from a rate does not exist elsewhere. **This is done** (§1 of this round's report). The
result, and it changes the conclusion:

| Site | Nature |
| --- | --- |
| `invoice-rendering.service.ts:358` | fixed — used to read the rate, now reads the plan |
| `tax-engine.ts:177` | the engine, `taxCategoryHint ?? (rate === 0 ? 'Z' : 'S')` |
| `tax-engine.ts:250` | the engine, `rate > 0 ? 'S' : 'Z'` on a US sales-tax line |
| `europe-builders.ts:40` | Greek myDATA, `vatRate > 0 ? '1' : '7'` |
| `europe-builders.ts:96` | `AAA` / `AAM` |
| `cfdi.ts:30` | Mexican traslado emitted only if rate > 0 |
| `fattura-pa.ts:50` | Italian Natura computed only if rate = 0 |
| `ksa-ubl.ts:207` | `'S'` / `'E'` |
| `latam-builders.ts:121` | Costa Rican `CodigoTarifa` derived from the rate's value |

**Ten occurrences, not three.** And the notable fact for this inventory: **six of them are in the 14
builders that STAY**, not in the 79 that leave. The deletion does not remove them. The two in the
engine are of a different nature — there, the engine is the authority making the decision, not a
copy guessing at it — but `0 ⇒ Z` ignores E and O there too, and deserves to be revisited on its own.

### B5 — The 18 dedicated clients are a judgment call, not a settled item

They contain real protocol work (SOAP SdI, ChorusPro, ANAF, SEFAZ…), 3,698 lines, and their only
fault is the lack of credentials. Deleting them throws away exact work; keeping them maintains
17 paths that nothing walks. **To decide country by country according to the target markets** —
France, Poland, Italy are the declared markets, so `sdi` and `choruspro` do not fall under the same
judgment as `uy-dgi`.

---

## 5. The order the blockers impose

1. Add to the schema the "mandate known, no output" state (B1).
2. Decide the fate of the 118 pages (B2).
3. Migrate the 37 + 42 profiles to the new state.
4. Delete the 79 files, closing F-001 and F-004 with the commit (B3).
5. Decide the 18 dedicated clients separately (B5).
6. Revisit separately the 6 surviving rate-derivations (B4).

None of these steps touch the engine, `resolve()`, profile composition, or the runtime.
