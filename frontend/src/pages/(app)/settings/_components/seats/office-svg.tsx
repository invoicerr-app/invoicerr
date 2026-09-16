/**
 * The top-view office floor plan — desks in face-to-face pairs on a grid, drawn as one inline SVG
 * (`Room`). Every visual piece lives in `desk-pieces.tsx`; this file owns the GEOMETRY: where each
 * pair sits, how a desk's two halves mirror each other, and where the chair (the actual drag/drop
 * target — `seats.settings.tsx`'s own header) lands within that geometry.
 *
 * ## One desk's local coordinate box (`UNIT_W` × `UNIT_H`)
 * Every desk — whichever of a pair, whichever seat number — is drawn in the SAME local box: a chair
 * at the OUTER edge (`y = CHAIR_Y`) and the desk surface extending in toward the pair's shared centre
 * (`y = UNIT_H`). "Face to face" then falls out of how a PAIR stacks two of these boxes: the second
 * one is placed upside down (`facing="up"`) so its own desk meets the first one's, chairs at the two
 * OUTER edges — the two occupants end up looking at each other over their own screens.
 *
 * The "upside down" half is achieved by flipping ONLY the desk furniture (`scale(1, -1)`, decorative,
 * nobody minds a keyboard drawn upside down) — never the chair's own avatar, which is positioned by
 * explicit, separately-computed coordinates so its initials always render upright. Mixing the two
 * (flipping the avatar too, then trying to counter-rotate it back) was tried and discarded: two nested
 * 180° transforms compose in a way that is easy to get subtly wrong, whereas "the avatar was never
 * inside the flipped group in the first place" cannot be wrong by construction.
 *
 * ## Dragging a chair — screen pixels vs. SVG user units
 * `useDraggable`'s own `transform` is a SCREEN-pixel delta (it tracks the real pointer in the browser
 * viewport). This SVG has a fixed `viewBox` stretched to fill a responsive CSS width — 1 user unit on
 * screen is NOT 1 CSS pixel, and a length in a CSS `transform` applied to an SVG element is read in
 * that element's own user-unit space, not physical screen pixels. Applying the raw screen-pixel delta
 * moved a dragged chair by a different amount than the mouse actually travelled (faster when the room
 * is scaled UP from its viewBox, slower when scaled down) — caught by moving the mouse a known distance
 * and finding the chair somewhere else. `useScale` below reads the live screen-to-user-unit ratio off
 * the SVG's own `getScreenCTM()` (recomputed on resize — a phone rotation or a window resize changes
 * it) and `DeskCell` divides the drag delta by it before building the CSS transform, so 1 screen pixel
 * of mouse movement is always exactly 1 screen pixel of visual movement, whatever the room's own scale.
 *
 * ## Dragging a chair while the page scrolls
 * `useDraggable`'s `transform` is a delta from raw pointer movement ONLY — scrolling the page with the
 * mouse held still (wheel, or a touch-drag on the scrollable settings pane) never changes it, because
 * the pointer itself hasn't moved. But the SVG lives in normal document flow, so it visually slides
 * with that scroll like everything else on the page — net effect, the chair drifts away from a
 * stationary cursor the moment the page scrolls mid-drag (reported directly: "si je scroll pendant que
 * je grab un mec ça décale le gars de ma souris"). An earlier attempt fixed the drift by blocking
 * scrolling for the duration of any drag — which then made a desk below the fold unreachable while
 * dragging ("jpeux ne pas accéder à un siège dispo"), trading one bug for another.
 *
 * The actual fix tracks how far the SVG's own `getBoundingClientRect()` has shifted since the drag
 * started (`scrollShift`, updated on a CAPTURE-phase `scroll` listener on `window` — plain `scroll`
 * events don't bubble, but capture-phase delivery on a common ancestor still sees one fired by any
 * scrollable descendant, including nested ones) and subtracts that shift from the pointer delta before
 * dividing by scale — so scrolling the page while dragging keeps the chair glued to the cursor's actual
 * screen position instead of moving with the content underneath it, and scrolling itself is never
 * blocked.
 *
 * ## Two passes, furniture then chairs — SVG has no z-index
 * A dragged chair can visually pass over a NEIGHBOURING desk's furniture mid-drag. SVG paints strictly
 * in document order — no `z-index` — so as long as furniture and chair were siblings inside the SAME
 * per-desk `DeskCell`, a chair dragged over desk B still painted BEHIND desk B's own furniture whenever
 * desk B came later in the room's left-to-right, top-to-bottom document order (reported directly: "faut
 * faire en sorte que tout les members soient dessinés au dessus des bureaux"). Fixed by splitting into
 * two full passes over every desk — ALL furniture first, THEN all chairs — so every chair's `<g>` is
 * necessarily later in the document than every desk's furniture, and therefore always paints on top of
 * it, wherever it's currently dragged to.
 *
 * ## Which desk is "under" the chair — not dnd-kit's own collision detection
 * dnd-kit's built-in hit-testing compares its OWN internally-tracked rect for the active draggable
 * (the element's rect as measured at drag start, offset by the RAW pointer delta) against each
 * droppable's rect — entirely independent of whatever this file renders. `scrollShift` above corrects
 * what the chair looks like on screen, but does nothing for that internal math: after a scroll,
 * dnd-kit still thinks the chair is wherever the raw pointer delta alone would put it, so the
 * highlighted drop zone stops matching what's actually under the visually-corrected chair (reported
 * directly: "la zone d'action se déplace pas quand je drag et scroll"). Rather than fight dnd-kit's
 * internal bookkeeping, this bypasses it: `trackPointerTarget` below reads the pointer's live client
 * position and asks the DOM directly, via `elementFromPoint` + `closest('[data-seat-desk-index]')`,
 * which desk is actually under it right now — the same query the browser itself would answer, so it
 * is correct by construction through any amount of scrolling. The dragged chair gets `pointer-events:
 * none` for the duration so that query sees the desk underneath it rather than hitting the chair
 * itself (which, being glued to the cursor, would otherwise always be the top hit).
 */
