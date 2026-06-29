/**
 * InboundInvoiceService — unit tests.
 *
 * Uses a mocked PrismaService so no DB is required.
 * Covers: receive + dedup, parse CII, parse FatturaPA, accept/reject path.
 */
import { InboundInvoiceService } from './inbound-invoice.service';
import { HttpException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Sample payloads — minimal but structurally correct
// ---------------------------------------------------------------------------

const SAMPLE_CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>M1</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>INV-2026-0042</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">20260601</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Acme SAS</ram:Name>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">FR12345678901</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Client Corp</ram:Name>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">FR98765432109</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>1000.00</ram:LineTotalAmount>
        <ram:TaxTotalAmount>200.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>1200.00</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

const SAMPLE_FATTURAPA = `<?xml version="1.0" encoding="UTF-8"?>
<FatturaElettronica versione="FPA12"
  xmlns="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>01234567890</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>Fornitore SRL</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>09876543210</IdCodice>
        </IdFiscaleIVA>
      </DatiAnagrafici>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-06-01</Data>
        <Numero>FT/2026/0099</Numero>
        <ImportoTotaleDocumento>610.00</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DatiRiepilogo>
        <AliquotaIVA>10.00</AliquotaIVA>
        <ImponibileImporto>100.00</ImponibileImporto>
        <Imposta>10.00</Imposta>
      </DatiRiepilogo>
      <DatiRiepilogo>
        <AliquotaIVA>22.00</AliquotaIVA>
        <ImponibileImporto>500.00</ImponibileImporto>
        <Imposta>110.00</Imposta>
      </DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</FatturaElettronica>`;

const SAMPLE_FA_VAT = JSON.stringify({
  Faktura: {
    Podmiot1: {
      DaneIdentyfikacyjne: {
        NIP: '1234567890',
        PelnaNazwa: 'Dostawca Sp. z o.o.',
      },
    },
    Podmiot2: {
      DaneIdentyfikacyjne: {
        NIP: '9876543210',
      },
    },
    Fa: {
      P_1: '2026-06-01',
      P_2: 'FV/2026/001',
      KodWaluty: 'PLN',
      P_13_1: 1000,
      P_14_1: 230,
      P_15: 1230,
    },
  },
});

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  const store = new Map<string, any>();
  let idSeq = 0;

  return {
    inboundInvoice: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = `${where?.channel_externalId?.channel}:${where?.channel_externalId?.externalId}`;
        return store.get(key) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ibi_${++idSeq}`, ...data, receivedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
        const key = `${data.channel}:${data.externalId}`;
        store.set(key, row);
        return row;
      }),
      findMany: jest.fn(async () => [...store.values()]),
      count: jest.fn(async () => store.size),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const row of store.values()) {
          if (row.id === where.id && row.companyId === where.companyId) return row;
        }
        return null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        for (const [k, row] of store.entries()) {
          if (row.id === where.id) {
            const updated = { ...row, ...data };
            store.set(k, updated);
            return updated;
          }
        }
        throw new Error(`not found: ${where.id}`);
      }),
    },
    $transaction: jest.fn(async (fns: unknown[]) => {
      const results: unknown[] = [];
      for (const fn of fns) {
        results.push(await fn);
      }
      return results;
    }),
    _store: store,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InboundInvoiceService', () => {
  let service: InboundInvoiceService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    service = new InboundInvoiceService(mockPrisma as any);
  });

  // ---- CII parsing ----

  it('parses a CII invoice into canonical fields', async () => {
    const result = await service.receiveDocument({
      companyId: 'co-1',
      channel: 'PDP',
      externalId: 'pdp-42',
      rawPayload: SAMPLE_CII,
      syntax: 'EN16931_CII',
    });

    expect(result.kind).toBe('STORED');

    const created = mockPrisma.inboundInvoice.create.mock.calls[0][0].data;
    expect(created.invoiceNumber).toBe('INV-2026-0042');
    expect(created.issueDate).toBe('2026-06-01');
    expect(created.sellerName).toBe('Acme SAS');
    expect(created.sellerTaxId).toBe('FR12345678901');
    expect(created.buyerTaxId).toBe('FR98765432109');
    expect(created.currency).toBe('EUR');
    expect(created.totalNet).toBeCloseTo(1000);
    expect(created.totalTax).toBeCloseTo(200);
    expect(created.totalGross).toBeCloseTo(1200);
    expect(created.status).toBe('PARSED');
  });

  // ---- FatturaPA parsing ----

  it('parses a FatturaPA invoice into canonical fields', async () => {
    const result = await service.receiveDocument({
      companyId: 'co-1',
      channel: 'SDI',
      externalId: 'sdi-99',
      rawPayload: SAMPLE_FATTURAPA,
      syntax: 'FATTURAPA',
    });

    expect(result.kind).toBe('STORED');

    const created = mockPrisma.inboundInvoice.create.mock.calls[0][0].data;
    expect(created.invoiceNumber).toBe('FT/2026/0099');
    expect(created.issueDate).toBe('2026-06-01');
    expect(created.sellerName).toBe('Fornitore SRL');
    expect(created.sellerTaxId).toBe('01234567890');
    expect(created.buyerTaxId).toBe('09876543210');
    expect(created.currency).toBe('EUR');
    expect(created.totalNet).toBeCloseTo(600);   // 100 + 500
    expect(created.totalTax).toBeCloseTo(120);   // 10 + 110
    expect(created.totalGross).toBeCloseTo(610);
    expect(created.status).toBe('PARSED');
  });

  // ---- FA_VAT (KSeF JSON) parsing ----

  it('parses a FA_VAT (KSeF JSON) invoice into canonical fields', async () => {
    const result = await service.receiveDocument({
      companyId: 'co-1',
      channel: 'GOV_PORTAL_API',
      providerId: 'ksef',
      externalId: 'ksef-ref-001',
      rawPayload: SAMPLE_FA_VAT,
      syntax: 'FA_VAT',
    });

    expect(result.kind).toBe('STORED');

    const created = mockPrisma.inboundInvoice.create.mock.calls[0][0].data;
    expect(created.invoiceNumber).toBe('FV/2026/001');
    expect(created.issueDate).toBe('2026-06-01');
    expect(created.sellerName).toBe('Dostawca Sp. z o.o.');
    expect(created.sellerTaxId).toBe('1234567890');
    expect(created.buyerTaxId).toBe('9876543210');
    expect(created.currency).toBe('PLN');
    expect(created.totalGross).toBeCloseTo(1230);
    expect(created.status).toBe('PARSED');
  });

  // ---- Dedup: same (channel, externalId) → DUPLICATE, no second row ----

  it('deduplicates by (channel, externalId) — second call returns DUPLICATE without inserting', async () => {
    await service.receiveDocument({
      companyId: 'co-1',
      channel: 'PDP',
      externalId: 'pdp-dup-1',
      rawPayload: SAMPLE_CII,
    });

    // Simulate findUnique returning the existing row (store already has it)
    const second = await service.receiveDocument({
      companyId: 'co-1',
      channel: 'PDP',
      externalId: 'pdp-dup-1',
      rawPayload: SAMPLE_CII,
    });

    expect(second.kind).toBe('DUPLICATE');
    // create was only called once
    expect(mockPrisma.inboundInvoice.create).toHaveBeenCalledTimes(1);
  });

  // ---- Accept path ----

  it('accept() sets status to ACCEPTED', async () => {
    const storeResult = await service.receiveDocument({
      companyId: 'co-1',
      channel: 'SDI',
      externalId: 'sdi-accept-1',
      rawPayload: SAMPLE_FATTURAPA,
    });
    const id = storeResult.id;

    const result = await service.acceptOrReject(id, 'co-1', 'accept');
    expect(result.status).toBe('ACCEPTED');
    expect(mockPrisma.inboundInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
    );
  });

  // ---- Reject path ----

  it('reject() sets status to REJECTED with reason', async () => {
    const storeResult = await service.receiveDocument({
      companyId: 'co-1',
      channel: 'PEPPOL',
      externalId: 'peppol-reject-1',
      rawPayload: SAMPLE_CII,
    });
    const id = storeResult.id;

    const result = await service.acceptOrReject(id, 'co-1', 'reject', 'wrong VAT number');
    expect(result.status).toBe('REJECTED');
  });

  // ---- Double-accept → 409 Conflict ----

  it('double-accept throws 409 Conflict', async () => {
    const storeResult = await service.receiveDocument({
      companyId: 'co-1',
      channel: 'SDI',
      externalId: 'sdi-double-1',
      rawPayload: SAMPLE_FATTURAPA,
    });
    const id = storeResult.id;

    await service.acceptOrReject(id, 'co-1', 'accept');

    await expect(service.acceptOrReject(id, 'co-1', 'accept')).rejects.toBeInstanceOf(HttpException);
  });

  // ---- Not found ----

  it('getOne throws 404 for unknown id', async () => {
    await expect(service.getOne('no-such-id', 'co-1')).rejects.toBeInstanceOf(HttpException);
  });
});
