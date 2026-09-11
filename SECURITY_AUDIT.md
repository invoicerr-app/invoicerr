# Security audit — Invoicerr (branch `feat/compliance-engine-v2`)

Date: 2026-09-10
Type: defensive audit (red-team authorized by the owner), on the code of their own application.
Method: complete static reading of the risk areas + non-destructive probing of the local instance
(backend `:4000`, frontend `:6284`, test accounts) to confirm certain behaviors. No fix applied, no
commit. No destructive action, no flooding, no real exfiltration.

Context: GHSA-vhjw-gwc5-pjfp (brute-forceable signature OTP) was just fixed (lifetime lock
`otpFailedAttempts` + `ThrottlerModule`). This audit checks the rest of the surface.

**Legend**: `CONFIRMED` = behavior proven by end-to-end code reading and/or a targeted request
against the local instance. `THEORETICAL` = suspicious path identified but not fully traced /
depends on a condition not verified here (e.g. deployment configuration).

---

## Findings summary

| # | Title | Severity | Status |
|---|-------|----------|--------|
| 1 | better-auth's login rate-limit is bypassable by spoofing `X-Forwarded-For` | High | CONFIRMED (code) |
| 2 | Authenticated SSRF via the outbound webhook URL (no validation) | High | CONFIRMED (code) |
| 3 | Example secrets not rejected (`docker-compose.yml`): `JWT_SECRET`/`BETTER_AUTH_SECRET` public if left unchanged | High | CONFIRMED (code) |
| 4 | Outdated `@xmldom/xmldom` (multiple DoS) reachable from the public SdI endpoint | Medium | CONFIRMED |
| 5 | Unbounded request body on the public SdI endpoint (`readRawBody`) | Medium | CONFIRMED (code), mitigated by nginx in the standard topology |
| 6 | No security headers (CSP/X-Frame-Options/HSTS/nosniff) | Medium | CONFIRMED |
| 7 | Legacy email template sent as raw, unsanitized HTML to third parties (clients) | Medium | CONFIRMED (code) |
| 8 | Internal error message leak on the anonymous `/webhooks/:uuid` endpoint | Low | CONFIRMED (live probe) |
| 9 | Session cookie without `Secure` flag if `APP_URL` is `http://` behind a TLS reverse-proxy | Low | THEORETICAL (deployment-dependent) |
| 10 | `date` field rendering: HTML escaping is skipped when the value is parseable as a `Date` | Low | CONFIRMED (code), exploitability THEORETICAL |
| 11 | No dedicated rate-limit on expensive operations (Puppeteer PDF rendering, registry lookup) | Low | CONFIRMED |
| 12 | Outdated dependencies (npm audit) | See §dependencies | Mixed |

No **Critical** vulnerability confirmed (no anonymous RCE, no trivial and unconditional
authentication bypass). No cross-tenant IDOR found — see "What is done well".

---

## Detailed findings

### 1. [High] Login rate-limit bypassable via spoofed `X-Forwarded-For` — CONFIRMED (code)

**Files**:
- `nginx.conf:11-16` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
- `entrypoint.sh` + `Dockerfile:16` (nginx and `main.js` run in **the same container**, nginx
  proxies to `http://localhost:3000`)
- `backend/src/main.ts` (no `app.set('trust proxy', ...)` anywhere in the code)
- `backend/node_modules/better-auth/dist/utils/get-request-ip.mjs:6-13`
- `backend/node_modules/better-auth/dist/api/rate-limiter/index.mjs:370-383` (special rules for
  `/sign-in`, `/sign-up`, `/change-password`, `/change-email` → 3 req/10s; password reset →
  3 req/60s)
- `backend/node_modules/@nestjs/throttler/dist/throttler.guard.js:141-142` (default `getTracker`
  = `req.ip`)

