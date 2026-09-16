import { Moon, Sun, SunMoon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { SettingsSection } from "../settings/_components/settings-section"

const THEME_OPTIONS = [
  { value: "light", icon: Sun, labelKey: "sidebar.theme.light" },
  { value: "dark", icon: Moon, labelKey: "sidebar.theme.dark" },
  { value: "system", icon: SunMoon, labelKey: "sidebar.theme.system" },
] as const

export default function AccountPreferencesPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

  const currentLanguage = SUPPORTED_LANGUAGES.some((l) => l.code === i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : "en"

  const handleLanguageChange = (code: string) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
    i18n.changeLanguage(code)
  }

  return (
    <div className="grid gap-6">
      <SettingsSection
        title={t("account.preferences.language.title")}
        description={t("account.preferences.language.description")}
        dataCy="account-preferences-language-card"
      >
        <Select value={currentLanguage} onValueChange={handleLanguageChange}>
          <SelectTrigger className="w-full sm:w-72" data-cy="account-preferences-language-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((language) => (
              <SelectItem key={language.code} value={language.code}>
                {language.label}
                {language.beta ? " (beta)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsSection>

      <SettingsSection
        title={t("account.preferences.theme.title")}
        description={t("account.preferences.theme.description")}
        dataCy="account-preferences-theme-card"
      >
        {/* A 3-way segmented control, concentric with its own padding (outer rounded-lg, inner
         *  rounded-md options) — the same radius relationship as the shared `TabsList`/`TabsTrigger`
         *  pair, reused here as plain buttons since there is no route or panel per option. */}
        <div
          role="radiogroup"
          aria-label={t("account.preferences.theme.title")}
          className="inline-flex gap-1 rounded-lg bg-muted p-1"
        >
          {THEME_OPTIONS.map((option) => {
            const active = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(option.value)}
                data-cy={`account-preferences-theme-${option.value}`}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <option.icon className="size-4" />
                {t(option.labelKey)}
              </button>
            )
          })}
        </div>
      </SettingsSection>
    </div>
  )
}
