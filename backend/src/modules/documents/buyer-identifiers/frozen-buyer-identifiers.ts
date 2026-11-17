/**
 * The buyer's identifiers as they stood when a document was numbered (`DocumentInstance.buyerIdentifiers`).
 *
 * A client record keeps changing after an invoice is issued: a VAT number gets corrected, a VIES check
 * flips to INVALID, a legal id is added. None of that may reach a document already issued, for the same
 * reason its `displayNumber` and VAT conversion are frozen: the PDF, the XML and every declaration of an
 * issued invoice must keep saying what was true when it was issued.
 *
 *  - `freezeBuyerIdentifiers` runs inside the numbering transaction (`numbering/sequence.ts`) and
 *    returns the value written next to `number`/`displayNumber`.
 *  - `withIssuedBuyerIdentifiers` is what every reader calls on the client row it loaded: once a
 *    document carries a snapshot, the snapshot replaces the client's current identifiers.
 *
 * A document numbered before this column existed has `null` and keeps reading the live client record,
 * which is all that can be known about it.
 */
import { Prisma } from '../../../../prisma/generated/prisma/client';

export interface FrozenBuyerIdentifier {
  scheme: string;
  value: string;
  validationStatus: string | null;
  validatedAt: string | null;
  validationSource: string | null;
}

interface PartyIdentifierRow {
  scheme: string;
  value: string;
  validationStatus?: string | null;
  validatedAt?: Date | string | null;
  validationSource?: string | null;
}

type Db = Pick<Prisma.TransactionClient, 'client' | 'documentInstance'>;

export function snapshotBuyerIdentifiers(rows: readonly PartyIdentifierRow[]): FrozenBuyerIdentifier[] {
  return rows
    .map((row) => ({
      scheme: row.scheme,
      value: row.value,
      validationStatus: row.validationStatus ?? null,
      validatedAt:
        row.validatedAt instanceof Date ? row.validatedAt.toISOString() : (row.validatedAt ?? null),
      validationSource: row.validationSource ?? null,
    }))
    .sort((a, b) => a.scheme.localeCompare(b.scheme));
}

/** `null` when the document was never frozen (unnumbered, numbered before the column, no buyer).
 *  Anything that is not the shape this file writes is treated the same way, never half-read. */
export function parseFrozenBuyerIdentifiers(value: unknown): FrozenBuyerIdentifier[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: FrozenBuyerIdentifier[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const {
      scheme,
      value: idValue,
      validationStatus,
      validatedAt,
      validationSource,
    } = entry as Record<string, unknown>;
    if (typeof scheme !== 'string' || typeof idValue !== 'string') return null;
    parsed.push({
      scheme,
      value: idValue,
      validationStatus: typeof validationStatus === 'string' ? validationStatus : null,
      validatedAt: typeof validatedAt === 'string' ? validatedAt : null,
      validationSource: typeof validationSource === 'string' ? validationSource : null,
    });
  }
  return parsed;
}

/**
 * The client row a reader loaded, with its identifiers as issued on `document`. Returns the row
 * unchanged (live identifiers) when the document carries no snapshot.
 */
export type WithIssuedBuyerIdentifiers<T extends { partyIdentifiers: readonly PartyIdentifierRow[] }> = {
  [K in keyof T]: K extends 'partyIdentifiers' ? (T[K][number] | FrozenBuyerIdentifier)[] : T[K];
};

export function withIssuedBuyerIdentifiers<T extends { partyIdentifiers: readonly PartyIdentifierRow[] }>(
  client: T,
  document: { buyerIdentifiers?: unknown } | null | undefined,
): WithIssuedBuyerIdentifiers<T> {
  const frozen = parseFrozenBuyerIdentifiers(document?.buyerIdentifiers);
  if (!frozen) return client as unknown as WithIssuedBuyerIdentifiers<T>;
  return { ...client, partyIdentifiers: frozen } as WithIssuedBuyerIdentifiers<T>;
}

async function clientSnapshot(
  db: Db,
  companyId: string,
  clientId: unknown,
): Promise<FrozenBuyerIdentifier[] | null> {
  if (typeof clientId !== 'string' || clientId === '') return null;
  const client = await db.client.findFirst({
    where: { id: clientId, companyId },
    select: {
      partyIdentifiers: {
        select: {
          scheme: true,
          value: true,
          validationStatus: true,
          validatedAt: true,
          validationSource: true,
        },
      },
    },
  });
  return client ? snapshotBuyerIdentifiers(client.partyIdentifiers) : null;
}

/**
 * What to write into `buyerIdentifiers` for a document being numbered with `data`. A credit note that
 * corrects an invoice takes its buyer from that invoice (`formats/credit-note-source.ts`), so it copies
 * the invoice's own snapshot rather than the client's current record. Returns `Prisma.DbNull` when there
 * is no buyer to freeze.
 */
export async function freezeBuyerIdentifiers(
  db: Db,
  companyId: string,
  data: unknown,
): Promise<Prisma.InputJsonValue | typeof Prisma.DbNull> {
  const fields = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  if (typeof fields.invoice === 'string' && fields.invoice !== '') {
    const invoice = await db.documentInstance.findFirst({
      where: { id: fields.invoice, companyId },
      select: { data: true, buyerIdentifiers: true },
    });
    if (invoice) {
      const frozen =
        parseFrozenBuyerIdentifiers(invoice.buyerIdentifiers) ??
        (await clientSnapshot(db, companyId, (invoice.data as Record<string, unknown> | null)?.client));
      return frozen ? (frozen as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    }
  }

  const frozen = await clientSnapshot(db, companyId, fields.client);
  return frozen ? (frozen as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
}
