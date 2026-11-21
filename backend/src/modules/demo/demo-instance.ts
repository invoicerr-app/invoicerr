import { DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_PASSWORD, isDemoModeEnabled } from './demo-flag';

/** Set by the deployment to match the schedule of its own reset job, which the product does not run. */
export const DEMO_RESET_INTERVAL_FLAG_NAME = 'DEMO_RESET_INTERVAL_HOURS';
const DEFAULT_RESET_INTERVAL_HOURS = 4;

/** What a visitor is told about a demo instance before signing in. The password is public by design. */
export interface DemoInstanceView {
  email: string;
  password: string;
  resetIntervalHours: number;
}

export function describeDemoInstance(env: NodeJS.ProcessEnv = process.env): DemoInstanceView | null {
  if (!isDemoModeEnabled(env)) return null;
  return {
    email: DEMO_ACCOUNT_EMAIL,
    password: DEMO_ACCOUNT_PASSWORD,
    resetIntervalHours: readResetIntervalHours(env),
  };
}

function readResetIntervalHours(env: NodeJS.ProcessEnv): number {
  const raw = (env[DEMO_RESET_INTERVAL_FLAG_NAME] ?? '').trim();
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : DEFAULT_RESET_INTERVAL_HOURS;
}
