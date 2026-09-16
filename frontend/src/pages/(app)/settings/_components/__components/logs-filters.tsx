"use client"

import { Calendar, RefreshCw, Search } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { LogLevel } from "../logs.settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type LogsFiltersProps = {
  levelFilter: LogLevel[]
  setLevelFilter: (levels: LogLevel[]) => void
  categoryFilter: string[]
  setCategoryFilter: (categories: string[]) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  dateRange: { from: Date | null; to: Date | null }
  setDateRange: (range: { from: Date | null; to: Date | null }) => void
  categories: string[]
  totalLogs: number
  filteredCount: number
  onRefresh: () => void
}

const LOG_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]

/** The chip a log LEVEL renders as, everywhere one appears (this bar's own toggle, the table row, the
 *  detail dialog) — mapped onto the semantic tokens rather than a raw palette colour so light/dark and
 *  the app's own accent stay in sync. Duplicated per-file (this screen has no shared module of its
 *  own in scope) rather than centralized. FATAL is the one level a plain `Badge` variant can't reach
 *  (solid `destructive` is already spent on it) — everything below it, including ERROR, gets the
 *  softer destructive fill so FATAL still reads as the loudest row on screen. */
function levelBadgeProps(level: LogLevel): {
  variant?: "secondary" | "warning" | "info" | "destructive"
  className?: string
} {
  switch (level) {
    case "DEBUG":
      return { variant: "secondary" }
    case "INFO":
      return { variant: "info" }
    case "WARN":
      return { variant: "warning" }
    case "ERROR":
      return { className: "border-transparent bg-destructive-soft text-destructive-soft-foreground" }
    case "FATAL":
      return { variant: "destructive" }
  }
}

export function LogsFilters({
  levelFilter,
  setLevelFilter,
  categoryFilter,
  setCategoryFilter,
  searchQuery,
  setSearchQuery,
  dateRange,
  setDateRange,
  categories,
  totalLogs,
  filteredCount,
  onRefresh,
}: LogsFiltersProps) {
  const { t } = useTranslation()

  function toggleLevel(level: LogLevel) {
    if (levelFilter.includes(level)) {
      setLevelFilter(levelFilter.filter((l) => l !== level))
    } else {
      setLevelFilter([...levelFilter, level])
    }
  }

  function toggleCategory(category: string) {
    if (categoryFilter.includes(category)) {
      setCategoryFilter(categoryFilter.filter((c) => c !== category))
    } else {
      setCategoryFilter([...categoryFilter, category])
    }
  }

  function clearFilters() {
    setLevelFilter([])
    setCategoryFilter([])
    setSearchQuery("")
    setDateRange({ from: null, to: null })
  }

  const hasActiveFilters =
    levelFilter.length > 0 || categoryFilter.length > 0 || searchQuery || dateRange.from || dateRange.to

  return (
    <div className="flex flex-wrap items-center gap-3 border-b pb-4">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("settings.logs.filters.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-1.5">
        {LOG_LEVELS.map((level) => {
          const active = levelFilter.includes(level)
          const { variant, className } = levelBadgeProps(level)
          return (
            <Badge
              key={level}
              variant={active ? variant : "outline"}
              className={cnCursor(active ? className : undefined)}
              onClick={() => toggleLevel(level)}
            >
              {level}
            </Badge>
          )
        })}
      </div>

      {categories.length > 0 && (
        <Select
          value={categoryFilter[0] || "all"}
          onValueChange={(value) => {
            if (value === "all") {
              setCategoryFilter([])
            } else {
              toggleCategory(value)
            }
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("settings.logs.filters.allCategories")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("settings.logs.filters.allCategories")}</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Calendar />
            {dateRange.from ? (
              dateRange.to ? (
                <>
                  {dateRange.from.toLocaleDateString()} - {dateRange.to.toLocaleDateString()}
                </>
              ) : (
                dateRange.from.toLocaleDateString()
              )
            ) : (
              t("settings.logs.filters.dateRange")
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="grid gap-2 p-3">
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.logs.filters.dateFrom")}
              </span>
              <CalendarComponent
                mode="single"
                selected={dateRange.from || undefined}
                onSelect={(date) => setDateRange({ ...dateRange, from: date || null })}
              />
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.logs.filters.dateTo")}
              </span>
              <CalendarComponent
                mode="single"
                selected={dateRange.to || undefined}
                onSelect={(date) => setDateRange({ ...dateRange, to: date || null })}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        onClick={onRefresh}
        variant="outline"
        size="icon"
        aria-label={t("settings.common.refresh")}
        tooltip={t("settings.common.refresh")}
      >
        <RefreshCw />
      </Button>

      {hasActiveFilters && (
        <Button type="button" onClick={clearFilters} variant="ghost" size="sm">
          {t("settings.logs.filters.clear")}
        </Button>
      )}

      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        {t("settings.logs.filters.showing", { filtered: filteredCount, total: totalLogs })}
      </span>
    </div>
  )
}

/** `cursor-pointer` on every level chip (they are all clickable toggles) — kept as a tiny helper only
 *  so the ternary above stays readable next to the variant/className pair it already returns. */
function cnCursor(className?: string) {
  return ["cursor-pointer", className].filter(Boolean).join(" ")
}
