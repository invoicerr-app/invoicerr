/**
 * India (IN) — Asia-Pacific.
 * IRN / IRP clearance + e-way
 */
import { clearance, gst } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const IN: CountryComplianceProfile = clearance('IN', 'India', {
  syntax: 'IN_IRP',
  providerId: 'in-irp',
  tax: gst(18, [28, 12, 5]),
});
