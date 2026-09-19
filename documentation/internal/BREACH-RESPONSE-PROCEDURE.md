# Personal Data Breach Response Procedure

An operational runbook, not a legal text: what to do, in order, when personal data may have been
accessed, disclosed, altered, or lost without authorisation. It exists so that the decisions it covers
get made the same way whether it's a quiet Tuesday or two in the morning, and so that what the legal
documents already promise about breach notification is something a person can actually follow under
pressure rather than something only stated in prose.

Not published as a legal document, and not one: nobody outside the project needs to accept this text,
and nothing here creates a new commitment — Section "Related documents" names the documents that do,
and this procedure implements them.

## Scope — what this covers, and what it doesn't

- **Applies to**: the hosted offering (the instance operated at the Provider's own domain). Two
  relationships, both in play depending on what's affected:
  - **Controller**, for account, company, and subscription data belonging to the Provider's own
    hosted users (Privacy Policy §3);
  - **Processor**, for the personal data a hosted Company puts into the documents it creates or
    receives — its own customers' and contacts' names, addresses, and similar details (DPA §1, §3).
- **Does not apply to**: self-hosted deployments. The Data Processing Agreement says plainly that it
  "does not apply to the self-hosted software" — a self-hosted operator is their own controller and
  processor and runs this same kind of analysis themselves; nothing here creates an obligation running
  from the Provider to them. A self-hosted operator learning of a product *vulnerability* is served by
  [`SECURITY.md`](../../SECURITY.md), not this document. The two can intersect — a vulnerability that
  turns into an actual data-access incident on the hosted offering runs both at once — but a bug report
  is not by itself a breach, and this procedure only starts once Section 1's test is met.
- **Sole decision-maker**: Roméo Chevrier. No Data Protection Officer is appointed — the Privacy
  Policy already records that GDPR Art. 37 doesn't require one at this scale — and there is no
  separate security team or on-call rotation to route this to. Whoever notices a possible breach tells
  him, directly and immediately. This section exists to remove any doubt about who decides, not to
  describe a committee that doesn't exist.
- **Supervisory authority**: the CNIL (*Commission Nationale de l'Informatique et des Libertés*) — the
  Provider's own establishment is in France (Privacy Policy §1). Notify at
  <https://notifications.cnil.fr>.

## 1. Recognising a breach

A security report is a possible **entry point** into this procedure, not a substitute for it. The
question that routes an incident here is narrower than "is this a security bug": has personal data
covered by the Privacy Policy or the DPA actually — or quite possibly — been accessed, disclosed,
altered, or lost by someone not authorised to?

Concrete triggers worth treating as "possibly yes" until ruled out:

- An access pattern in application or infrastructure logs that no legitimate user or scheduled job
  explains.
- A leaked or exposed credential: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`,
  `BACKUP_ENCRYPTION_KEY`, an `ARCHIVE_S3_*`/`BACKUP_S3_*` access key, a sub-processor API key.
- A report from a researcher via `SECURITY.md`, from a hosted Customer, or from a sub-processor
  (Scaleway, Cloudflare, Resend, Google) about an incident on their own side that touched the data
  described in Privacy Policy §4 / DPA §7.
- A lost or stolen device that had standing access — in practice, the maintainer's own, since there is
  no separate ops team.
- A vulnerability report that demonstrates *actual* access to real data, not just a theoretical flaw —
  the moment a `SECURITY.md` report stops being "here is a bug" and becomes "and here is what I read
  using it," this procedure starts running alongside that one, not instead of it.

## 2. When the clock starts

GDPR's 72-hour clock (Art. 33) starts when the controller or processor becomes **aware** of a breach —
a reasonable degree of certainty that one occurred, not the first vague suspicion. Concretely: aware
means confirmed that data described in Section "Scope" was subject to unauthorised access, disclosure,
alteration, or loss. Reaching that point deliberately doesn't require full certainty about scope — an
incomplete but reasonably confident read starts the clock, and Section 5's notification can be phased
as more is learned (Art. 33(4)); waiting for a complete picture before starting the clock is not an
option the Regulation gives.

## 3. The first hour

- [ ] Note the exact time discovery was confirmed (Section 2) — everything in Section 5 counts from
  this timestamp, not from when the underlying flaw was introduced or first exploited.
- [ ] **Contain first if the incident is ongoing.** Evidence collection continues in parallel, but an
  active leak is not left running while paperwork happens.
- [ ] Identify, as far as can be told right now, which of these were touched:
  - the primary PostgreSQL database (Scaleway-managed) — where account data and Customer Personal
    Data actually live, held in the clear from the application's own perspective;
  - `ARCHIVE_S3` or local disk — the primary legal-archive store, also unencrypted at the application
    layer;
  - `BACKUP_S3` — the secondary, disaster-recovery copy, which **is** encrypted per artifact (Section
    6 changes the analysis here, it doesn't end it);
  - one specific Company's data, or the instance as a whole.
- [ ] Rotate what can be rotated immediately, scoped to what's actually compromised — not everything,
  reflexively, every time:
  - the PostgreSQL credentials, via the Scaleway console, for a database-level compromise;
  - the `ARCHIVE_S3_*` / `BACKUP_S3_*` access keys, for an object-storage-level compromise;
  - `BETTER_AUTH_SECRET`, which invalidates every active session instance-wide — a real cost, reserved
    for a confirmed session/auth compromise;
  - `CREDENTIALS_ENCRYPTION_KEY`, which makes every Company's already-stored channel credentials
    unreadable until each one re-enters them — also a real cost, reserved for a confirmed compromise of
    that specific key, not a routine precaution.
- [ ] Preserve what exists before it rolls off: application logs (kept 90 days, `LOG_RETENTION_DAYS`),
  Scaleway's own access/audit logs, and the specific rows or objects affected, if they can be identified
  without further exposure.
- [ ] Note for the record: there is no one-command tool in this codebase yet for session revocation or
  key rotation short of the manual steps above. That gap is a follow-up item once the incident is
  closed — not something to build in the middle of one.

## 4. Working out who's affected and how badly

- Which role was engaged — controller (account/billing data) or processor (Customer Personal Data)?
  A single incident can be both, since they can share the same database.
- Which data categories were actually exposed (Privacy Policy §3/§4 list the categories this product
  holds).
- Roughly how many data subjects and Companies: the Provider's own hosted users directly, or a hosted
  Customer's own end-clients through the documents that name them.
- The likely consequence to those specific people — a business name, address, and VAT/SIREN number on
  an invoice is a materially different risk from an account credential or a live session token. Weigh
  them separately; don't collapse one incident into a single flat severity.
- Whether what leaked was usable data or ciphertext (Section 6) — the single biggest factor in whether
  Section 5's individual-notification branches apply at all.

## 5. Notification

### 5a. To the CNIL (Art. 33) — when the breach is likely to result in a risk to individuals' rights and freedoms

Within 72 hours of the awareness point (Section 2), submit at <https://notifications.cnil.fr>:

- the nature of the breach and, so far as known, the categories and approximate number of data
  subjects and records concerned;
- the contact point: Roméo Chevrier, **contact@invoicerr.app** (no DPO — see "Scope" above);
- the likely consequences of the breach;
- the measures taken or proposed to address it and mitigate its effects.

If not everything is known within 72 hours, submit what is known and supplement afterward (Art.
33(4)) — a later, complete notification is not an excuse to miss the deadline for a partial one. If
Sections 4/6 conclude there is **no** likely risk to individuals, no CNIL notification is required —
but Section 7 still applies: that conclusion gets written down, not just reached.

### 5b. To the affected hosted Customer (DPA §12) — when Customer Personal Data is touched

This is the Provider acting as **processor**. The DPA's own commitment is specific, and this procedure
implements exactly that commitment, no more:

> notify **without undue delay** after becoming aware, with the information reasonably available at
> the time, sufficient to let the Customer meet **their own** 72-hour notification obligation to their
> supervisory authority, and their own obligation under Art. 34 to inform their affected Data Subjects,
> where it applies.

Concretely: identify every affected Company and email its Owner directly — as early as possible inside
the 72-hour window, not near the end of it, since the Customer needs runway to meet *their own* clock,
not just to be told it exists as it closes. Include what 5a's notification includes, scoped to that
Customer's own data.

**The Provider does not notify the Customer's own end-clients directly** — that decision, and that
notification, belong to the Customer, who is the controller of that data. Doing it for them would
promise something the DPA does not; giving them too little to decide with would break what it does
promise.

### 5c. To the Provider's own hosted users (Art. 34, controller role) — only when the risk to them is HIGH

This is the Provider acting as **controller**, for the account/billing data described in Privacy
Policy §3. Notify affected individuals directly (email, the address on file) without undue delay, in
plain language, when the breach is likely to result in a **high** risk to their rights and freedoms —
a materially higher bar than 5a's, and not automatic on every breach. State: what happened, what data
of theirs was involved, the likely consequences, what is being done about it, and the same contact
point as above.

This can be skipped — with the reasoning recorded in Section 7, not just assumed — if: the data was
unintelligible to whoever accessed it (Section 6), measures taken since mean the high risk is no longer
likely to materialise, or individual notification would involve disproportionate effort, in which case
a public communication takes its place rather than silence.

## 6. What the encrypted backups change

The backup-encryption work shipped this week means every artifact `backend/src/modules/backup`
uploads to `BACKUP_S3` is AES-256-GCM-encrypted before it ever leaves the instance, under
`BACKUP_ENCRYPTION_KEY` — a key the storage provider never holds, and which is deliberately kept
somewhere other than only the running instance's own `.env`/Secret (see
`documentation/docs/user-guide/backups.md`, "Every artifact is encrypted before it ever leaves the
instance"). That document already states the GDPR conclusion this procedure now has to apply under
pressure, rather than reason through for the first time:

- **A breach confined to `BACKUP_S3`** — someone obtains the `BACKUP_S3_*` access keys, or the bucket
  is misconfigured, but `BACKUP_ENCRYPTION_KEY` itself is not *also* exposed by the same incident —
  takes only ciphertext. That satisfies Art. 34(3)(a): personal data "rendered unintelligible to any
  person who is not authorised to access it." **Individual notification under 5b/5c is not required
  for that data.** Section 5a's risk assessment still runs on its own — the conclusion there is usually
  "no likely risk," but it is a conclusion to reach and record (Section 7), never one to assume without
  reaching it.
- **A breach of anything else does not get this exemption**, because nothing else in this stack is
  encrypted at the application layer today: not the primary PostgreSQL database — where every
  Company's account data and every document's Customer Personal Data actually lives day to day — not
  `ARCHIVE_S3`/local disk (the primary legal-archive store), not a session token, not
  `CREDENTIALS_ENCRYPTION_KEY` itself. A storage provider's own server-side "encryption at rest"
  doesn't change this: it protects against a stolen physical disk, not a leaked access credential, and
  a leaked credential is the realistic scenario this procedure is written for (`backups.md` draws the
  same distinction for self-hosted operators reading their own copy of this reasoning). If an incident
  touches any of these — or touches `BACKUP_ENCRYPTION_KEY` alongside `BACKUP_S3` — run the full
  Section 5 analysis with no exemption assumed.
- **The practical effect**: this week's work gives exactly one scenario — the secondary backup copy
  alone, key intact — a real, defensible reason to skip notifying individuals. It changes nothing about
  the primary database, which remains the far more likely source of an actual incident and gets no such
  exemption.

## 7. What gets written down, always

Every confirmed breach gets an entry in the register below — notified or not, high risk or none. Art.
33(5) requires this regardless of whether notification itself was required, and it is the only durable
evidence, afterward, that the Section 4 risk assessment was actually made rather than assumed. Fill it
in as soon as the immediate response (Sections 3-5) is done — don't wait for a quiet moment a
one-person operation may not get.

### Register

Copy this table for each new incident below the line; never overwrite a previous entry.

| Field | Entry |
| --- | --- |
| Date/time discovered | |
| Date/time awareness confirmed (Section 2) | |
| How discovered | |
| Systems/data affected (Section 3/4) | |
| Role(s) engaged (controller/processor) | |
| Approx. data subjects / Companies affected | |
| Containment actions taken | |
| Section 6 exemption applied? (yes/no, why) | |
| CNIL notified? (yes/no, why, when) | |
| Customer(s) notified per DPA §12? (yes/no, when) | |
| Data subjects notified per Art. 34? (yes/no, why) | |
| Root cause | |
| Follow-up fix / ticket | |

---

*(No incidents recorded yet.)*

## Related documents

- [`SECURITY.md`](../../SECURITY.md) — how a vulnerability is reported and triaged before it's known
  whether personal data was actually touched.
- Data Processing Agreement §12, Terms of Service §15.2, and the Privacy Policy — the commitments this
  procedure implements. If this document and one of those ever disagree, the legal document is the one
  that governs; that disagreement is a bug in this procedure to fix, not a license to read the legal
  document loosely.
