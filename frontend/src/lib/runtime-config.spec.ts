import { afterEach, describe, expect, it, vi } from "vitest"

import { envOidcProviderId, getEnvVariable, isOidcOnly } from "./runtime-config"

type WindowWithConfig = { __APP_CONFIG__?: Record<string, string | undefined> }

const setConfig = (config: Record<string, string | undefined> | undefined) => {
  ;(window as unknown as WindowWithConfig).__APP_CONFIG__ = config
}

afterEach(() => {
  setConfig(undefined)
  vi.unstubAllEnvs()
})

describe("getEnvVariable", () => {
  it("reads the runtime config written by entrypoint.sh", () => {
    setConfig({ VITE_OIDC_PROVIDER_ID: "pocketid" })
    expect(getEnvVariable("VITE_OIDC_PROVIDER_ID")).toBe("pocketid")
  })

  it("is undefined for a key nobody published, and does not throw with no config at all", () => {
    setConfig(undefined)
    expect(() => getEnvVariable("VITE_NOT_SET")).not.toThrow()
    expect(getEnvVariable("VITE_NOT_SET")).toBeUndefined()
  })
})

describe("envOidcProviderId", () => {
  it("is the published id when the backend registered the environment provider", () => {
    setConfig({ VITE_OIDC_PROVIDER_ID: "pocketid" })
    expect(envOidcProviderId()).toBe("pocketid")
  })

  it("prefers the runtime value over the one baked in at build time", () => {
    // The precedence that lets one image serve every environment: config.json wins, and
    // `import.meta.env` is only the fallback `npm run dev` relies on.
    vi.stubEnv("VITE_OIDC_PROVIDER_ID", "baked-at-build-time")
    setConfig({ VITE_OIDC_PROVIDER_ID: "from-config-json" })

    expect(envOidcProviderId()).toBe("from-config-json")
  })

  it.each([
    undefined,
    "",
    "   ",
  ])("is undefined for the published value %p when nothing is baked in either, so no button is offered", (value) => {
    // entrypoint.sh publishes an EMPTY value when OIDC_CLIENT_ID is unset, and treating "" as
    // "configured" is the bug that produced a sign-in button leading straight to PROVIDER_NOT_FOUND.
    // The build-time variable is stubbed empty too: this repository's own frontend environment
    // defines one, so without the stub this would be asserting against the dev fallback rather than
    // against the rule.
    vi.stubEnv("VITE_OIDC_PROVIDER_ID", "")
    setConfig({ VITE_OIDC_PROVIDER_ID: value })

    expect(envOidcProviderId()).toBeUndefined()
  })
})

describe("isOidcOnly", () => {
  it("is OFF when nothing is published — the default for every instance", () => {
    vi.stubEnv("VITE_OIDC_ONLY", "")
    setConfig({})
    expect(isOidcOnly()).toBe(false)
  })

  it.each(["1", "true", "TRUE", "  true  "])("is on for %p", (value) => {
    setConfig({ VITE_OIDC_ONLY: value })
    expect(isOidcOnly()).toBe(true)
  })

  it.each(["0", "false", "", "   ", "yes"])("is off for %p", (value) => {
    // Mirrors the backend's own parsing: anything that is not "1"/"true" leaves password sign-in on,
    // which is the safe direction — the backend is the one that actually refuses it. The build-time
    // variable is stubbed empty so this tests the rule rather than whatever the environment happens
    // to define.
    vi.stubEnv("VITE_OIDC_ONLY", "")
    setConfig({ VITE_OIDC_ONLY: value })
    expect(isOidcOnly()).toBe(false)
  })
})
