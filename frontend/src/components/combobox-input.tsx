import * as React from "react"

import { BetterInput } from "@/components/better-input"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
}

export interface ComboboxInputProps extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  "data-cy"?: string
  value: string
  onChange: (text: string) => void
  onOptionSelect: (option: ComboboxOption) => void
  options: readonly ComboboxOption[]
}

/**
 * A text input that also behaves as a select: the list opens on focus or click, narrows to what is
 * typed, and the arrow keys and Enter pick an entry, while any other text is kept as typed.
 */
export function ComboboxInput({
  value,
  onChange,
  onOptionSelect,
  options,
  onBlur,
  onFocus,
  onClick,
  onKeyDown,
  disabled,
  className,
  "data-cy": dataCy,
  ...props
}: Readonly<ComboboxInputProps>) {
  const listId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const listRef = React.useRef<HTMLDivElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const query = filter.trim().toLowerCase()
  const visible = query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options
  const expanded = open && !disabled && visible.length > 0

  // Escape closes the list only: a dialog around the field listens on the document, so the key is
  // stopped at the window, before it gets there.
  React.useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !rootRef.current?.contains(event.target as Node)) return
      event.stopPropagation()
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [expanded])

  React.useEffect(() => {
    if (!expanded || activeIndex < 0) return
    listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: "nearest" })
  }, [expanded, activeIndex])

  const show = () => {
    if (disabled) return
    setFilter("")
    setActiveIndex(-1)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setActiveIndex(-1)
  }

  const pick = (option: ComboboxOption) => {
    close()
    onOptionSelect(option)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) {
        show()
        return
      }
      if (!visible.length) return
      const step = event.key === "ArrowDown" ? 1 : -1
      setActiveIndex((index) => Math.max(0, Math.min(visible.length - 1, index + step)))
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault()
      if (activeIndex >= 0) pick(visible[activeIndex])
      else close()
    } else if (event.key === "Tab") {
      close()
    }
  }

  return (
    <div ref={rootRef} className="relative">
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
        onFocus={(event) => {
          show()
          onFocus?.(event)
        }}
        onClick={(event) => {
          if (!open) show()
          onClick?.(event)
        }}
        onChange={(event) => {
          setOpen(true)
          setFilter(event.target.value)
          setActiveIndex(-1)
          onChange(event.target.value)
        }}
        onBlur={(event) => {
          close()
          onBlur?.(event)
        }}
        onKeyDown={handleKeyDown}
      />
      {expanded && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full min-w-40 overflow-auto rounded-md border bg-popover p-1 shadow-md"
          data-cy={dataCy ? `${dataCy}-options` : undefined}
        >
          {visible.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              // mousedown, not click: a click would blur the input first and close the list before it fires.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(option)
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "cursor-pointer rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                index === activeIndex &&
                  "bg-accent text-accent-foreground outline-2 -outline-offset-2 outline-focus",
              )}
              data-cy={dataCy ? `${dataCy}-option-${option.value}` : undefined}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
