---
title: Cookies & Acceptable Use
sidebar_position: 5
version: 2026-09-17
effectiveDate: 2026-09-17
---

:::warning Draft
Draft — not yet reviewed by counsel.
:::

This page covers two topics for the **hosted offering** of Invoicerr: the cookie the Service sets, and
the acceptable-use rules that apply to your account. Neither applies to the self-hosted software.

## Part A — Cookies

### 1. What We Set

The Service sets exactly **one** cookie: the authentication session cookie (`better-auth.session_token`)
created when you sign in, used **solely** to keep you signed in and to associate your requests with
your account and active Company. It is set by our own domain, read by no one else, and carries no
tracking or advertising purpose. **We set no analytics, advertising, or other third-party tracking
cookie.**

### 2. No Consent Banner

Because the only cookie this Service sets is strictly necessary for it to function, it is exempt from
the prior-consent requirement that applies to non-essential cookies under the ePrivacy rules the CNIL
enforces alongside the GDPR — which is why no cookie-consent banner is shown. This is a statement about
what the Service technically sets today; it is not legal advice about your own use of cookies elsewhere.

### 3. Changing This

If a future version of the Service ever adds a cookie or similar technology that is not strictly
necessary, this page — and the consent flow the ePrivacy rules would then require — will be updated
before that happens.

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
  Service, Section 9.1);
- send spam or unsolicited bulk communications through the Service's outbound email or transmission
  features;
- resell or sublicense access to the hosted Service to a third party without our written consent;
- upload malware, or content that infringes a third party's intellectual property or other rights.

### 6. Enforcement

A violation of this Part B may lead to suspension or termination of your access, without prejudice to
the suspension and termination provisions of the Terms of Service, Section 11.

### 7. Availability

Availability figures we may publish are **indicative only** and do not constitute a contractual
service level — the same best-effort basis the Terms of Service, Section 14.1 already describes.

## Part C — Documentation Website

### 8. No Cookies, No Analytics

Our public documentation site at **docs.invoicerr.app** is a static site built with Docusaurus and
served by **GitHub Pages** (GitHub, Inc. — see Privacy Policy, Section 10). It sets no cookie of its
own and loads no analytics, advertising, or tracking script of any kind; its on-page search index runs
entirely in your browser. GitHub's own technical access logs for that site (visitor IP address and
request headers, needed to serve the page) are described in the Privacy Policy, Section 10, not here.

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
