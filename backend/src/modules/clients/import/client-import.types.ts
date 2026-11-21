/**
 * Wire shapes for the client CSV import preview and confirm. Parsing happens in the browser; the
 * server re-validates every row and is the authority on what is stored.
 */
import { ClientKind, ClientType } from '../../../../prisma/generated/prisma/client';
import { IdentifierEntry } from '../dto/clients.dto';

/** One parsed row. `rowNumber` is 1-based including the header, so errors name the line a user sees. */
export interface ClientImportRow {
  rowNumber: number;
  type?: ClientType;
  kind?: ClientKind;
  isSupplier?: boolean;
  name?: string;
  contactFirstname?: string;
  contactLastname?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  currency?: string;
  language?: string | null;
  description?: string;
  /** ISO `YYYY-MM-DD`; parsed server-side, never trusted as a client-parsed date. */
  foundedAt?: string;
  identifiers?: IdentifierEntry[];
}

export type ClientImportRowStatus = 'valid' | 'duplicate' | 'rejected';

/** The same two rules as `ClientsService.findDuplicates`. */
export type ClientImportDuplicateReason = 'email' | 'name_country';

export interface ClientImportDuplicateMatch {
  /** `existing` matches a saved client; `file` matches an earlier row in the same import. */
  kind: 'existing' | 'file';
  matchedOn: ClientImportDuplicateReason;
  /** Present only for `existing`. */
  id?: string;
  /** Present only for `file`: the earlier row's 1-based number. */
  rowNumber?: number;
  name: string;
  contactEmail: string | null;
}

export interface ClientImportRowResult {
  rowNumber: number;
  status: ClientImportRowStatus;
  /** Rejected rows: one message per failed check, in the create-wizard's own wording. */
  errors?: string[];
  /** Duplicate rows: the existing client or the earlier row this one matches. */
  duplicateOf?: ClientImportDuplicateMatch;
}

export interface ClientImportPreviewSummary {
  total: number;
  willCreate: number;
  duplicates: number;
  rejected: number;
}

export interface ClientImportPreviewResult {
  rows: ClientImportRowResult[];
  summary: ClientImportPreviewSummary;
}

export interface ClientImportConfirmResult {
  created: number;
  duplicates: number;
  rejected: number;
}

/** A single import is capped at 1,000 rows: one transaction, and a preview a human can scan. */
export const MAX_IMPORT_ROWS = 1000;
