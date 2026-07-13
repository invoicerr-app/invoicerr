/**
 * Lifecycle coherence tests — §9/§4 of COMPLIANCE_TODO.md.
 *
 * Covers three requirements:
 *   1. FR "encaissée" push — markPaid for FR B2B (post-mandate) fires transmitStatus("encaissée")
 *      via the primary PDP channel (mocked transmission; no live call).
 *   2. MX clearance-blocking guard — PENDING_CLEARANCE blocks all downstream actions
 *      (DELIVER, ACCEPT, etc.); REJECTED clearance is terminal.
 *   3. Per-profile lifecycle coherence — every primary-market profile (FR, PL, IT, DE, ES, MX)
 *      assembles a lifecycle graph with no unreachable (dangling) states.
 */

import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { assembleFromPlan } from './assembler';
import { ComplianceStateMachine } from './state-machine';
import { LifecycleRuntime } from './runtime';
import { parseSdiNotifica } from './drivers/inbound-parsers';
import { RecordingComplianceLogger } from '../execution/logger';
import { ComplianceService } from '../operations/compliance-service';
import { InMemoryComplianceDocumentStore } from '../operations/document-store';
import { ComplianceExecutor } from '../execution/executor';
import { TransmissionProvider } from '../providers/transmission/transmission-provider';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { NumberingRegistry } from './numbering';
import { ConfigAuthorityRangeSource } from './authority-range-source';

// ─────────────────────────── helpers ───────────────────────────

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}

function tx(
  supplier: string,
  buyer: string,
  role: PartyRole,
  supply: SupplyType,
  date: string,
): TransactionContext {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }],
    issueDate: new Date(date),
    currency: 'EUR',
  };
}

const graphOf = (s: string, b: string, r: PartyRole, sup: SupplyType, d: string) =>
  assembleFromPlan(resolve(tx(s, b, r, sup, d)));

/**
 * F-9: pre-configures a generous MX folio range for both the no-company MX context and the
 * mxCtxConfigured() ('mx-test-co') context, so the MX coverage below (clearance-blocking guards,
 * not numbering) keeps reaching ISSUED exactly like before AUTHORITY_RANGE was wired up.
 */
function mxRangeSource(): ConfigAuthorityRangeSource {
  const src = new ConfigAuthorityRangeSource();
  src.configure(undefined, 'MX-INVOICE', { from: 1, to: 999999 });
  src.configure('mx-test-co', 'MX-INVOICE', { from: 1, to: 999999 });
  return src;
}

function svc() {
  const log = new RecordingComplianceLogger();
  const service = new ComplianceService({
    store: new InMemoryComplianceDocumentStore(),
    numbering: new NumberingRegistry(),
    rangeSource: mxRangeSource(),
    executor: new ComplianceExecutor({ logger: log, numbering: new NumberingRegistry() }),
    logger: log,
  });
  return { service, log };
}

/**
 * F-4: send() is now honest about the transmission outcome — reaching PENDING_CLEARANCE requires a
 * channel that genuinely accepted the document. svc() above has no transmission credentials
 * configured, so MX's PAC channel always comes back SKIPPED. This variant wires a company id + a
 * mocked-but-accepting PAC provider so the pre-existing "send() on MX → PENDING_CLEARANCE" coverage
 * keeps exercising the same downstream guards (openResponseWindow / markCleared) as before the fix.
 */
