/**
 * The top-view SVG furniture catalog `DeskUnit` (in `office-svg.tsx`) draws from, one seeded pick per
 * desk (`desk-rng.ts#pickDeskFurniture`). Every piece is a small, literal top-view shape — no
 * illustration flourish, no gradients — using only the Lagune tokens already registered in
 * `index.css`'s `@theme inline` (`fill-*`/`stroke-*` utilities resolve to the SAME CSS custom
 * properties `bg-*`/`text-*` do elsewhere in this app), so the room reads correctly in both themes for
 * free, the same as every other page.
 *
 * Every piece is drawn in a LOCAL, desk-relative coordinate box (`office-svg.tsx`'s own `UNIT_W`/
 * `UNIT_H`) — these components take no position props beyond what they need to place themselves within
 * that box, and the caller (`DeskCell`) is the only place that knows where a desk sits in the room.
 *
 * ## Which edge is which (top view, chair at `y ≈ 16`, desk spanning `y: [35, 88]`)
 * `NEAR_Y` (35) is the edge CLOSEST to the chair — where a real desk's keyboard/mouse sit, right in
 * front of the person. `FAR_Y` (88) is the edge FARTHEST from the chair — toward the pair's shared
 * centre, where the monitor sits, screen facing back toward the person across the desk. Getting these
 * two swapped (screen in front of the chair, keyboard at the far edge) was the exact bug a real
 * top-view desk photo reference caught this file on — every desk piece below reads its Y position off
 * these two constants for that reason, never a bare number restated per piece.
 */
import type { DeskDisplay, DeskFurniture, MouseSide } from "./desk-rng"

// NEAR_Y a bit further from the chair than the desk's own bare edge would need (leaves a visible gap
// between chair-back and desk — too tight a gap read as the chair being pushed INTO the desk,
// reported directly: "le siège est avancé").
const NEAR_Y = 40
const FAR_Y = 88

/** The desk surface itself — a plain rectangle, thin-stroked, never filled solid, read as a literal
 *  top-view desktop. An earlier pass also had an L-shaped "corner" desk variant; it went through
 *  several redraws (wrong T-vs-L shape, then a wing reported back as bigger than the fix it replaced)
 *  and was dropped rather than keep iterating on a shape that never read cleanly at this size — every
 *  desk is this same rectangle now. */
export function DeskSurface({ className }: { className?: string }) {
  return (
    <rect
      x={10}
      y={NEAR_Y}
      width={100}
      height={FAR_Y - NEAR_Y}
      rx={3}
      className={className}
      strokeWidth={1.5}
      fill="var(--card)"
    />
  )
}

/** One flat-top rectangle "screen" on a small stand, at the FAR edge (away from the chair). Rotated
 *  180° about its own centre so the STAND — not the flat screen edge — is the part closest to the
 *  chair, the same way a real monitor's foot sits between the screen and the person, screen pushed
 *  back toward the far wall. */
function Screen({ x, width = 30 }: { x: number; width?: number }) {
  const screenY = FAR_Y - 22
  const cx = x + width / 2
  const cy = FAR_Y - 12.5
  return (
    <g className="stroke-muted-foreground/70 fill-background" transform={`rotate(180 ${cx} ${cy})`}>
      <rect x={x} y={screenY} width={width} height={16} rx={1.5} strokeWidth={1.25} />
      <line x1={cx} y1={screenY + 16} x2={cx} y2={FAR_Y - 3} strokeWidth={1.25} />
      <line x1={cx - 7} y1={FAR_Y - 3} x2={cx + 7} y2={FAR_Y - 3} strokeWidth={1.25} />
    </g>
  )
}

