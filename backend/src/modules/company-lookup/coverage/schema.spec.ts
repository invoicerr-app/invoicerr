import { assertValidCompanyLookupFacts, CompanyLookupFacts } from './schema';

const CONTEXT = 'test';

describe('assertValidCompanyLookupFacts', () => {
  it.each<[string, CompanyLookupFacts]>([
    ['providers only', { providers: ['eu-vies'] }],
    ['a note only', { noteKey: 'companyLookup.notes.US' }],
    ['every fact', { providers: ['a-register', 'eu-vies'], noteKey: 'companyLookup.notes.XX' }],
  ])('accepts %s', (_label, facts) => {
    expect(() => assertValidCompanyLookupFacts(facts, CONTEXT)).not.toThrow();
  });

  it.each<[string, unknown, RegExp]>([
    ['nothing at all', {}, /declares no company lookup fact/],
    ['an unknown key', { providers: ['eu-vies'], countries: ['FR'] }, /unknown company lookup key/],
    ['an empty provider list', { providers: [] }, /non-empty array/],
    ['a malformed provider id', { providers: ['EU VIES'] }, /not a provider id/],
    ['a provider listed twice', { providers: ['eu-vies', 'eu-vies'] }, /lists a provider twice/],
    ['a note key outside the namespace', { noteKey: 'settings.notes.US' }, /"noteKey" must match/],
  ])('refuses %s', (_label, facts, message) => {
    expect(() => assertValidCompanyLookupFacts(facts as CompanyLookupFacts, CONTEXT)).toThrow(message);
  });
});
