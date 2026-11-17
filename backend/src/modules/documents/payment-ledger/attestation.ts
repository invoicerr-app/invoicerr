import prisma from '@/prisma/prisma.service';
import { getInstalledVersion } from '@/lib/app-version';

import { AttestationPlaceholder, CountryCashRecordingFile } from './cash-recording-schema';
import { requireCashRecordingSection } from './country-section';

/** A value the publisher has not configured is printed as a line to fill in by hand. */
const BLANK = '________';

export interface PublisherAttestation {
  reference: string;
  fileName: string;
  text: string;
  /** Placeholders printed blank because no value was configured. */
  missing: AttestationPlaceholder[];
}

/** The publisher's identity is the operator's, set by environment: a self-hosting business is its
 *  own publisher in the sense of the model, the hosted service is the hosted service's. */
function publisherValues(): Partial<Record<AttestationPlaceholder, string>> {
  return {
    softwareName: 'Invoicerr',
    softwareVersion: getInstalledVersion().version,
    publisherName: process.env.CASH_RECORDING_PUBLISHER_NAME,
    publisherRepresentative: process.env.CASH_RECORDING_PUBLISHER_REPRESENTATIVE,
    publisherCity: process.env.CASH_RECORDING_PUBLISHER_CITY,
    marketedSince: process.env.CASH_RECORDING_MARKETED_SINCE,
  };
}

export function renderAttestation(
  model: CountryCashRecordingFile['attestation']['model'],
  values: Partial<Record<AttestationPlaceholder, string>>,
): PublisherAttestation {
  const missing = new Set<AttestationPlaceholder>();
  const fill = (template: string) =>
    template.replace(/\{([A-Za-z]+)\}/g, (_match, key: AttestationPlaceholder) => {
      const value = values[key]?.trim();
      if (value) return value;
      missing.add(key);
      return BLANK;
    });

  const text = model.blocks
    .map((block) => (block.heading ? `${fill(block.heading)}\n\n${fill(block.text)}` : fill(block.text)))
    .join('\n\n');
  return {
    reference: model.reference,
    fileName: model.fileName,
    text: `${text}\n`,
    missing: [...missing],
  };
}

export async function buildPublisherAttestation(
  companyId: string,
  now = new Date(),
): Promise<PublisherAttestation> {
  const section = await requireCashRecordingSection(companyId);
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true },
  });
  return renderAttestation(section.attestation.model, {
    ...publisherValues(),
    companyName: company.name,
    generatedOn: now.toISOString().slice(0, 10),
  });
}
