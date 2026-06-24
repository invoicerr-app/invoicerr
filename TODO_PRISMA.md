# Implementation brief — Compliance lifecycle persistence (Prisma + NestJS)

> **Audience:** the implementing agent (opencode). **Reviewer:** the author of this brief will review your PR.
> **Branch:** work on `feat/compliance-architecture` (do not branch off `main`).
> **Read first:** `COMPLIANCE_ARCHITECTURE.md` (§11–§13) and `COMPLIANCE_LIFECYCLE.md` (the 3-axis lifecycle + the 3 drivers). This brief assumes that design; do not redesign it.

---

## 0. Goal (what "done" means)

The compliance module is feature-complete **in memory**: a pure engine + an event-sourced lifecycle runtime + three durable drivers (poll / timer / inbound-callback), all behind **store ports** with **in-memory implementations** and 307 passing unit tests.

Your job: **make it durable with PostgreSQL/Prisma and wire it into NestJS**, without changing the domain logic and without breaking a single existing test.

Concretely:
1. Convert the four store ports (and the code that calls their `tick()`/`receive()`/facade methods) from **sync to async** (DB I/O is async). Keep the in-memory impls + all existing specs green.
2. Add the Prisma models + a migration (additive — see schema blocks below).
3. Implement **Prisma-backed** versions of the four ports.
4. Wire a NestJS `ComplianceModule`: a real `applySignal`, a cron driving `poll.tick()`/`timer.tick()`, and an inbound webhook controller calling `inbound.receive()`.

You are **not** integrating any real external system (no real PAC/SdI/PDP calls), **not** migrating existing money/country columns, **not** touching the existing invoice flow. See §7 Out-of-scope.

---

## 1. Environment & conventions (read carefully)

- **DB:** PostgreSQL. Native `enum`, `Json`, `BigInt`, composite indexes are all available — use them.
- **Prisma:** v7 `prisma-client` generator. Schema: `backend/prisma/schema.prisma`. Generated client output: `backend/prisma/generated/prisma`. Import the client types via `import { ... } from '@/prisma/generated/prisma/client'` (note the `/client` subpath) — see `backend/src/prisma/prisma.service.ts`.
- **Prisma access:** inject the existing `PrismaService` (`@/prisma/prisma.service`). It wraps a single extended `PrismaClient` and exposes **per-model getters**. You must **add getters** for each new model (follow the existing pattern: `get complianceDocument() { return this.client.complianceDocument; }`, etc.). The underlying `client` is private, so getters are the integration point. Also add a `get $tx()` / expose `this.client.$transaction` if you need transactions (add a `transaction<T>(fn)` helper method to `PrismaService`).
- **Path alias:** `@/` → `backend/src/`. Use it for cross-module imports.
- **Migrations:** `npx prisma migrate dev --name compliance_lifecycle` (config in `backend/prisma.config.ts`, migrations dir `backend/prisma/migrations`). After editing the schema, run `npx prisma generate`.
- **Keep the pure core pure.** Files under `compliance/engine`, `compliance/profiles`, `compliance/canonical`, `compliance/lifecycle` (except the *adapters* you add), `compliance/providers`, `compliance/regimes`, `compliance/reporting`, `compliance/taxsystems` must **not** import Prisma/NestJS. All Prisma/Nest code goes in **new** files: a `compliance/persistence/` folder (adapters) and a `compliance/nest/` folder (module/service/controller/cron). The module must remain unit-testable without a DB.
- **Tests must stay green at every phase.** Run `cd backend && npx tsc --noEmit` (expect zero `^src/compliance/` errors) and `npx jest src/compliance` after each phase.
- **Commits:** conventional commits (`feat(compliance): …`, `refactor(compliance): …`). One commit per phase is ideal. End each commit message with `Co-Authored-By:` lines as the repo requires for AI commits.
- **Do NOT** run `prisma migrate reset` or anything destructive on a real database. Use a disposable/local DB for `migrate dev`.

---

## 2. The ports you are backing (current signatures — SYNC today)

These already exist with in-memory implementations. **Phase 1 makes them async.** Do not change their *semantics*, only `T → Promise<T>`.

- `compliance/operations/document-store.ts` → `ComplianceDocumentStore` (`save/get/update/list`) over `ComplianceDocumentRecord` (see `operations/types.ts`).
- `compliance/lifecycle/drivers/poll-job.ts` → `PollJobStore` (`enqueue/save/get/due/forDocument/cancelForDocument`) over `PollJob`.
- `compliance/lifecycle/drivers/timer-job.ts` → `TimerJobStore` (`arm/save/get/due/forDocument/cancelForDocument`) over `TimerJob`.
- `compliance/lifecycle/drivers/inbound-job.ts` → `CallbackStore` (`register/save/findByCorrelation/forDocument/cancelForDocument/recordMessage`) over `CallbackRegistration` + `InboundMessage`.

