import { Placeholder } from "@tiptap/extensions"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  Bold as BoldIcon,
  Braces,
  ChevronDown,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from "lucide-react"
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

// The editor instance every toolbar sub-component below acts on, shared via context rather than
// threaded as a prop through each one — every sub-component needs it, and nothing else varies per
// level. Declared once, at module scope, so it never gets re-created across renders.
const EditorContext = createContext<ReturnType<typeof useEditor> | null>(null)
function useEditorInstance() {
  return useContext(EditorContext)
}

/** The current block's label — `activeLevel` selects one of three literal `t()` calls rather than a
 *  templated key, so the i18n static checker (`scripts/i18n-check.mjs`, which only recognises string
 *  literals passed to `t()`) can see and validate all three keys. */
function headingLabel(t: (key: string) => string, activeLevel: 1 | 2 | 3 | undefined): string {
  if (activeLevel === 1) return t("component.rich-text-editor.heading1")
  if (activeLevel === 2) return t("component.rich-text-editor.heading2")
  if (activeLevel === 3) return t("component.rich-text-editor.heading3")
  return t("component.rich-text-editor.paragraph")
}

/**
 * A link's URL, read from the current selection's own mark when one is active — the popover reopens
 * pre-filled with the link being edited rather than always starting blank, the same "don't discard
 * what's already there" courtesy `SystemTemplateCard`'s own re-sync effect extends to a whole template.
 */
