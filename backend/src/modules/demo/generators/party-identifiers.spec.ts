import { describe, expect, it } from 'vitest';

import {
  ComposedCountryCatalog,
  defaultComposedCountryCatalog,
} from '@/modules/documents/countries/registry';
import {
  CountryIdentifierRequirementsFile,
  DemoIdentifierVariable,
  IdentifierSchemeFact,
} from '@/modules/documents/country-identifiers/schema';

import { SUPPORTED_COUNTRY_CODES } from './data-pools';
import {
  buildDemoIdentifierPlan,
  buildDemoIdentifierPlans,
  generatePartyIdentifiers,
  generatePartyIdentifiersFromPlan,
} from './party-identifiers';
import { createRng } from './rng';

const SEEDS = ['demo-seed-1', 42, 'a-very-different-seed'];
const PARTIES_PER_SEED = 3;

function sampleCountry(seed: string | number, countryCode: (typeof SUPPORTED_COUNTRY_CODES)[number]) {
  const rng = createRng(seed);
  const parties = Array.from({ length: PARTIES_PER_SEED }, () => generatePartyIdentifiers(rng, countryCode));
  // The next draw pins how much randomness the generator consumed, so later seed steps stay stable too.
  return { parties, nextDraw: rng() };
}

describe('generatePartyIdentifiers', () => {
  it.each(SEEDS)('produces a stable identifier set for every demo country with seed %s', (seed) => {
    const output = Object.fromEntries(SUPPORTED_COUNTRY_CODES.map((cc) => [cc, sampleCountry(seed, cc)]));
    expect(output).toMatchSnapshot();
  });
});

function fileWith(schemes: Array<Partial<IdentifierSchemeFact>>, demoVariables?: DemoIdentifierVariable[]) {
  return {
    countryCode: 'XX',
    demoVariables,
    schemes: schemes.map((s) => ({
      scheme: 'LEGAL_ID',
      appliesTo: 'BOTH' as const,
      label: 'Fixture',
      required: false,
      provenance: { kind: 'unverified' as const, resolutionNote: 'fixture' },
      ...s,
    })),
  };
}

function expectPlanError(file: CountryIdentifierRequirementsFile, message: RegExp) {
  expect(() => buildDemoIdentifierPlan(file)).toThrow(message);
}

describe('buildDemoIdentifierPlan', () => {
  it('accepts every shipped demo country', () => {
    const plans = buildDemoIdentifierPlans(defaultComposedCountryCatalog, SUPPORTED_COUNTRY_CODES);
    expect([...plans.keys()].sort()).toEqual([...SUPPORTED_COUNTRY_CODES].sort());
  });

  it('rejects an unknown generator id', () => {
    expectPlanError(fileWith([{ demoGenerator: { id: 'no-such-algorithm' } }]), /unknown demo generator/);
  });

  it('rejects a generator missing one of its parameters', () => {
    expectPlanError(fileWith([{ demoGenerator: { id: 'prefixed-copy', prefix: 'XX' } }]), /needs "source"/);
  });

  it('rejects a source scheme that is not generated before it', () => {
    const file = fileWith([
      { scheme: 'VAT', demoGenerator: { id: 'prefixed-copy', prefix: 'XX', source: 'LEGAL_ID' } },
      { scheme: 'LEGAL_ID', demoGenerator: { id: 'pl-nip' } },
    ]);
    expectPlanError(file, /must declare a demo generator earlier/);
  });

  it('rejects a generated sample that does not match the scheme pattern', () => {
    expectPlanError(fileWith([{ pattern: '^\\d{9}$', demoGenerator: { id: 'pl-nip' } }]), /does not match/);
  });

  it('rejects a required scheme with no generator', () => {
    expectPlanError(fileWith([{ required: true }]), /required scheme "LEGAL_ID" has no demo generator/);
  });

  it('rejects a template naming an undeclared variable', () => {
    expectPlanError(fileWith([{ demoGenerator: { id: 'template', template: '{region}' } }]), /not declared/);
  });

  it('renders templates from variables drawn once per party', () => {
    const file = fileWith(
      [
        { scheme: 'A', demoGenerator: { id: 'template', template: '{n}-{digits:3}' } },
        { scheme: 'B', demoGenerator: { id: 'template', template: '{n:last1}' } },
      ],
      [{ name: 'n', min: 10, max: 10, padTo: 4 }],
    );
    const plans = buildDemoIdentifierPlans(
      new ComposedCountryCatalog([{ countryCode: 'XX', identifiers: file }]),
      [],
    );
    const [a, b] = generatePartyIdentifiersFromPlan(createRng(1), plans.get('XX')!);
    expect(a.value).toMatch(/^0010-\d{3}$/);
    expect(b.value).toBe('0');
  });
});
