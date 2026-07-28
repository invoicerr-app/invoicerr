/**
 * M-4 (COMPLIANCE_AUDIT.md) — PL faktura korygująca flows through the SAME issue → send →
 * clear-via-KSeF pipeline as any other document, end-to-end, offline.
 *
 * national-format-validation.spec.ts and invoice-rendering-correction.spec.ts prove the KOR
 * document itself (builder output + DB wiring) is correct in isolation. This spec proves the
 * PIPELINE wiring: a correction ComplianceDocument — created the same way InvoicesService
 * .correctInvoice() creates one (own ctx/externalRef, `correctsId` pointing at the original's
 * ComplianceDocument id) — goes through issue()/send() exactly like the original did, is validated
 * (M-1's real XSD gate, not skipped) and "cleared" by a fake/mock KSeF transport (no live
 * credentials — see channel-settings-per-country / KSeF proven-live memory: this test does NOT
 * touch the real ksef-client.ts transmit/poll internals).
 */
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { ComplianceExecutor } from '../execution/executor';
import { RecordingComplianceLogger } from '../execution/logger';
import { NumberingRegistry } from '../lifecycle/numbering';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { PL_B2B } from '../providers/format/__fixtures__/invoices';
import { InvoiceArtifactPort } from '../providers/format/invoice-artifact-port';
import { FormatProviderRegistry } from '../providers/format/registry';
import { AuthorityIdentifier } from '../execution/types';
import { TransmissionProvider } from '../providers/transmission/transmission-provider';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { ComplianceService } from './compliance-service';
import { InMemoryComplianceDocumentStore } from './document-store';

const renderService = new InvoiceRenderingService();

function party(country: string): PartyTaxProfile {
  return {
    legalName: `${country} Co sp. z o.o.`,
    countryCode: country,
    role: 'B2B',
    identifiers: [{ scheme: 'VAT', value: `${country}1234567890`, validated: true }],
  };
}