The **pure decision helpers** (`decidePoll`, `createPollJob`, `nextDelaySeconds`, `createTimerJob`, `createRegistration`, `messageKey`, `outcomeFromTransmission`) stay **sync and unchanged** — only storage I/O becomes async.

---

## 3. Phase 1 — async-ify ports, in-memory impls, drivers, facade, specs (NO Prisma yet)

This is a pure refactor; the suite must stay green. Do it first so the Prisma swap in Phase 3 is a drop-in.

1. **Port interfaces:** make every method return a `Promise`. e.g. `due(now: Date): Promise<PollJob[]>`, `save(j): Promise<PollJob>`, `recordMessage(m): Promise<{ duplicate: boolean }>`, `ComplianceDocumentStore.get(id): Promise<ComplianceDocumentRecord | null>`, etc.
2. **In-memory impls** (`InMemoryPollJobStore`, `InMemoryTimerJobStore`, `InMemoryCallbackStore`, `InMemoryComplianceDocumentStore`): wrap returns in `Promise.resolve(...)`. Keep the Maps.
3. **Drivers:** `PollScheduler.tick()`, `TimerScheduler.tick()` → `async tick(): Promise<TickReport>`; `await` the store calls and the `applySignal`. `InboundRouter.receive()` / `register()` / `cancelForDocument()` → async; `await` store + applySignal. The `applySignal` callback type becomes `(documentId, signal, log) => void | Promise<void>` and callers must `await` it.
4. **Facade:** `compliance/operations/compliance-service.ts` — every method that touches the store becomes `async` and returns `Promise<…>`; `await` store calls. (~30 methods. Mechanical.)
5. **Specs:** update the affected specs to `await`:
   - `lifecycle/drivers/poll-scheduler.spec.ts`, `timer-scheduler.spec.ts`, `inbound-router.spec.ts`
   - `operations/compliance-service.spec.ts`
   - Any spec asserting on a now-async return.
   Make the relevant `it(...)` callbacks `async` and `await` the calls. **Do not weaken assertions.**
6. Verify: `tsc` clean + `jest src/compliance` fully green. Commit: `refactor(compliance): make store ports + drivers + facade async`.

> If a sync→async ripple reaches a spec that builds a `LifecycleRuntime` directly (the runtime stays **sync** — it has no I/O), leave it sync. Only **store-touching** paths become async.

---

## 4. Phase 2 — Prisma schema + migration

Add to `backend/prisma/schema.prisma`. **Additive only.** Add the enums and models below, plus a back-relation on `Invoice`.

