# Security Policy

## Reporting a vulnerability

Report privately — never through a public GitHub issue, pull request, or discussion. A vulnerability
posted in the open before a fix exists puts every self-hosted instance still on the affected version
at risk.

- **Preferred**: open a
  [GitHub private security advisory](https://github.com/invoicerr-app/invoicerr/security/advisories/new).
  It reaches the maintainer directly, lets you attach a proof of concept without exposing it, and gives
  both sides a single thread to follow up on.
- **If GitHub isn't an option for you**: email **contact@invoicerr.app** — the same address every
  other document in this repository (Terms of Service, Privacy Policy, Data Processing Agreement,
  `CONTRIBUTING.md`) already lists as the maintainer's own contact. It is not a new inbox created for
  this policy.

Include what you have: the affected version or commit, the component (backend, frontend, a specific
transmission channel, the Docker image, the Helm chart…), reproduction steps, and the impact you
believe it has. A working proof of concept shortens triage considerably; a report that only names a
symptom may take longer to confirm.

## What to expect

Invoicerr is maintained by one person, not a security team — there is no 24/7 desk and no vendor SLA
to point to, so the commitment below is one that can actually be kept rather than one that reads well:

- **Acknowledgment within 5 business days** of your report.
- **An initial read on it** in that same reply, where possible: confirmed, not reproducible, or needs
  more information from you.
- **A decision, communicated back to you once made** — a patch, a mitigation, or a documented decision
  not to patch a given release line (see below) — rather than silence after the acknowledgment.

There is no committed fix-by date. Severity, what the fix touches, and what else is already in flight
all change how long a real fix takes; a promised date that then slips would be worse than none.

## Scope

**In scope:**

- This repository's backend, frontend, and end-to-end test infrastructure, as shipped in the published
  Docker image and Helm chart — self-hosted or on the hosted offering.
- The document engine and the national transmission integrations under
  `backend/src/modules/documents/` (KSeF, the French PDP, SdI, Chorus Pro, e-mail).
- Anything that lets one Company (tenant) read or affect another Company's data — multi-tenancy is a
  hard boundary, self-hosted or hosted.

**Out of scope:**

- A vulnerability in a third-party dependency that has nothing to do with how Invoicerr uses it —
  report it upstream. Dependencies are kept up to date, but a CVE in a transitive package with no
  reachable path from this code isn't a finding about this project.
- The infrastructure of a sub-processor (Scaleway, Cloudflare, Resend, Google, the national e-invoicing
  platforms) — each runs its own security program; see the Data Processing Agreement for who they are.
- The marketing site at invoicerr.app: it lives in a separate repository
  ([invoicerr-app/landing](https://github.com/invoicerr-app/landing)) — report it there.
- Social engineering, physical access, and denial-of-service by sheer volume rather than a logic flaw.
- A finding that only exists because a documented security-relevant setting was left at an unsafe
  default — the boot process already refuses to start on a known example `BETTER_AUTH_SECRET`, for
  example; a report that a service is exploitable when that guidance is deliberately ignored isn't a
  new finding.

## Known unpatched issue on the current release line

**GHSA-g76v-ff9h-j6r2** (medium severity) was reported through the private channel above and confirmed.
It affects the currently published release line (the `v1.4.x` tags). The fix depends on a change that
only lands with the next major version, currently in development, and is **not** being backported to
1.x.

If you run a `v1.x` self-hosted instance today, this issue affects it until you upgrade once the next
major version ships — there is no interim patch planned for the 1.x line. Detail beyond what's stated
here is available on request through the same reporting channel while the advisory itself isn't yet
public.

This section exists because a security policy that stays silent about a known, deliberately-unpatched
issue on the version people are actually running would not be much of a policy — see the project's own
[breach-response procedure](./documentation/internal/BREACH-RESPONSE-PROCEDURE.md) for how a report
like this one is handled operationally once personal data, rather than just code, is what's at risk.

## Supported versions

There is no long-term-support branch and no backport policy: only the latest tagged
[release](https://github.com/invoicerr-app/invoicerr/releases) is supported. A report against an older
tag will be asked to reproduce on the latest one first, since that's the only version fixes ever land
on.

## Credit

Reporters are credited, by name or handle, in the published advisory and/or the release notes for the
fix — unless you'd rather stay anonymous. Say which you prefer in your report.
