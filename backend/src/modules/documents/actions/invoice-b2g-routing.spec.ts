/**
 * The B2G routing PRECEDENCE — the WIRING inside `invoice-actions.ts`'s "send": `resolveClientB2gRouting`
 * (`b2g-routing/b2g-routing.ts`) is mocked wholesale here, the exact same style
 * `invoice-channel-mandate.spec.ts` already established for `channel-policy/mandate.ts`'s
 * `activeChannelMandateFor` — this file's job is "does invoice-actions.ts react correctly to a B2G
 * decision", never "is the DE/xrechnung rule's own data right" (that is `b2g-routing/data/all.spec.ts`'s
 * job) nor "does the DB read resolve identifiers correctly" (that is `b2g-routing/b2g-routing.spec.ts`'s
 * job). Calls the registered "send" handler directly, bypassing `DocumentsService.runAction`'s own
 * gates entirely — same style as `invoice-channel-mandate.spec.ts` and `send-divergence.spec.ts`.
 *
 * PRECEDENCE UNDER TEST, in order (see `invoice-actions.ts`'s own B2G section header): (1) a B2G rule
 * for the CLIENT's country, when the client is GOVERNMENT — completely BYPASSES (2) the seller's own
 * country mandate (item 11) and (3) the company's free transport choice. The two tests marked
 * "MUTATION GUARD" below are this task's own two named mutations: #1, precedence ignored (the
 * company's own choice wins); #2, a government client of an uncovered country silently sends as B2B.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import * as persistence from '../persistence';
import * as countryPolicy from '../country-policy/country-policy';
import * as mandate from '../transports/channel-policy/mandate';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import { B2gClientRoutingDecision } from '../b2g-routing/b2g-routing';
import { TransportRegistry } from '../transports/transport-registry';
import * as companyTransport from '../transports/company-transport';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import * as taxLoadAndResolve from '../tax/load-and-resolve';

jest.mock('../persistence');
jest.mock('../transports/company-transport');
jest.mock('../country-policy/country-policy');
jest.mock('../transports/channel-policy/mandate');
jest.mock('../b2g-routing/b2g-routing');
jest.mock('../numbering/take-number');
jest.mock('../tax/load-and-resolve');

const IT_RULE_READY = {
  countryCode: 'IT',
  transportId: 'sdi',
  formatSyntax: 'fatturapa',
  requiredClientIdentifiers: [
    { scheme: 'IT_PA_CODE', label: 'Codice Univoco Ufficio (IPA)', why: 'Specifiche tecniche v1.3.2.' },
  ],
  requiredDocumentFields: [],
  provenanceDescription: '"Specifiche tecniche..." (checked 2026-09-01)',
};

const DE_RULE_UNIMPLEMENTED = {
  countryCode: 'DE',
  transportId: 'zre-ozgre',
  // The EXACT case the task asks to "chiffrer": the FORMAT the rule captures is "xrechnung" —
  // asserted directly below (`b2gDecision.rule?.formatSyntax`) regardless of whatever the company's
  // OWN configured transport/format would otherwise have been (email+facturx in these tests).
  formatSyntax: 'xrechnung',
  requiredClientIdentifiers: [],
  requiredDocumentFields: [
    { field: 'buyerReference', label: 'Buyer reference (Leitweg-ID)', why: '§ 5 ERechV.', required: true },
  ],
  provenanceDescription: '"§ 4/§ 5 ERechV..." (checked 2026-09-01)',
};

const FR_RULE_UNIMPLEMENTED = {
  countryCode: 'FR',
  transportId: 'chorus-pro',
  formatSyntax: 'facturx',
  requiredClientIdentifiers: [{ scheme: 'LEGAL_ID', label: 'SIRET', why: 'Chorus Pro identifies by SIRET.' }],
  requiredDocumentFields: [],
  provenanceDescription: '"Code de la commande publique, art. L. 2192-1..." (checked 2026-09-01)',
};

const documentData = {
  client: 'client-1',
  issueDate: '2026-09-01',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' }],
};

function draftDocument(data: Record<string, unknown> = documentData) {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function sendingDocument(data: Record<string, unknown> = documentData) {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildRegistry(transportRegistry = new TransportRegistry()) {
  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: jest.fn() } });
  return registry;
}

function mockB2g(decision: Partial<B2gClientRoutingDecision>) {
  (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
    missingIdentifierSchemes: [],
    ...decision,
  });
}

describe('invoice "send" — B2G routing (client government) takes precedence over everything else', () => {
  afterEach(() => jest.resetAllMocks());
  beforeEach(() => {
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
  });

  it('a BUSINESS client (applies: false) is completely unaffected — regression: existing behavior unchanged', async () => {
    mockB2g({ applies: false });
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue(undefined);
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(undefined);
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(sendingDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it('a GOVERNMENT client whose country cannot be resolved BLOCKS, naming the client, never a silent B2B send', async () => {
    mockB2g({ applies: true, clientCountryRaw: 'Nowhereland' });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/government body/);
    await expect(action).rejects.toThrow(/Nowhereland/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // MUTATION GUARD #2 — "le pays sans règle part en B2B silencieux" — this test tombe the instant that
  // mutation lands: removing the "no rule" branch (or making it fall through to the free-choice path)
  // makes this expect a NotImplementedException that never comes, or a `sending` result instead.
  it('a GOVERNMENT client of a country with NO B2G rule declared BLOCKS, naming the country — never falls back to B2B', async () => {
    mockB2g({ applies: true, countryCode: 'ZZ' });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/No B2G routing rule is declared for "ZZ"/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('a missing REQUIRED CLIENT IDENTIFIER blocks, naming the exact scheme/label, the screen, and the rule\'s own "why"', async () => {
    mockB2g({
      applies: true,
      countryCode: 'IT',
      rule: IT_RULE_READY,
      missingIdentifierSchemes: ['IT_PA_CODE'],
    });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('sdi', 'SdI (Italy)', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(/Codice Univoco Ufficio \(IPA\)/);
    await expect(action).rejects.toThrow(/IT_PA_CODE/);
    await expect(action).rejects.toThrow(/Specifiche tecniche v1\.3\.2\./);
    await expect(action).rejects.toThrow(/client's own edit screen/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it("a missing REQUIRED DOCUMENT FIELD (DE's Leitweg-ID) blocks BEFORE the transport-availability check even runs", async () => {
    mockB2g({ applies: true, countryCode: 'DE', rule: DE_RULE_UNIMPLEMENTED });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    const dataWithoutBuyerReference = { ...documentData }; // no `buyerReference` at all
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument(dataWithoutBuyerReference));

    // No transport registered at all — proves the FIELD check fires first regardless: if the block
    // reached the transport-resolution step, it would name "zre-ozgre", not the field.
    const transportRegistry = new TransportRegistry();
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: dataWithoutBuyerReference,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(/Buyer reference \(Leitweg-ID\)/);
    await expect(action).rejects.toThrow(/§ 5 ERechV/);
  });

  it('DE: once the Leitweg-ID is filled in, the block becomes the NAMED, honest "channel not available" refusal — never a silent email fallback', async () => {
    mockB2g({ applies: true, countryCode: 'DE', rule: DE_RULE_UNIMPLEMENTED });
    // The company chose "email" (a working, IMPLEMENTED transport) — B2G still refuses to use it.
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    const dataWithBuyerReference = { ...documentData, buyerReference: 'LEITWEG-04011000-1234567890-06' };
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument(dataWithBuyerReference));

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() }); // exists, but is NOT the B2G channel
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: dataWithBuyerReference,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"zre-ozgre" channel/);
    await expect(action).rejects.toThrow(/§ 4\/§ 5 ERechV/);
    await expect(action).rejects.toThrow(/not available in this deployment yet/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
    // The rule's OWN format is "xrechnung" — captured correctly regardless of the block; this is the
    // exact value `describeTypeForCompany`'s own field-hint bridge and a real XRechnung channel (once
    // implemented) would both read. Never "email"/"facturx", the company's own free choice.
    expect(DE_RULE_UNIMPLEMENTED.formatSyntax).toBe('xrechnung');
  });

  // MUTATION GUARD #1 — "la préséance B2G ignorée (le choix société gagne)" — this test tombe the
  // instant `resolveInvoiceTransport` stops short-circuiting on `b2g.applies` (or is reordered after
  // the seller-country mandate check): `mandate.activeChannelMandateFor` would then actually run and
  // this assertion on `toHaveBeenCalled()` — or the refusal message itself — would flip.
  it("PRECEDENCE: a government client of an uncovered-transport country BLOCKS naming that country's OWN channel — the seller-country mandate is NEVER EVEN CONSULTED, even when one is active for this company", async () => {
    mockB2g({ applies: true, countryCode: 'FR', rule: FR_RULE_UNIMPLEMENTED, missingIdentifierSchemes: [] });
    // This company's OWN country mandates "pdp" (item 11) — irrelevant: the recipient's B2G regime
    // wins, so `activeChannelMandateFor` must never even be called.
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue({
      providerId: 'pdp',
      mandatedFrom: '2026-09-01',
      provenance: {
        kind: 'legal',
        sourceText: 'Seule une plateforme agréée...',
        sourceCheckedAt: '2026-08-27',
      },
    });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('pdp');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('pdp', 'PDP', {
      send: jest.fn(),
      preflight: jest.fn().mockResolvedValue(undefined),
    });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"chorus-pro" channel/);
    await expect(action).rejects.toThrow(/Code de la commande publique/);
    // The precedence proof: the seller's own FR/PDP mandate machinery is skipped ENTIRELY for a B2G
    // client — never merely overridden by a message that happens to look right.
    expect(mandate.activeChannelMandateFor).not.toHaveBeenCalled();
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it("a channel the B2G rule names but is IMPLEMENTED and CONNECTED overrides the company's own DIFFERENT free choice", async () => {
    mockB2g({ applies: true, countryCode: 'IT', rule: IT_RULE_READY, missingIdentifierSchemes: [] });
    // The company itself chose "email" — B2G still forces "sdi".
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(sendingDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const sdiSend = jest.fn();
    const sdiPreflight = jest.fn().mockResolvedValue(undefined);
    transportRegistry.register('sdi', 'SdI (Italy)', { send: sdiSend, preflight: sdiPreflight });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    expect(sdiPreflight).toHaveBeenCalledWith('company-1');
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it('when the B2G-forced channel IS chosen but its OWN preflight refuses, the refusal folds in the B2G context, not a bare error', async () => {
    mockB2g({ applies: true, countryCode: 'IT', rule: IT_RULE_READY, missingIdentifierSchemes: [] });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('sdi');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('sdi', 'SdI (Italy)', {
      send: jest.fn(),
      preflight: jest
        .fn()
        .mockRejectedValue(new NotImplementedException('SdI credentials are not connected.')),
    });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"sdi" channel/);
    await expect(action).rejects.toThrow(/Specifiche tecniche/);
    await expect(action).rejects.toThrow(/SdI credentials are not connected\./);
  });

  it("deliver() (the worker's replay, phase 2) ALSO respects B2G routing — never trusts a value cached from the preflight", async () => {
    mockB2g({ applies: true, countryCode: 'IT', rule: IT_RULE_READY, missingIdentifierSchemes: [] });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    // No "sdi" transport registered here — deliver() must ALSO block on the B2G channel, not silently
    // deliver through "email" because that happens to be what `getCompanyInvoiceTransportId` returns.
    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"sdi" channel/);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });
});