// The desk's own horizontal centre (`DeskSurface` spans x: 10-110, same as the chair's own
// `translate(60 …)` in office-svg.tsx) — EVERY near/far-edge object centres on this, never a bare
// hand-picked x of its own. A `laptop-and-monitor` desk previously gave the screen and the laptop two
// DIFFERENT x's (each pushed to its own side), which read as visibly off-axis from the desk and from
// each other — reported twice ("le laptop... est décalé"). The fix is centring, not shifting: the
// laptop sits DEVANT (nearer the chair) and the screen DERRIÈRE (farther), but both on this SAME
// vertical axis, exactly like keyboard-under-screen already was.
const DESK_CENTER_X = 60
const KEYBOARD_WIDTH = 32
const KEYBOARD_X = DESK_CENTER_X - KEYBOARD_WIDTH / 2
const LAPTOP_WIDTH = 34
const LAPTOP_X = DESK_CENTER_X - LAPTOP_WIDTH / 2

/** A laptop, top view: a plain background rectangle (the closed lid's own top face is what's actually
 *  visible from above; the keyboard deck shows through only in outline) containing ONE big grey
 *  rectangle for the keyboard — 85% of the width, 60% of the height — and a smaller grey rectangle for
 *  the trackpad. Sits at the NEAR edge, taking the keyboard's own usual place — a laptop desk has no
 *  separate keyboard (`DeskFurnitureGroup`'s own condition on this). Trackpad at the very front (closest
 *  to the chair, where a hand would actually rest), keyboard filling the rest of the body behind it. */
function LaptopShape({ x }: { x: number }) {
  const width = LAPTOP_WIDTH
  const height = 20
  const y = NEAR_Y + 2

  const trackWidth = width * 0.35
  const trackHeight = height * 0.18
  const trackX = x + (width - trackWidth) / 2
  const trackY = y + height * 0.08

  const kbWidth = width * 0.85
  const kbHeight = height * 0.6
  const kbX = x + (width - kbWidth) / 2
  const kbY = trackY + trackHeight + height * 0.06

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        className="stroke-muted-foreground/70 fill-background"
        strokeWidth={1.25}
      />
      <rect
        x={trackX}
        y={trackY}
        width={trackWidth}
        height={trackHeight}
        rx={1}
        className="fill-muted-foreground/40"
      />
      <rect x={kbX} y={kbY} width={kbWidth} height={kbHeight} rx={1} className="fill-muted-foreground/40" />
    </g>
  )
}

export function Monitors({ display }: { display: DeskDisplay }) {
  switch (display) {
    case "single-monitor":
      return <Screen x={DESK_CENTER_X - 15} width={30} />
    case "dual-monitor":
      // Quasi collés — a real dual-monitor setup butts the two bezels together, not two separate
      // desk objects with daylight between them (reported directly, an earlier pass left a 12-unit
      // gap) — and the PAIR is centred on the desk (2-unit seam sits exactly on `DESK_CENTER_X`).
      return (
        <>
          <Screen x={DESK_CENTER_X - 29} width={28} />
          <Screen x={DESK_CENTER_X + 1} width={28} />
        </>
      )
    case "laptop":
      return <LaptopShape x={LAPTOP_X} />
    case "laptop-and-monitor":
      // Laptop DEVANT (near edge, chair side), screen DERRIÈRE (far edge) — both on the SAME x centre
      // as the desk itself, never two different centres either side of it.
      return (
        <>
          <Screen x={DESK_CENTER_X - 15} width={30} />
          <LaptopShape x={LAPTOP_X} />
        </>
      )
  }
}

/** The desk's own NEAR-edge object — a keyboard, or (on a laptop desk) the laptop itself. Both are
 *  centred on `DESK_CENTER_X`, so `MouseDot` reads its gap off THIS rather than a bare `KEYBOARD_X`
 *  that a laptop desk never actually has anything at. */
function nearEdgeBounds(display: DeskDisplay): { x: number; width: number } {
  const hasLaptop = display === "laptop" || display === "laptop-and-monitor"
  return hasLaptop ? { x: LAPTOP_X, width: LAPTOP_WIDTH } : { x: KEYBOARD_X, width: KEYBOARD_WIDTH }
}

/** At the NEAR edge — right in front of the chair, where a real keyboard sits. Never drawn on a laptop
 *  desk (`DeskFurnitureGroup`'s own condition) — the laptop itself sits in this exact spot instead. */
