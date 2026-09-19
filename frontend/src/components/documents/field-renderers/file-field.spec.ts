import { describe, expect, it } from "vitest"

import { toPreviewableObjectUrl } from "./file-field"

/**
 * `FileField` hands its preview value straight to an `<img src>`/`<a href>` — always the return value
 * of `URL.createObjectURL()` in practice (a freshly picked `File`, or a downloaded attachment's
 * `Blob`), never text a user typed directly into this component. `toPreviewableObjectUrl` is the
 * explicit scheme check that makes that a checked guarantee rather than an implicit one: only a
 * genuine `blob:` URL is ever rendered, whatever a future refactor of this component might otherwise
 * feed it — and what is rendered is the value THIS function rebuilt from its own parsed `URL`, never
 * the raw input string passed through unchanged.
 */
describe("toPreviewableObjectUrl", () => {
  it("accepts a real object URL and returns it rebuilt from its own parsed URL", () => {
    const input = "blob:https://app.test/3fa6a1b2-0000-4000-8000-000000000000"
    expect(toPreviewableObjectUrl(input)).toBe(input)
  })

  it('rejects null — the "nothing to preview yet" state', () => {
    expect(toPreviewableObjectUrl(null)).toBeNull()
  })

  it("rejects a javascript: URI", () => {
    expect(toPreviewableObjectUrl("javascript:alert(document.cookie)")).toBeNull()
  })

  it("rejects a bare http(s) URL — this component only ever previews its OWN object URLs", () => {
    expect(toPreviewableObjectUrl("https://evil.test/payload.html")).toBeNull()
  })

  it("rejects an empty string", () => {
    expect(toPreviewableObjectUrl("")).toBeNull()
  })

  it("rejects a string that does not parse as a URL at all, rather than throwing", () => {
    expect(toPreviewableObjectUrl("not a url")).toBeNull()
  })
})
