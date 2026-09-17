import { useCallback, useEffect, useRef, useState } from "react"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { FileText, Paperclip, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { ApiError } from "@/hooks/use-api-query"
import { downloadAttachment, useUploadAttachment } from "@/hooks/queries"

import type { FieldRendererProps } from "./registry"

interface AttachmentValue {
  fileRef: string
  fileName: string
  mime: string
}

function isAttachmentValue(value: unknown): value is AttachmentValue {
  const v = value as Partial<AttachmentValue> | null | undefined
  return !!v && typeof v.fileRef === "string" && typeof v.fileName === "string" && typeof v.mime === "string"
}

/** Same technique every OTHER binary upload in this frontend already uses (settings/_components/
 *  signing-certificates.settings.tsx's own PFX upload, custom/received-invoice-upload-button.tsx's
 *  own file) — reused verbatim rather than shared, the same duplication those two already follow
 *  (no multipart/`FileInterceptor` anywhere in this backend — see either file's own header). */
async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(arrayBuffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * `previewUrl` (below) is always the return value of `URL.createObjectURL()` — never text a user
 * typed — so it can never carry a `javascript:` payload; the browser itself generates the whole
 * string. This is still checked explicitly, rather than trusted implicitly, before it is ever handed
 * to `src`/`href`: an object URL's own MIME type comes from whichever `Blob`/`File` it was created
 * from (a locally picked file's own browser-reported `.type`, or this company's stored attachment
 * mime), so asserting the SCHEME here is a cheap, permanent guarantee that this component only ever
 * navigates to something the browser itself vouches for — not to a string that merely happens to have
 * reached this variable the same way a real preview URL would.
 *
 * Returns the value REBUILT from a parsed `URL` (`.href`), never `url` itself: a prefix check that
 * then hands the original string on unchanged leaves that string exactly as untrusted at the `src`/
 * `href` it feeds as it was before the check ran — nothing about the string itself is any different.
 * Parsing it into a `URL` and reading `.href` back produces a value derived from the browser's own
 * URL parser rather than from whatever bytes happened to be sitting in the variable, which is what
 * makes this a real guarantee about the string that is actually rendered, not just about the one that
 * was tested. `URL` throws on anything that fails to parse at all (an empty string, most non-URL
 * text) — caught below and treated the same as "wrong scheme": nothing to preview.
 */
export function toPreviewableObjectUrl(url: string | null): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return parsed.protocol === "blob:" ? parsed.href : null
}

/**
 * 'file' — the 12th core field kind, for enriched expense notes ("notes de frais enrichies"): an
 * attachment scoped to this company, stored content-addressed by the backend's `attachments/` module
 * (reusing `received-invoices/storage.ts`'s own mechanism — see that module's header) and referenced
 * from the field's own value as `{ fileRef, fileName, mime }`, never the bytes themselves — the same
 * "a stored pointer, not a copy of the data" shape 'reference' already holds for an entity id.
 *
 * A freshly picked file previews INSTANTLY from the local browser `File` object — no round trip
 * needed to show what this same tab just read off disk. Reopening an existing record with an
 * already-stored value fetches the bytes back ONCE, through the generic, company-scoped
 * `GET /api/documents/attachments/:fileRef` (never a document-id-scoped route: a 'file' field is not
 * specific to any one document TYPE, the exact genericity `reference-field.tsx` already holds for
 * `/documents/references/:entity/...`).
 */
export function FileField({ field, name }: FieldRendererProps) {
  const { t } = useTranslation()
  const { control, setValue, watch } = useFormContext()
  const value = watch(name) as unknown
  const upload = useUploadAttachment()
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)

  // Stable identity (empty deps — only ever touches the ref) so it can sit in an effect's own
  // dependency array below without that effect re-running on every render.
  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const attachment = isAttachmentValue(value) ? value : undefined
  // Primitives, not the `attachment` object itself — that object is a fresh reference every render
  // (derived inline from `value` above), so depending on it directly would re-run the download effect
  // below on every render; these two strings are what it actually reads and stay referentially stable
  // across renders in which the stored attachment itself hasn't changed.
  const attachmentFileRef = attachment?.fileRef
  const attachmentMime = attachment?.mime

  // A freshly picked file previews from the browser's OWN object — no fetch for what this tab just
  // read off disk itself.
  useEffect(() => {
    if (!localFile) return
    revokeObjectUrl()
    const url = URL.createObjectURL(localFile)
    objectUrlRef.current = url
    setPreviewUrl(url)
    return revokeObjectUrl
  }, [localFile, revokeObjectUrl])

  // Reopening an existing record: the value is already `{ fileRef, fileName, mime }` but this tab
  // never held the bytes — one fetch through the generic download route, revoked on cleanup/change.
  useEffect(() => {
    if (localFile || !attachmentFileRef || !attachmentMime) return
    let cancelled = false
    setLoadingPreview(true)
    downloadAttachment(attachmentFileRef, attachmentMime)
      .then((blob) => {
        if (cancelled) return
        revokeObjectUrl()
        const url = URL.createObjectURL(blob)
        objectUrlRef.current = url
        setPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })
    return () => {
      cancelled = true
    }
  }, [attachmentFileRef, attachmentMime, localFile, revokeObjectUrl])

  // Unmount only — the per-value effects above already revoke on every CHANGE; `revokeObjectUrl`'s
  // own stable identity (see above) is what keeps this from re-running on every render despite being
  // a declared dependency.
  useEffect(() => revokeObjectUrl, [revokeObjectUrl])

  const handleFile = async (file: File) => {
    try {
      const base64 = await fileToBase64(file)
      const result = await upload.mutateAsync({
        fileName: file.name,
        mime: file.type || "application/octet-stream",
        base64,
      })
      setLocalFile(file)
      setValue(name, result, { shouldValidate: true, shouldDirty: true })
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("documents.form.file.uploadError"))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleRemove = () => {
    setLocalFile(null)
    revokeObjectUrl()
    setPreviewUrl(null)
    setValue(name, undefined, { shouldValidate: true, shouldDirty: true })
  }

  const mime = localFile?.type || attachment?.mime || ""
  const isImage = mime.startsWith("image/")
  const fileName = localFile?.name ?? attachment?.fileName
  const hasValue = !!localFile || !!attachment
  // Rebuilt once per render, from `previewUrl`, never `previewUrl` itself — see this function's own
  // header for why the two usages below read `safePreviewUrl`, not the state variable directly.
  const safePreviewUrl = toPreviewableObjectUrl(previewUrl)

  return (
    <FormField
      control={control}
      name={name}
      render={() => (
        <FormItem data-cy={`document-field-${field.key}`}>
          <FormLabel required={field.required}>{field.label}</FormLabel>
          <FormControl>
            <div className="flex flex-col gap-2">
              {hasValue ? (
                <div
                  className="flex items-center gap-3 rounded-md border p-2"
                  data-cy={`document-field-${field.key}-value`}
                >
                  {loadingPreview ? (
                    <span className="text-sm text-muted-foreground">
                      {t("documents.form.file.loadingPreview")}
                    </span>
                  ) : isImage && safePreviewUrl ? (
                    <img
                      src={safePreviewUrl}
                      alt={t("documents.form.file.previewAlt")}
                      className="h-16 w-16 rounded object-cover"
                      data-cy={`document-field-${field.key}-preview-image`}
                    />
                  ) : (
                    <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="truncate text-sm">{fileName}</span>
                    {!isImage && safePreviewUrl && (
                      <a
                        href={safePreviewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary underline"
                        data-cy={`document-field-${field.key}-open-link`}
                      >
                        {t("documents.form.file.openFile")}
                      </a>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleRemove}
                    tooltip={t("documents.form.file.remove")}
                    aria-label={t("documents.form.file.remove")}
                    dataCy={`document-field-${field.key}-remove`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  loading={upload.isPending}
                  onClick={() => fileInputRef.current?.click()}
                  dataCy={`document-field-${field.key}-input`}
                >
                  <Paperclip className="h-4 w-4 mr-2" />
                  {t("documents.form.file.browse")}
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                data-cy={`document-field-${field.key}-file-input`}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
            </div>
          </FormControl>
          {field.helpText && <FormDescription>{field.helpText}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
