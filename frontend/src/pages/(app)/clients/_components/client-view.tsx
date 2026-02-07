import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { Client } from "@/types";
import { useTranslation } from "react-i18next";

interface ClientViewDialogProps {
    client: Client | null;
    onOpenChange: (open: boolean) => void;
}

export function ClientViewDialog({ client, onOpenChange }: ClientViewDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog open={client != null} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] md:max-w-2xl lg:max-w-5xl max-h-[90dvh] w-full p-6">
                <DialogHeader>
                    <DialogTitle className="text-xl font-semibold">{t("clients.view.title")}</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        {t("clients.view.description")}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 w-full">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 bg-muted/50 p-4 rounded-lg w-full">
                        <div className="w-fit">
                            {client?.type === 'COMPANY' &&(<p className="text-sm text-muted-foreground">{t("clients.view.fields.companyName")}</p>)}
                            {client?.type === 'COMPANY' &&(<p className="font-medium">{client?.name || "—"}</p>)}
                            <p className="text-sm text-muted-foreground mt-2">{t("clients.upsert.fields.type.label")}</p>
                            <p className="font-medium">
                                {client?.type === 'INDIVIDUAL' ? t("clients.upsert.fields.type.individual") : t("clients.upsert.fields.type.company")}
                            </p>
                        </div>
                        {(!!client?.contactFirstname || !!client?.contactLastname) && (
                        <div className="w-fit">
                            <p className="text-sm text-muted-foreground">{t("clients.view.fields.contactPerson")}</p>
                            <p className="font-medium">
                                    {client?.contactFirstname || ''} {client?.contactLastname || ''}
                            </p>
                        </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 bg-muted/50 p-4 rounded-lg w-full">
                        <div className="w-fit max-w-full">
                            <p className="text-sm text-muted-foreground">{t("clients.view.fields.email")}</p>
                            <p className="font-medium overflow-hidden text-ellipsis">{client?.contactEmail || "—"}</p>
                        </div>
                        <div className="w-fit max-w-full">
                            <p className="text-sm text-muted-foreground">{t("clients.view.fields.phone")}</p>
                            <p className="font-medium">{client?.contactPhone || "—"}</p>
                        </div>
                    </div>

                    {(client?.address || client?.addressLine2 || client?.postalCode || client?.city || client?.state || client?.country) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 bg-muted/50 p-4 rounded-lg w-full">
                            {client?.address && (
                                <div>
                                    <p className="text-sm text-muted-foreground">{t("clients.view.fields.address")}</p>
                                    <p className="font-medium">{client.address}</p>
                                </div>
                            )}
                            {client?.addressLine2 && (
                                <div>
                                    <p className="text-sm text-muted-foreground">{t("clients.view.fields.addressLine2")}</p>
                                    <p className="font-medium">{client.addressLine2}</p>
                                </div>
                            )}
                            {client?.postalCode && (
                                <div>
                                    <p className="text-sm text-muted-foreground">{t("clients.view.fields.postalCode")}</p>
                                    <p className="font-medium">{client.postalCode}</p>
                                </div>
                            )}
                            {client?.city && (
                                <div>
                                    <p className="text-sm text-muted-foreground">{t("clients.view.fields.city")}</p>
                                    <p className="font-medium">{client.city}</p>
                                </div>
                            )}
                            {client?.state && (
                                <div>
                                    <p className="text-sm text-muted-foreground">{t("clients.view.fields.state")}</p>
                                    <p className="font-medium">{client.state}</p>
                                </div>
                            )}
                            {client?.country && (
                                <div>
                                    <p className="text-sm text-muted-foreground">{t("clients.view.fields.country")}</p>
                                    <p className="font-medium">{client.country}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
