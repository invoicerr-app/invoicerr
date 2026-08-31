"use client"

import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useGet, usePost, useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, Trash2, Upload } from "lucide-react"

type Applicability = "*" | "XAdES" | "CAdES" | "PAdES"
type Environment = "TEST" | "PROD"

interface CertificateMeta {
  id: string
  label: string
  applicability: string
  environment: Environment
  notBefore: string
  notAfter: string
  serial: string
  subject: string
  isActive: boolean
}

function isExpired(notAfter: string) {
  return new Date(notAfter) < new Date()
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/**
 * One stored certificate — status only (label/subject/validity/applicability/active), matching the
 * "GET never returns the PFX or the password" guarantee `signing-certificates.service.ts#toMeta`
 * enforces server-side (see that file's own header). Deactivation is a SOFT delete
 * (`DELETE /api/company/signing-certificates/:id` really calls `deactivate()`) — the row (and its
 * history) stays; only the badge changes.
 */
function CertificateRow({ cert, onDeactivated }: { cert: CertificateMeta; onDeactivated: () => void }) {
  const { t } = useTranslation()
  const expired = isExpired(cert.notAfter)

  const { trigger: deactivate, loading: deactivating } = useMutationWithToast(
    useDelete(`/api/company/signing-certificates/${cert.id}`),
    t("settings.signing.messages.deactivateError", "Failed to deactivate the certificate"),
  )

  const handleDeactivate = async () => {
    const result = await deactivate()
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.signing.messages.deactivateSuccess", "Certificate deactivated"))
    onDeactivated()
  }

  return (
    <Card data-cy={`signing-cert-row-${cert.id}`}>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            {cert.isActive && !expired ? (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium" data-cy={`signing-cert-row-${cert.id}-label`}>
                {cert.label}
              </p>
              <Badge variant={cert.environment === "PROD" ? "default" : "secondary"}>
                {cert.environment}
              </Badge>
              <Badge variant="outline">
                {cert.applicability === "*"
                  ? t("settings.signing.upload.applicabilityAll", "All formats (*)")
                  : cert.applicability}
              </Badge>
              <Badge
                variant={cert.isActive && !expired ? "default" : expired ? "destructive" : "secondary"}
                data-cy={`signing-cert-row-${cert.id}-status`}
              >
                {expired
                  ? t("settings.signing.status.expired", "Expired")
                  : cert.isActive
                    ? t("settings.signing.status.active", "Active")
                    : t("settings.signing.status.inactive", "Inactive")}
              </Badge>
            </div>
            <p
              className="mt-0.5 truncate text-xs text-muted-foreground"
              title={cert.subject}
              data-cy={`signing-cert-row-${cert.id}-subject`}
            >
              {cert.subject}
            </p>
            <p className="text-xs text-muted-foreground" data-cy={`signing-cert-row-${cert.id}-validity`}>
              {t("settings.signing.expires", "Expires")}: {formatDate(cert.notAfter)}
              {" · "}
              {t("settings.signing.serial", "Serial")}: {cert.serial}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cert.isActive && !expired && <CheckCircle2 className="h-4 w-4 text-green-500" />}
          {cert.isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deactivating}
              onClick={handleDeactivate}
              data-cy={`signing-cert-row-${cert.id}-deactivate-button`}
            >
              {deactivating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Company settings → Signing certificates (root TODO item 13). A company's OPT-IN capability to have
 * its PDFs (GET .../pdf and the email attachment — see `signing/sign-instance-pdf.ts`'s own header)
 * signed PAdES-BES, once an ACTIVE certificate is uploaded here. Deliberately never framed as an
 * obligation anywhere on this screen: no jurisdiction this product ships requires a signed document
 * today (see `signing-certificates.service.ts`'s own header) — the empty state below says so plainly
 * rather than implying a missing requirement.
 *
 * `GET/POST/DELETE /api/company/signing-certificates` (`modules/company/signing-certificates/`) —
 * same credentials pattern `channels.settings.tsx` already holds: the PUT/POST body is encrypted at
 * rest server-side and NEVER echoed back, so this screen never has a decrypted secret to pre-fill an
 * edit form with — uploading again simply replaces the (label, applicability, environment) slot.
 */
export default function SigningCertificatesSettings() {
  const { t } = useTranslation()
  const { data, mutate } = useGet<CertificateMeta[]>("/api/company/signing-certificates")
  const certs = data ?? []

  const fileRef = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState("")
  const [applicability, setApplicability] = useState<Applicability>("*")
  const [environment, setEnvironment] = useState<Environment>("TEST")
  const [password, setPassword] = useState("")

  const { trigger: upload, loading: uploading } = useMutationWithToast(
    usePost("/api/company/signing-certificates"),
    t("settings.signing.upload.error", "Upload failed"),
  )

  const resetForm = () => {
    setLabel("")
    setApplicability("*")
    setEnvironment("TEST")
    setPassword("")
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error(t("settings.signing.upload.noPfx", "Please select a .pfx / .p12 file"))
      return
    }

    const arrayBuffer = await file.arrayBuffer()
    let binary = ""
    const bytes = new Uint8Array(arrayBuffer)
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const pfxBase64 = btoa(binary)

    const result = await upload({ label, applicability, environment, pfxBase64, pfxPassword: password })
    if (!result) return // a named error (corrupt file, wrong password, expired cert) already toasted

    toast.success(t("settings.signing.upload.success", "Certificate uploaded"))
    resetForm()
    mutate()
  }

  return (
    <div className="space-y-6" data-cy="signing-certificates-section">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.signing.title", "Signing Certificates")}</h1>
        <p className="text-muted-foreground">
          {t(
            "settings.signing.description",
            "Upload a PKCS#12 (.pfx / .p12) signing certificate to have this company's document PDFs signed PAdES. This is an optional capability — nothing in this product requires a signed document.",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.signing.upload.title", "Upload signing certificate")}
          </CardTitle>
          <CardDescription>
            {t(
              "settings.signing.upload.description",
              "The file and password are encrypted at rest and never returned by this screen.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="signing-cert-label">{t("settings.signing.upload.label", "Label")}</Label>
                <Input
                  id="signing-cert-label"
                  data-cy="signing-cert-label-input"
                  required
                  placeholder={t("settings.signing.upload.labelPlaceholder", "e.g. FR production cert 2025")}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signing-cert-file">
                  {t("settings.signing.upload.file", "PFX / P12 file")}
                </Label>
                <Input
                  id="signing-cert-file"
                  data-cy="signing-cert-file-input"
                  ref={fileRef}
                  type="file"
                  required
                  accept=".pfx,.p12"
                  className="cursor-pointer"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signing-cert-password">
                  {t("settings.signing.upload.password", "PFX password")}
                </Label>
                <Input
                  id="signing-cert-password"
                  data-cy="signing-cert-password-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t("settings.signing.upload.passwordPlaceholder", "Certificate password")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.signing.upload.applicability", "Applies to")}</Label>
                <Select value={applicability} onValueChange={(v) => setApplicability(v as Applicability)}>
                  <SelectTrigger data-cy="signing-cert-applicability-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent data-cy="signing-cert-applicability-options">
                    <SelectItem value="*" data-cy="signing-cert-applicability-option-all">
                      {t("settings.signing.upload.applicabilityAll", "All formats (*)")}
                    </SelectItem>
                    <SelectItem value="XAdES" data-cy="signing-cert-applicability-option-xades">
                      XAdES
                    </SelectItem>
                    <SelectItem value="CAdES" data-cy="signing-cert-applicability-option-cades">
                      CAdES
                    </SelectItem>
                    <SelectItem value="PAdES" data-cy="signing-cert-applicability-option-pades">
                      PAdES
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.signing.upload.environment", "Environment")}</Label>
                <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
                  <SelectTrigger data-cy="signing-cert-environment-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent data-cy="signing-cert-environment-options">
                    <SelectItem value="TEST" data-cy="signing-cert-environment-option-test">
                      {t("settings.channels.fields.environmentTest", "Test (sandbox)")}
                    </SelectItem>
                    <SelectItem value="PROD" data-cy="signing-cert-environment-option-prod">
                      {t("settings.channels.fields.environmentProd", "Production")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={uploading} data-cy="signing-cert-upload-button">
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {t("settings.signing.upload.submit", "Upload")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3" data-cy="signing-cert-list">
        {certs.length > 0 ? (
          certs.map((cert) => <CertificateRow key={cert.id} cert={cert} onDeactivated={mutate} />)
        ) : (
          <Card>
            <CardContent
              className="flex flex-col items-center justify-center py-10"
              data-cy="signing-cert-empty-state"
            >
              <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-center text-muted-foreground">
                {t(
                  "settings.signing.emptyState",
                  "No signing certificate configured — documents are served and sent unsigned.",
                )}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
