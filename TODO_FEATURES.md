# TODO_FEATURES — remaining product work

> This file tracks only what remains. Every shipped feature, every product decision, and the full
> history live in git (`git log`) — last commit before this rewrite: `ad6d0bd3` (2026-09-15).

## Remaining

| Item | State | e2e to prove |
|---|---|---|
| **Legal** — SaaS legal set | Shipped 2026-09-16 (ff2b5d4d, 3ade7e5f): privacy policy, DPA, legal notice, cookies + acceptable use next to the Terms of Service, versioned, embedded in the backend, public `/legal/<slug>` pages, sign-up checkbox and re-acceptance interstitial in SaaS mode only. Remaining: legal review of the drafts (marked Draft) and the hosting provider placeholder in every document. | `75-legal-acceptance.cy.ts` (green in both modes). |
| **E** — hosted offering: what remains | Hosting provider still to choose (`[HOSTING PROVIDER, COUNTRY]` placeholder in the Terms of Service); Polar production organisation/products/endpoint not created (only the sandbox is proven); DMARC hardening to `p=quarantine` once reports are clean. Proven on 2026-09-16 against a throwaway database: the full "customer stops paying" cycle — signed Polar webhook ACTIVE→PAST_DUE, real sweep PAST_DUE→BLOCKED, J-7/J-1 mails in Mailpit, real zip (PDF + JSON), deletion refused while a Polar subscription still exists, cascade deletion for a never-paid company. | `POLAR_LIVE=1` confirming the production organisation's products. |

### From the former TODO_ISSUES.md

`TODO_ISSUES.md` (the technical logbook) is deleted — see git history. On 2026-09-16 the owner decided to drop from this file every line deferred by decision (regional payment providers, S3/WORM archive, per-company mentions, cross-border composition, B2G coverage beyond the five in-scope countries, controller-module tests under ts-jest); they live in git history. What remains below is blocked on credentials or on an external party.

| Item | State |
|---|---|
| French inbound e-invoicing — PDP reception shipped, two remainders | Reception through the PDP is wired and proven in the sandbox (self-addressed deposit → inbound twin listed, downloaded, created as a received invoice, approved, settled). Remaining: the buyer lifecycle status endpoint answers a generic 404 on the free sandbox (kept non-fatal, to re-verify on a production PA), and the exact numeric code for a buyer refusal is best-effort, not sourced. |
| `reporting/` — French e-reporting calendar unread | `fr.json` shipped on 2026-09-16 with a `dischargedBy` + scope axis: domestic B2B is discharged by the PDP transport (CGI art. 289 E, raw text); B2C, international and payment data are the company's own duty, kept `unverified` because the calendar (decree 2022-1299 as amended, 2026-09-01 / 2027-09-01 by company size) could not be read raw from this machine (Légifrance and BOFiP blocked). To close: read the decree raw and flip the two facts to `legal`. |
| PT `pt-at` — mTLS not wired | The AT requires a signed X.509 client certificate for the HTTPS connection itself; `pt-at-client.ts` uses plain `fetch()`. Planned in the same `pfx`/`passphrase` shape as `transports/sdi/sdicoop-client.ts`, deliberately not done blind without a real PKCS#12 to test against. |
| PT `pt-at` — nonce RSA padding unverified | The AT manual names "RSA" with no padding parameter; PKCS#1 v1.5 was chosen as the best reading (OAEP ruled out as Node's default), to be confirmed on the first real round-trip (a wrong padding fails loudly: `CodigoResposta` 16/17). |
| KSeF status poller never proven live | `KSEF_AUTH_TOKEN` is absent from this environment, so two points remain unverified: (a) the `{code, description, details}` → terminal/rejected mapping is extrapolated from `authenticate()`'s own convention, never confirmed for the `invoiceStatus` endpoint itself; (b) whether `invoiceStatus` still responds once `send()` has closed the session is unknown to date. Distinct from the KSeF SEND channel, already proven live (2026-06-28). |
| KSeF PROD key missing | Only a vendored MF key for the TEST environment exists; no PROD key has ever existed in this repo, so `loadVendorizedKeys('prod')` fails loudly by design rather than falling back to the test key against a real production KSeF. Not done for lack of a real PROD company to date. |
