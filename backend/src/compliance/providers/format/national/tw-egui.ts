/**
 * Taiwan eGUI — Asia.
 *
 * Stub for the `TW_EGUI` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const TW_EGUI_FORMAT: NationalFormatSpec = {
  id: 'tw-egui',
  syntax: 'TW_EGUI',
  label: 'Taiwan eGUI',
  buildHint: 'build NRA eGUI (MIG) unified-invoice XML + invoice-number track',
};
