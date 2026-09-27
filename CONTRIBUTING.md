# Contributing to Invoicerr

Thanks for taking the time to contribute. This document covers how to report a bug, propose a
feature, set up the project locally, and get a pull request merged.

## Ways to contribute

### Bug reports

Open a [bug report issue](https://github.com/invoicerr-app/invoicerr/issues/new?template=bug_report.md).
The template asks for reproduction steps, expected behaviour, and your installation method and
version — fill in what applies; the more precise the repro, the faster it gets fixed.

### Feature requests

Open a [feature request issue](https://github.com/invoicerr-app/invoicerr/issues/new?template=feature_request.md)
for something small and self-contained. For anything larger — a new module, a new document type, a
new country's catalogues — start a
[discussion](https://github.com/invoicerr-app/invoicerr/discussions) first. Invoicerr's country
catalogues in particular (`backend/src/modules/documents/**/data/`) carry sourced legal facts with
their own provenance; agreeing on scope and sourcing before writing code avoids a pull request built
on the wrong premise.

### Translations

The interface strings are translated on [Weblate](https://hosted.weblate.org/engage/invoicerr/) —
translate there, not by editing `frontend/src/locales/*` directly. The English catalogue
(`frontend/src/locales/en`) is the source every other language is translated from; if a string is
missing or wrong in English, that's a pull request against the code (see below), not a Weblate change.

### Documentation

The `documentation/` project (Docusaurus) and the top-level `.md` files follow the same pull request
process as code. Every `.md` file in this repository is written in English.

### Code

Bug fixes and features agreed in an issue or discussion. See the setup and conventions below.

## Development setup

Invoicerr is four independent npm projects — there is no workspace root, each has its own
`package.json` and `node_modules`. All commands below run from inside the relevant directory.

### Backend

```bash
cd backend
npm install
npx prisma generate      # required before build/test — client lands in prisma/generated/prisma,
                          # gitignored, needs DATABASE_URL, so .env has to exist first
npm run start:dev        # watch mode, :3000
```

Copy `backend/.env.example` to `backend/.env` and fill in the values it documents — each one lists
its default and where that default lives. PDF generation needs a Chromium/Chrome binary: outside the
Docker image nothing provides one automatically, so run `npx playwright-core install chromium` once,
or point `CHROMIUM_EXECUTABLE_PATH` at a browser you already have.

Redis is required for the backend to boot at all (the document-action queue); `docker-compose.dev.yml`
at the repo root starts Postgres, Redis and Mailpit together for local development.

### Frontend

```bash
cd frontend
npm install
npm run dev               # :5173
```

Copy `frontend/.env.example` to `frontend/.env` if you need to point it somewhere other than the
default backend.

### Running the test stacks

```bash
cd backend && npm run start:test    # loads .env.test — :4000, DB on :5433
cd frontend && npm run start:test   # loads .env.test — :6284, backend at :4000
```

This is what the end-to-end suite expects. Make sure `backend/.env.test` and `frontend/.env.test`
exist (copy the corresponding `.env.example` and adjust) before running it.

### End-to-end tests

Needs the test stack above plus Postgres on `:5433`, Redis on `:6379`, and Mailpit on `:1025`/`:8025`
all reachable.

```bash
cd e2e
npm ci
npm run e2e:run                     # the numbered suites, cypress/e2e/*.cy.ts
npx cypress run --spec "cypress/e2e/21-document-lifecycle.cy.ts"   # a single spec
```

### Running a single test

```bash
npx vitest run src/modules/documents/tax/tax-matrix.spec.ts   # backend, one file
npm test -- -t "OSS destination rate"                    # backend, one test by name
npx vitest run src/some.test.tsx                          # frontend, one file
```

### A note on the backend's watch mode

A `data/xx.json` file you **add** while `nest start --watch` is running never reaches the running
server: it copies the assets declared in `nest-cli.json` once at startup, and then watches only the
files it already knows about for edits. If you add a new per-country data file and the running
backend doesn't see it, restart it.

### Refusing to commit a credential

This repository ships a `pre-commit` hook that rejects a commit carrying a key. Git never installs
hooks on its own, so turn it on once per clone:

```bash
git config core.hooksPath .githooks
```

It runs [gitleaks](https://github.com/gitleaks/gitleaks) against the **staged** content when the
binary is on your PATH, and falls back to a shorter list of explicit patterns when it is not — so a
machine without gitleaks is still covered, just less well. Installing gitleaks is recommended.

If you use `git worktree`, note that `core.hooksPath` is resolved relative to each working
directory: a relative path finds nothing from a worktree that has no `.githooks`, and git skips a
missing hook **silently**. Point it at an absolute path if you work from worktrees.

`git commit --no-verify` bypasses it, for the rare case where you mean to commit a sample that
looks like a secret.

This hook exists because a real key was committed and pushed on 2026-09-23 and had to be revoked:
nothing stood between writing it into a file and pushing it.

## Coding conventions

- **Biome is the only linter/formatter** — there is no ESLint or Prettier. Backend: single quotes,
  semicolons always, 110-column lines. Frontend: double quotes, semicolons as-needed, 110-column
  lines.

  ```bash
  npm run lint        # biome check .
  npm run lint:fix     # autofix
  npm run format       # format only
  ```

  CI runs `biome ci .` (no writes) — run `lint` locally before opening a pull request.

- **Backend layering: Controller → Service → Prisma.** Controllers never touch Prisma directly and
  never use `any`; they declare Swagger metadata and delegate to a service. There is no global
  `ValidationPipe` — DTOs are Swagger-only interfaces, and validation happens explicitly in the
  service or controller.

- **Never `import type` a class used as a dependency-injection token.** The type-only import is
  erased at compile time and Nest resolves `undefined`. Biome's `useImportType` rule is deliberately
  turned off in `backend/biome.json` for this reason. Booting the app (`npm run build` and actually
  starting it) is the real check that DI is wired correctly — `tsc --noEmit` alone will not catch it.

- **Tests are colocated.** `*.spec.ts` sits next to the code it tests — Vitest, both backend and
  frontend. `*.live.spec.ts` files hit real external APIs and self-gate behind
  `liveDescribe(FLAG, [ENV_VARS])`: skipped unless the flag is `1` and every credential variable is
  set. A gated spec that passes on mocks alone proves nothing about the real integration — see
  `documentation/docs/developer-guide/live-testing.md` before claiming a channel works end to end.

- **i18n.** Every user-facing string goes through `t()`, with the key defined in
  `frontend/src/locales/en/translation.json`. Other locales are Weblate-managed — don't hand-edit
  them. Run `npm run i18n:check` before opening a pull request; it fails if a used `t()` key is
  missing from the English catalogue.

- **Comments carry decisions and their rationale** — why a guard exists, why a module is split the
  way it is. Preserve them when refactoring, and match that density when adding non-obvious code.
  A comment should explain *why*, not narrate the process that produced it.

- **A country is data.** Nearly every per-country rule in the documents module lives in its own
  `data/<countryCode>.json` (or `.ts`) file, with its own schema and its own sourced facts. Adding or
  changing country coverage is usually a data change, not a code change — read
  [`documentation/docs/developer-guide/adding-a-country.md`](./documentation/docs/developer-guide/adding-a-country.md)
  before starting one; it covers what provenance is required and the schema each catalogue expects.

## Pull requests

1. Branch from `dev` — that's this repository's default branch — unless a maintainer tells you
   otherwise for a specific change.
2. One pull request, one subject. Split unrelated changes into separate pull requests.
3. Write a description that says *why* the change is needed, not just what changed — link the issue
   or discussion it resolves.
4. Use conventional commit messages: `type(scope): summary`, for example `fix(documents): …`,
   `feat(b2g): …`, `docs(readme): …`, `test(e2e): …`, `refactor(compliance): …`. Keep the summary in
   the imperative mood and under about 72 characters.
5. All CI checks must be green before merge. On every pull request, the **Tests** workflow runs
   `lint`, `i18n-check`, `e2e-typecheck`, `backend-tests`, `queue-integration`, `cypress-run` and
   `cypress-run-saas`; the **Business Scenarios** workflow runs the per-country `scenario` matrix;
   **CodeQL Advanced** runs its `analyze` job for JavaScript/TypeScript and GitHub Actions. A red job
   is not merged around — fix it or explain why it's a false positive and let a maintainer confirm.
6. A maintainer reviews every pull request; nothing merges without that review.
7. Once a review has started, don't force-push over it — push new commits instead, so the reviewer
   can see what changed since their last pass. Rebase and force-push are fine before review begins.

## Licensing of contributions

Invoicerr is [AGPL-3.0](./LICENSE), and that is the only licence it has. Contributing asks nothing of
you beyond that licence: no copyright assignment, and no grant letting anyone relicense your work on
other terms.

**By contributing, you agree that:**

- Your contribution is licensed under the AGPL-3.0, like the rest of the project — you keep your
  copyright; nothing here transfers ownership of your work.
- You have the right to submit the contribution under these terms (it's your own work, or you have
  permission from whoever holds the rights to it).

We use the **Developer Certificate of Origin (DCO)** instead of a separate contributor licence
agreement to record that: every commit in a pull request must be signed off.

```bash
git commit -s -m "fix(documents): …"
```

`-s` appends a `Signed-off-by: Your Name <your.email@example.com>` line to the commit message, using
the name and email from your `git config`. That line is your certification of the following (the DCO,
version 1.1):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
1 Letterman Drive
Suite D4700
San Francisco, CA, 94129

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

The full, canonical text lives at [developercertificate.org](https://developercertificate.org/). A
pull request with an unsigned commit will be asked to amend and force-push before review — `git commit
--amend -s`, or `git rebase --signoff HEAD~N` for several commits at once.

## Security

Please do not report a security vulnerability through a public issue, pull request or discussion.
Use GitHub's private reporting instead: open a
[security advisory](https://github.com/invoicerr-app/invoicerr/security/advisories/new). If that's
not an option, email **contact@invoicerr.app**.

## Code of conduct

There is no separate code of conduct document yet — until there is, the expectation is simple: be
respectful, assume good faith, and keep disagreement about the code, not the person. Harassment,
personal attacks and discriminatory language toward anyone in an issue, pull request, discussion or
review are not tolerated and will get comments removed and, if it continues, the person blocked from
the project. The maintainer has the final say on what does and doesn't fit the project, technically
and otherwise.
