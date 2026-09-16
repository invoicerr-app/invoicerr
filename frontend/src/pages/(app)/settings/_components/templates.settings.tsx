// biome-ignore-all lint/security/noDangerouslySetInnerHtml: the html preview is sanitized into safeHtml
import DOMPurify from "dompurify"
import { ChevronDown, ChevronUp, FileText, Mail, RotateCcw, TriangleAlert } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { Separator } from "@/components/ui/separator"
import { useCompanies } from "@/hooks/queries"
import { useDelete, useGet, usePut } from "@/hooks/use-fetch"
import { descriptorTypeLabel } from "@/lib/descriptor-i18n"
import {
  SettingsIconDisc,
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsPage,
  SettingsRowMenu,
  SettingsSection,
} from "./settings-section"

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

/** Whether a rich-text editor's HTML value is, once its markup is stripped, actually empty — a fresh
 *  TipTap document is `<p></p>`, not `""`, so a plain `.trim() === ""` would never disable Save on an
 *  emptied-out template. */
function isHtmlEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim() === ""
}

/** True for a string that already carries real markup — used only to decide whether a legacy body
 *  should be escaped-and-wrapped (below) or handed to the editor as-is. Every shipped descriptor
 *  default and every pre-existing company override's `body` is plain text (see this screen's own
 *  header on the backend's `MailTemplate.body`/`DocumentEmailTemplate.body` shape), so this is a
 *  defensive check, not the expected path. */
function looksLikeHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text)
}

function escapeForHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Turns a plain-text body into the paragraphs a rich-text editor can show and keep editing — a blank
 *  line starts a new paragraph, a single line break inside one becomes `<br>`. This is what makes an
 *  old text-only template (every descriptor default, and every company override saved before this
 *  editor existed) still "afficher/éditer" rather than greeting the author with a blank editor. */
function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeForHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("")
}

/** The single source the rich-text editor is seeded from: the stored `html` part when there is one,
 *  else the stored `body` converted from plain text, else (a genuinely empty template) nothing. Once
 *  the author saves, `html` is always what is sent — see `DocumentTemplateCard.handleSave` — so this
 *  conversion only ever runs once, on load, never on every keystroke. */
function seedEditorHtml(template: { body: string; html?: string }): string {
  if (template.html?.trim()) return template.html
  if (!template.body.trim()) return ""
  return looksLikeHtml(template.body) ? template.body : plainTextToHtml(template.body)
}

