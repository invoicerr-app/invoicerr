/**
 * India GST e-invoice — Added with the dev docs merge (new clearance majors with a national schema).
 *
 * Stub for the `IN_IRP` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const IN_IRP_FORMAT: NationalFormatSpec = {
  id: 'in-irp',
  syntax: 'IN_IRP',
  label: 'India GST e-invoice',
  buildHint: 'build the GST INV-01 JSON for the IRP; receive IRN + signed QR',
};
