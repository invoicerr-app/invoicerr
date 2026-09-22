import { describe, expect, it } from "vitest"

import { isHtmlEmpty } from "./templates.settings"

/**
 * `isHtmlEmpty` decides whether the Save button on an email-template editor is disabled — a TipTap
 * document that has been emptied out still carries markup (`<p></p>`), never a bare `""`, so this
 * strips tags before checking. It used to do that with a single `/<[^>]*>/g` regex pass, which is not
 * safe against a nested/malformed tag: matching the first `<` to the first `>` it finds lets an inner
 * tag's own closing bracket close the OUTER one too, and can leave a literal `<script` behind in what
 * the function then treats as "plain text". Going through DOMPurify (a real, inert parser) instead
 * closes that class of bug — this reproduces the standard PoC for it.
 */
describe("isHtmlEmpty", () => {
  it("is true for a fresh, markup-only TipTap document", () => {
    expect(isHtmlEmpty("<p></p>")).toBe(true)
    expect(isHtmlEmpty("")).toBe(true)
  })

  it("is false once there is real text", () => {
    expect(isHtmlEmpty("<p>Hello</p>")).toBe(false)
  })

  it("treats a template that carries only a <script> as EMPTY — a naive regex strip does not", () => {
    // The old `.replace(/<[^>]*>/g, "")` strips "<script>alert(1)</script>" down to the bare word
    // "alert(1)" (both tags removed, the payload's own TEXT survives) — non-empty, so Save would stay
    // enabled on a template with no real content at all. DOMPurify drops a `<script>` tag AND its
    // content by construction, so this is correctly "nothing to see here".
    expect(isHtmlEmpty("<script>alert(document.cookie)</script>")).toBe(true)
  })

  it("is false for real text sitting next to a nested/malformed tag — the tag never masks the content", () => {
    // `<scr<script>` is the standard incomplete-multi-character-sanitization PoC: a single regex pass
    // matches the first `<` to the first `>` it finds, letting the inner tag's own closing bracket
    // close the OUTER one too. Whatever that leaves behind, the genuine text after it ("Hello") must
    // still be recognized as real content.
    expect(isHtmlEmpty("<p><scr<script>alert(1)</script>ipt>Hello</p>")).toBe(false)
  })
})
