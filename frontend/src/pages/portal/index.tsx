import { AlertTriangle, CheckCircle2, Download, FileWarning, LogOut, X, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"
import { toast } from "sonner"

import { Alert, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PublicPageShell } from "@/components/public-page-shell"
import { Skeleton } from "@/components/ui/skeleton"
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
 * `useApiQuery`/`useApiMutation`, which would silently send the wrong (or no) credential. Shares
 * `PublicPageShell` with the signature page (`pages/(app)/signature/[token].tsx`) — the one frame
 * every public, no-session page renders through.
 */
function formatMinor(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency}`
}

type PaymentReturn = "success" | "cancelled" | "failed"

/** The return leg of the online-payment Pay redirect (`PayButton`'s own `successUrl`/`cancelUrl`) —
 *  a persistent banner, never a toast: a client landing back from a NEW tab (the checkout never
 *  replaces this one — see `PayButton`'s own header) deserves a result they can still read a moment
 *  later, not one that already faded. Purely a UX courtesy: the query flag is NEVER trusted as proof
 *  of payment — only a verified webhook moves the balance (`PaymentSessionsService`'s own header) —
 *  it only decides which banner to show and whether to ask for a fresh balance. `"failed"` is handled
 *  defensively (no provider this app wires today actually redirects back with it) so a future one
 *  lands on a real state instead of silently falling through.
 */
function PaymentReturnBanner({ kind, onDismiss }: { kind: PaymentReturn; onDismiss: () => void }) {
  const { t } = useTranslation()
  const config: Record<
    PaymentReturn,
    { variant: "success" | "warning" | "destructive"; icon: typeof CheckCircle2; textKey: string }
  > = {
    success: { variant: "success", icon: CheckCircle2, textKey: "clientPortal.statement.payReturnSuccess" },
    cancelled: {
      variant: "warning",
      icon: AlertTriangle,
      textKey: "clientPortal.statement.payReturnCancelled",
    },
    failed: { variant: "destructive", icon: XCircle, textKey: "clientPortal.statement.payReturnFailed" },
  }
  const { variant, icon: Icon, textKey } = config[kind]

  return (
    <Alert variant={variant} data-cy="portal-payment-return-banner">
      <Icon />
      <AlertTitle>{t(textKey)}</AlertTitle>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        aria-label={t("pwaInstall.dismiss")}
        className="absolute right-2 top-2 h-7 w-7"
      >
        <X className="h-4 w-4" />
      </Button>
    </Alert>
  )
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
    <Badge
      variant="outline"
      className={cn("border-transparent font-semibold", TONE_CLASSES[tone])}
      data-cy={`portal-document-status-${row.id}`}
    >
      {t(labelKey)}
    </Badge>
  )
}

function CurrencyTotalsCard({ totals }: { totals: ClientStatementCurrencyTotals }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 rounded-lg border p-4" data-cy={`portal-statement-total-${totals.currency}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{totals.currency}</p>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{t("clientPortal.statement.totalOutstanding")}</span>
        <span className="amount text-lg font-semibold">
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
 * The online-payment Pay link — this row's OWN primary action (the page carries no other filled
 * button anywhere, so this never competes with a second one). Shown only for an invoice
 * (`row.typeId === "invoice"`, never a quote or a credit note) still carrying an outstanding balance.
 * Opens the provider's own hosted checkout page in a NEW TAB (`window.open`) rather than a full-page
 * redirect: a client who abandons or fails the payment keeps their portal session and the rest of
 * their document list intact in the original tab, instead of having to re-open the emailed portal
 * link from scratch. The balance itself never moves here either way: only a verified webhook does that
 * (see the backend's own `PaymentSessionsService` header) — `successUrl`/`cancelUrl` (the NEW tab's own
 * eventual destination) bring that tab back to `/portal`, where `PaymentReturnBanner` above asks the
 * SAME source of truth (`GET .../statement`) for the up-to-date balance, never trusting the redirect
 * itself as a signal.
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

/** One document row — a card on every breakpoint (never a table): the same "carte par élément" shape
 *  the staff-facing document list reserves for narrow screens, used here unconditionally because this
 *  screen has far fewer columns worth a dedicated one and a client reads it on a phone as often as
 *  a desktop. */
