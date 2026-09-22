import type { Attachment } from 'nodemailer';

import { MailAttachment } from '@/mail/types';

/**
 * Adapts our attachment contract to what a MIME node can actually carry: nodemailer
 * accepts `string | Buffer | Readable`, so a caller's bare `Uint8Array` has to be
 * promoted to a Buffer. Buffers — what the PDF renderers already hand us — are passed
 * through as-is rather than copied.
 *
 * `undefined` in, `undefined` out: a message with no attachments must not grow an empty
 * attachments array, which would otherwise turn a simple message into a multipart one.
 */
export function toTransportAttachments(attachments?: MailAttachment[]): Attachment[] | undefined {
  return attachments?.map((a) => ({
    filename: a.filename,
    content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
    contentType: a.contentType,
  }));
}
