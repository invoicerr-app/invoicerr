/**
 * ES-D1 — the Veri*Factu hash chain, end to end.
 *
 * The huella ALGORITHM was never broken: `generators.spec.ts` reproduces AEAT's two published
 * worked examples ("Especificaciones técnicas para generación de la huella o hash", v0.1.2 of
 * 2024-08-27) byte-for-byte, chained case included. What was broken is that nothing ever fed the
 * algorithm a previous link — `previousHuella` defaulted to `''`, no caller overrode it, and every
 * registro therefore declared `PrimerRegistro='S'`. A chain of length one, repeated, where art.
 * 8.2.b of RD 1007/2023 requires each registro to be tied to its predecessor.
 *
 * This spec issues three consecutive registros through the real handler and verifies the chain
 * they form — the property no unit test of the pure generator could establish, because the link
 * lookup is I/O.
 */
import { createHash } from 'node:crypto';
import { CompliancePlan } from '../engine/compliance-engine';
import { TransactionContext } from '../canonical/canonical-document';
import { RecordingComplianceLogger } from '../execution/logger';
import { VerifactuReportingHandler } from './handlers';
import { ReportRecord, ReportingStore } from './reporting-store';
import { VerifactuRegistroPayload } from './generators';

/** In-memory ReportingStore with the ordering semantics of the Prisma implementation. */
class MemoryReportingStore implements ReportingStore {
  readonly records: ReportRecord[] = [];

  async find(
    kind: string,
    periodKey: string,
    companyId: string | null,
    invoiceRef: string | null,
  ): Promise<ReportRecord | null> {
    return (
      this.records.find(
        (r) =>
          r.kind === kind &&
          r.periodKey === periodKey &&
          r.companyId === companyId &&
          r.invoiceRef === invoiceRef,
      ) ?? null
    );
  }

  async create(record: Omit<ReportRecord, 'id' | 'createdAt'>): Promise<ReportRecord> {
    // Monotonic ids AND monotonic timestamps, so "newest" stays unambiguous even when three
    // records are created inside the same millisecond — the tie-break the Prisma query relies on.
    const row: ReportRecord = {
      ...record,
      id: `rec-${String(this.records.length).padStart(4, '0')}`,
      createdAt: new Date(1_800_000_000_000 + this.records.length),
    };
    this.records.push(row);
    return row;
  }

  async markSubmitted(): Promise<void> {}

  async findPendingForClosedPeriods(): Promise<ReportRecord[]> {
    return [];
  }

  async findLastByKindAndCompany(kind: string, companyId: string | null): Promise<ReportRecord | null> {
    if (!companyId) return null;
    const matches = this.records
      .filter((r) => r.kind === kind && r.companyId === companyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    return matches[0] ?? null;
  }
}

function esCtx(externalRef: string, companyId: string | undefined = 'company-es-1'): TransactionContext {
  return {
    supplier: {
      legalName: 'Ibérica Soluciones SL',
      countryCode: 'ES',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'ESB12345674' }],
      address: { line1: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', countryCode: 'ES' },
    },
    buyer: {
      legalName: 'Cliente Español SL',
      countryCode: 'ES',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'ESA87654321' }],
    },
    lines: [
      {
        id: 'L1',
        description: 'Servicios de consultoría',
        quantity: 1,
        unitNetMinor: 100000,
        supplyType: 'SERVICES',
      },
    ],
    issueDate: new Date('2026-06-15T00:00:00Z'),
    currency: 'EUR',
    externalRef,
    supplierCompanyId: companyId,
  } as unknown as TransactionContext;
}

function esPlan(): CompliancePlan {
  return {
    supplier: { country: 'ES', confidence: 'OFFICIAL' },
    buyer: { country: 'ES', confidence: 'OFFICIAL' },
    classification: { buyerRole: 'B2B', crossBorder: false, supplyTypes: ['SERVICES'] },
    tax: {
      lines: [
        {
          lineId: 'L1',
          treatment: {
            components: [{ taxSystem: 'VAT', name: 'IVA', category: 'S', rate: 21, jurisdiction: 'ES' }],
            buyerSelfAssess: false,
            reportingFlags: ['VERIFACTU'],
            mentions: [],
          },
        },
      ],
      reportingFlags: ['VERIFACTU'],
      mentions: [],
      buyerSelfAssess: false,
    },
    taxSystemKind: 'VAT',
    regime: { model: 'REAL_TIME_REPORTING', blocking: false },
    artifacts: [{ role: 'AUTHORITATIVE', syntax: 'ES_FACTURAE' }],
    channels: [{ type: 'GOV_PORTAL_API', providerId: 'es-aeat' }],
    numbering: { model: 'GAPLESS_SELF' },
  } as unknown as CompliancePlan;
}

