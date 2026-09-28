"use client"

import { AlertTriangle, CheckCircle2, Info, Radio, Search } from "lucide-react"
import type { TFunction } from "i18next"
import { type ReactNode, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import {
  type CredentialFieldDescriptor,
  type DocumentOperator,
  type DocumentOperatorOffering,
  useDocumentOperators,
  useDocumentTransports,
} from "@/hooks/queries"
import { apiFetch } from "@/hooks/use-api-query"
import { useGet } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"
import { ChannelConnectSheet } from "./channels.connect-sheet"
import {
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsPage,
  SettingsRowMenu,
  SettingsSection,
} from "./settings-section"

type ChannelEnvironment = "TEST" | "PROD"
type ChannelRequirement = "suggested" | "mandated"

interface ChannelProvenance {
  kind: "legal" | "unverified"
  resolutionNote?: string
  sourceText?: string
  sourceCheckedAt?: string
}

interface ConfiguredChannel {
  providerId: string
  channel: string
  environment: ChannelEnvironment
  isActive: boolean
  operatorId?: string | null
  /** Issue #527 - this ACTIVE row would be refused by the send preflight for a domestic operation,
   *  right now - see `channels.service.ts#ChannelConfigStatus.blockedBySend`'s own backend header. */
  blockedBySend?: boolean
}

interface SuggestedChannel {
  providerId: string
  requirement?: ChannelRequirement
  mandatedFrom?: string
  effectiveNow?: boolean
  equivalentProviderIds?: string[]
  provenance: ChannelProvenance
}

interface ReportingObligation {
  providerId: string
  appliesTo: "invoice" | "credit-note"
  provenance: ChannelProvenance
}

/** Mirrors the backend's `LegalChannelStatus` (`channels.service.ts`) - see that interface's own
 *  header for what each field means and how it is computed. This is the settings screen's LEVEL-1
 *  nav, design C ("legal channel, then operator"). */
interface LegalChannelStatus {
  id: string
  requirement?: ChannelRequirement
  mandatedFrom?: string
  effectiveNow?: boolean
  equivalentProviderIds?: string[]
  provenance?: ChannelProvenance
  automatic: boolean
  lawful: boolean
  mandatedElsewhere: { countryCode: string; requirement: ChannelRequirement }[]
}

/** Mirrors the backend's `ChannelPolicyBanner` - design A's obligation banner, folded onto design C. */
interface ChannelPolicyBanner {
  countryCode?: string
  tone: "mandated" | "suggested" | "none"
  legalChannelId?: string
  mandatedFrom?: string
  effectiveNow?: boolean
  provenance?: ChannelProvenance
}

interface ChannelsResponse {
  configured: ConfiguredChannel[]
  suggested: SuggestedChannel[]
  reportingObligations: ReportingObligation[]
  legalChannels: LegalChannelStatus[]
  banner: ChannelPolicyBanner
}

/** Display label DEFAULTS for a legal channel id (`documents/operators/schema.ts#OperatorOffering.
 *  legalChannel`) - every string still goes through `t()` (issue #527's own instruction), this is
 *  only the English fallback + translation key stem. A channel this map has no opinion about (a
 *  future legal channel the operator catalogue grows) falls back to its bare, upper-cased id, exactly
 *  like the old `PROVIDER_LABELS` this replaces. */
const LEGAL_CHANNEL_LABEL_DEFAULTS: Record<string, string> = {
  pdp: "Accredited platform (PDP)",
  sdi: "Sistema di Interscambio (SdI)",
  ksef: "KSeF",
  "chorus-pro": "Chorus Pro",
  peppol: "Peppol",
}

const DECLARATION_LABEL_DEFAULTS: Record<string, string> = {
  "pt-at": "Portuguese Tax Authority (AT)",
}

function legalChannelLabel(t: TFunction, id: string): string {
  return t(`settings.channels.legal.${id}.label`, LEGAL_CHANNEL_LABEL_DEFAULTS[id] ?? id.toUpperCase())
}

/** A human-readable country name from an ISO 3166-1 alpha-2 code, in the reader's own language -
 *  same `Intl.DisplayNames` convention `lib/apply-address-suggestion.ts` already uses; never a legal
 *  fact, purely a display nicety over a code the backend already resolved. */
function countryName(language: string, code?: string): string {
  if (!code) return ""
  try {
    return new Intl.DisplayNames([language, "en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

/** One (operator, offering) pair for a given legal channel - the level-2 row. */
interface OperatorChannelRow {
  operator: DocumentOperator
  offering: DocumentOperatorOffering
}

/**
 * Company settings → Channels (`/settings/channels`) - design C ("legal channel, then operator"),
 * with design A's obligation banner on top (issue #527). Two levels: LEVEL 1 is the small, closed set
 * of legal channels (`legalChannels`, computed server-side); LEVEL 2 is the operators implementing the
 * selected one (`GET /api/documents/operators`, issue #526's own catalogue). Every lawfulness verdict
 * - is this channel this company's own, is a connected one now refused - comes from the backend
 * (`GET /api/company/channels`'s own `legalChannels`/`banner`/`blockedBySend`), never recomputed here.
 *
 * `PROVIDER_FIELDS` (the old hard-coded per-provider credential-field map) is GONE: the connect side
 * sheet (`channels.connect-sheet.tsx`) is built entirely from `GET /api/documents/transports`'s own
 * `credentialFields` (issue #526).
 */
export default function ChannelsSettings() {
  const { t, i18n } = useTranslation()
  const {
    data: channels,
    loading: channelsLoading,
    mutate,
  } = useGet<ChannelsResponse>("/api/company/channels")
  const { data: transports, isLoading: transportsLoading } = useDocumentTransports()
  const { data: operators, isLoading: operatorsLoading } = useDocumentOperators()

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [sheetProviderId, setSheetProviderId] = useState<string | null>(null)

  const legalChannels = channels?.legalChannels ?? []
  const configured = channels?.configured ?? []
  const reportingObligations = channels?.reportingObligations ?? []
  const banner = channels?.banner

  const transportById = useMemo(
    () => new Map((transports ?? []).map((tr) => [tr.id, tr] as const)),
    [transports],
  )
  const configuredByProvider = useMemo(
    () => new Map(configured.map((c) => [c.providerId, c] as const)),
    [configured],
  )

  // Level-2 data: every (operator, offering) pair with a genuine DELIVERY capability, grouped by
  // legal channel - the same `capabilities.emit` filter the backend's own `legalChannels()` uses to
  // discover the level-1 set (see that method's own header), applied here client-side over the SAME
  // reference-data response so switching the level-1 tab needs no extra request.
  const rowsByChannel = useMemo(() => {
    const map = new Map<string, OperatorChannelRow[]>()
    for (const operator of operators ?? []) {
      for (const offering of operator.offerings) {
        if (!offering.capabilities.emit) continue
        const list = map.get(offering.legalChannel) ?? []
        list.push({ operator, offering })
        map.set(offering.legalChannel, list)
      }
    }
    return map
  }, [operators])

  // Which legal channel a CONNECTED provider id belongs to - lets a channel that is not the
  // company's own still show "you have A-Cube connected here, and it is refused" (state 4 of #527).
  const legalChannelByTransportId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [legalChannel, rows] of rowsByChannel) {
      for (const row of rows) {
        if (row.offering.transportId) map.set(row.offering.transportId, legalChannel)
      }
    }
    return map
  }, [rowsByChannel])

  const loading = channelsLoading || transportsLoading || operatorsLoading

  if (loading) {
    return (
      <SettingsPage
        title={t("settings.channels.title", "Channels")}
        description={t(
          "settings.channels.description",
          "Connect a national transmission channel — once connected, choose it below as this company's invoice transport.",
        )}
        dataCy="channels-section"
      >
        <SettingsListSkeleton rows={3} />
      </SettingsPage>
    )
  }

  // Default selection: this company's own lawful channel first (design C's "no channel chosen: the
  // country's legal channel is preselected and open"), falling back to the first channel of the
  // closed set for a country with no channel of its own (DE/PT) - never an empty screen.
  const defaultChannelId = legalChannels.find((c) => c.lawful)?.id ?? legalChannels[0]?.id ?? null
  const activeChannelId = selectedChannelId ?? defaultChannelId
  const activeChannel = legalChannels.find((c) => c.id === activeChannelId) ?? null

  const activeRows = activeChannelId ? (rowsByChannel.get(activeChannelId) ?? []) : []
  // The connected operator(s) surface first - design C's own "the connected operator is first in its
  // list".
  const sortedRows = [...activeRows].sort((a, b) => {
    const aConnected = a.offering.transportId
      ? configuredByProvider.get(a.offering.transportId)?.isActive
      : false
    const bConnected = b.offering.transportId
      ? configuredByProvider.get(b.offering.transportId)?.isActive
      : false
    if (aConnected === bConnected) return 0
    return aConnected ? -1 : 1
  })
  const filteredRows = search.trim()
    ? sortedRows.filter((row) => row.operator.name.toLowerCase().includes(search.trim().toLowerCase()))
    : sortedRows

  // State 4 - a previously configured channel the send preflight now refuses: ANY active,
  // blocked-by-send row whose provider belongs to the channel currently being viewed.
  const blockedRow = configured.find(
    (c) => c.isActive && c.blockedBySend && legalChannelByTransportId.get(c.providerId) === activeChannelId,
  )
  const blockedOperator = blockedRow
    ? sortedRows.find((row) => row.offering.transportId === blockedRow.providerId)?.operator
    : undefined

  // A plain async function, never a hook - the providerId being disconnected varies per row/action
  // (the blocked-channel alert, or any operator row's own "Disconnect" menu item), so this cannot be
  // a `useDelete("/api/company/channels/<fixed-id>")` call bound once at the top of this component
  // (that would violate the rules of hooks the moment the target id differs between call sites).
  const handleDisconnect = async (providerId: string) => {
    try {
      await apiFetch(`/api/company/channels/${providerId}`, { method: "DELETE" })
    } catch {
      toast.error(t("settings.channels.messages.disconnectError", "Failed to disconnect the channel"))
      return
    }
    toast.success(t("settings.channels.messages.disconnectSuccess", "Channel disconnected"))
    mutate()
  }

  return (
    <SettingsPage
      title={t("settings.channels.title", "Channels")}
      description={t(
        "settings.channels.description",
        "Connect a national transmission channel — once connected, choose it below as this company's invoice transport.",
      )}
      dataCy="channels-section"
    >
      <ChannelBanner banner={banner} t={t} language={i18n.language} />

      {legalChannels.length === 0 ? (
        <EmptyState
          icon={Radio}
          title={t("settings.channels.emptyState", "No national channel available yet")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <nav
            role="tablist"
            aria-label={t("settings.channels.legal.navLabel", "Legal channels")}
            className="flex flex-col gap-2"
            data-cy="channels-legal-nav"
          >
            {legalChannels.map((channel) => {
              const isSelected = channel.id === activeChannelId
              const hasConnected = [...configuredByProvider.values()].some(
                (c) =>
                  c.isActive &&
                  legalChannelByTransportId.get(c.providerId) === channel.id &&
                  !c.blockedBySend,
              )
              const hasBlocked = [...configuredByProvider.values()].some(
                (c) =>
                  c.isActive && c.blockedBySend && legalChannelByTransportId.get(c.providerId) === channel.id,
              )
              return (
                <button
                  key={channel.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-cy={`channel-nav-${channel.id}`}
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors",
                    isSelected ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2 font-heading text-sm font-semibold">
                    <span className="flex items-center gap-1.5">
                      {hasConnected && (
                        <CheckCircle2
                          className="size-3.5 shrink-0 text-success-foreground"
                          aria-hidden="true"
                          data-cy={`channel-nav-${channel.id}-connected-mark`}
                        />
                      )}
                      {legalChannelLabel(t, channel.id)}
                    </span>
                  </span>
                  <ChannelNavBadge channel={channel} hasBlocked={hasBlocked} t={t} />
                </button>
              )
            })}
          </nav>

          {activeChannel && (
            <ChannelDetail
              channel={activeChannel}
              rows={filteredRows}
              search={search}
              onSearchChange={setSearch}
              configuredByProvider={configuredByProvider}
              transportById={transportById}
              blockedRow={blockedRow}
              blockedOperatorName={blockedOperator?.name}
              onDisconnect={handleDisconnect}
              onConnect={(providerId) => setSheetProviderId(providerId)}
              t={t}
              language={i18n.language}
            />
          )}
        </div>
      )}

      {reportingObligations.length > 0 && <DeclarationsSection obligations={reportingObligations} t={t} />}

      {sheetProviderId &&
        (() => {
          const row = activeRows.find((r) => r.offering.transportId === sheetProviderId)
          const transport = transportById.get(sheetProviderId)
          const fields: CredentialFieldDescriptor[] = transport?.credentialFields ?? []
          const existing = configuredByProvider.get(sheetProviderId)
          return (
            <ChannelConnectSheet
              key={sheetProviderId}
              open
              onOpenChange={(open) => {
                if (!open) setSheetProviderId(null)
              }}
              providerId={sheetProviderId}
              title={t("settings.channels.sheet.title", "Connect {{operator}}", {
                operator: row?.operator.name ?? sheetProviderId,
              })}
              description={
                activeChannel
                  ? t("settings.channels.sheet.description", "Legal channel: {{channel}}", {
                      channel: legalChannelLabel(t, activeChannel.id),
                    })
                  : undefined
              }
              credentialFields={fields}
              defaultEnvironment={existing?.environment}
              onConnected={() => {
                setSheetProviderId(null)
                mutate()
              }}
            />
          )
        })()}
    </SettingsPage>
  )
}

function ChannelNavBadge({
  channel,
  hasBlocked,
  t,
}: {
  channel: LegalChannelStatus
  hasBlocked: boolean
  t: TFunction
}) {
  if (hasBlocked) {
    return (
      <Badge variant="destructive" data-cy={`channel-nav-${channel.id}-badge`}>
        {t("settings.channels.legal.badge.blocked", "No longer accepted")}
      </Badge>
    )
  }
  if (channel.requirement === "mandated") {
    return (
      <Badge variant="destructive" data-cy={`channel-nav-${channel.id}-badge`}>
        {t("settings.channels.legal.badge.mandated", "Mandatory from {{date}}", {
          date: channel.mandatedFrom,
        })}
      </Badge>
    )
  }
  if (channel.requirement === "suggested") {
    return (
      <Badge variant="warning" data-cy={`channel-nav-${channel.id}-badge`}>
        {t("settings.channels.legal.badge.suggested", "Recommended for your country")}
      </Badge>
    )
  }
  if (channel.automatic) {
    return (
      <Badge variant="info" data-cy={`channel-nav-${channel.id}-badge`}>
        {t("settings.channels.legal.badge.automatic", "Automatic")}
      </Badge>
    )
  }
  if (!channel.lawful) {
    return (
      <Badge variant="outline" data-cy={`channel-nav-${channel.id}-badge`}>
        {t("settings.channels.legal.badge.outside", "Outside your invoicing country")}
      </Badge>
    )
  }
  return null
}

function ChannelBanner({
  banner,
  t,
  language,
}: {
  banner?: ChannelPolicyBanner
  t: TFunction
  language: string
}) {
  if (!banner) return null
  const country = countryName(language, banner.countryCode)

  if (banner.tone === "mandated") {
    return (
      <Alert variant="destructive" data-cy="channels-banner">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>
          {t(
            "settings.channels.banner.mandatedTitle",
            "Your invoices from {{country}} must go through {{channel}}",
            {
              country,
              channel: legalChannelLabel(t, banner.legalChannelId ?? ""),
            },
          )}
        </AlertTitle>
        <AlertDescription>
          {t("settings.channels.banner.mandatedBody", "Mandatory since {{date}}. {{source}}", {
            date: banner.mandatedFrom,
            source:
              banner.provenance?.kind === "legal"
                ? banner.provenance.sourceText
                : (banner.provenance?.resolutionNote ?? ""),
          })}
        </AlertDescription>
      </Alert>
    )
  }

  if (banner.tone === "suggested") {
    return (
      <Alert data-cy="channels-banner">
        <Info aria-hidden="true" />
        <AlertTitle>
          {t("settings.channels.banner.suggestedTitle", "{{country}} recommends {{channel}}", {
            country,
            channel: legalChannelLabel(t, banner.legalChannelId ?? ""),
          })}
        </AlertTitle>
        <AlertDescription>
          {t(
            "settings.channels.banner.suggestedBody",
            "Not yet a legal obligation for your country - connecting it is optional.",
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert data-cy="channels-banner">
      <Info aria-hidden="true" />
      <AlertTitle>
        {t("settings.channels.banner.noneTitle", "No transmission channel is imposed on {{country}}", {
          country,
        })}
      </AlertTitle>
      <AlertDescription>
        {t(
          "settings.channels.banner.noneBody",
          "Any lawful transport, including email, may be used to send your invoices.",
        )}
      </AlertDescription>
    </Alert>
  )
}

function DeclarationsSection({ obligations, t }: { obligations: ReportingObligation[]; t: TFunction }) {
  const byProvider = new Map<string, ReportingObligation>()
  for (const obligation of obligations) {
    if (!byProvider.has(obligation.providerId)) byProvider.set(obligation.providerId, obligation)
  }
  return (
    <SettingsSection
      title={t("settings.channels.declarations.title", "Declarations")}
      description={t(
        "settings.channels.declarations.description",
        "Not a delivery channel: your invoice still leaves by whatever transport you chose. This is a separate, post-issuance duty to declare invoice data to a tax authority.",
      )}
      dataCy="channels-declarations"
    >
      <SettingsList>
        {[...byProvider.values()].map((obligation) => (
          <SettingsListRow
            key={obligation.providerId}
            dataCy={`declaration-${obligation.providerId}`}
            badge={
              <Badge variant="outline">
                {t("settings.channels.status.declarative", "Declaration (not a delivery channel)")}
              </Badge>
            }
            title={t(
              `settings.channels.declarations.${obligation.providerId}.label`,
              DECLARATION_LABEL_DEFAULTS[obligation.providerId] ?? obligation.providerId.toUpperCase(),
            )}
            meta={
              obligation.provenance.kind === "legal"
                ? obligation.provenance.sourceText
                : obligation.provenance.resolutionNote
            }
          />
        ))}
      </SettingsList>
    </SettingsSection>
  )
}

function ChannelDetail({
  channel,
  rows,
  search,
  onSearchChange,
  configuredByProvider,
  transportById,
  blockedRow,
  blockedOperatorName,
  onDisconnect,
  onConnect,
  t,
  language,
}: {
  channel: LegalChannelStatus
  rows: OperatorChannelRow[]
  search: string
  onSearchChange: (value: string) => void
  configuredByProvider: Map<string, ConfiguredChannel>
  transportById: Map<string, { credentialFields: CredentialFieldDescriptor[] }>
  blockedRow?: ConfiguredChannel
  blockedOperatorName?: string
  onDisconnect: (providerId: string) => void
  onConnect: (providerId: string) => void
  t: TFunction
  language: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        title={legalChannelLabel(t, channel.id)}
        aside={<ChannelNavBadge channel={channel} hasBlocked={!!blockedRow} t={t} />}
        dataCy={`channel-detail-${channel.id}`}
      >
        {!channel.lawful && (
          <Alert data-cy={`channel-detail-${channel.id}-outside`}>
            <Info aria-hidden="true" />
            <AlertTitle>{t("settings.channels.outside.title", "Outside your invoicing country")}</AlertTitle>
            <AlertDescription className="gap-2">
              <p>
                {channel.mandatedElsewhere.length > 0
                  ? t(
                      "settings.channels.outside.elsewhere",
                      "This channel is required or recommended in {{countries}}, not in your own invoicing country.",
                      {
                        countries: channel.mandatedElsewhere
                          .map((m) => countryName(language, m.countryCode))
                          .join(", "),
                      },
                    )
                  : t(
                      "settings.channels.outside.generic",
                      "This channel is not part of your own invoicing country's rules.",
                    )}
              </p>
              <p>
                {t(
                  "settings.channels.outside.body",
                  "A national e-invoicing mandate binds domestic operations only. When you invoice a foreign buyer, the invoice may travel by any channel you and the buyer agree on (email, PDF, Peppol...) - what changes is which authority you must report the transaction to under your own country's rules, never a foreign platform.",
                )}
              </p>
            </AlertDescription>
          </Alert>
        )}
      </SettingsSection>

      {blockedRow && (
        <Alert variant="destructive" data-cy={`channel-detail-${channel.id}-blocked`}>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>
            {t("settings.channels.blocked.title", "{{operator}} no longer sends anything", {
              operator: blockedOperatorName ?? blockedRow.providerId,
            })}
          </AlertTitle>
          <AlertDescription className="gap-2">
            <p>
              {t(
                "settings.channels.blocked.body",
                "This channel was connected before your country's current mandate took effect. It is refused at send time. You may disconnect it safely - invoices already sent stay archived.",
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDisconnect(blockedRow.providerId)}
              data-cy={`channel-detail-${channel.id}-blocked-disconnect`}
            >
              {t("settings.channels.blocked.disconnect", "Disconnect {{operator}}", {
                operator: blockedOperatorName ?? blockedRow.providerId,
              })}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("settings.channels.search.placeholder", "Search an operator by name")}
          className="pl-9"
          data-cy={`channel-detail-${channel.id}-search`}
        />
      </div>

      <SettingsList dataCy={`channel-detail-${channel.id}-operators`}>
        {rows.map((row) => (
          <OperatorRow
            key={row.operator.id}
            row={row}
            channel={channel}
            configured={
              row.offering.transportId ? configuredByProvider.get(row.offering.transportId) : undefined
            }
            hasCredentialFields={
              !!row.offering.transportId &&
              (transportById.get(row.offering.transportId)?.credentialFields.length ?? 0) > 0
            }
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            t={t}
          />
        ))}
        {rows.length === 0 && (
          <div className="p-4">
            <EmptyState
              size="sm"
              icon={Search}
              title={t("settings.channels.search.empty", "No operator matches your search")}
            />
          </div>
        )}
      </SettingsList>
    </div>
  )
}

function OperatorRow({
  row,
  channel,
  configured,
  hasCredentialFields,
  onConnect,
  onDisconnect,
  t,
}: {
  row: OperatorChannelRow
  channel: LegalChannelStatus
  configured?: ConfiguredChannel
  hasCredentialFields: boolean
  onConnect: (providerId: string) => void
  onDisconnect: (providerId: string) => void
  t: TFunction
}) {
  const { operator, offering } = row
  const isConnected = !!configured?.isActive
  const providerId = offering.transportId

  let primary: ReactNode
  if (isConnected && configured) {
    primary = (
      <Button
        variant="outline"
        size="sm"
        onClick={() => providerId && onConnect(providerId)}
        data-cy={`operator-${operator.id}-manage-button`}
      >
        {t("settings.channels.operator.manage", "Manage")}
      </Button>
    )
  } else if (!providerId || !hasCredentialFields) {
    primary = (
      <Button variant="outline" size="sm" disabled data-cy={`operator-${operator.id}-connect-button`}>
        {t("settings.channels.operator.notIntegrated", "Not yet available")}
      </Button>
    )
  } else if (!channel.lawful) {
    primary = (
      <Button
        variant="outline"
        size="sm"
        disabled
        title={t("settings.channels.legal.badge.outside", "Outside your invoicing country")}
        data-cy={`operator-${operator.id}-connect-button`}
      >
        {t("settings.channels.legal.badge.outside", "Outside your invoicing country")}
      </Button>
    )
  } else {
    primary = (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onConnect(providerId)}
        data-cy={`operator-${operator.id}-connect-button`}
      >
        {t("settings.channels.actions.connect", "Connect")}
      </Button>
    )
  }

  const badge = isConnected ? (
    configured?.blockedBySend ? (
      <Badge variant="destructive">{t("settings.channels.legal.badge.blocked", "No longer accepted")}</Badge>
    ) : (
      <Badge variant="success" data-cy={`operator-${operator.id}-status`}>
        {t("settings.channels.status.connected", "Connected ({{environment}})", {
          environment: configured?.environment,
        })}
      </Badge>
    )
  ) : offering.sandbox.available ? (
    <Badge variant="outline">{t("settings.channels.operator.sandboxAvailable", "Sandbox available")}</Badge>
  ) : null

  return (
    <SettingsListRow
      dataCy={`operator-${operator.id}-row`}
      badge={badge}
      title={operator.name}
      meta={offering.notes ?? operator.notes}
      primary={primary}
      menu={
        isConnected && providerId ? (
          <SettingsRowMenu
            dataCy={`operator-${operator.id}-menu`}
            items={[
              {
                label: t("settings.channels.actions.edit", "Edit"),
                onSelect: () => onConnect(providerId),
                dataCy: `operator-${operator.id}-edit-button`,
              },
              {
                label: t("settings.channels.actions.disconnect", "Disconnect"),
                onSelect: () => onDisconnect(providerId),
                destructive: true,
                dataCy: `operator-${operator.id}-disconnect-button`,
              },
            ]}
          />
        ) : undefined
      }
    />
  )
}