import {
  type DragEndEvent,
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { type RefObject, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { getInitials } from "@/components/ui/avatar"
import type { SeatMemberView } from "@/hooks/queries"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

import { Bin, DeskFurnitureGroup, FloorPlant, Lamp, Rug } from "./desk-pieces"
import { deskSeed, pickDeskFurniture } from "./desk-rng"
import { buildOfficeLayout } from "./office-layout"

const UNIT_W = 120
const UNIT_H = 96
const CHAIR_Y = 16
const CHAIR_R = 13
// A pair's own two desks meeting in the middle — the two surfaces touch, screens back to back with
// next to no seam (went 16 -> 8 -> 3 -> this over three rounds of "rapproche encore") so the pair
// reads as ONE shared island, not two desks that happen to be near each other. The space saved on each
// round went to `COL_GAP`/`ROW_GAP` instead — those ARE the room's own walking aisles, never meant to
// shrink the same way.
const PAIR_GAP = 1
const PAIR_H = UNIT_H * 2 + PAIR_GAP
const COL_GAP = 64
const ROW_GAP = 64
const MARGIN = 36

function memberName(member: SeatMemberView): string {
  const name = `${member.firstname} ${member.lastname}`.trim()
  return name || member.email
}

/** The live screen-pixels-per-user-unit ratio for `svgRef`'s own element (`office-svg.tsx`'s own
 *  header on why this exists at all) — `1` until the ref is attached and the first measurement lands,
 *  which only ever briefly affects the very first drag frame of a page that was somehow already
 *  mid-drag on mount (never a real sequence: a drag cannot start before the user's own pointerdown,
 *  by which point this has long since measured the real ratio). Re-measures on every resize
 *  (`ResizeObserver`) — a phone rotation or a window resize changes the ratio, never the viewBox. */
function useScale(svgRef: RefObject<SVGSVGElement | null>): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const measure = () => {
      const ctm = svg.getScreenCTM()
      // `ctm.a` is the CTM's own X-axis scale factor — screen pixels per user unit. `preserveAspectRatio`
      // (left at its default `xMidYMid meet`) keeps X and Y scale identical, so one number suffices.
      if (ctm && ctm.a > 0) setScale(ctm.a)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [svgRef])

  return scale
}

/** The seat + its occupant (or its empty, dashed outline) — the one element in the whole room that is
 *  ever a drag source or a drop target. Positioned by the CALLER via the wrapping `<g transform>`; this
 *  component only ever draws around its own local origin (0,0). */
function ChairSeat({
  member,
  isSelf,
  facing,
  dragHandleProps,
  isDragging,
  isOver,
  setRef,
}: {
  member: SeatMemberView | null
  isSelf: boolean
  facing: "up" | "down"
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
  isOver?: boolean
  setRef?: (el: SVGGElement | null) => void
}) {
  // "down": chair at the box's OUTER (top) edge, desk extends inward (toward larger y) — the
  // canonical, unflipped orientation. "up": the MIRROR position (`UNIT_H - CHAIR_Y`) — the outer
  // (bottom) edge of the box — so the two chairs of a pair end up at the two OUTER edges and the two
  // desks meet in the middle, never the desk furniture's own `scale(1,-1)` flip (which only moves the
  // furniture, never the chair — this file's own header on why the two are handled separately).
  const chairCy = facing === "down" ? CHAIR_Y : UNIT_H - CHAIR_Y
  // Backrest sits on the side AWAY from this desk's own furniture (which is toward the pair's centre
  // for both halves): above the chair when facing down (furniture below), below it when facing up.
  const backrestOffset = facing === "down" ? -(CHAIR_R + 3) : CHAIR_R + 3
  return (
    <g
      ref={setRef}
      transform={`translate(60 ${chairCy})`}
      {...dragHandleProps}
      className={cn(
        "transition-opacity duration-150 ease-out",
        dragHandleProps && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      {/* Backrest — a short bar on the side away from the desk, so the chair visibly "faces" the
          desk it belongs to regardless of which half of the pair it is. */}
      <line
        x1={-9}
        x2={9}
        y1={backrestOffset}
        y2={backrestOffset}
        className="stroke-muted-foreground/60"
        strokeWidth={3}
        strokeLinecap="round"
      />
      {member ? (
        <>
          <circle
            r={CHAIR_R}
            className={cn("fill-primary stroke-2", isOver ? "stroke-ring" : "stroke-transparent")}
          />
          {isSelf && <circle r={CHAIR_R + 3} className="fill-none stroke-primary/50" strokeWidth={1.5} />}
          <text
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-primary-foreground text-[10px] font-semibold"
          >
            {getInitials(member.firstname, member.lastname, member.email)}
          </text>
        </>
      ) : (
        <circle
          r={CHAIR_R}
          className={cn(
            "fill-background",
            isOver ? "stroke-primary fill-accent/60" : "stroke-muted-foreground/50",
          )}
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      )}
    </g>
  )
}

interface DeskPlacement {
  deskIndex: number
  member: SeatMemberView | null
  facing: "up" | "down"
  x: number
  y: number
}

/** Furniture + the desk's own hit-testing/Cypress markers — never moves, always painted in its fixed
 *  room slot. `DeskChairCell` (below) draws the occupant separately, in a LATER pass, so it always
 *  paints on top regardless of which desk it's currently dragged over (this file's own header, "Two
 *  passes, furniture then chairs"). */
function DeskFurnitureCell({
  deskIndex,
  companyId,
  member,
  facing,
}: {
  deskIndex: number
  companyId: string
  member: SeatMemberView | null
  facing: "up" | "down"
}) {
  const furniture = pickDeskFurniture(deskSeed(companyId, deskIndex))
  return (
    <g
      data-cy={member ? `seat-desk-${deskIndex}-occupied` : `seat-desk-${deskIndex}-free`}
      data-seat-desk-index={deskIndex}
      data-seat-desk-free={!member}
    >
      <g transform={facing === "up" ? `translate(0 ${UNIT_H}) scale(1 -1)` : undefined}>
        <DeskFurnitureGroup furniture={furniture} />
      </g>
      <title>
        {member ? memberName(member) : "Free desk"} — desk {deskIndex}
      </title>
    </g>
  )
}

function DeskChairCell({
  deskIndex,
  member,
  currentUserId,
  facing,
  dragEnabled,
  scale,
  scrollShift,
  isOver,
}: {
  deskIndex: number
  member: SeatMemberView | null
  currentUserId: string | undefined
  facing: "up" | "down"
  dragEnabled: boolean
  scale: number
  scrollShift: { x: number; y: number }
  isOver: boolean
}) {
  // A free desk has no member id to key on — falling back to `member?.userId` alone would register
  // "seat-undefined" for EVERY empty chair in the same `DndContext` (its registry is keyed by id),
  // colliding across desks. Harmless while every free chair is `disabled`, but a real registry
  // collision and a dev-mode warning regardless — `deskIndex` is unique per chair whether occupied
  // or not.
  const draggable = useDraggable({
    id: member ? `seat-${member.userId}` : `desk-${deskIndex}`,
    disabled: !dragEnabled || !member,
  })

  // Subtract how far the room has scrolled since the drag started (`scrollShift`, in screen px) from
  // the raw pointer delta BEFORE dividing by the room's own screen-to-user-unit ratio — this file's own
  // header on why both steps are needed (scale for the SVG viewBox, scroll compensation to stay glued
  // to the cursor through a scroll).
  const chairTransformStyle = draggable.transform
    ? {
        transform: `translate(${(draggable.transform.x - scrollShift.x) / scale}px, ${
          (draggable.transform.y - scrollShift.y) / scale
        }px)`,
        // Let `elementFromPoint`-based hit-testing (this file's own header, "Which desk is 'under' the
        // chair") see through the chair it's currently dragging to the desk underneath, rather than
        // always hitting the chair itself (which is glued to the cursor by construction).
        pointerEvents: draggable.isDragging ? ("none" as const) : undefined,
      }
    : undefined

  return (
    <g style={member && dragEnabled ? chairTransformStyle : undefined} data-seat-member-id={member?.userId}>
      <ChairSeat
        member={member}
        isSelf={member?.userId === currentUserId}
        facing={facing}
        isDragging={draggable.isDragging}
        isOver={isOver}
        setRef={(el) => {
          // dnd-kit types `setNodeRef` for an `HTMLElement` — an SVG `<g>` implements the same
          // `Element`/`EventTarget` surface dnd-kit actually uses at runtime (it never touches an
          // HTML-only member), so this is a safe, purely nominal-typing cast.
          draggable.setNodeRef(el as unknown as HTMLElement | null)
        }}
        dragHandleProps={
          member && dragEnabled ? { ...draggable.attributes, ...draggable.listeners } : undefined
        }
      />
    </g>
  )
}

export function OfficeRoom({
  seats,
  members,
  currentUserId,
  canManage,
  onMove,
  companyId,
}: {
  seats: number
  members: SeatMemberView[]
  currentUserId: string | undefined
  canManage: boolean
  onMove: (userId: string, seatIndex: number) => void
  companyId: string
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const dragEnabled = canManage && !isMobile
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const svgRef = useRef<SVGSVGElement | null>(null)
  const scale = useScale(svgRef)
  const [scrollShift, setScrollShift] = useState({ x: 0, y: 0 })
  const dragStartRectRef = useRef<{ left: number; top: number } | null>(null)
  const [overDeskIndex, setOverDeskIndex] = useState<number | null>(null)
  const overDeskIndexRef = useRef<number | null>(null)

  const { islands } = buildOfficeLayout(seats, members)
  const cols = isMobile ? 1 : Math.min(islands.length, 2) || 1
  const rows = Math.ceil(islands.length / cols) || 1

  const width = MARGIN * 2 + cols * UNIT_W + (cols - 1) * COL_GAP
  const height = MARGIN * 2 + rows * PAIR_H + Math.max(rows - 1, 0) * ROW_GAP

  // Every island's own origin, computed once and reused for BOTH desk placement and room decor below —
  // one source of truth for where an island sits, never two separate col/row computations to keep in
  // sync.
  const islandOrigins = islands.map((_island, position) => {
    const col = position % cols
    const row = Math.floor(position / cols)
    return { col, row, x: MARGIN + col * (UNIT_W + COL_GAP), y: MARGIN + row * (PAIR_H + ROW_GAP) }
  })

  // Room decor placement (never per-desk, this file's own header). The BIN sits beside the FIRST
  // island, on its AISLE-facing side (`COL_GAP`, the room's own central walking corridor between
  // columns) — hugging the island's own edge, not centred in the aisle's full width, so it reads as
  // "next to that pair" rather than "blocking the passage". A single-column room (no aisle at all,
  // `cols === 1`) has nothing to hug, so the bin falls back to the room's own right margin instead.
  const firstIsland = islandOrigins[0]
  const hasAisle = cols > 1
  const binX = firstIsland
    ? hasAisle
      ? firstIsland.x + UNIT_W + 10
      : width - MARGIN / 2
    : width - MARGIN / 2
  const binY = firstIsland ? firstIsland.y + PAIR_H / 2 : MARGIN + PAIR_H / 2

  // A lamp OR a plant lives in the horizontal band BETWEEN two rows of islands — never a desk's own
  // side margin ("les lampes et les plantes, c'est pas là : c'est ENTRE les bureaux de deux lignes") —
  // ONE object per band, for BOTH columns, not one each ("un seul élément par ligne"). Pinned NEAR one
  // column's own OUTER edge — never centred under it (that put it directly behind the chairs above/
  // below) — but its x stays INSIDE that desk's own horizontal span (`DeskSurface`'s `x: 10-110`,
  // mirrored here as `DESK_SURFACE_LEFT`/`RIGHT`), a small `DECOR_INSET` in from the desk's own outer
  // edge: an earlier pass subtracted that inset instead of adding it, pushing the object OUTSIDE the
  // island into the room's side margin ("là ils sortent, tu les as déplacés dans le mauvais sens") — the
  // fix moves it back toward the desk's own centre, never past its outer edge. Which side and which
  // kind alternate together from one band to the next: band 0 is a lamp on the left, band 1 a plant on
  // the right, band 2 back to a lamp on the left, and so on. A single-row room (4 desks) has no row-gap
  // to put anything in.
  const DESK_SURFACE_LEFT = 10
  const DESK_SURFACE_RIGHT = 110
  // Both `Lamp`'s own halo (r=9) and `FloorPlant`'s own leaf reach (~8.6 at its current scale) must fit
  // inside this inset, or the object's OWN visual edge — not just its centre point — pokes back out
  // past the desk regardless of the centre being technically "inside".
  const DECOR_INSET = 10
  const rowGapDecor = Array.from({ length: Math.max(rows - 1, 0) }, (_, rowGapIndex) => {
    const bandY = MARGIN + (rowGapIndex + 1) * PAIR_H + rowGapIndex * ROW_GAP + ROW_GAP / 2
    const onLeft = rowGapIndex % 2 === 0
    const col = onLeft ? 0 : cols - 1
    const colX = MARGIN + col * (UNIT_W + COL_GAP)
    return {
      kind: onLeft ? ("lamp" as const) : ("plant" as const),
      x: onLeft ? colX + DESK_SURFACE_LEFT + DECOR_INSET : colX + DESK_SURFACE_RIGHT - DECOR_INSET,
      y: bandY,
      key: `rowgap-${rowGapIndex}`,
    }
  })

  // Flattened once so furniture and chairs can each be rendered in their own full pass over every desk
  // (this file's own header, "Two passes, furniture then chairs") — both passes place each desk at the
  // exact same absolute (x, y), just at two different points in the document.
  const deskPlacements: DeskPlacement[] = islands.flatMap((island, position) => {
    const { x: islandX, y: islandY } = islandOrigins[position]
    return island.desks.map((desk, deskPosition) => ({
      deskIndex: desk.index,
      member: desk.occupant,
      facing: deskPosition === 0 ? ("down" as const) : ("up" as const),
      x: islandX,
      y: islandY + (deskPosition === 0 ? 0 : UNIT_H + PAIR_GAP),
    }))
  })

  // See this file's own header ("Dragging a chair while the page scrolls"): `scrollShift` is how far
  // the SVG's own bounding rect has moved on screen since the drag started, recomputed on every scroll
  // event anywhere in the page (capture-phase — plain `scroll` doesn't bubble, but a listener on
  // `window` still receives one fired by any scrollable descendant during the capture pass).
  const trackScrollShift = () => {
    const svg = svgRef.current
    const start = dragStartRectRef.current
    if (!svg || !start) return
    const rect = svg.getBoundingClientRect()
    setScrollShift({ x: rect.left - start.left, y: rect.top - start.top })
  }
  // This file's own header ("Which desk is 'under' the chair"): asks the DOM directly which desk is at
  // the pointer's live position, rather than trusting dnd-kit's own scroll-unaware collision tracking.
  // A free desk is a valid drop target at any position within it, occupied or not — but only a FREE
  // one ever highlights or accepts a drop (`data-seat-desk-free`, set by `DeskCell`).
  const trackPointerTarget = (event: PointerEvent) => {
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const deskEl = hit?.closest("[data-seat-desk-index]")
    const isFree = deskEl?.getAttribute("data-seat-desk-free") === "true"
    const index = isFree ? Number(deskEl?.getAttribute("data-seat-desk-index")) : null
    const next = index !== null && Number.isInteger(index) ? index : null
    overDeskIndexRef.current = next
    setOverDeskIndex(next)
  }
  const handleDragStart = () => {
    const rect = svgRef.current?.getBoundingClientRect()
    dragStartRectRef.current = rect ? { left: rect.left, top: rect.top } : null
    setScrollShift({ x: 0, y: 0 })
    window.addEventListener("scroll", trackScrollShift, { capture: true, passive: true })
    window.addEventListener("pointermove", trackPointerTarget)
  }
  const endDrag = () => {
    window.removeEventListener("scroll", trackScrollShift, { capture: true })
    window.removeEventListener("pointermove", trackPointerTarget)
    dragStartRectRef.current = null
    setScrollShift({ x: 0, y: 0 })
    overDeskIndexRef.current = null
    setOverDeskIndex(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const targetDeskIndex = overDeskIndexRef.current
    endDrag()
    if (targetDeskIndex === null) return
    const userId = String(event.active.id).replace("seat-", "")
    onMove(userId, targetDeskIndex)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("settings.seats.officePlanLabel", "Office desks")}
        className="h-auto w-full max-w-2xl"
        data-cy="seats-office-plan"
      >
        <defs>
          <pattern id="seats-floor-grid" width={24} height={24} patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" className="stroke-muted" fill="none" strokeWidth={1} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={width} height={height} className="fill-background" />
        <rect x={0} y={0} width={width} height={height} fill="url(#seats-floor-grid)" />

        {/* A rug centred under the whole room, a bin beside the first pair on its aisle-facing side, and
            lamps/plants alternating along the band between two rows of islands (`rowGapDecor` — this
            file's own header) — ambient dressing, never a drag/drop target, never on a desk. */}
        <Rug
          x={MARGIN - 14}
          y={MARGIN - 14}
          width={width - (MARGIN - 14) * 2}
          height={height - (MARGIN - 14) * 2}
        />
        <Bin x={binX} y={binY} />
        {rowGapDecor.map((d) =>
          d.kind === "lamp" ? (
            <Lamp key={d.key} x={d.x} y={d.y} />
          ) : (
            <FloorPlant key={d.key} x={d.x} y={d.y} />
          ),
        )}

        {deskPlacements.map((p) => (
          <g key={p.deskIndex} transform={`translate(${p.x} ${p.y})`}>
            <DeskFurnitureCell
              deskIndex={p.deskIndex}
              companyId={companyId}
              member={p.member}
              facing={p.facing}
            />
          </g>
        ))}

        {deskPlacements.map((p) => (
          <g key={p.deskIndex} transform={`translate(${p.x} ${p.y})`}>
            <DeskChairCell
              deskIndex={p.deskIndex}
              member={p.member}
              currentUserId={currentUserId}
              facing={p.facing}
              dragEnabled={dragEnabled}
              scale={scale}
              scrollShift={scrollShift}
              isOver={overDeskIndex === p.deskIndex}
            />
          </g>
        ))}
      </svg>
    </DndContext>
  )
}
