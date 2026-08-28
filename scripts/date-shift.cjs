/**
 * Shifts the process clock forward, without touching the machine's.
 *
 * Why this exists: France's obligation layers are all `validFrom: 2026-09-01`, and the compliance
 * engine resolves them against the invoice's issue date — which is `new Date()`, not a parameter.
 * So there is no way to see the post-mandate behaviour from the API, and no way to screenshot it.
 * Setting the system date would be a machine-wide side effect for a demo; `libfaketime` is not
 * installed. A preload that overrides Date for THIS process only is both narrower and reversible.
 *
 *   DATE_SHIFT_TO=2026-09-02T10:00:00Z NODE_OPTIONS="--require /abs/path/date-shift.cjs" npm run …
 *
 * Inert unless DATE_SHIFT_TO is set, so it is safe to leave in NODE_OPTIONS for a whole run — the
 * shim is inherited by every child process (prisma, cypress), which is what makes the clock
 * CONSISTENT across the stack rather than shifted in one process and not another.
 */
const target = process.env.DATE_SHIFT_TO;
if (target) {
  const RealDate = Date;
  const offset = new RealDate(target).getTime() - RealDate.now();
  if (Number.isNaN(offset)) {
    throw new Error(`DATE_SHIFT_TO is not a date: ${target}`);
  }

  class ShiftedDate extends RealDate {
    constructor(...args) {
      // Only a bare `new Date()` means "now". Every explicit value must survive untouched, or
      // stored timestamps and parsed ISO strings would drift too and nothing would line up.
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  globalThis.Date = ShiftedDate;

  const days = Math.round(offset / 86400000);
  process.stderr.write(`[date-shift] clock moved ${days >= 0 ? '+' : ''}${days} day(s) → ${new ShiftedDate().toISOString()}\n`);
}
