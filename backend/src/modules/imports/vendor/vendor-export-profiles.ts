/**
 * Vendor export profiles: one record per (tool, export type), never a branch in code.
 *
 * Each tool's profiles are added with the mapping that reads them, one tool at a time, each with
 * the help-centre sources its column names come from. Detection order matters: declare the most
 * specific header set first, because `detectVendorExport` returns the first full match.
 */
import { VendorExportProfile } from './vendor-export.types';

export const VENDOR_EXPORT_PROFILES: VendorExportProfile[] = [];