**Description**: better-auth computes the client IP by reading `X-Forwarded-For` **with no notion of
a "trusted hop"**:
```js
const ip = value.split(",")[0].trim();  // takes the FIRST value in the list
```
However, `nginx.conf` sets `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, which
**appends** the real address to the end of any header already present in the incoming request,
rather than replacing it. A client that itself sends `X-Forwarded-For: 1.2.3.4` therefore makes
better-auth read `1.2.3.4` (its own value), never the real IP seen by nginx.

In parallel, the global `ThrottlerGuard` (Nest, `app.module.ts:111-114`) uses `req.ip` (Express),
which — in the absence of `trust proxy` — completely ignores `X-Forwarded-For` and equals the
upstream socket address. Since nginx and `main.js` run in the **same container** and talk to each
other over loopback, `req.ip` equals `127.0.0.1` for **all** requests, regardless of the real
client: the Nest Throttler's "per-IP" partitioning effectively becomes a **single global** bucket
(120 req/min for the whole instance, all clients combined).

**Exploitation scenario**: an attacker who sends a different `X-Forwarded-For` header on each login
attempt (`POST /api/auth/sign-in/email`) defeats better-auth's "3 attempts / 10s / IP"
partitioning — each attempt appears to come from a different IP. The only remaining brake is the
global Nest bucket (120 req/min, shared with all legitimate instance traffic) — i.e. potentially
tens of thousands of password attempts per day against a known account, with no lifetime lock on the
password side (unlike the signature OTP, which was fixed). This is the same **class** of
vulnerability as the already-fixed GHSA (unbounded brute-force), on a different path (login, not
signature).

**Recommendation**: `app.set('trust proxy', 1)` (or the Nest equivalent) so that `req.ip` reads the
LAST trusted hop of `X-Forwarded-For` (the one nginx adds itself), never the first; and/or configure
better-auth's `advanced.ipAddress.ipAddressHeaders` to do the same (read the last value, not the
first) — or, more simply, rely on `X-Real-IP` (already set by `nginx.conf:12`, not forgeable by the
client since nginx always overwrites it) instead of `X-Forwarded-For`. Add a per-account lock (like
the OTP) in addition to a plain IP rate-limit, which remains inherently bypassable by rotating
proxies.

---

### 2. [High] Authenticated SSRF via the outbound webhook URL — CONFIRMED (code)

**Files**:
- `backend/src/modules/webhooks/webhooks.service.ts:149-165` (`create`/`update`, no validation of
  `body.url`)
- `backend/src/modules/webhooks/drivers/generic.driver.ts:12-23`, `zapier.driver.ts:11-19`,
  `chat-webhook.driver.ts:96-105` (Slack/Mattermost/RocketChat) — each does a raw `fetch(url, ...)`
- `backend/src/modules/webhooks/webhooks.controller.ts:109-115` (`@Roles(OWNER, ADMIN)`)

**Description**: `POST /api/company/webhooks` (OWNER/ADMIN role of the active company) accepts an
arbitrary `url`, with no filtering of scheme, private/loopback IP ranges, or DNS resolution. Each
business event (invoice created, signed, etc.) then triggers a server-side `fetch()` to that URL.
The response is never returned to the caller (only `res.ok` is used) — so this is a **blind** SSRF,
but a blind SSRF is still exploitable to: reach internal services not publicly exposed (admin
databases, internal APIs), scan the deployment's internal network (hosted SaaS multiplexing several
companies), or — the most classic and most serious case — query the cloud metadata service
(`http://169.254.169.254/...`) if the instance runs on AWS/GCP/Azure without IMDSv2/equivalent
protection, which can expose infrastructure credentials.

**Exploitation scenario**: an OWNER (or a compromised OWNER account, or — in multi-tenant SaaS — a
malicious customer of the product) creates a webhook with `url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>"`
or `url: "http://<service-interne>:<port>/admin"`, then triggers the associated event (e.g. create
a client → `CLIENT_CREATED`). The invoicerr server performs the request from ITS network.

