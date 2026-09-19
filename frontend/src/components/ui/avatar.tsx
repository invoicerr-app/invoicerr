import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Initials-only avatar — no image upload anywhere in the product yet, so this is deliberately not
 * a `@radix-ui/react-avatar` wrapper with a load/error state machine for an `AvatarImage` nothing
 * ever renders. Same visual language as shadcn's Avatar (size, radius, fallback styling) without the
 * unused dependency.
 */
function Avatar({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium select-none",
        className,
      )}
      {...props}
    />
  )
}

/** First letter of the first name + first letter of the last name, uppercased. Falls back to the
 *  first letter of the email (nothing better to show for a session still loading firstname/lastname),
 *  then "?" so the fallback circle is never left visually empty. */
export function getInitials(firstname?: string | null, lastname?: string | null, email?: string | null) {
  const first = firstname?.trim()?.[0]
  const last = lastname?.trim()?.[0]
  const initials = `${first ?? ""}${last ?? ""}`.toUpperCase()
  if (initials) return initials
  const emailInitial = email?.trim()?.[0]
  return emailInitial ? emailInitial.toUpperCase() : "?"
}

export { Avatar, AvatarFallback }
