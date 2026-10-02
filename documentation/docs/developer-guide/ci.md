---
sidebar_position: 14
---

# Continuous Integration

This page documents the parts of `.github/workflows/` a contributor is likely to run into, beyond
the test suites already covered in `CLAUDE.md`'s own CI section.

## Docker image vulnerability scanning (Trivy)

Every image this repository builds and pushes gets scanned for known OS package and Node
dependency vulnerabilities with [Trivy](https://trivy.dev):

- `docker-dev.yml` scans the `dev-...` tag right after pushing it to `ghcr.io`.
- `docker-publish.yml` scans the release (or `:test-workflow`) manifest right after it is created.
- `trivy.yml` builds the Dockerfile locally (never pushed) on a pull request that touches the
  Dockerfile or either of the two workflows above, so a change to the build gets a scan before it
  reaches `dev`.

Each scan runs twice:

1. A full report, every severity, uploaded as SARIF to the repository's **Security** tab
   (`Security` > `Code scanning`). This is informational: nothing in it fails the build.
2. A gate restricted to `CRITICAL` findings with a known fix (`ignore-unfixed: true`). Only this
   second run can fail the job.

:::info[The gate starts narrow on purpose]
Only fixable CRITICAL findings fail CI today. A finding with no available fix would fail every
run forever with nothing anyone could do about it, so it is reported but not gated. Widening the
gate to HIGH, or dropping `ignore-unfixed`, is a deliberate follow-up once the current baseline of
findings is known and triaged, not something to do by just editing the `severity` input.
:::