```prisma
enum ComplianceStatus {
  DRAFT ISSUED PENDING_CLEARANCE CLEARED REJECTED CONTINGENCY DELIVERED
  AWAITING_RESPONSE ACCEPTED REFUSED DISPUTED REPORTED CANCELLED CORRECTED LEGACY
}
enum ComplianceDirection { OUTBOUND INBOUND }
enum ComplianceDocumentKind {
  INVOICE CREDIT_NOTE DEBIT_NOTE CORRECTIVE_INVOICE PREPAYMENT SELF_BILLED
  EXPORT_INVOICE CASH_RECEIPT WITHHOLDING_RECEIPT PAYMENT_RECEIPT
}
enum ScheduledJobKind { POLL TIMER }
enum ScheduledJobStatus { PENDING ARMED DONE FIRED EXPIRED CANCELLED }
enum CallbackRegStatus { WAITING RESOLVED CANCELLED }

model ComplianceDocument {
  id             String                 @id
  invoiceId      String?
  invoice        Invoice?               @relation(fields: [invoiceId], references: [id])
  kind           ComplianceDocumentKind @default(INVOICE)
  direction      ComplianceDirection    @default(OUTBOUND)
  status         ComplianceStatus       @default(DRAFT)
  ctx            Json                   // TransactionContext snapshot (issueDate is an ISO string in JSON)
  plan           Json?                  // CompliancePlan
  lifecycleGraph Json?                  // frozen LifecycleGraph (assembler output)
  profileVersion String?
  number         String?
  immutableHash  String?
  previousHash   String?
  correctsId     String?                // self-reference id for credit/corrective docs (not a FK)
  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt
  events         ComplianceEvent[]
  authorityIds   ComplianceAuthorityId[]
  scheduledJobs  ScheduledJob[]
  callbacks      ComplianceCallbackRegistration[]
  @@index([status])
  @@index([invoiceId])
}

model ComplianceEvent {
  id         String             @id @default(uuid())
  documentId String
  document   ComplianceDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  type       String             // ISSUE | CLEAR | REFUSE | an inbound status string …
  at         DateTime           @default(now())
  actor      String?            // user | authority | system
  detail     String?
  payload    Json?
  @@index([documentId])
}

model ComplianceAuthorityId {
  id         String             @id @default(uuid())
  documentId String
  document   ComplianceDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  scheme     String             // UUID | IRN | SDI | CHNFE | CUFE | CDR | PROTOCOL | FOLIO …
  value      String
  issuedAt   DateTime           @default(now())
  @@index([documentId])
}

// One row backs BOTH PollJob (kind=POLL) and TimerJob (kind=TIMER). Nullable columns per kind.
model ScheduledJob {
  id         String             @id
  documentId String
  document   ComplianceDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  kind       ScheduledJobKind
  status     ScheduledJobStatus @default(PENDING)
  awaiting   String             // the ComplianceStatus the job guards
  // poll
  providerId String?
  channel    String?
  ref        String?
  attempts   Int                @default(0)
  nextRunAt  DateTime?
  expiresAt  DateTime?
  policy     Json?              // PollPolicy
  // timer
  onElapse   String?            // ComplianceEvent to fire on elapse
  fireAt     DateTime?
  createdAt  DateTime           @default(now())
  @@index([kind, status, nextRunAt])
  @@index([kind, status, fireAt])
  @@index([documentId])
}

model ComplianceCallbackRegistration {
  id             String             @id
  documentId     String
  document       ComplianceDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  channel        String
  correlationKey String
  awaiting       String
  status         CallbackRegStatus  @default(WAITING)
  createdAt      DateTime           @default(now())
  @@index([channel, correlationKey, status])
  @@index([documentId])
}

model ComplianceInboundMessage {
  id             String   @id
  channel        String
  correlationKey String
  status         String
  rawRef         String?
  receivedAt     DateTime @default(now())
  @@index([channel, correlationKey])
  // dedup is enforced in the store (check by channel+rawRef before insert); a partial unique index
  // on (channel, rawRef) WHERE rawRef IS NOT NULL is a nice-to-have via raw SQL in the migration.
}
```

Add to the existing `Invoice` model (additive back-relation only):
```prisma
  complianceDocuments ComplianceDocument[]
```

Then: `npx prisma migrate dev --name compliance_lifecycle` and `npx prisma generate`. Commit the schema + the generated migration SQL: `feat(compliance): prisma models for the lifecycle (documents, events, scheduled jobs, callbacks)`.

> **Enum vs string:** the TS domain uses string unions (`ComplianceStatus`, etc. from `lifecycle/state-machine.ts`). The Prisma enums use the **same member names**, so the mappers cast 1:1. `awaiting`/`onElapse`/`status`-on-jobs are stored as plain `String`/enum and cast back to the TS union in the mapper.

---

## 5. Phase 3 — Prisma store implementations (`compliance/persistence/`)

Create adapters implementing the (now async) ports. Each maps **row ↔ domain record**. Inject `PrismaService`.

Files:
- `compliance/persistence/prisma-document-store.ts` → `PrismaComplianceDocumentStore implements ComplianceDocumentStore`.
  - `save` = upsert the `ComplianceDocument` + replace its `events`/`authorityIds` (or append events incrementally — your call, but `save` must be idempotent on `id`).
  - `get` = `findUnique` with `events` + `authorityIds` included → map to `ComplianceDocumentRecord`.
  - **JSON (de)serialization:** `ctx.issueDate` is a `Date` in the domain but an ISO string in JSON — rehydrate `new Date(...)` on read. Same for any `Date` inside `plan`. Write a small `toRecord(row)` / `toRow(record)` mapper and unit-test it.
- `compliance/persistence/prisma-scheduled-job-store.ts` → exports **both** `PrismaPollJobStore implements PollJobStore` and `PrismaTimerJobStore implements TimerJobStore`, both backed by the `ScheduledJob` table filtered by `kind`.
  - `due(now)` = `findMany({ where: { kind, status: 'PENDING'|'ARMED', nextRunAt|fireAt: { lte: now } } })`.
  - Map `PollJob.policy` ↔ `policy` Json; `TimerJob.onElapse`/`fireAt` ↔ columns.
- `compliance/persistence/prisma-callback-store.ts` → `PrismaCallbackStore implements CallbackStore`.
  - `findByCorrelation` = first `WAITING` row matching `channel + correlationKey`.
  - `recordMessage` = check existence by `channel + rawRef` (when `rawRef` set) → if found `{ duplicate: true }`, else insert `{ duplicate: false }`. When `rawRef` is null, never dedup (always insert).