function svcMx() {
  const log = new RecordingComplianceLogger();
  const pacMock: TransmissionProvider = {
    id: 'pac',
    channel: 'PAC',
    feedback: 'ASYNC_POLL',
    configSchema: { fields: [] },
    transmit: async () => ({
      channel: 'PAC',
      status: 'CLEARED',
      ref: 'mx-test-co|test-uuid',
      authorityIds: [{ scheme: 'UUID', value: 'test-uuid' }],
      notes: ['uuid: test-uuid'],
    }),
  };
  const credentials = {
    resolve: async () => null,
    resolveActive: async () => ({
      providerId: 'pac',
      channel: 'PAC' as const,
      environment: 'test',
      config: { baseUrl: 'https://pac.example.test', apiKey: 'k', rfc: 'AAA010101AAA' },
      isActive: true,
    }),
  };
  const transmission = new TransmissionProviderRegistry({ credentials });
  (transmission as unknown as { byId: Map<string, TransmissionProvider> }).byId.set('pac', pacMock);
  (transmission as unknown as { byChannel: Map<string, TransmissionProvider> }).byChannel.set('PAC', pacMock);
  const service = new ComplianceService({
    store: new InMemoryComplianceDocumentStore(),
    numbering: new NumberingRegistry(),
    rangeSource: mxRangeSource(),
    executor: new ComplianceExecutor({
      logger: log,
      numbering: new NumberingRegistry(),
      transmission,
    }),
    logger: log,
  });
  return { service, log };
}

const FR_B2B = () => tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15');
/** MX context carrying a supplierCompanyId so transmitAll() actually resolves per-company config. */
const mxCtxConfigured = (): TransactionContext => ({
  ...tx('MX', 'MX', 'B2B', 'GOODS', '2027-01-15'),
  supplierCompanyId: 'mx-test-co',
});

// ─────────────────────────── §1 FR encaissée push ───────────────────────────

describe('FR encaissée push — markPaid fires transmitStatus', () => {
  it('markPaid on a FR B2B invoice (post-mandate) calls transmitStatus("encaissée")', async () => {
    const { service } = svc();
    // Spy BEFORE issueAndSend so we capture calls during both send and markPaid phases.
    const spy = jest.spyOn(service, 'transmitStatus');

    const { document } = await service.issueAndSend(FR_B2B());
    await service.markPaid(document.id, { paidAt: '2027-02-01T00:00:00.000Z' });

    // transmitStatus must have been invoked specifically with 'encaissée' from markPaid.
    expect(spy).toHaveBeenCalledWith(document.id, 'encaissée');
    spy.mockRestore();
  });

  it('markPaid records STATUS:encaissée event on the document for FR B2B', async () => {
    const { service } = svc();
    const { document } = await service.issueAndSend(FR_B2B());
    const paid = await service.markPaid(document.id, { paidAt: '2027-02-01T00:00:00.000Z' });
    expect(paid.events.some((e) => e.type === 'STATUS:encaissée')).toBe(true);
  });

  it('plan.lifecycle.response.statuses includes "encaissée" for FR B2B post-mandate', () => {
    const plan = resolve(FR_B2B());
    expect(plan.lifecycle.response?.statuses).toContain('encaissée');
  });

  it('transmitStatus for FR resolves the PDP channel and returns a result (QUEUED — no live creds)', async () => {
    const { service } = svc();
    const { document } = await service.issueAndSend(FR_B2B());
    const result = await service.transmitStatus(document.id, 'encaissée');
    // Without live PDP credentials the ref is malformed → QUEUED, but the call was dispatched.
    expect(result).not.toBeNull();
    expect(result!.channel).toBe('PDP');
  });
});

// ─────────────────────────── §2 MX clearance-blocking guard ───────────────────────────

