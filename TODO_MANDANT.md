# TODO_MANDANT — what's in your hands (2026-09-15)

Contains only what remains to be done, sorted by what it unblocks. Everything that used to be here
and is done has been removed — the history lives in the commits, not in this file. Nothing here
blocks the merge: the PR CI does not depend on any secret.

**Reminder that still empties three-quarters of an imaginary list**: no PER-CLIENT credential is a
task in your hands. The app is multi-tenant — each client enters THEIR OWN credentials in
Settings → Channels, encrypted in the database. What follows are the credentials of THE COMPANY
RUNNING `invoicerr.chevrier.dev`, or staging (UAT) accounts to prove a channel live.

---

## 1. Email — two small remainders

- [ ] The instance mail server's `RESEND_API_KEY` is written in clear in `docker-compose.yml` on
      the esteban host instead of `.env` — move it to `.env` and reference it as
      `${RESEND_API_KEY}` like the other secrets.
- [ ] In a few weeks, once DMARC reports show only PASS: harden to `p=quarantine`.

## 2. Chorus Pro (French B2G) — qualification proven, production remaining

Closed for qualification: both layers of credentials (PISTE OAuth account + Chorus Pro technical
account) were obtained, and a real Factur-X submission reached the terminal state `IN_INTEGRE`
(`CPP0011117000000000425903`, 2026-09-14). **Worth remembering going forward**: Chorus Pro
qualification does not require any real French company — its sandbox test data supplies a
fictitious company structure and SIRET; only PRODUCTION requires a real one.

- [ ] **Production onboarding**: a new PISTE application dedicated to production + a Chorus Pro
      production onboarding declaration. Nothing attempted yet. Not determined whether this is on
      you (it will likely require a real SIRET, unlike qualification) — to be decided when this
      work is picked back up.

## 3. Channels and accounts still to open

Each one unblocks a live proof for a channel that's already written. None of them breaks anything
in its absence: everything is properly gated.

| Account / step | Unblocks | What's blocking |
|---|---|---|
| 🇮🇹 Italian PEC mailbox | SdI-via-PEC (already written, never proven live) | Purely administrative — a subscription with a provider (Aruba, Legalmail…), no accreditation or commercial contract required. |
| 🇵🇹 Portuguese AT credentials | Live Portuguese tax declaration | Portuguese NIF, subutilizador, X.509 certificate signed by the AT |
| 🇮🇹 Direct SdI (outside PEC) | The official SdI channel (independent of the PEC route above) | Partita IVA registered on Entratel + certificates issued by the AdE |
| 🇵🇱 KSeF **production** | KSeF in production (already proven in the test environment, 2026-06-28) | Polish NIP + trusted profile or qualified signature |
| 🇫🇷 PDP **production** | PDP in production (already proven live, 2026-08-29) | Commercial contract with a registered PDP |
| Re-subscribe the dev-instance company in the Polar sandbox | The billing customer is now one per company (`external_id = company.id`); your current sandbox subscription still hangs off the old per-user customer and Polar has no transfer endpoint. From Settings > Billing: set a billing email if the company email is already taken on Polar, then « Subscribe monthly », then cancel the old subscription from the old customer's portal. |

## 4. Administrative

- [ ] **PRIMARY — review and resolve the code-review and security threads on PR #401.** Every one of
      them already has a reply naming the commit that fixed it, the proof, and what is left. **Only
      you validate them**: the minor and low-severity ones were resolved on your standing instruction,
      the rest are deliberately left open so you can read the diff and resolve them yourself. Nothing
      should be merged into `main` before that pass.

      Counted on 2026-09-19: **148 threads in total, 79 still open.** A suggested order, because they
      are not equally urgent and two of them are of a different nature from all the others.

      1. **The two remaining security threads.** One high severity: the log stream is cross-tenant,
         because a role restriction is not a tenant restriction. One medium: nine production
         dependency alerts on the backend, six of them high. These two are the only security threads
         left open out of the twenty-six originally posted.
      2. **The eleven blocking threads that are product defects**, in the backend and the frontend.
         The heaviest are a document that stays publicly re-sendable while it is already being sent,
         a delivery step that is not idempotent under the queue's at-least-once redelivery, an
         unauthenticated cross-tenant write on the Italian notification endpoint, and two Italian and
         Portuguese catalogs that make it impossible to issue an exempt or zero-rate domestic line.
      3. **The ten blocking threads that are test-quality defects**, all in the end-to-end suite.
         These describe tests that cannot fail, tests that never run in continuous integration while
         being counted as green, and a global exception handler that swallows every application
         error. None of them breaks the product; all of them mean a guarantee you believe you have is
         not actually proven.
      4. **The fifty-six important ones**, last.
- [x] **Open the PR to `main`** — done: PR #401.

## 5. Small, no credentials needed

- [ ] **Weblate: create the second component, `backend-mails`.** The application's system e-mails are
      now translated through their own i18next catalog, which Weblate does not know about yet — only
      the frontend component exists today. Settings: file mask `backend/src/mail/locales/*/mails.json`,
      monolingual base file `backend/src/mail/locales/en/mails.json`, file format "i18next JSON v4"
      (the catalog uses `{{variable}}` interpolation and the `_one` / `_other` / `_many` plural
      suffixes, which that format understands and the plain-JSON one does not). Six languages:
      English, French, Italian, Polish, German, Portuguese.
- [ ] Weblate: check that it has correctly picked up the new i18n keys on the existing component.
- [ ] (Optional) GitHub `live-tests` environment with a *required reviewer*, so that no live run
      goes out without validation.

## 6. Before the first paying customer

- [ ] Off-site encrypted backups of the database and `documents/` (daily `pg_dump` + object
      storage, restore tested once), and an uptime alert on `/api/health` — self-hosting on the
      owner's own servers is fine until then.

---

*`TODO_FEATURES.md` is not for you: it's the engineering backlog. You have nothing to do with it.*
