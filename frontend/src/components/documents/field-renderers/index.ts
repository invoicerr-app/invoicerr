import { ArrayField } from "./array-field"
import {
  BooleanField,
  DateField,
  LongTextField,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
} from "./primitive-fields"
import { ReferenceField } from "./reference-field"
import { registerFieldRenderer } from "./registry"
import { RowSelectionField } from "./row-selection-field"

/**
 * Registers the closed core set of field-kind renderers. Importing this module is what makes the
 * core kinds renderable — document-form.tsx imports it once, for the side effect, before any
 * DocumentField is rendered.
 *
 * TO ADD A FIELD KIND (core or plugin): write one component matching FieldRendererProps
 * (field-renderers/registry.ts) and call `registerFieldRenderer("yourKind", YourComponent)` —
 * nothing else in the form, the page, or DocumentField changes. A plugin kind must use a prefixed
 * name (e.g. "plugin:acme.rating") so it can never collide with a future core kind.
 */
registerFieldRenderer("text", TextField)
registerFieldRenderer("longText", LongTextField)
registerFieldRenderer("number", NumberField)
registerFieldRenderer("money", MoneyField)
registerFieldRenderer("date", DateField)
registerFieldRenderer("boolean", BooleanField)
registerFieldRenderer("select", SelectField)
registerFieldRenderer("reference", ReferenceField)
registerFieldRenderer("array", ArrayField)
registerFieldRenderer("rowSelection", RowSelectionField)

export { getFieldRenderer, registerFieldRenderer } from "./registry"
export type { FieldRendererComponent, FieldRendererProps } from "./registry"
