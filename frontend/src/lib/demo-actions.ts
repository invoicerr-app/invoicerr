/**
 * Declared document actions that leave the instance and are refused server-side in demo mode
 * (`backend/src/modules/demo/demo-blocked.ts`). Disabling them in the UI is a pre-warning, never the
 * enforcement: the server still refuses every one of them.
 *
 * Only `send` names a transmission today. Recording a payment and validating a document stay local:
 * `validate` numbers and locks the record (it only routes through a transport for a seller whose
 * country mandates a channel, and the demo's own spec asserts that local validation still works).
 */
const DEMO_BLOCKED_ACTION_IDS = new Set(["send"])

export function isDemoBlockedAction(actionId: string, demoMode: boolean): boolean {
  return demoMode && DEMO_BLOCKED_ACTION_IDS.has(actionId)
}