function LinkControl({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const editor = useEditorInstance()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const active = editor?.isActive("link") ?? false

  if (!editor) return null

  function applyLink() {
    const trimmed = url.trim()
    if (!trimmed) {
      editor?.chain().focus().unsetLink().run()
    } else {
      editor?.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run()
    }
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setUrl(editor.getAttributes("link").href ?? "")
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="icon"
          disabled={disabled}
          tooltip={t("component.rich-text-editor.link")}
          aria-label={t("component.rich-text-editor.link")}
          data-cy="rich-text-editor-link"
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="start">
        <Input
          autoFocus
          value={url}
          placeholder={t("component.rich-text-editor.linkUrlPlaceholder")}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              applyLink()
            }
          }}
          data-cy="rich-text-editor-link-input"
        />
        <div className="flex justify-end gap-2">
          {active && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                editor.chain().focus().unsetLink().run()
                setOpen(false)
              }}
            >
              <Unlink />
              {t("component.rich-text-editor.removeLink")}
            </Button>
          )}
          <Button type="button" size="sm" onClick={applyLink} data-cy="rich-text-editor-link-apply">
            {t("component.rich-text-editor.linkApply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The paragraph/H1/H2/H3 switcher, collapsed into one dropdown — a row of four separate toggle
 *  buttons would be more toolbar chrome than "minimal" calls for, and only one of the four can ever
 *  be active for the current selection anyway. */
function HeadingMenu({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const editor = useEditorInstance()
  if (!editor) return null

  const activeLevel = ([1, 2, 3] as const).find((level) => editor.isActive("heading", { level }))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="gap-1"
          data-cy="rich-text-editor-heading-menu"
        >
          {headingLabel(t, activeLevel)}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
          {t("component.rich-text-editor.paragraph")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          {t("component.rich-text-editor.heading1")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          {t("component.rich-text-editor.heading2")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          {t("component.rich-text-editor.heading3")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Insert a variable": the menu is built ENTIRELY from `variables`, which the caller reads from the
 *  same API response the editor's own preview is built from (see `templates.settings.tsx`) — never a
 *  list hard-coded here, so a variable this screen offers is always one the backend's own render
 *  engine actually substitutes. Inserting one writes plain `{key}` text at the cursor: an ordinary
 *  text node in the html, which is exactly what the server's own single-brace interpolation
 *  (`documents/actions/email-template.ts`) expects — no new markup, no mark, nothing a WYSIWYG
 *  round-trip could mangle. */
function VariableMenu({ variables, disabled }: { variables: Record<string, string>; disabled: boolean }) {
  const { t } = useTranslation()
  const editor = useEditorInstance()
  const keys = Object.keys(variables)
  if (!editor || keys.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="ml-auto gap-1.5"
          data-cy="rich-text-editor-insert-variable"
        >
          <Braces className="size-3.5" />
          {t("component.rich-text-editor.insertVariable")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {keys.map((key) => (
          <DropdownMenuItem
            key={key}
            className="font-mono"
            data-cy={`rich-text-editor-variable-${key}`}
            onSelect={() => editor.chain().focus().insertContent(`{${key}}`).run()}
          >
            {`{${key}}`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface RichTextEditorProps {
  id?: string
  /** HTML string — the same shape `DocumentEmailTemplate.html`/`MailTemplate.body` store server-side. */
  value: string
  onChange: (html: string) => void
  readOnly?: boolean
  placeholder?: string
  /** The placeholder vocabulary to offer via "Insert a variable" — keys only matter, mapped to sample
   *  values purely because that is the shape the `/email-templates` endpoints already return (see
   *  `describeDocumentEmailVocabulary`, backend). Omit or pass `{}` to hide the menu entirely. */
  variables?: Record<string, string>
  className?: string
}

/**
 * A minimal WYSIWYG editor for the email templates screen (TipTap + StarterKit): bold/italic/
 * underline, three heading levels, bullet/ordered lists, blockquote, links, undo/redo, plus an
 * "Insert a variable" menu. Value and onChange are both plain HTML strings — this component owns no
 * markup transformation beyond what StarterKit itself renders, so what is typed here is exactly what
 * `sanitize-email-html.ts` filters and `email-template.ts` interpolates server-side.
 *
 * Read-only mode keeps the toolbar unmounted rather than merely disabled, matching the read-only
 * `Input`s the rest of this screen already falls back to for a MEMBER (`templates.settings.tsx`).
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  readOnly,
  placeholder,
  variables,
  className,
}: RichTextEditorProps) {
  const { t } = useTranslation()

  const extensions = useMemo(
    () => [StarterKit, Placeholder.configure({ placeholder: placeholder ?? "" })],
    [placeholder],
  )

  // The html WE last emitted through `onChange`, updated synchronously inside `onUpdate` — i.e. before
  // React has necessarily re-rendered this component with the matching `value` prop. This is what lets
  // the resync effect below tell "value is merely OUR OWN last edit, still catching up through the
  // parent's state" apart from "value changed for a genuine external reason" — see that effect's own
  // header for why `value !== editor.getHTML()` alone was not a safe enough test.
  const lastEmittedHtml = useRef(value)

  const editor = useEditor({
    extensions,
    content: value,
    editable: !readOnly,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        "aria-label": t("component.rich-text-editor.editorAriaLabel"),
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML()
      lastEmittedHtml.current = html
      onChange(html)
    },
  })

  // Keeps the editor editable/read-only in sync with the prop — `useEditor`'s own `editable` option is
  // only read at CREATION time, not reactively.
  useEffect(() => {
    if (editor && editor.isEditable === !!readOnly) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // External content sync (a save's own re-sync effect, a "reset to default", switching which
  // template's card is open) — deliberately conservative about calling `setContent()`, which replaces
  // the ENTIRE doc and can drop a keystroke that raced ahead of React's own render of this effect:
  //  - never while the editor HAS FOCUS: a focused editor is, by definition, the one place the user (or
  //    a fast-typing Cypress `.type()`, or an IME still composing) is actively editing — any `value`
  //    this component receives while that is true is this editor's OWN edit still on its way back
  //    through the parent's state, never something to overwrite it with. Confirmed the hard way: CI run
  //    34951199307, `.ProseMirror`'s own typed text missing SPACES specifically (`Corpsdistinctif`,
  //    `àvoir`) — a `setContent()` firing mid-keystroke with a `value` one keystroke behind wins the
  //    race against `editor.getHTML()` having already moved on, and quietly drops what was typed in
  //    between. A genuinely external change (loading a different template, "reset to default") always
  //    lands while this editor is NOT focused — the click that triggers it blurs the contenteditable
  //    first.
  //  - never when `value` is exactly what THIS editor itself last emitted (`lastEmittedHtml`, updated
  //    synchronously in `onUpdate`, above) — the second, redundant line of defence for the same race:
  //    even a blur-timed re-render carrying a `value` that is only an echo of our own latest edit must
  //    not re-apply itself over a doc that may already differ by selection/marks the html string can't
  //    capture.
  // Only past both guards does a real `value !== editor.getHTML()` mismatch mean an ACTUAL external
  // value — the only case `setContent()` is for.
  useEffect(() => {
    if (!editor) return
    if (editor.isFocused) return
    if (value === lastEmittedHtml.current) return
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false })
      lastEmittedHtml.current = value
    }
  }, [value, editor])

  const disabled = !!readOnly

  return (
    <EditorContext.Provider value={editor}>
      <div
        className={cn(
          "border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
          disabled && "opacity-70",
          className,
        )}
      >
        {!disabled && (
          <>
            <div className="flex flex-wrap items-center gap-1 p-1.5">
              <HeadingMenu disabled={disabled} />
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <Button
                type="button"
                variant={editor?.isActive("bold") ? "secondary" : "ghost"}
                size="icon"
                disabled={disabled}
                tooltip={t("component.rich-text-editor.bold")}
                aria-label={t("component.rich-text-editor.bold")}
                data-cy="rich-text-editor-bold"
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                <BoldIcon />
              </Button>
              <Button
                type="button"
                variant={editor?.isActive("italic") ? "secondary" : "ghost"}
                size="icon"
                disabled={disabled}
                tooltip={t("component.rich-text-editor.italic")}
                aria-label={t("component.rich-text-editor.italic")}
                data-cy="rich-text-editor-italic"
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              >
                <ItalicIcon />
              </Button>
              <Button
                type="button"
                variant={editor?.isActive("underline") ? "secondary" : "ghost"}
                size="icon"
                disabled={disabled}
                tooltip={t("component.rich-text-editor.underline")}
                aria-label={t("component.rich-text-editor.underline")}
                data-cy="rich-text-editor-underline"
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
              >
                <UnderlineIcon />
              </Button>
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <Button
                type="button"
                variant={editor?.isActive("bulletList") ? "secondary" : "ghost"}
                size="icon"
                disabled={disabled}
                tooltip={t("component.rich-text-editor.bulletList")}
                aria-label={t("component.rich-text-editor.bulletList")}
                data-cy="rich-text-editor-bullet-list"
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                <List />
              </Button>
              <Button
                type="button"
                variant={editor?.isActive("orderedList") ? "secondary" : "ghost"}
                size="icon"
                disabled={disabled}
                tooltip={t("component.rich-text-editor.orderedList")}
                aria-label={t("component.rich-text-editor.orderedList")}
                data-cy="rich-text-editor-ordered-list"
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered />
              </Button>
              <Button
                type="button"
                variant={editor?.isActive("blockquote") ? "secondary" : "ghost"}
                size="icon"
                disabled={disabled}
                tooltip={t("component.rich-text-editor.blockquote")}
                aria-label={t("component.rich-text-editor.blockquote")}
                data-cy="rich-text-editor-blockquote"
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              >
                <Quote />
              </Button>
              <LinkControl disabled={disabled} />
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || !editor?.can().undo()}
                tooltip={t("component.rich-text-editor.undo")}
                aria-label={t("component.rich-text-editor.undo")}
                onClick={() => editor?.chain().focus().undo().run()}
              >
                <Undo2 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || !editor?.can().redo()}
                tooltip={t("component.rich-text-editor.redo")}
                aria-label={t("component.rich-text-editor.redo")}
                onClick={() => editor?.chain().focus().redo().run()}
              >
                <Redo2 />
              </Button>
              {variables && Object.keys(variables).length > 0 && (
                <VariableMenu variables={variables} disabled={disabled} />
              )}
            </div>
            <Separator />
          </>
        )}
        <div className="rich-text-editor" data-testid="rich-text-editor">
          <EditorContent editor={editor} />
        </div>
      </div>
    </EditorContext.Provider>
  )
}
