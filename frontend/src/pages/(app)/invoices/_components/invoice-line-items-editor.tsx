import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core"
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { GripVertical, Plus, Trash2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useEffect } from "react"
import { useFieldArray, useFormContext } from "react-hook-form"

import { ArticlePicker } from "@/components/article-picker"
import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { CSS } from "@dnd-kit/utilities"
import { Input } from "@/components/ui/input"
import type React from "react"
import { useTranslation } from "react-i18next"

type ItemType = "HOUR" | "DAY" | "DEPOSIT" | "SERVICE" | "PRODUCT"

interface InvoiceLineItemsEditorProps {
    translationPrefix: "invoices" | "recurringInvoices"
    defaultItemType: ItemType
}

export function InvoiceLineItemsEditor({ translationPrefix, defaultItemType }: InvoiceLineItemsEditorProps) {
    const { t } = useTranslation()
    const { control, setValue } = useFormContext()
    const { fields, append, move, remove } = useFieldArray({
        control,
        name: "items",
    })

    const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor))

    const onDragEnd = (event: any) => {
        const { active, over } = event
        if (active.id !== over?.id) {
            const oldIndex = fields.findIndex((f) => f.id === active.id)
            const newIndex = fields.findIndex((f) => f.id === over.id)
            move(oldIndex, newIndex)
            const reordered = arrayMove(fields, oldIndex, newIndex)
            reordered.forEach((_, index) => {
                setValue(`items.${index}.order`, index)
            })
        }
    }

    useEffect(() => {
        fields.forEach((_, i) => {
            setValue(`items.${i}.order`, i)
        })
    }, [fields, setValue])

    return (
        <FormItem>
            <FormLabel>{t(`${translationPrefix}.upsert.form.items.label`)}</FormLabel>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                        {fields.map((fieldItem, index) => (
                            <SortableItem
                                key={fieldItem.id}
                                id={fieldItem.id}
                                dragHandle={<GripVertical className="cursor-grab text-muted-foreground" />}
                            >
                                <div className="flex gap-2 items-center">
                                    <FormField
                                        control={control}
                                        name={`items.${index}.description`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        placeholder={t(
                                                            `${translationPrefix}.upsert.form.items.description.placeholder`,
                                                        )}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name={`items.${index}.type`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Select value={field.value ?? 'SERVICE'} onValueChange={(val) => field.onChange(val as any)}>
                                                        <SelectTrigger className="w-32" size="sm" aria-label={t(`${translationPrefix}.upsert.form.items.type.label`) as string}>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="HOUR">{t(`${translationPrefix}.upsert.form.items.type.hour`)}</SelectItem>
                                                            <SelectItem value="DAY">{t(`${translationPrefix}.upsert.form.items.type.day`)}</SelectItem>
                                                            <SelectItem value="DEPOSIT">{t(`${translationPrefix}.upsert.form.items.type.deposit`)}</SelectItem>
                                                            <SelectItem value="SERVICE">{t(`${translationPrefix}.upsert.form.items.type.service`)}</SelectItem>
                                                            <SelectItem value="PRODUCT">{t(`${translationPrefix}.upsert.form.items.type.product`)}</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name={`items.${index}.quantity`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <BetterInput
                                                        {...field}
                                                        defaultValue={field.value || ""}
                                                        postAdornment={t(`${translationPrefix}.upsert.form.items.quantity.unit`)}
                                                        type="number"
                                                        step="0.001"
                                                        placeholder={t(
                                                            `${translationPrefix}.upsert.form.items.quantity.placeholder`,
                                                        )}
                                                        onChange={(e) =>
                                                            field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                                                        }
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name={`items.${index}.unitPrice`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <BetterInput
                                                        {...field}
                                                        defaultValue={field.value || ""}
                                                        postAdornment="$"
                                                        type="number"
                                                        step="0.01"
                                                        placeholder={t(
                                                            `${translationPrefix}.upsert.form.items.unitPrice.placeholder`,
                                                        )}
                                                        onChange={(e) =>
                                                            field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                                                        }
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name={`items.${index}.vatRate`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <BetterInput
                                                        {...field}
                                                        defaultValue={field.value || 0}
                                                        postAdornment="%"
                                                        type="number"
                                                        step="0.01"
                                                        placeholder={t(
                                                            `${translationPrefix}.upsert.form.items.vatRate.placeholder`,
                                                        )}
                                                        onChange={(e) =>
                                                            field.onChange(
                                                                e.target.value === ""
                                                                    ? undefined
                                                                    : Number.parseFloat(e.target.value.replace(",", ".")),
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <Button variant={"outline"} onClick={() => remove(index)}>
                                        <Trash2 className="h-4 w-4 text-red-700" />
                                    </Button>
                                </div>
                            </SortableItem>
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                        append({
                            description: "",
                            type: defaultItemType,
                            quantity: Number.NaN,
                            unitPrice: Number.NaN,
                            vatRate: Number.NaN,
                            order: fields.length,
                        })
                    }
                >
                    <Plus className="mr-2 h-4 w-4" />
                    {t(`${translationPrefix}.upsert.form.items.addItem`)}
                </Button>

                <ArticlePicker
                    className="sm:max-w-xs"
                    onPick={(article) =>
                        append({
                            description: article.description || article.name,
                            type: article.type,
                            quantity: 1,
                            unitPrice: article.unitPrice,
                            vatRate: article.vatRate,
                            order: fields.length,
                        })
                    }
                />
            </div>
        </FormItem>
    )
}

function SortableItem({
    id,
    children,
    dragHandle,
}: {
    id: string
    children: React.ReactNode
    dragHandle: React.ReactNode
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-2">
            {children}
            <div {...attributes} {...listeners}>
                {dragHandle}
            </div>
        </div>
    )
}
