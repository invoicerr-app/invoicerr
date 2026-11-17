/**
 * The French and Portuguese reporting sections exactly as they shipped in the legacy `facts` shape,
 * frozen when issue #768 rewrote `countries/data/{fr,pt}.json` in the v2 shape. Specs only: they pin
 * the legacy classifier and `upgradeLegacyFacts` against real-world facts, and prove the shipped v2
 * files are the upgrade of these (`obligation-v2.spec.ts`). Issue #769 deletes the legacy shape, and
 * this fixture with it. Its only edit: em dashes in the notes became plain hyphens, as in the
 * shipped files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CountryReportingObligationFile } from '../schema';

export const LEGACY_REPORTING_FILES: CountryReportingObligationFile[] = JSON.parse(
  readFileSync(join(__dirname, 'legacy-reporting-files.json'), 'utf8'),
);
