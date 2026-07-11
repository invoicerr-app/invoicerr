/**
 * Peppol live round-trip via peppol.sh — ZERO-SECRET self-signup (Ethereal pattern).
 *
 * Gate: PEPPOL_LIVE=1 AND PEPPOL_AP_PROVIDER=peppol-sh. No credentials required:
 * when PEPPOL_SH_API_KEY is absent the spec signs up on the peppol.sh sandbox itself
 * (POST /v1/signup → instant ps_test_ key), creates a sending company, and runs the
 * full provider path against the REAL sandbox API:
 *
 *   buildEInvoice → UBL → PeppolTransmissionProvider.transmit (apProvider=peppol-sh)
 *   → doc_… id → poll → CLEARED (sandbox delivers by email; statuses are real:
 *   queued → sending → delivered).
 *
 * Optional env:
 *   PEPPOL_SH_API_KEY / PEPPOL_SH_COMPANY_ID — reuse an existing sandbox account
 *   PEPPOL_RECEIVER_ID                        — explicit receiver peppol id (scheme:id);
 *                                               default exercises tax_id-based routing.
 *
 * HARD-SUCCESS CONTRACT (ksef-mock-tests-false-confidence): SKIPPED and REJECTED fail
 * the test; the poll must reach CLEARED (peppol.sh 'delivered'), not merely PENDING.
 */
import { liveDescribe } from '../live-gate.js';

const describeLive =
  process.env.PEPPOL_AP_PROVIDER === 'peppol-sh' ? liveDescribe('PEPPOL_LIVE', []) : describe.skip;

