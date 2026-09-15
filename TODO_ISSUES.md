# TODO_ISSUES — my technical logbook

> **This file is not for the product owner.** What falls to the owner is in
> `TODO_MANDANT.md`, deliberately kept short. Here I log what I couldn't do and why —
> every entry says what's blocking it and what would unblock it, never just a bare "failed".
>
> A resolved entry is **deleted**, not struck through: the commit that closes it documents it
> better than its carcass would. This file must contain only what's open. (Purge of 2026-09-14: the
> file had drifted from its own rule — dozens of resolved entries, some struck through for weeks,
> had piled up. Everything that was closed was removed; see `git log` for their trace.)

## Chorus Pro — two defects found while proving the channel live on 2026-09-14, not fixed

The French B2G was proven live that day, all the way to the terminal state `IN_INTEGRE`
(`CPP0011117000000000425903`, see `documentation/docs/developer-guide/credentials-guide.md` §3). The
last commit of the session (`2c457a73`) documented two real defects found along the way, both
**deliberately left unfixed** in that commit (which touches only comments). **Another agent is
working on `choruspro-client.ts` and `chorus-pro-status-poller.ts` at the time this is written** —
what follows describes the state at `2c457a73` (HEAD); re-check before resuming this work, these
lines may already be closed.

1. **`mapChorusProStatus` does not recognize any of the values actually returned by Chorus Pro.**
   It only knows the bare vocabulary inherited from the reference client — `VALIDE`, `REJETE`,
   `DEPOSE`. But every value observed live carries an `IN_` prefix: `IN_INTEGRE`, `IN_REJETE`,
   `IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP`. No branch recognizes them, everything falls
   back to `PENDING`: the conformity poller would therefore detect NEITHER a real rejection NOR a
   real integration as a terminal state, on the very channel we just proved.

2. **The `invoice-b2g-chorus-pro-send.spec.ts` test (phase 2, the worker replay) is broken on
   HEAD.** A real regression introduced by `7de5a90c`, which added a hard refusal
   (`BadRequestException`) when the company has no IBAN — correct in itself (BT-81 is mandatory at
   Chorus Pro), but this spec's `company.findUnique` mock never carried an `iban`. Confirmed by
   direct reading of the file (no occurrence of `iban`, last touched by `2c457a73` in comments
   only) and by the CI run of the commit that broke it (run `34893034327`, job `backend-tests`:
   "Cannot deposit to Chorus Pro: this company has no IBAN on file" at line 219 of the spec).
   `ecce4d35` and `2c457a73`, the two following commits, don't touch this file. The branch's two
   most recent commits (`ecce4d35`, `2c457a73`) have their own CI run still in progress at the time
   of this purge (`34895979653`, `34897087106`) — to be checked once they finish, but nothing in
   their diff fixes this mock.

Not established, found along the way in these same commits, lower stakes — to keep in mind
rather than address separately: the exact legal basis for Chorus Pro's refusal of cheque/cash/
Stripe as a payment method (a formal prohibition, or simply no observed usage, `ecce4d35`);
whether a post-2020 AIFE document added B1/S1/M1 as alternative billing frameworks to A1-A25
(`7de5a90c`, the annex consulted dates from 2020); the Portuguese NIF check-digit algorithm is not
sourced anywhere in this repo (`dcb63a17`, already documented as such in
`country-identifiers/data/pt.json` itself).

## CI status as of 2026-09-14 21:00 — not continuously green, to re-check before the PR

