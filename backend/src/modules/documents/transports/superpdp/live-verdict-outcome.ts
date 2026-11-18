import { appendFileSync } from 'node:fs';

import {
  PDP_ACCEPTED_STATUS_CODE,
  PDP_REJECTED_STATUS_CODE,
} from '@/modules/documents/conformity/pollers/superpdp-status-poller';

/**
 * What a live conformity journal proves once the verdict budget has run out.
 *
 * - `decided`: the platform issued a terminal status (fr:202 accepted or fr:213 rejected); the
 *   caller asserts on which one.
 * - `inconclusive`: fr:200 (deposited) AND fr:201 (issued) are journaled but no terminal status.
 *   The sandbox sometimes withholds fr:202 on a single deposit for minutes while others in the same
 *   run get it in seconds, and a longer wait was measured not to help. That is the platform not
 *   deciding, not our poller failing, so it is reported loudly but does not turn the run red.
 * - `failed`: anything else (fr:200 or fr:201 missing), which means our own deposit or poller did
 *   not get as far as the platform always goes, and stays a hard failure.
 */
export type LiveVerdictOutcome = 'decided' | 'inconclusive' | 'failed';

const TERMINAL_CODES = [PDP_ACCEPTED_STATUS_CODE, PDP_REJECTED_STATUS_CODE];
const PRE_VERDICT_CODES = ['fr:200', 'fr:201'];

export function classifyLiveVerdict(codes: readonly string[]): LiveVerdictOutcome {
  if (codes.some((code) => TERMINAL_CODES.includes(code))) return 'decided';
  if (PRE_VERDICT_CODES.every((code) => codes.includes(code))) return 'inconclusive';
  return 'failed';
}

export interface InconclusiveReportSinks {
  /** Path of the GitHub job summary file; absent outside Actions. */
  summaryPath?: string;
  appendFile?: (path: string, data: string) => void;
  log?: (line: string) => void;
}

/**
 * Makes an inconclusive verdict visible without failing the test: a `::warning` annotation on the
 * run, plus a section in the job summary when one is available.
 */
export function reportInconclusiveVerdict(
  depositId: string,
  codes: readonly string[],
  budgetMs: number,
  sinks: InconclusiveReportSinks = {},
): string {
  const summaryPath = 'summaryPath' in sinks ? sinks.summaryPath : process.env.GITHUB_STEP_SUMMARY;
  const appendFile = sinks.appendFile ?? ((path, data) => appendFileSync(path, data));
  const log = sinks.log ?? ((line) => console.log(line));

  const journal = JSON.stringify(codes);
  const message =
    `superpdp INCONCLUSIVE: deposit ${depositId} reached fr:200 and fr:201 but no fr:202/fr:213 ` +
    `within ${budgetMs / 1000}s - journaled: ${journal}. Sandbox did not decide; not counted as a failure.`;
  log(`::warning title=SuperPDP verdict inconclusive::${message}`);
  if (summaryPath) {
    appendFile(
      summaryPath,
      [
        '### :warning: SuperPDP conformity verdict inconclusive',
        '',
        `- Deposit: \`${depositId}\``,
        `- Budget: ${budgetMs / 1000}s`,
        `- Journal: \`${journal}\``,
        '',
        'fr:200 and fr:201 arrived, fr:202 did not. The test was not counted as failed.',
        '',
      ].join('\n'),
    );
  }
  return message;
}
