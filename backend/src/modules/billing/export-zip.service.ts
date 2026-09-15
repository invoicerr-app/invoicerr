/**
 * Builds the "everything this company ever had" zip — mailed to the OWNER by
 * `billing-lifecycle-sweep-runner.ts` the moment a subscription enters `ZIPPED` (see
 * `lifecycle.ts`'s own header), the company's last real chance to keep a copy before the real,
 * cascading deletion (`deletion.ts`) eventually runs.
 *
 * No existing export was reusable whole: `accounting-export/` builds a CSV LEDGER view (amounts,
 * balances — never the documents' own rendered form or full field data) and `archive/` only holds
 * documents that were actually SENT under a country requiring legal archiving (DE/FR/PL/PT — see
 * `archive/retention/`'s own header), never a draft, a quote, or an invoice from an unarchived
 * country. So this is the documented fallback: one PDF (when the document type/status can render
 * one — see the per-document `try` below) plus one JSON dump of the STORED fields, per document,
 * for literally every `DocumentInstance` row the company has, regardless of type or status.
 *
 * A proper `@Injectable()` (not a plain function like this directory's other billing files) because
 * it needs `DocumentsService`'s own rendering pipeline (`renderInstancePdf`) — a class with its own
 * dozen-odd registries this file has no business reconstructing by hand.
 */
import { Injectable } from '@nestjs/common';
// `jszip` ships an `export = JSZip` (CJS) declaration — a plain `import JSZip from 'jszip'` compiles,
// under ts-jest, to a `.default` access that does not exist on it (`jszip_1.default is not a
// constructor` at runtime); the namespace form (`import * as JSZip`) instead fails `nest build`'s own
// `tsc` outright ("not constructable... consider... import require"). `import X = require(...)` is
// the one form TypeScript itself recommends for `export =` modules and is what actually satisfies
// BOTH — confirmed directly against this exact repo's `nest build` AND `npx jest` while writing this.
import JSZip = require('jszip');

import { DocumentsService } from '../documents/documents.service';
import { listDocuments } from '../documents/persistence';
import { logger } from '@/logger/logger.service';

/** Effectively "no cap" — `listDocuments`'s own default `take` is 50 (the list SCREEN's page-size
 *  budget, persistence.ts's own header), which this export must never inherit: a company with years
 *  of history must get every document, not its 50 most recently touched. */
const EXPORT_TAKE = 1_000_000;

@Injectable()
export class BillingExportService {
  constructor(private readonly documentsService: DocumentsService) {}

  /** The zip's bytes, ready to attach to an outgoing email. Never throws for a single document that
   *  fails to render (an incomplete draft missing a required field, e.g.) — that document's JSON
   *  still lands in the zip, just without a `.pdf` beside it, logged rather than aborting the WHOLE
   *  export over one bad row; only a genuinely fatal error (the zip library itself, or the initial
   *  `listDocuments` query) propagates. */
  async buildCompanyZip(companyId: string): Promise<Buffer> {
    const zip = new JSZip();
    const documents = await listDocuments(companyId, undefined, EXPORT_TAKE);

    for (const doc of documents) {
      const dir = `${doc.typeId}/${doc.number ?? doc.id}`;
      zip.file(`${dir}.json`, JSON.stringify(doc, null, 2));
      try {
        const pdf = await this.documentsService.renderInstancePdf(companyId, doc.typeId, doc.id);
        zip.file(`${dir}.pdf`, pdf);
      } catch (error) {
        logger.warn('Billing export: one document could not be rendered to PDF — JSON only', {
          category: 'billing',
          details: {
            companyId,
            documentId: doc.id,
            typeId: doc.typeId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}
