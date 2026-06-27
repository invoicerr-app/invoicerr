import { TaxSystemKind } from '../types';
import { TaxSystemHandler } from './tax-system';
import {
  ConsumptionTaxSystemHandler,
  GstTaxSystemHandler,
  NoTaxSystemHandler,
  SalesTaxSystemHandler,
  VatTaxSystemHandler,
} from './handlers';

export class TaxSystemRegistry {
  private readonly byKind = new Map<TaxSystemKind, TaxSystemHandler>();

  constructor(handlers?: TaxSystemHandler[]) {
    const list = handlers ?? [
      new VatTaxSystemHandler(),
      new GstTaxSystemHandler(),
      new SalesTaxSystemHandler(),
      new ConsumptionTaxSystemHandler(),
      new NoTaxSystemHandler(),
    ];
    for (const h of list) this.byKind.set(h.kind, h);
  }

  get(kind: TaxSystemKind): TaxSystemHandler {
    return this.byKind.get(kind) ?? this.byKind.get('NONE')!;
  }
}

export const defaultTaxSystemRegistry = new TaxSystemRegistry();
