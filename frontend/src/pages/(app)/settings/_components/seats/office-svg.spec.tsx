import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { OfficeRoom } from "./office-svg"

/**
 * jsdom implements none of these three — `useIsMobile` reads `matchMedia`, `useScale` reads
 * `ResizeObserver` and the SVG element's own `getScreenCTM` (all three effects already guard against
 * a null/missing RESULT, but still need the globals to exist to run at all).
 */
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  // biome-ignore lint/suspicious/noExplicitAny: jsdom's SVGSVGElement has no getScreenCTM at all.
  ;(SVGSVGElement.prototype as any).getScreenCTM = () => null
})

/** Every id `useDraggable` is ever called with, across a render — dnd-kit's own registry is keyed by
 *  this id, so a duplicate here is a real collision in that registry, not just a cosmetic detail. */
const draggableIds: unknown[] = []
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>()
  return {
    ...actual,
    useDraggable: (options: Parameters<typeof actual.useDraggable>[0]) => {
      draggableIds.push(options.id)
      return actual.useDraggable(options)
    },
  }
})

describe("<OfficeRoom> — draggable ids", () => {
  it("gives every FREE desk's chair its own draggable id, never a shared 'seat-undefined'", () => {
    draggableIds.length = 0
    render(
      <OfficeRoom
        seats={4}
        members={[]}
        currentUserId={undefined}
        canManage={true}
        onMove={vi.fn()}
        companyId="company-1"
      />,
    )

    // 4 free desks -> 4 distinct ids in dnd-kit's registry (some hooks/effects settling re-render
    // the tree, so the SAME 4 ids can legitimately appear more than once — the bug this guards
    // against is all of them collapsing onto the ONE shared "seat-undefined" id instead).
    expect(draggableIds.length).toBeGreaterThan(0)
    expect(new Set(draggableIds).size).toBe(4)
    expect(draggableIds).not.toContain("seat-undefined")
  })
})
