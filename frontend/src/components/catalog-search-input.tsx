import * as React from "react"
import { useTranslation } from "react-i18next"

import { BetterInput } from "@/components/better-input"
import { useCatalogSearch } from "@/hooks/use-catalog-search"
import { cn } from "@/lib/utils"

export interface CatalogSearchInputProps extends React.ComponentProps<"input"> {
  "data-cy"?: string
  entity: string
  onCatalogSelect: (id: string) => void
}

/**
 * A free-text input with an additive catalog dropdown: typing never depends on the list, which only
 * appears once the search returns matches and never replaces what the user typed until one is picked.
 */
export function CatalogSearchInput({
  entity,
  onCatalogSelect,
  value,
  onChange,
  onBlur,
  onKeyDown,
  disabled,
  className,
  "data-cy": dataCy,
  ...props
}: Readonly<CatalogSearchInputProps>) {
  const { t } = useTranslation()
  const listId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)

  const query = typeof value === "string" ? value : ""
  const { options } = useCatalogSearch(entity, query, open && !disabled)
  const expanded = open && options.length > 0

  const close = () => {
    setOpen(false)
    setActiveIndex(-1)
  }

  const pick = (id: string) => {
    close()
    onCatalogSelect(id)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!expanded) return
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setActiveIndex((index) => (index + step + options.length) % options.length)
    } else if (event.key === "Enter" && expanded && activeIndex >= 0) {
      event.preventDefault()
      pick(options[activeIndex].id)
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault()
      close()
    }
  }

  return (
    <div className="relative">
      <BetterInput
        {...props}
        value={value}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        className={className}
        data-cy={dataCy}
        onChange={(event) => {
          setOpen(true)
          setActiveIndex(-1)
          onChange?.(event)
        }}
        onBlur={(event) => {
          close()
          onBlur?.(event)
        }}
        onKeyDown={handleKeyDown}
      />
      {expanded && (
        <div
          id={listId}
          role="listbox"
          aria-label={t("component.catalog-search.suggestionsLabel")}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md"
          data-cy={dataCy ? `${dataCy}-suggestions` : "catalog-search-suggestions"}
        >
          {options.map((option, index) => (
            <div
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              // mousedown, not click: a click would blur the input first and close the list before it fires.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(option.id)
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "block w-full cursor-pointer px-3 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground",
                index === activeIndex && "bg-accent text-accent-foreground",
              )}
              data-cy={`catalog-search-option-${index}`}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
