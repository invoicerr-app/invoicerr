# Release plan — v2

The shape, decided 2026-09-20: finish the security review, merge, cut an alpha, deploy it on the
real cluster, run a closed free beta, bump through it until the product holds, then release `v2.0.0a`.
Each stage below has a **gate** — the thing that must be true before the next one starts. The gates
are the point of this file; the order is not a preference.

This file is internal, like `AUDIT_VALIDATION.md` next to it. It is not synced anywhere and not
published.

---

## Versioning

| Stage | Tag | Marked pre-release on GitHub |
|---|---|---|
| Alpha series | `v2.0.0-alpha.1`, `v2.0.0-alpha.2`, … | **Yes** |
| First stable v2 | `v2.0.0a` | No |
| Later revisions | `v2.0.0b`, `v2.0.0c`, … | No |

The trailing letter stays what it has always been on the `1.4` line: a revision of the same version
number, not a semver patch. `2.0.0` is kept for the release that marks the rewrite rather than spent
on the alphas, and no stable version of the rewrite is ever numbered as a patch.

**The pre-release checkbox is not cosmetic.** `docker-publish.yml` computes `push-latest` by
comparing the tag being published against what `gh release view` reports as the repository's latest
release; on a match it pushes the image as `:latest`. A release created **without** the pre-release
box ticked can therefore make an alpha image `:latest`, and every self-hosted instance that follows
that tag moves onto it. Tick the box, then open the workflow run and confirm `push-latest=false`
before considering the tag done.

`backend/package.json` and `frontend/package.json` carry placeholder versions (`0.0.1`, `0.0.0`) that
nothing reads. The git tag is the version. Leave them alone or fix them deliberately, but do not
assume they mean anything today.

---

## Stage 0 — Security review, before the merge

**Gate for everything else.** Nothing goes into `main` until this is closed.

This was decided on 2026-09-19 and is restated here because the release plan first drafted around it
left it out. The reason is not discipline: the previous review was removed precisely because it had
been posted against a branch that then moved a very long way — a review of a moving target becomes a
formality. The branch is stable now and every feature is in, which is the only moment a review is
worth what it costs.

Two things go into it rather than being rediscovered:

- the external advisory GHSA-g76v-ff9h-j6r2, and
- the fact that the whole backend was already swept for that advisory's defect class on 2026-09-19
  with no finding, so the review's value there is schema-level defence in depth and any surface added
  since.

**This is the owner's to launch** (`/code-review ultra` on the branch) — it cannot be started from a
session.

## Stage 1 — Merge and cut `v2.0.0-alpha.1`

Gate: Stage 0 closed and its findings fixed.

- Merge the branch into `main`.
- Tag `v2.0.0-alpha.1`, create the GitHub release **with the pre-release box ticked**, confirm
  `push-latest=false` in the workflow run.

## Stage 2 — First deploy on the real cluster

Gate: an alpha image published.

This is the milestone `TODO_FEATURES.md` calls "first real cluster deploy", and it waits on Scaleway.
Still missing at the time of writing: the object-storage bucket, the managed database, DNS for
`invoicerr.app`, and the real secrets.

**Proof that closes it**: a deploy on the cluster, `/api/health` answering, and one invoice sent
through it.

If the Scaleway Founders decision drags, this stage is what waits — not Stages 0 and 1. The floor
cost of the cluster is known and small enough to start without the grant if the wait becomes the
thing holding the release.

## Stage 3 — Closed, free beta

Gate: Stage 2's proof, and the security review closed — no outside person gets an account before that.

Beta testers are real people putting their own clients' data in. Three items that are theoretical
while the product has no users stop being theoretical the day the first tester signs up:

- **`BACKUP_ENCRYPTION_KEY` set, and stored somewhere that survives the loss of the server it
  protects.** Losing it loses every backup, permanently. This must exist *before* the first record
  does, not after.
- **The Article 30 record of processing activities**, both roles — controller and processor.
- **The personal-data-breach procedure**: detection, the 72-hour clock, who notifies the CNIL, how
  customers are told, where it is logged.

Also worth having before the first tester rather than after: an uptime alert on `/api/health`.

The beta is free, so no production Polar organisation is needed to start it, and the legal documents
can still carry their draft banner — a closed, free beta among people the owner knows is not the
situation the audit warned about.

Bump `v2.0.0-alpha.N` through the beta as fixes land, each one a pre-release.

## Stage 4 — Before the first euro

Gate: the beta says the product holds.

The line is drawn at the first payment, not the first user. Everything here must be true before
anyone pays:

- **The lawyer's scoped review is back**, and the `:::warning Draft` admonition is removed from all
  seven documents **and their translations**, followed by `npm run legal:sync`. That edit moves every
  document's content hash and re-prompts every user for acceptance — spend that prompt once,
  deliberately. The eight questions to put to the lawyer are written out in the owner's own list.
- **The production Polar organisation** exists and matches the sandbox: prices in USD, VAT handled by
  Polar as merchant of record, tax-ID collection on, per-seat tiers matching the pricing page.
- **One or two volunteer testers subscribe for real**, on the production organisation. This is the
  only way the payment chain — checkout, renewal, a failed payment, the end of a subscription — is
  proven in production without discovering it on the first paying customer.
- The advisory GHSA-g76v-ff9h-j6r2 has its patched version set to the v2 tag, ready to publish.

## Stage 5 — `v2.0.0a`

Gate: Stage 4 complete and the real subscriptions behaving.

Tag `v2.0.0a`, release **without** the pre-release box, which is what makes the image `:latest` and
what moves self-hosted instances onto v2. Publish the advisory at that moment, crediting the reporter.

---

## Decisions this file records

Taken 2026-09-20, each against the alternatives that were on the table:

1. **The security review happens before the merge**, not on the deployed alpha.
2. **`v2.0.0-alpha.N` then `v2.0.0a`** — the existing letter convention kept, `2.0.0` not spent on
   the alphas.
3. **The beta is free**, with one or two volunteers moving to real payment before the opening.
4. **The lawyer's review lands before the first payment**, not before the first tester.
