import { Eye, EyeOff } from "lucide-react"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * A password field with its reveal toggle INSIDE the field rather than as a second button beside it:
 * the toggle belongs to the value it reveals, and a separate outlined button next to the input read
 * as a second, unexplained control on the audit's sign-in capture. The toggle is a real button with
 * a name and a pressed state, so a screen reader hears "Show password, toggle button, not pressed".
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function PasswordInput({ className, ...props }, ref) {
    const { t } = useTranslation()
    const [visible, setVisible] = React.useState(false)
    const label = visible ? t("auth.password.hide") : t("auth.password.show")

    return (
      <div className="relative">
        <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tooltip={label}
          aria-label={label}
          aria-pressed={visible}
          disabled={props.disabled}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    )
  },
)
