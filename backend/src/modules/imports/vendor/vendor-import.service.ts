/**
 * The server side of a vendor export upload: an XLSX workbook, or the ZIP archive Tiime delivers
 * with its workbooks inside. A CSV never comes here; the browser parses it, as both existing CSV
 * imports already do.
 *
 * This step only reads and recognises the file. It writes nothing, and it maps nothing onto the
 * client or past-document import rows yet: the dialog shows the recognised tool and the grid.
 */
import { BadRequestException, Injectable } from '@nestjs/common';

import { detectVendorExport } from './vendor-export-map';
import { VendorExportFileError, readVendorExportFile } from './vendor-export-workbook';
import { VendorExportKind } from './vendor-export.types';

export interface VendorFilePreviewWorkbook {
  /** The workbook's path inside the archive, shown to the user only; `undefined` for a bare XLSX. */
  fileName?: string;
  detected: boolean;
  profileId?: string;
  vendorLabel?: string;
  label?: string;
  headers: string[];
  rows: string[][];
}

export interface VendorFilePreview {
  kind: VendorExportKind;
  workbooks: VendorFilePreviewWorkbook[];
  /** PDFs found in the archive. They are not read yet; the count tells the user they were skipped. */
  ignoredPdfCount: number;
}

@Injectable()
export class VendorImportService {
  /**
   * Reads one uploaded file entirely in memory. Every refusal of the reader (not a zip, too large
   * once inflated, too many entries or cells, a DOCTYPE, an invalid date) becomes a 400 naming the
   * problem; anything else is a real bug and stays a 500.
   */
  async previewFile(kind: VendorExportKind, bytes: Uint8Array): Promise<VendorFilePreview> {
    let upload: Awaited<ReturnType<typeof readVendorExportFile>>;
    try {
      upload = await readVendorExportFile(bytes);
    } catch (error) {
      if (error instanceof VendorExportFileError) throw new BadRequestException(error.message);
      throw error;
    }

    return {
      kind,
      workbooks: upload.workbooks.map(({ fileName, grid }) => {
        // Only a profile that the tool actually delivers as a workbook may claim one: a CSV-only
        // profile matching these headers would be a coincidence, not a recognised export.
        const profile = detectVendorExport(kind, grid.headers);
        const readsWorkbooks = profile?.fileTypes?.some((type) => type === 'xlsx' || type === 'zip');
        const base = { fileName, headers: grid.headers, rows: grid.rows };
        if (!profile || !readsWorkbooks) return { ...base, detected: false };
        return {
          ...base,
          detected: true,
          profileId: profile.id,
          vendorLabel: profile.vendorLabel,
          label: profile.label,
        };
      }),
      ignoredPdfCount: upload.pdfFiles.length,
    };
  }
}
