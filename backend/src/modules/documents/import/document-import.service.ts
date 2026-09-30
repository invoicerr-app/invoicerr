/**
 * Importing a document issued by a previous tool (issue #340): the CORE write path, shared by the
 * single-document endpoint (`document-import.controller.ts`) and the CSV bulk import
 * (`document-import-csv.service.ts`).
 *
 * ## Why this never goes through `documents.service.ts#runAction`/`ActionRegistry`
 *
 * `runAction`'s own post-write guard (`descriptors/lifecycle.ts#checkTransitionResult`) hard-requires
 * a BRAND-NEW record (no `documentId` before the call) to land on the type's own `initialStatus`
 * ("draft" for both "invoice" and "credit-note"), by definition of what "initial" means, per that
 * function's own header. An import needs to land on "imported" on its VERY FIRST write, never on
 * "draft" first: there is no genuine "half-finished" state for a document someone else already
 * finished issuing years ago. Going through the generic action pipeline would therefore mean either
 * (a) creating a throwaway "draft" first and immediately transitioning it (two writes, one race
 * window, and an orphaned draft on any failure between them), or (b) special-casing
 * `checkTransitionResult` for this one caller, which would weaken the exact invariant that check
 * exists to hold for every OTHER creation path. This module is a bespoke, one-write path instead,
 * the same "bypass ActionRegistry for a route-shape reason" precedent `documents.service.ts`'s own
 * "share-link"/"download-xml" already establish (see `invoice.descriptor.ts`'s own comment on
 * "download-xml" for why), just for a CREATION reason instead of a response-shape one.
 *
 * "imported" is still a REAL, declared status on both descriptors (`invoice.descriptor.ts`,
 * `credit-note.descriptor.ts`), needed so the generic frontend (status badge, filter chip,
 * `SAVE_DRAFT_LOCKED_STATUSES`) and `validateLifecycle` (boot-time) both know it exists. Nothing
 * anywhere ever declares a transition FROM "imported": that omission alone is what makes it have no
 * outgoing transition (`descriptors/lifecycle.ts`'s own header confirms this is a legal, structural
 * dead end, not something that needs a extra flag). Send/e-invoice/edit/renumber are refused by
 * construction, not by a guard added here.
 *
 * ## What IS reused
 *
 * Business-field validation goes through the EXACT SAME pipeline `runAction` uses for "save-draft":
 * `descriptors/company-view.ts#applyCompanyFieldView` (country field overlay + this company's own VAT
 * rate catalog), `descriptors/validate.ts#stripSidecarKeys`/`dropEmptyRows`/`validateAgainstDescriptor`,
 * `row-selection/row-selection.ts#stampRowIds` (so an imported invoice's own `lines` get row ids a
 * LATER credit note's `correctedLines` can select, exactly like an ordinary invoice's do). An
 * imported document's `client`/`issueDate`/`lines`/etc. are validated exactly as strictly as a normal
 * one's, only the STATUS they land on and the extra import-only facts (below) differ.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { Prisma } from '../../../../prisma/generated/prisma/client';

import { createAuthorityEvents } from '../conformity/authority-events.persistence';
import { createImportOriginalArchive } from '../archive/import-original';
import { applyFieldOverlay } from '../country-fields/apply-overlay';
import { FieldKindRegistry } from '../descriptors/field-kinds';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import {
  dropEmptyRows,
  stripSidecarKeys,
  validateAgainstDescriptor,
  ValidationError,
} from '../descriptors/validate';
import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { referencedArrayFieldKeys, stampRowIds } from '../row-selection/row-selection';
import { CountryFieldOverlayCatalog } from '../country-fields/registry';
import { AttachmentsService } from '../attachments/attachments.service';
import { COUNTRY_FIELD_OVERLAY_REGISTRY, DOCUMENT_TYPE_REGISTRY, FIELD_KIND_REGISTRY } from '../tokens';
import { hasTransmissionEvidence, ImportDocumentInput, ImportDocumentResult } from './document-import.types';

/** Poland's own transport id (`transports/ksef-transport.ts`, `KSEF_PROVIDER_ID` in
 *  `formats/national/fa3-kor.ts`): an imported invoice that carries a declared KSeF number is given
 *  the SAME `channelProviderId` a real KSeF submission would have set, so a LATER faktura korygująca
 *  against it (`fa3-kor.ts#resolveFaVatKorContext`) takes the "look up the observed KSeF number"
 *  branch instead of the "never submitted to KSeF" statutory exception. This is exactly right, since
 *  this invoice genuinely WAS submitted to KSeF, just not by this application. */
