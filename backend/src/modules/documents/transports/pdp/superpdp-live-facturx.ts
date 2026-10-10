import { PDFDocument } from 'pdf-lib';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { CorrectedInvoiceReference } from '../../formats/format-provider';
import { buildSemanticInvoice, SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import {
  applyFrenchBusinessProcess,
  applyFrenchBusinessProcessInObject,
  frenchBusinessProcessCode,
} from '../../formats/semantic/business-process';
import {
  splitCiiIncludedNotes,
  splitCiiIncludedNotesInObject,
} from '../../formats/semantic/cii-post-process';
import { newEuInvoiceService } from '../../formats/shared-build';
import { validateStructural } from '../../formats/structural-check';
import { EN16931_CII_SCH, validateSchematron } from '../../formats/vendored/validate-schematron';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { PdpClient, SuperPdpInvoice, SuperPdpInvoiceEvent } from './pdp-client';

/**
 * How BT-23 (business process) is applied:
 * - `profile`: written into the semantic invoice, the gated CII and the embedded CII. When the
 *   content requirement's temporal gate resolves nothing (superpdp refuses a BT-2 later than today,
 *   so a deposit cannot be dated past the mandate start), `frenchBusinessProcessCode` is called
 *   directly to prove the mechanics; in production the gate alone decides.
 * - `embedded`: only the embedded CII carries it.
 * - `none`: never applied.
 */
export type BusinessProcessMode = 'profile' | 'embedded' | 'none';

export interface LiveFacturxOptions {
  displayNumber: string;
  seller: SemanticPartyInput;
  buyer: SemanticPartyInput;
  description: string;
  unitPrice?: number;
  creditNote?: { correctedInvoice: CorrectedInvoiceReference };
  businessProcess: BusinessProcessMode;
  /** false sends the embedded CII without the BG-1 note split and BT-23, reproducing the
   *  historical `fr:213` rejection. The gated plain CII is always fixed. */
  fixEmbedded?: boolean;
}

/** Builds a Factur-X PDF the way `facturx-provider.ts` does: the plain CII goes through the
 *  structural and EN 16931 Schematron gates, then is embedded into a minimal pdf-lib host PDF. */
export async function buildLiveFacturx(opts: LiveFacturxOptions): Promise<Uint8Array> {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    {
      description: opts.description,
      quantity: 1,
      unit: 'unit',
      unitPrice: opts.unitPrice ?? 100,
      vatRate: '20',
      supplyType: 'SERVICES' as const,
    },
  ];
  const totals = computeDocumentTotals(buildInvoiceDescriptor(), {
    client: 'live-client',
    issueDate: today,
    dueDate: today,
    currency: 'EUR',
    lines,
  });
  const euInvoice = buildSemanticInvoice({
    displayNumber: opts.displayNumber,
    issueDate: today,
    seller: opts.seller,
    buyer: opts.buyer,
    lines: lines.map(({ vatRate: _vatRate, ...line }) => line),
    totals,
    creditNote: opts.creditNote,
  });

  let businessProcessCode: string | undefined;
  if (opts.businessProcess !== 'none') {
    const gatedCode = euInvoice['ubl:Invoice']['cbc:ProfileID'] as string | undefined;
    businessProcessCode = gatedCode ?? frenchBusinessProcessCode(['SERVICES']);
    if (opts.businessProcess === 'profile') {
      console.log('BT-23 via the temporal gate:', gatedCode, '- used:', businessProcessCode);
      euInvoice['ubl:Invoice']['cbc:ProfileID'] = businessProcessCode;
    }
  }

  const service = newEuInvoiceService();
  let cii = splitCiiIncludedNotes(
    (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string,
  );
  if (opts.businessProcess === 'profile' && businessProcessCode) {
    cii = applyFrenchBusinessProcess(cii, businessProcessCode);
  }
  const structural = validateStructural(cii, 'cii');
  if (!structural.valid) throw new Error(`structural gate rejected the CII: ${structural.errors.join('; ')}`);
  const schematron = validateSchematron(cii, EN16931_CII_SCH);
  if (!schematron.valid) {
    throw new Error(
      `EN 16931 Schematron gate rejected the CII: ${schematron.errors.map((e) => `${e.id}: ${e.message}`).join('; ')}`,
    );
  }
  console.log(`${opts.displayNumber}: TypeCode`, /<ram:TypeCode>(\d+)<\/ram:TypeCode>/.exec(cii)?.[1]);

  const hostPdf = await PDFDocument.create();
  hostPdf.addPage([595, 842]);
  return (await service.generate(euInvoice, {
    format: 'Factur-X-EN16931',
    pdf: {
      buffer: Buffer.from(await hostPdf.save()),
      filename: `${opts.displayNumber}.pdf`,
      mimetype: 'application/pdf',
    },
    lang: 'en',
    // Same post-processing as `facturx-provider.ts`: without the note split, superpdp rejects the
    // deposit (`fr:213`, "Element 'ram:Content' must occur exactly 1 times").
    postProcessor:
      opts.fixEmbedded === false
        ? undefined
        : async (embedded) => {
            const embeddedCii = embedded as Record<string, unknown>;
            splitCiiIncludedNotesInObject(embeddedCii);
            if (businessProcessCode) applyFrenchBusinessProcessInObject(embeddedCii, businessProcessCode);
          },
  })) as Uint8Array;
}

/** Deposits the bytes and throws on a missing deposit id. */
export async function depositLiveFacturx(
  client: PdpClient,
  facturx: Uint8Array,
  externalId: string,
): Promise<SuperPdpInvoice> {
  const sent = await client.sendInvoice(Buffer.from(facturx), { externalId });
  if (!sent || String(sent.id ?? '') === '') {
    throw new Error(`superpdp returned no usable deposit id for ${externalId}: ${JSON.stringify(sent)}`);
  }
  console.log(`${externalId}: deposit accepted, id ${sent.id}`);
  return sent;
}

/** Re-reads a deposit every 500ms, up to 5s, until it carries an `fr:2xx` event. */
export async function awaitLiveVerdict(
  client: PdpClient,
  depositId: number,
): Promise<SuperPdpInvoiceEvent[]> {
  let refetched = await client.getInvoice(depositId);
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((refetched.events ?? []).some((e) => e.status_code?.startsWith('fr:2'))) break;
    await new Promise((r) => setTimeout(r, 500));
    refetched = await client.getInvoice(depositId);
  }
  const events = refetched.events ?? [];
  console.log(`deposit ${depositId} events:`, JSON.stringify(events, null, 2));
  return events;
}

export function findRejection(events: SuperPdpInvoiceEvent[]): SuperPdpInvoiceEvent | undefined {
  return events.find((e) => /rejet|reject|ko\b/i.test(e.status_text ?? ''));
}
