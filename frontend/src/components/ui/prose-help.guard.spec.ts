import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

import { findPermanentProse, longProseKeys } from "./prose-help.guard"

const SRC = join(__dirname, "..", "..")
const LONG_KEYS = longProseKeys(JSON.parse(readFileSync(join(SRC, "locales/en/translation.json"), "utf8")))
const SAMPLE_KEYS = new Set([
  "documents.correction.limitation",
  "documents.correction.explanations.FR.CREDIT_NOTE",
])

// Kept visible on purpose, as `file|hit`: a one-line status that is the information itself, or the text
// a user must read before an irreversible action.
const KEPT_VISIBLE = new Set([
  "components/documents/document-totals.tsx|totals.warnings.map(",
  "components/widgets/widget-renderers/metric-widget.tsx|metric.warnings.map(",
  "components/documents/mark-quote-accepted-dialog.tsx|documents.acceptance.dialogWarning",
  "pages/(app)/settings/_components/billing.settings.tsx|settings.billing.billingEmail.noneOnFileNotice",
  "pages/(app)/settings/_components/billing.settings.tsx|settings.billing.refundNotice.prefix",
  "pages/(app)/settings/_components/danger.settings.tsx|settings.dangerZone.resetCompanyData.detail",
  "pages/(app)/settings/_components/danger.settings.tsx|settings.dangerZone.resetCompanyData.countsSummary",
  "pages/(app)/settings/_components/danger.settings.tsx|settings.dangerZone.deleteCompany.detail",
  // D-299: the language the legal documents are accepted in is consent, and consent has to be read
  // before the click — behind a `?` it would not be given at the moment it is asked for. Stated on
  // both acceptance screens (`/legal/accept` and the sign-up checkbox), same key.
  "pages/legal/accept.tsx|legal.accept.languageNotice",
  "pages/auth/sign-up.tsx|legal.accept.languageNotice",
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx$/.test(name) && !/\.spec\.tsx$/.test(name) ? [path] : []
  })
}

describe("explanatory prose guard", () => {
  it.each([
    [
      "a list of server warnings rendered as paragraphs",
      `<div className="rounded-md bg-warning p-2">
        {warnings.map((warning) => <p key={warning}>{warning}</p>)}
      </div>`,
    ],
    [
      "a nested list of notes",
      `<ul>{period.consolidated.notes.map((note) => <li key={note}>{note}</li>)}</ul>`,
    ],
    ["a prefixed warnings list", `{lineTotalWarnings.map((warning) => <p key={warning}>{warning}</p>)}`],
    [
      "a retention citation interpolated into a visible line",
      `<p>{t("documents.archive.retainUntil", { date, basis: archive.retentionBasis })}</p>`,
    ],
    ["a statute quote passed to a row", `<SettingsListRow meta={obligation.provenance.sourceText} />`],
    ["a resolution note held in a variable", `const quote = provenance?.resolutionNote`],
    ["a server disclaimer in an alert", `<AlertDescription>{report?.disclaimer}</AlertDescription>`],
    [
      "a blocked reason printed under a button",
      `<p>{t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })}</p>`,
    ],
    ["a blocked reason in a tooltip", `<Button tooltip={action.policyBlockedReason} />`],
    ["a long i18n text", `<p>{t("documents.correction.limitation")}</p>`],
    [
      "a long i18n text built from a template",
      `<p>{t(\`documents.correction.explanations.\${cc}.\${id}\`)}</p>`,
    ],
    [
      "a long text as a section description",
      `<SettingsSection description={t("documents.correction.limitation")} />`,
    ],
    ["prose passed as a ProseHelp title", `<ProseHelp title={archive.retentionBasis}>{date}</ProseHelp>`],
  ])("flags %s", (_case, source) => {
    expect(findPermanentProse(source, SAMPLE_KEYS)).toHaveLength(1)
  })

  it.each([
    [
      "warnings behind a ProseHelp",
      `<ProseHelp tone="warning" title={title}>
        {warnings.map((warning) => <span key={warning}>{warning}</span>)}
      </ProseHelp>`,
    ],
    ["a citation behind a ProseHelp", `<ProseHelp title={date}>{archive.retentionBasis}</ProseHelp>`],
    [
      "a quote behind a FieldHelp",
      `<FieldHelp id={id}>{provenance.kind === "legal" ? provenance.sourceText : provenance.resolutionNote}</FieldHelp>`,
    ],
    ["a blocked reason behind a lock", `<FieldLock id={id}>{action.policyBlockedReason}</FieldLock>`],
    [
      "a blocked reason only tested",
      `<Button disabled={!!action.policyBlockedReason} tooltip={action.policyBlockedReason ? title : hint} />
      {action.policyBlockedReason && <BlockedActionReason action={action} />}
      const first = actions.find((action) => !action.policyBlockedReason)`,
    ],
    ["a long text as a section help", `<SettingsSection help={t("documents.correction.limitation")} />`],
    ["a long text held as help copy", `const copy = { help: t("documents.correction.limitation") }`],
    [
      "a long text as a field description",
      `<FormLabel description={t("documents.correction.limitation")} />`,
    ],
    ["a type declaration", `interface P { sourceText?: string; resolutionNote?: string }`],
    ["warnings joined into a native tooltip", `<Badge title={period.warnings.join(" ")} />`],
    [
      "comments that name the fields",
      `// the backend's own \`data.limitation\` and \`provenance.sourceText\`
      {/* never \`warnings.map(\` or t("documents.correction.limitation") here */}`,
    ],
    ["a warnings count", `{warnings.length > 0 && <Badge>{warnings.length}</Badge>}`],
    ["a short i18n text", `<p>{t("documents.correction.chooseRoute")}</p>`],
  ])("leaves %s alone", (_case, source) => {
    expect(findPermanentProse(source, SAMPLE_KEYS)).toEqual([])
  })

  it("treats an English text of 180 characters or more as prose", () => {
    const keys = longProseKeys({ a: { short: "Save", long: "x".repeat(180) }, b: "y".repeat(179) })
    expect([...keys]).toEqual(["a.long"])
  })

  it("finds no explanatory prose rendered permanently anywhere in the app", () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path)
      return findPermanentProse(readFileSync(path, "utf8"), LONG_KEYS)
        .filter((hit) => !KEPT_VISIBLE.has(`${file}|${hit.text}`))
        .map((hit) => `${file}:${hit.line}: ${hit.text}`)
    })
    expect(
      offenders,
      "Explanatory prose goes behind a `?` (<ProseHelp>, a `help` prop, or a FieldLock for a blocked reason); a warning keeps a one-line status as its title.",
    ).toEqual([])
  })
})