const KSEF_PROVIDER_ID = 'ksef';

export class DocumentImportValidationError extends BadRequestException {
  constructor(errors: ValidationError[]) {
    super({
      message: 'This document could not be imported.',
      errors,
    });
  }
}

function normalizeAtcud(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toUpperCase().startsWith('ATCUD:')) return trimmed;
  return `ATCUD:${trimmed}`;
}

@Injectable()
export class DocumentImportService {
  constructor(
    @Inject(DOCUMENT_TYPE_REGISTRY) private readonly typeRegistry: DocumentTypeRegistry,
    @Inject(FIELD_KIND_REGISTRY) private readonly fieldKindRegistry: FieldKindRegistry,
    @Inject(COUNTRY_FIELD_OVERLAY_REGISTRY)
    private readonly countryFieldOverlayCatalog: CountryFieldOverlayCatalog,
    private readonly attachmentsService: AttachmentsService,
  ) {}

  /**
   * Everything `importDocument` below checks BEFORE it writes anything - split out so
   * `document-import-csv.service.ts#preview` can run the exact same checks a real import would run,
   * with no side effect, instead of drifting into a second, hand-rolled validation pass. Throws
   * `DocumentImportValidationError` (never returns a partial result) on the first problem found -
   * `preview` catches it per row; `importDocument` lets it propagate as this endpoint's own 400.
   */
  private async validateImport(
    input: ImportDocumentInput,
  ): Promise<{ stamped: Record<string, unknown>; issueDate: Date }> {
    const { companyId, typeId } = input;
    const descriptor = this.typeRegistry.resolve(typeId);

    const originalNumber = input.originalNumber?.trim();
    if (!originalNumber) {
      throw new DocumentImportValidationError([
        {
          key: 'originalNumber',
          message: 'The original number (as the previous tool printed it) is required.',
        },
      ]);
    }

    if (!input.originalFile?.fileRef || !input.originalFile.fileName || !input.originalFile.mime) {
      throw new DocumentImportValidationError([
        {
          key: 'originalFile',
          message: 'The original file (PDF or XML, as the previous tool produced it) is required.',
        },
      ]);
    }

    const countryCode = (await resolveCompanyCountryCode(companyId)) ?? '';
    // Country field OVERLAY only (e.g. Germany's mandatory buyerReference) - deliberately NOT
    // `descriptors/company-view.ts#applyCompanyFieldView`'s SECOND pass, which would also fill
    // `lines.vatRate`'s `options` from this company's OWN, CURRENT VAT rate catalog
    // (`vat-rates/registry.ts`) and, per `field-kinds.ts`'s own 'select' validator, then REJECT any
    // value not in that list even with `allowCustomValue: true` (that escape only opens when
    // `options` is itself empty). A historical rate from a previous tool is a fact about the past,
    // not a choice being made against TODAY's catalog - it is kept as free text, exactly as
    // originally recorded, by simply never filling `options` in the first place (the descriptor's own
    // `allowCustomValue: true` then opens the escape). `applyFieldOverlay` clones internally
    // (apply-overlay.ts's own `cloneFields`) - never mutates the descriptor's own shared array.
    const companyFields = applyFieldOverlay(
      descriptor.fields ?? [],
      countryCode ? this.countryFieldOverlayCatalog.operationsFor(countryCode, typeId) : [],
    );

    // SAME order `documents.service.ts#runAction` uses: strip caller sidecars, drop empty rows,
    // VALIDATE, and only then stamp row ids - `stampRowIds` is applied "only to data that has already
    // passed every check above (never to data about to be rejected anyway)" (that function's own
    // comment at its real call site).
    const stripped = stripSidecarKeys(companyFields, input.data ?? {});
    const cleaned = dropEmptyRows(companyFields, stripped);

    const errors = validateAgainstDescriptor(companyFields, cleaned, this.fieldKindRegistry);
    if (errors.length > 0) {
      throw new DocumentImportValidationError(errors);
    }

    const stamped = stampRowIds(companyFields, cleaned, referencedArrayFieldKeys(this.typeRegistry, typeId));

    const rawIssueDate = (stamped as Record<string, unknown>).issueDate;
    const issueDate =
      typeof rawIssueDate === 'string' || typeof rawIssueDate === 'number'
        ? new Date(rawIssueDate)
        : undefined;
    if (!issueDate || Number.isNaN(issueDate.getTime())) {
      // Both invoice and credit-note declare "issueDate" as `required: true` - validateAgainstDescriptor
      // above would already have refused a missing one, so this only ever fires for a value shaped
      // like a date string but not a real calendar day - an honest 400, never a silent "now()" guess
      // (issue #340's whole point is preserving the ORIGINAL date, never substituting today's).
      throw new DocumentImportValidationError([
        { key: 'issueDate', message: '"Date" must be a real calendar day.' },
      ]);
    }

    return { stamped, issueDate };
  }

