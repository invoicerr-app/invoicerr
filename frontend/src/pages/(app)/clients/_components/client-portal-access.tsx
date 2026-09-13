import { useQueryClient } from "@tanstack/react-query"
import { Copy, UserRoundCheck } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  portalAccessKey,
  useCreatePortalAccess,
  usePortalAccess,
  useRevokeAllPortalAccess,
  useRevokePortalAccess,
} from "@/hooks/queries"
import type { Client } from "@/types"

interface ClientPortalAccessDialogProps {
  client: Client | null
  onOpenChange: (open: boolean) => void
}

/**
 * Deliberately the OPPOSITE resolution `share-link-dialog.tsx`'s own `publicUrlFor` uses:
 * `path` here (`/portal/:token`) is a FRONTEND route, not a backend API path — the staff member is
 * already browsing the frontend's own origin when they click "create", so THAT origin
 * (`window.location.origin`) is always the right one to build this link against, never
 * `VITE_BACKEND_URL` (a different origin in dev/test — see that other file's header for why IT needs
 * the backend's own origin instead, for the exact opposite reason).
 */
function publicUrlFor(path: string): string {
  return `${window.location.origin}${path}`
}

/**
 * "Invite to portal" — the staff-facing half of the client portal (TODO_FEATURES.md rank 3), on the
 * EXACT model of `ShareLinkDialog`: create a long-lived link (shown, and copyable, ONCE — the backend
 * never lets it be re-consulted), list/revoke the client's currently active invites. The backend also
 * best-effort emails the link to the client's own `contactEmail` — this dialog surfaces that outcome
 * (`result.emailed`) but never depends on it: the raw URL is always available to copy and send by hand.
 */
export function ClientPortalAccessDialog({ client, onOpenChange }: ClientPortalAccessDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const clientId = client?.id ?? ""
  const { data: invites, isLoading } = usePortalAccess(clientId, !!client)
  const createAccess = useCreatePortalAccess()
  const revokeAccess = useRevokePortalAccess()
  const revokeAllAccess = useRevokeAllPortalAccess()
  // The just-minted URL — local state only, dropped on close, same "nowhere else it could come from
  // afterwards" contract `share-link-dialog.tsx` already holds for its own `justCreatedUrl`.
  const [justCreated, setJustCreated] = useState<{ url: string; emailed: boolean } | null>(null)

  const activeInvites = (invites ?? []).filter((invite) => invite.active)

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: portalAccessKey(clientId) })

  const handleCreate = async () => {
    try {
      const result = await createAccess.mutateAsync({ clientId })
      setJustCreated({ url: publicUrlFor(result.path), emailed: result.emailed })
      invalidateList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("clients.portalAccess.createError"))
    }
  }

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url)
    toast.success(t("clients.portalAccess.copied"))
  }

  const handleRevoke = async (tokenId: string) => {
    try {
      await revokeAccess.mutateAsync({ clientId, tokenId })
      invalidateList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("clients.portalAccess.revokeError"))
    }
  }

  const handleRevokeAll = async () => {
    try {
      await revokeAllAccess.mutateAsync({ clientId })
      invalidateList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("clients.portalAccess.revokeError"))
    }
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) setJustCreated(null)
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={client != null} onOpenChange={handleClose}>
      <DialogContent data-cy="portal-access-dialog">
        <DialogHeader>
          <DialogTitle>{t("clients.portalAccess.title")}</DialogTitle>
          <DialogDescription>{t("clients.portalAccess.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            onClick={handleCreate}
            loading={createAccess.isPending}
            dataCy="portal-access-create-button"
          >
            <UserRoundCheck className="mr-2 h-4 w-4" />
            {t("clients.portalAccess.createButton")}
          </Button>

          {justCreated && (
            <div className="space-y-2">
              <div
                className="flex items-center gap-2 rounded-md border bg-muted/40 p-2"
                data-cy="portal-access-created-url-row"
              >
                <Input
                  readOnly
                  value={justCreated.url}
                  onFocus={(event) => event.currentTarget.select()}
                  className="font-mono text-xs"
                  data-cy="portal-access-created-url"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  tooltip={t("clients.portalAccess.copy")}
                  onClick={() => handleCopy(justCreated.url)}
                  dataCy="portal-access-copy-button"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground" data-cy="portal-access-emailed-status">
                {justCreated.emailed
                  ? t("clients.portalAccess.emailedYes")
                  : t("clients.portalAccess.emailedNo")}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{t("clients.portalAccess.activeTitle")}</h4>
              {activeInvites.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  loading={revokeAllAccess.isPending}
                  onClick={handleRevokeAll}
                  dataCy="portal-access-revoke-all-button"
                >
                  {t("clients.portalAccess.revokeAll")}
                </Button>
              )}
            </div>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : activeInvites.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-cy="portal-access-empty">
                {t("clients.portalAccess.noActive")}
              </p>
            ) : (
              <ul className="divide-y" data-cy="portal-access-list">
                {activeInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                    data-cy={`portal-access-row-${invite.id}`}
                  >
                    <div>
                      <div data-cy="portal-access-created-at">
                        {t("clients.portalAccess.createdAt", {
                          date: new Date(invite.createdAt).toLocaleString(),
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground" data-cy="portal-access-expires-at">
                        {t("clients.portalAccess.expiresAt", {
                          date: new Date(invite.expiresAt).toLocaleString(),
                        })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={revokeAccess.isPending}
                      onClick={() => handleRevoke(invite.id)}
                      dataCy={`portal-access-revoke-${invite.id}`}
                    >
                      {t("clients.portalAccess.revoke")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            dataCy="portal-access-close"
          >
            {t("clients.portalAccess.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
