---
sidebar_position: 14.5
---

# Release process

A release is a tag: a beta or rc tag on `dev`, a stable tag on `main`, and the two workflows that the
tag push starts. The order below is what keeps that safe. A tag that is not CalVer publishes nothing,
a pre-release never moves `:latest`, and the demo is only bumped once the image exists.

Releases use CalVer: `AA.M.N`, where `AA` is the two-digit year, `M` the month without a leading zero,
and `N` a counter that restarts at zero every month. `26.11.0` is the November 2026 release,
`26.11.1` its first hotfix, and pre-releases are `26.11.0-beta.1` and `26.11.0-rc.1`. SemVer tags such
as `v2.0.0-alpha.7` are refused on purpose by both workflows below. The channel rules (`latest`,
`beta`, `nightly`) and the monthly cycle are in `CONTRIBUTING.md`, under "Releases and versioning".

The tag is the only version that ships. `release.yml` creates the GitHub release from it and
`docker-publish.yml` builds the image. The `package.json` files of `backend/`, `frontend/` and
`documentation/` carry the next CalVer release (`26.11.0`) for display, and the chart's `appVersion`
in `deploy/helm/invoicerr/Chart.yaml` is metadata: no release step rewrites either, and the demo and
the beta pin `image.tag` themselves.

## 1. Preflight

Run this from an up to date `dev` clone. Every line has a single expected answer.

```bash
git fetch origin
# 1. The sprint this release closes has no open issue left.
gh issue list --milestone "<sprint>" --state open
# 2. The two aggregators that gate a merge are green on the current dev head.
SHA=$(git rev-parse origin/dev)
gh api "repos/invoicerr-app/invoicerr/commits/$SHA/check-runs?per_page=100" \
  --jq '.check_runs[] | select(.name == "tests-green" or .name == "scenarios-green") | "\(.name): \(.status) \(.conclusion)"'
# 3. The tag does not exist yet. Reusing a tag is never correct.
git ls-remote --tags origin 'refs/tags/26.11.*'
```

Expected output is `tests-green: completed success` and `scenarios-green: completed success`. These are
the fixed-name aggregators branch protection targets; if it ever gates on another check, add it to
the `select`. Runs that are not required checks, such as a scheduled live test or a superseded push,
do not block a release and do not appear here. An open sprint issue is a blocker, not a note: the
release notes and the demo walkthrough are written against a closed sprint. Move it out of the
milestone with a reason, or wait.

Write the curated notes at `.github/release-notes/<tag>.md` before tagging (see step 2). The first
line of the file is an HTML comment with the draft status, which the changelog pipeline drops.

## 2. Tag the pre-release on dev

Cut a beta or an rc on `dev`. The tag push is the release: nothing is created by hand.

```bash
git checkout dev
git pull --ff-only
git tag -a 26.11.0-beta.1 -m "26.11.0-beta.1"
git push origin 26.11.0-beta.1
```

Two workflows start on that push:

- `release.yml` validates the tag. It must be CalVer, and a beta or rc must be tagged on a commit
  contained in `dev` or `main`. It then creates the GitHub release with `--generate-notes` and, for a
  beta or rc, `--prerelease`.
- `docker-publish.yml` validates the same tag, builds both platforms by digest, and creates the
  manifest list at `26.11.0-beta.1`, plus `:beta`. It never touches `:latest`.

There is no `gh release create` step. A release created without pushing a tag builds no image,
because `docker-publish.yml` listens on the tag push and not on the release event, and a hand-made
release for a tag that already exists collides with `release.yml`. A SemVer tag such as
`v2.0.0-alpha.7` fails both validations and publishes nothing.

`release.yml` always generates the release body, including the pull request list, and never reads the
notes file. Once the release exists, paste the curated notes over that body:

```bash
gh release edit 26.11.0-beta.1 --notes-file .github/release-notes/26.11.0-beta.1.md
```

Copy the generated pull request list into the file before editing if it should be kept. Do the edit as
soon as the release appears, before the image build finishes: the Discord `announce` job reads the
release body after the image is published, so it posts whatever body is there at that moment.

## 3. Wait for the image

The release is not usable until the manifest list exists at ghcr.io. A `docker pull` before then
answers `manifest unknown`.

The `merge` job of `docker-publish.yml` creates the manifest list and then scans it with Trivy. Its
`announce` job is last (`needs: [prepare, merge]`), runs only for a beta or rc, and only when `merge`
succeeded, so it can never post a link to an image that failed to build. Read the run before
announcing anything anywhere else:

```bash
gh run list --workflow docker-publish.yml --limit 5
docker buildx imagetools inspect ghcr.io/invoicerr-app/invoicerr:26.11.0-beta.1
```

If the run is red, the tag stays on GitHub and the fix depends on where it failed:

- A failed `prepare` means the tag was refused: nothing was built and no image exists.
- A failed `build` means no manifest list exists for the tag yet.
- A failed Trivy gate means the manifest list and `:beta` already exist. The image is published; fix
  the finding or accept it, then re-run the failed jobs of that run.

Never delete and recreate the tag to recover. Re-run the failed jobs.

## 4. Bump the demo

The demo lives in the private `invoicerr-app/invoicerr-infra` repository. Two files change together,
because the reset Job runs the same build as the app:

- `environments/demo/invoicerr.yaml`: `spec.values.image.tag`.
- `environments/demo/demo-reset.yaml`: both `@sha256:` image references, to the new release's digest.

Get the digest from the manifest list:

```bash
docker buildx imagetools inspect ghcr.io/invoicerr-app/invoicerr:26.11.0-beta.1 \
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

## 5. Promote to stable

Do this at the end of the month, once the beta or rc has been walked on the demo. The stable tag is
cut on `main`, never on `dev`.

1. Open a pull request titled `dev to main: 26.11.0`, base `main`, head `dev`. It goes through the
   merge queue like any other: a maintainer approves it, and the required checks run again on the
   queue branch. `main-promotion-only` refuses a pull request into `main` whose head is not this
   repository's `dev`. No direct merge, and no `--admin`.
2. Tag the merge commit on `main`:

   ```bash
   git checkout main
   git pull --ff-only
   git tag -a 26.11.0 -m "26.11.0"
   git push origin 26.11.0
   ```

`release.yml` creates the stable release without `--prerelease`, and `docker-publish.yml` publishes
the versioned tag and moves `:latest`. That is the step that ships to every self-hoster on `:latest`,
so it only happens after the pre-release was verified. If the demo should track the stable release
rather than the beta, bump it again with step 4, using `26.11.0` and its digest. A hotfix is a patch
tag cut on `main` (`26.11.1`) with `main` merged back into `dev` afterwards, as described in
`CONTRIBUTING.md`.

## 6. Close the release issue

The release issue stays open until the owner has walked the sprint's changes on
`https://demo.invoicerr.app` and confirmed. Closing it before that walkthrough is what loses the
"does it actually work" half of the release.

## Rollback

Tags and releases are cheap to leave alone and expensive to move: a tag that has been pulled is
cached by everyone who pulled it. To roll back a bad beta or rc:

1. Do not delete or move the tag.
2. Point the demo back at the previous release's tag and digest in `invoicerr-infra`, then reconcile
   with `--fix-immutable` as above. That is the only deployment this repository's releases control.
3. Publish the next pre-release (`26.11.0-beta.2`) with the fix. The bad one stays published and
   flagged pre-release, which is what keeps `:latest` from ever pointing at it.