export function Keyboard() {
  return (
    <rect
      x={KEYBOARD_X}
      y={NEAR_Y + 4}
      width={KEYBOARD_WIDTH}
      height={11}
      rx={1.5}
      className="stroke-muted-foreground/70 fill-background"
      strokeWidth={1.25}
    />
  )
}

/** Same ~7-unit gap from the keyboard's (or laptop's) own edge on EITHER side — mirrored, not two
 *  different hand-picked numbers (a first pass left 4 units on the right and 8 on the left). */
const MOUSE_GAP = 7
const MOUSE_WIDTH = 5
const MOUSE_HEIGHT = 9

/** A rounded-rect "pill"/capsule, not an ellipse or a circle — a real mouse reads as a small stadium
 *  shape from directly above (flat sides, fully round top and bottom), and an ellipse read too much
 *  like an egg. `rx` is exactly half the WIDTH (the narrower dimension), which is what turns a rounded
 *  rect into a proper capsule rather than a rect with merely-rounded corners. Gapped off the desk's
 *  actual near-edge object (`nearEdgeBounds`, passed in by the caller) — a keyboard, or a laptop sitting
 *  somewhere else entirely — never a keyboard position that might not be what's actually there. */
export function MouseDot({ side, display }: { side: MouseSide; display: DeskDisplay }) {
  const { x: nearX, width: nearWidth } = nearEdgeBounds(display)
  const cx = side === "right" ? nearX + nearWidth + MOUSE_GAP : nearX - MOUSE_GAP
  return (
    <rect
      x={cx - MOUSE_WIDTH / 2}
      y={NEAR_Y + 9.5 - MOUSE_HEIGHT / 2}
      width={MOUSE_WIDTH}
      height={MOUSE_HEIGHT}
      rx={MOUSE_WIDTH / 2}
      className="stroke-muted-foreground/70 fill-background"
      strokeWidth={1.25}
    />
  )
}

/** A potted plant, top view: the pot is a plain circle; the foliage is a handful of small ellipses,
 *  each rotated to a different angle around the pot's centre and pushed outward — read together they
 *  land as a loose rosette of leaves peeking out around the rim, never a single blob (the previous
 *  version's own bezier "leaf" shape, checked in isolation at 128px, just read as a smudge). `scale`
 *  lets the same shape serve both the small per-desk decoration (kept well inside the desk's own
 *  footprint — a first pass overflowed the desk edge at full size) and the larger room-level
 *  `FloorPlant` below. */
export function PottedPlant({
  x,
  y,
  leafCount = 5,
  scale = 1,
}: {
  x: number
  y: number
  leafCount?: number
  scale?: number
}) {
  const leaves = Array.from({ length: leafCount }, (_, i) => (360 / leafCount) * i)
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {leaves.map((angle) => (
        <ellipse
          key={angle}
          cx={0}
          cy={-6.5}
          rx={2.6}
          ry={5}
          transform={`rotate(${angle})`}
          className="fill-success/70 stroke-success"
          strokeWidth={0.6}
        />
      ))}
      <circle r={5} className="fill-background stroke-muted-foreground/60" strokeWidth={1.1} />
    </g>
  )
}

export function Cup({ x, y }: { x: number; y: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      className="stroke-muted-foreground/60 fill-background"
      strokeWidth={1}
    >
      <circle r={3.2} />
      <path d="M 3 -1 Q 6 -1 6 1 Q 6 3 3 2.4" fill="none" />
    </g>
  )
}

export function Notepad({ x, y }: { x: number; y: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      className="stroke-muted-foreground/60 fill-background"
      strokeWidth={1}
    >
      <rect x={-5} y={-6} width={10} height={12} rx={1} />
      <line x1={-3} y1={-2} x2={3} y2={-2} />
      <line x1={-3} y1={1} x2={3} y2={1} />
    </g>
  )
}

/** A floor lamp, top view — a real one reads as a shade DISC seen from directly above, not a bulb-on-a-
 *  stand silhouette: a pale filled circle for the shade with a darker ring for its own rim, a small dot
 *  at the centre for the pole underneath, and a soft, near-transparent halo for the light it throws —
 *  no "T", no stand line, both of which only make sense from the side. Room-level ambient dressing only
 *  (`office-svg.tsx` places one per row-gap band, between two rows of islands), never on a desk — a desk
 *  carries nothing but what's actually worked at (this file's own header). */