- `compliance/persistence/mappers.ts` (optional) for shared row↔domain mapping.

Add unit tests for the **mappers** (pure, no DB): `compliance/persistence/mappers.spec.ts` — round-trip a `ComplianceDocumentRecord` (incl. a `Date` in `ctx`) through `toRow`→`toRecord` and assert equality. (Full DB integration tests are §6.)

Commit: `feat(compliance): prisma-backed store adapters`.

---

## 6. Phase 4 — NestJS wiring (`compliance/nest/`)

1. **`PrismaService` getters** (`@/prisma/prisma.service`): add `get complianceDocument()`, `get complianceEvent()`, `get complianceAuthorityId()`, `get scheduledJob()`, `get complianceCallbackRegistration()`, `get complianceInboundMessage()`, and a `transaction<T>(fn: (tx) => Promise<T>): Promise<T>` helper wrapping `this.client.$transaction`.

2. **`compliance/nest/apply-signal.ts`** — the real glue `buildApplySignal(prisma, deps)` returning an `ApplySignal`:
   - load `ComplianceDocument` (`status`, `lifecycleGraph`);
   - `const rt = new LifecycleRuntime(graph, status)`;
   - `const effects = rt.dispatch(signal)`;
   - in a **transaction**: update `document.status`; append a `ComplianceEvent` (type = the applied event or inbound status); persist any new `authorityIds`; for each effect — `SCHEDULE_POLL`→create `ScheduledJob(POLL)`, `ARM_TIMER`→create `ScheduledJob(TIMER)`, `AWAIT_CALLBACK`→create `ComplianceCallbackRegistration`;
   - **cancel obsolete drivers:** when the status changed, set `status=CANCELLED` on this document's `ScheduledJob`/`ComplianceCallbackRegistration` rows whose `awaiting` ≠ the new status and that are still active. (A stale timer/callback firing later is already a safe NOOP, but cancelling keeps the tables clean.)
   - Be idempotent: a re-delivered signal that yields a NOOP must not append spurious events.

3. **`compliance/nest/compliance.module.ts`** — `@Module` that:
   - imports `PrismaModule` and `ScheduleModule.forRoot()` (add dependency `@nestjs/schedule`);
   - provides the three Prisma stores + the `PrismaComplianceDocumentStore`;
   - provides `PollScheduler`, `TimerScheduler`, `InboundRouter` constructed with the Prisma stores + the real `applySignal` + the default transmission registry;
   - provides a Nest `ComplianceFacadeService` that constructs the pure `ComplianceService` with the Prisma document store (so issue/send/correct/… persist);
   - exports the facade + the inbound router (for the controller).

4. **`compliance/nest/compliance.cron.ts`** — an `@Injectable` with `@Interval(60_000) async tick()` calling `await pollScheduler.tick()` then `await timerScheduler.tick()`. Log a one-line summary per tick. Guard against overlapping runs (a simple in-flight boolean).

5. **`compliance/nest/compliance.controller.ts`** — inbound webhook:
   - `POST /compliance/inbound/:channel` → map `{ correlationKey, status, rawRef }` from the body → `await inboundRouter.receive({ channel, ... })` → return the `ReceiveResult`.
   - **Security:** these endpoints accept external pushes. Add at least a shared-secret header check (e.g. `x-compliance-secret` vs an env var) and leave a `// TODO: per-provider HMAC signature verification` marker. Do not expose anything that mutates a document without correlation.

6. **Register** `ComplianceModule` in `backend/src/app.module.ts` (imports array).

7. Add `@nestjs/schedule` to `backend/package.json` (and `npm install`).

Commit: `feat(compliance): NestJS module — prisma stores, applySignal, cron, inbound controller`.

---

## 7. Out-of-scope (do NOT do these — they are separate, riskier phases)

- **Money → minor units** migration (`Invoice.totalHT/totalVAT/totalTTC` `Float` → `BigInt`) and the `TaxComponent`/`Withholding` tables. Leave existing money columns untouched.
- **ISO-3166 country migration** (`Company.country`/`Client.country` free-text → codes).
- Wiring compliance into the **existing** `invoices.service.ts` create/send/edit flow. (The facade exists; hooking it into the live invoice CRUD is a later phase.)
- Any **real** external integration (PAC/SdI/PDP/Peppol/national portals) — the providers stay stubs that `log.todo`.
- `PluginType` enum extension (FORMAT/TRANSMISSION/…) and the plugin-registry work.
- `FolioPool`, `OutboxMessage`, `LegalArchiveEntry`, `ReceivedDocument`, `DocumentResponse`, `TaxComponent`, `Withholding` from architecture §13 — **not** in this task (only the lifecycle-persistence subset above). If you think one is strictly required, leave a note in the PR rather than adding it.