describe('MX clearance-blocking regime — state-machine guards', () => {
  it('PENDING_CLEARANCE does not allow DELIVER (invoice invalid until CLEARED)', () => {
    const sm = new ComplianceStateMachine('PENDING_CLEARANCE');
    expect(sm.can('DELIVER')).toBe(false);
    expect(() => sm.apply('DELIVER')).toThrow(/Illegal transition/);
  });

  it('PENDING_CLEARANCE does not allow OPEN_RESPONSE or ACCEPT', () => {
    const sm = new ComplianceStateMachine('PENDING_CLEARANCE');
    expect(sm.can('OPEN_RESPONSE')).toBe(false);
    expect(sm.can('ACCEPT')).toBe(false);
    expect(sm.can('REPORT')).toBe(false);
  });

  it('REJECTED clearance is terminal — no further transitions allowed', () => {
    const sm = new ComplianceStateMachine('REJECTED');
    expect(sm.isTerminal()).toBe(true);
    expect(sm.can('DELIVER')).toBe(false);
    expect(sm.can('CORRECT')).toBe(false);
    expect(sm.can('CANCEL')).toBe(false);
  });

  it('assembled MX graph: DELIVER transition starts from CLEARED, not from PENDING_CLEARANCE or ISSUED', () => {
    const graph = graphOf('MX', 'MX', 'B2B', 'GOODS', '2027-01-15');
    const deliverTransitions = graph.transitions.filter((t) => t.on === 'DELIVER');
    expect(deliverTransitions.length).toBeGreaterThan(0);
    // All DELIVER edges must start from CLEARED (post-clearance delivery).
    deliverTransitions.forEach((t) => {
      expect(t.from).toBe('CLEARED');
    });
  });

  it('service: send() on MX → PENDING_CLEARANCE; downstream actions blocked until markCleared', async () => {
    // F-4: send() only reaches PENDING_CLEARANCE when a channel genuinely accepted the document —
    // svcMx()/mxCtxConfigured() wire a company id + a mocked-but-accepting PAC provider for that.
    const { service } = svcMx();
    const d = await service.createDraft(mxCtxConfigured());
    await service.issue(d.id);
    const sent = await service.send(d.id);
    // After send, still PENDING_CLEARANCE — legally invalid until the PAC timbra.
    expect(sent.document.status).toBe('PENDING_CLEARANCE');

    // Trying to open the response window while pending is an illegal state transition.
    await expect(service.openResponseWindow(d.id)).rejects.toThrow(/Illegal transition/);

    // After clearance, the doc is CLEARED and delivery is possible.
    const cleared = await service.markCleared(d.id);
    expect(cleared.document.status).toBe('CLEARED');
  });

  // ─────────────────────────── F-4 TRANSMISSION_FAILED state ───────────────────────────

  it('TRANSMISSION_FAILED is reachable from ISSUED and is retryable (not terminal)', () => {
    const sm = new ComplianceStateMachine('ISSUED');
    expect(sm.can('TRANSMISSION_FAIL')).toBe(true);
    expect(sm.apply('TRANSMISSION_FAIL')).toBe('TRANSMISSION_FAILED');
    expect(sm.isTerminal()).toBe(false);
    // Retryable into either downstream path once a channel accepts the document.
    expect(sm.can('SUBMIT_CLEARANCE')).toBe(true);
    expect(sm.can('DELIVER')).toBe(true);
  });

  it('service: MX send() with no accepted channel → TRANSMISSION_FAILED, not PENDING_CLEARANCE', async () => {
    const { service } = svc(); // no PAC credentials configured — the channel SKIPs
    const d = await service.createDraft(tx('MX', 'MX', 'B2B', 'GOODS', '2027-01-15'));
    await service.issue(d.id);
    const sent = await service.send(d.id);
    expect(sent.document.status).toBe('TRANSMISSION_FAILED');
    expect(sent.transmissionFailed).toBe(true);
    // Still blocked from downstream actions that require CLEARED/DELIVERED, same as PENDING_CLEARANCE.
    await expect(service.openResponseWindow(d.id)).rejects.toThrow(/Illegal transition/);
  });
});

// ─────────────────────────── §3 Per-profile lifecycle coherence ───────────────────────────

/**
 * "No dangling states" invariant: every state declared in a profile's assembled lifecycle graph
 * must be reachable from DRAFT via the graph's own transitions. Unreachable states indicate a
 * contributor emitting orphaned nodes — a data-quality error that would confuse UI badge logic.
 */
