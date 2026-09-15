# TODO_MANDANT — what's in your hands (2026-09-14)

Contains only what remains to be done, sorted by what it unblocks. Everything that used to be here
and is done has been removed — the history lives in the commits, not in this file. Nothing here
blocks the merge: the PR CI does not depend on any secret.

**Reminder that still empties three-quarters of an imaginary list**: no PER-CLIENT credential is a
task in your hands. The app is multi-tenant — each client enters THEIR OWN credentials in
Settings → Channels, encrypted in the database. What follows are the credentials of THE COMPANY
RUNNING `invoicerr.chevrier.dev`, or staging (UAT) accounts to prove a channel live.

---

## 1. Email — DONE on 2026-09-15 (instance server + mailbox)

Was: the dev instance sent nothing (SMTP variables empty since weeks). Now:

- [x] Instance mail server on `invoicerr.chevrier.dev`: `MAIL_PROVIDER=resend`,
      `MAIL_FROM=no-reply@invoicerr.app`, `RESEND_API_KEY` — present in the container (verified
      by name). One clean-up left: the key is written **in clear in `docker-compose.yml`** on the
      host instead of `.env` — move it to `.env` and reference it as `${RESEND_API_KEY}` like the
      other secrets.
- [x] Domain: Resend verified on `invoicerr.app` (DKIM `resend._domainkey`, return-path on
      `send.invoicerr.app`), Cloudflare Email Routing on the root (MX `route1/2/3.mx.cloudflare.net`),
      DMARC `p=none` with reports to `dmarc@invoicerr.app` — added 2026-09-15.
- [x] Inbound mailbox: Cloudflare catch-all `*@invoicerr.app` → a dedicated Gmail account, `noreply@`
      dropped; Gmail filters label `contact`/`privacy`, `support`, `security`, `abuse`/`postmaster`,
      `dmarc`. Outbound identities `contact@`, `support@`, `security@` send through `smtp.resend.com`
      (dedicated sending-only key). **Proven end to end 2026-09-15**: 7 test mails routed and
      labelled, a reply from `support@` reached Gmail with `spf=pass`, `dkim=pass (invoicerr.app)`,
      `dmarc=pass`, no "via", and the customer's reply came back under the Support label.
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
| 🇮🇹 Italian PEC mailbox | SdI-via-PEC (already written, never proven live) | Purely administrative — a subscription with a provider (Aruba, Legalmail…), no accreditation or commercial contract required. The only channel in this case. |
| 💳 Stripe account | Online payment from the client portal (shipped today) | No provider account exists for this project; the channel is written and dry-run tested, never proven without one. |
| 🇵🇹 Portuguese AT credentials | Live Portuguese tax declaration | Portuguese NIF, subutilizador, X.509 certificate signed by the AT |
| 🌍 Account with a commercial Peppol Access Point | Peppol in production | Contract with an Access Point, or OpenPeppol membership |
| 🇮🇹 Direct SdI (outside PEC) | The official SdI channel (independent of the PEC route above) | Partita IVA registered on Entratel + certificates issued by the AdE |
| 🇵🇱 KSeF **production** | KSeF in production (already proven in the test environment, 2026-06-28) | Polish NIP + trusted profile or qualified signature |
| 🇫🇷 PDP **production** | PDP in production (already proven live, 2026-08-29) | Commercial contract with a registered PDP |
| 🇪🇸 FACe | Spanish channel | FNMT certificate, in-person identity verification |
| 🇭🇺 NAV · 🇬🇷 myDATA · 🇷🇴 ANAF · 🇲🇽 CFDI | These four channels | Local taxpayer status + national tax identity in each country |

## 4. Administrative

- [ ] **Open the PR to `main`** — the branch is ~870 commits ahead. No secret is required for the
      PR CI to pass.

## 5. Small, no credentials needed

- [ ] Weblate: check that it has correctly picked up the new i18n keys.
- [ ] (Optional) GitHub `live-tests` environment with a *required reviewer*, so that no live run
      goes out without validation.

---

*`TODO_ISSUES.md` is not for you: it's the technical logbook. You have nothing to do with it.*
