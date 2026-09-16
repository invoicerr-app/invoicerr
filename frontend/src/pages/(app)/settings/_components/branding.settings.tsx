"use client"

import DOMPurify from "dompurify"
import { ImageIcon, Upload, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiError } from "@/hooks/use-api-query"
import {
  downloadBrandingLogo,
  useBrandingPreview,
  useClearBrandingLogo,
  useCompanyBranding,
  useSetCompanyBranding,
  useUploadBrandingLogo,
} from "@/hooks/queries"
import { cn } from "@/lib/utils"
import { SettingsFormFooter, SettingsPage, SettingsSection, useSavedFlash } from "./settings-section"

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const ALLOWED_LOGO_MIMES = ["image/jpeg", "image/png", "image/webp"]
/** Same real ceiling `documents/attachments`'s own upload already enforces — checked client-side too
 *  so a caller sees a NAMED reason before spending an upload round-trip on a file the server would
 *  refuse anyway. */
const MAX_LOGO_BYTES = 750 * 1024

/** Same technique every OTHER binary upload in this frontend already uses (settings/_components/
 *  signing-certificates.settings.tsx's own PFX upload, field-renderers/file-field.tsx's own file) —
 *  reused verbatim rather than shared (no multipart/`FileInterceptor` anywhere in this backend). */