---

## 8. Definition of done

- `cd backend && npx tsc --noEmit` → **zero** `^src/compliance/` errors (pre-existing errors in `src/modules/webhooks/` are not yours; ignore).
- `npx jest src/compliance` → **all green** (the 307 existing tests, updated to async where needed, plus your new mapper/store tests). Do not delete or weaken existing assertions; if a test must change shape because a call became async, keep its intent.
- `npx prisma validate` passes; the migration applies cleanly on a fresh DB (`prisma migrate dev`), and `prisma generate` succeeds.
- The pure compliance core (everything except `compliance/persistence/` and `compliance/nest/`) imports **no** Prisma/NestJS symbols (grep to confirm).
- `ComplianceModule` boots in the Nest app (`npm run build` succeeds; ideally `npm run start` connects).
- New code: clear, typed, commented where non-obvious; matches the surrounding style (2-space indent, named exports, the existing logger via `ComplianceLogger`).

## 9. Suggested commits (one per phase)
1. `refactor(compliance): async store ports + drivers + facade` (Phase 1)
2. `feat(compliance): prisma models for the lifecycle` (Phase 2)
3. `feat(compliance): prisma-backed store adapters` (Phase 3)
4. `feat(compliance): NestJS module — applySignal, cron, inbound controller` (Phase 4)

---

## 10. Reviewer checklist (what will be checked — make these pass)

- [ ] **No domain logic changed.** `git diff` on `engine/`, `profiles/`, pure `lifecycle/*` (state-machine, triggers, assembler, runtime, phases, the pure parts of the job files), `providers/`, handlers shows only `sync→async` signature changes — **no behavioural edits**, no changed thresholds, no altered tax/lifecycle results.
- [ ] **Pure core stays pure:** `grep -rE "@nestjs|prisma" src/compliance` only matches `compliance/persistence/` and `compliance/nest/`.
- [ ] **All 307 existing tests still pass**, async-adapted without weakened assertions; new mapper/store tests added.
- [ ] **Ports unchanged in semantics:** in-memory and Prisma impls are interchangeable (a test that runs the same scenario against both stores would pass). Bonus: parametrize one driver spec over `[InMemory, Prisma]` if a test DB is available.
- [ ] **Migration is additive & reversible:** no column drops/renames on existing tables; only the new tables + the `Invoice.complianceDocuments` back-relation. Migration SQL committed.
- [ ] **`applySignal` is transactional and idempotent:** status update + event append + driver (de)scheduling happen atomically; a duplicate/NOOP signal writes nothing.
- [ ] **JSON Date handling:** `ctx.issueDate` (and any plan dates) round-trip as real `Date`s — verified by a mapper test.
- [ ] **Driver semantics preserved:** poll backoff/expiry (`decidePoll`), silence-timer fire, inbound dedup + correlation behave exactly as the in-memory specs assert, now against Prisma.
- [ ] **Cron** doesn't overlap-run and logs each tick; **controller** rejects unauthenticated inbound and never resolves an uncorrelated message into a document.
- [ ] **Stale-driver safety kept:** a timer/callback firing after the document left the guarded state is still a NOOP (do not "fix" this by throwing).
- [ ] Scoped exactly to §0–§6; none of §7 leaked in.

---

### Quick reference — files you will touch / create
- **Edit (async):** `operations/document-store.ts`, `operations/compliance-service.ts`, `lifecycle/drivers/poll-job.ts`, `lifecycle/drivers/poll-scheduler.ts`, `lifecycle/drivers/timer-job.ts`, `lifecycle/drivers/timer-scheduler.ts`, `lifecycle/drivers/inbound-job.ts`, `lifecycle/drivers/inbound-router.ts`, and the four affected `*.spec.ts`.
- **Create (persistence):** `compliance/persistence/prisma-document-store.ts`, `prisma-scheduled-job-store.ts`, `prisma-callback-store.ts`, `mappers.ts`, `mappers.spec.ts`.
- **Create (nest):** `compliance/nest/apply-signal.ts`, `compliance.module.ts`, `compliance.cron.ts`, `compliance.controller.ts`.
- **Edit (wiring):** `backend/prisma/schema.prisma`, `backend/src/prisma/prisma.service.ts`, `backend/src/app.module.ts`, `backend/package.json`.
- **Do NOT export** the `nest/` module from the pure `compliance/index.ts`.
