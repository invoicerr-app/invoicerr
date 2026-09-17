import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { authenticatedFetch } from "@/hooks/use-fetch"

/**
 * Document branding (2026-09-15 product decision): a logo, one
 * accent color, one font from a closed catalog, and named presets combining the last two. Mirrors
 * `backend/src/modules/company/branding/branding.service.ts` (wire shapes, deliberately duplicated
 * rather than shared — see `use-company-custom-fields.ts`'s own header for why). The PDF itself stays
 * a FIXED document — nothing here is user-editable HTML/content, only these three presentation values.
 */
export interface BrandingPreset {
  id: string
  /** Plain data, not an i18n key — same convention `descriptors/types.ts`'s own `label` already
   *  documents for a document type/field label: the backend catalog is the single source of truth. */
  label: string
  accentColor: string
  font: string
}

export interface BrandingFontOption {
  key: string
  label: string
}

export interface BrandingStatus {
  accentColor: string | null
  font: string | null
  preset: string | null
  hasLogo: boolean
  presets: BrandingPreset[]
  fonts: BrandingFontOption[]
}

export interface SetBrandingInput {
  preset?: string | null
  accentColor?: string | null
  font?: string | null
}

const STATUS_KEY = ["company", "branding"] as const
const PREVIEW_KEY = ["company", "branding", "preview"] as const

/** Current status PLUS the full preset/font catalogs — the settings screen never hardcodes a second
 *  copy of either list. */
export function useCompanyBranding() {
  return useApiQuery<BrandingStatus>(STATUS_KEY, "/api/company/branding")
}

/** `PUT /api/company/branding` — see the backend service's own header for how `preset` interacts
 *  with an explicit `accentColor`/`font` in the SAME call. Invalidates the preview too: a saved
 *  color/font change must be reflected the next time the preview is shown. */
export function useSetCompanyBranding() {
  return useApiMutation<SetBrandingInput, BrandingStatus>("PUT", "/api/company/branding", {
    invalidateKeys: [STATUS_KEY, PREVIEW_KEY],
  })
}

/** `POST /api/company/branding/logo` (multipart/form-data, a single `file` part — build the body with
 *  `use-attachments.ts#buildFileUploadForm`) — same validation as documents/attachments (mime
 *  allow-list, 10 MB ceiling), refused as a NAMED `ApiError` otherwise. */
export function useUploadBrandingLogo() {
  return useApiMutation<FormData, BrandingStatus>("POST", "/api/company/branding/logo", {
    invalidateKeys: [STATUS_KEY, PREVIEW_KEY],
  })
}

/** `DELETE /api/company/branding/logo`. */
export function useClearBrandingLogo() {
  return useApiMutation<void, BrandingStatus>("DELETE", "/api/company/branding/logo", {
    invalidateKeys: [STATUS_KEY, PREVIEW_KEY],
  })
}

/** `GET /api/company/branding/logo` — raw bytes back as a `Blob`, imperative fetch (an object-URL has
 *  a lifecycle the CALLER owns — create, revoke on cleanup) — the same reasoning
 *  `use-attachments.ts#downloadAttachment` already documents for its own file download; not a
 *  `useApiQuery` for the identical reason that one isn't either. */
export async function downloadBrandingLogo(): Promise<Blob> {
  const response = await authenticatedFetch("/api/company/branding/logo")
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || `HTTP ${response.status}`)
  }
  return response.blob()
}

/**
 * `GET /api/company/branding/preview` — a fixed sample document rendered through the real PDF HTML
 * pipeline, with the CURRENTLY STORED (not merely locally-edited) branding applied. Returns `{ html }`
 * — the CALLER sanitizes it (DOMPurify) before ever setting it as `srcdoc`, never rendered raw.
 */
export function useBrandingPreview() {
  return useApiQuery<{ html: string }>(PREVIEW_KEY, "/api/company/branding/preview")
}
