/**
 * `sendInertFile`: the one place a stored file the app did not produce itself (an attachment, an
 * imported original, a manual-acceptance proof) is written to an HTTP response. Every such route sends
 * the same three headers, and a copy that forgot `nosniff` would quietly reopen the stored-content
 * risk described on `documents.controller.ts#downloadAttachment`.
 */
import { buildOriginalContentDisposition, InlinePdfResponse, safeOriginalMime } from './content-disposition';

/**
 * Writes `bytes` as a download that a browser never renders or sniffs:
 *  - `Content-Type` is `safeOriginalMime(mime)`: a mime outside the allow-list becomes the inert
 *    `application/octet-stream`. Idempotent, so a caller whose service already narrowed `mime` gets
 *    the same value back;
 *  - `Content-Disposition` is `attachment`, named through `buildOriginalContentDisposition` when a
 *    `filename` is given, bare otherwise;
 *  - `X-Content-Type-Options: nosniff`, so the browser never second-guesses either header.
 */
export function sendInertFile(
  res: InlinePdfResponse,
  { mime, filename, bytes }: { mime: string; filename?: string; bytes: Buffer },
): void {
  const disposition = filename === undefined ? 'attachment' : buildOriginalContentDisposition(filename);
  res.setHeader('Content-Type', safeOriginalMime(mime));
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(bytes);
}
