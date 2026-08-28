/**
 * What a build failure carries, and why it matters that it carries it.
 *
 * The message the underlying library gives is "validation failed" — a sentence nobody can act on.
 * The field that actually failed lives on `.errors`, as AJV objects. Turning those into text is the
 * difference between a user knowing their invoice has no lines and a user knowing nothing.
 *
 * Written after the first attempt at this shipped a reason that stopped at "validation failed": the
 * mapping is asserted here rather than inferred from a running app, because chasing it through the
 * app is what wasted the time.
 */
import { En16931FormatProvider } from './providers';
import { FormatBuildError } from '../../execution/types';
import { RecordingComplianceLogger } from '../../execution/logger';

/** An artifact port whose render throws exactly what @e-invoice-eu/core throws. */
function portThrowing(err: unknown) {
  return {
    renderXmlFormat: async () => {
      throw err;
    },
    renderPdfFormat: async () => {
      throw err;
    },
  } as never;
}

const artifact = { syntax: 'EN16931_CII', role: 'AUTHORITATIVE' } as never;
const ctx = { externalRef: 'inv-1', supplier: { countryCode: 'FR' } } as never;

async function buildAndCatch(err: unknown): Promise<FormatBuildError> {
  const provider = new En16931FormatProvider(portThrowing(err));
  try {
    await provider.build(artifact, ctx, {} as never, new RecordingComplianceLogger());
  } catch (e) {
    return e as FormatBuildError;
  }
  throw new Error('expected the build to throw');
}

describe('FormatBuildError — the reason has to name the field', () => {
  it('turns AJV error objects into readable text, in the MESSAGE and not only the payload', async () => {
    // Exactly the shape @e-invoice-eu/core throws for an invoice with no lines: an Ajv
    // ValidationError whose `message` is the useless part and whose `errors` is the useful part.
    const ajvLike = Object.assign(new Error('validation failed'), {
      validation: true,
      ajv: true,
      errors: [
        {
          instancePath: '/ubl:Invoice/cac:InvoiceLine',
          keyword: 'minItems',
          message: 'must NOT have fewer than 1 items',
        },
      ],
    });

    const err = await buildAndCatch(ajvLike);
    expect(err).toBeInstanceOf(FormatBuildError);
    expect(err.details).toEqual(['/ubl:Invoice/cac:InvoiceLine must NOT have fewer than 1 items']);
    // The screen shows the message, so the message is where this has to end up.
    expect(err.message).toContain('must NOT have fewer than 1 items');
    expect(err.message).toContain('EN16931_CII/AUTHORITATIVE');
  });

  it('never renders an AJV object as "[object Object]"', async () => {
    // The first version used `String(e)`. On an object that yields "[object Object]" — a detailed
    // diagnosis turned into noise, which is worse than no detail because it looks like detail.
    const err = await buildAndCatch(
      Object.assign(new Error('validation failed'), { errors: [{ instancePath: '/x', message: 'bad' }] }),
    );
    expect(err.message).not.toContain('[object Object]');
    expect(err.details.join(' ')).not.toContain('[object Object]');
  });

  it('degrades to the plain message when the error carries no detail at all', async () => {
    const err = await buildAndCatch(new Error('socket hang up'));
    expect(err.details).toEqual([]);
    expect(err.message).toContain('socket hang up');
  });

  it('does not re-wrap a FormatBuildError that came from deeper down', async () => {
    const inner = new FormatBuildError('inner', 'EN16931_CII', 'AUTHORITATIVE', ['detail']);
    const err = await buildAndCatch(inner);
    expect(err).toBe(inner);
  });
});