/** Recompute the huella from the payload's own fields — independent of what the generator returned. */
function recomputeHuella(p: VerifactuRegistroPayload): string {
  const canonical =
    `IDEmisorFactura=${p.registro.idEmisorFactura}` +
    `&NumSerieFactura=${p.registro.numSerieFactura}` +
    `&FechaExpedicionFactura=${p.registro.fechaExpedicionFactura}` +
    `&TipoFactura=${p.registro.tipoFactura}` +
    `&CuotaTotal=${p.registro.cuotaTotal}` +
    `&ImporteTotal=${p.registro.importeTotal}` +
    `&Huella=${p.previousHuella}` +
    `&FechaHoraHusoGenRegistro=${p.registro.fechaHoraHusoGenRegistro}`;
  return createHash('sha256').update(Buffer.from(canonical, 'utf-8')).digest('hex').toUpperCase();
}

async function emit(
  handler: VerifactuReportingHandler,
  store: MemoryReportingStore,
  ref: string,
): Promise<VerifactuRegistroPayload> {
  const before = store.records.length;
  await handler.report(esCtx(ref), esPlan(), new RecordingComplianceLogger());
  expect(store.records.length).toBe(before + 1);
  return store.records[before].payload as VerifactuRegistroPayload;
}

describe('ES-D1: three consecutive registros form a verifiable chain', () => {
  it('links each record to its predecessor, with PrimerRegistro=S on the first one only', async () => {
    const store = new MemoryReportingStore();
    const handler = new VerifactuReportingHandler(store);

    const r1 = await emit(handler, store, 'FA-001');
    const r2 = await emit(handler, store, 'FA-002');
    const r3 = await emit(handler, store, 'FA-003');

    // 1. Only the first record opens the chain. This is the exact regression: before the fix all
    //    three were `primerRegistro: true` with an empty previousHuella.
    expect([r1.primerRegistro, r2.primerRegistro, r3.primerRegistro]).toEqual([true, false, false]);
    expect(r1.previousHuella).toBe('');

    // 2. Each subsequent record chains the PREVIOUS record's huella, in order.
    expect(r2.previousHuella).toBe(r1.huella);
    expect(r3.previousHuella).toBe(r2.huella);

    // 3. The chain is verifiable end to end: recomputing every huella from the record's own fields
    //    reproduces the stored value, so an auditor walking from r1 arrives at r3.
    for (const r of [r1, r2, r3]) {
      expect(recomputeHuella(r)).toBe(r.huella);
      expect(r.huella).toMatch(/^[0-9A-F]{64}$/);
    }

    // 4. Distinct links — a repeated huella would mean the chain collapsed back to length one.
    expect(new Set([r1.huella, r2.huella, r3.huella]).size).toBe(3);
  });

  it('keeps each issuer on its own chain', async () => {
    const store = new MemoryReportingStore();
    const handler = new VerifactuReportingHandler(store);
    const log = new RecordingComplianceLogger();

    await handler.report(esCtx('FA-001', 'company-a'), esPlan(), log);
    await handler.report(esCtx('FA-002', 'company-b'), esPlan(), log);

    const [a, b] = store.records.map((r) => r.payload as VerifactuRegistroPayload);
    // company-b's first registro must open its OWN chain, not graft onto company-a's. Chaining
    // across tenants would be worse than not chaining at all.
    expect(a.primerRegistro).toBe(true);
    expect(b.primerRegistro).toBe(true);
    expect(b.previousHuella).toBe('');
  });

  it('does not chain a document that has no issuing company', async () => {
    const store = new MemoryReportingStore();
    const handler = new VerifactuReportingHandler(store);

    await handler.report(esCtx('FA-001', undefined), esPlan(), new RecordingComplianceLogger());

    const p = store.records[0].payload as VerifactuRegistroPayload;
    expect(p.primerRegistro).toBe(true);
    expect(p.previousHuella).toBe('');
  });

  it('warns instead of silently restarting the chain when the predecessor has no readable huella', async () => {
    const store = new MemoryReportingStore();
    const handler = new VerifactuReportingHandler(store);
    // A row written by an older build: present, but with no huella in its Json payload.
    await store.create({
      kind: 'VERIFACTU',
      periodKey: '2026-06',
      companyId: 'company-es-1',
      invoiceRef: 'LEGACY',
      status: 'PENDING',
      payload: { note: 'written before the chain existed' },
      submittedRef: null,
      submittedAt: null,
    });

    const log = new RecordingComplianceLogger();
    await handler.report(esCtx('FA-001'), esPlan(), log);

    const warned = log.entries.some((e) => e.level === 'warn' && e.message.includes('BREAK the chain'));
    expect(warned).toBe(true);
  });
});
