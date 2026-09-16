/**
 * The measured defect: `validate-schematron.ts`'s top-level `try { require('fontoxpath'); ... }
 * catch {}` swallowed ANY failure of the custom-XPath-function registration silently, with a comment
 * claiming this was harmless "as long as Peppol BIS is not wired in" — it now is
 * (`documents-core.module.ts` registers `peppolBisFormatProvider`), so a registration failure is no
 * longer inert. This file forces that failure path (mocking `fontoxpath` to throw on `require`,
 * exactly like a broken native binding or an incompatible version would) and proves it is now LOGGED
 * rather than disappearing without a trace.
 *
 * Needs its own file, separate from `validate-schematron.spec.ts`: the try/catch runs once, at MODULE
 * LOAD TIME — `jest.resetModules()` + a fresh `require` is the only way to re-exercise it, and doing
 * that inside the other spec (which relies on the module having already loaded SUCCESSFULLY at the
 * top of the file) would risk the two suites interfering with each other's module cache.
 *
 * Mocks `fontoxpath`'s SHAPE (an object whose `registerCustomXPathFunction` throws when CALLED),
 * never a factory that throws on `require` itself: `node-schematron` (an ordinary, unmocked
 * dependency this file also loads, top-level, outside anyone's try/catch) requires `fontoxpath`
 * INTERNALLY — a factory that throws on require would break THAT unrelated require first, before
 * this file's own try/catch is ever reached, which is not the failure this test means to simulate.
 */
describe('validate-schematron.ts — Peppol BIS custom XPath function registration failure', () => {
  it('logs the failure loudly instead of swallowing it silently', () => {
    jest.resetModules();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    jest.doMock('fontoxpath', () => ({
      registerCustomXPathFunction: () => {
        throw new Error('simulated: fontoxpath native binding failed to load');
      },
    }));

    try {
      // The try/catch under test runs as a SIDE EFFECT of this very require — nothing to call.
      require('./validate-schematron');

      expect(consoleError).toHaveBeenCalledTimes(1);
      const [message, error] = consoleError.mock.calls[0];
      expect(message).toContain('[schematron:vendored]');
      expect(message).toContain('Peppol BIS');
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('simulated: fontoxpath native binding failed to load');
    } finally {
      consoleError.mockRestore();
      jest.dontMock('fontoxpath');
      jest.resetModules();
    }
  });
});
