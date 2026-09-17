---
sidebar_position: 0.7
---

# Instance File Backup

Invoicerr can periodically copy every document-related file it stores to a dedicated, secondary S3
bucket — disaster-recovery insurance on top of whatever already stores those files day to day.

## What it covers, and what it does not

Copied, when enabled:

- **Legal archives** — the signed PDFs and audit trail every sent invoice/quote/credit note
  produces, wherever they currently live (a local disk directory, or the primary
  `ARCHIVE_STORAGE=s3` bucket if you use one — see the [Kubernetes guide](./kubernetes.md)).
- **Received-invoice uploads, expense attachments, and company logos** — everything stored under
  `DOCUMENTS_INBOUND_DIR`.

Not covered:

- **The database.** Postgres has its own backup story (continuous/point-in-time backups on a
  managed provider like Neon, or your own `pg_dump`/WAL archiving on a self-managed instance) —
  this feature never touches it.
- **Restoring.** This feature only ever writes to the backup bucket; there is no "restore" button
  or command. Recovering from it is an operator action against the bucket directly (e.g.
  `aws s3 sync s3://<backup-bucket>/ ./restored/`, or your S3-compatible provider's own mirroring
  tool).

## Enabling it

Unset by default — with no `BACKUP_S3_BUCKET`, the feature is entirely inert (no scheduled job, no
`GET /api/backup/status` route). Set these on the backend (`.env`, or the Helm chart's own `backup.*`
values — see `deploy/helm/invoicerr/values.yaml`):

| Variable | Required | Description |
| --- | --- | --- |
| `BACKUP_S3_BUCKET` | Yes | The destination bucket. Setting this is what turns the feature on. |
| `BACKUP_S3_REGION` | Yes | e.g. `fr-par` (Scaleway), `us-east-1` (AWS/MinIO). |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Yes | Credentials scoped to this bucket — never reuse an admin-level key. |
| `BACKUP_S3_ENDPOINT` | No | Only for an S3-compatible provider other than AWS (e.g. `https://s3.fr-par.scw.cloud`). |
| `BACKUP_S3_FORCE_PATH_STYLE` | No | `true` for providers/gateways that need path-style addressing (some MinIO setups). |
| `BACKUP_S3_PREFIX` | No | Every object is written under `<prefix>/…` when set — useful to share one bucket across several instances. |
| `BACKUP_S3_SCHEDULE` | No | Cron expression, evaluated in UTC. Default: `0 3 * * *` (daily at 03:00 UTC). |

Use a **bucket separate from `ARCHIVE_S3_BUCKET`** (the primary legal-archive store, if you use one)
— the whole point is a copy that survives the loss of whatever backs the primary store.

## How it runs

A single, cluster-wide scheduled job (BullMQ, not a per-pod cron) wakes up on `BACKUP_S3_SCHEDULE`
and walks every file described above. Each file's own destination key already encodes its content
hash, so:

- a file already present at the destination, at the same size, is skipped — a re-run only ever
  copies what is new or changed since the last one;
- one file failing to copy (a transient network error, for example) is recorded and the sweep
  continues with the rest — it never aborts the whole run.

## Checking status

`GET /api/backup/status` (company **Owner** role required) returns the last completed/failed run —
file counts and bytes copied, never per-file detail — plus the configured schedule and when the next
run is due. Any company's Owner can reach this route (there is no narrower instance-operator role in
this app), so the response only ever carries counters and timestamps: a failed file's own object key
and error message would otherwise expose another tenant's identifiers, and those stay in the database
for whoever has direct access to it. There is no manual "run now" trigger; the schedule above is the
only way a sweep starts.
