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

/** `POST /api/company/branding/logo` — same wire convention every other binary upload in this backend
 *  already uses (no multipart/`FileInterceptor` anywhere — see `received-invoices/storage.ts`'s own
 *  header): base64 bytes inside the JSON body. */
export interface UploadBrandingLogoDto {
  mime: string;
  base64: string;
}
