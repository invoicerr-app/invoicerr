import { vi, type Mock } from 'vitest';

import { ActionRegistry } from '../actions/action-registry';
import { registerInvoiceActions } from '../actions/invoice-actions';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import * as countryPolicy from '../country-policy/country-policy';
import * as takeNumber from '../numbering/take-number';
import * as persistence from '../persistence';
import * as taxLoadAndResolve from '../tax/load-and-resolve';
import * as companyTransport from '../transports/company-transport';
import * as mandate from '../transports/channel-policy/mandate';
import { TransportRegistry } from '../transports/transport-registry';

/** Fixtures shared by the invoice action specs that mock persistence, numbering, country policy and
 *  the channel mandate wholesale. The calling spec owns the `vi.mock(...)` declarations. */

export const FR_MANDATE = {
  providerId: 'pdp',
  mandatedFrom: '2026-09-01',
  provenance: {
    kind: 'legal' as const,
    sourceText: 'Seule une plateforme agréée est habilitée à assurer toutes les fonctionnalités prévues.',
    sourceCheckedAt: '2026-08-27',
  },
};

export const NUMBERED = { number: 1, displayNumber: 'INV-2026-0001' };

export function invoiceData(issueDate: string) {
  return {
    client: 'client-1',
    issueDate,
    dueDate: '2026-09-30',
    currency: 'EUR',
    lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' }],
  };
}

export function invoiceRow(data: unknown, status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status,
    data,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

export function mockAtomicNumbering(document: unknown) {
  (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
    document,
    numbered: NUMBERED,
  });
}

/** Permissive stand-ins for cross-border VAT and B2G routing, neither of which these specs exercise. */
export function mockNeutralIssuanceContext() {
  (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
    (_companyId: string, data: Record<string, unknown>) =>
      Promise.resolve({ data, crossBorder: false, warnings: [] }),
  );
  (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({
    applies: false,
    missingIdentifierSchemes: [],
  });
}

export function mockCompany(setup: {
  countryCode: string;
  mandate: unknown;
  transportId?: string | null;
  document?: unknown;
}) {
  (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue(setup.countryCode);
  (mandate.activeChannelMandateForOperation as Mock).mockReturnValue(setup.mandate);
  if (setup.transportId !== undefined) {
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue(setup.transportId);
  }
  if (setup.document !== undefined) {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(setup.document);
  }
}

export function buildRegistry(transportRegistry = new TransportRegistry()) {
  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });
  return registry;
}

/** Resolves an invoice action from a registry holding the given transports and runs it. */
export function runInvoiceAction(
  actionId: string,
  data: unknown,
  extra: Record<string, unknown> = {},
  transportRegistry?: TransportRegistry,
) {
  const handler = buildRegistry(transportRegistry).resolve('invoice', actionId);
  return handler!({
    companyId: 'company-1',
    typeId: 'invoice',
    documentId: 'doc-1',
    data,
    params: {},
    ...extra,
  } as Parameters<NonNullable<typeof handler>>[0]);
}
