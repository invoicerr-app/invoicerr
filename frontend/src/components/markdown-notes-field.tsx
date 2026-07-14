import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMemo, useState } from "react"

import DOMPurify from "dompurify"
import MarkdownIt from "markdown-it"
import type React from "react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

// Mirrors the backend's markdown-it config (backend/src/utils/format-text.ts)
// so the preview matches the final PDF output. html:false escapes raw HTML
// in user input instead of rendering it.
const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
})

type MarkdownNotesFieldProps = Omit<React.ComponentProps<"textarea">, "value" | "onChange"> & {
    value?: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}

export function MarkdownNotesField({ value, onChange, ref, className, ...props }: MarkdownNotesFieldProps) {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState("edit")

    const sanitizedHtml = useMemo(() => DOMPurify.sanitize(md.render(value || "")), [value])

    return (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
                <TabsTrigger value="edit">{t("common.markdownNotes.edit")}</TabsTrigger>
                <TabsTrigger value="preview">{t("common.markdownNotes.preview")}</TabsTrigger>
            </TabsList>
            <TabsContent value="edit">
                <Textarea
                    ref={ref}
                    value={value ?? ""}
                    onChange={onChange}
                    className={cn("max-h-40 font-mono text-sm", className)}
                    {...props}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("common.markdownNotes.hint")}</p>
            </TabsContent>
            <TabsContent value="preview">
                <div
                    className="markdown-notes-preview min-h-16 max-h-40 overflow-y-auto rounded-md border px-3 py-2 text-sm"
                    dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                />
            </TabsContent>
        </Tabs>
    )
}
