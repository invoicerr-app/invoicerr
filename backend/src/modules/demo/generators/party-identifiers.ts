/**
 * The identifiers a demo party gets, read from each country file's `identifiers` section: every scheme
 * declaring a `demoGenerator` is filled, in file order, by the registry algorithm it names. Plans are
 * built and checked once at load, so a bad country file fails here rather than mid-seed.
 */
import {
  ComposedCountryCatalog,
  defaultComposedCountryCatalog,
} from '@/modules/documents/countries/registry';
import {
  CountryIdentifierRequirementsFile,
  DemoIdentifierGeneratorSpec,
  DemoIdentifierVariable,
} from '@/modules/documents/country-identifiers/schema';

import { SUPPORTED_COUNTRY_CODES, SupportedCountryCode } from './data-pools';
import {
  DEMO_IDENTIFIER_GENERATORS,
  DemoIdentifierGenerator,
  assertRenderableToken,
  templateTokens,
} from './identifiers';
import { Rng, createRng, intBetween } from './rng';

export interface PartyIdentifierEntry {
  scheme: string;
  value: string;
}

interface PlannedScheme {
  scheme: string;
  spec: DemoIdentifierGeneratorSpec;
  generator: DemoIdentifierGenerator;
  pattern?: RegExp;
}

export interface DemoIdentifierPlan {
  variables: DemoIdentifierVariable[];
  schemes: PlannedScheme[];
}

const SAMPLE_SEEDS = ['demo-identifiers-check-1', 'demo-identifiers-check-2', 7, 1234];
const SAMPLES_PER_SEED = 25;

function planScheme(
  fact: CountryIdentifierRequirementsFile['schemes'][number],
  spec: DemoIdentifierGeneratorSpec,
  ready: ReadonlySet<string>,
  variableNames: ReadonlySet<string>,
): PlannedScheme {
  const generator = DEMO_IDENTIFIER_GENERATORS[spec.id];
  if (!generator) throw new Error(`unknown demo generator "${spec.id}"`);
  for (const param of generator.params) {
    if (!spec[param]) throw new Error(`demo generator "${spec.id}" needs "${param}"`);
  }
  if (spec.source !== undefined && !ready.has(spec.source)) {
    throw new Error(`source scheme "${spec.source}" must declare a demo generator earlier in the file`);
  }
  for (const token of templateTokens(spec.template ?? '')) assertRenderableToken(token, variableNames);
  // Every demo party is a company.
  if (fact.appliesTo === 'INDIVIDUAL') throw new Error('a demo generator on an INDIVIDUAL-only scheme');
  return {
    scheme: fact.scheme,
    spec,
    generator,
    pattern: fact.pattern ? new RegExp(fact.pattern) : undefined,
  };
}

export function generatePartyIdentifiersFromPlan(rng: Rng, plan: DemoIdentifierPlan): PartyIdentifierEntry[] {
  const variables = new Map<string, string>();
  for (const v of plan.variables) {
    variables.set(v.name, String(intBetween(rng, v.min, v.max)).padStart(v.padTo ?? 0, '0'));
  }
  const generated = new Map<string, string>();
  return plan.schemes.map(({ scheme, spec, generator }) => {
    const value = generator.generate({ rng, spec, generated, variables });
    generated.set(scheme, value);
    return { scheme, value };
  });
}

function assertSamplesMatchPatterns(plan: DemoIdentifierPlan): void {
  for (const seed of SAMPLE_SEEDS) {
    const rng = createRng(seed);
    for (let i = 0; i < SAMPLES_PER_SEED; i++) {
      generatePartyIdentifiersFromPlan(rng, plan).forEach(({ value }, index) => {
        const { scheme, pattern } = plan.schemes[index];
        if (pattern && !pattern.test(value)) {
          throw new Error(`generated "${value}" for "${scheme}" does not match its pattern ${pattern}`);
        }
      });
    }
  }
}

export function buildDemoIdentifierPlan(file: CountryIdentifierRequirementsFile): DemoIdentifierPlan {
  const context = `country ${file.countryCode} identifiers`;
  try {
    const variables = file.demoVariables ?? [];
    for (const v of variables) {
      if (!Number.isInteger(v.min) || !Number.isInteger(v.max) || v.min > v.max) {
        throw new Error(`demo variable "${v.name}" needs integer min <= max`);
      }
    }
    const variableNames = new Set(variables.map((v) => v.name));
    const ready = new Set<string>();
    const schemes: PlannedScheme[] = [];
    for (const fact of file.schemes) {
      if (!fact.demoGenerator) continue;
      schemes.push(planScheme(fact, fact.demoGenerator, ready, variableNames));
      ready.add(fact.scheme);
    }
    const missing = file.schemes.find(
      (f) => f.required && f.appliesTo !== 'INDIVIDUAL' && !ready.has(f.scheme),
    );
    if (missing) throw new Error(`required scheme "${missing.scheme}" has no demo generator`);
    const plan = { variables, schemes };
    assertSamplesMatchPatterns(plan);
    return plan;
  } catch (error) {
    throw new Error(`${context}: ${(error as Error).message}`);
  }
}

export function buildDemoIdentifierPlans(
  catalog: ComposedCountryCatalog,
  demoCountries: readonly string[],
): Map<string, DemoIdentifierPlan> {
  const plans = new Map<string, DemoIdentifierPlan>();
  for (const countryCode of new Set([...catalog.countries(), ...demoCountries])) {
    const file = catalog.get(countryCode)?.identifiers;
    const declaresDemo = !!file?.demoVariables || !!file?.schemes.some((f) => f.demoGenerator);
    if (!demoCountries.includes(countryCode) && !declaresDemo) continue;
    if (!file || !declaresDemo) throw new Error(`demo country ${countryCode} declares no demo identifier`);
    plans.set(countryCode, buildDemoIdentifierPlan(file));
  }
  return plans;
}

const PLANS = buildDemoIdentifierPlans(defaultComposedCountryCatalog, SUPPORTED_COUNTRY_CODES);

export function generatePartyIdentifiers(
  rng: Rng,
  countryCode: SupportedCountryCode,
): PartyIdentifierEntry[] {
  const plan = PLANS.get(countryCode);
  if (!plan) throw new Error(`no demo identifier plan for ${countryCode}`);
  return generatePartyIdentifiersFromPlan(rng, plan);
}

/** Every shipped `vat-rates` section names its standard-category rate `"<cc>-standard"`. */
export function standardVatRateId(countryCode: SupportedCountryCode): string {
  return `${countryCode.toLowerCase()}-standard`;
}
