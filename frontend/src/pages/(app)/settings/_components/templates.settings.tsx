// biome-ignore-all lint/security/noDangerouslySetInnerHtml: the html preview is sanitized into safeHtml
import DOMPurify from "dompurify"
import { ChevronDown, ChevronUp, Mail, RotateCcw, TriangleAlert } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useCompanies } from "@/hooks/queries"
import { useDelete, useGet, usePut } from "@/hooks/use-fetch"
import { descriptorTypeLabel } from "@/lib/descriptor-i18n"

/**
 * One SYSTEM email — the signature request and the verification code, the two emails that are not
 * about a document (`GET /api/company/email-templates`). `body` is html: it is the only part stored,
 * and the text/plain alternative is derived from it when the mail is sent.
 */
interface SystemEmailTemplateView {
  dbId: string
  id: string
  name: string
  subject: string
  body: string
  source: "company" | "default"
  variables: Record<string, string>
}

/**
 * One document type's email template (`GET /api/documents/email-templates`) — the template that
 * CURRENTLY applies, where it came from, and the placeholders this type actually offers. `source`
 * distinguishes this company's own text from the default it would revert to, so nothing here has to
 * compare strings to find out.
 */
interface DocumentEmailTemplateView {
  typeId: string
  label: string
  /** The text/plain part — empty for a template that deliberately carries html alone. */
  body: string
  html?: string
  subject: string
  source: "company" | "descriptor" | "generic"
  variables: Record<string, string>
}

/** The server's own placeholder grammar (backend documents/actions/email-template.ts): SINGLE braces
 *  around word characters. */
const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g

/**
 * Fills in every `{placeholder}` the vocabulary knows, leaving an unknown one written out exactly as
 * typed. Both halves matter: the substitution is what makes a preview look like the real mail, and
 * leaving the unknown ones visible is what shows the author that a typo would travel to the
 * recipient as literal braces — which is precisely what the server does at send time rather than
 * blanking it or refusing to send.
 */
function substitutePlaceholders(text: string, variables: Record<string, string>): string {
  return text.replace(PLACEHOLDER_PATTERN, (literal, key: string) =>
    Object.hasOwn(variables, key) ? variables[key] : literal,
  )
}

