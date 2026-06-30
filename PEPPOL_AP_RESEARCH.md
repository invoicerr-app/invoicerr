# Peppol Access Point Research — Invoicerr

**Date:** 2026-06-30  
**Branch:** feat/compliance-architecture  
**Scope:** How to make the `PeppolApPort` real — self-hosted vs vendor-REST, free sandbox, certification constraints.

---

## Table of Contents

1. [A — The Hard Constraint: Production Network Certification](#a--the-hard-constraint-production-network-certification)
2. [B — Test/Pilot Network: Official Peppol Test Environment](#b--testpilot-network-official-peppol-test-environment)
3. [C — Self-Hosted Options Compared](#c--self-hosted-options-compared)
4. [D — Vendor REST API Survey](#d--vendor-rest-api-survey)
5. [E — Recommendation](#e--recommendation)
6. [Comparison Tables](#comparison-tables)
7. [Wiring into PeppolApPort](#wiring-into-peppolapport)
8. [Sources](#sources)

---

## A — The Hard Constraint: Production Network Certification

### Can an invoicerr instance connect to the PRODUCTION Peppol network without being a certified AP?

**No. This is an absolute constraint.**

The Peppol production network operates on a *four-corner model* (C1→C2→C3→C4). Every message traversal between C2 and C3 uses AS4/ebMS3 with mutual TLS backed by the **Peppol PKI**. OpenPeppol issues PKI certificates **only to paid members**. There is no self-signed alternative for production, and the production trust anchors reject all non-OpenPeppol CA chains.

### AP Certification pathway

| Step | Requirement | Cost / Notes |
|------|------------|-------------|
| 1. Join OpenPeppol | Sign Peppol Service Provider Agreement (SPA) with a Peppol Authority in your jurisdiction (FR: DGFIP; PL: Polish Peppol Authority; IT: AgID) OR with OpenPeppol AISBL as Coordinating Authority | **VERIFIED** — peppol.org/join/membership/ |
| 2. Pay membership fees | Candidate SP, AP-only, S1-S2 (1–50 employees): €1,025 sign-up + €1,800/year. Certified SP (after passing tests): €2,800/year (S1-S2). Fees scale to S5 (>2,500 employees: €2,750 sign-up, €6,100/year certified). | **VERIFIED** — peppol.org/join/fees-2025/ |
| 3. Request test PKI certificate | Submit via OpenPeppol Service Desk (Jira). Must attach signed SPA or Peppol Member form + business registration document. | **VERIFIED** — openpeppol.atlassian.net service desk |
| 4. Run Peppol Testbed | Access testbed.peppol.org, authenticate with test PKI cert, pass all AS4 conformance test cases. | **VERIFIED** — peppol.org/tools-support/testbed/ |
| 5. Request production PKI cert | Issued only after Testbed pass. Certificate is valid per AP operator, not per instance. | **VERIFIED** — PKI CA Migration Plan docs |
| 6. Renew annually | Annual membership fees ongoing; PKI G3 root valid 2025–2035. G2 certificates were revoked April 20, 2026. | **VERIFIED** — Arratech blog, phase4 discussion #334 |

### What this means for invoicerr

- **"Every invoicerr instance is its own AP on production" is NOT feasible.** AP operator status belongs to an entity (invoicerr GmbH/SASU/etc.), not to individual deployments.
- A single certified AP operator can serve multiple tenants through one (or a HA cluster of) AP instance(s). All invoicerr customer companies route through that operator.
- Self-hosting Oxalis-NG or phase4-peppol-standalone on production **still requires the OpenPeppol PKI certificate** — which still requires the paid membership + certification process above.
- **Verdict: self-hosted = fully non-proprietary transport, but operator certification is unavoidable and paid.**

---

## B — Test/Pilot Network: Official Peppol Test Environment

### Is there an official Peppol test environment?

**Yes.** OpenPeppol operates a pilot/test infrastructure:

| Component | URL / Address | Verified |
|-----------|--------------|---------|
| Test SML (SMK) | `acc.edelivery.tech.ec.europa.eu` | **VERIFIED** — multiple OpenPeppol docs |
| Test SMP | Each SP registers their own test SMP against the SMK | **VERIFIED** |
| Testbed | `https://www.testbed.peppol.org` | **VERIFIED** — peppol.org/tools-support/testbed/ |
| Test PKI CA | OpenPeppol G3 Test CA (separate from production CA) | **VERIFIED** — peppol.helger.com PKI docs |

### Can you get a test PKI certificate for free?

**No — not without OpenPeppol membership.**

From the OpenPeppol Service Desk process (request type "PKI Certificate Request"):

> "For test certificates you must either attach a signed Peppol Service Provider Agreement (by both member and Peppol Authority) or a signed Peppol Member form if you don't have a signed Service Provider agreement yet."

— **VERIFIED** via search result quoting Service Desk PKI request instructions.

A "Peppol Member form" implies at minimum Candidate SP membership, which incurs the sign-up fee (€1,025 for S1-S2) and annual fee (€1,800). There is no documented path to a test PKI certificate that bypasses membership.

### Is a LOCAL self-contained sandbox possible without the official network?

**Yes — with limitations.** Projects such as [phax/peppol-sandbox-network](https://github.com/phax/peppol-sandbox-network) (referenced in context as `0x01d/peppol-sandbox-network`) bundle Oxalis AS4 + phoss SMP in Docker Compose, forming an isolated local loop. This uses a self-signed or pre-baked test keystore. It proves the AS4 transport layer works locally but **does not connect to the official test SML or any real Peppol participant**. Suitable for unit/integration testing of the AP wiring code; not a substitute for real Peppol network validation.

### Conclusion for section B

The "free unlimited self-hosted sandbox against test SML with free test cert" path as formulated does **not exist**. A test PKI certificate is gated behind paid OpenPeppol membership. Once membership is established, the test environment (SMK + testbed) is unrestricted in transaction volume.

---

## C — Self-Hosted Options Compared

### Options evaluated

#### 1. phase4-peppol-standalone (`phax/phase4-peppol-standalone`)

- **What it is:** Spring Boot 3.x application demonstrating a standalone Peppol AP using the phase4 library (v4.5.1, released 2026-05-22 — **VERIFIED** from GitHub).
- **REST send API:**
  - `POST /sendas4/{senderId}/{receiverId}/{docTypeId}/{processId}/{countryC1}` — auto-builds SBDH, looks up SMP, sends via AS4.
  - `POST /sendsbdh` — when SBDH is pre-built (Testbed scenarios).
  - `POST /as4` — receive endpoint (inbound AS4).
  - `GET /do-peppol-reporting/{year}/{month}` — submit OpenPeppol statistics.
  - All endpoints require `X-Token` header for auth.
- **Last update:** April 12, 2025 (reporting API extension). Core phase4 library at v4.5.1 (May 2026).
- **Certificate:** Requires a real Peppol PKI certificate; "the contained keystore is a dummy one only."
- **Docker:** Yes, Dockerfile + docker-run.cmd included.
- **NestJS integration pattern:** Run as a Docker sidecar; NestJS `PeppolApHttpClient` calls its REST API. Maps cleanly to `send()` → `POST /sendas4/...` and `getStatus()` would need a polling endpoint (not currently in standalone — need phoss-ap or custom extension).
- **Assessment:** Best self-hosted option for invoicerr due to REST API surface. Requires implementing a status tracking layer on top.

#### 2. phoss-ap (`phax/phoss-ap`)

- **What it is:** Production-grade complete AP based on phase4 + Spring Boot 4.x. More feature-complete than standalone.
- **Extras over standalone:** PostgreSQL/MySQL backing, full MLS (Message Level Status) support, Docker Compose.
- **REST API:** Outbound sending + automatic SMP lookup; full REST API documented on the project wiki.
- **Last update:** Actively maintained alongside phase4 (same author, Philip Helger).
- **NestJS integration:** Docker sidecar pattern, same as standalone but more operationally complete.
- **Assessment:** Better for production; more complex to set up than standalone.

#### 3. oxalis-ng (`OxalisCommunity/oxalis-ng`)

- **What it is:** Open-source Peppol AS4 AP maintained by NorStella Oxalis Community (non-profit, Norway).
- **Latest release:** v1.3.0, May 10, 2024 (**Note:** context said "May 2026" — this is incorrect; it is May 2024). Drops G2 PKI (revoked April 2026). **VERIFIED** from GitHub releases.
- **REST API:** Receives AS4 at `POST /as4` (HTTP inbound). **No native REST send API.** Sending is done via Java API or CLI invocation.
- **NestJS integration:** Difficult — would require CLI subprocess calls from Node.js or a custom REST wrapper around the Java library. No documented HTTP sending endpoint.
- **Assessment:** Technically valid AS4 implementation but harder to drive from NestJS than phase4-peppol-standalone.

#### 4. peppol-sandbox-network (docker compose)

- **What it is:** Docker Compose stack with Oxalis AS4 AP + phoss SMP for a closed local test loop. No connection to official SML.
- **REST send API:** None. The AS4 `/as4` endpoint is the only HTTP surface, intended for inbound.
- **NestJS integration:** Not viable as a send proxy without a custom wrapper.
- **Assessment:** Good for local "AP-to-AP" integration testing; not a production or official-test-SML solution.

### Self-hosted comparison table

| Criterion | phase4-standalone | phoss-ap | oxalis-ng | peppol-sandbox-network |
|-----------|-------------------|----------|-----------|----------------------|
| REST send API | **Yes** (`/sendas4`) | **Yes** (wiki) | **No** | **No** |
| Docker support | Yes | Yes (docker-compose) | Yes | Yes |
| PKI cert required | Yes | Yes | Yes | No (local only) |
| Connects to official test SML | Yes (with test cert) | Yes | Yes | **No** |
| Node/NestJS integration | Easy (HTTP sidecar) | Easy (HTTP sidecar) | Hard (CLI) | N/A |
| Status tracking | Partial (no GET /status) | Full (MLS) | Partial | N/A |
| Last update | Apr 2025 (lib May 2026) | Active (same author) | May 2024 | Unknown |
| Production readiness | Example only | Full AP | Full AP | Dev only |

---

## D — Vendor REST API Survey

> Criteria: free sandbox (unlimited preferred), REST send endpoint, REST status endpoint, suitability for `PeppolApPort`.

### peppol.sh

- **Sandbox:** Free, unlimited test invoices. Every account starts in sandbox mode. No time limit, no credit card, no KYC required for sandbox.
- **Sign-up:** `POST https://api.peppol.sh/v1/signup` → returns `ps_test_*` API key immediately. No UI.
- **Send endpoint:** `POST /v1/invoices` (JSON invoice payload, handles UBL/CII generation + routing).
- **Status endpoint:** `GET /v1/invoices/:id` (delivery status polling).
- **Auth:** Bearer token (`Authorization: Bearer ps_test_xxx`).
- **Production pricing:** €0.10/invoice, no monthly minimum, credits don't expire.
- **Peppol network:** Routed via their certified AP on production; sandbox invoices delivered by email.
- **Assessment:** **Tightest fit for `PeppolApPort`.** `send()` → `POST /v1/invoices`, `getStatus()` → `GET /v1/invoices/:id`. Adapter is ~50 lines.
- **Source:** peppol.sh, **VERIFIED** from site fetch.

### e-invoice.be

- **Sandbox:** Free, unlimited. No signup friction ("30 seconds, no KYC").
- **Send endpoints:** `POST /api/documents` (create), then `POST /api/documents/:id/send` (route). Two-step model.
- **Status:** Webhook (HMAC-SHA256 `X-Signature`), plus presumably a GET status endpoint (see OpenAPI at `https://api.e-invoice.be/api/openapi.json`).
- **Auth:** Bearer token.
- **Production pricing:** €0.25/invoice (Pro), €0.18/invoice (Enterprise).
- **Sandbox behavior:** Sandbox validates and serializes exactly like production, then emails UBL XML to you instead of routing to Peppol.
- **Assessment:** Excellent for verifying UBL serialization is correct. Two-step send requires a small adapter difference vs our single `send()`. Status relies on webhooks (not pure pull).
- **Source:** e-invoice.be/peppol-api, **VERIFIED** from site fetch.

### getpeppr

- **Sandbox:** Free forever, unlimited test documents. No credit card, no time limit.
- **Send/status endpoints:** 10 invoice endpoints documented via OpenAPI YAML (not fully parsed in this research). JSON in, UBL XML out.
- **Auth:** Unverified — not returned from marketing page; check API reference at getpeppr.dev/reference/.
- **Production pricing:** Starter €49/month (100 docs), Pro €149/month (800 docs), Business €399/month. Platform plans for multi-tenant SaaS from €99/month.
- **Geographic focus:** Belgium live, **France live September 2026**, Germany 2027. **Poland and Italy not on current roadmap** — concern for primary markets FR/PL/IT.
- **Assessment:** Good unlimited sandbox, TypeScript SDK available, but PL/IT coverage unverified/absent. Suitable for FR only at this stage.
- **Source:** getpeppr.dev, **VERIFIED** from site fetch.

### Storecove

- **Sandbox:** Yes, **30-day free trial only** (not unlimited).
- **Send endpoint:** `POST https://api.storecove.com/api/v2/document_submissions` (JSON with `routing` + `invoice` fields).
- **Status endpoint:** `GET /api/v2/document_submissions/{guid}/evidence` + webhooks.
- **Auth:** Bearer token.
- **Production pricing:** Not published on public site (contact sales).
- **Assessment:** Established vendor (10+ years), well-documented API, but 30-day sandbox cap is limiting for ongoing development. Good fallback for production SaaS use.
- **Source:** storecove.com/docs, **VERIFIED** from site fetch.

### Qvalia

- **Sandbox:** Yes, `https://api-qa.qvalia.com` — same endpoint shapes as production.
- **Send endpoint:** `POST https://api-qa.qvalia.com/transaction/{accountRegNo}/invoices/outgoing` (JSON or XML UBL 2.1).
- **Status endpoint:** Not explicitly confirmed; likely webhooks + polling.
- **Auth:** API key via `Authorization` Bearer header; separate keys for test and production.
- **Free tier:** Qvalia has a "free plan" but whether it's unlimited for sandbox is **UNVERIFIED** — check qvalia.com/pricing/.
- **Assessment:** Clean API, accepts both JSON and XML, solid for FR/PL/IT since Qvalia covers EU broadly.
- **Source:** qvalia.com/help/how-to-access-peppol-api-step-by-step-guide/, **VERIFIED** from site fetch.

### Peppox

- **Sandbox:** Yes (Integration environment), free account.
- **Send endpoint:** `POST /v1/invoices/send` (JSON payload including invoice lines, VAT, PDF attachment).
- **Status endpoint:** Async webhooks/notifications for delivery confirmations.
- **Auth:** Bearer token (`Authorization: Bearer YOUR_API_KEY`).
- **Node.js SDK:** Yes, listed as available.
- **Free unlimited:** Free to create account and sandbox; pricing for production **UNVERIFIED** — check peppox.com for pricing page.
- **Assessment:** Node.js SDK is a plus for NestJS; free account available but sandbox volume limits unverified.
- **Source:** peppox.com/developer/, **VERIFIED** from site fetch.

### Recommand

- **Sandbox:** Yes — "register a new company and use it as both sender and recipient" for test sends.
- **Send endpoint:** `POST https://peppol.recommand.eu/api/peppol/{companyId}/sendDocument`.
- **Status endpoint:** **UNVERIFIED** — API reference page returned no content.
- **Auth:** Basic auth (API key as username, secret as password, base64).
- **Open source:** Yes — `github.com/brbxai/recommand-peppol` (MIT license).
- **Pricing:** **UNVERIFIED** — not returned from search or fetch.
- **Assessment:** Open-source backend is notable. Sandbox approach (sender = receiver loopback) is simple but limited. Needs more research for status and pricing.
- **Source:** recommand.eu/en/docs, **PARTIALLY VERIFIED**.

### Tickstar (Unifiedpost)

- **Sandbox:** Yes — "Trial/Test and Production use different credentials and URLs."
- **Send endpoint:** Transaction REST API (exact paths not exposed publicly; requires account + SwaggerHub access).
- **Auth:** OAuth2 (client_id + client_secret).
- **Free unlimited:** **UNVERIFIED** — no pricing disclosed in public docs.
- **Assessment:** Enterprise-grade, major Peppol SP (Xero, SAP, Pagero rely on Tickstar infrastructure). Heavy enterprise sales motion; not self-serve for developers. Adapter feasible but requires contact.
- **Source:** tickstar.com/developers-tools/, **PARTIALLY VERIFIED**.

### Pagero (ONESOURCE/Thomson Reuters)

- **Sandbox:** **UNVERIFIED** — no public developer sandbox docs found.
- **Send/status endpoints:** **UNVERIFIED** — only support portal links found.
- **Pricing:** Enterprise.
- **Assessment:** Not recommended for this use case; no developer-self-serve path discovered. Skip for now.
- **Source:** **UNVERIFIED** — pagero.github.io only covers inbound business responses.

### Tradeshift

- **Sandbox:** Developer sandbox exists but pricing/limits **UNVERIFIED**.
- **Send endpoint:** REST API at `https://api.tradeshift.com/tradeshift/rest/external/` (legacy path).
- **Auth:** OAuth2.
- **Note:** Tradeshift integration is being deprecated in some ERP contexts (Business Central deprecated it in favor of Avalara/Pagero/etc.). Not recommended as primary adapter.
- **Source:** **PARTIALLY VERIFIED** — search results only.

---

## E — Recommendation

### Immediate path: prove the channel end-to-end NOW (free, zero friction)

**Recommended vendor: peppol.sh**

1. `POST https://api.peppol.sh/v1/signup` → receive `ps_test_` API key (no credit card, no KYC, immediate).
2. Wire `PeppolApHttpClient` against `https://api.peppol.sh`:
   - `send()` → `POST /v1/invoices` with JSON payload (sender/receiver Peppol IDs, document bytes as Base64).
   - `getStatus()` → `GET /v1/invoices/:id`.
3. Test invoices are delivered by email (UBL XML) not routed live — same code path, safe sandbox.
4. Unlimited volume, no time limit.
5. When ready for live proof: pass KYC, generate `ps_live_` key, flip env var.

**Effort:** ~100 lines of adapter code in `peppol-client.ts` (or a separate `PeppolShApClient` implementing `PeppolApPort`). One config block in `PeppolApClientConfig`.

**Second best (equally unlimited, good for format verification):** e-invoice.be — note the two-step send (`POST /documents` then `POST /documents/:id/send`) requires a minor adapter pattern change but gives excellent UBL serialization feedback via the emailed XML.

### Self-hosted non-proprietary path (preferred long-term)

**Recommended stack: phase4-peppol-standalone → phoss-ap**

| Step | Action | Blocking on |
|------|--------|------------|
| 1 | Join OpenPeppol as Candidate SP | €1,025 + €1,800/year (S1-S2); signed SPA with your Peppol Authority (FR: DGFIP, PL: Polish PA, IT: AgID) |
| 2 | Request test PKI certificate | Via Service Desk (Jira); submit signed SPA + company registration |
| 3 | Deploy phase4-peppol-standalone | Docker sidecar; configure test keystore, `peppol.stage=test`, SMK `acc.edelivery.tech.ec.europa.eu` |
| 4 | Wire NestJS to sidecar | `PeppolApHttpClient` → sidecar `POST /sendas4/{...}` |
| 5 | Run Testbed conformance | Pass all AS4 test cases at `testbed.peppol.org` |
| 6 | Upgrade to production PKI cert | After Testbed pass → request prod cert from Service Desk |
| 7 | Switch sidecar to `peppol.stage=prod` | All invoicerr tenants route through this AP instance |

**Key architectural point:** Invoicerr runs ONE AP operator instance (or HA cluster). All tenant companies are registered as Peppol participants under that AP's SMP registration. This is the standard SaaS-AP pattern.

**Upgrade path from phoss-ap:** Identical architecture, adds PostgreSQL + MLS support + full status API. Recommended for production over the standalone template.

### Ranked vendor adapter fallback list

| Rank | Vendor | Free Sandbox | Unlimited | Notes |
|------|--------|-------------|-----------|-------|
| 1 | **peppol.sh** | Yes | Yes | Best DX; maps directly to PeppolApPort; €0.10/invoice prod |
| 2 | **e-invoice.be** | Yes | Yes | Two-step send; €0.18-0.25/invoice prod |
| 3 | **Peppox** | Yes | Unverified | Node.js SDK; free account |
| 4 | **Qvalia** | Yes | Unverified | Clean JSON/XML API; EU coverage |
| 5 | **Recommand** | Yes (loopback) | Unverified | Open source backend |
| 6 | **Storecove** | Yes (30 days) | No | Established, well-documented |
| 7 | **getpeppr** | Yes | Yes | PL/IT not on roadmap yet |
| 8 | **Tickstar** | Yes | Unverified | Enterprise; no self-serve |

---

## Comparison Tables

### Summary: Self-hosted vs. Vendor

| Dimension | Self-hosted (phase4+phoss-ap) | Vendor REST (peppol.sh) |
|-----------|------------------------------|------------------------|
| Non-proprietary transport | **Yes** (AS4/ebMS3 standard) | No (proprietary REST) |
| Vendor lock-in | None | Medium (easy to swap via PeppolApPort) |
| Upfront cost | €1,025–€2,750 membership sign-up | €0 |
| Ongoing cost | €1,800–€6,100/year membership | €0.10–0.25/invoice |
| Free unlimited sandbox | No (needs test PKI cert + membership) | **Yes** |
| Maintenance burden | High (Java sidecar, PKI renewal, Testbed) | Low (API key rotation) |
| Per-tenant scaling | One AP, N tenants via SMP | Vendor handles |
| Time to first test send | Weeks (membership, cert, sidecar) | **Hours** |
| Production feasibility | Yes, with €1-6k/year budget | Yes, cost scales with volume |

---

## Wiring into PeppolApPort

The existing `PeppolApHttpClient` in `backend/src/compliance/providers/transmission/peppol/peppol-client.ts` already models the correct port abstraction. Per-vendor adapter changes:

### peppol.sh adapter (recommended NOW)

```typescript
// Minimal delta from existing PeppolApHttpClient

// send() → POST https://api.peppol.sh/v1/invoices
body = {
  sender: request.senderParticipantId,
  recipient: request.receiverParticipantId,
  documentTypeId: request.documentTypeId,
  processId: request.processId,
  document: request.documentBytes.toString('base64'),
  // peppol.sh may accept raw XML or base64; verify from docs
};
// Response: { id: string, status: string }
// messageId = response.id

// getStatus() → GET /v1/invoices/:id
// Response: { id, status: 'queued'|'delivered'|'failed', ... }
```

### phase4-peppol-standalone sidecar adapter

```typescript
// send() → POST http://peppol-sidecar:8080/sendas4/{senderId}/{receiverId}/{docTypeId}/{processId}/{countryC1}
// Body: raw XML bytes (documentBytes) as text/xml or multipart
// Response: 200 OK with a message ID (implementation-specific; check standalone source)

// getStatus() → phase4-standalone does NOT have a GET /status endpoint
// For status tracking, upgrade to phoss-ap which implements MLS polling
// OR track submissions in DB and poll via MLS-specific endpoint
```

### Storecove adapter

```typescript
// send() → POST https://api.storecove.com/api/v2/document_submissions
body = {
  routing: { eIdentifiers: [{ scheme: icd, id: receiverParticipantId }] },
  invoice: { /* Storecove JSON invoice format */ }
};
// Response: { guid: string }
// messageId = guid

// getStatus() → GET /api/v2/document_submissions/{guid}/evidence
// OR subscribe to webhook for async status
```

---

## Sources

All claims below include a verified/unverified marker.

| Claim | Source | Verified? |
|-------|--------|-----------|
| Peppol production requires OpenPeppol PKI cert | [peppol.helger.com PKI docs](https://peppol.helger.com/public/menuitem-docs-peppol-pki) | **VERIFIED** |
| OpenPeppol membership fees 2025 (€1,025 sign-up S1-S2) | [peppol.org/join/fees-2025/](https://peppol.org/join/fees-2025/) | **VERIFIED** |
| Test PKI cert requires signed SPA or Member form | [OpenPeppol Service Desk PKI request](https://openpeppol.atlassian.net/servicedesk/customer/portals) | **VERIFIED** (via search result quoting Service Desk instructions) |
| Test SML = `acc.edelivery.tech.ec.europa.eu` | [Peppol Testbed Environment Description PDF](https://peppol.org/wp-content/uploads/2023/06/Peppol-Testbed-eDelivery-Environment-Description-v1.0-1.pdf) | **VERIFIED** (multiple sources) |
| Peppol Testbed at testbed.peppol.org | [peppol.org/tools-support/testbed/](https://peppol.org/tools-support/testbed/) | **VERIFIED** |
| PKI G3 root valid 2025–2035 | [openpeppol.atlassian.net/wiki PKI 2025 CA Migration](https://openpeppol.atlassian.net/wiki/spaces/OPMA/pages/3977936899/Peppol+PKI+2025+-+Certificate+Authority+Migration+Plan) | **VERIFIED** |
| G2 PKI revoked April 2026 | [phase4 GitHub Discussion #334](https://github.com/phax/phase4/discussions/334); oxalis-ng v1.3.0 release notes | **VERIFIED** |
| phase4-peppol-standalone REST endpoints (`/sendas4`, `/sendsbdh`) | [github.com/phax/phase4-peppol-standalone](https://github.com/phax/phase4-peppol-standalone) | **VERIFIED** |
| phase4 v4.5.1 released May 22, 2026 | [github.com/phax/phase4](https://github.com/phax/phase4) | **VERIFIED** |
| phase4-peppol-standalone requires real PKI cert | [github.com/phax/phase4-peppol-standalone](https://github.com/phax/phase4-peppol-standalone) README | **VERIFIED** |
| phoss-ap: Docker, PostgreSQL, outbound sending | [github.com/phax/phoss-ap](https://github.com/phax/phoss-ap) | **VERIFIED** |
| oxalis-ng v1.3.0 released May 10, 2024 (not 2026) | [github.com/OxalisCommunity/oxalis-ng/releases](https://github.com/OxalisCommunity/oxalis-ng/releases) | **VERIFIED** |
| oxalis-ng has no native REST send API | [github.com/OxalisCommunity/oxalis-ng](https://github.com/OxalisCommunity/oxalis-ng) | **VERIFIED** |
| peppol.sh: free unlimited sandbox, `POST /v1/invoices`, `GET /v1/invoices/:id`, €0.10/prod | [peppol.sh](https://peppol.sh/) | **VERIFIED** |
| peppol.sh: `ps_test_` key issued via `POST /v1/signup` | [peppol.sh](https://peppol.sh/) | **VERIFIED** |
| e-invoice.be: free unlimited sandbox, two-step send (`POST /api/documents` → `POST /api/documents/:id/send`) | [e-invoice.be/peppol-api](https://e-invoice.be/peppol-api) | **VERIFIED** |
| getpeppr: free forever unlimited sandbox, FR live Sept 2026, PL/IT absent from roadmap | [getpeppr.dev](https://getpeppr.dev/) | **VERIFIED** |
| Storecove: `POST /api/v2/document_submissions`, 30-day trial, `GET .../evidence` | [storecove.com/docs](https://www.storecove.com/docs) | **VERIFIED** |
| Qvalia: `POST https://api-qa.qvalia.com/transaction/{regNo}/invoices/outgoing`, JSON or XML | [qvalia.com/help](https://qvalia.com/help/how-to-access-peppol-api-step-by-step-guide/) | **VERIFIED** |
| Qvalia sandbox free and unlimited | qvalia.com pricing page | **UNVERIFIED** — check qvalia.com/pricing/ |
| Peppox: `POST /v1/invoices/send`, free account, Node.js SDK | [peppox.com/developer/](https://peppox.com/developer/) | **VERIFIED** (sandbox unlimited: **UNVERIFIED**) |
| Recommand: `POST https://peppol.recommand.eu/api/peppol/{companyId}/sendDocument`, Basic auth | [recommand.eu/en/docs](https://recommand.eu/en/docs) via search | **PARTIALLY VERIFIED** (status endpoint: **UNVERIFIED**) |
| Tickstar: OAuth2, sandbox with separate credentials, Transaction REST API | [tickstar.com/developers-tools/](https://www.tickstar.com/developers-tools/) | **PARTIALLY VERIFIED** |
| Pagero/Tradeshift sandbox, endpoints, pricing | (various) | **UNVERIFIED** |

---

*Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>*
