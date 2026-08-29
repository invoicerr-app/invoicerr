import { AlertTriangle, Loader2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/hooks/use-api-query"
import { usePageHeader } from "@/hooks/use-page-header"
import { useComplianceCountries, useDocumentKinds, useStateMachinePreview } from "@/hooks/queries"
import type {
  ChannelSpec,
  Confidence,
  CorrectionRouteRule,
  PlannedArtifact,
  ResolvedCountryView,
  ResolvedObligation,
  StateMachinePreviewResponse,
} from "@/types"

import { StateMachineGraph } from "./_components/state-machine-graph"

// Fixed engine vocabulary (backend/src/compliance/types.ts `PartyRole` / `SupplyType`) — not a
// country, exactly like `STATUS_OPTIONS`/`CHANNEL_OPTIONS` already hardcoded in
// `pages/(app)/compliance/index.tsx`. No country code is ever hardcoded on this page.
const BUYER_ROLES = ["B2B", "B2C", "B2G"] as const
const SUPPLY_TYPES = ["GOODS", "SERVICES", "DIGITAL", "MIXED"] as const
const UNSPECIFIED_DOCUMENT_KIND = "__unspecified__"

const CONFIDENCE_COLORS: Record<Confidence, string> = {
  OFFICIAL: "text-emerald-700 bg-emerald-50",
  BEST_EFFORT: "text-blue-700 bg-blue-50",
  PLANNED: "text-amber-700 bg-amber-50",
  FALLBACK: "text-red-700 bg-red-50",
  UNVERIFIED: "text-red-700 bg-red-50",
}

const ROUTE_STATUS_COLORS: Record<string, string> = {
  REQUIRED: "text-blue-700 bg-blue-50",
  OPEN: "text-slate-700 bg-slate-100",
  FORBIDDEN: "text-red-700 bg-red-50",
  UNVERIFIED: "text-amber-700 bg-amber-50",
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${CONFIDENCE_COLORS[confidence] ?? "text-slate-500 bg-slate-50"}`}
      data-cy="state-machine-confidence-badge"
    >
      {confidence}
    </span>
  )
}

function CountryResolutionRow({
  label,
  view,
  dataCy,
}: {
  label: string
  view: ResolvedCountryView
  dataCy: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-cy={dataCy}>
      <span className="font-medium">{label}:</span>
      <span>{view.requestedCountryCode}</span>
      {view.resolvedCountryCode !== view.requestedCountryCode && (
        <span className="text-muted-foreground">
          {t("compliance.devStateMachine.confidence.resolvedAs", { country: view.resolvedCountryCode })}
        </span>
      )}
      <ConfidenceBadge confidence={view.confidence} />
      {view.isFallback && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700"
          data-cy={`${dataCy}-fallback-notice`}
        >
          <AlertTriangle className="h-3 w-3" />
          {t("compliance.devStateMachine.confidence.fallbackNotice")}
        </span>
      )}
    </div>
  )
}

function SectionCard({
  title,
  description,
  dataCy,
  children,
}: {
  title: string
  description?: string
  dataCy: string
  children: React.ReactNode
}) {
  return (
    <Card data-cy={dataCy}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  )
}

function ObligationsCard({ obligations }: { obligations: ResolvedObligation[] }) {
  const { t } = useTranslation()
  return (
    <SectionCard title={t("compliance.devStateMachine.obligations.title")} dataCy="state-machine-obligations">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("compliance.devStateMachine.obligations.layer")}</TableHead>
            <TableHead>{t("compliance.devStateMachine.obligations.kind")}</TableHead>
            <TableHead>{t("compliance.devStateMachine.obligations.model")}</TableHead>
            <TableHead>{t("compliance.devStateMachine.obligations.blocking")}</TableHead>
            <TableHead>{t("compliance.devStateMachine.obligations.deadline")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {obligations.map((o, i) => (
            <TableRow
              key={`${o.layer}-${o.kind}-${i}`}
              data-cy={`state-machine-obligation-${o.layer}-${o.kind}`}
            >
              <TableCell>{o.layer}</TableCell>
              <TableCell>{o.kind}</TableCell>
              <TableCell>{o.model ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={o.blocking ? "destructive" : "outline"}>
                  {o.blocking
                    ? t("compliance.devStateMachine.obligations.blockingYes")
                    : t("compliance.devStateMachine.obligations.blockingNo")}
                </Badge>
              </TableCell>
              <TableCell>
                {o.deadline
                  ? `${o.deadline.value} ${o.deadline.unit}`
                  : t("compliance.devStateMachine.obligations.deadlineNotEstablished")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {obligations.some((o) => o.openQuestion) && (
        <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
          {obligations
            .filter((o) => o.openQuestion)
            .map((o, i) => (
              <li key={i}>
                <span className="font-medium">
                  {o.kind}/{o.layer}:
                </span>{" "}
                {o.openQuestion}
              </li>
            ))}
        </ul>
      )}
    </SectionCard>
  )
}

function ChannelsCard({
  channels,
  reportingChannels,
}: {
  channels: ChannelSpec[]
  reportingChannels: ChannelSpec[]
}) {
  const { t } = useTranslation()
  return (
    <SectionCard title={t("compliance.devStateMachine.channels.title")} dataCy="state-machine-channels">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">
          {t("compliance.devStateMachine.channels.invoiceChannels")}
        </p>
        <div className="flex flex-wrap gap-2" data-cy="state-machine-invoice-channels">
          {channels.map((c, i) => (
            <Badge key={i} variant="secondary">
              {c.type}
              {c.providerId ? ` (${c.providerId})` : ""}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">
          {t("compliance.devStateMachine.channels.reportingChannels")}
        </p>
        <div className="flex flex-wrap gap-2" data-cy="state-machine-reporting-channels">
          {reportingChannels.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {t("compliance.devStateMachine.channels.reportingChannelsNone")}
            </span>
          ) : (
            reportingChannels.map((c, i) => (
              <Badge key={i} variant="secondary">
                {c.type}
                {c.providerId ? ` (${c.providerId})` : ""}
              </Badge>
            ))
          )}
        </div>
      </div>
    </SectionCard>
  )
}

function ArtifactsCard({ artifacts }: { artifacts: PlannedArtifact[] }) {
  const { t } = useTranslation()
  return (
    <SectionCard title={t("compliance.devStateMachine.artifacts.title")} dataCy="state-machine-artifacts">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("compliance.devStateMachine.artifacts.role")}</TableHead>
            <TableHead>{t("compliance.devStateMachine.artifacts.syntax")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {artifacts.map((a, i) => (
            <TableRow key={i} data-cy={`state-machine-artifact-${a.role}`}>
              <TableCell>{a.role}</TableCell>
              <TableCell>
                {a.syntax}
                {a.version ? ` v${a.version}` : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SectionCard>
  )
}

function CorrectionRoutesTable({ routes }: { routes: CorrectionRouteRule[] | undefined }) {
  const { t } = useTranslation()
  if (!routes || routes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("compliance.devStateMachine.lifecycle.noRoutesSourced")}
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("compliance.devStateMachine.lifecycle.route")}</TableHead>
          <TableHead>{t("compliance.devStateMachine.lifecycle.status")}</TableHead>
          <TableHead>{t("compliance.devStateMachine.lifecycle.direction")}</TableHead>
          <TableHead>{t("compliance.devStateMachine.lifecycle.transmission")}</TableHead>
          <TableHead>{t("compliance.devStateMachine.lifecycle.appliesTo")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((r, i) => (
          <TableRow key={`${r.route}-${i}`} data-cy={`state-machine-correction-route-${r.route}`}>
            <TableCell>{r.route}</TableCell>
            <TableCell>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${ROUTE_STATUS_COLORS[r.status] ?? "text-slate-500 bg-slate-50"}`}
              >
                {r.status}
              </span>
            </TableCell>
            <TableCell>{r.direction ?? "—"}</TableCell>
            <TableCell>{r.transmission ?? "—"}</TableCell>
            <TableCell className="max-w-xs text-xs text-muted-foreground">{r.appliesTo ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function StateMachineResult({ preview }: { preview: StateMachinePreviewResponse }) {
  const { t } = useTranslation()
  const { plan, graph } = preview

  return (
    <div className="space-y-6" data-cy="state-machine-result">
      <Alert
        variant={
          plan.confidence === "FALLBACK" || plan.confidence === "UNVERIFIED" ? "destructive" : "default"
        }
        data-cy="state-machine-confidence-alert"
      >
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="flex items-center gap-2">
          {t("compliance.devStateMachine.confidence.title")}: <ConfidenceBadge confidence={plan.confidence} />
        </AlertTitle>
        <AlertDescription className="space-y-2 mt-2">
          <CountryResolutionRow
            label={t("compliance.devStateMachine.confidence.supplierProfile")}
            view={preview.supplier}
            dataCy="state-machine-supplier-resolution"
          />
          <CountryResolutionRow
            label={t("compliance.devStateMachine.confidence.buyerProfile")}
            view={preview.buyer}
            dataCy="state-machine-buyer-resolution"
          />
        </AlertDescription>
      </Alert>

      {plan.warnings.length > 0 && (
        <Alert variant="destructive" data-cy="state-machine-warnings">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("compliance.devStateMachine.warnings.title")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-1">
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title={t("compliance.devStateMachine.classification.title")}
          dataCy="state-machine-classification"
        >
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.classification.crossBorder")}:</span>{" "}
            {plan.classification.crossBorder
              ? t("compliance.devStateMachine.classification.crossBorderYes")
              : t("compliance.devStateMachine.classification.domestic")}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.classification.buyerRole")}:</span>{" "}
            {plan.classification.buyerRole}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.classification.supplyTypes")}:</span>{" "}
            {plan.classification.supplyTypes.join(", ")}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.lifecycle.immutableAfter")}:</span>{" "}
            <Badge variant="outline">{plan.lifecycle.immutableAfter}</Badge>
          </p>
        </SectionCard>

        <SectionCard
          title={t("compliance.devStateMachine.taxSystem.title")}
          dataCy="state-machine-tax-system"
        >
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.taxSystem.kind")}:</span>{" "}
            {plan.taxSystemKind}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.taxSystem.buyerSelfAssess")}:</span>{" "}
            <Badge variant={plan.tax.buyerSelfAssess ? "destructive" : "outline"}>
              {String(plan.tax.buyerSelfAssess)}
            </Badge>
          </p>
          {plan.tax.lines[0] && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("compliance.devStateMachine.taxSystem.category")}</TableHead>
                  <TableHead>{t("compliance.devStateMachine.taxSystem.rate")}</TableHead>
                  <TableHead>{t("compliance.devStateMachine.taxSystem.jurisdiction")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.tax.lines[0].treatment.components.map((c, i) => (
                  <TableRow key={i} data-cy={`state-machine-tax-component-${c.category}`}>
                    <TableCell>{c.category}</TableCell>
                    <TableCell>{c.rate}%</TableCell>
                    <TableCell>{c.jurisdiction}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {plan.tax.mentions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {t("compliance.devStateMachine.taxSystem.mentions")}
              </p>
              <ul className="text-xs list-disc pl-4 space-y-1">
                {plan.tax.mentions.map((m) => (
                  <li key={m.code}>{m.text}</li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>

        <ObligationsCard obligations={plan.obligations} />
        <ChannelsCard channels={plan.channels} reportingChannels={plan.reportingChannels} />
        <ArtifactsCard artifacts={plan.artifacts} />

        <SectionCard title={t("compliance.devStateMachine.lifecycle.title")} dataCy="state-machine-lifecycle">
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.lifecycle.correctionModel")}:</span>{" "}
            {plan.lifecycle.correctionModel}
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t("compliance.devStateMachine.lifecycle.cancellation")}:</span>
            <Badge variant={plan.lifecycle.cancellation.allowed ? "outline" : "destructive"}>
              {plan.lifecycle.cancellation.allowed
                ? t("compliance.devStateMachine.lifecycle.cancellationAllowed")
                : t("compliance.devStateMachine.lifecycle.cancellationForbidden")}
            </Badge>
            {plan.lifecycle.cancellation.requiresAuthorityAck && (
              <Badge variant="secondary">
                {t("compliance.devStateMachine.lifecycle.requiresAuthorityAck")}
              </Badge>
            )}
            {plan.lifecycle.cancellation.requiresBuyerConsent && (
              <Badge variant="secondary">
                {t("compliance.devStateMachine.lifecycle.requiresBuyerConsent")}
              </Badge>
            )}
          </p>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {t("compliance.devStateMachine.lifecycle.correctionRoutes")}
            </p>
            <CorrectionRoutesTable routes={plan.lifecycle.correctionRoutes} />
          </div>
        </SectionCard>

        <SectionCard title={t("compliance.devStateMachine.numbering.title")} dataCy="state-machine-numbering">
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.numbering.model")}:</span>{" "}
            {plan.numbering.model}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.numbering.hashChain")}:</span>{" "}
            {String(!!plan.numbering.hashChain)}
          </p>
          {plan.numbering.seriesScope && (
            <p>
              <span className="font-medium">{t("compliance.devStateMachine.numbering.seriesScope")}:</span>{" "}
              {plan.numbering.seriesScope}
            </p>
          )}
        </SectionCard>

        <SectionCard title={t("compliance.devStateMachine.archival.title")} dataCy="state-machine-archival">
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.archival.retentionYears")}:</span>{" "}
            {plan.archival.retentionYears}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.archival.archivedForm")}:</span>{" "}
            {plan.archival.archivedForm}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.archival.integrity")}:</span>{" "}
            {plan.archival.integrity}
          </p>
          <p>
            <span className="font-medium">{t("compliance.devStateMachine.archival.residency")}:</span>{" "}
            {plan.archival.residency ?? t("compliance.devStateMachine.archival.anywhere")}
          </p>
        </SectionCard>

        <SectionCard title={t("compliance.devStateMachine.reporting.title")} dataCy="state-machine-reporting">
          {plan.reporting.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("compliance.devStateMachine.reporting.none")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {plan.reporting.map((r) => (
                <Badge key={r} variant="secondary">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <Card data-cy="state-machine-graph-section">
        <CardHeader>
          <CardTitle className="text-base">{t("compliance.devStateMachine.graph.title")}</CardTitle>
          <CardDescription>
            {t("compliance.devStateMachine.graph.initialState")}: <strong>{graph.initial}</strong> —{" "}
            {graph.states.length} {t("compliance.devStateMachine.graph.statesLabel")},{" "}
            {graph.transitions.length} {t("compliance.devStateMachine.graph.transitionsLabel")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <StateMachineGraph graph={graph} />

          <div className="overflow-x-auto">
            <Table data-cy="state-machine-transitions-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("compliance.devStateMachine.graph.on")}</TableHead>
                  <TableHead>{t("compliance.devStateMachine.graph.from")}</TableHead>
                  <TableHead>{t("compliance.devStateMachine.graph.to")}</TableHead>
                  <TableHead>{t("compliance.devStateMachine.graph.trigger")}</TableHead>
                  <TableHead>{t("compliance.devStateMachine.graph.guardKey")}</TableHead>
                  <TableHead>{t("compliance.devStateMachine.graph.description")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {graph.transitions.map((tr, i) => (
                  <TableRow
                    key={`${tr.on}-${tr.from}-${tr.to}-${i}`}
                    data-cy={`state-machine-transition-row-${tr.on}-${tr.from}-${tr.to}`}
                  >
                    <TableCell className="font-medium">{tr.on}</TableCell>
                    <TableCell>{tr.from}</TableCell>
                    <TableCell>{tr.to}</TableCell>
                    <TableCell>{tr.trigger.kind}</TableCell>
                    <TableCell>{tr.guardKey ?? "—"}</TableCell>
                    <TableCell className="max-w-sm text-xs text-muted-foreground">
                      {tr.description ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function StateMachinePage() {
  const { t } = useTranslation()
  usePageHeader(t("compliance.devStateMachine.title"))

  const [supplierCountry, setSupplierCountry] = useState("FR")
  const [buyerCountry, setBuyerCountry] = useState("FR")
  const [buyerRole, setBuyerRole] = useState<(typeof BUYER_ROLES)[number]>("B2B")
  const [supplyType, setSupplyType] = useState<(typeof SUPPLY_TYPES)[number]>("SERVICES")
  const [documentKind, setDocumentKind] = useState("")
  const [issueDate, setIssueDate] = useState(() => format(new Date(), "yyyy-MM-dd"))

  const { data: countriesData } = useComplianceCountries()
  const countries = countriesData?.countries ?? []

  const { data: documentKinds } = useDocumentKinds(supplierCountry, issueDate)

  const {
    data: preview,
    isLoading,
    isError,
    error,
  } = useStateMachinePreview({
    supplierCountry,
    buyerCountry,
    buyerRole,
    documentKind: documentKind || undefined,
    issueDate,
    supplyType,
  })

  return (
    <div className="p-6 space-y-6" data-cy="state-machine-page">
      <p className="text-muted-foreground text-sm max-w-3xl">{t("compliance.devStateMachine.description")}</p>

      <Card data-cy="state-machine-controls">
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="state-machine-supplier-country">
              {t("compliance.devStateMachine.controls.supplierCountry")}
            </Label>
            <Input
              id="state-machine-supplier-country"
              data-cy="state-machine-supplier-country"
              list="state-machine-known-countries"
              value={supplierCountry}
              onChange={(e) => setSupplierCountry(e.target.value.toUpperCase())}
              placeholder={t("compliance.devStateMachine.controls.countryPlaceholder")}
              maxLength={8}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="state-machine-buyer-country">
              {t("compliance.devStateMachine.controls.buyerCountry")}
            </Label>
            <Input
              id="state-machine-buyer-country"
              data-cy="state-machine-buyer-country"
              list="state-machine-known-countries"
              value={buyerCountry}
              onChange={(e) => setBuyerCountry(e.target.value.toUpperCase())}
              placeholder={t("compliance.devStateMachine.controls.countryPlaceholder")}
              maxLength={8}
            />
          </div>

          <datalist id="state-machine-known-countries">
            {countries.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="space-y-1.5">
            <Label htmlFor="state-machine-buyer-role">
              {t("compliance.devStateMachine.controls.buyerRole")}
            </Label>
            <Select value={buyerRole} onValueChange={(v) => setBuyerRole(v as (typeof BUYER_ROLES)[number])}>
              <SelectTrigger id="state-machine-buyer-role" data-cy="state-machine-buyer-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUYER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`compliance.devStateMachine.partyRoles.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="state-machine-supply-type">
              {t("compliance.devStateMachine.controls.supplyType")}
            </Label>
            <Select
              value={supplyType}
              onValueChange={(v) => setSupplyType(v as (typeof SUPPLY_TYPES)[number])}
            >
              <SelectTrigger id="state-machine-supply-type" data-cy="state-machine-supply-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPLY_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`compliance.devStateMachine.supplyTypes.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="state-machine-document-kind">
              {t("compliance.devStateMachine.controls.documentKind")}
            </Label>
            <Select
              value={documentKind || UNSPECIFIED_DOCUMENT_KIND}
              onValueChange={(v) => setDocumentKind(v === UNSPECIFIED_DOCUMENT_KIND ? "" : v)}
            >
              <SelectTrigger id="state-machine-document-kind" data-cy="state-machine-document-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSPECIFIED_DOCUMENT_KIND}>
                  {t("compliance.devStateMachine.controls.documentKindUnspecified")}
                </SelectItem>
                {(documentKinds ?? []).map((k) => (
                  <SelectItem key={k.kind} value={k.kind}>
                    {k.kind} ({k.availability})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="state-machine-issue-date">
              {t("compliance.devStateMachine.controls.issueDate")}
            </Label>
            <Input
              id="state-machine-issue-date"
              data-cy="state-machine-issue-date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-16" data-cy="state-machine-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <Alert variant="destructive" data-cy="state-machine-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("compliance.devStateMachine.errorState")}</AlertTitle>
          <AlertDescription>{error instanceof ApiError ? error.message : String(error)}</AlertDescription>
        </Alert>
      )}

      {preview && <StateMachineResult preview={preview} />}
    </div>
  )
}
