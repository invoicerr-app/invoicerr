import { useImperativeHandle, useState, type Ref } from "react"

/** Imperative handle exposed by the document list components. */
export interface DocumentListHandle {
    handleAddClick: () => void
}

/**
 * Dialog-state plumbing shared by the invoice/quote lists: create/edit/
 * view/delete/send dialog states plus the imperative "open the create
 * dialog" handle used by the page-level add buttons.
 *
 * Extra, document-specific dialog state (e.g. quote's create-invoice
 * dialog) stays in the list component.
 */
export function useDocumentListDialogs<T>(ref: Ref<DocumentListHandle>) {
    const [createDialog, setCreateDialog] = useState<boolean>(false)
    const [editDialog, setEditDialog] = useState<T | null>(null)
    const [viewDialog, setViewDialog] = useState<T | null>(null)
    const [deleteDialog, setDeleteDialog] = useState<T | null>(null)
    const [sendDialog, setSendDialog] = useState<T | null>(null)

    useImperativeHandle(ref, () => ({
        handleAddClick() {
            setCreateDialog(true)
        },
    }))

    return {
        createDialog,
        setCreateDialog,
        editDialog,
        setEditDialog,
        viewDialog,
        setViewDialog,
        deleteDialog,
        setDeleteDialog,
        sendDialog,
        setSendDialog,
    }
}
