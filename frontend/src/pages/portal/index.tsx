import { FileWarning, LogOut } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { decimalsFor, fromMinor } from "@/components/documents/totals-calculator"
import { settlementBadgeInfo, TONE_CLASSES } from "@/components/documents/document-settlement"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import { ApiError } from "@/hooks/use-api-query"
import {
  useCreatePortalCheckoutSession,
  usePortalProfile,
  usePortalQuotes,
  usePortalStatement,
  useRefusePortalQuote,
  useRequestPortalQuoteSignature,
} from "@/hooks/queries"
import { clearPortalToken, getPortalToken, portalFetch } from "@/hooks/use-portal-fetch"
import { cn } from "@/lib/utils"
import type { ClientStatementCurrencyTotals, ClientStatementDocumentRow, PortalQuoteRow } from "@/types"

/**
 * The authenticated client portal — the client's own space: every document
 * they can see (`clientVisible` — see the backend's own `DocumentStatusDescriptor` header), their
 * balance (`GET /api/portal/statement`, exactly `resolveClientStatement`'s own output, never
 * recomputed here), and their quotes, with "request a signature" (the EXISTING, OTP-hardened flow —
 * see `PortalService.requestQuoteSignature`'s own header) and "decline" for whichever still await a
 * decision.
 *
 * A TOP-LEVEL page (`pages/portal/`, no `(app)` group, no staff sidebar, no `authClient.useSession()`
 * — see `[token].tsx`'s own header). Every read/write goes through `usePortalApiQuery`/
 * `usePortalApiMutation` (`use-portal-api-query.ts`), the bearer-token transport — NEVER
 * `useApiQuery`/`useApiMutation`, which would silently send the wrong (or no) credential.
 */
