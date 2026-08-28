import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { GripVertical, Plus, Trash2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useEffect } from "react"
import { useFieldArray, useFormContext, useWatch } from "react-hook-form"

import { ArticlePicker } from "@/components/article-picker"
import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { CSS } from "@dnd-kit/utilities"
import { Input } from "@/components/ui/input"
import type { LineItemTranslationPrefix } from "@/lib/line-item-schema"
import { Textarea } from "@/components/ui/textarea"
import type React from "react"
import { useTranslation } from "react-i18next"

type ItemType = "HOUR" | "DAY" | "DEPOSIT" | "SERVICE" | "PRODUCT"

/**
 * The controls a 0% line needs, and only a 0% line.
 *
 * They are hidden at any other rate because at any other rate there is nothing to ask: a positive
 * rate is category `S` and that is not ambiguous. At 0 it is, and unavoidably so — `Z` (zero-rated,
 * taxed at 0), `E` (exempt) and `O` (outside the scope) all carry rate 0 and demand contradictory
 * things of the document. `Z` requires the seller's VAT identifier (BR-Z-02), `O` FORBIDS it
 * (BR-O-02), and `E` additionally requires a reason (BR-E-10) the other two have no place for.
 *
 * The backend blocks issuance rather than guessing, so without these fields a French 0% invoice
 * reaches "cannot be issued" with no way for the user to resolve it. This is that way.
 */
function ZeroRatedFields({
  index,
  translationPrefix,
}: {
  index: number
  translationPrefix: LineItemTranslationPrefix
}) {
  const { t } = useTranslation()
  const { control } = useFormContext()
  const vatRate = useWatch({ control, name: `items.${index}.vatRate` })

  // Strictly 0 — not falsy. An empty or half-typed field is `undefined`/`NaN`, and popping the
  // block open while someone is still typing the rate would be worse than not having it.
  if (vatRate !== 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 sm:flex-row sm:items-start">
      <FormField
        control={control}
        name={`items.${index}.vatCategory`}
        render={({ field }) => (
          <FormItem className="sm:w-56">
            <FormLabel>{t(`${translationPrefix}.upsert.form.items.vatCategory.label`)}</FormLabel>
            <FormControl>
              <Select
                value={field.value ?? "AUTO"}
                onValueChange={(val) => field.onChange(val === "AUTO" ? undefined : val)}
              >
                <SelectTrigger
                  size="sm"
                  data-cy={`item-vat-category-${index}`}
                  aria-label={t(`${translationPrefix}.upsert.form.items.vatCategory.label`) as string}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">
                    {t(`${translationPrefix}.upsert.form.items.vatCategory.auto`)}
                  </SelectItem>
                  <SelectItem value="E">
                    {t(`${translationPrefix}.upsert.form.items.vatCategory.exempt`)}
                  </SelectItem>
                  <SelectItem value="Z">
                    {t(`${translationPrefix}.upsert.form.items.vatCategory.zeroRated`)}
                  </SelectItem>
                  <SelectItem value="O">
                    {t(`${translationPrefix}.upsert.form.items.vatCategory.outOfScope`)}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
            <FormDescription>{t(`${translationPrefix}.upsert.form.items.vatCategory.hint`)}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`items.${index}.vatExemptionReason`}
        render={({ field }) => (
          <FormItem className="flex-1">
            <FormLabel>{t(`${translationPrefix}.upsert.form.items.vatExemptionReason.label`)}</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ""}
                data-cy={`item-vat-exemption-reason-${index}`}
                placeholder={t(`${translationPrefix}.upsert.form.items.vatExemptionReason.placeholder`)}
              />
            </FormControl>
            <FormDescription>
              {t(`${translationPrefix}.upsert.form.items.vatExemptionReason.hint`)}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

interface LineItemsEditorProps {
  translationPrefix: LineItemTranslationPrefix
  /**
   * i18n namespace for the item-type select labels. Quotes reuse the
   * invoices labels (`quotes.upsert.form.items.type.*` is not defined),
   * hence the separate parameter. Defaults to `translationPrefix`.
   */
  typeLabelPrefix?: LineItemTranslationPrefix
  defaultItemType: ItemType
}

export function LineItemsEditor({
  translationPrefix,
  typeLabelPrefix = translationPrefix,
  defaultItemType,
}: LineItemsEditorProps) {
  const { t } = useTranslation()
  const { control, setValue } = useFormContext()
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: "items",
  })

  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor))

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
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
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex gap-2 items-center">
                    <FormField
                      control={control}
                      name={`items.${index}.name`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder={t(`${translationPrefix}.upsert.form.items.name.placeholder`)}
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
                            <Select
                              value={field.value ?? "SERVICE"}
                              onValueChange={(val) => field.onChange(val)}
                            >
                              <SelectTrigger
                                className="w-32"
                                size="sm"
                                aria-label={t(`${typeLabelPrefix}.upsert.form.items.type.label`) as string}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="HOUR">
                                  {t(`${typeLabelPrefix}.upsert.form.items.type.hour`)}
                                </SelectItem>
                                <SelectItem value="DAY">
                                  {t(`${typeLabelPrefix}.upsert.form.items.type.day`)}
                                </SelectItem>
                                <SelectItem value="DEPOSIT">
                                  {t(`${typeLabelPrefix}.upsert.form.items.type.deposit`)}
                                </SelectItem>
                                <SelectItem value="SERVICE">
                                  {t(`${typeLabelPrefix}.upsert.form.items.type.service`)}
                                </SelectItem>
                                <SelectItem value="PRODUCT">
                                  {t(`${typeLabelPrefix}.upsert.form.items.type.product`)}
                                </SelectItem>
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
                              placeholder={t(`${translationPrefix}.upsert.form.items.quantity.placeholder`)}
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
                              placeholder={t(`${translationPrefix}.upsert.form.items.unitPrice.placeholder`)}
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
                              placeholder={t(`${translationPrefix}.upsert.form.items.vatRate.placeholder`)}
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

                    <Button
                      type="button"
                      variant={"outline"}
                      onClick={() => remove(index)}
                      dataCy={`remove-item-${index}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-700" />
                    </Button>
                  </div>

                  <FormField
                    control={control}
                    name={`items.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={2}
                            placeholder={t(`${translationPrefix}.upsert.form.items.description.placeholder`)}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(`${translationPrefix}.upsert.form.items.description.hint`)}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <ZeroRatedFields index={index} translationPrefix={translationPrefix} />
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
              name: "",
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
              name: article.name,
              description: article.description ?? "",
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