describe('per-profile lifecycle coherence — no dangling (unreachable) states', () => {
  const PRIMARY_MARKETS: Array<{
    label: string;
    s: string;
    b: string;
    r: PartyRole;
    sup: SupplyType;
    d: string;
  }> = [
    { label: 'FR B2B post-mandate', s: 'FR', b: 'FR', r: 'B2B', sup: 'SERVICES', d: '2027-01-15' },
    { label: 'FR B2C post-mandate', s: 'FR', b: 'FR', r: 'B2C', sup: 'SERVICES', d: '2027-01-15' },
    { label: 'PL KSeF era', s: 'PL', b: 'PL', r: 'B2B', sup: 'GOODS', d: '2027-01-15' },
    { label: 'PL pre-KSeF', s: 'PL', b: 'PL', r: 'B2B', sup: 'GOODS', d: '2025-01-01' },
    { label: 'IT SdI era', s: 'IT', b: 'IT', r: 'B2B', sup: 'GOODS', d: '2027-01-15' },
    { label: 'IT pre-SdI', s: 'IT', b: 'IT', r: 'B2B', sup: 'GOODS', d: '2018-01-01' },
    { label: 'DE XRechnung', s: 'DE', b: 'DE', r: 'B2B', sup: 'GOODS', d: '2027-01-15' },
    { label: 'ES SII era', s: 'ES', b: 'ES', r: 'B2B', sup: 'GOODS', d: '2027-01-15' },
    { label: 'MX CFDI 4.0', s: 'MX', b: 'MX', r: 'B2B', sup: 'GOODS', d: '2027-01-15' },
  ];

  for (const { label, s, b, r, sup, d } of PRIMARY_MARKETS) {
    it(`${label}: assembled graph has no unreachable states`, () => {
      const graph = graphOf(s, b, r, sup, d);

      // BFS from DRAFT to find all reachable states.
      const reachable = new Set<string>(['DRAFT']);
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of graph.transitions) {
          if (reachable.has(t.from) && !reachable.has(t.to)) {
            reachable.add(t.to);
            changed = true;
          }
        }
      }

      const dangling = graph.states.filter((st) => !reachable.has(st));
      expect({ profile: label, danglingStates: dangling }).toEqual({
        profile: label,
        danglingStates: [],
      });
    });
  }

  it('PL KSeF lifecycle: no CANCELLED state in assembled graph (cancellation not allowed)', () => {
    const graph = graphOf('PL', 'PL', 'B2B', 'GOODS', '2027-01-15');
    // KSeF era: cancellation.allowed = false → CANCELLED must not appear in the graph.
    expect(graph.states).not.toContain('CANCELLED');
  });

  it('MX assembled graph: REJECTED state is present and reachable (from PENDING_CLEARANCE)', () => {
    const graph = graphOf('MX', 'MX', 'B2B', 'GOODS', '2027-01-15');
    expect(graph.states).toContain('REJECTED');
    // REJECTED is reachable via REJECT from PENDING_CLEARANCE.
    const rejectTransition = graph.transitions.find((t) => t.to === 'REJECTED');
    expect(rejectTransition).toBeDefined();
    expect(rejectTransition!.from).toBe('PENDING_CLEARANCE');
  });

  it('IT pre-SdI lifecycle: complete pre-mandate lifecycle resolves correctly (no engine default warning)', () => {
    const plan = resolve(tx('IT', 'IT', 'B2B', 'GOODS', '2018-01-01'));
    // With the pre-SdI lifecycle entry, the engine should pick it (not fall back to DEFAULT_LIFECYCLE).
    expect(plan.lifecycle.immutableAfter).toBe('ISSUE');
    // The engine should produce no warnings about missing lifecycle.
    expect(plan.warnings.some((w) => w.includes('No regime'))).toBe(false);
  });

  it('PL pre-KSeF lifecycle: complete pre-mandate lifecycle resolves correctly', () => {
    const plan = resolve(tx('PL', 'PL', 'B2B', 'GOODS', '2025-01-01'));
    expect(plan.lifecycle.immutableAfter).toBe('ISSUE');
    expect(plan.lifecycle.correctionModel).toBe('CREDIT_NOTE');
    expect(plan.lifecycle.cancellation.allowed).toBe(true);
  });
});

// ─────────────────────────── M-7: IT notifica NE (esito EC01/EC02) response track ───────────────────────────

