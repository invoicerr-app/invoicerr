---
sidebar_position: 5
---

# Logs & Danger Zone

## Logs

Live application logs, streamed as they happen — filter by date range or category, search, and open
any entry for its full detail (timestamp, level, category, message, user ID, request path). This is
a technical log stream, not a plain-English "who did what" audit trail.

### What is redacted

Every line is filtered before it is written, whether it goes to this screen or to the container's
stdout. Email addresses, invitation codes, bearer tokens and passwords, API keys, IBAN/BIC, phone
numbers and request bodies are replaced with `[redacted]`, `[redacted-email]` or
`[redacted-secret]`. The filter works on the key name as well as on the text, at any depth, so
`details: { password }` is caught even when its value looks ordinary. What remains is the context an
incident needs: path, status code, level, category, user and company ids, provider names, counts.

Two consequences worth knowing. A log line that used to show a client's email address now shows
`[redacted-email]`, so support questions are answered from the client record, not from the log. And
redaction is a safety net, not a licence to log personal data: if a line looks useless because it is
redacted, remove the value from the call site instead of widening the filter.

There is no third-party error tracker (no Sentry, no GlitchTip) connected to this application: the
only sinks are the `Log` table and stdout. If you add one, feed it the same filtered values, never the
raw exception object.

## Danger Zone

Every action below sends a verification code to your e-mail first; nothing is touched until you
enter it.

### Transfer ownership

Hand the **Owner** role of this company to another Invoicerr account. The recipient must already
have one — enter their e-mail, confirm with the code sent to yours, and the request is sent. You
become an admin the moment they accept. A pending transfer can be cancelled at any time before
that; only one may be in flight at once.

:::danger[Destructive actions]
Everything from here down cannot be undone.
:::

### Reset Company Data

Permanently deletes every document (invoices, quotes, credit notes, expenses, received invoices…),
client, article, project, time entry, bank statement/reconciliation, and archived file or
attachment. The company itself, its settings, members, subscription, channels, and e-mail templates
all stay. Requires the e-mail code, then typing **RESET** to confirm. Refused outright if any
document must still be kept under its own country's archiving law — the screen shows the date that
retention lifts.

### Delete Company

Permanently deletes the company, its members, its subscription, its documents, and every setting.
A full export of everything the company held is e-mailed to you first, as your last copy. Requires
the e-mail code, then typing the company's own name to confirm.

### Reset instance

Shown only to an **instance operator** (see [Docker Installation](../docker-installation.md#instance-operators)
for how that role is granted). Deletes every company, user, and document on this entire deployment,
then signs everyone out — not scoped to your own company. Requires the e-mail code, then typing
**RESET INSTANCE** to confirm.
