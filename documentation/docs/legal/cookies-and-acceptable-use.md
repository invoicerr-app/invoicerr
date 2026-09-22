---
title: Cookies & Acceptable Use
sidebar_position: 6
version: 2026-09-20
effectiveDate: 2026-09-20
---

:::warning[Draft]
Draft — not yet reviewed by counsel.
:::

This page covers two topics for the **hosted offering** of Invoicerr: the cookie the Service sets, and
the acceptable-use rules that apply to your account. Neither applies to the self-hosted software.

## Part A — Cookies and Other Browser Storage

### 1. What We Set

The Service sets **two** cookies, both from our own domain, both read by no one else, and neither
carrying any tracking or advertising purpose:

| Cookie | Purpose | Duration |
| --- | --- | --- |
| `better-auth.session_token` | keeps you signed in and associates your requests with your account and active Company | 7 days, extended each time you use the Service |
| `sidebar_state` | remembers whether you left the application's navigation sidebar open or collapsed | 7 days |

**We set no analytics, advertising, or other third-party tracking cookie**, and no third party sets a
cookie through the Service.

Beyond cookies, the Service keeps a small number of values in **your own browser's local storage**.
These never reach us — they are read only by the page running in your browser — but we list them here
because French law (article 82 of loi n° 78-17 of 6 January 1978) covers any writing to, or reading
from, your terminal equipment, not cookies alone:

| Stored value | Purpose |
| --- | --- |
| `i18nextLng` | the interface language you picked |
| `vite-ui-theme` | the light/dark theme you picked |
| `pwa-install-dismissed-at` | remembers that you dismissed the "install this app" prompt, so it stops asking |
| `invoicerr_portal_token` | on the client portal only: the access token from the link you were sent, so the page can keep loading the document it was opened for |
| `invoicerr-sw-reloaded` (session storage, cleared when you close the tab) | prevents a reload loop when a new version of the application is installed |

If you use the Service as an installable application, your browser also keeps an **offline cache** of
the application's own files (scripts, styles, icons) so it can start without a network connection.
That cache holds application code, not your business data, and clearing your browser's site data
removes it.

### 2. No Consent Banner

Everything listed in Section 1 is either **strictly necessary** for the Service to work at all (the
session cookie, the client-portal token, the service-worker reload guard, the offline application
cache) or a **preference you set yourself through the interface** and that we store only in order to
give it back to you (the sidebar state, the language, the theme, the dismissed install prompt).

Both categories fall within the exemptions article 82 of loi n° 78-17 of 6 January 1978 (loi
Informatique et Libertés) provides from the prior-consent requirement, as the CNIL applies them in its
guidelines and recommendation on cookies and other trackers — which is why no cookie-consent banner is
shown. **Nothing here is used for audience measurement, advertising, profiling, or any purpose that
would require your consent.** This is a statement about what the Service technically sets today; it is
not legal advice about your own use of cookies elsewhere.

### 3. Changing This

If a future version of the Service ever adds a cookie or similar technology that is not strictly
necessary and is not a preference you set yourself, this page — and the consent flow the ePrivacy
rules would then require — will be updated before that happens.

## Part B — Acceptable Use

### 4. Permitted Use

You may use the Service to create, manage, and transmit your own business documents, within the scope
of your subscription, as described in the Terms of Service.

### 5. Prohibited Uses

You must not use the Service to:

- act unlawfully, or to create or transmit a document you know to be fraudulent or deceptive;
- attempt to breach, probe, or disrupt the Service's security or infrastructure, including
  unauthorized penetration testing or denial-of-service activity;
- circumvent or interfere with the hosted Service's own access controls or rate limits, beyond the
  rights the software's open-source license already grants you over the source code itself (Terms of
  Service, Section 11.1);
- send spam or unsolicited bulk communications through the Service's outbound email or transmission
  features;
- resell or sublicense access to the hosted Service to a third party without our written consent;
- upload malware, or content that infringes a third party's intellectual property or other rights.

### 6. Enforcement

A violation of this Part B may lead to suspension or termination of your access, without prejudice to
the suspension and termination provisions of the Terms of Service, Section 13.

### 7. Availability

