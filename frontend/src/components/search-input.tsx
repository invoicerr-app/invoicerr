import { Check, ChevronDown, X } from "lucide-react"
import { cn, dataCy } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Option {
    label: string
    value: string
}

interface SearchSelectProps {
    options: Option[]
    allOptions?: Option[]
    value?: string[] | string
    onValueChange?: (value: string[] | string) => void
    onSearchChange?: (search: string) => void
    placeholder?: string
    searchPlaceholder?: string
    noResultsText?: string
    className?: string
    disabled?: boolean
    multiple?: boolean
    noResultsComponent?: React.ReactNode // Ajout d'une propriété pour un composant personnalisé
    'data-cy'?: string
}

export default function SearchSelect({
    options = [],
    allOptions,
    value = [],
    onValueChange,
    onSearchChange,
    placeholder = "Select an option...",
    searchPlaceholder = "Search...",
    noResultsText = "No options available",
    className,
    disabled = false,
    multiple = false,
    noResultsComponent,
    'data-cy': dataCyValue,
}: SearchSelectProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [searchValue, setSearchValue] = useState("")
    const containerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const handleSearchChange = (search: string) => {
        setSearchValue(search)
        onSearchChange?.(search)
    }

    const getOptionLabel = (optionValue: string) => {
        const searchOptions = allOptions || options
        return searchOptions.find((option) => option.value === optionValue)?.label
    }

    const isSelected = (optionValue: string) => {
        if (multiple) return (value as string[]).includes(optionValue)
        return value === optionValue
    }

    const handleOptionSelect = (optionValue: string) => {
        if (multiple) {
            const val = value as string[]
            const newValue = val.includes(optionValue)
                ? val.filter((v) => v !== optionValue)
                : [...val, optionValue]
            onValueChange?.(newValue)
        } else {
            onValueChange?.(optionValue)
            setIsOpen(false)
        }
    }

    const handleRemoveOption = (optionValue: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (multiple) {
            const val = value as string[]
            const newValue = val.filter((v) => v !== optionValue)
            onValueChange?.(newValue)
        } else {
            onValueChange?.("")
        }
    }

    const toggleDropdown = () => {
        if (!disabled) {
            setIsOpen(!isOpen)
            if (!isOpen) setTimeout(() => inputRef.current?.focus(), 0)
        }
    }

    const renderNoResults = () => {
        if (noResultsComponent) return noResultsComponent
        return <p className="text-muted-foreground text-center">{noResultsText}</p>
    }

    return (
        <div ref={containerRef} className={cn("relative w-full", className)} {...(dataCyValue ? dataCy(dataCyValue) : {})}>
            <Button
                type="button"
                variant="outline"
                onClick={toggleDropdown}
                disabled={disabled}
                className={cn(
                    "w-full justify-between text-left font-normal h-9 min-h-8 p-3",
                    (!multiple && !value) || (multiple && !(value as string[]).length) ? "text-muted-foreground" : "",
                )}
            >
                <div className="flex flex-wrap gap-1 flex-1 items-center">
                    {multiple ? (
                        !(value as string[]).length ? (
                            <span>{placeholder}</span>
                        ) : (
                            (value as string[]).map((optionValue) => (
                                <Badge key={optionValue} variant="secondary" className="text-xs">
                                    {getOptionLabel(optionValue)}
                                    <button
                                        type="button"
                                        onClick={(e) => handleRemoveOption(optionValue, e)}
                                        className="ml-1 hover:bg-muted rounded-full p-0.5"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))
                        )
                    ) : getOptionLabel(value as string) ? (
                        <span>{getOptionLabel(value as string)}</span>
                    ) : (
                        <span>{placeholder}</span>
                    )}
                </div>
                <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", isOpen && "rotate-180")} />
            </Button>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-md">
                    <div className="p-2 border-b">
                        <Input
                            ref={inputRef}
                            type="text"
                            placeholder={searchPlaceholder}
                            value={searchValue}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="h-8"
                        />
                    </div>

                    <div className="max-h-60 overflow-auto p-1 flex flex-col gap-1" {...(dataCyValue ? dataCy(`${dataCyValue}-options`) : {})}>
                        {options.length === 0 && renderNoResults()}
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => handleOptionSelect(option.value)}
                                className={cn(
                                    "w-full flex items-center justify-between px-3 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground",
                                    isSelected(option.value) && "bg-accent",
                                )}
                                {...(dataCyValue ? dataCy(`${dataCyValue}-option-${option.label.toLowerCase().replace(/\s+/g, '-')}`) : {})}
                            >
                                <span>{option.label}</span>
                                {isSelected(option.value) && <Check className="h-4 w-4" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
