/**
 * `Settings > Seats` — the company's own generative office plan: how many seats are bought (read from
 * Polar, never written back to it — backend's `billing/seat-sync.ts`), who sits at which numbered
 * desk, and who is waiting for one. SaaS mode only — this tab is filtered out entirely by
 * `-[tab].tsx` on the same `billingAvailable` signal `billing.settings.tsx` itself gates on (no
 * `/api/billing/*` route exists at all on a self-hosted instance).
 *
 * Two equivalent views: a generative floor plan you can drag a member across (pointer-fine devices,
 * OWNER/ADMIN only), and a plain table with a `Select` per row — the keyboard/screen-reader path. On a
 * narrow/coarse-pointer viewport (`useIsMobile`) the List view is the ONLY one offered at all — no
 * `Tabs` toggle, no "Office" option to land on and find nothing draggable; there is nothing left to
 * choose between. A WAITING member is never a drag source or a drop target in either view — the bench
 * they sit on is not a place an OWNER can deposit someone into by hand; they only ever leave it
 * automatically, once a seat frees up or is bought back.
 */
import { ExternalLinkIcon, LayoutGridIcon, TableIcon, Wallet } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCompanies, useMoveSeat, useOpenCustomerPortal, useSeats } from "@/hooks/queries"
import type { SeatMemberView } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"
import { useIsMobile } from "@/hooks/use-mobile"
import { authClient } from "@/lib/auth"

import { OfficeRoom } from "./seats/office-svg"
import { SettingsListSkeleton, SettingsPage, SettingsSection } from "./settings-section"

function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function memberName(member: SeatMemberView): string {
  const name = `${member.firstname} ${member.lastname}`.trim()
  return name || member.email
}

const ROLE_BADGE_VARIANT: Record<SeatMemberView["role"], "default" | "secondary" | "outline"> = {
  OWNER: "default",
  ADMIN: "secondary",
  MEMBER: "outline",
}

// ---------------------------------------------------------------------------------------------
// The bench for members WAITING for a desk — never a drag source or a drop target (a waiting member
// has no desk to drag from, and cannot be deposited onto one by hand — `office-svg.tsx`'s own header
// on why only a CHAIR is ever draggable/droppable). Plain avatar chips, not a furniture illustration:
// there is no desk to draw for someone who doesn't have one.

