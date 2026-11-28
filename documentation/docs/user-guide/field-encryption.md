---
sidebar_position: 0.75
---

# Database Field Encryption

Invoicerr can encrypt personal and commercial fields inside the database, so that a stolen database dump,
backup or read replica is unusable on its own. The key that protects those fields is held by OVHcloud KMS
(OKMS) and never leaves it.

:::warning[What it protects, and what it does not]
It protects a stolen database dump or backup. It does not protect a compromised server, an administrator
who holds the key, or data already sent by email or e-invoicing.
:::

The running server decrypts fields to serve requests, render PDFs and send e-invoices, so anyone who
controls the running process can read the data through it. What this feature removes is the readable copy
sitting in every dump, backup, replica and leaked `DATABASE_URL`.

:::info[Current state]
This release ships the encryption layer and its configuration contract: key loading through OKMS at boot,
the refusal rules below, and the cipher itself. No database column is encrypted yet. Each group of fields
(user and contact emails, client names and addresses, bank details, document content) is migrated in a
later release, with its own migration step described in the release notes. Enabling the switch today
validates your KMS setup and keys end to end without changing any stored data.
:::

## Encryption is never forced

With none of the variables below set, Invoicerr runs exactly as before: data in clear text, no KMS call,
no error. `FIELD_ENCRYPTION_ENABLED` is the only switch. Setting the KMS variables without it does nothing.

## How it works

- Each field is encrypted with AES-256-GCM and a fresh random IV. The ciphertext is bound to its table,
  column and row (`Model.column.id` as additional authenticated data): a value copied to another row or
  column fails to decrypt instead of showing someone else's data.
- Stored values look like `v1.<keyId>.<iv>.<ciphertext>.<tag>`. The key id makes rotation possible without
  touching every row at once.
- Envelope encryption: the data keys are stored in your configuration, wrapped (encrypted) by a service key
  in OKMS. At boot, Invoicerr asks OKMS to unwrap them over mutual TLS and keeps them in memory only. There
  is no KMS call per request, and the keys are wiped from memory on shutdown.
- Fields that must be found by exact value (an email at sign-in, for example) also get a blind index: an
  HMAC-SHA256 of the normalised value (trimmed, lower case, inner spaces collapsed), computed with a
  separate key. The index is scoped by company, so two companies can hold the same customer email. The
  exception is a user's sign-in email: one account can belong to several companies, so its index is shared
  by the whole instance and stays unique.
- Encrypted fields cannot be sorted or searched by partial text in SQL. Once a field is migrated, lists
  that sort on it sort the current page in memory.

## Variables

