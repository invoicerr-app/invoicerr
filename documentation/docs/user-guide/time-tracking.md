---
sidebar_position: 4.5
---

# Time Tracking

**Time Tracking** lets you log billable hours against a client's projects, then turn a batch of
unbilled entries into a draft invoice in a couple of clicks — with a guarantee that no entry is ever
billed twice.

## Projects

Hours are logged under a **project**, and every project belongs to one client — so an agency running
two engagements for the same client can track and bill them separately.

- **New project** — create one under a client: **Name**, an optional **Description**, and an
  optional default **Hourly Rate** used for entries that don't set their own.
- **Archive** / **Unarchive** — a project has no delete. Archiving hides it from new time entries
  while keeping every entry it has already billed.

## Logging time

Select a project, then **Log time**:

- **Date** and **Duration** (in hours, in quarter-hour steps)
- An optional free-text **Description**
- An optional **Hourly Rate** override for this entry alone (otherwise the project's own rate
  applies)
- **Billable** — uncheck it for time you want on record but never charged; a non-billable entry is
  shown as such and can never be selected for invoicing

An entry can be freely edited or deleted right up until it's billed.

## Billing entries into an invoice

Select one or more unbilled, billable entries and click **Generate invoice**, then confirm in the
dialog. Invoicerr creates one **draft invoice** — never sent automatically — with:

- One invoice line **per entry**, never merged, even for entries on the same project and day.
- A description built from the project's name and the entry's own description (just the project
  name if the entry has none).
- **Quantity** in hours (the logged duration, converted from minutes).
- **Unit price** from the entry's own rate, or the project's default rate if the entry didn't set
  one.

The VAT rate is deliberately left blank on every generated line — a time entry carries no VAT rate
of its own to copy, so you set it once on the draft, exactly as you would on a hand-typed line. If
any selected entry has no rate at all — no override and no project default — billing is refused and
you're told which entries need one first.

## Once billed

A billed entry shows a **Billed** badge and loses its edit and delete controls: it becomes
permanent history, kept even if you later change the project's rate. If two billing attempts race —
for instance the same entries submitted twice — only the first succeeds; the second is rejected
outright, and no duplicate invoice is ever created.

## What it won't do

- **No timer.** Time is logged as a date and a duration you enter — there's no start/stop clock.
- **No expense tracking.** This tracks time only, not costs, materials, or mileage.
- **No per-project currency.** Rates are always in the company's own currency.
- **No reporting or analytics.** Beyond the plain project and entry lists, there's no chart, export,
  or utilization view.
- **No per-person assignment.** An entry isn't attributed to a particular team member.

## First use

Create your first project under a client, log a billable entry against it, then select it and click
**Generate invoice**.
