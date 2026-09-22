/**
 * The measured defect: `validate-schematron.ts`'s top-level `try { require('fontoxpath'); ... }
 * catch {}` swallowed ANY failure of the custom-XPath-function registration silently, with a comment
 * claiming this was harmless "as long as Peppol BIS is not wired in" — it now is
 * (`documents-core.module.ts` registers `peppolBisFormatProvider`), so a registration failure is no
 * longer inert. This file forces that failure path (making the REAL `fontoxpath.registerCustomXPathFunction`
 * throw, exactly like a broken native binding or an incompatible version would) and proves it is now
 * LOGGED rather than disappearing without a trace.
 *
 * Needs its own file, separate from `validate-schematron.spec.ts`: the try/catch runs once, at MODULE
 * LOAD TIME — `vi.resetModules()` + a fresh dynamic `import()` is the only way to re-exercise it, and doing
 * that inside the other spec (which relies on the module having already loaded SUCCESSFULLY at the
 * top of the file) would risk the two suites interfering with each other's module cache.
 *
 * NOT a `vi.mock('fontoxpath', ...)` — measured directly while converting this file from Jest:
 * `vi.mock`/`vi.doMock` intercept `import` statements (static or dynamic), never a plain runtime
 * `require('fontoxpath')` call — and `validate-schematron.ts` reaches `fontoxpath` through exactly
 * that: a literal `require()`, compiled as CommonJS output (this project's `moduleResolution:
 * "nodenext"`, no package.json `"type": "module"`), which routes through Node's own module system,
 * not Vite's mock-aware one. Confirmed empirically: even a top-level, hoisted `vi.mock('fontoxpath',
 * factory)` left a `require('fontoxpath')` call made right here, in this very spec, returning the REAL
 * module — the exact opposite of what Jest did (Jest's own module loader intercepts every `require`,
 * mocked or not, which is why the ORIGINAL Jest version of this file's plain doMock call worked
 * successfully). The fix below instead reaches into the REAL, shared `fontoxpath` module object —
 * `require()` on an already-resolved CommonJS module always returns the SAME cached object, in this
 * project exactly as in Node itself, so mutating `registerCustomXPathFunction` in place here is visible
 * to `validate-schematron.ts`'s own later `require('fontoxpath')` too — and restores the real
 * implementation afterward so no other spec in this file's process is affected.
 *
 * Mocks `fontoxpath`'s SHAPE (`registerCustomXPathFunction` throws when CALLED), never a factory that
 * throws on `require` itself: `node-schematron` (an ordinary, unmocked dependency this file also loads,
 * top-level, outside anyone's try/catch) requires `fontoxpath` INTERNALLY — breaking the require itself
 * would break THAT unrelated require first, before this file's own try/catch is ever reached, which is
 * not the failure this test means to simulate.
 */
import { vi } from 'vitest';

describe('validate-schematron.ts — Peppol BIS custom XPath function registration failure', () => {
  it('logs the failure loudly instead of swallowing it silently', async () => {
    vi.resetModules();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const fontoxpath = require('fontoxpath') as { registerCustomXPathFunction: (...args: unknown[]) => void };
    const originalRegister = fontoxpath.registerCustomXPathFunction;
    fontoxpath.registerCustomXPathFunction = () => {
      throw new Error('simulated: fontoxpath native binding failed to load');
    };

    try {
      // The try/catch under test runs as a SIDE EFFECT of this very dynamic import — nothing to call.
      await import('./validate-schematron.js');

      expect(consoleError).toHaveBeenCalledTimes(1);
      const [message, error] = consoleError.mock.calls[0];
      expect(message).toContain('[schematron:vendored]');
      expect(message).toContain('Peppol BIS');
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('simulated: fontoxpath native binding failed to load');
    } finally {
      consoleError.mockRestore();
      fontoxpath.registerCustomXPathFunction = originalRegister;
      vi.resetModules();
    }
  });
});