Measured with `gh run list`/`gh run view`, not assumed. The most recent **completed**
`cypress.yml` run (commit `7de5a90c`, run `34893034327`) is a **failure**: `backend-tests` breaks
on item 2 above (1 suite / 1 test out of 3362), and `cypress-run` breaks on a `14-articles.cy.ts`
flake (see below). The two following commits (`ecce4d35`, `2c457a73` = HEAD) have their own runs
still `in_progress` at the time of this purge. On the same day, several `cypress.yml` runs were
indeed green (e.g. commits `cab89185` 19:33, `67a94d58` 19:54) and `scenarios.yml` ("Business
Scenarios") was green multiple times (last seen: commit `b41e99a9`, 17:22). So: CI IS RUNNING
correctly on this branch (it wasn't running at all before `5089e60f`/`486aab6a` today — the six
Business Scenarios legs had not run a single time since 2026-08-29, `redis://localhost:6399`
against a Redis service listening on 6379), but it is **not green right now** because of item 2
above. Re-check `gh run list` before opening the PR to `main`.

- **`14-articles.cy.ts`: a Radix visibility flake, seen once under Firefox** (run
  `34893034327`, "prefills an invoice line when an article is picked from the catalog" —
  `AssertionError: … not visible because its ancestor has position: fixed`). Distinct from the
  already-known Electron crash already fixed by switching CI to `--browser firefox` (`cypress.yml`
  documents that choice in its own comment): this is a visibility flake, not a process crash, and
  it appears under the browser CI already uses. A single occurrence so far, not confirmed as
  permanent — to be watched rather than fixed blindly.

## What remains open, by stake

| Finding | What's blocking |
| --- | --- |
| **Receiving e-invoices has been mandatory in France since 2026-09-01 — and that date has passed.** The manual received-invoice upload screen does NOT, by itself, satisfy this obligation (it requires an accredited platform). | No accredited channel is wired up on the receiving side (inbound KSeF, inbound PDP/Peppol deposit) — this is the named remainder of the conformity poller, never built on the receiving side. |
| The **upgrade** of a legacy install is still not proven | The owner's go-ahead already exists (2026-09-13) — what's missing is no longer an agreement, it's someone actually replaying `sync-schema.ts` with `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` against a throwaway database. |
| The **Italian recipient code** has no screen | `country-identifiers/data/it.json` only declares VAT and LEGAL_ID for an ordinary Italian client (B2B); `IT_SDI`/`PEC` have no input field. A domestic Italian B2B invoice therefore goes out with `codiceDestinatario = 'XXXXXXX'`, the fallback the code itself labels a "least-wrong fallback". The backend mechanism exists, what's missing is the screen that feeds it — the same shape as the VAT identifier gap already fixed on this branch. |
| **Portuguese B2G** | The channel is delegated to a portaria (CCP art. 299.º-B n.º 5) never located in its raw text; one attempt returned a 200 that was not the document (an HTML page served instead). `transportId` therefore remains unwritten — without it, the `b2g-routing/data/pt.json` file can't be honest. |
| The **declarative** catalog (`reporting/`) only knows Portugal | The French obligation IS established (CGI art. 290 I) but goes through the PDP (art. 290 A/B) — a transport already implemented and proven live. The schema can only express `providerId`, never "discharged by an already-implemented transport". What would need to be determined before writing `fr.json`: what the PDP forwards automatically vs. what remains the product's responsibility (B2C, foreign clients). |
| Five **Italian reverse-charge categories expire on 2026-12-31** | `domestic-reverse-charge/` (32 sourced categories, DE/FR/IT/PT) has no temporal axis — an expired category is indistinguishable there from one still in force. Decision made on 2026-09-13 NOT to wire the tax engine onto this catalog (Invoicerr mainly targets tech companies) — except for a telecom operator client, an electronic-equipment reseller, or an energy supplier/allowance trader, the three profiles the decision doesn't cover (see the catalog's `DESIGN.md`). To be re-checked before January 1, 2027 no matter what. |
| The FA(3) KOR `pattern` (Polish post-clearance correction) is not reimplemented | The old engine had a full KOR mode; the current `invoice.descriptor.ts` descriptor has no correction link compatible with the shape it expected — a Polish corrective invoice goes out today as an ordinary FA(3) invoice, never as a KOR. |
| **French in the code** | A sweep last year measured 310 files with a French comment; untouched since, to be re-measured before closing it out. |
| Two dead frontend artifacts | `plugins/storage/providers/local/local-form.json` (`"type": "folder"`, never read, the `IPluginFormField.type` union doesn't even know `folder`) and the `/api/directories` route it alone made reachable (`components/folder-select.tsx`). No user-facing effect, but they deserve their own cleanup pass. |

## PT `pt-at` (AT declaration) — implemented to the documented contract, NOT proven live

Two named technical gaps, to be closed once real AT credentials exist (steps →
`TODO_MANDANT.md` §3):
1. **mTLS not wired up** — the AT requires a signed X.509 client certificate for the HTTPS
   connection itself; `pt-at-client.ts` uses plain `fetch()`. Wiring planned in the same
   `pfx`/`passphrase` shape as `transports/sdi/sdicoop-client.ts`, deliberately not done blind
   without a real PKCS#12 to test against.
2. **Nonce RSA padding ⚠ unverified** — the AT manual names "RSA" with no padding parameter;
   PKCS#1 v1.5 was chosen as the best reading (OAEP = Node's default, ruled out), to be confirmed
   on the first real round-trip (a wrong padding fails loudly: `CodigoResposta` 16/17).

## KSeF — the status poller is never proven live, and the PROD key is missing

Distinct from the KSeF SEND channel, already proven live (2026-06-28, see session memory). The
status POLLER (`pollers/ksef-status-poller.ts`) exists but `KSEF_AUTH_TOKEN` is absent from this
environment, so two points remain unverified: (a) the `{code, description, details}` →
terminal/rejected mapping is extrapolated from the convention used by `authenticate()`, never
confirmed for the `invoiceStatus` endpoint itself; (b) `send()` closes the session right after
sending — whether `invoiceStatus` still responds once the session is closed is unknown to date.
Separately: KSeF only has a vendored MF key for the TEST environment — no PROD key has ever
existed in this repo; `loadVendorizedKeys('prod')` therefore fails loudly by design rather than
falling back to the test key against a real production KSeF. Not done for lack of a real PROD
company to date.

## B2G: 13 EU member states covered by no rule, each with its reason read

`b2g-routing/data/` covers 15 countries in total (the full table lives in the catalogs
themselves). The 13 missing ones break down into two causes, both read and sourced, never
guessed: a national CIUS never vendored (AT ebInterface, DK OIOUBL, FI, HR, IE — three distinct
CIUS, NL NLCIUS — since shipped, PT CIUS-PT, RO RO_CIUS, SI e-SLOG, SK until 2027), or a closed
channel with no confirmed Peppol reachability (BG CAIS EPP, CZ NEN, HU NAV). The existing honest
refusal ("no B2G rule declared") remains the intended behavior as long as the corresponding CIUS
isn't vendored. Separately: for 21 of the countries already covered, the only source read is the
Commission's eInvoicing fact sheet (DG CNECT) — a report, not the national transposition text — to
be cross-checked country by country someday, the same provenance work as the French SIREN/SIRET.

## Seller×buyer composition in cross-border — only one layer read out of two

The 2026-08-29 research on cross-border attachment documents four distinct attachments;
`correction-routes/` and `cancel-policy.ts` only read the SELLER country (the "which document my
country imposes" layer), never the "taxable base" layer (attached to the TAXATION country,
potentially the buyer under reverse charge). `LIMITATION_TEXT` says so on every API response. The
composition of the two is not written — to be done if a cross-border correction must one day
distinguish "which document" from "how and until when the taxable base can be reduced".

## Webhook debt and diffuse technical debt

- **`WebhookEvent`: fewer than 15 values out of 94 have a real emitter**, the T2bis purge only
  covered its named scope (51 values). The rest (the Item family, Number-formatting, `PLUGIN_*`,
  `USER_*`, `CRON_JOB_*`…) has never been emitted. Deliberately left untouched — a second purge
  wave is a product decision in its own right (a new Prisma migration, an audit of everything that
  may have subscribed in production), not a side effect of a webhook task. Decision to make: a
  second wave or not.
- **`ClientsModule` cannot be imported under ts-jest**: the chain
  `ClientsModule → WebhooksModule → drivers/discord.driver.ts → @teever/ez-hook` (a pure-ESM JSR
  package) doesn't compile under ts-jest. Any future test that imports `ClientsModule` as a MODULE
  (not just `ClientsService` in type position) will rediscover it. To be decided someday: ts-jest
  ESM config, or replace the Discord driver's dependency.
- **Item 15 (mentions) — per-company customization not done**: all three FR mentions are
  `statutory: true` (statutory default rate, €40 indemnity, doctrinal early-payment-discount
  wording); nothing lets a company stipulate a different value. No need expressed to date; the
  interpolation mechanism is already ready to accept a third value source the day this need
  arises.
- **Item 14 — no regional WORM/S3 archive provider**: only one provider exists (local
  content-hash-addressed persistence). Would only be reopened with a real data-residency need
  (MX/BR/SA) and real AWS credentials — neither exists in this environment.
