/**
 * Flow descriptor (FRONTEND_FLOW_WIRING.md §1–§3). Pure projection of a resolved CompliancePlan +
 * current ComplianceStatus into a UI-consumable shape: channel-aware send semantics, awaiting state,
 * and the ordered progression pipeline. No I/O — reusable by both the list mapping and the detail
 * endpoint.
 */
import { CompliancePlan } from '../engine/compliance-engine';
import { ChannelType } from '../types';
import { ChannelFeedback } from '../providers/transmission/transmission-provider';
import { defaultTransmissionRegistry } from '../providers/transmission/registry';
import { phaseContextFromPlan, assembleLifecycle } from './assembler';
import { LifecycleRuntime } from './runtime';
import { ComplianceStatus } from './state-machine';

export type ChannelClass = 'EMAIL' | 'CLEARANCE' | 'PEPPOL' | 'PORTAL' | 'PRINT';

export interface FlowDescriptor {
  primaryChannel: { type: ChannelType; providerId?: string; feedback: ChannelFeedback };
  channelClass: ChannelClass;
  sendLabelKey: string;
  awaiting: 'CLEARANCE' | 'BUYER_RESPONSE' | 'DELIVERY' | null;
  pipeline: string[];
  terminal: boolean;
  manualActions: string[];
}

const SEND_LABEL: Record<ChannelClass, string> = {
  EMAIL: 'sendByEmail',
  CLEARANCE: 'submitClearance',
  PEPPOL: 'sendViaPeppol',
  PORTAL: 'sendToPortal',
  PRINT: 'print',
};

const PIPELINES: Record<ChannelClass, string[]> = {
  EMAIL: ['draft', 'issued', 'sent', 'paid', 'archived'],
  PRINT: ['draft', 'issued', 'sent', 'paid', 'archived'],
  CLEARANCE: ['draft', 'issued', 'pending_clearance', 'cleared', 'sent', 'paid', 'archived'],
  PEPPOL: ['draft', 'issued', 'delivered', 'paid', 'archived'],
  PORTAL: ['draft', 'issued', 'delivered', 'paid', 'archived'],
};

const TERMINAL_STATUSES: ComplianceStatus[] = ['CANCELLED', 'CORRECTED', 'REJECTED', 'REFUSED', 'REPORTED'];

export function channelClassOf(plan: CompliancePlan): ChannelClass {
  const type = plan.channels?.[0]?.type ?? 'EMAIL';
  switch (type) {
    case 'EMAIL': return 'EMAIL';
    case 'PRINT': return 'PRINT';
    case 'PEPPOL': return 'PEPPOL';
    case 'SDI':
    case 'PAC':
    case 'OSE':
    case 'GOV_PORTAL_API':
    case 'PDP':
      return plan.regime?.blocking ? 'CLEARANCE' : 'PORTAL';
    default:
      return 'EMAIL';
  }
}

export function describeFlow(plan: CompliancePlan, status: ComplianceStatus): FlowDescriptor {
  const spec = plan.channels?.[0] ?? { type: 'EMAIL' as ChannelType };
  const provider = defaultTransmissionRegistry.resolve(spec);
  const channelClass = channelClassOf(plan);

  const graph = assembleLifecycle(plan, phaseContextFromPlan(plan, defaultTransmissionRegistry));
  const runtime = new LifecycleRuntime(graph, status);
  const drivers = runtime.pendingDrivers();
  const hasAsyncDriver = drivers.some((d) => d.kind === 'POLL' || d.kind === 'CALLBACK');

  let awaiting: FlowDescriptor['awaiting'] = null;
  if ((status === 'PENDING_CLEARANCE' || status === 'CONTINGENCY') && hasAsyncDriver) awaiting = 'CLEARANCE';
  else if (status === 'AWAITING_RESPONSE') awaiting = 'BUYER_RESPONSE';
  else if (status === 'ISSUED' && hasAsyncDriver) awaiting = 'DELIVERY';

  const terminal =
    TERMINAL_STATUSES.includes(status) ||
    (runtime.availableActions().length === 0 && drivers.length === 0);

  const manualActions = runtime.availableActions()
    .map((tr) => (tr.trigger.kind === 'MANUAL' ? tr.trigger.action : null))
    .filter((a): a is string => a !== null);

  return {
    primaryChannel: { type: spec.type, providerId: spec.providerId, feedback: provider?.feedback ?? 'NONE' },
    channelClass,
    sendLabelKey: SEND_LABEL[channelClass],
    awaiting,
    pipeline: PIPELINES[channelClass],
    terminal,
    manualActions,
  };
}
