---
sidebar_position: 3
---

# Account & Team

## API Keys

Generate and manage API keys for programmatic access. Each key can be named and revoked independently.

## Account

Your personal account settings: name, email, password, and profile preferences.

## Invitations

Invite team members to your instance. Enter their email and assign a role. Pending and accepted invitations are listed here.

The full invitation code is shown **once**, in the create panel, and copied to the clipboard. The
database keeps only a keyed digest of it, so the list below shows the first eight characters as a
label and cannot hand the code back: if it is lost, delete the invitation and generate a new one.

Codes are digested with a key derived from `BETTER_AUTH_SECRET` (or `JWT_SECRET` when that is the
only one set). Changing that secret therefore invalidates every pending invitation at the same time
it invalidates every session — issue new codes after rotating it. Codes created before an upgrade
keep working: the first time one is presented, it is digested in place.