| Variable | Required when enabled | Description |
| --- | --- | --- |
| `FIELD_ENCRYPTION_ENABLED` | | `true` to enable. Default `false`. Any value other than `true` or `false` refuses to start. |
| `OKMS_ENDPOINT` | Yes | Your OKMS REST base URL including the KMS id, for example `https://eu-west-rbx.okms.ovh.net/api/<okms-id>`. Must be `https://`. |
| `OKMS_SERVICE_KEY_ID` | Yes | Id of the OKMS service key that wraps the data keys. |
| `OKMS_CERT_PATH` | Yes | Path to the client certificate (PEM) used for mutual TLS with OKMS. |
| `OKMS_KEY_PATH` | Yes | Path to that certificate's private key (PEM). |
| `OKMS_TIMEOUT_MS` | No | Timeout of each OKMS request, in milliseconds. Default `5000`. Each unwrap is tried 3 times. |
| `FIELD_KEYS` | Yes | Comma-separated list of `keyId:wrappedKey`, for example `k2:<wrapped>,k1:<wrapped>`. Key ids use letters, digits, `_` and `-`, at most 32 characters. Keep old keys listed until every row is re-encrypted. |
| `FIELD_KEY_CURRENT` | Yes | Key id used for new writes. Must appear in `FIELD_KEYS`, otherwise the application refuses to start. |
| `BLIND_INDEX_KEY` | Yes | Wrapped key for the blind indexes. Independent from the data keys, so rotating a data key never forces a reindex. |
| `ALLOW_PLAINTEXT_READ` | No | `true` only during the migration window of an existing instance: plaintext values are still accepted on read while the backfill runs. Logged as a warning at every boot. |
| `FIELD_ENCRYPTION_FORCE_PLAINTEXT` | No | `true` lets the application start with encryption disabled even though encrypted values are stored. See [Disabling](#disabling). |

Keep the certificate and key files out of the image and out of version control, for example as Docker or
Kubernetes secrets mounted read-only.

## Refusal rules

| Situation | Result |
| --- | --- |
| Nothing set | Starts in clear text, no KMS call. |
| Enabled, a variable missing or invalid | Refuses to start and lists every problem at once. |
| Enabled, OKMS unreachable or refusing the certificate | Refuses to start after the retries, naming the key that failed. |
| Enabled, OKMS unreachable after boot | No effect: the keys are already in memory. |
| Disabled while encrypted values are stored | Refuses to start, unless `FIELD_ENCRYPTION_FORCE_PLAINTEXT=true`. |

Writing plaintext while encryption is configured is the one outcome the application never accepts: a
service that does not start is noticed and fixed in minutes, a silent plaintext write is found months
later.

## Enabling

1. In the OVHcloud Control Panel, create an OKMS in the region of your choice, a service key of type
   symmetric, and an access certificate for Invoicerr. Grant that certificate the right to use the service
   key.
2. Generate the data keys and the blind index key as OKMS data keys of 256 bits under that service key
   (`POST /v1/servicekey/<id>/datakey` with `{"name": "...", "size": 256}`), and keep only the wrapped
   `key` value of each answer. Discard the plaintext part.
3. Store the wrapped values in `FIELD_KEYS` and `BLIND_INDEX_KEY`, keep a copy somewhere other than the
   server, set the variables above, and restart. The boot log says how many data keys were loaded and
   which one is current.

### On an existing instance

When a group of fields is migrated in a later release, the path is the same for each group:

1. Deploy the new version with encryption still disabled. Nothing changes.
2. Take a backup and keep the wrapped keys somewhere other than the server.
3. Enable encryption with `ALLOW_PLAINTEXT_READ=true`. Existing plaintext is still readable, every new
   write is encrypted.
4. Run the backfill described in that release's notes. It is batched and can be resumed.
5. Once it reports no plaintext row left, remove `ALLOW_PLAINTEXT_READ` and restart.

Dumps and backups taken before step 4 still contain clear text. Delete or protect them accordingly.

## Rotating keys

**Data key.** Generate a new wrapped data key, add it to `FIELD_KEYS` (for example `k3:<wrapped>,k2:...`),
point `FIELD_KEY_CURRENT` at it and restart. New writes use the new key, existing rows stay readable with
the old one, and the background re-encryption (shipped with the first migrated group of fields) moves them to
the new key without downtime. Remove the old
key from `FIELD_KEYS` only once no row uses it any more: removing it earlier makes those rows unreadable.

**Service key (KEK) in OKMS.** Rotating the service key in OKMS re-wraps nothing by itself. Unwrap each
data key with the old service key and wrap it again with the new one through the OKMS API, replace the
values in `FIELD_KEYS` and `BLIND_INDEX_KEY`, update `OKMS_SERVICE_KEY_ID` and restart. Stored rows are not
touched, since the data keys themselves do not change.

**Blind index key.** This one is not an online operation. Every index value depends on it, so changing it
without reindexing makes every exact lookup return nothing: sign-in by email stops finding accounts, and
nothing errors. It needs a planned window with old and new indexes side by side and a full reindex. Do not
change `BLIND_INDEX_KEY` on its own.

**Access certificate.** OKMS certificates expire. Create the new certificate in OKMS before the old one
expires, grant it the same rights, replace the files at `OKMS_CERT_PATH` and `OKMS_KEY_PATH`, and restart.
A running instance keeps working with an expired certificate, since it only talks to OKMS at boot, but its
next restart will fail. Monitor the expiry date.

## Backup and restore

- **With encryption enabled**, a backup contains ciphertext. Restoring it needs the same wrapped keys and
  access to the OKMS service key. Test a restore into a throwaway instance with your real KMS setup before
  you rely on it.
- **Without KMS access**, encrypted data cannot be read, by anyone, including you. This is key custody, not
  a defect: losing both the wrapped keys and the OKMS service key means the encrypted fields are gone.
  Keep a copy of the wrapped keys outside the server, and make sure more than one person can reach the OKMS
  account.
- **With encryption disabled**, backups are clear text, so protect the backup files themselves, for example
  with the encryption described in [Instance File Backup](./backups.md) and your database backup tool.

## Disabling

Setting `FIELD_ENCRYPTION_ENABLED=false` on a database that holds encrypted values would serve ciphertext
as if it were data. The application therefore refuses to start in that case. To leave encryption for good,
decrypt every value first, then set `FIELD_ENCRYPTION_FORCE_PLAINTEXT=true` together with
`FIELD_ENCRYPTION_ENABLED=false`. That switch skips the check entirely: use it only once you are certain no
encrypted value is left.

## For developers

The layer lives in `backend/src/lib/field-encryption/` and imports nothing from Prisma, so the persistence
integration can change without touching the cryptography.

- `config.ts` parses and validates the variables above.
- `okms-client.ts` unwraps data keys over mutual TLS, with a per-request timeout and retries on network
  errors and 5xx answers only.
- `field-cipher.ts` is the envelope (`encrypt`, `decrypt`, `needsRotation`, `reEncrypt`) and the blind index
  (`blindIndex` with `companyIndexScope` or `globalIndexScope`).
- `boot.ts` applies the refusal rules from `main.ts` and `worker.ts`, holds the cipher returned by
  `getFieldCipher()`, and lists the encrypted columns in `ENCRYPTED_COLUMNS`. Add each migrated column
  there so that disabling encryption is refused while it holds ciphertext.
