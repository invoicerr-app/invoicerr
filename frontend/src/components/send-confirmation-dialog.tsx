import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"

interface SendConfirmationDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    email: string
    emailLabel: string
    confirmLabel: string
    cancelLabel: string
    onConfirm: () => void
    loading?: boolean
}

export function SendConfirmationDialog({
    open,
    onOpenChange,
    title,
    description,
    email,
    emailLabel,
    confirmLabel,
    cancelLabel,
    onConfirm,
    loading = false,
}: SendConfirmationDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {description}
                    </DialogDescription>
                </DialogHeader>
                <div className="rounded-md bg-muted p-3 text-sm">
                    <span className="font-medium text-muted-foreground">{emailLabel}</span>{" "}
                    <span className="font-semibold text-foreground">{email}</span>
                </div>
                <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
                    <Button
                        variant="outline"
                        className="w-full bg-transparent"
                        onClick={() => onOpenChange(false)}
                        disabled={loading}
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        className="w-full"
                        onClick={onConfirm}
                        disabled={loading}
                    >
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
