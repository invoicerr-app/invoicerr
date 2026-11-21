/**
 * The per-transport half of a declarative-reporting channel: what actually speaks to the accredited
 * platform's e-reporting API once `fr-pa` (the legal channel) has resolved WHICH connected operator
 * the company uses.
 *
 * Kept separate from `DeclarationProvider` on purpose. A `DeclarationProvider` is one strategy per
 * national obligation (`fr-pa`, `pt-at`), while several OPERATORS may implement the same legal
 * channel through different transports (`operators/data/*.json`, `capabilities.eReporting`). The
 * provider resolves the operator; the adapter speaks its API. Adding Iopole, Billit or Invopop is
 * then one adapter and one catalogue flag, never a second declaration provider and never a vendor
 * name in country data.
 */
import { DeclaredInvoice, DeclaredPayment, DeclarationResult } from './declaration-provider';

export interface EReportingAdapter {
  /** A `transports/transport-registry.ts` id, matching the connected channel's own id. */
  readonly transportId: string;
  /** Declares one invoice's data. */
  declareTransaction(companyId: string, invoice: DeclaredInvoice): Promise<DeclarationResult>;
  /** Declares one payment's data. */
  declarePayment(companyId: string, payment: DeclaredPayment): Promise<DeclarationResult>;
  /**
   * Tells the platform the company's VAT regime and VAT-on-debits option, which decide the
   * platform's own declaration schedule. Optional: not every platform exposes it.
   */
  syncCompanyProfile?(companyId: string, profile: { vatRegime: string; vatOnDebits: boolean }): Promise<void>;
}

export class EReportingAdapterRegistry {
  private readonly adapters = new Map<string, EReportingAdapter>();

  register(adapter: EReportingAdapter): void {
    if (this.adapters.has(adapter.transportId)) {
      throw new Error(`An e-reporting adapter for "${adapter.transportId}" is already registered.`);
    }
    this.adapters.set(adapter.transportId, adapter);
  }

  resolve(transportId: string): EReportingAdapter | undefined {
    return this.adapters.get(transportId);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
