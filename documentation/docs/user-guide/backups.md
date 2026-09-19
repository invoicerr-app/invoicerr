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

- **The database.** Postgres has its own backup story (automated backups and snapshots on a managed
  provider like Scaleway, or your own `pg_dump`/WAL archiving on a self-managed instance) — this
  feature never touches it. If you run your own `pg_dump`, see "Encrypting a manual database dump"
  below — the same encryption this feature applies to files is available as a standalone command for
  exactly that dump.
- **Restoring, as a button in this application.** This feature only ever writes to the backup
  bucket; there is no "restore" click inside Invoicerr. Recovering from it is an operator action
  against the bucket directly — see "Restoring" below for the exact steps, including decryption.

## Every artifact is encrypted before it ever leaves the instance

Holding `BACKUP_S3_*` credentials (a leaked access key, a misconfigured bucket policy, a departing
contractor who kept a copy) is **not** enough to read a backup. Every file is encrypted with
AES-256-GCM, streamed straight from its source through encryption and into the upload — the instance
never writes plaintext to the bucket, and never holds a whole artifact in memory to do it.

This is a separate protection from your storage provider's own "server-side encryption at rest",
which most S3-compatible providers already apply automatically: that protects against someone
stealing the physical disk in the provider's datacentre, using a key the PROVIDER holds. It does
nothing against a leaked access key, because the provider decrypts transparently for anyone who
authenticates — which is exactly how an attacker with stolen credentials would read the bucket. The
encryption described here uses a key **the storage provider never sees**, generated and held only by
you.

This distinction also matters for GDPR breach-notification obligations: personal data that leaks
still encrypted under a key the attacker never obtained is generally not a reportable breach to the
individuals concerned, while personal data readable straight off a leaked storage credential is. A
provider's own at-rest encryption does not change that analysis (the provider, and by extension
whoever holds valid credentials, can already read the data) — encryption under a key you alone hold
does.

## Enabling it

Unset by default — with no `BACKUP_S3_BUCKET`, the feature is entirely inert (no scheduled job, no
`GET /api/backup/status` route). Set these on the backend (`.env`, or the Helm chart's own `backup.*`
values and `existingSecret` — see `deploy/helm/invoicerr/values.yaml`):

| Variable | Required | Description |
| --- | --- | --- |
| `BACKUP_S3_BUCKET` | Yes | The destination bucket. Setting this is what turns the feature on. |
| `BACKUP_S3_REGION` | Yes | e.g. `fr-par` (Scaleway), `us-east-1` (AWS/MinIO). |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Yes | Credentials scoped to this bucket — never reuse an admin-level key. |
| `BACKUP_ENCRYPTION_KEY` | Strongly recommended | The encryption key described above. `openssl rand -hex 32`. Without it, **every sweep fails** (see below) — backups are never uploaded unencrypted. |
| `BACKUP_S3_ENDPOINT` | No | Only for an S3-compatible provider other than AWS (e.g. `https://s3.fr-par.scw.cloud`). |
| `BACKUP_S3_FORCE_PATH_STYLE` | No | `true` for providers/gateways that need path-style addressing (some MinIO setups). |
| `BACKUP_S3_PREFIX` | No | Every object is written under `<prefix>/…` when set — useful to share one bucket across several instances. |
| `BACKUP_S3_SCHEDULE` | No | Cron expression, evaluated in UTC. Default: `0 3 * * *` (daily at 03:00 UTC). |

Use a **bucket separate from `ARCHIVE_S3_BUCKET`** (the primary legal-archive store, if you use one)
— the whole point is a copy that survives the loss of whatever backs the primary store.

`BACKUP_ENCRYPTION_KEY` must also be **a different value from `CREDENTIALS_ENCRYPTION_KEY`** (the key
that protects channel credentials — KSeF/PDP/SdI tokens — inside the database). They protect
different things with different lifetimes: rotating one must never force rotating the other, and
restoring a backup onto a brand new instance must work with nothing but this key and the backup
files — never the old instance's own credentials key. Generate it the same way
(`openssl rand -hex 32`), but as its own, separate secret.

**Store `BACKUP_ENCRYPTION_KEY` somewhere that survives losing this instance** — a password manager,
a separate vault, printed in a safe, anywhere other than only inside the same Kubernetes Secret or
`.env` file the running instance itself reads from. If that instance and everything on it is what you
are recovering from, the key needs to already exist somewhere else.

