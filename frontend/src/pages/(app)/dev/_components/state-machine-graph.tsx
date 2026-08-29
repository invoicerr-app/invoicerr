import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { LifecycleGraph } from "@/types"

/**
 * Hand-written SVG rendering of a `LifecycleGraph` — no diagramming dependency (mermaid and friends
 * are not installed in this project, and a one-off `/dev` tool is not a reason to add one).
 *
 * Layout: states are placed in columns by their shortest distance (in edges) from `graph.initial`,
 * and within a column ordered by a fixed reference order (the canonical `ComplianceStatus` order —
 * the same fixed, non-country vocabulary `compliance/index.tsx` already hardcodes as `STATUS_OPTIONS`)
 * so the picture doesn't reshuffle between renders. It is a readability aid, not a proof of the
 * graph's shape — the table below it is the literal, complete answer.
 */

// The canonical ComplianceStatus order (backend/src/compliance/lifecycle/state-machine.ts). Used
// ONLY to keep the diagram's vertical ordering stable and readable; every state actually drawn
// comes from the API response, never from this list — an engine state this list doesn't know about
// still renders, just sorted after the ones it does.
const REFERENCE_STATE_ORDER = [
  "DRAFT",
  "ISSUED",
  "PENDING_CLEARANCE",
  "CLEARED",
  "REJECTED",
  "CONTINGENCY",
  "DELIVERED",
  "AWAITING_RESPONSE",
  "ACCEPTED",
  "REFUSED",
  "DISPUTED",
  "REPORTED",
  "CANCELLED",
  "CORRECTED",
  "TRANSMISSION_FAILED",
]

const TRIGGER_COLOR: Record<string, string> = {
  IMMEDIATE: "var(--muted-foreground)",
  MANUAL: "var(--primary)",
  POLL: "#2563eb",
  CALLBACK: "#7c3aed",
  TIMER: "#b45309",
  CONTINGENCY: "var(--destructive)",
}

const NODE_WIDTH = 176
const NODE_HEIGHT = 40
const COLUMN_GAP = 88
const ROW_GAP = 22
const PADDING = 28

interface Point {
  x: number
  y: number
}

function computeLayers(graph: LifecycleGraph): Map<string, number> {
  const forward = new Map<string, string[]>()
  for (const s of graph.states) forward.set(s, [])
  for (const t of graph.transitions) {
    if (t.from === t.to) continue // self-loops don't advance the layer
    forward.get(t.from)?.push(t.to)
  }

  const layer = new Map<string, number>([[graph.initial, 0]])
  const queue = [graph.initial]
  while (queue.length > 0) {
    const current = queue.shift() as string
    const currentLayer = layer.get(current) ?? 0
    for (const next of forward.get(current) ?? []) {
      if (!layer.has(next) || (layer.get(next) as number) > currentLayer + 1) {
        layer.set(next, currentLayer + 1)
        queue.push(next)
      }
    }
  }

  // Defensive: a state the graph declares but no transition reaches (should not happen for a real
  // assembled graph — every state comes from a transition's `from`/`to` — but an unreachable state
  // must still be drawn rather than silently vanish).
  let overflow = Math.max(0, ...Array.from(layer.values()))
  for (const s of graph.states) {
    if (!layer.has(s)) {
      overflow += 1
      layer.set(s, overflow)
    }
  }
  return layer
}

function referenceRank(state: string): number {
  const idx = REFERENCE_STATE_ORDER.indexOf(state)
  return idx === -1 ? REFERENCE_STATE_ORDER.length : idx
}

function layoutGraph(graph: LifecycleGraph) {
  const layer = computeLayers(graph)
  const maxLayer = Math.max(0, ...Array.from(layer.values()))
  const columns: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const s of graph.states) columns[layer.get(s) as number].push(s)
  for (const col of columns) col.sort((a, b) => referenceRank(a) - referenceRank(b) || a.localeCompare(b))

  const positions = new Map<string, Point>()
  columns.forEach((states, col) => {
    states.forEach((state, row) => {
      positions.set(state, {
        x: PADDING + col * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
      })
    })
  })

  const maxRows = Math.max(1, ...columns.map((c) => c.length))
  const width = PADDING * 2 + (maxLayer + 1) * NODE_WIDTH + maxLayer * COLUMN_GAP
  const height = PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP

  return { positions, width, height }
}

