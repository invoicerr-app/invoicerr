/**
 * C4 — the VIES-backed implementation of `VatValidationPort`.
 *
 * Built on the `ViesProvider` the repository already has
 * (`modules/company-lookup/providers/vies.provider.ts`) rather than on a second HTTP client. That
 * provider already knows the endpoint, the EL/XI member-state quirks, the VAT-prefix stripping and
 * which `userError` values mean "saturated, retry" rather than "not found". Duplicating it would
 * mean two places to be wrong about the same service.
 *
 * The mapping from its lookup contract to a validation verdict:
 *
 *   a company back      VALID        the member state confirmed the number
 *   null                INVALID      the member state answered, and denied it
 *   throws              UNAVAILABLE  we could not ask — saturation, timeout, transport
 *   not an EU country   UNAVAILABLE  VIES cannot answer for it; that is not the number's fault
 */
import { ViesProvider } from '../../modules/company-lookup/providers/vies.provider';
import type { VatValidationPort, VatValidationResult } from './vat-validation.port';

export class ViesVatValidationClient implements VatValidationPort {
  constructor(private readonly provider: ViesProvider = new ViesProvider()) {}

  async validate(countryCode: string, vatNumber: string): Promise<VatValidationResult> {
    const checkedAt = new Date();
    const source = 'eu-vies';
    const query = { scheme: 'VAT' as const, countryCode: countryCode.toUpperCase(), value: vatNumber };

    // Outside VIES's coverage, or too short to be a number at all: we cannot ask. Saying INVALID
    // here would blame a number the service was never in a position to judge.
    if (!this.provider.supports(query)) {
      return { status: 'UNAVAILABLE', checkedAt, source };
    }

    try {
      const company = await this.provider.lookup(query);
      return { status: company ? 'VALID' : 'INVALID', checkedAt, source };
    } catch {
      // Deliberately swallowed. Per the port's contract a transport failure is a verdict, not an
      // exception — validating a VAT number must never be the thing that stops an invoice.
      return { status: 'UNAVAILABLE', checkedAt, source };
    }
  }
}
