/**
 * Test-only case table for `normalizeClientContacts` (no dedicated spec existed before this - the
 * behavior was only ever exercised indirectly, through `clients.contacts.spec.ts`'s own
 * create/edit-level assertions). Pinned here so `frontend/src/lib/normalize-client-contacts.spec.ts`
 * can run the EXACT same cases against its frontend twin (#415 follow-up review round 3, point 3) -
 * see that function's own header for why the frontend cannot simply import this module.
 */
import { normalizeClientContacts } from './normalize-contacts';
import { ClientContactDto } from '../dto/clients.dto';

describe('normalizeClientContacts', () => {
  it('returns no contacts and a null primary for an empty array', () => {
    expect(normalizeClientContacts([])).toEqual({ contacts: [], primary: null });
  });

  it('returns no contacts and a null primary for undefined/null input', () => {
    expect(normalizeClientContacts(undefined)).toEqual({ contacts: [], primary: null });
    expect(normalizeClientContacts(null)).toEqual({ contacts: [], primary: null });
  });

  it('drops a row whose fields are all empty or whitespace-only', () => {
    const blank: ClientContactDto = { firstName: '', lastName: ' ', role: undefined, email: '', phone: '  ' };
    const result = normalizeClientContacts([blank]);
    expect(result.contacts).toEqual([]);
    expect(result.primary).toBeNull();
  });

  it('keeps a row with just one non-blank field', () => {
    const row: ClientContactDto = { email: 'bob@example.test' };
    const result = normalizeClientContacts([row]);
    expect(result.contacts).toEqual([row]);
    expect(result.primary).toBe(row);
  });

  it('a blank row flagged primary is dropped, and the next real row becomes primary', () => {
    const blankPrimary: ClientContactDto = { firstName: '', lastName: '', isPrimary: true };
    const bob: ClientContactDto = { firstName: 'Bob', email: 'bob@example.test' };
    const result = normalizeClientContacts([blankPrimary, bob]);
    expect(result.contacts).toEqual([bob]);
    expect(result.primary).toBe(bob);
  });

  it('the first row flagged primary among several wins, even out of array order', () => {
    const alice: ClientContactDto = { firstName: 'Alice' };
    const bob: ClientContactDto = { firstName: 'Bob', isPrimary: true };
    const carol: ClientContactDto = { firstName: 'Carol', isPrimary: true };
    const result = normalizeClientContacts([alice, bob, carol]);
    expect(result.contacts).toEqual([alice, bob, carol]);
    expect(result.primary).toBe(bob);
  });

  it('falls back to the first survivor when none is flagged primary', () => {
    const alice: ClientContactDto = { firstName: 'Alice' };
    const bob: ClientContactDto = { firstName: 'Bob' };
    const result = normalizeClientContacts([alice, bob]);
    expect(result.primary).toBe(alice);
  });

  it('an all-blank array normalizes to zero contacts and a null primary', () => {
    const result = normalizeClientContacts([{}, { firstName: '   ' }]);
    expect(result.contacts).toEqual([]);
    expect(result.primary).toBeNull();
  });
});
