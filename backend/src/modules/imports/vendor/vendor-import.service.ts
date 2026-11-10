/**
 * Turns a parsed vendor export into the rows the existing imports already understand (issue #759).
 * Clients map straight onto `ClientImportRow`; invoices map onto `DocumentImportCsvRow` and get
 * their `clientId` resolved here, because the export names the client but the past-document import
 * only accepts an id. Resolution is exact-name or exact-primary-contact, never a fuzzy guess: an
 * unmatched or ambiguous name is a rejected row with the reason, so the user imports the client
 * list first (the normal migration order).
 */
import { BadRequestException, Injectable } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { Prisma } from '../../../../prisma/generated/prisma/client';

import { detectVendorExport, mapVendorExport, VendorExportMappingError } from './vendor-export-map';
import { vendorRowError } from './vendor-export-messages';
import {
  VendorExportGrid,
  VendorExportKind,
  VendorExportProfile,
  VendorExportResult,
  VendorMappedClientRow,
  VendorMappedInvoiceRow,
} from './vendor-export.types';

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface ClientCandidate {
  id: string;
  name: string;
  contacts: { firstName: string | null; lastName: string | null }[];
}

/** Every spelling a company name or a primary contact can be looked up by. */
function candidateKeys(candidate: ClientCandidate): string[] {
  const keys = [normalizedName(candidate.name)];
  for (const contact of candidate.contacts) {
    const first = normalizedName(contact.firstName ?? '');
    const last = normalizedName(contact.lastName ?? '');
    if (first && last) keys.push(`${first} ${last}`, `${last} ${first}`);
    else if (first || last) keys.push(first || last);
  }
  return keys.filter(Boolean);
}

@Injectable()
export class VendorImportService {
  /**
   * Detection + mapping for one parsed file. A file that no profile recognises returns
   * `detected: false` so the dialog keeps its generic template path; a recognised file with a
   * missing required column throws, naming the column, because importing a guessed subset would be
   * worse than asking the user to keep the export unchanged.
   */
  async preview(
    companyId: string,
    kind: VendorExportKind,
    grid: VendorExportGrid,
  ): Promise<VendorExportResult> {
    const profile = detectVendorExport(kind, grid.headers);
    if (!profile) {
      return {
        detected: false,
        kind,
        reason:
          'This file does not match the header row of a known Abby, Henrri or Tiime export. ' +
          'Nothing was imported.',
      };
    }

    if (profile.kind === 'invoices') {
      const rows = this.map(profile, grid) as VendorMappedInvoiceRow[];
      await this.resolveInvoiceClients(companyId, rows);
      return {
        detected: true,
        vendor: profile.vendor,
        vendorLabel: profile.vendorLabel,
        kind: profile.kind,
        profileId: profile.id,
        label: profile.label,
        rows,
      };
    }

    return {
      detected: true,
      vendor: profile.vendor,
      vendorLabel: profile.vendorLabel,
      kind: profile.kind,
      profileId: profile.id,
      label: profile.label,
      rows: this.map(profile, grid) as VendorMappedClientRow[],
    };
  }

  /** One place to turn the pure mapper's refusal into this API's 400. */
  private map(profile: VendorExportProfile, grid: VendorExportGrid): ReturnType<typeof mapVendorExport> {
    try {
      return mapVendorExport(profile, grid);
    } catch (error) {
      if (error instanceof VendorExportMappingError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Fills `clientId` on every mapped invoice row. One query for the whole file, matching the
   * company name (case-insensitive) or the primary contact's exact first/last name in either
   * order. Zero matches and several matches both reject the row: the user decides, never a guess.
   */
  private async resolveInvoiceClients(companyId: string, rows: VendorMappedInvoiceRow[]): Promise<void> {
    const wanted = Array.from(
      new Set(
        rows
          .filter((entry) => entry.status === 'mapped' && !entry.row.clientId && entry.row.clientName)
          .map((entry) => entry.row.clientName as string),
      ),
    );
    if (wanted.length === 0) return;

    const or: Prisma.ClientWhereInput[] = [];
    for (const name of wanted) {
      or.push({ name: { equals: name, mode: 'insensitive' } });
      const parts = normalizedName(name).split(' ');
      if (parts.length > 1) {
        const first = parts[0];
        const rest = parts.slice(1).join(' ');
        const last = parts[parts.length - 1];
        const head = parts.slice(0, -1).join(' ');
        or.push({
          contacts: {
            some: {
              isPrimary: true,
              firstName: { equals: first, mode: 'insensitive' },
              lastName: { equals: rest, mode: 'insensitive' },
            },
          },
        });
        or.push({
          contacts: {
            some: {
              isPrimary: true,
              firstName: { equals: last, mode: 'insensitive' },
              lastName: { equals: head, mode: 'insensitive' },
            },
          },
        });
      }
    }

    const candidates = await prisma.client.findMany({
      where: { companyId, isActive: true, OR: or },
      select: {
        id: true,
        name: true,
        contacts: {
          where: { isPrimary: true },
          select: { firstName: true, lastName: true },
          take: 1,
        },
      },
    });

    const byKey = new Map<string, ClientCandidate[]>();
    for (const candidate of candidates) {
      for (const key of candidateKeys(candidate)) {
        const bucket = byKey.get(key) ?? [];
        if (!bucket.some((entry) => entry.id === candidate.id)) bucket.push(candidate);
        byKey.set(key, bucket);
      }
    }

    for (const entry of rows) {
      if (entry.status !== 'mapped' || entry.row.clientId) continue;
      const clientName = entry.row.clientName;
      if (!clientName) continue;
      const matches = byKey.get(normalizedName(clientName)) ?? [];
      const unique = Array.from(new Map(matches.map((match) => [match.id, match])).values());
      if (unique.length === 1) {
        entry.row.clientId = unique[0].id;
        continue;
      }
      entry.status = 'rejected';
      entry.errors = [
        unique.length === 0
          ? vendorRowError('noClientMatch', { row: entry.rowNumber, name: clientName })
          : vendorRowError('ambiguousClient', { row: entry.rowNumber, name: clientName }),
      ];
    }
  }
}