**Recommendation**: validate `url` on creation/update — `https`/`http` scheme only, resolve DNS and
reject private/loopback/link-local ranges (RFC1918, `169.254.0.0/16`, `::1`, etc.), and redo this
resolution on EVERY send (not only at creation, to prevent DNS rebinding). Consider a short timeout
and disabling automatic redirect following by `fetch`.

---

### 3. [High] Example secrets accepted as-is in `docker-compose.yml` — CONFIRMED (code)

**Files**:
- `docker-compose.yml:42-43`: `JWT_SECRET="your_jwt_secret"`, `BETTER_AUTH_SECRET="your_better_auth_secret"`
- `backend/node_modules/better-auth/dist/context/create-context.mjs:37-43` (`validateSecret`)

**Description**: the `docker-compose.yml` file provided as a quickstart contains **non-empty**
values, looking "already configured", for the two secrets that sign sessions / JWTs. These strings
are **public** (committed in the open-source repository). The only guardrail on the better-auth side
(`validateSecret`) only compares the secret against ITS OWN internal constant (`DEFAULT_SECRET`),
not against these strings — so a deployment that copy-pastes the file without changing these two
lines starts up **with no error or warning**, with a session-signing secret known to anyone who
reads the GitHub repository. `backend/.env.example:26` does better (`BETTER_AUTH_SECRET=""` — an
empty value makes the boot fail with an explicit error), which highlights that `docker-compose.yml`
is the weak point.

**Exploitation scenario (THEORETICAL, conditioned on the operator)**: an attacker who identifies an
online invoicerr instance and assumes (often verifiable, e.g. via version/error artifacts) that it
runs with the unmodified `docker-compose.yml` can forge a valid session cookie or JWT for any
`userId`, with no password at all — full authentication bypass.

**Recommendation**: in `main.ts`/`auth.ts`, explicitly reject at boot a set of known "placeholder"
values (`your_jwt_secret`, `your_better_auth_secret`, etc.), or better: do NOT provide a default
value in `docker-compose.yml` at all (leave it empty like `.env.example`, which makes startup fail)
rather than a string that looks filled in.

---

### 4. [Medium] Outdated `@xmldom/xmldom`, reachable without authentication — CONFIRMED

**Files**:
- `backend/src/modules/documents/transports/sdi/xml-helpers.ts:9,31-38` (`new DOMParser(...)`)
- `backend/src/modules/documents/transports/sdi/sdi-notifiche.controller.ts:62-65` (`@Public()`,
  route `POST /api/public/sdi/notifiche`)
- `backend/package.json:51` → `"@xmldom/xmldom": "^0.9.10"`

