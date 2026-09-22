import { instanceOperatorEmails, isInstanceOperator } from './instance-operators';

describe('instance-operators', () => {
  it('is empty when INSTANCE_OPERATOR_EMAILS is unset — no operator, ever, by default', () => {
    expect(instanceOperatorEmails({})).toEqual([]);
    expect(isInstanceOperator('anyone@example.test', {})).toBe(false);
  });

  it('parses a comma-separated list, trimmed', () => {
    const env = { INSTANCE_OPERATOR_EMAILS: ' a@example.test, b@example.test ,c@example.test' };
    expect(instanceOperatorEmails(env)).toEqual(['a@example.test', 'b@example.test', 'c@example.test']);
  });

  it('is case-insensitive on both the list and the checked address', () => {
    const env = { INSTANCE_OPERATOR_EMAILS: 'Ops@Example.test' };
    expect(isInstanceOperator('ops@example.test', env)).toBe(true);
    expect(isInstanceOperator('OPS@EXAMPLE.TEST', env)).toBe(true);
    expect(isInstanceOperator('someone-else@example.test', env)).toBe(false);
  });

  it('drops empty entries from a trailing/stray comma', () => {
    const env = { INSTANCE_OPERATOR_EMAILS: 'a@example.test,,  ,b@example.test,' };
    expect(instanceOperatorEmails(env)).toEqual(['a@example.test', 'b@example.test']);
  });

  it('refuses a null/undefined/empty candidate outright, never matching an empty allowlist entry', () => {
    const env = { INSTANCE_OPERATOR_EMAILS: 'a@example.test' };
    expect(isInstanceOperator(null, env)).toBe(false);
    expect(isInstanceOperator(undefined, env)).toBe(false);
    expect(isInstanceOperator('', env)).toBe(false);
  });
});
