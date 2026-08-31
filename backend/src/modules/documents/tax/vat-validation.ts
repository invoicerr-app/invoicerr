/**
 * C4 — REPRISE quasi verbatim of `compliance/canonical/vat-validation.port.ts` +
 * `vies-vat-validation.client.ts` (git tag `avant-refonte-documents`) — the seam that decides whether
 * a VAT number has been VERIFIED, not merely typed. Root TODO item 16's own contract: "syntaxique par
 * pays (vat-syntax.ts) + un port VIES optionnel" — this file is that port.
 *
 * The defect this exists to fix, verbatim from the repère's own header: hardcoding `validated: false`
 * for every VAT number would let an intra-EU B2B service come out at full domestic VAT instead of
 * reverse-charged — a tax the customer does not owe. Hardcoding `true` would trade one error for the
 * opposite one: trusting a free-text field would let anyone type a fake number and get 0%, an
 * UNDER-charge. Neither is the answer; knowing whether the number was actually CHECKED is — which is
 * exactly the `VatValidationStatus` below, and exactly why `PartyIdentifier.validationStatus` (this
 * branch's own schema, unchanged since before the demolition — see `clients.service.ts`'s own header)
 * distinguishes `INVALID` (the member state denied it) from `UNAVAILABLE` (we could not ask).
 *
 * Where this is called from: `modules/clients/clients.service.ts`, at CLIENT SAVE TIME (when a VAT
 * number is entered or changed), never at invoice send time — see that file's own header on why. The
 * cross-border tax WIRING (`resolve-invoice-tax.ts`) only ever READS the STORED verdict
 * (`PartyIdentifier.validationStatus`); it never calls this port itself, so a slow or saturated VIES
 * never delays sending an invoice, only saving a client.
 */
import { validateVat } from './vat-syntax';

export type VatValidationStatus = 'VALID' | 'INVALID' | 'UNAVAILABLE';

export interface VatValidationResult {
  status: VatValidationStatus;
  /** When this verdict was obtained. A stored "valid" without a date is not a fact. */
  checkedAt: Date;
  /** Which service answered, so a stored verdict can be attributed and re-checked. */
  source: string;
}

export interface VatValidationPort {
  /**
   * Never throws. A transport failure is an `UNAVAILABLE` verdict, not an exception: validating a
   * VAT number is not allowed to be the thing that stops a client from being saved.
   */
  validate(countryCode: string, vatNumber: string): Promise<VatValidationResult>;
}

/** The default for any context without a real one: it never claims a number is valid. */
export class NullVatValidationClient implements VatValidationPort {
  async validate(_countryCode?: string, _vatNumber?: string): Promise<VatValidationResult> {
    return { status: 'UNAVAILABLE', checkedAt: new Date(), source: 'none' };
  }
}

/**
 * Root TODO item 16 ("transfrontalier") — a SECOND offline, deterministic, network-free client,
 * distinct from `NullVatValidationClient` above: it answers `VALID` for a number that PASSES its own
 * syntax check (`vat-syntax.ts`), `INVALID` otherwise. Never touches a network — the exact same "CI
 * job must never depend on... VIES being up" contract `NullVatValidationClient`'s own module wiring
 * already holds (`clients.module.ts`) — but unlike the null client, it lets the VALID→B2B/reverse-
 * charge transition be OBSERVED end-to-end through a real browser, which `clients.module.ts`'s own
 * pre-existing header comment used to document as unreachable from e2e ("What e2e cannot cover is
 * the VALID -> AE transition, because that needs an answer only VIES can give"). That was true before
 * this task: e2e is the ONE place `resolve-invoice-tax.ts`'s B2B/reverse-charge branch can be proven
 * through the SCREEN (spec 35), and a Cypress run cannot reach the real European Commission service —
 * so this fake exists to make that one transition reachable, opted into explicitly
 * (`VAT_VALIDATION_FAKE=1`, set only in `backend/.env.test`) rather than silently changing what
 * `NODE_ENV=test` alone already means for every other jest suite.
 */
export class FakeSyntaxOnlyVatValidationClient implements VatValidationPort {
  async validate(countryCode: string, vatNumber: string): Promise<VatValidationResult> {
    // The exact same reprised repère syntax dispatcher `resolve-invoice-tax.ts` itself already runs
    // before ever consulting a real (or fake) validator — imported here directly rather than
    // assuming the caller already ran it, so this class means the same thing standalone.
    const syntax = validateVat(vatNumber, countryCode);
    return {
      status: syntax.valid ? 'VALID' : 'INVALID',
      checkedAt: new Date(),
      source: 'fake-syntax-only (e2e — VAT_VALIDATION_FAKE=1, never a real VIES call)',
    };
  }
}

/**
 * The EU VIES service — REPRISE, adapted to wrap THIS branch's own `ViesProvider`
 * (`modules/company-lookup/providers/vies.provider.ts`, which survived the demolition unchanged)
 * rather than the removed repère's own bespoke VIES HTTP client: same public endpoint, same "no
 * credentials, a saturated member state is an error not a not-found" behaviour, one fewer HTTP client
 * to maintain. `ViesProvider.lookup` already turns "the number IS valid" into a non-null result and
 * "the member state says INVALID" into `null` — this class only needs to translate those two (plus
 * the transport-failure case) into the three-way `VatValidationStatus`.
 */
export interface ViesLikeProvider {
  supports(query: { scheme: 'VAT'; countryCode: string; value: string }): boolean;
  lookup(query: { scheme: 'VAT'; countryCode: string; value: string }): Promise<unknown>;
}

export class ViesVatValidationClient implements VatValidationPort {
  constructor(private readonly provider: ViesLikeProvider) {}

  async validate(countryCode: string, vatNumber: string): Promise<VatValidationResult> {
    const checkedAt = new Date();
    const query = { scheme: 'VAT' as const, countryCode, value: vatNumber };
    // A country VIES does not cover (any non-EU country, e.g. a US "VAT" typed by mistake) is not
    // the NUMBER's fault — `ViesProvider.supports` is exactly the same coverage check
    // `company-lookup.service.ts` already uses before ever calling `lookup`, reused here rather than
    // re-deriving the EU member list a second time.
    if (!this.provider.supports(query)) {
      return { status: 'UNAVAILABLE', checkedAt, source: 'eu-vies' };
    }
    try {
      const result = await this.provider.lookup(query);
      return { status: result ? 'VALID' : 'INVALID', checkedAt, source: 'eu-vies' };
    } catch {
      // The case a suite that cannot exercise it cannot prove: VIES is regularly saturated
      // (`userError: MS_MAX_CONCURRENT_REQ`, thrown by `ViesProvider#lookup` as a
      // `ProviderLookupError`), and a transport failure must be a VERDICT, not an exception —
      // validating a VAT number is never allowed to be the thing that stops a client being saved.
      return { status: 'UNAVAILABLE', checkedAt, source: 'eu-vies' };
    }
  }
}
