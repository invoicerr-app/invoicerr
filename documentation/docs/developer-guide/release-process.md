---
sidebar_position: 15
---

# Release process

A release is four things that must happen in order: a merge of `dev` into `main`, a pre-release on
GitHub, an image on ghcr.io, and for an alpha, a bump of the public demo. The order is what the
steps below protect: the demo must never point at a tag that does not resolve, and a release that is
not flagged pre-release moves `:latest` for every self-hoster.

The version number lives in exactly one place that ships: the tag. The chart's `appVersion` in
`deploy/helm/invoicerr/Chart.yaml` is metadata only (the demo and the beta pin `image.tag` themselves)
and currently lags at `2.0.0-alpha.5`. The four npm projects carry placeholder versions and are not
bumped by a release.

## 1. Preflight

Run this from an up to date `dev` clone. Every line has a single expected answer.

```bash
git fetch origin
# 1. The sprint this release closes has no open issue left.
gh issue list --milestone "Sprint 4" --state open
# 2. Every required check on dev is green.
gh run list --branch dev --limit 20 --json name,conclusion \
  --jq '.[] | select(.conclusion != "success")'
# 3. The tag does not exist yet. Reusing a tag is never correct.
git ls-remote --tags origin 'refs/tags/v2.0.0-alpha.N'
```

An open sprint issue is a blocker, not a note: the release notes and the demo walkthrough are written
against a closed sprint. Move it out of the milestone with a reason, or wait.

Write the release notes draft at `.github/release-notes/v2.0.0-alpha.N.md` before the next step (see
step 3). The first line of the file is an HTML comment with the draft status, which the changelog
pipeline drops.

## 2. Merge `dev` into `main`

Open a pull request titled `dev to main: v2.0.0-alpha.N`, base `main`, head `dev`. It goes through
the merge queue like any other: a maintainer approves it, and the required checks run again on the
queue branch. No direct merge, and no `--admin`.

Nothing else changes on `main`. The release is tagged by the next step, not by a commit on `main`.

## 3. Publish the pre-release

```bash
gh release create v2.0.0-alpha.N \
  --target main \
  --title v2.0.0-alpha.N \
  --notes-file .github/release-notes/v2.0.0-alpha.N.md \
  --prerelease
```

:::danger[Always `--prerelease` for an alpha]
`docker-publish.yml` publishes `:latest` when the tag it builds is the repository's latest release.
A release created without the pre-release box ticked becomes that latest release, so `:latest` moves
to an alpha and every self-hoster running `:latest` is upgraded to it. The pre-release box is the
only thing that prevents this.
:::

The notes file is the curated part: highlights, upgrade warnings, and anything generated notes cannot
say. `gh release create --generate-notes` (or the "Generate release notes" button) produces the pull
request list; merge that list into the file before publishing rather than after.

## 4. Wait for the image

`docker-publish.yml` runs on the release event: it builds `linux/amd64` and `linux/arm64` by digest,
then a `merge` job creates the manifest list at the release tag.

- The release is not usable until that manifest exists. A `docker pull` before then answers
  `manifest unknown`.
- The Discord announcement is the last job of that same workflow (`announce`, `needs: [prepare, merge]`),
  so it can only post after the manifest exists, and it does not post at all when a build or the
  manifest failed.
- Read the run's summary before announcing anything anywhere else:

```bash
gh run list --workflow docker-publish.yml --limit 5
docker buildx imagetools inspect ghcr.io/invoicerr-app/invoicerr:v2.0.0-alpha.N
```

If the build failed, the tag now exists on GitHub and no image does. Fix the cause and re-run the
workflow for that tag rather than deleting and recreating the release.

## 5. Bump the demo

The demo lives in the private `invoicerr-app/invoicerr-infra` repository. Two files change together,
because the reset Job runs the same build as the app:

- `environments/demo/invoicerr.yaml`: `spec.values.image.tag`.
- `environments/demo/demo-reset.yaml`: both `@sha256:` image references, to the new release's digest.

Get the digest from the manifest list:

```bash
docker buildx imagetools inspect ghcr.io/invoicerr-app/invoicerr:v2.0.0-alpha.N \
  --format '{{.Manifest.Digest}}'
```

`demo-reset.yaml` also documents why the two references must match, and the demo README explains the
rest. Merge the infra pull request, then reconcile:

```bash
infra-tui env reconcile demo --fix-immutable
```

`--fix-immutable` is needed whenever the reset Job's image changes: a Job template is immutable, so
Flux cannot update `demo-reset-initial` in place and the Kustomization stays stuck until the Job is
deleted. Confirm the one-shot reset went green, then check the demo answers:

```bash
kubectl -n demo get job demo-reset-initial
curl -s https://demo.invoicerr.app/api/health
```

## 6. Close the release issue

The release issue stays open until the owner has walked the sprint's changes on
`https://demo.invoicerr.app` and confirmed. Closing it before that walkthrough is what loses the
"does it actually work" half of the release.

## Rollback

Tags and releases are cheap to leave alone and expensive to move: a tag that has been pulled is
cached by everyone who pulled it. To roll back a bad alpha:

1. Do not delete or move the tag.
2. Point the demo back at the previous release's tag and digest in `invoicerr-infra`, then reconcile
   with `--fix-immutable` as above. That is the only deployment this repository's releases control.
3. Publish a new pre-release with the fix. The bad one stays published and flagged pre-release, which
   is what keeps `:latest` from pointing at it.