**Description**: `npm audit` lists 13 advisories for `@xmldom/xmldom` (ReDoS on the Processing
Instructions grammar, quadratic complexity in attribute deserialization/deduplication, quadratic
memory consumption, bypass of `requireWellFormed` via various vectors). This parser is used to read
the **raw and unauthenticated** XML that SdI (or anyone, since there is neither authentication nor
mTLS on this route — a fact already documented in the file's own comment) posts to
`/api/public/sdi/notifiche`. So this is a vulnerable dependency directly exposed to the Internet
without authentication. `@xmldom/xmldom` does not implement external entity/DTD resolution (no
classic XXE), but the denial-of-service advisories remain relevant here.

**Recommendation**: `npm audit fix` / update to the fixed version (the audit reports
`fixAvailable: true`, a non-major change a priori — to be re-verified).

---

### 5. [Medium] Request body read without size limit on the public SdI endpoint — CONFIRMED (code)

**File**: `backend/src/modules/documents/transports/sdi/sdi-notifiche.controller.ts:35-44`
(`readRawBody`)

**Description**: this route (`@Public()`) bypasses the global `bodyParser.json({ limit: '1mb' })`
(`main.ts:33-42`, which only applies to `Content-Type: application/json`) and reads the HTTP stream
byte by byte into an array of `Buffer`s **with no explicit size limit on the application side**. In
the shipped topology (nginx + node in the same container), nginx's default limit
(`client_max_body_size` not overridden in `nginx.conf` ⇒ 1 MB by default) bounds the risk in
practice. But nothing in the Node code itself prevents a different deployment (Kubernetes ingress
with no limit, a third-party proxy, or direct exposure of port 3000) from letting an anonymous
attacker send a multi-GB body and exhaust the process's memory.

**Recommendation**: enforce an explicit limit in `readRawBody` (count received bytes, destroy the
connection beyond a reasonable threshold, e.g. a few MB).

---

### 6. [Medium] No HTTP security headers — CONFIRMED

**Files**: `backend/src/main.ts` (no `helmet()`), `nginx.conf` (no `add_header`)

**Description**: neither Nest nor nginx adds `X-Content-Type-Options: nosniff`,
`X-Frame-Options`/`frame-ancestors`, `Content-Security-Policy`, `Referrer-Policy`, or
`Strict-Transport-Security`. The SPA (frontend) can therefore be embedded in a third-party
`<iframe>` (clickjacking) and benefits from no CSP to limit the impact of a future XSS. No concrete
vulnerability exploiting this absence was found in the audited code, but it is an expected missing
defense-in-depth for an application that handles financial documents and a public PDF share link.

**Recommendation**: add `helmet()` (or the equivalent headers in `nginx.conf`), at minimum
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or `frame-ancestors 'none'` in CSP),
`Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` if served over
HTTPS.

---

### 7. [Medium] "Legacy" email template sent as raw, unsanitized HTML to third parties — CONFIRMED (code)

**Files**:
- `backend/src/modules/documents/signatures/signatures.service.ts:314-323` (`interpolate` = a plain
  `.replace()` on `{{KEY}}`, then `html: interpolate(mailTemplate.body)`)
- `backend/src/modules/company/company.controller.ts:49-73` (`PUT /api/company/email-templates`,
  `@Roles(OWNER, ADMIN)`)
- Frontend: `frontend/src/pages/(app)/settings/_components/templates.settings.tsx` (the template's
  HTML editor, with `DOMPurify.sanitize` only on the **preview** side, never applied to what is
  actually stored/sent)

