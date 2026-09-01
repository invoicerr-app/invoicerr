import { useQueryClient } from "@tanstack/react-query"
import { Copy, Link2 } from "lucide-react"
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
import { shareLinksKey, useCreateShareLink, useRevokeShareLink, useShareLinks } from "@/hooks/queries"

interface ShareLinkDialogProps {
  typeId: string
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Root TODO item 24 ("liens publics de téléchargement"). `path` (from `POST .../share-link`) is
 * API-relative — the backend deliberately never guesses which origin externally reaches it (see
 * `ShareLinksService`'s own header: `APP_URL` is the FRONTEND's own origin in dev/test, not the
 * backend's, and there is no reverse proxy locally to paper over that). Resolving it here reuses the
 * EXACT mechanism `authenticatedFetch` already uses to reach the backend cross-origin
 * (`VITE_BACKEND_URL`) — the same trap document-list.tsx's own PDF button comment already names
 * ("the third dead button of this family") for a relative URL resolved against the wrong origin.
 * `window.location.origin` is the correct fallback for the one topology where `VITE_BACKEND_URL` is
 * deliberately left empty: production, where nginx proxies "/api" on the SAME origin (nginx.conf).
 */
function publicUrlFor(path: string): string {
  const base = import.meta.env.VITE_BACKEND_URL || window.location.origin
  return `${base}${path}`
}

/**
 * Row action dialog for a non-draft document: create a public share link (shown, and copyable,
 * EXACTLY ONCE — the backend never lets it be re-consulted, see `CreatedShareLink`'s own comment),
 * and list/revoke this document's currently active links. Generic over document type — never names
 * "invoice": document-list.tsx only offers this action once the descriptor itself declares
 * "share-link" as available for the record's current status (see that file's own `showShareLink`).
 */
export function ShareLinkDialog({ typeId, documentId, open, onOpenChange }: ShareLinkDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: links, isLoading } = useShareLinks(typeId, documentId, open)
  const createLink = useCreateShareLink()
  const revokeLink = useRevokeShareLink()
  // The just-minted URL — local, in-memory state ONLY. Closing the dialog (handleClose) drops it:
  // there is nowhere else it could come from afterwards, by design.
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null)

  const activeLinks = (links ?? []).filter((link) => link.active)

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: shareLinksKey(typeId, documentId) })

  const handleCreate = async () => {
    try {
      const result = await createLink.mutateAsync({ typeId, documentId })
      setJustCreatedUrl(publicUrlFor(result.path))
      invalidateList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("documents.shareLink.createError"))
    }
  }

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url)
    toast.success(t("documents.shareLink.copied"))
  }

  const handleRevoke = async (tokenId: string) => {
    try {
      await revokeLink.mutateAsync({ typeId, documentId, tokenId })
      invalidateList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("documents.shareLink.revokeError"))
    }
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) setJustCreatedUrl(null)
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-cy="share-link-dialog">
        <DialogHeader>
          <DialogTitle>{t("documents.shareLink.title")}</DialogTitle>
          <DialogDescription>{t("documents.shareLink.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            onClick={handleCreate}
            loading={createLink.isPending}
            dataCy="share-link-create-button"
          >
            <Link2 className="mr-2 h-4 w-4" />
            {t("documents.shareLink.createButton")}
          </Button>

          {justCreatedUrl && (
            <div
              className="flex items-center gap-2 rounded-md border bg-muted/40 p-2"
              data-cy="share-link-created-url-row"
            >
              <Input
                readOnly
                value={justCreatedUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
                data-cy="share-link-created-url"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                tooltip={t("documents.shareLink.copy")}
                onClick={() => handleCopy(justCreatedUrl)}
                dataCy="share-link-copy-button"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{t("documents.shareLink.activeLinksTitle")}</h4>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : activeLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-cy="share-link-empty">
                {t("documents.shareLink.noActiveLinks")}
              </p>
            ) : (
              <ul className="divide-y" data-cy="share-link-list">
                {activeLinks.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                    data-cy={`share-link-row-${link.id}`}
                  >
                    <div>
                      <div data-cy="share-link-created-at">
                        {t("documents.shareLink.createdAt", {
                          date: new Date(link.createdAt).toLocaleString(),
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground" data-cy="share-link-expires-at">
                        {t("documents.shareLink.expiresAt", {
                          date: new Date(link.expiresAt).toLocaleString(),
                        })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={revokeLink.isPending}
                      onClick={() => handleRevoke(link.id)}
                      dataCy={`share-link-revoke-${link.id}`}
                    >
                      {t("documents.shareLink.revoke")}
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
            dataCy="share-link-close"
          >
            {t("documents.shareLink.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