**If you leave `BACKUP_ENCRYPTION_KEY` unset**, the feature does **not** silently disable itself the
way a missing `CREDENTIALS_ENCRYPTION_KEY` does for channel credentials — and it does not upload
anything unencrypted either. Every sweep fails immediately, before touching a single file, and is
reported as a `FAILED` run on `GET /api/backup/status`. A backup module exists for disaster recovery,
so a module that goes silently inert IS the disaster nobody notices until the day they need it —
failing loudly, every single time, until the key is set, is the deliberate choice here.

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

## Restoring

There is no "restore" button in this application — recovering a backup is an operator action against
the bucket directly, in two steps: get the object out of the bucket, then decrypt it. **A backup you
cannot decrypt is worse than no backup at all — it buys false confidence.** Test this procedure once,
before you actually need it.

1. **Download the object(s)** with any S3-compatible tool — the AWS CLI, `mc` (MinIO client), or your
   provider's own console — using the `BACKUP_S3_*` credentials. This step needs no code from this
   repository at all:
   ```bash
   aws s3 cp s3://<backup-bucket>/<prefix-if-set>/archive/<...>/pdf.pdf ./pdf.pdf.enc \
     --endpoint-url "$BACKUP_S3_ENDPOINT"
   ```
2. **Decrypt it** with `BACKUP_ENCRYPTION_KEY` and the standalone CLI shipped in this repository
   (`backend/src/modules/backup/backup-crypto-cli.ts`) — a plain Unix filter that reads stdin and
   writes stdout, with no dependency on a running instance, a database connection, or anything else
   about the app that produced the backup:
   ```bash
   cd backend
   BACKUP_ENCRYPTION_KEY=<your key> npm run backup:decrypt < ./pdf.pdf.enc > ./pdf.pdf
   ```
   That is the whole restore path for a file. Repeat per object, or download a whole prefix (`aws s3
   sync`/`mc mirror`) and decrypt each one the same way.

**Losing `BACKUP_ENCRYPTION_KEY` loses every backup encrypted with it — permanently.** AES-256-GCM
has no recovery mechanism and no "forgot my key" option; there is no way to read the ciphertext back
without it, by design (that is also exactly what makes it worth doing). If you lose the key:

- Every backup artifact already uploaded is unrecoverable. Treat that as equivalent to having no
  backup at all for everything encrypted under the lost key.
- Rotate `BACKUP_ENCRYPTION_KEY` to a new value so at least every FUTURE sweep is protected again.
  This does **not** retroactively fix anything already in the bucket: those objects stay exactly as
  they are, still encrypted under the lost key, and the incremental sweep has no way to notice a key
  rotation on its own (an unchanged file, at an unchanged size, is still read as "already backed up"
  — see "How it runs" above). If you need those specific artifacts re-protected, that is a manual
  re-upload (or, for the file sweep, deleting the affected objects from the bucket so the next
  scheduled run treats them as new).
- There is nothing to report to this application — it has no record of the key and cannot help
  recover it. Whatever process you use to store secrets (a password manager, a vault, a printed copy
  in a safe) is the only backstop; store the key there BEFORE you need it, not after.

## Encrypting a manual database dump

The database itself is outside this feature's scope (see above), but if you run your own `pg_dump`
for it, the exact same encryption — same algorithm, same streaming CLI, same `BACKUP_ENCRYPTION_KEY`
— is available as a standalone command, so a hand-run dump does not become the one unencrypted copy
of your data sitting in a bucket or on a laptop. Compress BEFORE encrypting, never after — ciphertext
is indistinguishable from random noise and will not compress:

```bash
cd backend
pg_dump "$DATABASE_URL" | gzip | BACKUP_ENCRYPTION_KEY=<your key> npm run backup:encrypt \
  > "db-$(date +%F).sql.gz.enc"
```

Restoring it:

```bash
cd backend
BACKUP_ENCRYPTION_KEY=<your key> npm run backup:decrypt < "db-2026-09-19.sql.gz.enc" \
  | gunzip | psql "$DATABASE_URL"
```

This can reuse `BACKUP_ENCRYPTION_KEY` (the dump is just another artifact protected by the same key)
or use a key of its own — either is fine as long as it is recorded wherever you keep the key(s) you
used, since decrypting later needs to know which one.
