import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useForm, type DefaultValues } from "react-hook-form"
import type { z } from "zod"

import { usePatch, usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"

interface UseDocumentUpsertOptions<TSchema extends z.ZodTypeAny, TEntity> {
    /** Entity being edited; null/undefined = create mode. */
    entity: TEntity | null | undefined
    schema: TSchema
    defaultValues: DefaultValues<z.infer<TSchema>>
    /** POST endpoint used in create mode. */
    createUrl: string
    /** PATCH endpoint used in edit mode (unused when `entity` is never set). */
    updateUrl?: string
    /** Toast message shown when the mutation fails. */
    errorMessage: string
    /** Maps the edited entity to form values (edit-mode reset). */
    mapEntityToForm?: (entity: TEntity) => DefaultValues<z.infer<TSchema>>
    /** react-query keys invalidated after a successful save. */
    invalidateKeys?: readonly (readonly unknown[])[]
    /** Runs after a successful save, before the form reset (close dialog, ...). */
    onSuccess?: () => void
}

/**
 * Shared create/update plumbing for the document upsert dialogs
 * (invoice / quote / recurring invoice): form setup, toast-wrapped
 * create+update mutations, entity/defaults reset and query invalidation.
 *
 * Per-document specifics (extra mutations like proforma/final, payload
 * decoration, dialog state) stay in the calling component.
 */
export function useDocumentUpsert<TSchema extends z.ZodTypeAny, TEntity>(
    options: UseDocumentUpsertOptions<TSchema, TEntity>,
) {
    const { entity, schema, defaultValues, createUrl, updateUrl, errorMessage, invalidateKeys, onSuccess } = options
    const isEdit = !!entity
    const queryClient = useQueryClient()

    const { trigger: createTrigger, loading: createLoading } = useMutationWithToast(usePost(createUrl), errorMessage)
    const { trigger: updateTrigger, loading: updateLoading } = useMutationWithToast(
        usePatch(updateUrl ?? createUrl),
        errorMessage,
    )

    const form = useForm<z.infer<TSchema>>({
        resolver: zodResolver(schema),
        defaultValues,
    })

    // Reset to the edited entity's values (edit mode) or back to the defaults
    // (create mode). `mapEntityToForm`/`defaultValues` are deliberately not
    // dependencies: they are fresh inline objects on every render, exactly
    // like the previous inline reset effects in the three upserts.
    useEffect(() => {
        if (entity && options.mapEntityToForm) {
            form.reset(options.mapEntityToForm(entity))
        } else {
            form.reset(defaultValues)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entity, form])

    const submit = (data: z.infer<TSchema>) => {
        const trigger = isEdit ? updateTrigger : createTrigger
        trigger(data).then((result) => {
            if (!result) return
            for (const queryKey of invalidateKeys ?? []) {
                queryClient.invalidateQueries({ queryKey })
            }
            onSuccess?.()
            form.reset()
        })
    }

    return {
        form,
        isEdit,
        /** Pass to `form.handleSubmit(...)`. */
        submit,
        /** Loading state of the mutation the submit will use. */
        submitLoading: isEdit ? updateLoading : createLoading,
    }
}
