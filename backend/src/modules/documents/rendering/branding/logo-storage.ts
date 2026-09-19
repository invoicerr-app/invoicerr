/**
 * The company logo's own storage — reuses the exact same content-addressed mechanism
 * `received-invoices/storage.ts` already provides (see that module's own header), scoped by
 * `companyId` the identical way `attachments/attachments.service.ts` already reuses it for a
 * receipt/PDF attachment (same mechanism, same size ceiling — see `MAX_ATTACHMENT_BYTES`'s own
 * header for why 750 KiB is the real ceiling this whole app's body parser already enforces).
 *
 * `Company.brandingLogoId` stores ONLY the SHA-256 (`AttachmentRef.fileRef`) — never the mime —
 * because the content-addressed path also needs the mime to derive its own file extension
 * (`extFor`), and a SECOND nullable column just to carry it would let the two drift out of sync (one
 * cleared, the other not) for a value this module can instead recover cheaply: a company logo is
 * restricted to the three image mimes below (`ALLOWED_LOGO_MIMES`), so reading it back is simply "try
 * each of the three known extensions for this hash until one exists" — at most three stat+read
 * attempts, and by construction of `uploadLogo` below there is only ever ONE file on disk for a given
 * (companyId, sha256) pair regardless of which mime it was uploaded as.
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

import { computeArtifactHash } from '@/modules/documents/archive/hashing';
import { MAX_ATTACHMENT_BYTES } from '@/modules/documents/attachments/attachments.service';
import { persistInboundFile, readInboundFile } from '@/modules/documents/received-invoices/storage';

/** Narrower than `attachments/attachments.service.ts#ALLOWED_ATTACHMENT_MIMES` — a logo is an image,
 *  never a PDF (that broader list exists for a RECEIPT, a different feature entirely; reusing it here
 *  verbatim would let a caller "upload" a PDF as a company logo, which `render-html.ts`'s `<img>` tag
 *  could never do anything sensible with). */
export const ALLOWED_LOGO_MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export interface UploadLogoInput {
  mime: string;
  base64: string;
}

/** Stores a logo, content-addressed under this company. Returns the SHA-256 to store in
 *  `Company.brandingLogoId` — refuses (named, exactly like `AttachmentsService#upload`) an empty
 *  file, a disallowed mime, or a file over `MAX_ATTACHMENT_BYTES`. `async` because
 *  `persistInboundFile` (`received-invoices/storage.ts`) is — `INBOUND_STORAGE=s3` genuinely awaits a
 *  network call; every validation throw above stays a REJECTED promise for this same reason (never a
 *  synchronous throw), so callers must `await`/`.catch()` this exactly like any other async method. */
export async function uploadLogo(companyId: string, input: UploadLogoInput): Promise<string> {
  if (!ALLOWED_LOGO_MIMES.includes(input.mime)) {
    throw new BadRequestException(
      `Unsupported logo file type "${input.mime}" — allowed: ${ALLOWED_LOGO_MIMES.join(', ')}.`,
    );
  }

  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length === 0) {
    throw new BadRequestException('The uploaded logo is empty.');
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new PayloadTooLargeException(
      `The uploaded logo is ${bytes.length} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit.`,
    );
  }

  const fileRef = computeArtifactHash(bytes);
  await persistInboundFile(companyId, fileRef, input.mime, bytes);
  return fileRef;
}

/** Reads a stored logo back — `null` when `logoId` is absent, or the file cannot be found under ANY
 *  of the three allowed mimes for this company (never uploaded, or a stale id left over from another
 *  company — tenant isolation is the SAME company-scoped path `persistInboundFile` already enforces,
 *  never a cross-tenant lookup by hash alone). */
export async function readLogo(
  companyId: string | null | undefined,
  logoId: string | null | undefined,
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!companyId || !logoId) return null;
  for (const mime of ALLOWED_LOGO_MIMES) {
    const bytes = await readInboundFile(companyId, logoId, mime);
    if (bytes) return { bytes, mime };
  }
  return null;
}

/** The `data:image/...;base64,...` URI `render-html.ts`'s `branding.logoDataUri` needs — `null` when
 *  there is nothing to embed (see `readLogo` above), never a broken/empty `src`. Reused by BOTH the
 *  real render pipeline (`render-instance-pdf.ts`) and the settings-screen preview
 *  (`company/branding/branding.service.ts#preview`), so the preview can never show a logo the actual
 *  PDF wouldn't. */
export async function logoDataUriFor(
  companyId: string | null | undefined,
  logoId: string | null | undefined,
): Promise<string | null> {
  const logo = await readLogo(companyId, logoId);
  if (!logo) return null;
  return `data:${logo.mime};base64,${logo.bytes.toString('base64')}`;
}
