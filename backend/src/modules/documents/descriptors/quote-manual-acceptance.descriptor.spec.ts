import { validateLifecycle } from './lifecycle';
import { buildQuoteDescriptor } from './quote.descriptor';
import { isActionAvailable } from './types';

/**
 * Issue #421's own LIFECYCLE contract, isolated from the action's business logic
 * (actions/quote-manual-acceptance.spec.ts covers that): the "accepted" status and the
 * "accept-manually" action are declared coherently, "accepted" is a genuinely DISTINCT status from
 * "signed", and "convert-to-invoice" now also accepts a manually-accepted (or e-signed) quote.
 */
describe('quote.descriptor - "accept-manually" (issue #421)', () => {
  const descriptor = buildQuoteDescriptor();

  it('boots clean - validateLifecycle accepts the descriptor as declared', () => {
    expect(() => validateLifecycle(descriptor)).not.toThrow();
  });

  it('declares "accepted" as its own status, distinct from "signed"', () => {
    const statusIds = descriptor.statuses!.map((s) => s.id);
    expect(statusIds).toContain('accepted');
    expect(statusIds).toContain('signed');
    expect(descriptor.statuses!.find((s) => s.id === 'accepted')).not.toEqual(
      descriptor.statuses!.find((s) => s.id === 'signed'),
    );
  });

  it('"accept-manually" is available ONLY from "sent" - never draft/refused/signed/already-accepted', () => {
    const action = descriptor.actions.find((a) => a.id === 'accept-manually')!;
    expect(action).toBeDefined();
    expect(isActionAvailable(action, 'sent')).toBe(true);
    for (const status of ['draft', 'sending', 'send_failed', 'refused', 'signed', 'accepted']) {
      expect(isActionAvailable(action, status)).toBe(false);
    }
    expect(isActionAvailable(action, undefined)).toBe(false);
  });

  it('"accept-manually" declares a "sent" -> "accepted" transition, never targeting "signed"', () => {
    const action = descriptor.actions.find((a) => a.id === 'accept-manually')!;
    expect(action.transitions).toEqual([{ from: ['sent'], to: 'accepted' }]);
  });

  it('"accept-manually" requires a "note" param', () => {
    const action = descriptor.actions.find((a) => a.id === 'accept-manually')!;
    const note = action.params?.find((p) => p.key === 'note');
    expect(note).toMatchObject({ kind: 'longText', required: true });
  });

  it('"convert-to-invoice" is available from "accepted" (and "signed"), same as "sent"/"draft"', () => {
    const action = descriptor.actions.find((a) => a.id === 'convert-to-invoice')!;
    for (const status of ['draft', 'sent', 'signed', 'accepted']) {
      expect(isActionAvailable(action, status)).toBe(true);
    }
    for (const status of ['sending', 'send_failed', 'refused']) {
      expect(isActionAvailable(action, status)).toBe(false);
    }
  });
});
