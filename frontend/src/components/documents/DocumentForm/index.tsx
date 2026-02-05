import {
  closestCenter,
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface DocumentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  children?: React.ReactNode;
  onSubmit: (data: any) => void;
  defaultValues?: any;
}

export function DocumentForm({
  open,
  onOpenChange,
  title,
  submitLabel,
  children,
  onSubmit,
  defaultValues,
}: DocumentFormProps) {
  const form = useForm({
    defaultValues: defaultValues || {
      items: [],
      notes: '',
      dueDate: undefined,
    },
  });

  const { control, handleSubmit, setValue } = form;
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: 'items',
  });

  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor));

  const onDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = fields.findIndex((f) => f.id === active.id);
      const newIndex = fields.findIndex((f) => f.id === over.id);
      move(oldIndex, newIndex);
      const reordered = arrayMove(fields, oldIndex, newIndex);
      reordered.forEach((_, index) => {
        setValue(`items.${index}.order`, index);
      });
    }
  };

  const onRemove = (index: number) => {
    remove(index);
  };

  const handleSubmitForm = (data: any) => {
    onSubmit(data);
    onOpenChange(false);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit(handleSubmitForm)} className="space-y-4">
            {children}

            <FormItem>
              <FormLabel>Items</FormLabel>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={fields.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {fields.map((fieldItem, index) => (
                      <SortableItem
                        key={fieldItem.id}
                        id={fieldItem.id}
                        dragHandle={
                          <GripVertical className="cursor-grab text-muted-foreground" />
                        }
                      >
                        <div className="flex gap-2 items-center">
                          <FormField
                            control={control}
                            name={`items.${index}.description`}
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input {...field} placeholder="Item description" />
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
                                  <Input
                                    {...field}
                                    type="number"
                                    placeholder="Qty"
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value === ''
                                          ? undefined
                                          : Number(e.target.value),
                                      )
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
                                  <Input
                                    {...field}
                                    type="number"
                                    step="0.01"
                                    placeholder="Unit price"
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value === ''
                                          ? undefined
                                          : Number(e.target.value),
                                      )
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
                                  <Input
                                    {...field}
                                    type="number"
                                    step="0.01"
                                    placeholder="VAT %"
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value === ''
                                          ? undefined
                                          : Number(e.target.value),
                                      )
                                    }
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
                                    value={field.value ?? 'SERVICE'}
                                    onValueChange={(val) => field.onChange(val as any)}
                                  >
                                    <SelectTrigger className="w-32 mb-0">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="HOUR">Hour</SelectItem>
                                      <SelectItem value="DAY">Day</SelectItem>
                                      <SelectItem value="DEPOSIT">Deposit</SelectItem>
                                      <SelectItem value="SERVICE">Service</SelectItem>
                                      <SelectItem value="PRODUCT">Product</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <Button variant={'outline'} onClick={() => onRemove(index)}>
                            <Trash2 className="h-4 w-4 text-red-700" />
                          </Button>
                        </div>
                      </SortableItem>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  append({
                    description: '',
                    quantity: NaN,
                    unitPrice: NaN,
                    vatRate: NaN,
                    type: 'SERVICE',
                    order: fields.length,
                  })
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </FormItem>

            <FormField
              control={control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Additional notes or terms"
                      className="max-h-40"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">{submitLabel}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function SortableItem({
  id,
  children,
  dragHandle,
}: {
  id: string;
  children: React.ReactNode;
  dragHandle: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      {children}
      <div {...attributes} {...listeners}>
        {dragHandle}
      </div>
    </div>
  );
}
