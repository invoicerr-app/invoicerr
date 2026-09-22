import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AuthShell } from "./auth-shell"

type WindowWithConfig = { __APP_CONFIG__?: Record<string, string | undefined> }

const setConfig = (config: Record<string, string | undefined> | undefined) => {
  ;(window as unknown as WindowWithConfig).__APP_CONFIG__ = config
}

afterEach(() => setConfig(undefined))

function renderShell() {
  return render(
    <AuthShell title="Sign in">
      <p>form</p>
    </AuthShell>,
  )
}

/**
 * The beta banner is wired ONCE, inside `AuthShell` (see that file's own comment), rather than
 * duplicated into every auth page — so this is the one place that needs to prove both the "on" and
 * the "off by default" case, instead of repeating the same two assertions in a sign-in spec and a
 * sign-up spec.
 */
describe("<AuthShell> — beta banner", () => {
  it("is absent when no deployment config is published at all — the shape of every real instance until ENABLE_BETA_BANNER is set", () => {
    setConfig(undefined)
    renderShell()

    expect(screen.queryByTestId("beta-banner")).not.toBeInTheDocument()
  })

  it.each(["0", "false", "", undefined])("stays off for the published value %p", (value) => {
    setConfig({ VITE_ENABLE_BETA_BANNER: value })
    renderShell()

    expect(screen.queryByTestId("beta-banner")).not.toBeInTheDocument()
  })

  it.each([
    "1",
    "true",
    "TRUE",
    "  true  ",
  ])("renders the banner, with its exact warning text, for the published value %p", (value) => {
    setConfig({ VITE_ENABLE_BETA_BANNER: value })
    renderShell()

    expect(screen.getByTestId("beta-banner")).toBeInTheDocument()
    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(screen.getByText(/billing runs in test mode and nothing is charged/i)).toBeInTheDocument()
  })

  it("still renders the page's own content alongside the banner — the flag only ever adds text, never hides the form", () => {
    setConfig({ VITE_ENABLE_BETA_BANNER: "true" })
    renderShell()

    expect(screen.getByText("form")).toBeInTheDocument()
  })
})
