# Implementation Order for Stubs — Formats Then Transmissions (retired)

> **Retired 2026-08-29.** This document listed, in order, the format and channel stubs to make real
> in the compliance engine — `backend/src/compliance/providers/{format,
> transmission}/`. That whole tree was deleted in commit `fffbae77` ("refactor!: suppression
> des documents légaux et du moteur de conformité", ~298k lines removed): the paths, the stubs, and
> the 106-jurisdiction tracking index cited below no longer correspond to any code in this
> repository.

## Where the current status lives

- The current architecture (the catalogs that replace the engine, and what does — or does not —
  survive of the lifecycle) is described in `CLAUDE.md`'s "The documents module" section.
- The real per-channel and per-format status (which channel is proven live, which is
  implemented-awaiting-credentials, which is a stub) is tracked in
  `documentation/docs/developer-guide/live-testing.md`.

Tag `avant-refonte-documents` (`git show avant-refonte-documents:...`) recovers the removed engine's
source code for anyone doing archaeology.
