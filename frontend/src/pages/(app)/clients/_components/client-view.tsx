import { FileStack, Pencil } from "lucide-react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useClientStatement } from "@/hooks/queries"
import type { Client } from "@/types"

import { DetailItem, DetailList, DetailSection } from "../../_shared/detail-list"
import { FormDialog } from "../../_shared/form-dialog"
import { ClientBadges } from "./client-badges"
import { clientDisplayName } from "./client-display"
import { formatMinor, StatementRowBadge } from "./client-statement"

interface ClientViewDialogProps {
  client: Client | null
  onOpenChange: (open: boolean) => void
  onEdit: (client: Client) => void
  onStatement: (client: Client) => void
}

/** The client's own identifiers (SIRET, VAT…) as one compact line under the header — the raw
 *  `scheme: value` pairs, in whatever order the party carries them; the Peppol routing endpoint is
 *  its own separate concern (edited on the form) and is deliberately left out of this quick read. */
function IdentifiersLine({ client }: { client: Client | null }) {
  const identifiers = (client?.partyIdentifiers ?? []).filter((pi) => pi.scheme !== "PEPPOL_ENDPOINT")
  if (identifiers.length === 0) return null
  return (
    <p className="font-mono text-xs text-muted-foreground" data-cy="client-view-identifiers">
      {identifiers.map((pi) => `${pi.scheme}: ${pi.value}`).join(" · ")}
    </p>
  )
}

/** The client's own documents, read straight off `GET /clients/:id/statement` — the exact same
 *  resolver the full statement dialog renders (client-statement.tsx), never a second query: this
 *  section is a quick "what's outstanding" read, the statement dialog (reachable from its own
 *  "View statement" button here) is where the aged totals and every currency block live. */
function LinkedDocuments({ clientId }: { clientId?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useClientStatement(clientId)

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (!data || data.documents.length === 0) {
    return <EmptyState icon={FileStack} size="sm" title={t("clients.view.documents.empty")} />
  }

  return (
    <ul className="-mx-6 divide-y sm:-mx-0" data-cy="client-view-documents">
      {data.documents.map((row) => (
        <li key={row.id}>
          <Link
            to={`/documents/${row.typeId}/${row.id}`}
            className="flex items-center justify-between gap-3 px-6 py-2.5 text-sm transition-colors duration-150 hover:bg-accent/40 sm:rounded-md sm:px-3"
            data-cy={`client-view-document-${row.id}`}
          >
            <div className="min-w-0">
              <span className="font-mono">{row.displayNumber ?? row.id.slice(0, 8)}</span>
              <span className="ml-2 text-xs text-muted-foreground">{row.issueDate ?? "—"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-sm tabular-nums">
                {formatMinor(row.amountMinor, row.currency)}
              </span>
              <StatementRowBadge row={row} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * A client's own record, read-only — the fiche a row's "view" action opens. Same shell as the
 * create/edit dialog (`FormDialog`, without a `<form>` since nothing here is submitted): a header
 * naming and badging the record exactly like a document's own detail page does, a `DetailList` for
 * every plain field (the read-only twin of the form's own field grid, same order), and the client's
 * own documents as a compact linked list. "Edit" is the one primary action in the footer — every
 * other path (the account statement) is one click away rather than duplicated here.
 *
 * Stays mounted with `open={client != null}` (never an early `return null`) so Radix can play the
 * dialog's own closing animation — the same reason its sibling dialogs (delete, statement) guard
 * every field with `client?.` rather than unmounting on a falsy client.
 */
export function ClientViewDialog({ client, onOpenChange, onEdit, onStatement }: ClientViewDialogProps) {
  const { t } = useTranslation()

  const hasAddress =
    client?.address ||
    client?.addressLine2 ||
    client?.postalCode ||
    client?.city ||
    client?.state ||
    client?.country

  return (
    <FormDialog
      open={client != null}
      onOpenChange={onOpenChange}
      title={t("clients.view.title")}
      dataCy="client-view-dialog"
      className="sm:max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("clients.view.actions.close")}
          </Button>
          <Button
            type="button"
            disabled={!client}
            onClick={() => client && onEdit(client)}
            dataCy="client-view-edit-button"
          >
            <Pencil aria-hidden="true" />
            {t("clients.view.actions.edit")}
          </Button>
        </>
      }
    >
      <div className="space-y-2 border-b pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-heading text-lg font-semibold tracking-tight" data-cy="client-view-name">
            {clientDisplayName(client)}
          </h2>
          {client && <ClientBadges client={client} />}
        </div>
        <p className="text-sm text-muted-foreground">
          {client?.contactEmail}
          {client?.contactPhone ? ` · ${client.contactPhone}` : ""}
        </p>
        <IdentifiersLine client={client} />
      </div>

      {client?.type === "COMPANY" && (
        <DetailSection title={t("clients.view.sections.contact")}>
          <DetailList>
            <DetailItem label={t("clients.view.fields.companyName")}>{client.name}</DetailItem>
          </DetailList>
        </DetailSection>
      )}

      <DetailSection title={t("clients.view.sections.contacts", "Contacts")}>
        {client?.contacts && client.contacts.length > 0 ? (
          <ul className="space-y-2" data-cy="client-view-contacts">
            {client.contacts.map((contact, index) => (
              <li
                key={contact.id ?? index}
                className="flex flex-col gap-0.5 rounded-md border p-3 text-sm"
                data-cy={`client-view-contact-${index}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || " - "}
                    {contact.role ? ` · ${contact.role}` : ""}
                  </span>
                  {contact.isPrimary && (
                    <span
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                      data-cy={`client-view-contact-primary-badge-${index}`}
                    >
                      {t("clients.view.fields.primary", "Primary")}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {[contact.email, contact.phone].filter(Boolean).join(" · ") || " - "}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("clients.view.fields.noContacts", "No contacts")}
          </p>
        )}
      </DetailSection>

      {hasAddress && (
        <DetailSection title={t("clients.view.sections.address")}>
          <DetailList>
            <DetailItem label={t("clients.view.fields.address")} wide>
              {client?.address}
            </DetailItem>
            <DetailItem label={t("clients.view.fields.addressLine2")} wide>
              {client?.addressLine2}
            </DetailItem>
            <DetailItem label={t("clients.view.fields.postalCode")}>{client?.postalCode}</DetailItem>
            <DetailItem label={t("clients.view.fields.city")}>{client?.city}</DetailItem>
            <DetailItem label={t("clients.view.fields.state")}>{client?.state}</DetailItem>
            <DetailItem label={t("clients.view.fields.country")}>{client?.country}</DetailItem>
          </DetailList>
        </DetailSection>
      )}

      <DetailSection
        title={t("clients.view.sections.documents")}
        aside={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!client}
            onClick={() => client && onStatement(client)}
          >
            {t("clients.view.actions.statement")}
          </Button>
        }
      >
        <LinkedDocuments clientId={client?.id} />
      </DetailSection>
    </FormDialog>
  )
}
