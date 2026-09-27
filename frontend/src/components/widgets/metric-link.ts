import type { MetricWidgetLink } from "@/components/widgets/types"

/**
 * `MetricWidgetLink` -> the `/documents/:typeId` URL a metric tile's own anchor points at, built with
 * `URLSearchParams` so it matches EXACTLY what `[typeId]/index.tsx` reads back out of the query string
 * (`searchParams.getAll("status")` for repeated `status` keys, `searchParams.get(...)` for the rest):
 * this function and that page are two independent readers of the same contract, so every key here
 * must spell the query param the page actually looks for.
 */
export function buildMetricLinkHref(link: MetricWidgetLink): string {
  const params = new URLSearchParams()
  for (const status of link.status ?? []) params.append("status", status)
  if (link.dateFrom) params.set("dateFrom", link.dateFrom)
  if (link.dateTo) params.set("dateTo", link.dateTo)
  if (link.settlement) params.set("settlement", link.settlement)

  const query = params.toString()
  return `/documents/${link.typeId}${query ? `?${query}` : ""}`
}
