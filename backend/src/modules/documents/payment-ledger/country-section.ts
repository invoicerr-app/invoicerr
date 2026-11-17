import { NotFoundException } from '@nestjs/common';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryCashRecordingFile } from './cash-recording-schema';

/** The company's country `cashRecording` section, or undefined when its country has none. */
export async function cashRecordingSectionFor(
  companyId: string,
): Promise<CountryCashRecordingFile | undefined> {
  const countryCode = await resolveCompanyCountryCode(companyId);
  return countryCode ? defaultComposedCountryCatalog.get(countryCode)?.cashRecording : undefined;
}

export async function requireCashRecordingSection(companyId: string): Promise<CountryCashRecordingFile> {
  const section = await cashRecordingSectionFor(companyId);
  if (!section) {
    throw new NotFoundException("The company's country defines no cash-recording rules.");
  }
  return section;
}
