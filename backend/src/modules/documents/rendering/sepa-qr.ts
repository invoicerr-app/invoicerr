import * as QRCode from 'qrcode';

/**
 * TODO_FEATURES.md rank 8 ("QR SEPA / GiroCode") — builds and renders the EPC069-12 payload that lets
 * a payer scan the invoice PDF and have their banking app pre-fill a SEPA credit transfer, instead of
 * re-typing the IBAN and amount by hand.
 *
 * Split into a PURE payload builder (`buildEpcPayload`, below) and a SEPARATE async renderer
 * (`renderSepaQrDataUri`) for the exact same reason `mentions/invoice-notes.ts` is split from its own
 * caller: `rendering/render-html.ts#renderDocumentHtml` must stay a pure, synchronous function (every
 * existing caller/fixture relies on that), but drawing the actual QR bitmap is unavoidably
 * asynchronous (the `qrcode` package's own API). `render-instance-pdf.ts` — the one ASYNC layer in
 * this pipeline — is what calls both, in order, before ever reaching `renderDocumentHtml`.
 */

/** EPC069-12 v002's OWN field-length ceilings — see `buildEpcPayload`'s header for the standard this
 *  implements. Truncation, never rejection: a beneficiary name or a remittance text that runs long is
 *  not a reason to print no QR at all. */
const MAX_BENEFICIARY_NAME_LENGTH = 70;
const MAX_UNSTRUCTURED_REMITTANCE_LENGTH = 140;

/** EPC069-12 v002's own amount bounds (§ "Amount of the Credit Transfer") — outside this range the
 *  field itself is malformed, so `buildEpcPayload` refuses rather than emit a QR no bank would honor. */
const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 999999999.99;

/** EPC069-12's own hard ceiling on the WHOLE payload (§ "Character set / Version 2") — chosen so the
 *  resulting QR stays scannable at typical print/phone-camera distance. A payload that would exceed it
 *  (an implausibly long beneficiary name AND remittance both maxed out at once, say) is refused rather
 *  than silently clipped mid-field, which could hand a bank a truncated IBAN or amount. */
const MAX_PAYLOAD_BYTES = 331;

export interface BuildEpcPayloadInput {
  /** The SELLER's own name — the beneficiary of the credit transfer this QR requests. */
  beneficiaryName: string;
  /** The seller's IBAN (`Company.iban`) — absent/blank means no QR, checked here rather than left to
   *  the caller, so every gate this feature needs lives in ONE place. */
  iban: string | null | undefined;
  /** The amount to collect, in MINOR units (cents) — `DocumentTotals.grossMinor`, never a re-derived
   *  figure: the QR must always ask for exactly what the rendered totals block already shows. */
  amountMinor: number;
  /** ISO 4217 currency of `amountMinor`. SEPA Credit Transfer only ever moves EUR — a non-EUR document
   *  gets no QR, never one silently mislabelled `EUR`. */
  currency: string;
  /** Unstructured remittance information (EPC069-12 field 11) — this codebase has no STRUCTURED
   *  creditor reference (ISO 11649) to offer instead, so the invoice's own display number is the best
   *  available reconciliation hint for the payer's bank statement. */
  remittance?: string | null;
}

/**
 * Builds the EPC069-12 (SEPA credit transfer / "GiroCode") QR payload, version 002, PURE and
 * synchronous. Returns `null` whenever a QR must not be rendered at all — see each check below — so
 * the caller's job is simply "got a string? render it. got null? render nothing", never a second
 * round of validation.
 *
 * ## EPC069-12 v002 field order (LF-joined, this function emits fields 1–11 only)
 * 1. Service Tag: `BCD`
 * 2. Version: `002`
 * 3. Character set: `1` (UTF-8)
 * 4. Identification: `SCT` (SEPA Credit Transfer)
 * 5. BIC: deliberately EMPTY — `Company` has no BIC column, and version 002 (unlike 001) explicitly
 *    allows an empty BIC for a beneficiary bank in the EEA. That relaxation is the ONLY reason this
 *    function targets 002 rather than 001: 001 would hard-require a BIC this codebase does not collect.
 * 6. Beneficiary name: the company name, truncated to 70 chars (field 6's own ceiling).
 * 7. Beneficiary IBAN: spaces stripped — a human-entered or displayed IBAN often carries them, but the
 *    field itself must not.
 * 8. Amount: `EUR` immediately followed by the amount with a dot decimal separator and EXACTLY two
 *    decimals (e.g. `EUR100.00`) — never the document's own `decimalsFor(currency)` (utils/financial),
 *    because EPC069-12 fixes this field's format itself, independent of currency subdivision rules;
 *    it happens to coincide with EUR's own 2 decimals, which is one more reason this feature is
 *    EUR-only rather than generalized.
 * 9. Purpose code: empty (no ISO 20022 purpose code this product assigns).
 * 10. Structured remittance: empty (no ISO 11649 creditor reference on file — see `remittance` above).
 * 11. Unstructured remittance: the invoice's display number, truncated to 140 chars, or empty.
 *
 * Field 12 (beneficiary-to-originator information) is deliberately OMITTED, not emitted empty: a
 * trailing empty optional field may simply be left off the end of the payload (EPC069-12 §"Data
 * elements", note on optional fields), which keeps the payload a few bytes shorter for no loss of
 * meaning.
 */
export function buildEpcPayload(input: BuildEpcPayloadInput): string | null {
  // SEPA Credit Transfer only ever moves EUR — a document in any other currency has nothing this QR
  // could correctly request.
  if (input.currency !== 'EUR') return null;

  const iban = (input.iban ?? '').replace(/\s+/g, '');
  if (!iban) return null;

  if (!Number.isFinite(input.amountMinor)) return null;
  const amount = input.amountMinor / 100;
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) return null;

  const beneficiaryName = input.beneficiaryName.slice(0, MAX_BENEFICIARY_NAME_LENGTH);
  const unstructuredRemittance = (input.remittance ?? '').slice(0, MAX_UNSTRUCTURED_REMITTANCE_LENGTH);

  const fields = [
    'BCD',
    '002',
    '1',
    'SCT',
    '', // BIC — see header, field 5
    beneficiaryName,
    iban,
    `EUR${amount.toFixed(2)}`,
    '', // Purpose code — field 9
    '', // Structured remittance — field 10
    unstructuredRemittance,
  ];

  const payload = fields.join('\n');

  // Belt-and-braces against the standard's own hard ceiling — see MAX_PAYLOAD_BYTES's header. Never
  // reached by the truncations above alone (70 + IBAN + amount + 140 + separators stays well under
  // 331 in the worst case), but checked explicitly rather than assumed, so a future change to any of
  // the fields above cannot silently start emitting an over-length payload.
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) return null;

  return payload;
}

/**
 * Renders an EPC payload (from `buildEpcPayload`) to a `data:image/png;base64,...` URI, ready to drop
 * straight into an `<img src="...">` — see `render-html.ts`'s own `paymentQr` input. `errorCorrectionLevel:
 * 'M'` is EPC069-12's OWN recommendation (§ "Encoding an EPC QR Code"): high enough to survive a
 * printed invoice being folded, scuffed, or lightly obscured, without inflating the symbol's module
 * count (and therefore its minimum legible print size) the way 'Q'/'H' would for no real benefit here.
 */
export async function renderSepaQrDataUri(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1 });
}
