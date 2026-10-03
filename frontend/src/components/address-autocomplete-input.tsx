import * as React from "react"
import { useTranslation } from "react-i18next"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { AddressSuggestion } from "@/hooks/use-address-autocomplete"
import { useAddressAutocomplete, useAddressAutocompleteCapability } from "@/hooks/use-address-autocomplete"

export interface AddressAutocompleteInputProps extends React.ComponentProps<"input"> {
  onSuggestionSelect?: (suggestion: AddressSuggestion) => void
  "data-cy"?: string
}

/**
 * A drop-in replacement for the plain address `<Input>` (#197): same controlled `value`/`onChange`,
 * same `name`/`ref` forwarding a react-hook-form `field` spread relies on, plus an optional
 * suggestion dropdown layered on top. Free typing always works - the dropdown is purely additive,
 * never a control the user must go through, and it renders nothing at all when:
 *   - `ADDRESS_AUTOCOMPLETE_URL` is unset on this instance (`useAddressAutocompleteCapability`
 *     resolves `enabled: false` - no search request is ever fired in this case, see that hook), or
 *   - fewer than 3 characters are typed, or the debounce (~300ms) hasn't settled yet, or
 *   - the configured Photon server timed out, errored, or simply found nothing.
 * In every one of those cases this is exactly a plain `<Input>` - the field never depends on the
 * service being up.
 */
export const AddressAutocompleteInput = React.forwardRef<HTMLInputElement, AddressAutocompleteInputProps>(
  function AddressAutocompleteInput(
    { className, value, onFocus, onBlur, onSuggestionSelect, "data-cy": dataCyValue, ...props },
    ref,
  ) {
    const { t } = useTranslation()
    const [focused, setFocused] = React.useState(false)

    const { data: capability } = useAddressAutocompleteCapability()
    const enabled = Boolean(capability?.enabled)
    const query = typeof value === "string" ? value : ""
    const { suggestions } = useAddressAutocomplete(query, enabled)

    const showDropdown = focused && suggestions.length > 0

    return (
      <div className="relative">
        <Input
          ref={ref}
          value={value}
          autoComplete="off"
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          className={className}
          data-cy={dataCyValue}
          {...props}
        />
        {showDropdown && (
          <div
            role="listbox"
            aria-label={t("component.address-autocomplete.suggestionsLabel")}
            className={cn(
              "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md",
            )}
            data-cy={dataCyValue ? `${dataCyValue}-suggestions` : "address-autocomplete-suggestions"}
          >
            {suggestions.map((suggestion, index) => (
              <button
                // Photon returns candidates with no stable id of their own - the label is already
                // unique within one response (two identical addresses would be the same suggestion).
                key={suggestion.label}
                type="button"
                role="option"
                aria-selected={false}
                // `onMouseDown` (not `onClick`) with `preventDefault`: a click on this button would
                // otherwise blur the input FIRST (the browser's default mousedown focus handling),
                // which closes this dropdown (`focused` -> false) before the click ever fires -
                // preventing that default keeps the input focused so the selection always lands.
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSuggestionSelect?.(suggestion)
                  setFocused(false)
                }}
                className="block w-full px-3 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                data-cy={dataCyValue ? `${dataCyValue}-suggestion-${index}` : undefined}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  },
)
