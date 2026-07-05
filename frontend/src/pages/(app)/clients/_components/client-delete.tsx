import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import type { Client } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

interface ClientDeleteDialogProps {
    client: Client | null
    onOpenChange: (open: boolean) => void
}

export function ClientDeleteDialog({ client, onOpenChange }: ClientDeleteDialogProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { trigger, loading } = useMutationWithToast(
        useDelete(`/api/clients/${client?.id}`),
        t("clients.delete.messages.error", "Failed to delete client"),
    )

    const handleDelete = () => {
        if (!client) return;

        trigger()
            .then((result) => {
                if (!result) return
                queryClient.invalidateQueries({ queryKey: queryKeys.clients.listsAll() })
                onOpenChange(false);
            });
    }

    return (
        <Dialog open={client != null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('clients.delete.title')}</DialogTitle>
                    <DialogDescription>
                        {t('clients.delete.description')}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
                    <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)} disabled={loading}>
                        {t('clients.delete.actions.cancel')}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete} loading={loading} dataCy="confirm-delete-client-button">
                        {t('clients.delete.actions.delete')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
