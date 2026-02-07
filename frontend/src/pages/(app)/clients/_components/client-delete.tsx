import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Client } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

interface ClientDeleteDialogProps {
    client: Client | null
    onOpenChange: (open: boolean) => void
}

export function ClientDeleteDialog({ client, onOpenChange }: ClientDeleteDialogProps) {
    const { t } = useTranslation()
    const { trigger } = useDelete(`/api/clients/${client?.id}`)

    const handleDelete = () => {
        if (!client) return;

        trigger()
            .then(() => {
                onOpenChange(false);
            })
            .catch((error) => {
                console.error("Failed to delete client:", error);
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
                    <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
                        {t('clients.delete.actions.cancel')}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete} dataCy="confirm-delete-client-button">
                        {t('clients.delete.actions.delete')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
