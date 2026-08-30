/**
 * Pins the "empty today, on purpose" state this task leaves the shipped field-overlay catalog in —
 * see all.ts's own header for why. If this test ever needs updating because a real file was added,
 * that is exactly the point: it forces whoever adds the first one to also update the one place that
 * asserted there were none.
 */
import { ALL_COUNTRY_FIELD_OVERLAY_FILES } from './all';

describe('country-fields/data — nothing shipped yet', () => {
  it('ships no country field overlay today — France’s trunk needed no add/modify/remove this pass', () => {
    expect(ALL_COUNTRY_FIELD_OVERLAY_FILES).toEqual([]);
  });
});
