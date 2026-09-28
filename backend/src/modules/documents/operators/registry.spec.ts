/**
 * The operator catalogue mechanism itself - issue #526. Proves the shipped data as DATA (never a
 * hard-coded `if legalChannel === 'pdp'` anywhere in product code), and proves the loader/assert gate
 * a caller cannot route around - same discipline `transports/channel-policy/registry.spec.ts` already
 * holds for its own sibling catalogue.
 *
 * Owner review of PR #528: ONE OPERATOR, MANY OFFERINGS (`schema.ts`'s own header). The fixtures
 * below now build `OperatorFact.offerings` arrays throughout - a "single-offering" operator is just
 * an `offerings` array of length one, never special-cased.
 */
import { ALL_OPERATOR_FILES } from './data/all';
import { defaultOperatorCatalog, OperatorCatalog } from './registry';
import { assertValidOperatorFact, InvalidOperatorProvenanceError, OperatorFact } from './schema';

/** One well-formed offering, reused by fixtures below that only care about the entity-level checks. */
function offering(
  overrides: Partial<OperatorFact['offerings'][number]> = {},
): OperatorFact['offerings'][number] {
  return {
    legalChannel: 'pdp',
    countries: ['FR'],
    capabilities: { emit: true, receive: false, lifecycleStatuses: false, eReporting: false },
    sandbox: { available: true },
    provenance: { kind: 'unverified', resolutionNote: 'fixture' },
    ...overrides,
  };
}

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

  it('a legal channel with no catalogued offering returns empty, never a guess (sdi-pec: bring-your-own PEC mailbox)', () => {
    expect(defaultOperatorCatalog.forLegalChannel('sdi-pec')).toEqual([]);
  });

  it('single-operator legal channels (ksef, chorus-pro, pt-at) each resolve to exactly one operator', () => {
    expect(defaultOperatorCatalog.forLegalChannel('ksef').map((o) => o.id)).toEqual(['ksef']);
    expect(defaultOperatorCatalog.forLegalChannel('chorus-pro').map((o) => o.id)).toEqual(['chorus-pro']);
    expect(defaultOperatorCatalog.forLegalChannel('pt-at').map((o) => o.id)).toEqual(['pt-at']);
  });

  it('an unknown legal channel returns empty, never a throw', () => {
    expect(defaultOperatorCatalog.forLegalChannel('does-not-exist')).toEqual([]);
  });

  describe('an operator with two offerings (owner review of PR #528)', () => {
    it('"sdi" lists the direct government channel AND A-Cube (a commercial intermediary)', () => {
      expect(
        defaultOperatorCatalog
          .forLegalChannel('sdi')
          .map((o) => o.id)
          .sort(),
      ).toEqual(['acube', 'sdi']);
    });

    it('A-Cube appears under BOTH "sdi" and "peppol" - one entity, two offerings, never duplicated as two operators', () => {
      expect(defaultOperatorCatalog.forLegalChannel('sdi').map((o) => o.id)).toContain('acube');
      expect(defaultOperatorCatalog.forLegalChannel('peppol').map((o) => o.id)).toContain('acube');
      // Still exactly ONE operator entity in the full catalogue, not two.
      expect(ALL_OPERATOR_FILES.filter((o) => o.id === 'acube')).toHaveLength(1);
    });

    it('Billit appears under BOTH "pdp" and "peppol"', () => {
      expect(defaultOperatorCatalog.forLegalChannel('pdp').map((o) => o.id)).toContain('billit');
      expect(defaultOperatorCatalog.forLegalChannel('peppol').map((o) => o.id)).toContain('billit');
    });

    it('filtering by channel trims the OTHER offerings off the returned operator - never leaks an unrelated offering', () => {
      const underSdi = defaultOperatorCatalog.forLegalChannel('sdi').find((o) => o.id === 'acube');
      expect(underSdi?.offerings.map((o) => o.legalChannel)).toEqual(['sdi']);

      const underPeppol = defaultOperatorCatalog.forLegalChannel('peppol').find((o) => o.id === 'acube');
      expect(underPeppol?.offerings.map((o) => o.legalChannel)).toEqual(['peppol']);

      // The FULL catalogue entry (unfiltered) still carries both.
      const full = defaultOperatorCatalog.byOperatorId('acube');
      expect(full?.offerings.map((o) => o.legalChannel).sort()).toEqual(['peppol', 'sdi']);
    });

    it("the two offerings can carry different provenance kinds independently (owner's own example)", () => {
      // A-Cube: verified as an Italian SdI intermediary, and ALSO verified as a Peppol access point
      // (both sourced from the same transport header in this codebase) - but the two offerings never
      // share one provenance object, proven by them being genuinely different citations.
      const acube = defaultOperatorCatalog.byOperatorId('acube');
      const sdiOffering = acube?.offerings.find((o) => o.legalChannel === 'sdi');
      const peppolOffering = acube?.offerings.find((o) => o.legalChannel === 'peppol');
      expect(sdiOffering?.provenance).not.toBe(peppolOffering?.provenance);
      expect(sdiOffering?.transportId).toBe('acube');
      // The wired "acube" transport never exercises Peppol capability - see that offering's own notes.
      expect(peppolOffering?.transportId).toBeUndefined();
    });
  });

  describe('resolveForTransportConfig - "say how a pdp account maps to an operator AND offering (by baseUrl)"', () => {
    it('a transport with exactly one catalogued offering resolves unconditionally, config never read', () => {
      const resolved = defaultOperatorCatalog.resolveForTransportConfig('acube', undefined);
      expect(resolved?.operator.id).toBe('acube');
      expect(resolved?.offering.legalChannel).toBe('sdi');
    });

    it('resolves BOTH the right operator AND the right offering for billit, whose "pdp" and "peppol" offerings SHARE one transport id', () => {
      const resolved = defaultOperatorCatalog.resolveForTransportConfig('billit', {
        baseUrl: 'https://api.sandbox.billit.be/v1',
        apiKey: 'x',
        partyId: 'y',
      });
      expect(resolved?.operator.id).toBe('billit');
      // Two of billit's OWN offerings both carry transportId "billit" (the same wired code grants
      // both capabilities at once) - that is never treated as an ambiguity between two DIFFERENT
      // operators (see `OperatorCatalog`'s own constructor comment), so this resolves unconditionally
      // to the FIRST such offering in file order ("pdp"), deterministically, config never even read.
      expect(resolved?.offering.legalChannel).toBe('pdp');
    });

    it('acube resolves to its "sdi" offering specifically - its "peppol" offering carries no transportId at all', () => {
      const resolved = defaultOperatorCatalog.resolveForTransportConfig('acube', {});
      expect(resolved?.operator.id).toBe('acube');
      expect(resolved?.offering.legalChannel).toBe('sdi');
    });

    // Today exactly ONE operator (superpdp) is wired under the literal "pdp" transport id - every
    // other pdp-family operator (billit, iopole, invopop) has its OWN dedicated transport id instead
    // (see each entry's own data file). "pdp" therefore resolves unconditionally too, right now - the
    // baseUrl-disambiguation branch below exists for when a SECOND operator is seeded under "pdp"
    // (e.g. a future AFNOR-standard PA, per pdp-transport.ts's own header on the AFNOR XP Z12-013
    // path), proven against a bespoke catalog since the shipped data has nothing to disambiguate yet.
    it('the real "pdp" transport resolves to SuperPDP unconditionally today - the only offering seeded under it', () => {
      const resolved = defaultOperatorCatalog.resolveForTransportConfig('pdp', {
        baseUrl: 'https://anything-at-all.example/api',
      });
      expect(resolved?.operator.id).toBe('superpdp');
      expect(resolved?.offering.legalChannel).toBe('pdp');
    });

    describe('against a bespoke catalog with TWO offerings sharing one transport id (the future "pdp" shape)', () => {
      const ambiguous = new OperatorCatalog([
        {
          id: 'op-a',
          name: 'Operator A',
          provenance: { kind: 'unverified', resolutionNote: 'fixture' },
          offerings: [
            offering({
              transportId: 'pdp',
              baseUrl: { sandbox: 'https://sandbox.op-a.example', production: 'https://api.op-a.example' },
            }),
          ],
        },
        {
          id: 'op-b',
          name: 'Operator B',
          provenance: { kind: 'unverified', resolutionNote: 'fixture' },
          offerings: [
            offering({
              transportId: 'pdp',
              baseUrl: { sandbox: 'https://sandbox.op-b.example', production: 'https://api.op-b.example' },
            }),
          ],
        },
      ]);

      it('matches the SANDBOX host to the right operator and offering', () => {
        const resolved = ambiguous.resolveForTransportConfig('pdp', {
          baseUrl: 'https://sandbox.op-b.example',
        });
        expect(resolved?.operator.id).toBe('op-b');
        expect(resolved?.offering.legalChannel).toBe('pdp');
      });

      it('matches the PRODUCTION host to the right operator and offering', () => {
        const resolved = ambiguous.resolveForTransportConfig('pdp', { baseUrl: 'https://api.op-a.example' });
        expect(resolved?.operator.id).toBe('op-a');
        expect(resolved?.offering.legalChannel).toBe('pdp');
      });

      it('a trailing slash and different casing on the connected baseUrl still match', () => {
        expect(
          ambiguous.resolveForTransportConfig('pdp', { baseUrl: 'HTTPS://API.OP-A.EXAMPLE/' })?.operator.id,
        ).toBe('op-a');
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

  it('the loader refuses an entry without provenance (entity-level)', () => {
    const fixture: OperatorFact = {
      id: 'acme',
      name: 'Acme PA',
      provenance: {} as never,
      offerings: [offering()],
    };
    expect(() => assertValidOperatorFact(fixture, 'fixture')).toThrow(InvalidOperatorProvenanceError);
    expect(() => assertValidOperatorFact(fixture, 'fixture')).toThrow(/no valid provenance/);
  });

  it('the loader refuses an offering without provenance, even when the entity itself is sourced', () => {
    const fixture: OperatorFact = {
      id: 'acme',
      name: 'Acme PA',
      provenance: { kind: 'unverified', resolutionNote: 'entity exists' },
      offerings: [offering({ provenance: {} as never })],
    };
    expect(() => assertValidOperatorFact(fixture, 'fixture')).toThrow(InvalidOperatorProvenanceError);
    expect(() => assertValidOperatorFact(fixture, 'fixture')).toThrow(/no valid provenance/);
  });

  it('an operator with an EMPTY "offerings" array is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
          offerings: [],
        },
        'fixture',
      ),
    ).toThrow(/no "offerings"/);
  });

  it('an "unverified" offering with no resolutionNote is rejected the same way', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          provenance: { kind: 'unverified', resolutionNote: 'entity exists' },
          offerings: [offering({ provenance: { kind: 'unverified', resolutionNote: '  ' } })],
        },
        'fixture',
      ),
    ).toThrow(/resolutionNote/);
  });

  it('a "legal" offering missing sourceText/sourceCheckedAt is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          provenance: { kind: 'unverified', resolutionNote: 'entity exists' },
          offerings: [offering({ provenance: { kind: 'legal' } as never })],
        },
        'fixture',
      ),
    ).toThrow(/missing sourceText/);
  });

  it('an operator with two well-formed offerings, one legal and one unverified, loads fine', () => {
    const fact: OperatorFact = {
      id: 'acme',
      name: 'Acme PA',
      provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-28' },
      offerings: [
        offering({
          legalChannel: 'sdi',
          provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-28' },
        }),
        offering({ legalChannel: 'peppol', provenance: { kind: 'unverified', resolutionNote: 'x' } }),
      ],
    };
    expect(() => assertValidOperatorFact(fact, 'fixture')).not.toThrow();
  });

  it('an offering with no "countries" is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
          offerings: [offering({ countries: [] })],
        },
        'fixture',
      ),
    ).toThrow(/no "countries"/);
  });

  it('an offering with a non-boolean capability is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
          offerings: [
            offering({
              capabilities: {
                emit: 'yes',
                receive: false,
                lifecycleStatuses: false,
                eReporting: false,
              } as never,
            }),
          ],
        },
        'fixture',
      ),
    ).toThrow(/capabilities.emit/);
  });

  it('an offering with a blank "transportId" is rejected - omit the field entirely instead', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
          offerings: [offering({ transportId: '   ' })],
        },
        'fixture',
      ),
    ).toThrow(/blank "transportId"/);
  });

  it('an offering with an empty "baseUrl" (neither sandbox nor production) is rejected', () => {
    expect(() =>
      assertValidOperatorFact(
        {
          id: 'acme',
          name: 'Acme PA',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
          offerings: [offering({ baseUrl: {} })],
        },
        'fixture',
      ),
    ).toThrow(/empty "baseUrl"/);
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one', () => {
    const fixtureOperator: OperatorFact = {
      id: 'fixture-op',
      name: 'Fixture Operator',
      provenance: { kind: 'unverified', resolutionNote: 'test fixture' },
      offerings: [offering({ legalChannel: 'xrechnung', countries: ['DE'] })],
    };
    const custom = new OperatorCatalog([fixtureOperator]);
    expect(custom.forLegalChannel('xrechnung')).toEqual([fixtureOperator]);
    expect(custom.forLegalChannel('pdp')).toEqual([]); // the shipped catalogue is NOT implicitly merged in
    expect(custom.byOperatorId('superpdp')).toBeUndefined();
  });
});