export function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={9} className="fill-warning/10" stroke="none" />
      <circle r={5} className="fill-warning/30 stroke-warning/70" strokeWidth={1} />
      <circle r={1.3} className="fill-muted-foreground/70" stroke="none" />
    </g>
  )
}

/** Nothing on a desk but what's actually worked at — a screen/laptop, a keyboard (never alongside a
 *  laptop, which sits in the keyboard's own place instead), a mouse, a cup, a notepad. No keyboard on a
 *  laptop desk; no floor lamp, no plant, no tower — those read as clutter on a footprint this small and
 *  belong to the ROOM, not the desk (`Lamp`/`FloorPlant`, placed once each by `office-svg.tsx`). Cup and
 *  Notepad sit in the one column no `Monitors` layout ever draws into (`x: 10–28` — every display is
 *  centred on `DESK_CENTER_X` and the widest, `dual-monitor`, still tops out at `x ≈ 31–89`), split
 *  near/far so the two never land on top of each other. */
export function DeskFurnitureGroup({ furniture }: { furniture: DeskFurniture }) {
  const hasLaptop = furniture.display === "laptop" || furniture.display === "laptop-and-monitor"
  return (
    <>
      <DeskSurface className="stroke-muted-foreground/70" />
      <Monitors display={furniture.display} />
      {!hasLaptop && <Keyboard />}
      <MouseDot side={furniture.mouseSide} display={furniture.display} />
      {furniture.hasCup && <Cup x={18} y={NEAR_Y + 8} />}
      {furniture.hasNotepad && <Notepad x={18} y={FAR_Y - 8} />}
    </>
  )
}

/** Room-level ambient dressing — never per-desk, never a drag/drop target. Deterministic PLACEMENT
 *  (fixed positions the layout picks, `office-svg.tsx`), not a seeded look. Reuses `PottedPlant`'s own
 *  rosette-of-ellipses shape rather than a second, differently-drawn plant — one correct plant shape,
 *  not two to keep in sync. `scale` kept small (not the old 1.6) — `office-svg.tsx` places this within a
 *  fixed inset of a desk's own outer edge and must never have it spill past that edge. */
export function FloorPlant({ x, y }: { x: number; y: number }) {
  return <PottedPlant x={x} y={y} leafCount={6} scale={0.75} />
}

/** A waste bin, top view: an outer rim circle, a slightly smaller inner-wall circle, and a handful of
 *  crumpled paper balls inside — small, unevenly-sized/placed circles, one poking just past the rim
 *  (a real bin overflows a little). The previous shape (a plain closed path, meant to read as a bin
 *  seen from the side) "n'a aucun sens" from directly above — a top-view bin is fundamentally a
 *  circle, not a trapezoid. */
export function Bin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={9} className="stroke-muted-foreground/50 fill-background" strokeWidth={1.2} />
      <circle r={6.5} className="stroke-muted-foreground/35 fill-none" strokeWidth={1} />
      <circle
        cx={-2.5}
        cy={-1.5}
        r={2}
        className="fill-muted-foreground/25 stroke-muted-foreground/40"
        strokeWidth={0.6}
      />
      <circle
        cx={1.5}
        cy={2}
        r={1.6}
        className="fill-muted-foreground/25 stroke-muted-foreground/40"
        strokeWidth={0.6}
      />
      <circle
        cx={-1.5}
        cy={3.5}
        r={1.8}
        className="fill-muted-foreground/25 stroke-muted-foreground/40"
        strokeWidth={0.6}
      />
      {/* Pokes just past the rim (distance from centre > r=9) — a bin that's actually been used. */}
      <circle
        cx={7.5}
        cy={-6}
        r={1.7}
        className="fill-muted-foreground/25 stroke-muted-foreground/40"
        strokeWidth={0.6}
      />
    </g>
  )
}

export function Rug({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return <rect x={x} y={y} width={width} height={height} rx={10} className="fill-accent/25" stroke="none" />
}
