/**
 * `resolveInvoiceValidationTransmission` against the REAL, shipped catalogs (both country-policy's
 * own `invoiceValidation` fact and channel-policy's own mandate data) - a fixture-only suite could
 * stay green even if the shipped `fr.json`/`it.json` entries this PR just added silently drifted
 * (the exact same reasoning `mandate.spec.ts`'s own first describe block already gives for testing
 * against the shipped FR/PDP mandate rather than only a fixture). `resolveCompanyCountryCode`/
 * `resolveClientCountryCode` are mocked (they reach Prisma) - same style
 * `actions/invoice-channel-mandate.spec.ts` already established for the sibling "send" mandate check.
 */
import { vi, type Mock } from 'vitest';

import * as countryPolicy from './country-policy';
import { resolveInvoiceValidationTransmission } from './invoice-validation-transmission';

vi.mock('./country-policy');

describe('resolveInvoiceValidationTransmission - the real, shipped country data', () => {
  afterEach(() => vi.resetAllMocks());

  it('a French domestic B2B invoice (seller FR, buyer FR, on/after the PDP mandate) transmits through "the accredited platform (PDP)"', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('FR');
    (countryPolicy.resolveClientCountryCode as Mock).mockResolvedValue('FR');

    const decision = await resolveInvoiceValidationTransmission('company-1', '2026-09-20', 'client-1');

    expect(decision).toEqual({
      transmits: true,
      channelLabel: 'the accredited platform (PDP)',
      sellerCountryCode: 'FR',
    });
  });

  it('an Italian domestic B2B invoice (seller IT, buyer IT, on/after the SdI mandate) transmits through "SdI"', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('IT');
    (countryPolicy.resolveClientCountryCode as Mock).mockResolvedValue('IT');

    const decision = await resolveInvoiceValidationTransmission('company-1', '2026-09-20', 'client-1');

    expect(decision).toEqual({
      transmits: true,
      channelLabel: 'SdI',
      sellerCountryCode: 'IT',
    });
  });

  it('a Polish invoice NEVER transmits on validate - Poland declares no "invoiceValidation" fact at all, however a future KSeF mandate might read', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PL');
    (countryPolicy.resolveClientCountryCode as Mock).mockResolvedValue('PL');

    const decision = await resolveInvoiceValidationTransmission('company-1', '2030-01-01', 'client-1');

    expect(decision).toEqual({ transmits: false, sellerCountryCode: 'PL' });
    // Never even reaches the buyer-country lookup - condition 1 (the country fact) is checked first,
    // a seller country with no fact can never transmit whatever the buyer turns out to be.
    expect(countryPolicy.resolveClientCountryCode).not.toHaveBeenCalled();
  });

  it('a FRENCH B2C invoice (buyer established abroad, so the operation is not domestic) never transmits - the mandate itself never binds it, whatever France\'s own "invoiceValidation" fact says', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('FR');
    (countryPolicy.resolveClientCountryCode as Mock).mockResolvedValue('DE');

    const decision = await resolveInvoiceValidationTransmission('company-1', '2026-09-20', 'client-1');

    expect(decision).toEqual({ transmits: false, sellerCountryCode: 'FR' });
  });

  it("a French invoice issued BEFORE the PDP mandate's own threshold never transmits, even though the country fact is declared", async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('FR');
    (countryPolicy.resolveClientCountryCode as Mock).mockResolvedValue('FR');

    const decision = await resolveInvoiceValidationTransmission('company-1', '2026-08-31', 'client-1');

    expect(decision).toEqual({ transmits: false, sellerCountryCode: 'FR' });
  });

  it('a German invoice never transmits - Germany has no active channel mandate at all, let alone an "invoiceValidation" fact', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('DE');
    (countryPolicy.resolveClientCountryCode as Mock).mockResolvedValue('DE');

    const decision = await resolveInvoiceValidationTransmission('company-1', '2026-09-20', 'client-1');

    expect(decision).toEqual({ transmits: false, sellerCountryCode: 'DE' });
  });

  it('a company whose own country cannot be resolved never transmits, and never even reaches the fact/buyer lookups', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue(undefined);

    const decision = await resolveInvoiceValidationTransmission('company-1', '2026-09-20', 'client-1');

    expect(decision).toEqual({ transmits: false });
    expect(countryPolicy.resolveClientCountryCode).not.toHaveBeenCalled();
  });
});
