import { RegimeModel } from '../types';
import { RegimeHandler } from './regime-handler';
import {
  ClearanceRegimeHandler,
  DecentralizedCtcRegimeHandler,
  PeriodicReportingRegimeHandler,
  PostAuditRegimeHandler,
  RealTimeReportingRegimeHandler,
} from './handlers';

export class RegimeHandlerRegistry {
  private readonly byModel = new Map<RegimeModel, RegimeHandler>();

  constructor(handlers?: RegimeHandler[]) {
    const list = handlers ?? [
      new PostAuditRegimeHandler(),
      new PeriodicReportingRegimeHandler(),
      new RealTimeReportingRegimeHandler(),
      new ClearanceRegimeHandler(),
      new DecentralizedCtcRegimeHandler(),
    ];
    for (const h of list) this.byModel.set(h.model, h);
  }

  get(model: RegimeModel): RegimeHandler {
    return this.byModel.get(model) ?? this.byModel.get('POST_AUDIT')!;
  }
}

export const defaultRegimeRegistry = new RegimeHandlerRegistry();
