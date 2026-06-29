"use client"

import { useState, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useGet, authenticatedFetch } from "@/hooks/use-fetch"
import { useCompany } from "@/hooks/queries/use-company"
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

// ── Types ──────────────────────────────────────────────────────────────────

interface CertMeta {
  id: string
  companyId: string
  label: string
  applicability: string
  environment: string
  notBefore: string
  notAfter: string
  serial: string
  subject: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ── Upload modal ───────────────────────────────────────────────────────────

interface UploadModalProps {
  open: boolean
  companyId: string
  onClose: () => void
  onUploaded: () => void
}

function UploadCertModal({ open, companyId, onClose, onUploaded }: UploadModalProps) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [label, setLabel]               = useState("")
  const [applicability, setApplicability] = useState("*")
  const [environment, setEnvironment]   = useState("TEST")
  const [password, setPassword]         = useState("")
  const [loading, setLoading]           = useState(false)

  const reset = () => {
    setLabel("")
    setApplicability("*")
    setEnvironment("TEST")
    setPassword("")
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleClose = () => { reset(); onClose() }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error(t("settings.signing.upload.noPfx", "Please select a .pfx / .p12 file"))
      return
    }

    setLoading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pfxBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

      const res = await authenticatedFetch(
        `/api/compliance/signing-certificates/companies/${companyId}`,
        {
          method: "POST",
          body: JSON.stringify({ label, applicability, environment, pfxBase64, pfxPassword: password }),
        },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).message ?? "Upload failed")
      }
      toast.success(t("settings.signing.upload.success", "Certificate uploaded"))
      reset()
      onUploaded()
    } catch (err: any) {
      toast.error(err?.message ?? t("settings.signing.upload.error", "Upload failed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.signing.upload.title", "Upload signing certificate")}</DialogTitle>
          <DialogDescription>
            {t(
              "settings.signing.upload.description",
              "Upload a PKCS#12 (.pfx / .p12) certificate. The file and password are encrypted at rest and never returned.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="cert-label">{t("settings.signing.upload.label", "Label")}</Label>
            <Input
              id="cert-label"
              required
              placeholder={t("settings.signing.upload.labelPlaceholder", "e.g. FR production cert 2025")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="cert-file">
              {t("settings.signing.upload.file", "PFX / P12 file")}
            </Label>
            <Input
              id="cert-file"
              ref={fileRef}
              type="file"
              required
              accept=".pfx,.p12"
              className="cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="cert-password">
              {t("settings.signing.upload.password", "PFX password")}
            </Label>
            <Input
              id="cert-password"
              type="password"
              autoComplete="new-password"
              placeholder={t("settings.signing.upload.passwordPlaceholder", "Certificate password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("settings.signing.upload.applicability", "Applies to")}</Label>
              <Select value={applicability} onValueChange={setApplicability}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">{t("settings.signing.upload.applicabilityAll", "All formats (*)")}</SelectItem>
                  <SelectItem value="XAdES">XAdES</SelectItem>
                  <SelectItem value="CAdES">CAdES</SelectItem>
                  <SelectItem value="PAdES">PAdES</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{t("settings.signing.upload.environment", "Environment")}</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEST">TEST</SelectItem>
                  <SelectItem value="PROD">PROD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              {t("settings.signing.upload.submit", "Upload")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Cert card ──────────────────────────────────────────────────────────────

function certIsExpired(notAfter: string) {
  return new Date(notAfter) < new Date()
}

function certExpiresLabel(notAfter: string) {
  const d = new Date(notAfter)
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

interface CertCardProps {
  cert: CertMeta
  onDelete: (id: string) => void
  deleting: boolean
}

function CertCard({ cert, onDelete, deleting }: CertCardProps) {
  const { t } = useTranslation()
  const expired = certIsExpired(cert.notAfter)

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            {cert.isActive && !expired ? (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            ) : expired ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <XCircle className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{cert.label}</p>
              <Badge variant={cert.environment === "PROD" ? "default" : "secondary"}>
                {cert.environment}
              </Badge>
              <Badge variant="outline">{cert.applicability === "*" ? "All" : cert.applicability}</Badge>
              {expired && (
                <Badge variant="destructive">{t("settings.signing.status.expired", "Expired")}</Badge>
              )}
              {!cert.isActive && !expired && (
                <Badge variant="secondary">{t("settings.signing.status.inactive", "Inactive")}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate" title={cert.subject}>
              {cert.subject}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.signing.expires", "Expires")}: {certExpiresLabel(cert.notAfter)}
              {" · "}
              {t("settings.signing.serial", "Serial")}: {cert.serial}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {cert.isActive && !expired && (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={() => onDelete(cert.id)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SigningCertificatesSettings() {
  const { t } = useTranslation()
  const { data: company } = useCompany()
  const companyId = company?.id

  const {
    data: certs,
    loading,
    mutate: refetch,
  } = useGet<CertMeta[]>(
    companyId ? `/api/compliance/signing-certificates/companies/${companyId}` : null,
  )

  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)

  const handleDelete = async (certId: string) => {
    if (!companyId) return
    setDeleting(certId)
    try {
      const res = await authenticatedFetch(
        `/api/compliance/signing-certificates/companies/${companyId}/${certId}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error("Delete failed")
      toast.success(t("settings.signing.deleteSuccess", "Certificate removed"))
      refetch()
    } catch {
      toast.error(t("settings.signing.deleteError", "Failed to remove certificate"))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">
            {t("settings.signing.title", "Signing Certificates")}
          </h1>
          <p className="text-muted-foreground">
            {t(
              "settings.signing.description",
              "Upload per-company PKCS#12 signing certificates for XAdES, CAdES, and PAdES electronic signatures. Files and passwords are encrypted at rest and never returned.",
            )}
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="shrink-0">
          <Upload className="h-4 w-4 mr-2" />
          {t("settings.signing.uploadButton", "Upload certificate")}
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {certs && certs.length > 0 ? (
            certs.map((cert) => (
              <CertCard
                key={cert.id}
                cert={cert}
                onDelete={handleDelete}
                deleting={deleting === cert.id}
              />
            ))
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10">
                <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  {t(
                    "settings.signing.emptyState",
                    "No signing certificates configured. Invoices will be transmitted unsigned.",
                  )}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {companyId && (
        <UploadCertModal
          open={uploadOpen}
          companyId={companyId}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); refetch() }}
        />
      )}
    </div>
  )
}
