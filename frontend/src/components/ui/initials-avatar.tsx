import type * as React from "react"

import { initialsOf, tintHueOf } from "@/lib/initials"
import { cn } from "@/lib/utils"

interface InitialsAvatarProps extends Omit<React.ComponentProps<"span">, "children"> {
  name: string | null | undefined
  size?: "sm" | "md"
}

/** A person or a company as tinted initials. Decorative: the name always sits next to it. */
function InitialsAvatar({ name, size = "md", className, style, ...props }: InitialsAvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="initials-avatar"
      className={cn(
        "tint-avatar grid shrink-0 place-items-center rounded-full font-heading font-medium leading-none",
        size === "md" ? "size-9 text-[15px]" : "size-7 text-xs",
        className,
      )}
      style={{ "--tint": tintHueOf(name ?? ""), ...style } as React.CSSProperties}
      {...props}
    >
      {initialsOf(name)}
    </span>
  )
}

export { InitialsAvatar }