function EmailPreview({
  subject,
  text,
  html,
  variables,
}: {
  subject: string
  text: string
  html?: string
  variables: Record<string, string>
}) {
  const { t } = useTranslation()

  const previewSubject = substitutePlaceholders(subject, variables)
  // Sanitized even though the server filters every html body it STORES: what is previewed here is
  // whatever is in the editor right now, which no server has seen yet.
  const safeHtml = html?.trim() ? DOMPurify.sanitize(substitutePlaceholders(html, variables)) : null

  return (
    <div className="bg-muted rounded-lg p-4" data-cy="email-template-preview">
      <div className="bg-white rounded-lg shadow-lg mx-auto max-w-2xl">
        <div className="border-b p-4">
          <div className="flex items-center gap-2 mb-3">
            <Mail className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-gray-900">Invoicerr Mail</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2 bg-gray-50 p-2 rounded">
              <span className="font-medium text-gray-600">{t("settings.emailTemplates.preview.from")}:</span>
              <span className="text-gray-900">noreply@invoicerr.dev</span>
            </div>
            <div className="flex gap-2 bg-gray-50 p-2 rounded">
              <span className="font-medium text-gray-600">{t("settings.emailTemplates.preview.to")}:</span>
              <span className="text-gray-900">user@example.com</span>
            </div>
            <div className="flex gap-2 bg-gray-50 p-2 rounded">
              <span className="font-medium text-gray-600">
                {t("settings.emailTemplates.preview.subject")}:
              </span>
              <span className="text-gray-900" data-cy="email-template-preview-subject">
                {previewSubject}
              </span>
            </div>
          </div>
        </div>
        <Separator className="bg-neutral-200" orientation="horizontal" />
        <div className="p-4" data-cy="email-template-preview-body">
          {safeHtml ? (
            <div
              className="prose prose-sm max-w-none [*]:text-black"
              style={{ fontFamily: "Arial, sans-serif" }}
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm text-black">
              {substitutePlaceholders(text, variables)}
            </pre>
          )}
        </div>
        <div className="border-t p-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm">
            {t("settings.emailTemplates.preview.reply")}
          </Button>
          <Button type="button" variant="outline" size="sm">
            {t("settings.emailTemplates.preview.forward")}
          </Button>
          <Button type="button" variant="outline" size="sm">
            {t("settings.emailTemplates.preview.archive")}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The placeholders this ONE entry offers, straight from the API response — never a list written down
 *  here, which is what keeps a type that has no client reference (or no money) from being offered a
 *  placeholder its own sends would leave unsubstituted. */
function PlaceholderHints({ variables }: { variables: Record<string, string> }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2" data-cy="email-template-variables">
      <Label>{t("settings.emailTemplates.editor.availableVariables")}</Label>
      <div className="flex flex-wrap gap-2">
        {Object.keys(variables).map((name) => (
          <Badge key={name} variant="secondary" className="font-mono" data-cy="email-template-variable-badge">
            {`{${name}}`}
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.emailTemplates.editor.variablesTip")}</p>
    </div>
  )
}

/** The server's placeholder warnings, shown verbatim: they are prose it composed about the template
 *  just saved ("Unknown email template placeholder …"), not a condition this screen can re-derive. A
 *  warning never means the save failed — an unknown placeholder is reported, never refused. */
function PlaceholderWarnings({ warnings }: { warnings: string[] }) {
  const { t } = useTranslation()

  if (warnings.length === 0) return null

  return (
    <Alert data-cy="email-template-warnings">
      <TriangleAlert />
      <AlertTitle>{t("settings.emailTemplates.warningsTitle")}</AlertTitle>
      <AlertDescription>
        {warnings.map((warning) => (
          <p key={warning} data-cy="email-template-warning-item">
            {warning}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  )
}

/**
 * The collapsed row every template shares, whichever family it belongs to: its name, whether what
 * applies is this company's own text or the shipped default, and the toggle that reveals the editor.
 * One editor is open at a time — a screen that expanded every entry at once would be a wall of
 * textareas.
 */
function TemplateRow({
  name,
  overridden,
  open,
  onToggle,
  idSuffix,
  children,
}: {
  name: string
  overridden: boolean
  open: boolean
  onToggle: () => void
  /** The family/type id this row is for ("SIGNATURE_REQUEST", "invoice", …) — every `data-cy` on this
   *  row is built from it here, in ONE place, so a system row and a per-type row can never drift into
   *  two different naming schemes for what is structurally the same row. */
  idSuffix: string
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <Card data-cy={`email-template-card-${idSuffix}`}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{name}</CardTitle>
          <Badge variant={overridden ? "default" : "outline"} data-cy={`email-template-source-${idSuffix}`}>
            {overridden
              ? t("settings.emailTemplates.source.customised")
              : t("settings.emailTemplates.source.shippedDefault")}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggle}
          dataCy={`email-template-toggle-${idSuffix}`}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {open ? t("settings.emailTemplates.editor.close") : t("settings.emailTemplates.editor.edit")}
        </Button>
      </CardHeader>
      {open && <CardContent className="space-y-6">{children}</CardContent>}
    </Card>
  )
}

function SystemTemplateCard({
  template,
  canEdit,
  open,
  onToggle,
  onSaved,
}: {
  template: SystemEmailTemplateView
  canEdit: boolean
  open: boolean
  onToggle: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [subject, setSubject] = useState(template.subject)
  const [body, setBody] = useState(template.body)
  const [warnings, setWarnings] = useState<string[]>([])
  const { trigger: save, loading: saving } = usePut<{ warnings?: string[] }>("/api/company/email-templates")

  // Re-sync whenever the stored template changes under the editor (a save of its own, a refetch): the
  // server sanitizes the html it accepts, so what was submitted is not necessarily what is now stored.
  useEffect(() => {
    setSubject(template.subject)
    setBody(template.body)
  }, [template])

  const name = t(`settings.emailTemplates.system.families.${template.id}`, { defaultValue: template.name })
  const incomplete = subject.trim() === "" || body.trim() === ""

  async function handleSave() {
    // `dbId` only exists once this company has actually stored an override; the family `id` is what
    // identifies the template until then.
    const saved = await save({ id: template.id, dbId: template.dbId || undefined, subject, body })
    if (!saved) {
      toast.error(t("settings.emailTemplates.messages.saveError"))
      return
    }
    setWarnings(saved.warnings ?? [])
    toast.success(t("settings.emailTemplates.messages.saveSuccess", { name }))
    onSaved()
  }

  return (
    <TemplateRow
      name={name}
      overridden={template.source === "company"}
      open={open}
      onToggle={onToggle}
      idSuffix={template.id}
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`subject-${template.id}`}>{t("settings.emailTemplates.editor.subject")}</Label>
            <Input
              id={`subject-${template.id}`}
              value={subject}
              readOnly={!canEdit}
              autoComplete="off"
              data-bwignore
              data-1p-ignore
              data-lpignore
              data-form-type="other"
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("settings.emailTemplates.editor.subjectPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`body-${template.id}`}>{t("settings.emailTemplates.editor.htmlBody")}</Label>
            <Textarea
              id={`body-${template.id}`}
              value={body}
              readOnly={!canEdit}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("settings.emailTemplates.editor.htmlPlaceholder")}
              className="min-h-[320px] font-mono text-sm"
              style={{ resize: "vertical" }}
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.emailTemplates.editor.systemHtmlTip")}
            </p>
          </div>
          <PlaceholderHints variables={template.variables} />
        </div>
        <EmailPreview subject={subject} text="" html={body} variables={template.variables} />
      </div>

      <PlaceholderWarnings warnings={warnings} />

      {canEdit ? (
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={incomplete}
            dataCy={`email-template-save-${template.id}`}
          >
            {t("settings.emailTemplates.saveButton")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("settings.emailTemplates.readOnlyNotice")}</p>
      )}
    </TemplateRow>
  )
}

function DocumentTemplateCard({
  template,
  canEdit,
  open,
  onToggle,
  onSaved,
}: {
  template: DocumentEmailTemplateView
  canEdit: boolean
  open: boolean
  onToggle: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [subject, setSubject] = useState(template.subject)
  const [body, setBody] = useState(template.body)
  const [html, setHtml] = useState(template.html ?? "")
  const [warnings, setWarnings] = useState<string[]>([])
  const url = `/api/documents/types/${template.typeId}/email-template`
  const { trigger: save, loading: saving } = usePut<{ warnings?: string[] }>(url)
  const { trigger: resetToDefault, loading: resetting } = useDelete(url)

  // Same re-sync as the system card: after a save the server's stored html is the authority, and after
  // a reset the editor must show the shipped default rather than the text that was just dropped.
  useEffect(() => {
    setSubject(template.subject)
    setBody(template.body)
    setHtml(template.html ?? "")
  }, [template])

  const name = descriptorTypeLabel(t, template.typeId, template.label)
  // What the server refuses outright (no subject, or neither body): disabled here rather than sent and
  // bounced as a 400.
  const incomplete = subject.trim() === "" || (body.trim() === "" && html.trim() === "")

  async function handleSave() {
    const saved = await save({ subject, body, html })
    if (!saved) {
      toast.error(t("settings.emailTemplates.messages.saveError"))
      return
    }
    setWarnings(saved.warnings ?? [])
    toast.success(t("settings.emailTemplates.messages.saveSuccess", { name }))
    onSaved()
  }

  async function handleReset() {
    const restored = await resetToDefault()
    if (!restored) {
      toast.error(t("settings.emailTemplates.messages.resetError"))
      return
    }
    setWarnings([])
    toast.success(t("settings.emailTemplates.messages.resetSuccess", { name }))
    onSaved()
  }

  return (
    <TemplateRow
      name={name}
      overridden={template.source === "company"}
      open={open}
      onToggle={onToggle}
      idSuffix={template.typeId}
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`subject-${template.typeId}`}>
              {t("settings.emailTemplates.editor.subject")}
            </Label>
            <Input
              id={`subject-${template.typeId}`}
              data-cy={`email-template-subject-${template.typeId}`}
              value={subject}
              readOnly={!canEdit}
              autoComplete="off"
              data-bwignore
              data-1p-ignore
              data-lpignore
              data-form-type="other"
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("settings.emailTemplates.editor.subjectPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`body-${template.typeId}`}>{t("settings.emailTemplates.editor.body")}</Label>
            <Textarea
              id={`body-${template.typeId}`}
              data-cy={`email-template-body-${template.typeId}`}
              value={body}
              readOnly={!canEdit}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("settings.emailTemplates.editor.bodyPlaceholder")}
              className="min-h-[200px] text-sm"
              style={{ resize: "vertical" }}
            />
            <p className="text-xs text-muted-foreground">{t("settings.emailTemplates.editor.textTip")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`html-${template.typeId}`}>{t("settings.emailTemplates.editor.htmlBody")}</Label>
            <Textarea
              id={`html-${template.typeId}`}
              data-cy={`email-template-html-${template.typeId}`}
              value={html}
              readOnly={!canEdit}
              onChange={(e) => setHtml(e.target.value)}
              placeholder={t("settings.emailTemplates.editor.htmlPlaceholder")}
              className="min-h-[200px] font-mono text-sm"
              style={{ resize: "vertical" }}
            />
            <p className="text-xs text-muted-foreground">{t("settings.emailTemplates.editor.htmlTip")}</p>
          </div>
          <PlaceholderHints variables={template.variables} />
        </div>
        <EmailPreview subject={subject} text={body} html={html} variables={template.variables} />
      </div>

      <PlaceholderWarnings warnings={warnings} />

      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          {/* Only worth offering once there IS an override to drop: reverting a template that was
              never customised is a server-side no-op, so the button would do nothing visible. */}
          {template.source === "company" && (
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              loading={resetting}
              dataCy={`email-template-reset-${template.typeId}`}
            >
              <RotateCcw className="h-4 w-4" />
              {t("settings.emailTemplates.resetButton")}
            </Button>
          )}
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={incomplete}
            dataCy={`email-template-save-${template.typeId}`}
          >
            {t("settings.emailTemplates.saveButton")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("settings.emailTemplates.readOnlyNotice")}</p>
      )}
    </TemplateRow>
  )
}

/**
 * Every email this company can send, on one screen: the two SYSTEM emails (signature request,
 * verification code) and one entry per DOCUMENT TYPE, the latter driven by the type registry rather
 * than a list of types named here — a type added by a plugin gets its own editor, with its own
 * derived placeholder vocabulary, with nothing to register.
 *
 * The save and reset controls are offered to an OWNER/ADMIN only, mirroring the routes' own
 * `@Roles(OWNER, ADMIN)`: a MEMBER reads the templates rather than being handed a button that could
 * only ever come back 403.
 */
export default function EmailTemplatesSettings() {
  const { t } = useTranslation()
  const { activeRole } = useCompanies()
  const canEdit = activeRole === "OWNER" || activeRole === "ADMIN"

  const { data: systemData, mutate: refetchSystem } = useGet<SystemEmailTemplateView[]>(
    "/api/company/email-templates",
  )
  const { data: documentData, mutate: refetchDocuments } = useGet<DocumentEmailTemplateView[]>(
    "/api/documents/email-templates",
  )

  // One editor open at a time across BOTH sections. The keys are namespaced by family so a document
  // type id can never collide with a system family name.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const toggle = (key: string) => setOpenKey((current) => (current === key ? null : key))

  // `GET /api/company/email-templates` replies `{}` rather than a list when there is no active
  // company at all, so the shape is checked rather than assumed.
  const systemTemplates = Array.isArray(systemData) ? systemData : []
  const documentTemplates = Array.isArray(documentData) ? documentData : []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t("settings.emailTemplates.title")}</h1>
        <p className="text-muted-foreground">{t("settings.emailTemplates.description")}</p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">{t("settings.emailTemplates.system.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.emailTemplates.system.description")}</p>
        </div>
        {systemData === null ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          systemTemplates.map((template) => (
            <SystemTemplateCard
              key={template.id}
              template={template}
              canEdit={canEdit}
              open={openKey === `system:${template.id}`}
              onToggle={() => toggle(`system:${template.id}`)}
              onSaved={refetchSystem}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">{t("settings.emailTemplates.documents.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.emailTemplates.documents.description")}
          </p>
        </div>
        {documentData === null ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : documentTemplates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.emailTemplates.documents.empty")}</p>
        ) : (
          documentTemplates.map((template) => (
            <DocumentTemplateCard
              key={template.typeId}
              template={template}
              canEdit={canEdit}
              open={openKey === `document:${template.typeId}`}
              onToggle={() => toggle(`document:${template.typeId}`)}
              onSaved={refetchDocuments}
            />
          ))
        )}
      </section>
    </div>
  )
}
