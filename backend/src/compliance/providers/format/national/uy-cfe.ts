/**
 * Uruguay CFE/DFE — LATAM.
 *
 * Stub for the `UY_CFE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const UY_CFE_FORMAT: NationalFormatSpec = {
  id: 'uy-cfe',
  syntax: 'UY_CFE',
  label: 'Uruguay CFE/DFE',
  buildHint: 'build DGI CFE XML (e-Factura/e-Ticket) + sign',
};