**Description**: an OWNER/ADMIN can edit the HTML body of the signature-request / OTP-code email
template. This body is sent **as-is** (the mailer's `html:`, never passed through a server-side
sanitizer) to the company's CLIENT — someone outside that account's trust perimeter. This is not an
SSTI (no template engine, just server-side variable substitution), and the interpolated variables
(`SIGNATURE_URL`, `OTP_CODE`, etc.) are generated server-side, so no second-order injection through
this channel — but an admin (or a compromised admin account, cf. finding #1) can inject any HTML
into an email that carries the product's official signature link and OTP code: tracking pixels,
misleading layout, a phishing link that mimics the real signature page to intercept the OTP at the
moment the client enters it.

**Recommendation**: pass `mailTemplate.body` through a server-side HTML sanitizer (allowlist of
tags/attributes, as the frontend already does for the preview) before the actual send, not only for
the preview.

---

### 8. [Low] Internal error message leak on the anonymous `/webhooks/:uuid` endpoint — CONFIRMED (live probe)

**File**: `backend/src/modules/webhooks/webhooks.controller.ts:86-94`

Probe performed (read-only, no data modified):
```
POST /api/webhooks/deadbeef-dead-beef-dead-beefdeadbeef
→ HTTP 500
{"success":false,"message":"Webhook processing failed",
 "error":"Active plugin with UUID deadbeef-dead-beef-dead-beefdeadbeef not found or has no webhook configured"}
```
The `catch` returns the raw `error.message` to the anonymous caller. In this specific case the
message is harmless, but the same mechanism applies to ANY exception thrown by
`provider.handleWebhook` (Prisma errors, internal errors from a third-party plugin) — a path that
can, depending on the installed plugin, reveal implementation details to an unauthenticated caller.

**Recommendation**: log the full `error` server-side, return only a generic message to the client
(`"Webhook processing failed"`, without `error.message`).

---

### 9. [Low / THEORETICAL] Session cookie without `Secure` if `APP_URL` is `http://` behind a TLS-terminating proxy

**File**: `backend/node_modules/better-auth/dist/cookies/index.mjs:18` (`secure: !!secureCookiePrefix`,
derived from `baseURLString.startsWith('https://')` otherwise from `isProduction`), `backend/src/lib/auth.ts:147`
(`baseURL: process.env.APP_URL || 'http://localhost:3000'`)

**Description**: the session cookie's `Secure` flag depends entirely on `APP_URL`'s scheme. A very
common self-hosting pattern (external Traefik/Caddy/nginx that terminates TLS and forwards over HTTP
internally, with `APP_URL=http://...`) would produce a session cookie WITHOUT `Secure`, even if the
end user only accesses the site over HTTPS. `httpOnly` remains `true` in all cases (good news: no
cookie theft via XSS), and `SameSite=Lax` is always active. Not verified under real conditions
(depends on each operator's deployment choice) — classified THEORETICAL.

**Recommendation**: clearly document that `APP_URL` must be `https://` as soon as the instance is
exposed via TLS (even if terminated upstream), or expose `advanced.useSecureCookies: true` as an
explicit configuration option.

---

### 10. [Low] `date` field rendering: escaping is skipped if the value is parseable as a `Date` — CONFIRMED (code), THEORETICAL exploitability

**File**: `backend/src/modules/documents/rendering/render-html.ts:74-81`
```ts
case 'date': {
  const dateStr = String(value);
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return escapeHtmlSafe(dateStr);
  }
  return dateStr; // YYYY-MM-DD format — NOT escaped
}
```
All the other branches of `renderFieldValue` systematically go through `escapeHtmlSafe` (well
verified elsewhere — see "What is done well"). This branch is the only exception: if
`new Date(dateStr)` succeeds in parsing the string (the JS `Date` parser is lenient with non-ISO
formats), the raw value is concatenated without escaping into the HTML sent to Puppeteer. No strict
upstream validation was found that would guarantee a `date`-type field contains ONLY `YYYY-MM-DD`
before storage — so real exploitability depends on the ability to get a string accepted that
contains both HTML metacharacters and a pattern that `Date.parse` still accepts (not demonstrated
here, uncertain with the V8 engine).

**Recommendation**: remove the exception — call `escapeHtmlSafe(dateStr)` unconditionally, whether
the parse succeeds or not (no functional loss; `dateStr` in `YYYY-MM-DD` format contains no
character to escape anyway).

---

### 11. [Low] No dedicated rate-limit on expensive operations — CONFIRMED

**Files**: `backend/src/modules/documents/rendering/render-pdf.ts` (launches one Puppeteer page per
render), `backend/src/modules/company-lookup/company-lookup.controller.ts` (`lookup`, authenticated,
queries external registries)

**Description**: aside from the two public signature routes (dedicated `@Throttle`) and the global
120 req/min bucket, no "expensive" route (PDF rendering via a shared headless browser, querying
external national registries with quotas) has its own limit. A normal authenticated account can
trigger up to 120 PDF renders/minute, potentially saturating the shared Puppeteer process (a single
`browserInstance` for the whole instance — a spike on one company degrades service for all the
others, whether shared self-host or SaaS).

**Recommendation**: add a tighter `@Throttle` on `GET .../pdf` and on `company-lookup` (already
partially mitigated by `CompanyLookupService`'s 6h in-memory cache).

---

## Dependencies (`npm audit`)

### Backend (`backend/`)
`13 moderate, 18 high, 0 critical` (31 total). Sorted by real reachability:

| Package | Severity | Context | Reachable? |
|---|---|---|---|
| `better-auth` | High | **prod**, the auth library itself | The listed CVE ("account takeover via magic-link/email-OTP") does not apply here: `auth.ts` enables neither `magicLink` nor `emailOTP` (only `emailAndPassword` + generic OIDC). Update anyway — future attack surface if these plugins are ever enabled. |
| `@xmldom/xmldom` | High | **prod**, reached by the public SdI endpoint | **Reachable without auth** — see finding #4. High priority. |
| `nodemailer` | High | **prod**, real email sending (invitations, OTP, notifications) | Reachable (any email-sending flow); advisory is about bypassing recipient-domain validation, not RCE. Update. |
| `prisma` / `@prisma/config` | High | **prod**, ORM | Major version bump (`fixAvailable` reports `prisma@6.19.3`, major) — to be planned with `npx prisma generate` + migration tests, not a simple `audit fix`. |
| `puppeteer` / `puppeteer-core` / `@puppeteer/browsers` / `extract-zip` | High | `puppeteer` is **prod** (PDF rendering); the other 3 are transitive | The advisories (`extract-zip` symlink path traversal) mainly concern **downloading the Chromium binary at image build time**, not HTTP requests in production. Supply-chain risk at build, not direct runtime RCE. Update in a future cycle. |
| `multer` | High | Transitive via `@nestjs/platform-express` | **Not reachable**: no `FileInterceptor`/multipart is wired anywhere in `src` (uploads are base64 JSON only, capped at 1 MB). Low priority despite the displayed severity. |
| `mysql2` | High | Transitive via `prisma` (the CLI's multi-DBMS support) | **Not reachable** at runtime: the app only talks to Postgres. Low priority. |
| `fast-uri`, `ip-address`, `js-yaml`, `brace-expansion`, `deepmerge-ts`, `browserslist` | High/Moderate | All transitive (build tooling, Prisma CLI, etc.) | Not directly reachable by an HTTP request. To be cleaned up by updating the parent packages. |

### Frontend (`frontend/`)
`1 low, 2 moderate, 5 high, 0 critical` (8 total):
- `better-auth` (client) — same library, the vulnerability lives server-side (see above).
- `react-router` — "CSRF Bypass in RSC Mode": the app is a classic Vite SPA, **not** in React
  Router RSC mode → not reachable.
- `postcss` — disclosure of `.map` files via `sourceMappingURL`: **build-time only** risk (source
  maps are not served in prod unless explicitly configured — to be checked).
- `browserslist`, `nanoid` — build tooling, not reachable at runtime.

**Dependencies conclusion**: of the ~89 Dependabot alerts mentioned, the fraction actually reachable
by a remote attacker without an account is small (`@xmldom/xmldom` foremost). Most are either
build/CLI dependencies never executed in service, or server libraries (`better-auth`, `nodemailer`,
`prisma`) whose precise vector documented by the advisory does not match the app's current
configuration — but they deserve updating for hygiene, with `prisma` and `puppeteer` requiring a
planned major version bump.

---

## What is done well

- **Systematic multi-tenant isolation.** Every audited controller (documents, archives, clients,
  API keys, signing certificates, transmission channels, active-company switching) scopes its Prisma
  queries by `companyId` taken from `@ActiveCompany()` — never from a URL parameter or the request
  body. `guards/auth.guard.ts` sets `request.companyId` only from the server session or from the API
  key's `companyId` — not forgeable client-side. No cross-tenant IDOR found, including in this
  branch's new code (archive, country-identifiers, country-policy).
  `companies.service.ts#switchActiveCompany` re-checks membership before switching the active
  company. `api-keys.service.ts#revoke` and `signing-certificates` re-verify `companyId` before any
  deletion, including when the initial `findUnique` was done by bare id.
- **Signature hardening (the fixed GHSA)**: confirmed under real conditions — token resolved by
  hash, strictly indistinguishable responses (identical 400/404 for "unknown", "expired", "already
  used"), lifetime lock on OTP attempts in addition to the per-IP throttle.
- **Secret encryption** (`utils/secret-crypto.ts`): AES-256-GCM, a unique random IV per encryption
  (`randomBytes(12)`), 128-bit authentication tag, key exclusively via
  `CREDENTIALS_ENCRYPTION_KEY` (never hardcoded), a feature that cleanly disables itself if the key
  is missing/invalid rather than storing in cleartext.
- **Signing certificates** (`signing-certificates.service.ts`): PFX and password encrypted
  separately, never logged, never returned by the API (`toMeta()` is the only exposed form),
  explicit rejection of an already-expired certificate at upload, and the file header explicitly
  documents a cross-tenant IDOR already fixed and regression-tested.
- **PDF rendering** (`rendering/render-html.ts`): all interpolated values (company name, document
  fields, totals, legal mentions) systematically go through HTML escaping before being handed to
  Puppeteer — a single minor exception found (finding #10).
- **No template engine for email/PDF** — so no SSTI surface ("compiling" a user-supplied string
  exists nowhere); interpolation by plain string substitution over a fixed vocabulary.
- **No exploitable raw SQL/Prisma**: the only occurrences of `$queryRaw`/`$queryRawUnsafe` are
  either a `SELECT 1` health-check, or schema synchronization at boot (never triggered by a user
  request), or a tagged Prisma template literal (parameterized).
- **No classic binary file-upload surface** (no `multer`/`FileInterceptor` wired anywhere) —
  everything goes through base64 JSON capped at 1 MB, which greatly reduces classic risks (path
  traversal, file execution, DoS via huge file).
- **Cookies**: `httpOnly: true` always active (no theft via XSS), `SameSite=Lax` by default; no
  authentication token stored on the frontend side (`localStorage`/`sessionStorage`) — everything
  goes through the session cookie (`credentials: 'include'`).
- **CORS**: explicit origin allowlist (`localhost:5173`, `APP_URL`, `CORS_ORIGINS`), never a
  wildcard or reflection of the received origin.
- **Inventoried public endpoints** (`@Public()`/`@AllowAnonymous()`): each has a justification
  documented in its own file header, and for those that expose a real attack surface (signature, PDF
  download link), responses are indistinguishable and tokens have 256 bits of entropy
  (`share-link-token.ts`) — brute-force unrealistic.
- **Architectural guardrail code**: `@ActiveCompany()`, `AuthGuard`/`RolesGuard` as global
  `APP_GUARD`s (impossible to forget to apply them on a new controller), a discipline documented in
  `CLAUDE.md` and respected throughout the audited code.

---

## Confidence / what remains unverified

**Confirmed by end-to-end code reading**: findings #2 to #11, the multi-tenant scoping (the "What is
done well" section), the behavior of the public routes (also confirmed by live probe).

**Confirmed by non-destructive live probe** (`curl`, read-only, no mutation, no account locked):
indistinguishable responses from the `public/signatures` and `public/documents` endpoints, 401
status on protected routes, error-message leak on `/webhooks/:uuid`, availability of the inventoried
`@Public()` endpoints.

**Theoretical / deployment-dependent, not verifiable on this machine**: finding #1 (better-auth's
rate-limit is disabled in `NODE_ENV=test` mode, which is the mode of the local instance available
here — the XFF bypass was established by reading the code of the three components involved
[`nginx.conf`, the absence of `trust proxy`, and `get-request-ip.mjs`], not replayed against a real
production instance, precisely to avoid any actual brute-force); finding #3 (depends on an operator
who would not change the example secrets); finding #9 (depends on each operator's TLS topology
choice); finding #10 (the existence of a real exploitable string was not demonstrated, only the code
path that would let it through).

**Out of scope for this pass** (to be audited separately if desired): the details of the ~15
national transmission providers (PDP, KSeF, SdI, ANAF, Peppol…) beyond the public surface already
covered; the exact content of each vendored Schematron; the CI/CD scripts themselves (GitHub Actions
secrets).
