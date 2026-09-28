/**
 * The operator catalogue mechanism itself - issue #526. Proves the shipped data as DATA (never a
 * hard-coded `if legalChannel === 'pdp'` anywhere in product code), and proves the loader/assert gate
 * a caller cannot route around - same discipline `transports/channel-policy/registry.spec.ts` already
 * holds for its own sibling catalogue.
 */
import { ALL_OPERATOR_FILES } from './data/all';
import { defaultOperatorCatalog, OperatorCatalog } from './registry';
import { assertValidOperatorFact, InvalidOperatorProvenanceError, OperatorFact } from './schema';

describe('operator catalogue - loaded, not hard-coded', () => {
  it('every shipped operator has already passed provenance validation at load time', () => {
    expect(ALL_OPERATOR_FILES.length).toBeGreaterThan(0);
    for (const operator of ALL_OPERATOR_FILES) {
      expect(() => assertValidOperatorFact(operator, 'test')).not.toThrow();
    }
  });

  it('France\'s "pdp" legal channel lists more than one operator - the whole reason this catalogue exists (issue #526)', () => {
    const pdpOperators = defaultOperatorCatalog.forLegalChannel('pdp').map((o) => o.id);
    expect(pdpOperators).toEqual(expect.arrayContaining(['superpdp', 'billit', 'iopole', 'invopop']));
    expect(pdpOperators.length).toBeGreaterThan(1);
  });

  it("ecosio is NOT seeded - owner's decision 2026-09-28, it serves large groups only", () => {
    expect(defaultOperatorCatalog.byOperatorId('ecosio')).toBeUndefined();
  });

  it('a legal channel with no catalogued operator returns empty, never a guess (sdi-pec: bring-your-own PEC mailbox)', () => {
    expect(defaultOperatorCatalog.forLegalChannel('sdi-pec')).toEqual([]);
  });

  it('"peppol" is not seeded as a legal channel - removed as a product-level concept 2026-09-15, see data/all.ts', () => {
    expect(defaultOperatorCatalog.forLegalChannel('peppol')).toEqual([]);
  });

  it('single-operator legal channels (ksef, sdi, chorus-pro, pt-at) each resolve to exactly one operator', () => {
    expect(defaultOperatorCatalog.forLegalChannel('ksef').map((o) => o.id)).toEqual(['ksef']);
    expect(defaultOperatorCatalog.forLegalChannel('chorus-pro').map((o) => o.id)).toEqual(['chorus-pro']);
    expect(defaultOperatorCatalog.forLegalChannel('pt-at').map((o) => o.id)).toEqual(['pt-at']);
    // "sdi" has TWO operators (the direct/SDICoop government channel and A-Cube, a commercial
    // intermediary) - unlike the other three, deliberately not a singleton.
    expect(
      defaultOperatorCatalog
        .forLegalChannel('sdi')
        .map((o) => o.id)
        .sort(),
    ).toEqual(['acube', 'sdi']);
  });

  it('an unknown legal channel returns empty, never a throw', () => {
    expect(defaultOperatorCatalog.forLegalChannel('does-not-exist')).toEqual([]);
  });

  describe('resolveForTransportConfig - "say how a pdp account maps to an operator (by baseUrl)"', () => {
    it('a transport with exactly one catalogued operator resolves unconditionally, config never read', () => {
      const resolved = defaultOperatorCatalog.resolveForTransportConfig('acube', undefined);
      expect(resolved?.id).toBe('acube');
    });

    // Today exactly ONE operator (superpdp) is wired under the literal "pdp" transport id - every
    // other pdp-family operator (billit, iopole, invopop) has its OWN dedicated transport id instead
    // (see each entry's own data file). "pdp" therefore resolves unconditionally too, right now - the
    // baseUrl-disambiguation branch below exists for when a SECOND operator is seeded under "pdp"
    // (e.g. a future AFNOR-standard PA, per pdp-transport.ts's own header on the AFNOR XP Z12-013
    // path), proven against a bespoke catalog since the shipped data has nothing to disambiguate yet.
    it('the real "pdp" transport resolves to SuperPDP unconditionally today - the only operator seeded under it', () => {
      const resolved = defaultOperatorCatalog.resolveForTransportConfig('pdp', {
        baseUrl: 'https://anything-at-all.example/api',
      });
      expect(resolved?.id).toBe('superpdp');
    });

    describe('against a bespoke catalog with TWO operators sharing one transport id (the future "pdp" shape)', () => {
      const ambiguous = new OperatorCatalog([
        {
          id: 'op-a',
          name: 'Operator A',
          countries: ['FR'],
          legalChannel: 'pdp',
          transportId: 'pdp',
          baseUrl: { sandbox: 'https://sandbox.op-a.example', production: 'https://api.op-a.example' },
          capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
          sandbox: { available: true },
          provenance: { kind: 'unverified', resolutionNote: 'fixture' },
        },
        {
          id: 'op-b',
          name: 'Operator B',
          countries: ['FR'],
          legalChannel: 'pdp',
          transportId: 'pdp',
          baseUrl: { sandbox: 'https://sandbox.op-b.example', production: 'https://api.op-b.example' },
          capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
          sandbox: { available: true },
          provenance: { kind: 'unverified', resolutionNote: 'fixture' },
        },
      ]);

      it('matches the SANDBOX host to the right operator', () => {
        expect(
          ambiguous.resolveForTransportConfig('pdp', { baseUrl: 'https://sandbox.op-b.example' })?.id,
        ).toBe('op-b');
      });

      it('matches the PRODUCTION host to the right operator', () => {
        expect(ambiguous.resolveForTransportConfig('pdp', { baseUrl: 'https://api.op-a.example' })?.id).toBe(
          'op-a',
        );
      });

      it('a trailing slash and different casing on the connected baseUrl still match', () => {
        expect(ambiguous.resolveForTransportConfig('pdp', { baseUrl: 'HTTPS://API.OP-A.EXAMPLE/' })?.id).toBe(
          'op-a',
        );
      });

      it('an uncatalogued baseUrl resolves to null - never misattributed to either candidate', () => {
        expect(
          ambiguous.resolveForTransportConfig('pdp', { baseUrl: 'https://some-other-pa.example' }),
        ).toBeNull();
      });

      it('a missing baseUrl on an ambiguous transport resolves to null', () => {
        expect(ambiguous.resolveForTransportConfig('pdp', {})).toBeNull();
        expect(ambiguous.resolveForTransportConfig('pdp', undefined)).toBeNull();
      });
    });

    it('an unknown transport id resolves to null', () => {
      expect(defaultOperatorCatalog.resolveForTransportConfig('does-not-exist', {})).toBeNull();
    });
  });

  it('the loader refuses an entry without provenance', () => {
    const fixture: OperatorFact = {
      id: 'acme',
      name: 'Acme PA',
      countries: ['FR'],
      legalChannel: 'pdp',
      capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
      sandbox: { available: true },
      provenance: {} as never,
    };
    expect(() => assertValidOperatorFact(fixture, 'fixture')).toThrow(InvalidOperatorProvenanceError);
    expect(() => assertValidOperatorFact(fixture, 'fixture')).toThrow(/no valid provenance/);
  });

  it('an "unverified" entry with no resolutionNote is rejected the same way', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          countries: ['FR'],
          legalChannel: 'pdp',
          capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
          sandbox: { available: true },
          provenance: { kind: 'unverified', resolutionNote: '  ' },
        },
        'fixture',
      ),
    ).toThrow(/resolutionNote/);
  });

  it('a "legal" entry missing sourceText/sourceCheckedAt is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          countries: ['FR'],
          legalChannel: 'pdp',
          capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
          sandbox: { available: true },
          provenance: { kind: 'legal' } as never,
        },
        'fixture',
      ),
    ).toThrow(/missing sourceText/);
  });

  it('a well-formed entry (either provenance kind) loads fine', () => {
    const base = {
      id: 'acme',
      name: 'Acme PA',
      countries: ['FR'],
      legalChannel: 'pdp',
      capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
      sandbox: { available: true },
    };
    expect(() =>
      assertValidOperatorFact(
        { ...base, provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-28' } },
        'fixture',
      ),
    ).not.toThrow();
    expect(() =>
      assertValidOperatorFact(
        { ...base, provenance: { kind: 'unverified', resolutionNote: 'x' } },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('an operator with no "countries" is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          countries: [],
          legalChannel: 'pdp',
          capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
          sandbox: { available: true },
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/no "countries"/);
  });

  it('an operator with a non-boolean capability is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          countries: ['FR'],
          legalChannel: 'pdp',
          capabilities: { emit: 'yes', receive: false, lifecycleStatuses: false, eReporting: false } as never,
          sandbox: { available: true },
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/capabilities.emit/);
  });

  it('a blank "transportId" is rejected - omit the field entirely instead', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          countries: ['FR'],
          legalChannel: 'pdp',
          transportId: '   ',
          capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
          sandbox: { available: true },
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/blank "transportId"/);
  });

  it('an empty "baseUrl" (neither sandbox nor production) is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          countries: ['FR'],
          legalChannel: 'pdp',
          baseUrl: {},
          capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
          sandbox: { available: true },
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/empty "baseUrl"/);
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one', () => {
    const fixtureOperator: OperatorFact = {
      id: 'fixture-op',
      name: 'Fixture Operator',
      countries: ['DE'],
      legalChannel: 'xrechnung',
      capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
      sandbox: { available: true },
      provenance: { kind: 'unverified', resolutionNote: 'test fixture' },
    };
    const custom = new OperatorCatalog([fixtureOperator]);
    expect(custom.forLegalChannel('xrechnung')).toEqual([fixtureOperator]);
    expect(custom.forLegalChannel('pdp')).toEqual([]); // the shipped catalogue is NOT implicitly merged in
    expect(custom.byOperatorId('superpdp')).toBeUndefined();
  });
});