function WaitingBench({
  members,
  currentUserId,
}: {
  members: SeatMemberView[]
  currentUserId: string | undefined
}) {
  const { t } = useTranslation()
  if (members.length === 0) return null

  return (
    <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-3" data-cy="seats-waiting-bench">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("settings.seats.waitingBench", "Waiting for a seat")}
      </p>
      <div className="flex flex-wrap gap-3">
        {members.map((member) => (
          <div key={member.userId} className="flex flex-col items-center gap-1 text-center opacity-80">
            <Avatar
              className={
                member.userId === currentUserId
                  ? "size-9 ring-2 ring-primary"
                  : "size-9 ring-2 ring-transparent"
              }
            >
              <AvatarFallback>{getInitials(member.firstname, member.lastname, member.email)}</AvatarFallback>
            </Avatar>
            <span className="w-16 truncate text-[11px]">{memberName(member)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// List view — the accessible equivalent (Select, no drag)

function SeatsListView({
  seats,
  members,
  waiting,
  canManage,
  onMove,
}: {
  seats: number
  members: SeatMemberView[]
  waiting: SeatMemberView[]
  canManage: boolean
  onMove: (userId: string, seatIndex: number) => void
}) {
  const { t } = useTranslation()
  const takenIndexes = new Set(members.map((m) => m.seatIndex).filter((i): i is number => i !== null))
  const freeIndexes = Array.from({ length: seats }, (_, i) => i + 1).filter((i) => !takenIndexes.has(i))
  const rows = [
    ...members.map((member) => ({ member, seated: true as const })),
    ...waiting.map((member) => ({ member, seated: false as const })),
  ]

  return (
    <Table data-cy="seats-list-view">
      <TableHeader>
        <TableRow>
          <TableHead>{t("settings.seats.list.member", "Member")}</TableHead>
          <TableHead>{t("settings.seats.list.role", "Role")}</TableHead>
          <TableHead>{t("settings.seats.list.desk", "Desk")}</TableHead>
          <TableHead>{t("settings.seats.list.status", "Status")}</TableHead>
          {canManage && (
            <TableHead className="text-right">{t("settings.seats.list.actions", "Move")}</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ member, seated }) => {
          return (
            <TableRow key={member.userId} data-cy={`seats-list-row-${member.userId}`}>
              <TableCell className="font-medium">{memberName(member)}</TableCell>
              <TableCell>
                <Badge variant={ROLE_BADGE_VARIANT[member.role]}>{member.role}</Badge>
              </TableCell>
              <TableCell className="tabular-nums">{member.seatIndex ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={seated ? "success" : "warning"}>
                  {seated
                    ? t("settings.seats.list.statusSeated", "Seated")
                    : t("settings.seats.list.statusWaiting", "Waiting")}
                </Badge>
              </TableCell>
              {canManage && (
                <TableCell className="text-right">
                  {seated ? (
                    <Select
                      value={member.seatIndex ? String(member.seatIndex) : undefined}
                      onValueChange={(value) => onMove(member.userId, Number(value))}
                    >
                      <SelectTrigger
                        size="sm"
                        className="ml-auto w-40"
                        aria-label={t("settings.seats.moveToAria", "Move {{name}} to desk…", {
                          name: memberName(member),
                        })}
                        data-cy={`seats-move-select-${member.userId}`}
                      >
                        <SelectValue placeholder={t("settings.seats.moveToPlaceholder", "Move to desk…")} />
                      </SelectTrigger>
                      <SelectContent>
                        {member.seatIndex && (
                          <SelectItem value={String(member.seatIndex)}>
                            {t("settings.seats.deskNumber", "Desk {{number}} (current)", {
                              number: member.seatIndex,
                            })}
                          </SelectItem>
                        )}
                        {freeIndexes.map((index) => (
                          <SelectItem key={index} value={String(index)}>
                            {t("settings.seats.deskNumberPlain", "Desk {{number}}", { number: index })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("settings.seats.list.waitingHint", "Frees up automatically")}
                    </span>
                  )}
                </TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------------------------

export default function SeatsSettings() {
  const { t } = useTranslation()
  const { data: session } = authClient.useSession()
  const { activeRole, activeCompanyId } = useCompanies()
  const canManage = activeRole === "OWNER" || activeRole === "ADMIN"
  const currentUserId = (session as { user?: { id?: string } } | null)?.user?.id

  const { data, isLoading } = useSeats()
  const moveSeat = useMoveSeat()
  const openPortal = useOpenCustomerPortal()
  const isMobile = useIsMobile()
  const [view, setView] = useState<"office" | "list">("office")
  // The office plan is a pointer-fine, drag-driven surface — on a coarse-pointer/narrow viewport there
  // is nothing left to toggle to, so the List view is the only one offered at all rather than an
  // "Office" tab that opens onto a plan nobody there can act on (reported directly: "sur mobile y'a que
  // la vue en liste possible").
  const effectiveView = isMobile ? "list" : view
  const [liveMessage, setLiveMessage] = useState("")
  const [navigatingPortal, setNavigatingPortal] = useState(false)

  const handleMove = (userId: string, seatIndex: number) => {
    const member = data?.members.find((m) => m.userId === userId)
    moveSeat.mutate(
      { userId, seatIndex },
      {
        onSuccess: () => {
          const name = member ? memberName(member) : userId
          setLiveMessage(
            t("settings.seats.moved", "{{name}} moved to desk {{number}}", { name, number: seatIndex }),
          )
          toast.success(t("settings.seats.messages.moveSuccess", "Desk updated"))
        },
        onError: (error) => {
          toast.error(
            apiErrorMessage(error, t("settings.seats.messages.moveError", "Failed to move that member")),
          )
        },
      },
    )
  }

  const handleOpenPortal = () => {
    openPortal.mutate(undefined, {
      onSuccess: (result) => {
        setNavigatingPortal(true)
        window.location.assign(result.url)
      },
      onError: (error) => {
        setNavigatingPortal(false)
        toast.error(
          apiErrorMessage(
            error,
            t("settings.billing.messages.portalError", "Failed to open the subscription portal"),
          ),
        )
      },
    })
  }

  return (
    <SettingsPage
      title={t("settings.seats.title", "Seats")}
      description={t("settings.seats.description", "Where each member sits — and who's waiting for a desk.")}
    >
      {/* Announces the result of a move to assistive tech without moving focus — the toast above is
          the same information visually, this is what a screen reader actually hears. */}
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {isLoading || !data ? (
        <SettingsListSkeleton rows={3} />
      ) : (
        <>
          <SettingsSection
            // `min-w-0`: without it, this Card (a CSS Grid item under `SettingsPage`'s own grid) falls
            // back to `min-width: auto` and refuses to shrink below the list view's `<Table>` intrinsic
            // content width — the table's OWN `overflow-x-auto` wrapper (table.tsx) then never gets a
            // chance to kick in, and the WHOLE page scrolls horizontally on a narrow viewport instead
            // of just the table. Scoped to this one call site (a `className` merge SettingsSection
            // already exposes), not a change to the shared component every other tab also renders.
            className="min-w-0"
            aside={
              !isMobile && (
                <Tabs value={view} onValueChange={(value) => setView(value as "office" | "list")}>
                  <TabsList data-cy="seats-view-toggle">
                    <TabsTrigger value="office" data-cy="seats-view-office">
                      <LayoutGridIcon />
                      {t("settings.seats.viewOffice", "Office")}
                    </TabsTrigger>
                    <TabsTrigger value="list" data-cy="seats-view-list">
                      <TableIcon />
                      {t("settings.seats.viewList", "List")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )
            }
          >
            <div className="mb-4 flex flex-col items-start gap-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground" data-cy="seats-desks-summary">
                {t("settings.seats.desksTaken", "{{taken}} of {{total}} desks taken", {
                  taken: data.members.length,
                  total: data.seats,
                })}
              </p>
              {canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={openPortal.isPending || navigatingPortal}
                  onClick={handleOpenPortal}
                  data-cy="seats-add-desks-button"
                >
                  <Wallet />
                  {t("settings.seats.addDesks", "Add desks in the Polar portal")}
                  <ExternalLinkIcon className="size-3.5" />
                </Button>
              )}
            </div>

            {effectiveView === "office" ? (
              <>
                <OfficeRoom
                  seats={data.seats}
                  members={data.members}
                  currentUserId={currentUserId}
                  canManage={canManage}
                  onMove={handleMove}
                  companyId={activeCompanyId ?? ""}
                />
                <WaitingBench members={data.waiting} currentUserId={currentUserId} />
              </>
            ) : (
              <SeatsListView
                seats={data.seats}
                members={data.members}
                waiting={data.waiting}
                canManage={canManage}
                onMove={handleMove}
              />
            )}
          </SettingsSection>

          {!canManage && (
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.seats.memberNotice",
                "Only the company's owner or an admin can move members between desks.",
              )}
            </p>
          )}
        </>
      )}
    </SettingsPage>
  )
}
