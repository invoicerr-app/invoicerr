/**
 * Purchase orders & goods receipts, second pass (three-way match / rapprochement à 3 voies) — the
 * COMPANY-WIDE reconciliation TOLERANCE (a percentage,
 * default 2 — see `DEFAULT_TOLERANCE_PERCENT` below), settable from the closest existing company
 * settings screen (`settings/_components/company.settings.tsx`, "Reconciliation" card).
 *
 * ## Storage — a `DocumentInstance` SINGLETON, deliberately NOT a new `Company` column
 *
 * This feature landed while a DIFFERENT, concurrent change was mid-flight against `schema.prisma`
 * (a company branding column + its own migration) — touching the schema or authoring a second,
 * unrelated migration alongside that work was out of scope for this pass. Three existing JSON
 * mechanisms were weighed instead of a new column:
 *  - `Company.numberFormats`/`Company.documentEmailTemplates` (both `Json?`) are each a CLOSED,
 *    documented `{ [DocumentTypeDescriptor.id]: <one specific shape> }` map, read by name-specific code
 *    (`numbering/format-number.ts#resolveNumberFormat`, `actions/email-template.ts`) that has no
 *    business ever seeing a key that isn't a real, registered document type id. Smuggling a
 *    `tolerancePercent` fact in under a synthetic key would work by accident (neither reader iterates
 *    unknown keys) but corrupts what each column is DOCUMENTED to mean, and both are written by a
 *    read-modify-write endpoint of their own (`company.service.ts#updateNumberFormat`) this feature has
 *    no business sharing.
 *  - `CompanyChannelConfig` (`channels.service.ts`) stores its `config` blob AES-256-GCM ENCRYPTED, and
 *    its own `resolve()` returns `null` — silently — the instant `CREDENTIALS_ENCRYPTION_KEY` is
 *    unset/unavailable (see that service's own header: a TRANSPORT preflight treats that identically to
 *    "not connected"). A plain, non-secret business threshold has no business depending on a
 *    credentials-encryption key being configured at all, nor going through `ChannelConfigStatus`'s own
 *    documented "never let a config VALUE reach an HTTP response" contract — this setting is exactly
 *    the opposite: a value the settings screen must show back to the user who set it.
 *  - `DocumentInstance.data` (this file's own choice): already a free-form `Json` column, and
 *    `typeId` is a bare, unconstrained `String` — `persistence.ts`'s own helpers never check it against
 *    `DocumentTypeRegistry` (only `documents.service.ts#resolveType` does, for the HTTP surface this
 *    reserved id never goes through). A row here costs nothing structurally: no migration, no new
 *    table, reuses the exact same tenant scoping (`companyId`) every other document read/write already
 *    has.
 *
 * `SETTINGS_TYPE_ID` is NEVER registered in `DocumentTypeRegistry` (`documents-core.module.ts`'s own
 * `buildDocumentTypeRegistry` has no line for it) — it is unreachable through
 * `GET /documents/types/:typeId`, `POST /documents/types/:typeId/actions/:actionId`, or any
 * `DOCUMENT_TYPE_REGISTRY`-driven listing (`documents.service.ts#listAvailableDocumentTypes`, dashboard/
 * statistics `collect-widgets.ts`, `row-selection.ts#referencedArrayFieldKeys` — every one of those
 * walks `typeRegistry.list()`, a handful of REGISTERED descriptors, never a live scan of every distinct
 * `typeId` string actually present in the table). The one residual gap: `GET /api/documents` with NO
 * `typeId` query param (`documents.controller.ts#listDocuments`) lists every `DocumentInstance` row for
 * the company regardless of type, and would include this singleton if a caller ever hit it unfiltered
 * — no frontend screen does today (every list/contribution/reference call in this codebase passes an
 * explicit `typeId`), and the value itself carries nothing sensitive, so this is accepted as a known,
 * low-severity residual rather than reason to abandon this storage choice; a future generic listing
 * screen should filter reserved ids like this one out explicitly.
 */
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

/** Never registered in `DocumentTypeRegistry` — see this file's own header. Distinctive on purpose
 *  (never a name a real document type would plausibly also pick) so a stray collision is effectively
 *  impossible even for a future, unrelated feature. */
export const RECONCILIATION_SETTINGS_TYPE_ID = 'company-reconciliation-settings';

/** The default every company starts at, until it explicitly sets its own — the value named in this
 *  feature's own product decision (2026-09-15). */
export const DEFAULT_TOLERANCE_PERCENT = 2;

export interface ReconciliationSettings {
  tolerancePercent: number;
}

/** Reads this company's own tolerance, defaulting silently (never a 404/500) for a company that has
 *  never touched the setting — the routine case for every company today, this feature having just
 *  shipped. Also defaults for a stored value that is somehow not a finite, non-negative number (a
 *  corrupted write, a future format change) — the same "degrade honestly instead of breaking" rule
 *  the rest of this core already holds for a descriptor/data mismatch elsewhere. */
export async function getReconciliationSettings(companyId: string): Promise<ReconciliationSettings> {
  const row = await prisma.documentInstance.findFirst({
    where: { companyId, typeId: RECONCILIATION_SETTINGS_TYPE_ID },
    orderBy: { updatedAt: 'desc' },
  });
  const stored = (row?.data as Record<string, unknown> | null)?.tolerancePercent;
  const tolerancePercent =
    typeof stored === 'number' && Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_TOLERANCE_PERCENT;
  return { tolerancePercent };
}

/**
 * Sets this company's own tolerance — find-or-create the ONE singleton row this company ever gets
 * for this reserved typeId (never a second one: a company that already has a row is UPDATED, never
 * duplicated, the same "one settings row per company" invariant a dedicated table's own unique
 * constraint would otherwise enforce structurally).
 */
export async function setReconciliationTolerancePercent(
  companyId: string,
  tolerancePercent: number,
): Promise<ReconciliationSettings> {
  if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0) {
    throw new BadRequestException('tolerancePercent must be a non-negative number.');
  }

  const existing = await prisma.documentInstance.findFirst({
    where: { companyId, typeId: RECONCILIATION_SETTINGS_TYPE_ID },
  });

  if (existing) {
    await prisma.documentInstance.update({
      where: { id: existing.id },
      data: { data: { tolerancePercent } },
    });
  } else {
    await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: RECONCILIATION_SETTINGS_TYPE_ID,
        status: 'active',
        data: { tolerancePercent },
      },
    });
  }

  return { tolerancePercent };
}
