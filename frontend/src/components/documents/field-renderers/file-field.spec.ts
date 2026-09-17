import { describe, expect, it } from "vitest"

import { isPreviewableObjectUrl } from "./file-field"

/**
 * `FileField` hands `previewUrl` straight to an `<img src>`/`<a href>` — always the return value of
 * `URL.createObjectURL()` in practice (a freshly picked `File`, or a downloaded attachment's `Blob`),
 * never text a user typed directly into this component. `isPreviewableObjectUrl` is the explicit
 * scheme check that makes that a checked guarantee rather than an implicit one: only a genuine
 * `blob:` URL is ever rendered, whatever a future refactor of this component might otherwise feed it.
 */
describe("isPreviewableObjectUrl", () => {
  it("accepts a real object URL", () => {
    expect(isPreviewableObjectUrl("blob:https://app.test/3fa6a1b2-0000-4000-8000-000000000000")).toBe(true)
  })

  it('rejects null — the "nothing to preview yet" state', () => {
    expect(isPreviewableObjectUrl(null)).toBe(false)
  })

  it("rejects a javascript: URI", () => {
    expect(isPreviewableObjectUrl("javascript:alert(document.cookie)")).toBe(false)
  })

  it("rejects a bare http(s) URL — this component only ever previews its OWN object URLs", () => {
    expect(isPreviewableObjectUrl("https://evil.test/payload.html")).toBe(false)
  })

  it("rejects an empty string", () => {
    expect(isPreviewableObjectUrl("")).toBe(false)
  })
})
