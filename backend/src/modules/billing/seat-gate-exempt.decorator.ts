import { SetMetadata } from '@nestjs/common';

/**
 * The one escape hatch `CompanyWriteGuard`'s seat check (`seat-gate.ts#assertUserHasSeatOrThrow`)
 * honours. A member with no seat is refused EVERY company route, reads included, so the routes that
 * are about the user rather than about the active company must say so explicitly: today the legal
 * controller (`GET /legal/status` decides the re-acceptance redirect, `POST /legal/accept` records it,
 * neither reads any company data) and `POST /companies/switch` (moves the session to ANOTHER company the
 * caller belongs to, reading only that membership). Everything else stays closed to a member with no seat.
 *
 * Never put this on a route that returns company data: that is exactly what a member with no seat
 * must not read (product decision 2026-11-13, "1 user in 1 company = 1 seat").
 */
export const SEAT_GATE_EXEMPT_KEY = 'seatGateExempt';
export const SeatGateExempt = () => SetMetadata(SEAT_GATE_EXEMPT_KEY, true);