  /** Runs every check `importDocument` would run, writes nothing - `document-import-csv.service.ts`'s
   *  own `preview`. Re-checks the original file reference resolves too (a stale/foreign `fileRef`
   *  fails a real import just as surely as a bad field value would) - `attachmentsService.download`
   *  is the only tenant-scoped existence check this module has, so a preview pays the same read a
   *  real import would, just discards the bytes instead of archiving them. */
  async validateImportPreview(input: ImportDocumentInput): Promise<void> {
    await this.validateImport(input);
    await this.attachmentsService.download(
      input.companyId,
      input.originalFile.fileRef,
      input.originalFile.mime,
    );
  }

  async importDocument(input: ImportDocumentInput): Promise<ImportDocumentResult> {
    const { companyId, typeId } = input;
    const { stamped, issueDate } = await this.validateImport(input);
    const originalNumber = input.originalNumber.trim();

    const evidence = input.transmissionEvidence ?? {};
    const atcud = evidence.atcud?.trim() ? normalizeAtcud(evidence.atcud) : null;
    const channelProviderId = typeId === 'invoice' && evidence.ksefNumber?.trim() ? KSEF_PROVIDER_ID : null;

    // The original file must exist and belong to this company BEFORE anything is written: a 404
    // here (attachments.service.ts's own tenant-scoped read) is a clean refusal, never a document
    // created with no archive to follow it.
    const original = await this.attachmentsService.download(
      companyId,
      input.originalFile.fileRef,
      input.originalFile.mime,
    );

    const data = {
      ...stamped,
      // Stored so the document screen (and a later credit note's own free-form citation) can show
      // exactly what the import declared, and so `hasTransmissionEvidence` (this module's own header)
      // can compute the "not transmitted" warning on every later read - never re-derived from the
      // ATCUD column alone, since sdiId/ksefNumber/paReference have none.
      importTransmissionEvidence: {
        sdiId: evidence.sdiId?.trim() || undefined,
        ksefNumber: evidence.ksefNumber?.trim() || undefined,
        paReference: evidence.paReference?.trim() || undefined,
      },
    };

    const created = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId,
        status: 'imported',
        data: data as unknown as Prisma.InputJsonValue,
        // Never consumed from the running series (issue #340's own decision) - `number` stays null
        // forever, exactly like a document whose type never declares `numbering` at all.
        number: null,
        displayNumber: originalNumber,
        atcud,
        channelProviderId,
      },
    });

    try {
      if (channelProviderId === KSEF_PROVIDER_ID && evidence.ksefNumber?.trim()) {
        // Journaled the SAME way a real post-deposit KSeF poll would have (conformity/) - see this
        // file's own header on why `resolveFaVatKorContext` then needs no special-casing at all for
        // an imported invoice's later correction.
        await createAuthorityEvents(companyId, created.id, KSEF_PROVIDER_ID, [
          {
            statusCode: 'imported',
            statusText: 'Declared at import - the previous tool submitted this invoice to KSeF.',
            rawPayload: { ksefNumber: evidence.ksefNumber.trim() },
            observedAt: issueDate,
          },
        ]);
      }

      await createImportOriginalArchive({
        companyId,
        documentId: created.id,
        bytes: original.bytes,
        mime: original.mime,
        issueDate,
      });
    } catch (error) {
      // The legal archive is not optional (the owner's own decision: "Invoicerr is the legal archive
      // of the imported original") - a document with no archive is not a document this import may
      // silently keep. Roll the whole import back (cascades away any authority event too -
      // `DocumentAuthorityEvent.document` is `onDelete: Cascade`) and let the caller retry.
      await prisma.documentInstance.delete({ where: { id: created.id } }).catch(() => undefined);
      throw error;
    }

    return {
      id: created.id,
      typeId,
      status: 'imported',
      displayNumber: originalNumber,
      transmitted: hasTransmissionEvidence(evidence),
    };
  }
}