/** Point on a quadratic bezier at parameter t (0..1). */
function bezierPoint(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

export function StateMachineGraph({ graph }: { graph: LifecycleGraph }) {
  const { t } = useTranslation()
  const { positions, width, height } = useMemo(() => layoutGraph(graph), [graph])
  const terminalStates = useMemo(() => {
    const withOutgoing = new Set(graph.transitions.map((t) => t.from))
    return new Set(graph.states.filter((s) => !withOutgoing.has(s)))
  }, [graph])

  // Multiple transitions can share the same (from,to) pair (e.g. a retry edge alongside the first
  // attempt) — index them so their curves don't sit exactly on top of one another.
  const pairIndex = new Map<string, number>()

  return (
    <div className="overflow-x-auto rounded-lg border bg-card p-2" data-cy="state-machine-graph">
      <svg
        role="img"
        aria-label={t("compliance.devStateMachine.graph.title")}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ minWidth: width }}
      >
        <defs>
          <marker
            id="state-machine-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>

        {graph.transitions.map((transition, i) => {
          const from = positions.get(transition.from)
          const to = positions.get(transition.to)
          if (!from || !to) return null

          const color = TRIGGER_COLOR[transition.trigger.kind] ?? "var(--muted-foreground)"
          const key = `${transition.from}|${transition.to}`
          const idx = pairIndex.get(key) ?? 0
          pairIndex.set(key, idx + 1)

          if (transition.from === transition.to) {
            // Self-loop: a small arc above the box, offset per index if there is more than one.
            const cx = from.x + NODE_WIDTH / 2
            const top = from.y
            const loopHeight = 22 + idx * 16
            const p0: Point = { x: cx - 18, y: top }
            const p2: Point = { x: cx + 18, y: top }
            const c1: Point = { x: cx - 18, y: top - loopHeight }
            const c2: Point = { x: cx + 18, y: top - loopHeight }
            const path = `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`
            const label = bezierPoint(p0, { x: cx, y: top - loopHeight * 1.4 }, p2, 0.5)
            return (
              <g key={`${transition.on}-${transition.from}-${transition.to}-${i}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  markerEnd="url(#state-machine-arrow)"
                  data-cy={`state-machine-transition-${transition.on}-${transition.from}-${transition.to}`}
                />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                  fontSize={10}
                  className="fill-current text-foreground"
                >
                  {transition.on}
                </text>
              </g>
            )
          }

          const sameColumn = from.x === to.x
          // Same-column edges (including backward ones) leave and re-enter on the right side, so
          // their bow doesn't cut through whatever sits between the two boxes in that column.
          const start: Point = { x: from.x + NODE_WIDTH, y: from.y + NODE_HEIGHT / 2 }
          const end: Point = sameColumn
            ? { x: to.x + NODE_WIDTH, y: to.y + NODE_HEIGHT / 2 }
            : { x: to.x, y: to.y + NODE_HEIGHT / 2 }

          // Curve away from the straight line so parallel/backward edges don't overlap; bow further
          // out on each extra edge sharing the same pair.
          const bow = sameColumn ? 60 + idx * 34 : (idx % 2 === 0 ? 1 : -1) * (16 + Math.floor(idx / 2) * 18)
          const midX = (start.x + end.x) / 2
          const midY = (start.y + end.y) / 2
          const control: Point = sameColumn ? { x: start.x + bow, y: midY } : { x: midX, y: midY + bow }

          const path = `M ${start.x} ${start.y} Q ${control.x} ${control.y}, ${end.x} ${end.y}`
          const label = bezierPoint(start, control, end, 0.5)

          return (
            <g key={`${transition.on}-${transition.from}-${transition.to}-${i}`}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                markerEnd="url(#state-machine-arrow)"
                data-cy={`state-machine-transition-${transition.on}-${transition.from}-${transition.to}`}
              />
              <rect
                x={label.x - transition.on.length * 3.1}
                y={label.y - 8}
                width={transition.on.length * 6.2}
                height={12}
                fill="var(--card)"
                opacity={0.85}
              />
              <text
                x={label.x}
                y={label.y + 2}
                textAnchor="middle"
                fontSize={10}
                className="fill-current text-foreground"
              >
                {transition.on}
                {transition.guardKey ? " *" : ""}
              </text>
            </g>
          )
        })}

        {graph.states.map((state) => {
          const pos = positions.get(state)
          if (!pos) return null
          const isInitial = state === graph.initial
          const isTerminal = terminalStates.has(state)
          return (
            <g key={state} data-cy={`state-machine-state-${state}`}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                fill="var(--card)"
                stroke={isInitial ? "var(--primary)" : "var(--border)"}
                strokeWidth={isInitial ? 2 : 1}
                strokeDasharray={isTerminal ? "4 3" : undefined}
              />
              <text
                x={pos.x + NODE_WIDTH / 2}
                y={pos.y + NODE_HEIGHT / 2 + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={isInitial ? 700 : 500}
                className="fill-current text-foreground"
              >
                {state.replace(/_/g, " ")}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