function DocumentRow({ row }: { row: ClientStatementDocumentRow }) {
  const { t } = useTranslation()
  const overdue = !row.settled && !!row.dueDate && new Date(row.dueDate) < new Date()

  return (
    <li
      className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
      data-cy={`portal-document-row-${row.id}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{row.displayNumber ?? row.id.slice(0, 8)}</span>
          <StatementRowBadge row={row} />
        </div>
        <p className="text-xs text-muted-foreground">
          {row.issueDate ?? "—"}
          {row.dueDate && (
            <>
              {" · "}
              <span className={cn(overdue && "font-medium text-destructive")}>
                {t("clientPortal.statement.due")} {row.dueDate}
              </span>
            </>
          )}
          {row.paidMinor > 0 && !row.settled && (
            <>
              {" "}
              · {t("clientPortal.statement.paidSoFar", { amount: formatMinor(row.paidMinor, row.currency) })}
            </>
          )}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="amount text-base font-semibold">{formatMinor(row.amountMinor, row.currency)}</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => downloadPortalPdf(row.typeId, row.id, t("clientPortal.statement.downloadError"))}
            dataCy={`portal-document-pdf-button-${row.id}`}
          >
            <Download className="h-4 w-4" />
            {t("clientPortal.statement.downloadPdf")}
          </Button>
          <PayButton row={row} />
        </div>
      </div>
    </li>
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
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={refuse.isPending}
        onClick={handleRefuse}
        dataCy={`portal-quote-refuse-${quote.id}`}
      >
        {t("clientPortal.quotes.refuse")}
      </Button>
      <Button
        type="button"
        size="sm"
        loading={requestSignature.isPending}
        onClick={handleRequestSignature}
        dataCy={`portal-quote-accept-${quote.id}`}
      >
        {t("clientPortal.quotes.accept")}
      </Button>
    </div>
  )
}

function QuoteRow({ quote }: { quote: PortalQuoteRow }) {
  const { t } = useTranslation()
  return (
    <li
      className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
      data-cy={`portal-quote-row-${quote.id}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{quote.displayNumber ?? quote.id.slice(0, 8)}</span>
          {/* The GENERIC status badge (document-status-badge.tsx) — its own tone vocabulary already
              covers "sent"/"signed"/"refused" correctly (info/success/destructive), the same
              component the staff-facing document list uses. Never a second, hand-rolled mapping. */}
          <DocumentStatusBadge
            status={quote.status}
            label={t(`clientPortal.quotes.status.${quote.status}`, { defaultValue: quote.status })}
          />
        </div>
        <p className="text-xs text-muted-foreground">{quote.issueDate ?? "—"}</p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="amount text-base font-semibold">
          {formatMinor(quote.amountMinor, quote.currency)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => downloadPortalPdf("quote", quote.id, t("clientPortal.statement.downloadError"))}
            dataCy={`portal-document-pdf-button-${quote.id}`}
          >
            <Download className="h-4 w-4" />
            {t("clientPortal.statement.downloadPdf")}
          </Button>
          <QuoteRowActions quote={quote} />
        </div>
      </div>
    </li>
  )
}

export default function ClientPortalDashboard() {
  const { t } = useTranslation()
  const hasToken = !!getPortalToken()

  const profile = usePortalProfile(hasToken)
  const statement = usePortalStatement(hasToken && !!profile.data)
  const quotes = usePortalQuotes(hasToken && !!profile.data)

  const [searchParams, setSearchParams] = useSearchParams()
  const [paymentReturn, setPaymentReturn] = useState<PaymentReturn | null>(null)
  // Runs once, on mount, against whatever query string the redirect landed with — never re-armed by
  // `statement`/`setSearchParams` changing identity on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount, see above.
  useEffect(() => {
    const payment = searchParams.get("payment")
    if (payment === "success" || payment === "cancelled" || payment === "failed") {
      setPaymentReturn(payment)
      if (payment === "success") statement.refetch()
      setSearchParams({}, { replace: true })
    }
  }, [])

  const handleSignOut = () => {
    clearPortalToken()
    window.location.reload()
  }

  const company = profile.data ? { name: profile.data.companyName, logo: profile.data.companyLogo } : null

  if (!hasToken || profile.isError) {
    return (
      <PublicPageShell width="narrow">
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <div
            className="w-full max-w-sm space-y-2 rounded-xl border bg-card p-6 text-center"
            data-cy="portal-invalid-card"
          >
            <p className="flex items-center justify-center gap-2 font-semibold text-destructive">
              <FileWarning className="h-5 w-5" />
              {t("clientPortal.invalid.title")}
            </p>
            <p className="text-sm text-muted-foreground">{t("clientPortal.invalid.description")}</p>
          </div>
        </div>
      </PublicPageShell>
    )
  }

  if (profile.isLoading || !profile.data) {
    return (
      <PublicPageShell>
        <div className="space-y-4 py-6" data-cy="portal-loading">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PublicPageShell>
    )
  }

  return (
    <PublicPageShell
      company={company}
      dataCy="portal-dashboard"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          dataCy="portal-signout-button"
        >
          <LogOut className="h-4 w-4" />
          {t("clientPortal.signOut")}
        </Button>
      }
    >
      <div className="space-y-6 py-6">
        {paymentReturn && (
          <PaymentReturnBanner kind={paymentReturn} onDismiss={() => setPaymentReturn(null)} />
        )}

        <div data-cy="portal-header">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-balance">
            {t("clientPortal.title", { name: profile.data.clientName })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("clientPortal.subtitle", { company: profile.data.companyName })}
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("clientPortal.statement.title")}
          </h2>
          {statement.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !statement.data || statement.data.documents.length === 0 ? (
            <EmptyState
              icon={FileWarning}
              title={t("clientPortal.statement.empty")}
              data-cy="portal-statement-empty"
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {statement.data.totals.map((totals) => (
                  <CurrencyTotalsCard key={totals.currency} totals={totals} />
                ))}
              </div>
              <ul className="divide-y rounded-lg border px-4">
                {statement.data.documents.map((row) => (
                  <DocumentRow key={row.id} row={row} />
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("clientPortal.quotes.title")}
          </h2>
          {quotes.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !quotes.data || quotes.data.length === 0 ? (
            <EmptyState
              icon={FileWarning}
              title={t("clientPortal.quotes.empty")}
              data-cy="portal-quotes-empty"
            />
          ) : (
            <ul className="divide-y rounded-lg border px-4">
              {quotes.data.map((quote) => (
                <QuoteRow key={quote.id} quote={quote} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </PublicPageShell>
  )
}
