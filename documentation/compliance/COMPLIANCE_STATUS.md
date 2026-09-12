# Compliance — Implementation Status (retired)

> **Retired 2026-08-29.** This document tracked implementation progress for the compliance
> **engine** — `backend/src/compliance/` (resolution core, format/transmission/signing/archive
> providers, the event-sourced lifecycle runtime, NestJS wiring under `ComplianceModule`/
> `ComplianceCoreModule`). That whole tree was deleted in commit `fffbae77` ("refactor!: suppression
> des documents légaux et du moteur de conformité", ~298k lines removed), so every checklist item
> below it named no longer applies to any code in this repository.

## Where the current status lives

- The current architecture (the catalogs that replaced the engine, and what does — and does not —
  survive of the old lifecycle) is described in `CLAUDE.md`'s "The documents module" section.
- Per-channel and per-format implementation status (which transmission channels are proven live,
  which are implemented-awaiting-credentials, which are stubs) is tracked in the root
  `COMPLIANCE_TODO.md`.
- The NF-525 compliance posture (inalterability, audit trail, hash-chaining, retention, archival,
  gapless numbering) is now a property of the documents module directly — see the modules listed in
  `CLAUDE.md` (`descriptors/lifecycle.ts`, `archive/`, `numbering/`) rather than of a separate
  compliance engine.

Tag `avant-refonte-documents` (`git show avant-refonte-documents:...`) recovers the removed engine's
own source for anyone doing archaeology.
