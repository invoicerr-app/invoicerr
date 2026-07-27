/**
 * Argentina Factura Electrónica — LATAM.
 *
 * Stub for the `AR_FE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const AR_FE_FORMAT: NationalFormatSpec = {
  id: 'ar-fe',
  syntax: 'AR_FE',
  label: 'Argentina Factura Electrónica',
  buildHint: 'build ARCA/AFIP WSFE comprobante + request CAE; embed CAE + vencimiento',
};
