/**
 * One document type's email template, as a settings screen submits it. `body` is the PLAIN-TEXT part,
 * `html` the optional rich one — at least one of the two must carry something (see
 * `DocumentsService.updateEmailTemplate` for what is refused versus merely warned about), and the html
 * is sanitized server-side before it is stored (`mail/sanitize-email-html.ts`).
 */
export interface UpdateDocumentEmailTemplateDto {
  subject: string;
  body?: string;
  html?: string;
}

export interface RunActionDto {
  /** Absent to create a new document instance; present to act on an existing one. */
  documentId?: string;
  data: Record<string, unknown>;
  /** The action's OWN parameters (see DocumentActionDescriptor.params) — a separate namespace from
   *  `data`. Absent/empty is fine for an action that declares no params. */
  params?: Record<string, unknown>;
}