describe('IT SdI era — buyer response track (notifica NE / decorrenza termini)', () => {
  it('plan.lifecycle.response is present with silence=ACCEPT after 360h (15 days)', () => {
    const plan = resolve(tx('IT', 'IT', 'B2B', 'GOODS', '2027-01-15'));
    expect(plan.lifecycle.response).toEqual({
      defaultOnSilence: 'ACCEPT',
      window: { hours: 360 },
      statuses: ['accettata', 'rifiutata'],
    });
  });

  it('IT pre-SdI (pre-2019) lifecycle has no response policy — SdI esito is SdI-era only', () => {
    const plan = resolve(tx('IT', 'IT', 'B2B', 'GOODS', '2018-01-01'));
    expect(plan.lifecycle.response).toBeUndefined();
  });

  it('assembled IT SdI-era graph has DELIVERED --OPEN_RESPONSE--> AWAITING_RESPONSE --ACCEPT/REFUSE--> ACCEPTED/REFUSED', () => {
    const graph = graphOf('IT', 'IT', 'B2B', 'GOODS', '2027-01-15');
    expect(graph.states).toEqual(expect.arrayContaining(['AWAITING_RESPONSE', 'ACCEPTED', 'REFUSED']));

    const openResponse = graph.transitions.find((t) => t.on === 'OPEN_RESPONSE');
    expect(openResponse).toMatchObject({ from: 'DELIVERED', to: 'AWAITING_RESPONSE' });

    const accept = graph.transitions.find((t) => t.on === 'ACCEPT' && t.from === 'AWAITING_RESPONSE');
    expect(accept).toMatchObject({ to: 'ACCEPTED' });
    expect(accept!.trigger.kind).toBe('TIMER'); // silence-timer per defaultOnSilence: 'ACCEPT'
    if (accept!.trigger.kind === 'TIMER') expect(accept!.trigger.deadlineHours).toBe(360);

    const refuse = graph.transitions.find((t) => t.on === 'REFUSE' && t.from === 'AWAITING_RESPONSE');
    expect(refuse).toMatchObject({ to: 'REFUSED' });
  });

  it('end-to-end: a real parseSdiNotifica NE/EC01 payload drives AWAITING_RESPONSE → ACCEPTED on the assembled IT graph', () => {
    const graph = graphOf('IT', 'IT', 'B2B', 'GOODS', '2027-01-15');
    const runtime = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', new RecordingComplianceLogger());

    const input = parseSdiNotifica({
      type: 'NE',
      idSdI: 42,
      dataOraRicezione: '2027-01-20T08:00:00Z',
      esitoCommittente: 'EC01',
    });
    expect(input.status).toBe('notifica NE - esito accettazione EC01');

    runtime.dispatch({ type: 'INBOUND_STATUS', status: input.status });
    expect(runtime.status).toBe('ACCEPTED');
  });

  it('end-to-end: a real parseSdiNotifica NE/EC02 payload drives AWAITING_RESPONSE → REFUSED on the assembled IT graph', () => {
    const graph = graphOf('IT', 'IT', 'B2B', 'GOODS', '2027-01-15');
    const runtime = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', new RecordingComplianceLogger());

    const input = parseSdiNotifica({
      type: 'NE',
      idSdI: 43,
      dataOraRicezione: '2027-01-20T08:00:00Z',
      esitoCommittente: 'EC02',
    });
    expect(input.status).toBe('notifica NE - esito rifiuto EC02');

    runtime.dispatch({ type: 'INBOUND_STATUS', status: input.status });
    expect(runtime.status).toBe('REFUSED');
  });

  it('silence = acceptance: TIMER_ELAPSED from AWAITING_RESPONSE resolves to ACCEPTED (decorrenza termini)', () => {
    const graph = graphOf('IT', 'IT', 'B2B', 'GOODS', '2027-01-15');
    const runtime = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', new RecordingComplianceLogger());
    runtime.dispatch({ type: 'TIMER_ELAPSED' });
    expect(runtime.status).toBe('ACCEPTED');
  });
});
