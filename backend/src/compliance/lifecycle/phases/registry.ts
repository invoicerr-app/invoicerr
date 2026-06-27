/**
 * Ordered registry of lifecycle phase contributors (COMPLIANCE_LIFECYCLE.md §2). Mirrors
 * regimes/registry.ts. Order is the natural lifecycle order so the assembled graph reads top-to-bottom.
 */
import { PhaseContributor } from './phase-contributor';
import {
  BuyerResponsePhase,
  ClearancePhase,
  CorrectionsPhase,
  DeliveryPhase,
  IssuancePhase,
  ReportingPhase,
} from './contributors';

export class PhaseContributorRegistry {
  readonly contributors: PhaseContributor[];

  constructor(contributors?: PhaseContributor[]) {
    this.contributors = contributors ?? [
      new IssuancePhase(),
      new ClearancePhase(),
      new DeliveryPhase(),
      new BuyerResponsePhase(),
      new ReportingPhase(),
      new CorrectionsPhase(),
    ];
  }
}

export const defaultPhaseRegistry = new PhaseContributorRegistry();