Availability figures we may publish are **indicative only** and do not constitute a contractual
service level — the same best-effort basis the Terms of Service, Section 16.1 already describes.

## Part C — Public Websites

### 8. No Cookies, No Analytics

Our public marketing website at **invoicerr.app** and our documentation site at **docs.invoicerr.app**
are both static sites served by **GitHub Pages** (GitHub, Inc. — see Privacy Policy, Section 10).
**Neither sets a cookie or loads analytics, advertising, or tracking scripts of any kind.**
docs.invoicerr.app's on-page search index runs entirely in your browser; invoicerr.app's dark/light
theme choice is remembered only in your browser's `localStorage`, never in a cookie. GitHub's own
technical access logs for either site (visitor IP address and request headers, needed to serve the
page — and, for invoicerr.app, the one client-side call to `api.github.com` for the GitHub star count)
are described in the Privacy Policy, Section 10, not here.

## Part D — Governing Language

### 9. English Version Prevails

This document is drafted and executed in English. Where we provide a translation into another
language for your convenience and understanding, that translation is not a substitute for the English
text: in the event of any inconsistency, ambiguity, or conflict between the English version and a
translated version, **the English version prevails** and is the version that governs the rights and
obligations of the parties. Translations are provided in good faith to help each audience understand
this document; they create no separate or additional rights.

---

### Changelog

- **2026-09-16** — Initial draft.
- **2026-09-17** — Updated Terms of Service cross-references to match that document's 2026-09-17
  renumbering (11.1→9.1, 7→11, 10.1→14.1). No other change: this page's cookie disclosure and
  acceptable-use list already matched the `legal-tos-privacy` skill's cookie and AUP checklists, and
  is now also the document the Terms of Service, Section 5 incorporates by reference as its own
  Acceptable Use Policy.
- **2026-09-17** — GitHub added as hosting provider for the documentation website. New Part C
  ("Documentation Website") states that docs.invoicerr.app (GitHub Pages) sets no cookie and loads no
  analytics — verified against `documentation/docusaurus.config.ts`'s plugin list, which carries only
  a local, in-browser search index (`@easyops-cn/docusaurus-search-local`) and no analytics/tracking
  plugin.
- **2026-09-19** — Owner decision: the public website moved to **GitHub Pages** at **invoicerr.app**.
  Part C renamed "Public Websites" and now covers both sites: invoicerr.app is a static marketing page
  with no cookie and no analytics/tracking script, its theme choice kept only in `localStorage`.
- **2026-09-19** — Owner decision, on counsel's advice: this document is now translated into French in
  full (loi Toubon art. 2). New Part D ("Governing Language") states that the English text is the one
  that governs whenever a translation reads differently — the same clause added to the other four
  documents. No other fact changed.
- **2026-09-19** — Updated Terms of Service cross-references to match that document's 2026-09-19
  renumbering, done to make room for its new EU Data Act sections (9.1→11.1, Section 11→13,
  14.1→16.1). No fact in this page itself changed.
- **2026-09-20** — Correction, following an inventory of what the application actually writes to a
  browser. Part A previously stated that the Service sets "exactly **one** cookie". That was wrong:
  the application's own navigation sidebar also writes a `sidebar_state` cookie (7 days) recording
  whether the sidebar is open or collapsed. Section 1 now lists **both** cookies with their purpose
  and duration — the session cookie's own 7-day, use-extended duration was also never stated — and,
  for the first time, the five values the Service keeps in the browser's local/session storage
  (`i18nextLng`, `vite-ui-theme`, `pwa-install-dismissed-at`, `invoicerr_portal_token`,
  `invoicerr-sw-reloaded`) plus the installable application's own offline asset cache: article 82 of
  loi n° 78-17 of 6 January 1978 governs any writing to or reading from a terminal, not cookies
  alone, so listing only cookies left the disclosure incomplete even where the conclusion was right.
  Section 2's conclusion is **unchanged** — no consent banner is required — but now rests on the two
  exemption grounds that actually carry it (strictly necessary, and a preference set by the user
  themselves) rather than on a single-cookie fact that was not true. No non-exempt technology was
  found: there is still no analytics, advertising, profiling, or audience-measurement technology of
  any kind in the Service.