function formatMinor(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency}`
}

function StatementRowBadge({ row }: { row: ClientStatementDocumentRow }) {
  const { t } = useTranslation()
  const { tone, labelKey } = settlementBadgeInfo({
    totalGrossMinor: row.amountMinor,
    paidMinor: row.paidMinor,
    creditedMinor: 0,
    outstandingMinor: row.outstandingMinor,
    excessMinor: 0,
    settled: row.settled,
  })
  return (
    <Badge variant="outline" className={cn("border-transparent font-semibold", TONE_CLASSES[tone])}>
      {t(labelKey)}
    </Badge>
  )
}

function CurrencyTotalsCard({ totals }: { totals: ClientStatementCurrencyTotals }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 rounded-lg border p-4" data-cy={`portal-statement-total-${totals.currency}`}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{totals.currency}</p>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{t("clientPortal.statement.totalOutstanding")}</span>
        <span className="text-lg font-semibold">
          {formatMinor(totals.totalOutstandingMinor, totals.currency)}
        </span>
      </div>
    </div>
  )
}

/** Downloads one document's PDF through the portal's own bearer-token transport, then opens it —
 *  identical `blob` + `URL.createObjectURL` + `window.open` mechanism `document-list.tsx`'s own
 *  authenticated download button already uses, since a plain `<a href>` cannot carry the
 *  `Authorization` header this route requires. */
async function downloadPortalPdf(typeId: string, id: string, errorMessage: string) {
  try {
    const response = await portalFetch(`/api/portal/documents/${typeId}/${id}/pdf`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : errorMessage)
  }
}

/**
 * The online-payment Pay link. Shown only for an invoice
 * (`row.typeId === "invoice"`, never a quote or a credit note) still carrying an outstanding balance.
 * Opens the provider's own hosted checkout page in a NEW TAB (`window.open`, the exact same mechanism
 * `downloadPortalPdf` right above already uses for an external artifact) rather than a full-page
 * redirect: a client who abandons or fails the payment keeps their portal session and the rest of
 * their document list intact in the original tab, instead of having to re-open the emailed portal
 * link from scratch. The balance itself never moves here either way: only a verified webhook does that
 * (see the backend's own `PaymentSessionsService` header) — `successUrl`/`cancelUrl` (the NEW tab's own
 * eventual destination) bring that tab back to `/portal`, where the return-banner effect below asks
 * the SAME source of truth (`GET .../statement`) for the up-to-date balance, never trusting the
 * redirect itself as a signal.
 */
function PayButton({ row }: { row: ClientStatementDocumentRow }) {
  const { t } = useTranslation()
  const createSession = useCreatePortalCheckoutSession()

  if (row.typeId !== "invoice" || row.outstandingMinor <= 0) return null

  const handlePay = () => {
    createSession.mutate(
      { invoiceId: row.id },
      {
        onSuccess: (data) => {
          window.open(data.checkoutUrl, "_blank", "noopener,noreferrer")
        },
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : t("clientPortal.statement.payError")),
      },
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      loading={createSession.isPending}
      onClick={handlePay}
      dataCy={`portal-pay-button-${row.id}`}
    >
      {t("clientPortal.statement.pay")}
    </Button>
  )
}

function QuoteRowActions({ quote }: { quote: PortalQuoteRow }) {
  const { t } = useTranslation()
  const requestSignature = useRequestPortalQuoteSignature()
  const refuse = useRefusePortalQuote()

  if (!quote.canRespond) return null

  const handleRequestSignature = () => {
    requestSignature.mutate(
      { quoteId: quote.id },
      {
        onSuccess: () => toast.success(t("clientPortal.quotes.signatureRequested")),
        onError: (error) => toast.error(error instanceof ApiError ? error.message : String(error)),
      },
    )
  }

  const handleRefuse = () => {
    refuse.mutate(
      { quoteId: quote.id },
      {
        onSuccess: () => toast.success(t("clientPortal.quotes.refused")),
        onError: (error) => toast.error(error instanceof ApiError ? error.message : String(error)),
      },
    )
  }

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        size="sm"
        loading={requestSignature.isPending}
        onClick={handleRequestSignature}
        dataCy={`portal-quote-accept-${quote.id}`}
      >
        {t("clientPortal.quotes.accept")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={refuse.isPending}
        onClick={handleRefuse}
        dataCy={`portal-quote-refuse-${quote.id}`}
      >
        {t("clientPortal.quotes.refuse")}
      </Button>
    </div>
  )
}

function QuoteStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  // The GENERIC status badge (document-status-badge.tsx) — its own tone vocabulary already covers
  // "sent"/"signed"/"refused" correctly (info/success/destructive, via word-pattern matching), the
  // same component the staff-facing document list uses. Never a second, hand-rolled tone mapping.
  return (
    <DocumentStatusBadge
      status={status}
      label={t(`clientPortal.quotes.status.${status}`, { defaultValue: status })}
    />
  )
}

export default function ClientPortalDashboard() {
  const { t } = useTranslation()
  const hasToken = !!getPortalToken()

  const profile = usePortalProfile(hasToken)
  const statement = usePortalStatement(hasToken && !!profile.data)
  const quotes = usePortalQuotes(hasToken && !!profile.data)

  // The return leg of the online-payment Pay redirect
  // (`PayButton`'s own `successUrl`/`cancelUrl`). Purely a UX courtesy: the query flag is NEVER trusted
  // as proof of payment (a client could type `?payment=success` into the address bar for nothing) — it
  // only decides which toast to show and whether to ask `GET .../statement` for a fresh read, the same
  // source of truth every other balance on this screen already comes from. A webhook that landed
  // before this redirect completes (the common case — Stripe's own webhook usually beats the browser
  // back to `/portal`) is reflected immediately; one still in flight simply shows up on the NEXT read.
  const [searchParams, setSearchParams] = useSearchParams()
  // Runs once, on mount, against whatever query string the redirect landed with — never re-armed by
  // `statement`/`t`/`setSearchParams` changing identity on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount, see above.
  useEffect(() => {
    const payment = searchParams.get("payment")
    if (payment === "success") {
      toast.success(t("clientPortal.statement.payReturnSuccess"))
      statement.refetch()
      setSearchParams({}, { replace: true })
    } else if (payment === "cancelled") {
      toast.info(t("clientPortal.statement.payReturnCancelled"))
      setSearchParams({}, { replace: true })
    }
  }, [])

  const handleSignOut = () => {
    clearPortalToken()
    window.location.reload()
  }

  if (!hasToken || profile.isError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="w-full max-w-sm md:max-w-md" data-cy="portal-invalid-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <FileWarning className="h-5 w-5" />
              {t("clientPortal.invalid.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("clientPortal.invalid.description")}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (profile.isLoading || !profile.data) {
    return (
      <div className="p-6 space-y-4" data-cy="portal-loading">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-cy="portal-dashboard">
      <div className="flex items-center justify-between" data-cy="portal-header">
        <div>
          <h1 className="text-xl font-semibold">
            {t("clientPortal.title", { name: profile.data.clientName })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("clientPortal.subtitle", { company: profile.data.companyName })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={handleSignOut} dataCy="portal-signout-button">
          <LogOut className="mr-2 h-4 w-4" />
          {t("clientPortal.signOut")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("clientPortal.statement.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {statement.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !statement.data || statement.data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-cy="portal-statement-empty">
              {t("clientPortal.statement.empty")}
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {statement.data.totals.map((totals) => (
                  <CurrencyTotalsCard key={totals.currency} totals={totals} />
                ))}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("clientPortal.statement.columns.document")}</TableHead>
                      <TableHead>{t("clientPortal.statement.columns.issueDate")}</TableHead>
                      <TableHead>{t("clientPortal.statement.columns.amount")}</TableHead>
                      <TableHead>{t("clientPortal.statement.columns.outstanding")}</TableHead>
                      <TableHead>{t("clientPortal.statement.columns.status")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.data.documents.map((row) => (
                      <TableRow key={row.id} data-cy={`portal-document-row-${row.id}`}>
                        <TableCell>{row.displayNumber ?? row.id}</TableCell>
                        <TableCell>{row.issueDate ?? "—"}</TableCell>
                        <TableCell>{formatMinor(row.amountMinor, row.currency)}</TableCell>
                        <TableCell>{formatMinor(row.outstandingMinor, row.currency)}</TableCell>
                        <TableCell>
                          <StatementRowBadge row={row} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <PayButton row={row} />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                downloadPortalPdf(
                                  row.typeId,
                                  row.id,
                                  t("clientPortal.statement.downloadError"),
                                )
                              }
                              dataCy={`portal-document-pdf-button-${row.id}`}
                            >
                              {t("clientPortal.statement.downloadPdf")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("clientPortal.quotes.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !quotes.data || quotes.data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-cy="portal-quotes-empty">
              {t("clientPortal.quotes.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("clientPortal.quotes.columns.document")}</TableHead>
                    <TableHead>{t("clientPortal.quotes.columns.issueDate")}</TableHead>
                    <TableHead>{t("clientPortal.quotes.columns.amount")}</TableHead>
                    <TableHead>{t("clientPortal.quotes.columns.status")}</TableHead>
                    <TableHead>{t("clientPortal.quotes.columns.actions")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.data.map((quote) => (
                    <TableRow key={quote.id} data-cy={`portal-quote-row-${quote.id}`}>
                      <TableCell>{quote.displayNumber ?? quote.id}</TableCell>
                      <TableCell>{quote.issueDate ?? "—"}</TableCell>
                      <TableCell>{formatMinor(quote.amountMinor, quote.currency)}</TableCell>
                      <TableCell>
                        <QuoteStatusBadge status={quote.status} />
                      </TableCell>
                      <TableCell>
                        <QuoteRowActions quote={quote} />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            downloadPortalPdf("quote", quote.id, t("clientPortal.statement.downloadError"))
                          }
                          dataCy={`portal-document-pdf-button-${quote.id}`}
                        >
                          {t("clientPortal.statement.downloadPdf")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
