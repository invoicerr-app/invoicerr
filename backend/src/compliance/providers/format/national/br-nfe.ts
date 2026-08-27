/**
 * Brazil NF-e family — LATAM.
 *
 * Stub for the `NFE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const BR_NFE_FORMAT: NationalFormatSpec = {
  id: 'nfe',
  syntax: 'NFE',
  label: 'Brazil NF-e family',
  buildHint: 'build SEFAZ NF-e/NFC-e/NFS-e/NFCom/CT-e XML (chNFe 44-char access key, ICP-Brasil XMLDSig)',
  validateHint: 'validate against the NF-e XSD + SEFAZ business rules',
};