describeLive('Peppol live round-trip via peppol.sh (zero-secret sandbox)', () => {
  it('self-signup → company → UBL → transmit → doc_ id → poll → CLEARED', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??=
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const timestamp = Date.now();
    const supplierVat = 'FR32123456789';
    const buyerVat = 'DE811907980';

    // ── Bootstrap: reuse env credentials or self-signup on the sandbox ──
    const { PeppolShApClient } = await import('./peppol-sh-client.js');

    let apiKey = process.env.PEPPOL_SH_API_KEY;
    let apCompanyId = process.env.PEPPOL_SH_COMPANY_ID;

    if (!apiKey) {
      const email = `invoicerr-live-${timestamp}@example.com`;
      const signup = await PeppolShApClient.signup(email, 'Invoicerr Live Test');
      apiKey = signup.apiKey;
      apCompanyId = undefined; // fresh account → fresh company
      console.log(`peppol.sh self-signup OK: account ${signup.accountId} (${email})`);
      // The API key itself is never logged.
    }
    if (!apCompanyId) {
      const created = await PeppolShApClient.createCompany(apiKey, {
        name: 'Invoicerr Live Test Co',
        taxId: supplierVat,
        country: 'FR',
        address: { street: '1 Test Street', city: 'Paris', postal_code: '75001' },
      });
      apCompanyId = created.companyId;
      console.log(`peppol.sh company created: ${apCompanyId}`);
    }
    expect(apiKey).toBeTruthy();
    expect(apCompanyId).toMatch(/^com_/);

    // ── Generate a UBL invoice with the real builder (DB-free) ──
    const { InvoiceRenderingService } = await import(
      '../../../../modules/invoice-rendering/invoice-rendering.service.js'
    );
    const service = new InvoiceRenderingService();
    const now = new Date();

    const inv = service.buildEInvoice({
      rawNumber: `INV-PEPPOLSH-${timestamp}`,
      number: null,
      issuedAt: now,
      createdAt: now,
      company: {
        name: 'Invoicerr Live Test Co',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: '1 Test Street',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
        phone: '+33100000000',
        email: 'sender@example.com',
        partyIdentifiers: [{ scheme: 'VAT', value: supplierVat }],
      },
      client: {
        type: 'COMPANY',
        name: 'Test Receiver GmbH',
        description: null,
        foundedAt: null,
        contactFirstname: null,
        contactLastname: null,
        contactEmail: 'receiver@example.com',
        contactPhone: null,
        salutation: null,
        sex: null,
        title: null,
        isActive: true,
        address: '2 Receiver Lane',
        city: 'Berlin',
        postalCode: '10115',
        country: 'Germany',
        partyIdentifiers: [{ scheme: 'VAT', value: buyerVat }],
      },
      items: [
        {
          name: 'peppol.sh live test service',
          quantity: 1,
          unitPrice: 100,
          vatRate: 20,
          type: 'SERVICE',
        },
      ],
    } as any);

    const ublXml = await inv.exportXml('ubl');
    console.log('UBL XML length:', ublXml.length);
    expect(ublXml).toContain('Invoice');

    // ── Transmit through the real provider path (adapter resolved from config) ──
    const { PeppolTransmissionProvider } = await import('../providers.js');
    const { RecordingComplianceLogger } = await import('../../../execution/logger.js');

    const companyId = `live_peppolsh_${timestamp}`;
    const receiverId = process.env.PEPPOL_RECEIVER_ID; // optional; default = tax_id routing

    const fakeResolvedConfig = {
      providerId: 'peppol',
      channel: 'PEPPOL',
      environment: 'TEST',
      config: {
        apProvider: 'peppol-sh',
        apiKey,
        apCompanyId,
        participantId: `9957:${supplierVat}`,
        environment: 'TEST',
      },
      isActive: true,
    };

    const stubCredentials = {
      resolve: async () => fakeResolvedConfig,
      resolveActive: async () => fakeResolvedConfig,
    };

    // No injected apPort/smpPort — the provider must resolve the peppol.sh adapter itself.
    const peppol = new PeppolTransmissionProvider(stubCredentials as any);

    const artifact = {
      role: 'AUTHORITATIVE' as const,
      syntax: 'PEPPOL_BIS' as const,
      mime: 'application/xml',
      bytes: Buffer.from(ublXml, 'utf8'),
    };

    const log = new RecordingComplianceLogger();
    const ctx = {
      supplier: {
        legalName: 'Invoicerr Live Test Co',
        countryCode: 'FR',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: supplierVat, validated: true }],
        peppolId: `9957:${supplierVat}`,
      },
      buyer: {
        legalName: 'Test Receiver GmbH',
        countryCode: 'DE',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: buyerVat, validated: true }],
        ...(receiverId ? { peppolId: receiverId } : {}),
      },
      lines: [],
      issueDate: now,
      currency: 'EUR',
      supplierCompanyId: companyId,
    } as any;

    const transmitResult = await peppol.transmit(
      [artifact],
      ctx,
      { channels: [{ type: 'PEPPOL', providerId: 'peppol' }] } as any,
      `peppolsh-live-${timestamp}`,
      log,
      fakeResolvedConfig as any,
    );

    console.log('peppol.sh transmit result:', JSON.stringify(transmitResult, null, 2));

    // Hard assertions — REJECTED or SKIPPED are NOT tolerated.
    if (transmitResult.status === 'REJECTED' || transmitResult.status === 'SKIPPED') {
      const notes = (transmitResult.notes ?? []).join(' | ');
      throw new Error(`peppol.sh transmit returned ${transmitResult.status} — hard failure. Notes: ${notes}`);
    }
    expect(['PENDING', 'SENT']).toContain(transmitResult.status);
    expect(transmitResult.ref).toBeTruthy();

    const [, documentId] = (transmitResult.ref ?? '').split('|');
    expect(documentId).toMatch(/^doc_/);
    console.log('peppol.sh document id:', documentId);

    // ── Poll to a TERMINAL OK status (sandbox: queued → sending → delivered) ──
    const MAX_POLLS = 24;
    const POLL_INTERVAL_MS = 5_000;
    let pollResult: any;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      pollResult = await peppol.poll(transmitResult.ref!, log);
      console.log(`Poll ${i + 1}/${MAX_POLLS}:`, pollResult.status, (pollResult.notes ?? []).join(' | '));
      if (pollResult.status === 'CLEARED' || pollResult.status === 'REJECTED') break;
    }

    console.log('Final peppol.sh poll:', JSON.stringify(pollResult, null, 2));

    if (pollResult?.status === 'REJECTED') {
      throw new Error(
        `peppol.sh poll returned REJECTED — hard failure. Notes: ${(pollResult.notes ?? []).join(' | ')}`,
      );
    }
    // Terminal success REQUIRED: CLEARED (= peppol.sh 'delivered'). PENDING is a failure.
    expect(pollResult?.status).toBe('CLEARED');
  }, 240_000);
});