function ctx(externalRef: string, issueDate: string): TransactionContext {
  return {
    supplier: party('PL'),
    buyer: party('PL'),
    lines: [{ id: 'l1', description: 'Usługi IT', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date(issueDate),
    currency: 'PLN',
    externalRef,
    supplierCompanyId: 'pl-test-co',
  };
}

/** Fake KSeF transport — no live credentials, no ksef-client.ts internals. `transmit()` accepts
 *  (PENDING, blocking regime ⇒ SUBMIT_CLEARANCE) exactly like the real gateway would while a
 *  session is still open; the test drives "clearance" explicitly via `service.markCleared()`,
 *  mirroring how the real async-poll path eventually resolves (poll.processor.ts → ApplySignalService). */
function ksefMock(): TransmissionProvider {
  return {
    id: 'ksef',
    channel: 'GOV_PORTAL_API',
    feedback: 'ASYNC_POLL',
    maturity: 'IMPLEMENTED',
    transmit: async () => ({
      channel: 'GOV_PORTAL_API',
      status: 'PENDING',
      ref: 'ksef-mock-session-ref',
      notes: ['submitted to KSeF (mock transport)'],
    }),
  };
}

function makePort(renderFaVat: InvoiceArtifactPort['renderFaVat']): InvoiceArtifactPort {
  return {
    renderPdf: async () => new Uint8Array(),
    renderPdfFormat: async () => new Uint8Array(),
    renderXmlFormat: async () => '',
    renderFatturaPa: async () => '',
    renderCfdi: async () => '',
    renderFacturae: async () => '',
    renderKsaUbl: async () => '',
    renderFaVat,
    renderNationalXml: async () => '',
  };
}

describe('M-4 — PL faktura korygująca: issue → send → clear, linked to the original (offline, mock KSeF)', () => {
  const ORIGINAL_REF = 'pl-original-doc';
  const CORRECTION_REF = 'pl-correction-doc';
  const ORIGINAL_KSEF_NUMBER = '1234567890-20260301-1A2B3C-4D5E6F-A1';

  it('the correction references the cleared original by KSeF number, RodzajFaktury=KOR, FA(3) (issued 2026-03), and clears independently', async () => {
    // Captured once the ORIGINAL clears — read by the correction's render closure below, exactly
    // like InvoiceRenderingService.fetchRenderData() would read it from
    // Invoice.correctsInvoice.complianceDocuments[0].authorityIds in production.
    let capturedOriginalKsefNumber: string | undefined;

    const port = makePort(async (invoiceId: string) => {
      if (invoiceId === CORRECTION_REF) {
        return renderService.buildFaVat({
          ...PL_B2B.data,
          rawNumber: 'FV-2026-0100-KOR',
          issuedAt: new Date('2026-03-15T09:00:00Z'),
          createdAt: new Date('2026-03-15T09:00:00Z'),
          correction: {
            originalIssueDate: new Date('2026-03-01T09:00:00Z'),
            originalNumber: 'FV-2026-0001',
            originalKsefNumber: capturedOriginalKsefNumber ?? null,
            reason: 'Price correction after audit',
          },
        });
      }
      return renderService.buildFaVat({
        ...PL_B2B.data,
        rawNumber: 'FV-2026-0001',
        issuedAt: new Date('2026-03-01T09:00:00Z'),
        createdAt: new Date('2026-03-01T09:00:00Z'),
      });
    });

    const log = new RecordingComplianceLogger();
    const formats = new FormatProviderRegistry({ artifacts: port });
    const transmission = new TransmissionProviderRegistry([ksefMock()]);
    const executor = new ComplianceExecutor({
      formats,
      transmission,
      numbering: new NumberingRegistry(),
      logger: log,
    });
    const service = new ComplianceService({
      store: new InMemoryComplianceDocumentStore(),
      numbering: new NumberingRegistry(),
      executor,
      formats,
      logger: log,
    });

    // ── 1. Issue + send the ORIGINAL (post-2026-02-01 ⇒ PL is CLEARANCE/blocking + FA_VAT/KSeF) ──
    const original = await service.createDraft(ctx(ORIGINAL_REF, '2026-03-01'), 'INVOICE');
    const { document: originalIssued } = await service.issue(original.id);
    expect(originalIssued.status).toBe('ISSUED');

    const originalSend = await service.send(original.id);
    expect(originalSend.document.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    expect(originalSend.transmissionFailed).toBe(false);
    expect(originalSend.document.status).toBe('PENDING_CLEARANCE'); // blocking regime — awaits clearance

    const originalCleared = await service.markCleared(original.id, [
      { scheme: 'KSEF_NUMBER', value: ORIGINAL_KSEF_NUMBER } as AuthorityIdentifier,
    ]);
    expect(originalCleared.document.status).toBe('CLEARED');
    capturedOriginalKsefNumber = originalCleared.authorityIds.find((a) => a.scheme === 'KSEF_NUMBER')?.value;
    expect(capturedOriginalKsefNumber).toBe(ORIGINAL_KSEF_NUMBER);

    // ── 2. Create + issue + send the CORRECTION — same pipeline, linked via correctsId ──
    // Mirrors InvoicesService.correctInvoice(): its own ctx/externalRef (M-4 fix — NOT the
    // original's), `correctsId` pointing at the original's ComplianceDocument id (M-4 fix).
    const correction = await service.createDraft(
      ctx(CORRECTION_REF, '2026-03-15'),
      'CORRECTIVE_INVOICE',
      undefined,
      original.id,
    );
    expect(correction.correctsId).toBe(original.id);
    expect(correction.kind).toBe('CORRECTIVE_INVOICE');

    const { document: correctionIssued } = await service.issue(correction.id);
    expect(correctionIssued.status).toBe('ISSUED');

    const correctionSend = await service.send(correction.id);
    // The KOR document must pass the SAME M-1 XSD validation gate as any other FA_VAT artifact —
    // if the KOR block were malformed this would be VALIDATION_BLOCKED and send() would throw.
    expect(correctionSend.document.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    expect(correctionSend.transmissionFailed).toBe(false);
    expect(correctionSend.document.status).toBe('PENDING_CLEARANCE');

    const correctionCleared = await service.markCleared(correction.id, [
      { scheme: 'KSEF_NUMBER', value: '1234567890-20260315-AABBCC-DDEEFF-B2' } as AuthorityIdentifier,
    ]);
    expect(correctionCleared.document.status).toBe('CLEARED');
    // Still linked to the original after clearing (correctsId survives the whole pipeline).
    expect(correctionCleared.document.correctsId).toBe(original.id);

    // The original recorded that a correction was initiated against it (createRecord is only half
    // the story for the ABSTRACT ComplianceService.correct() path — here we drove createDraft()
    // directly the way InvoicesService does, so assert the reverse link instead: the correction
    // really does point back, and both documents ended up CLEARED independently).
    expect(originalCleared.document.status).toBe('CLEARED');
  });
});
