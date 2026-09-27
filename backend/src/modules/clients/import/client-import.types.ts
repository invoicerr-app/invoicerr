/**
 * Wire shapes for `POST /clients/import/preview` and `POST /clients/import/confirm` - see
 * `client-import.service.ts`'s own header for the full design (why parsing happens in the browser,
 * why identifiers are flattened as `identifier:<SCHEME>` columns, why custom fields are out of
 * scope). Plain interfaces, matching `clients.dto.ts`'s own convention (`EditClientsDto` is a
 * TypeScript interface too, not class-validator - this API has no global `ValidationPipe`, see
 * `editClientsInfo`'s own comment on why every write path allow-lists its fields by hand instead).
 */
import { ClientKind, ClientType } from '../../../../prisma/generated/prisma/client';
import { IdentifierEntry } from '../dto/clients.dto';

/**
 * One row as the browser parsed and validated it - everything a `Client` create can carry EXCEPT
 * `customFields` (explicitly out of scope for v1 import, see this module's own header) and the
 * server-owned `id`/`companyId`/`isActive`/timestamps. `rowNumber` is 1-based INCLUDING the header
 * row (a human counting lines in the file, "row 2" is the first data row) - carried through preview
 * and confirm so a rejection/duplicate can be reported against the exact line the user would open in
 * their spreadsheet.
 */
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
  /** ISO `YYYY-MM-DD`, matching the template - the browser already turned this into a `Date` for its
   *  own `foundedAt` field, but the wire shape stays a plain string, parsed server-side too, the same
   *  discipline `list-documents.dto.ts`'s date params already use for "the server is an authority,
   *  never trusts a client-parsed value blindly". */
  foundedAt?: string;
  identifiers?: IdentifierEntry[];
}

export type ClientImportRowStatus = 'valid' | 'duplicate' | 'rejected';

/** Which of `ClientsService.findDuplicates`'s two independent rules actually tripped - the SAME
 *  distinction that rule's own `DuplicateMatchReason` already carries for the create wizard's own
 *  duplicate hint, kept here under the same name for the same reason. */
export type ClientImportDuplicateReason = 'email' | 'name_country';

export interface ClientImportDuplicateMatch {
  /** `'existing'` for a row matching an ALREADY-SAVED client, `'file'` for a row matching an EARLIER
   *  row in the same import - the preview's own Detail column reads differently for each (see
   *  `client-import-dialog.tsx`), since "this row is the same as row 4" and "this row already exists
   *  in your client list" are different facts a human needs told apart. */
  kind: 'existing' | 'file';
  matchedOn: ClientImportDuplicateReason;
  /** The EXISTING client's id - present only for `kind: 'existing'` (a within-file match has no id
   *  yet, nothing was created). */
  id?: string;
  /** The EARLIER row's own 1-based file row number - present only for `kind: 'file'`. */
  rowNumber?: number;
  name: string;
  contactEmail: string | null;
}

export interface ClientImportRowResult {
  rowNumber: number;
  status: ClientImportRowStatus;
  /** Present for `rejected` rows - one message per failed check, in the SAME wording
   *  `assertClientCreatable`/the country-identifiers catalog would throw, so a row rejected here
   *  reads exactly like the create-wizard's own error would have. */
  errors?: string[];
  /** Present for `duplicate` rows - the EXISTING client this row matches, or, for a row that
   *  duplicates an EARLIER row in the same file, that earlier row's own (synthetic, unsaved) identity
   *  - see `client-import.service.ts`'s own header on within-file duplicates. */
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

/**
 * Hard ceiling on a single import - 1,000 rows. Chosen for three reasons stated together because
 * they all point at the same number: (1) `confirm` commits every valid row inside ONE
 * `prisma.$transaction` (see the service's own header on why) and a Postgres transaction holding
 * locks on an unbounded number of new rows is not something this endpoint should invite; (2) the
 * preview response renders as one table a human is expected to actually scan before confirming -
 * past a few hundred rows that stops being true regardless of the cap; (3) the existing global JSON
 * body limit (`create-app.ts`, `bodyParser.json({ limit: '1mb' })`) already bounds the wire payload
 * to roughly this many typical client rows, so this cap mostly makes explicit, with a named 400
 * instead of a generic 413, a ceiling the transport already implied.
 */
export const MAX_IMPORT_ROWS = 1000;