async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(arrayBuffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Company settings → Branding (`/settings/branding`, 2026-09-15 product decision). The PDF itself
 * stays a FIXED document — nothing here edits its
 * content or layout; only THREE brand fields do: logo, one accent color, one font from a closed
 * catalog — plus named presets that set the last two at once. `GET /api/company/branding` is the
 * single source of truth for BOTH catalogs (`status.presets`/`status.fonts`), never duplicated here.
 *
 * The live preview (`GET /api/company/branding/preview`) renders a FIXED sample document through the
 * exact same HTML pipeline a real PDF uses — it reflects the CURRENTLY SAVED branding (react-query
 * invalidates it on every successful save/logo change), never an unsaved local edit; the color/font
 * inputs above it are a local draft until "Save" is pressed. Its HTML is sanitized (DOMPurify,
 * `WHOLE_DOCUMENT: true` so the document's own `<style>`/`@font-face` blocks survive) before ever
 * reaching `srcDoc` — belt-and-braces on top of the `sandbox="allow-same-origin"` iframe (no
 * `allow-scripts`), which already makes embedded content unable to run script at all regardless of
 * what DOMPurify does or doesn't strip.
 */
export default function BrandingSettings() {
  const { t } = useTranslation()
  const { data: status, isLoading } = useCompanyBranding()
  const setBranding = useSetCompanyBranding()
  const uploadLogo = useUploadBrandingLogo()
  const clearLogo = useClearBrandingLogo()
  const { data: preview, isLoading: previewLoading } = useBrandingPreview()

  const [accentColor, setAccentColor] = useState("")
  const [font, setFont] = useState("")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoLoading, setLogoLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  // Guards the seeding effect below to fire EXACTLY once per mount — see that effect's own comment
  // for why a plain `[status]` dependency would be a real bug, not just a test-timing nuisance.
  const seededRef = useRef(false)

  // Seeds the local editable draft from the server the FIRST time status arrives, then never again
  // for the life of this mount — `status` is a fresh object reference on every react-query refetch
  // (a background refocus refetch, or this SAME screen's own `invalidateKeys` after a save/logo
  // change) even when its values are unchanged, so a plain `[status]` dependency would silently
  // overwrite whatever the user is mid-typing the instant any of those fires. A fresh page visit
  // still seeds correctly: `seededRef` is a NEW `useRef(false)` on every mount, same as
  // `mail.settings.tsx`'s own form only ever seeding from `defaultValues` once, at construction.
  useEffect(() => {
    if (!status || seededRef.current) return
    seededRef.current = true
    setAccentColor(status.accentColor ?? "")
    setFont(status.font ?? "")
  }, [status])

  // Stable identity (empty deps — only ever touches the ref), the same reason
  // field-renderers/file-field.tsx's own `revokeObjectUrl` is a `useCallback`: it sits in an effect's
  // own dependency array below without that effect re-running on every render.
  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  // Reopening/refreshing this screen: the status says a logo exists, but this tab never held the
  // bytes — one fetch through the dedicated logo route, revoked on cleanup/change. Mirrors
  // field-renderers/file-field.tsx's own "reopen an existing record" effect.
  useEffect(() => {
    if (!status?.hasLogo) {
      revokeObjectUrl()
      setLogoUrl(null)
      return
    }
    let cancelled = false
    setLogoLoading(true)
    downloadBrandingLogo()
      .then((blob) => {
        if (cancelled) return
        revokeObjectUrl()
        const url = URL.createObjectURL(blob)
        objectUrlRef.current = url
        setLogoUrl(url)
      })
      .catch(() => {
        if (!cancelled) setLogoUrl(null)
      })
      .finally(() => {
        if (!cancelled) setLogoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status?.hasLogo, revokeObjectUrl])

  // Unmount only — the effect above already revokes on every CHANGE; `revokeObjectUrl`'s own stable
  // identity (see above) is what keeps this from re-running on every render despite being a declared
  // dependency.
  useEffect(() => revokeObjectUrl, [revokeObjectUrl])

  const sanitizedPreviewHtml = useMemo(() => {
    if (!preview?.html) return null
    return DOMPurify.sanitize(preview.html, { WHOLE_DOCUMENT: true })
  }, [preview?.html])

  const colorError = accentColor.trim() !== "" && !HEX_COLOR_PATTERN.test(accentColor.trim())
  const [saved, flashSaved] = useSavedFlash()

  const reportSaveOutcome = (promise: Promise<unknown>) => {
    promise
      .then(() => {
        toast.success(t("settings.branding.messages.saveSuccess", "Branding updated"))
        flashSaved()
      })
      .catch((error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.branding.messages.saveError", "Failed to update branding"),
        )
      })
  }

  const handleSelectPreset = (presetId: string) => {
    const preset = status?.presets.find((p) => p.id === presetId)
    if (!preset) return
    setAccentColor(preset.accentColor)
    setFont(preset.font)
    reportSaveOutcome(setBranding.mutateAsync({ preset: presetId }))
  }

  const handleSave = () => {
    if (colorError) return
    reportSaveOutcome(
      setBranding.mutateAsync({
        accentColor: accentColor.trim() || null,
        font: font || null,
      }),
    )
  }

  const handleFile = async (file: File) => {
    if (!ALLOWED_LOGO_MIMES.includes(file.type)) {
      toast.error(t("settings.branding.messages.invalidFileType", "Please choose a PNG, JPEG or WebP image"))
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t("settings.branding.messages.fileTooLarge", "This file is over the 750 KiB limit"))
      return
    }
    try {
      const base64 = await fileToBase64(file)
      await uploadLogo.mutateAsync({ fileName: file.name, mime: file.type, base64 })
      toast.success(t("settings.branding.messages.logoUploadSuccess", "Logo uploaded"))
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : t("settings.branding.messages.logoUploadError", "Failed to upload logo"),
      )
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleRemoveLogo = () => {
    clearLogo.mutate(undefined, {
      onSuccess: () => toast.success(t("settings.branding.messages.logoRemoveSuccess", "Logo removed")),
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.branding.messages.logoRemoveError", "Failed to remove logo"),
        ),
    })
  }

  return (
    <SettingsPage
      title={t("settings.branding.title", "Branding")}
      description={t(
        "settings.branding.description",
        "Personalize your documents with a logo, an accent color, and a font — the layout itself never changes.",
      )}
      dataCy="branding-settings-section"
    >
      {isLoading || !status ? (
        <p className="text-sm text-muted-foreground">{t("settings.branding.loading", "Loading…")}</p>
      ) : (
        // The live preview sits NEXT TO the form on a wide screen (a color/font pick reads best
        // seen against the actual document, not scrolled to after saving) and simply stacks below
        // it once there is no room for two columns.
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="grid gap-6">
            <SettingsSection
              title={t("settings.branding.presets.title", "Presets")}
              dataCy="branding-presets-card"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {status.presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    data-cy={`branding-preset-${preset.id}`}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-muted",
                      status.preset === preset.id && "border-primary ring-1 ring-primary",
                    )}
                  >
                    <span
                      className="h-8 w-8 rounded-full border"
                      style={{ backgroundColor: preset.accentColor }}
                      aria-hidden="true"
                    />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </SettingsSection>

            <SettingsSection title={t("settings.branding.logo.label", "Logo")} dataCy="branding-logo-card">
              <div className="flex items-center gap-4">
                {status.hasLogo ? (
                  logoLoading ? (
                    <span className="text-sm text-muted-foreground">
                      {t("settings.branding.logo.loading", "Loading…")}
                    </span>
                  ) : logoUrl ? (
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-16 w-16 rounded border object-contain"
                      data-cy="branding-logo-preview"
                    />
                  ) : null
                ) : (
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded border border-dashed text-muted-foreground"
                    data-cy="branding-logo-empty"
                  >
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={uploadLogo.isPending}
                    onClick={() => fileInputRef.current?.click()}
                    data-cy="branding-logo-upload-button"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {status.hasLogo
                      ? t("settings.branding.logo.replace", "Replace logo")
                      : t("settings.branding.logo.upload", "Upload logo")}
                  </Button>
                  {status.hasLogo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      loading={clearLogo.isPending}
                      onClick={handleRemoveLogo}
                      data-cy="branding-logo-remove-button"
                    >
                      <X className="h-4 w-4 mr-2" />
                      {t("settings.branding.logo.remove", "Remove logo")}
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  data-cy="branding-logo-file-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handleFile(file)
                  }}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              title={t("settings.branding.appearance.title", "Colour & font")}
              dataCy="branding-appearance-card"
              contentClassName="grid gap-4"
              footer={
                <SettingsFormFooter saved={saved}>
                  <Button
                    type="button"
                    onClick={handleSave}
                    loading={setBranding.isPending}
                    disabled={colorError}
                    data-cy="branding-save-button"
                  >
                    {t("settings.branding.actions.save", "Save")}
                  </Button>
                </SettingsFormFooter>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="branding-accent-color">
                    {t("settings.branding.accentColor.label", "Accent color")}
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={t("settings.branding.accentColor.label", "Accent color")}
                      value={HEX_COLOR_PATTERN.test(accentColor.trim()) ? accentColor.trim() : "#007bff"}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-9 w-12 shrink-0 rounded border p-0.5"
                      data-cy="branding-accent-color-picker"
                    />
                    <Input
                      id="branding-accent-color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      placeholder="#007bff"
                      data-cy="branding-accent-color-input"
                    />
                  </div>
                  {colorError && (
                    <p className="text-sm text-destructive" data-cy="branding-accent-color-error">
                      {t("settings.branding.messages.invalidColor", 'Must be a hex color like "#1a2b3c"')}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="branding-font">{t("settings.branding.font.label", "Font")}</Label>
                  <Select
                    value={font || "__default__"}
                    onValueChange={(v) => setFont(v === "__default__" ? "" : v)}
                  >
                    <SelectTrigger id="branding-font" data-cy="branding-font-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__" data-cy="branding-font-option-default">
                        {t("settings.branding.font.default", "Default")}
                      </SelectItem>
                      {status.fonts.map((f) => (
                        <SelectItem key={f.key} value={f.key} data-cy={`branding-font-option-${f.key}`}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SettingsSection>
          </div>

          {/* `lg:sticky` keeps the sample document in view while the form column above scrolls —
              there is no OWN scroll container here, so this simply pins within the page. */}
          <SettingsSection
            title={t("settings.branding.preview.title", "Preview")}
            dataCy="branding-preview-card"
            className="lg:sticky lg:top-6"
          >
            {previewLoading || !sanitizedPreviewHtml ? (
              <p className="text-sm text-muted-foreground">
                {t("settings.branding.preview.loading", "Loading preview…")}
              </p>
            ) : (
              <iframe
                title={t("settings.branding.preview.title", "Preview")}
                sandbox="allow-same-origin"
                srcDoc={sanitizedPreviewHtml}
                className="h-[600px] w-full rounded border bg-white"
                data-cy="branding-preview-iframe"
              />
            )}
          </SettingsSection>
        </div>
      )}
    </SettingsPage>
  )
}
