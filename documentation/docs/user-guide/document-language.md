---
sidebar_position: 5.5
---

# Document Language

Invoicerr renders each invoice, quote, and credit note — its PDF and the email that carries it — in
a language chosen for that document's own recipient, rather than one language fixed for your whole
company.

## Setting a language

Two settings work together:

- **Default document language** — under **Settings → Company**, applies to every client who hasn't
  set their own.
- **Document language** — on a client's own Add/Edit form (the **Clients** page), overrides the
  company default for that one client.

Both offer the same six choices: **Automatic**, English, Français, Italiano, Polski, Deutsch, and
Português. **Automatic** means "use the fallback below" rather than a language of its own.

## How the language is chosen

1. The client's own **Document language**, if they have one set.
2. Otherwise, your company's **Default document language**.
3. Otherwise, the instance's own default — see **Self-hosting a fallback for every company** below.
4. Otherwise, English.

An unrecognised or unset value at any step simply falls through to the next one — nothing is ever
rejected or blocked because of it, and a document you never touch this setting for renders exactly
as it always has, in English (or in the self-hosted instance's own default, once one is set — see
below).

## What changes with the language

- The PDF's own wording around your data: *Status*, *Date*, *Totals*, *Net*, the VAT line, *Total*,
  *Yes*/*No*, the placeholder shown instead of a number on a draft, and the SEPA scan-to-pay caption.
- The built-in subject and body of the covering email for invoices, quotes, and credit notes.

## What never changes

- **Anything you typed yourself.** Line names and descriptions, notes, and payment method names
  print exactly as written, in whichever language you wrote them.
- **The names of document types, fields, and options.** These are plain data you (or a plugin)
  defined, not translatable strings.
- **A custom email template.** If you've written your own subject or body under
  **Settings → Email Templates**, it is sent exactly as you wrote it — the recipient's resolved
  language never overrides your own wording.
- **Country-mandated legal mentions.** Wording a country's tax law requires — a French reverse-charge
  notice, for example — is fixed by statute and tied to your own company's country, never to the
  recipient's language. That mention prints in the language the law wrote it in even when the
  document's own language is set to something else, because the exact wording, not a translation of
  its meaning, is what the law requires.

## Self-hosting a fallback for every company

If you self-host Invoicerr, the `DEFAULT_LOCALE` environment variable sets a fallback for the whole
instance — used only when NEITHER a client NOR its company has set a language of their own. This is
for a deployment that mostly serves one market: a French association running its own Invoicerr, for
example, would otherwise see every never-configured document (and every account-holder email — a
danger-zone confirmation, a data export, an ownership transfer, an email-change confirmation — for a
user who hasn't picked their own language either) in English, purely because nobody happened to fill
in the per-client/per-company field yet.

Set it to one of `en`, `fr`, `it`, `pl`, `de`, or `pt` (see [Docker Installation](./docker-installation.md)
for where to set it). It never overrides a client's, a company's, or a user's own choice — it only
fills the gap below them. Left unset, or set to anything else, nothing changes: every document and
email still renders in English exactly as before.

## First use

There's nothing to configure to keep today's behaviour: every document already renders in English
until you set a language somewhere. Set your company's own default first if you mostly deal with one
other market, then override it per client for the rest.
