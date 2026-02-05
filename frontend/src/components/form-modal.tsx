"use client"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { Button } from "@/components/ui/button"
import { FolderSelect } from "@/components/folder-select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

type FieldType = "text" | "number" | "switch" | "select" | "folder"

interface SelectOption {
    label: string
    value: string
}

interface BaseField {
    type: FieldType
    name: string
    label: string
    required?: boolean
}

interface TextField extends BaseField {
    type: "text"
    placeholder?: string
    minLength?: number
    maxLength?: number
    pattern?: string
}

interface NumberField extends BaseField {
    type: "number"
    placeholder?: string
    min?: number
    max?: number
    pattern?: string
}

interface SwitchField extends BaseField {
    type: "switch"
    default?: boolean
}

interface SelectField extends BaseField {
    type: "select"
    placeholder?: string
    multiple?: boolean
    options: SelectOption[]
}

interface FolderField extends BaseField {
    type: "folder"
    placeholder?: string
}

type FormFieldItem = TextField | NumberField | SwitchField | SelectField | FolderField

export interface FormConfig {
    form: {
        fields: FormFieldItem[]
    }
}

interface DynamicFormModalProps {
    open: boolean
    title: string
    description?: string
    config: FormConfig | null
    currentValues?: Record<string, any>
    onCancel: () => void
    onSubmit: (data: Record<string, any>) => void
}

// Generate Zod schema dynamically based on field configuration
function generateZodSchema(fields: FormFieldItem[]) {
    const schemaFields: Record<string, z.ZodTypeAny> = {}

    fields.forEach((field) => {
        let fieldSchema: z.ZodTypeAny

        switch (field.type) {
            case "text": {
                const textField = field as TextField
                fieldSchema = z.string()

                if (textField.minLength) {
                    fieldSchema = (fieldSchema as z.ZodString).min(
                        textField.minLength,
                        `${field.label} must be at least ${textField.minLength} characters`,
                    )
                }

                if (textField.maxLength) {
                    fieldSchema = (fieldSchema as z.ZodString).max(
                        textField.maxLength,
                        `${field.label} must be at most ${textField.maxLength} characters`,
                    )
                }

                if (textField.pattern) {
                    fieldSchema = (fieldSchema as z.ZodString).regex(
                        new RegExp(textField.pattern),
                        `${field.label} format is invalid`,
                    )
                }

                if (!field.required) {
                    fieldSchema = fieldSchema.optional().or(z.literal(""))
                }
                break
            }

            case "number": {
                const numberField = field as NumberField

                // Improved handling of optional number fields
                if (field.required) {
                    fieldSchema = z.coerce.number({
                        required_error: `${field.label} is required`,
                        invalid_type_error: `${field.label} must be a number`,
                    })

                    if (numberField.min !== undefined) {
                        fieldSchema = (fieldSchema as z.ZodNumber).min(
                            numberField.min,
                            `${field.label} must be at least ${numberField.min}`,
                        )
                    }

                    if (numberField.max !== undefined) {
                        fieldSchema = (fieldSchema as z.ZodNumber).max(
                            numberField.max,
                            `${field.label} must be at most ${numberField.max}`,
                        )
                    }

                    if (numberField.pattern) {
                        fieldSchema = (fieldSchema as z.ZodNumber).refine(
                            (val) => new RegExp(numberField.pattern!).test(val.toString()),
                            {
                                message: `${field.label} format is invalid`,
                            }
                        )
                    }
                } else {
                    // For optional number fields, allow empty string or valid number
                    fieldSchema = z
                        .union([
                            z.string().length(0),
                            z.coerce.number().refine(
                                (val) => {
                                    if (numberField.min !== undefined && val < numberField.min) return false
                                    if (numberField.max !== undefined && val > numberField.max) return false
                                    if (numberField.pattern && !new RegExp(numberField.pattern).test(val.toString())) return false
                                    return true
                                },
                                {
                                    message: `${field.label} must be between ${numberField.min ?? 0} and ${numberField.max ?? "infinity"}${numberField.pattern ? " and match the required format" : ""}`,
                                },
                            ),
                        ])
                        .optional()
                }
                break
            }

            case "switch": {
                fieldSchema = z.boolean().default((field as SwitchField).default ?? false)
                break
            }

            case "select": {
                fieldSchema = z.string()

                if (!field.required) {
                    fieldSchema = fieldSchema.optional()
                }
                break
            }

            case "folder": {
                fieldSchema = z.string()

                if (!field.required) {
                    fieldSchema = fieldSchema.optional()
                }
                break
            }
        }

        schemaFields[field.name] = fieldSchema
    })

    return z.object(schemaFields)
}

// Generate default values based on field configuration
function generateDefaultValues(fields: FormFieldItem[], currentValues?: Record<string, any>) {
    const defaults: Record<string, any> = {}

    fields.forEach((field) => {
        // Utiliser la valeur existante si disponible, sinon utiliser la valeur par défaut
        const existingValue = currentValues?.[field.name]

        if (existingValue !== undefined && existingValue !== null) {
            defaults[field.name] = existingValue
        } else if (field.type === "switch") {
            defaults[field.name] = (field as SwitchField).default ?? false
        } else if (field.type === "number") {
            defaults[field.name] = "" // Keep as empty string for better UX
        } else {
            defaults[field.name] = ""
        }
    })

    return defaults
}

export function DynamicFormModal({ open, title, description, config, currentValues, onCancel, onSubmit }: DynamicFormModalProps) {
    if (!config || JSON.stringify(config) === "{}") return null

    const schema = generateZodSchema(config.form.fields)
    const defaultValues = generateDefaultValues(config.form.fields, currentValues)

    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues,
    })

    const handleSubmit = (data: Record<string, any>) => {
        onSubmit(data)
        form.reset()
    }

    const handleCancel = () => {
        form.reset()
        onCancel()
    }

    const renderField = (field: FormFieldItem, formField: any) => {
        const { value, onChange, onBlur, ref, name } = formField

        switch (field.type) {
            case "text":
                return (
                    <Input
                        placeholder={(field as TextField).placeholder}
                        value={value}
                        onChange={onChange}
                        onBlur={onBlur}
                        ref={ref}
                        name={name}
                    />
                )

            case "number":
                return (
                    <Input
                        type="number"
                        placeholder={(field as NumberField).placeholder}
                        value={value}
                        onChange={onChange}
                        onBlur={onBlur}
                        ref={ref}
                        name={name}
                    />
                )

            case "switch":
                return (
                    <div className="flex items-center space-x-2">
                        <Switch checked={value} onCheckedChange={onChange} name={name} />
                    </div>
                )

            case "select":
                return (
                    <Select value={value} onValueChange={onChange} name={name}>
                        <SelectTrigger>
                            <SelectValue placeholder={(field as SelectField).placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                            {(field as SelectField).options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )

            case "folder":
                return (
                    <FolderSelect
                        value={value}
                        onChange={onChange}
                        disabled={false}
                    />
                )

            default:
                return null
        }
    }

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                        {config.form.fields.map((field) => (
                            <FormField
                                key={field.name}
                                control={form.control}
                                name={field.name}
                                render={({ field: formField }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {field.label}
                                            {field.required && <span className="text-destructive ml-1">*</span>}
                                        </FormLabel>
                                        <FormControl>{renderField(field, formField)}</FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        ))}

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={handleCancel}>
                                Cancel
                            </Button>
                            <Button type="submit">Submit</Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
