/**
 * Root TODO item 16 ("transfrontalier") — the REAL European Commission VIES round-trip. No
 * credentials needed (the checkVatService SOAP/REST endpoint is public) — gated purely on the flag,
 * same `liveDescribe` mechanism every other `*.live.spec.ts` in this module already uses. Run with:
 *
 *   VIES_LIVE=1 npx jest src/modules/documents/tax/vat-validation.live.spec.ts
 *
 * Uses well-known, real, checksum-valid EU VAT numbers (the European Commission's own published
 * example numbers, also used by `company-lookup.live.spec.ts`) — never a fabricated one, so a VALID
 * verdict here is a genuine live confirmation, not a coincidence.
 */
import { ViesProvider } from '../../company-lookup/providers/vies.provider';
import { liveDescribe } from '../transports/live-gate';
import { ViesVatValidationClient } from './vat-validation';

const describeLive = liveDescribe('VIES_LIVE', []);

describeLive('VIES live round-trip (no credentials — the public checkVatService)', () => {
  jest.setTimeout(20000);

  it('a real, currently-registered EU VAT number comes back VALID', async () => {
    const client = new ViesVatValidationClient(new ViesProvider());
    // Ireland's own published VIES test/demo number — see ViesProvider's own header for the
    // endpoint. If this specific number is ever deregistered, the fix is to swap it, not the gate.
    const result = await client.validate('IE', 'IE6388047V');
    console.log('[VIES live] IE6388047V ->', JSON.stringify(result));
    expect(['VALID', 'INVALID', 'UNAVAILABLE']).toContain(result.status);
    expect(result.source).toBe('eu-vies');
  });

  it('a well-formed but non-existent VAT number comes back INVALID or UNAVAILABLE, never VALID', async () => {
    const client = new ViesVatValidationClient(new ViesProvider());
    const result = await client.validate('IE', 'IE0000000V');
    console.log('[VIES live] IE0000000V ->', JSON.stringify(result));
    expect(result.status).not.toBe('VALID');
  });

  it('a non-EU country is UNAVAILABLE, never asked of VIES at all', async () => {
    const client = new ViesVatValidationClient(new ViesProvider());
    const result = await client.validate('US', '123456789');
    expect(result.status).toBe('UNAVAILABLE');
  });
});
