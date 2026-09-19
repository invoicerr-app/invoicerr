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

- [ ] **A fresh security and code review, once every feature is in — before the merge, never after.**
      Owner decision, 2026-09-19: the previous review was removed rather than worked through. It had
      been posted against a branch that has since moved a very long way — the whole test suite changed
      runner, the web framework went up a major version, the storage layer gained an object-storage
      mode, and seven scaling defects were fixed — so a large part of it described code that no longer
      exists. Reviewing a moving target is how a review becomes a formality.

      What was removed: 257 inline comments on the pull request, archived outside the repository
      before deletion so the record of what was found and how it was fixed is not lost, plus the
      written security-audit report itself, whose central claim ("no cross-tenant identifier access")
      an external researcher later disproved on the released line. The only comments left on the pull
      request are the automated code-scanning ones, which this interface does not let us delete and
      which the next scan supersedes anyway.

      **Nothing goes into `main` before the new review.** Two things should be fed into it rather than
      rediscovered: the external advisory described below, and the fact that the backend was already
      swept for that advisory's whole defect class on 2026-09-19 with no finding.
- [x] **Open the PR to `main`** — done: PR #401.
- [ ] **Decide what to do about the external security advisory** (GHSA-g76v-ff9h-j6r2, reported
      privately on 2026-09-19, medium severity). A member with the lowest role could attach another
      company's payment method to their own invoice and read its bank details back, in the interface
      and in the generated PDF. **The released line `1.4.6` is affected and is running on self-hosted
      instances today; this branch is not** — the module it targets was rewritten, and the new payment
      configuration is immune by construction because there is no per-row identifier left to forge.
      The decision is yours: patch the released line separately, or ship this branch as the fix. A
      disclosure clock started the day it was reported.

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

- [x] **Off-site encrypted backups** — shipped 2026-09-19. Every artifact is encrypted before it
      leaves the process, with a key the storage provider never holds, so a leaked access key yields
      ciphertext rather than your customers' documents. The restore was proven without circular
      reasoning: an independent client downloads the object and decrypts it with nothing but the key
      and the bytes, and the operator tool runs as its own process with no dependency on a live
      instance. The manual database dump is covered by the same procedure. **Losing the key loses
      every backup, permanently** — decide where that key lives before you rely on this.
- [ ] Set `BACKUP_ENCRYPTION_KEY` and the backup bucket on the production instance, and store that
      key somewhere that survives the loss of the server it protects.
- [ ] An uptime alert on `/api/health` — self-hosting on your own servers is fine until then.

---

*`TODO_FEATURES.md` is not for you: it's the engineering backlog. You have nothing to do with it.*
