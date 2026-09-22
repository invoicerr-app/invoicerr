import { useEffect } from "react"

import { activeCauseDay } from "@/brand/cause-days"

/**
 * `<link rel="icon">` has no reactive binding of its own — index.html sets `favicon.svg` once, at
 * load, and nothing in the SPA lifecycle ever revisits it. On the calendar days `activeCauseDay`
 * names, this repoints that one SVG `<link>` at the matching `/brand/causes/<variant>.svg` for the
 * rest of the tab's life, mirroring `BrandMark`'s own in-page swap. It deliberately leaves the PNG
 * fallback `<link>`s (`favicon-32.png` etc.) alone: those exist only for the browsers that can't
 * render an SVG favicon at all (see index.html's own comment), and a cause day is a nice-to-have,
 * not worth a 16-variant PNG set for that narrower audience.
 */
export function useCauseDayFavicon() {
  useEffect(() => {
    const cause = activeCauseDay(new Date())
    if (!cause) return

    const svgIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
    if (!svgIcon) return

    const original = svgIcon.getAttribute("href")
    svgIcon.setAttribute("href", `/brand/causes/${cause.variant}.svg`)
    return () => {
      if (original !== null) svgIcon.setAttribute("href", original)
    }
  }, [])
}

/** Rendered once at the app root purely for its `useEffect` — see `useCauseDayFavicon` above. */
export function CauseDayFavicon() {
  useCauseDayFavicon()
  return null
}