/** The fake mail client the editor's own values are previewed inside — a "paper" surface (`bg-card`)
 *  on the settings screen's own tray (`bg-muted`), never a hard-coded white/black pair: it renders in
 *  whichever theme the author is currently reading it in, exactly like the rest of this screen. */
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
    <div className="rounded-lg bg-muted p-4" data-cy="email-template-preview">
      <div className="mx-auto max-w-2xl rounded-lg bg-card text-card-foreground shadow-lg">
        <div className="border-b p-4">
          <div className="mb-3 flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">Invoicerr Mail</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2 rounded bg-muted p-2">
              <span className="font-medium text-muted-foreground">
                {t("settings.emailTemplates.preview.from")}:
              </span>
              <span className="text-foreground">noreply@invoicerr.dev</span>
            </div>
            <div className="flex gap-2 rounded bg-muted p-2">
              <span className="font-medium text-muted-foreground">
                {t("settings.emailTemplates.preview.to")}:
              </span>
              <span className="text-foreground">user@example.com</span>
            </div>
            <div className="flex gap-2 rounded bg-muted p-2">
              <span className="font-medium text-muted-foreground">
                {t("settings.emailTemplates.preview.subject")}:
              </span>
              <span className="text-foreground" data-cy="email-template-preview-subject">
                {previewSubject}
              </span>
            </div>
          </div>
        </div>
        <Separator orientation="horizontal" />
        <div className="p-4" data-cy="email-template-preview-body">
          {safeHtml ? (
            <div
              className="prose prose-sm max-w-none [*]:text-foreground"
              style={{ fontFamily: "Arial, sans-serif" }}
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">
              {substitutePlaceholders(text, variables)}
            </pre>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t p-4">
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
 * The collapsed row every template shares, whichever family it belongs to: its name, its current
 * subject as a one-line preview, whether what applies is this company's own text or the shipped
 * default, and the toggle that reveals the editor. One editor is open at a time — a screen that
 * expanded every entry at once would be a wall of textareas. The row's ONE contextual action is
 * "Edit"/"Close"; anything else a template offers (today: reverting a document type's override)
 * lives in its own "⋯" menu instead of a second full-width button, the same split every other
 * settings list in this app makes.
 */
function TemplateRow({
  icon,
  name,
  meta,
  overridden,
  open,
  onToggle,
  idSuffix,
  menu,
  children,
}: {
  icon: LucideIcon
  name: string
  meta?: ReactNode
  overridden: boolean
  open: boolean
  onToggle: () => void
  /** The family/type id this row is for ("SIGNATURE_REQUEST", "invoice", …) — every `data-cy` on this
   *  row is built from it here, in ONE place, so a system row and a per-type row can never drift into
   *  two different naming schemes for what is structurally the same row. */
  idSuffix: string
  /** The row's own "⋯" menu — only a document type with an override to drop renders one. */
  menu?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <SettingsListRow
      dataCy={`email-template-card-${idSuffix}`}
      leading={<SettingsIconDisc icon={icon} />}
      badge={
        <Badge variant={overridden ? "info" : "outline"} data-cy={`email-template-source-${idSuffix}`}>
          {overridden
            ? t("settings.emailTemplates.source.customised")
            : t("settings.emailTemplates.source.shippedDefault")}
        </Badge>
      }
      title={name}
      meta={meta}
      primary={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggle}
          dataCy={`email-template-toggle-${idSuffix}`}
        >
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {open ? t("settings.emailTemplates.editor.close") : t("settings.emailTemplates.editor.edit")}
        </Button>
      }
      menu={menu}
    >
      {open && <div className="space-y-6 border-t pt-4">{children}</div>}
    </SettingsListRow>
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
  const incomplete = subject.trim() === "" || isHtmlEmpty(body)

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
      icon={Mail}
      name={name}
      meta={template.subject}
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
          <div className="space-y-2" data-cy={`email-template-body-${template.id}`}>
            <Label htmlFor={`body-${template.id}`}>{t("settings.emailTemplates.editor.htmlBody")}</Label>
            <RichTextEditor
              id={`body-${template.id}`}
              value={body}
              onChange={setBody}
              readOnly={!canEdit}
              variables={template.variables}
              className="min-h-[280px]"
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
  // ONE rich-text field now covers what used to be two textareas (plain-text `body` + optional raw
  // `html`) — seeded from whichever the server actually has (see `seedEditorHtml`'s own header). The
  // plain-text part is never edited directly any more: it is sent empty and the server DERIVES it from
  // this html at render time (`email-template.ts`'s own `deriveTextFromHtml`), which is a state that
  // engine already had to support for every legacy html-only template.
  const [content, setContent] = useState(() => seedEditorHtml(template))
  const [warnings, setWarnings] = useState<string[]>([])
  const url = `/api/documents/types/${template.typeId}/email-template`
  const { trigger: save, loading: saving } = usePut<{ warnings?: string[] }>(url)
  const { trigger: resetToDefault, loading: resetting } = useDelete(url)

  // Same re-sync as the system card: after a save the server's stored html is the authority, and after
  // a reset the editor must show the shipped default rather than the text that was just dropped.
  useEffect(() => {
    setSubject(template.subject)
    setContent(seedEditorHtml(template))
  }, [template])

  const name = descriptorTypeLabel(t, template.typeId, template.label)
  // What the server refuses outright (no subject, or an empty body): disabled here rather than sent and
  // bounced as a 400.
  const incomplete = subject.trim() === "" || isHtmlEmpty(content)

  async function handleSave() {
    const saved = await save({ subject, body: "", html: content })
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

  // Only worth offering once there IS an override to drop: reverting a template that was never
  // customised is a server-side no-op, so the row's menu would offer an action doing nothing visible.
  const showResetMenu = canEdit && template.source === "company"

  return (
    <TemplateRow
      icon={FileText}
      name={name}
      meta={template.subject}
      overridden={template.source === "company"}
      open={open}
      onToggle={onToggle}
      idSuffix={template.typeId}
      menu={
        showResetMenu ? (
          <SettingsRowMenu
            dataCy={`email-template-menu-${template.typeId}`}
            items={[
              {
                label: t("settings.emailTemplates.resetButton"),
                icon: RotateCcw,
                onSelect: handleReset,
                disabled: resetting,
                dataCy: `email-template-reset-${template.typeId}`,
              },
            ]}
          />
        ) : undefined
      }
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
          <div className="space-y-2" data-cy={`email-template-body-${template.typeId}`}>
            <Label htmlFor={`body-${template.typeId}`}>{t("settings.emailTemplates.editor.body")}</Label>
            <RichTextEditor
              id={`body-${template.typeId}`}
              value={content}
              onChange={setContent}
              readOnly={!canEdit}
              placeholder={t("settings.emailTemplates.editor.bodyPlaceholder")}
              variables={template.variables}
              className="min-h-[220px]"
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.emailTemplates.editor.systemHtmlTip")}
            </p>
          </div>
          <PlaceholderHints variables={template.variables} />
        </div>
        {/* `text={template.body}` is a defensive fallback only (see `EmailPreview`'s own header): once
            this editor has been opened at all, `content` is already seeded from it and never blank. */}
        <EmailPreview subject={subject} text={template.body} html={content} variables={template.variables} />
      </div>

      <PlaceholderWarnings warnings={warnings} />

      {canEdit ? (
        <div className="flex justify-end">
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
    <SettingsPage
      title={t("settings.emailTemplates.title")}
      description={t("settings.emailTemplates.description")}
    >
      <SettingsSection
        title={t("settings.emailTemplates.system.title")}
        description={t("settings.emailTemplates.system.description")}
      >
        {systemData === null ? (
          <SettingsListSkeleton rows={2} />
        ) : (
          <SettingsList>
            {systemTemplates.map((template) => (
              <SystemTemplateCard
                key={template.id}
                template={template}
                canEdit={canEdit}
                open={openKey === `system:${template.id}`}
                onToggle={() => toggle(`system:${template.id}`)}
                onSaved={refetchSystem}
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("settings.emailTemplates.documents.title")}
        description={t("settings.emailTemplates.documents.description")}
      >
        {documentData === null ? (
          <SettingsListSkeleton rows={3} />
        ) : documentTemplates.length === 0 ? (
          <EmptyState icon={Mail} size="sm" title={t("settings.emailTemplates.documents.empty")} />
        ) : (
          <SettingsList>
            {documentTemplates.map((template) => (
              <DocumentTemplateCard
                key={template.typeId}
                template={template}
                canEdit={canEdit}
                open={openKey === `document:${template.typeId}`}
                onToggle={() => toggle(`document:${template.typeId}`)}
                onSaved={refetchDocuments}
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>
    </SettingsPage>
  )
}
