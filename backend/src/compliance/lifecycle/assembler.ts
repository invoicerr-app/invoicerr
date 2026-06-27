/**
 * Lifecycle assembler (COMPLIANCE_LIFECYCLE.md §1/§7). Composes the phase fragments for one resolved
 * plan into a single, frozen LifecycleGraph — validated against the legal superset in state-machine.ts.
 * Pure (no I/O); the graph is snapshotted on the invoice at issue and never mutated afterwards.
 */
import { CompliancePlan } from '../engine/compliance-engine';
import { defaultTransmissionRegistry, TransmissionProviderRegistry } from '../providers/transmission/registry';
import { PhaseContext } from './phases/phase-contributor';
import { defaultPhaseRegistry, PhaseContributorRegistry } from './phases/registry';
import { ComplianceStateMachine, ComplianceStatus } from './state-machine';
import { TransitionSpec } from './triggers';

export interface LifecycleGraph {
  initial: ComplianceStatus;
  states: ComplianceStatus[];
  transitions: TransitionSpec[];
  profileVersion?: string; // stamped by the caller so the doc lives by the rules of its issue date
}

/** Resolve the primary channel's feedback model so async phases get the right driver. */
export function phaseContextFromPlan(
  plan: CompliancePlan,
  txRegistry: TransmissionProviderRegistry = defaultTransmissionRegistry,
): PhaseContext {
  const primary = plan.channels[0];
  const provider = primary ? txRegistry.resolve(primary) : null;
  return {
    channelFeedback: provider?.feedback,
    channelProviderId: provider?.id,
    pollPolicy: provider?.pollPolicy,
  };
}

/** Compose + validate the lifecycle graph for a plan. Throws if a phase emits an illegal transition. */
export function assembleLifecycle(
  plan: CompliancePlan,
  pctx: PhaseContext,
  registry: PhaseContributorRegistry = defaultPhaseRegistry,
): LifecycleGraph {
  const states = new Set<ComplianceStatus>();
  const transitions: TransitionSpec[] = [];
  const seen = new Set<string>();

  for (const contributor of registry.contributors) {
    const fragment = contributor.contributes(plan, pctx);
    if (!fragment) continue;
    fragment.states.forEach((s) => states.add(s));
    for (const t of fragment.transitions) {
      // Legality guard: every composed edge must exist in the canonical superset (state-machine.ts).
      const sm = new ComplianceStateMachine(t.from);
      if (!sm.can(t.on) || sm.apply(t.on) !== t.to) {
        throw new Error(
          `Phase "${contributor.id}" produced an illegal transition: ${t.from} --${t.on}--> ${t.to}`,
        );
      }
      const key = `${t.from}|${t.on}|${t.to}`;
      if (seen.has(key)) continue; // a later phase already contributed this edge
      seen.add(key);
      transitions.push(t);
    }
  }

  return { initial: 'DRAFT', states: [...states], transitions };
}

/** Convenience: resolve the channel feedback from the default registry and assemble. */
export function assembleFromPlan(plan: CompliancePlan): LifecycleGraph {
  return assembleLifecycle(plan, phaseContextFromPlan(plan));
}
