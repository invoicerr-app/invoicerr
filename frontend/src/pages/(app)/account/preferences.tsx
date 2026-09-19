import { Moon, Sun, SunMoon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from "@/lib/i18n"
import { authClient } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { usePatch } from "@/hooks/use-fetch"
import { useApplyAccountLocale } from "@/hooks/use-apply-account-locale"
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
  const { data: session } = authClient.useSession()
  const { trigger: savePreferences, lastError: savePreferencesError } = usePatch(
    "/api/auth-extended/preferences",
  )

  // The account's own value wins over whatever this browser had guessed — see this hook's own
  // header. Runs here too (not only once, in the app shell) so this screen shows the right
  // selection even when rendered on its own (this file's own vitest spec), and so a browser that
  // never visited the app shell at all still catches up the moment it lands here.
  const accountLocale = (session as { user?: { locale?: string | null } } | null)?.user?.locale
  useApplyAccountLocale(accountLocale)

  const currentLanguage = SUPPORTED_LANGUAGES.some((l) => l.code === i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : "en"

  const handleLanguageChange = async (code: string) => {
    // Applied locally FIRST and unconditionally: this is a real UI language this picker offers,
    // regardless of whether the backend's own (narrower — five countries + English) render-language
    // catalog happens to carry mail/PDF strings for it too.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
    i18n.changeLanguage(code)

    const result = await savePreferences({ locale: code })
    if (result === null && savePreferencesError.current?.status !== 400) {
      // A 400 here just means "this UI language isn't one of `SUPPORTED_RENDER_LANGUAGES` yet" (a
      // beta picker entry with no document/mail strings behind it) — expected, and not worth
      // bothering the user about since the change above already applied on this device regardless.
      // Anything else (network, 5xx) is a real failure: the account won't remember this choice.
      toast.error(t("account.preferences.language.saveError"))
    }
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
              <SelectItem
                key={language.code}
                value={language.code}
                dataCy={`account-preferences-language-option-${language.code}`}
              >
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
