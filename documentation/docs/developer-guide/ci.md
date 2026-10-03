---
sidebar_position: 14
---

# Continuous Integration

This page documents the parts of `.github/workflows/` a contributor is likely to run into, beyond
the test suites already covered in `CLAUDE.md`'s own CI section.

## Release notes and the Discord announcement

`.github/release.yml` groups pull requests into the categories GitHub's "Generate release notes"
uses, by label: Features (`feature`), Fixes (`bug`), Per-country compliance (`compliance`),
Documentation (`documentation`), Dependencies (`dependencies`), and everything else under Other
Changes.

:::info[This only works once pull requests carry these labels]
As of this page's last update, merged pull requests in this repository did not carry labels, so
every entry lands in "Other Changes" until that changes. Label a pull request with one of the five
above (or leave it unlabeled for "Other") before it merges if you want it to show up under the
right heading in the next release's notes.
:::

## DCO check

`dco.yml` runs on every pull request targeting `dev` or `main`. It reads the pull request's commits
through the GitHub API and fails if one of them (other than a merge commit or a bot commit) has no
`Signed-off-by` line matching its author, as required by
[`CONTRIBUTING.md`](https://github.com/invoicerr-app/invoicerr/blob/dev/CONTRIBUTING.md).
The failing run names each offending commit; fix it with `git rebase --signoff <base-branch>` and a
force-push.

:::info[Not required by branch protection]
This check runs and reports, but a pull request can still be merged while it is red until branch
protection is updated to require it.
:::

`release-discord.yml` posts a short summary of every published **pre-release** to the Discord
announcements channel, through a webhook kept as the `DISCORD_RELEASES_WEBHOOK` repository secret.
A full release (the pre-release checkbox left unticked) never posts here; see
`docker-publish.yml` for why only an unchecked pre-release box is what ships an image to
`:latest`, which this workflow does not touch.

Without the secret configured, the workflow logs a notice and skips cleanly rather than failing
the run. `workflow_dispatch` can simulate a pre-release publish (with made-up release details) to
exercise that skip path, or the real posting once the secret is set, without waiting for an actual
release.
