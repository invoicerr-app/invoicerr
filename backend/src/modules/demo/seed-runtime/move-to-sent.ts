/**
 * The demo seed's OWN way of putting a document straight into "sent" status with a real, sequential
 * number, WITHOUT ever calling `runAction(..., 'send', ...)`, which is what `documents.service.ts`
 * uses in production and which, for every type registered here, ends inside `actions/async-send.ts`'s
 * `deliver()` phase: a real transport/mail call `TransportRegistry`/`MailService` now refuse outright
 * in demo mode (`modules/demo/demo-blocked.ts`). A seed script must never depend on a working SMTP
 * server or a connected e-invoicing channel existing in whatever namespace it runs in, demo mode or
 * not; a reset must succeed the same way whether or not this instance's mail is configured.
 *
 * Reuses `numbering/take-number.ts#takeDocumentNumberForTransitionWithStatus` DIRECTLY, the exact
 * same atomic "bump the sequence and write the status in one transaction" primitive
 * `actions/async-send.ts`'s own phase-1 branch calls, so a seeded "sent" document carries a real,
 * correctly-formatted, country-constraint-checked number (`numbering/company-number-format.ts`), never
 * a fake or hand-typed one. What this deliberately SKIPS is only the transient "sending" status and
 * the delivery side effect itself, nothing about numbering validity.
 */
import { takeDocumentNumberForTransitionWithStatus } from '@/modules/documents/numbering/take-number';
import { DocumentInstanceResult } from '@/modules/documents/actions/action-registry';

export async function moveDraftToSent(
  companyId: string,
  typeId: string,
  documentId: string,
  data: Record<string, unknown>,
): Promise<DocumentInstanceResult> {
  const { document } = await takeDocumentNumberForTransitionWithStatus(
    companyId,
    typeId,
    documentId,
    ['draft'],
    'sent',
    data,
  );
  return document;
}
