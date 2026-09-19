/** `PUT /api/company/branding` — see `branding.service.ts#setBranding`'s own header for how `preset`
 *  interacts with an explicit `accentColor`/`font` in the SAME call. Every field optional and
 *  independently nullable: `null` clears it back to "no branding for this one field" (the exact
 *  pre-branding default — see `render-html.ts`'s own `DEFAULT_ACCENT_COLOR`/`DEFAULT_BODY_FONT_STACK`),
 *  `undefined` (a key simply absent from the body) leaves the existing stored value untouched. */
export interface SetBrandingDto {
  preset?: string | null;
  accentColor?: string | null;
  font?: string | null;
}

/** `POST /api/company/branding/logo` — multipart/form-data, a single `file` part, the same wire
 *  convention `attachments/attachments.service.ts` and `received-invoices/` already use. `bytes` is
 *  the buffer multer's `memoryStorage()` handed `branding.controller.ts#uploadLogo`, re-encoded to
 *  base64 only at the `logo-storage.ts` boundary (that module's own interface is untouched — see its
 *  header for why it is keyed on content hash + mime, not a caller's wire format). */
export interface UploadBrandingLogoDto {
  mime: string;
  bytes: Buffer;
}
