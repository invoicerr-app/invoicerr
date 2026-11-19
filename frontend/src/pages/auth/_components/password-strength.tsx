import { useTranslation } from "react-i18next"

import { passwordScore } from "@/lib/password-rules"
import { cn } from "@/lib/utils"

const LEVELS = [
  { key: "weak", fill: "bg-destructive" },
  { key: "fair", fill: "bg-warning-foreground" },
  { key: "good", fill: "bg-primary" },
  { key: "strong", fill: "bg-success-foreground" },
] as const

/** Four segments under the password field, one per rule met; the label names the level in words so
 *  colour is never the only cue. Renders nothing while the field is empty — a meter at zero is noise. */
export function PasswordStrength({ value }: { value: string }) {
  const { t } = useTranslation()
  if (!value) return null
  const score = passwordScore(value)
  const level = LEVELS[Math.max(0, score - 1)]

  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {LEVELS.map((segment, index) => (
          <span
            key={segment.key}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-150",
              index < score ? level.fill : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("auth.signup.form.password.strength.label")}{" "}
        <span className="font-medium text-foreground">
          {t(`auth.signup.form.password.strength.${level.key}`)}
        </span>
      </p>
    </div>
  )
}
