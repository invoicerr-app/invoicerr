import { vi } from 'vitest';
import {
  CredentialFieldDescriptor,
  InvalidCredentialFieldsError,
  TransportRegistry,
  UnknownTransportError,
  validateTransportCredentialFields,
} from './transport-registry';

describe('TransportRegistry', () => {
  it('resolves a transport that was registered', () => {
    const registry = new TransportRegistry();
    const transport = { send: vi.fn() };
    registry.register('email', 'Email', transport);

    expect(registry.resolve('email')).toBe(transport);
  });

  it('lists every registered transport, id, label and credentialFields — what a company chooses from', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: vi.fn() });
    registry.register('acme-portal', 'Acme Portal', { send: vi.fn() });

    expect(registry.list()).toEqual([
      { id: 'email', label: 'Email', credentialFields: [] },
      { id: 'acme-portal', label: 'Acme Portal', credentialFields: [] },
    ]);
  });

  it('refuses an unknown transport cleanly, instead of returning undefined', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: vi.fn() });

    expect(() => registry.resolve('fax')).toThrow(UnknownTransportError);
    expect(() => registry.resolve('fax')).toThrow(/Unknown transport "fax"/);
  });

  it('refuses registering the same id twice', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: vi.fn() });

    expect(() => registry.register('email', 'Email again', { send: vi.fn() })).toThrow(/already registered/);
  });

  it('has() reports presence without throwing', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: vi.fn() });

    expect(registry.has('email')).toBe(true);
    expect(registry.has('fax')).toBe(false);
  });

  // The open-registry proof, the same shape as field-kinds.spec.ts's plugin test and
  // action-extensions.spec.ts's third-party action: nothing about TransportRegistry, or about
  // invoice-actions.ts's "send" handler, needs to change for a THIRD PARTY to add a brand-new
  // transport a company can then choose.
  it('a third-party transport registers and resolves exactly like the built-in one', async () => {
    const registry = new TransportRegistry();
    const thirdPartyTransport = { send: vi.fn().mockResolvedValue({ message: 'delivered via Acme' }) };
    registry.register('acme-portal', 'Acme Portal', thirdPartyTransport);

    const resolved = registry.resolve('acme-portal');
    await expect(
      resolved.send({ companyId: 'c1', document: { id: 'd1' } as never, label: 'Invoice', text: 'hi' }),
    ).resolves.toEqual({ message: 'delivered via Acme' });
  });
});

/**
 * Issue #526 (scope addition) — "each transport declares its credential fields... validated at boot
 * against what that transport's own credential parser reads". These are the tests the owner asked
 * for by name: a test that FAILS when a transport's parser reads a key its declaration does not
 * list, or the other way round. Synthetic fake transports throughout — never a real transport file —
 * so this proves the CHECKER itself catches both directions of drift, deterministically, with nothing
 * to set up.
 */
describe('validateTransportCredentialFields — the checker the owner asked for', () => {
  const FIELD: CredentialFieldDescriptor = {
    key: 'clientId',
    kind: 'text',
    valueType: 'string',
    required: true,
    labelKey: 'settings.channels.fields.clientId',
  };

  it('a transport with no credentialFields and no parser is skipped entirely (e.g. "email")', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: vi.fn() });
    expect(() => validateTransportCredentialFields(registry)).not.toThrow();
  });

  it('a well-formed transport (declaration matches exactly what the parser reads) passes', () => {
    const registry = new TransportRegistry();
    registry.register('acme', 'Acme', {
      send: vi.fn(),
      credentialFields: [FIELD],
      parseCredentials: (resolved) => {
        const clientId = resolved.config.clientId;
        if (typeof clientId !== 'string') return null;
        return { clientId };
      },
    });
    expect(() => validateTransportCredentialFields(registry)).not.toThrow();
  });

  // Direction 1: the parser reads a key the declaration does not list.
  it('FAILS when the parser reads a key credentialFields does not declare', () => {
    const registry = new TransportRegistry();
    registry.register('acme', 'Acme', {
      send: vi.fn(),
      credentialFields: [FIELD],
      parseCredentials: (resolved) => {
        const clientId = resolved.config.clientId;
        // Reads an UNDECLARED key — the exact regression this check exists to catch.
        const secretlyAlsoReads = resolved.config.apiKey;
        if (typeof clientId !== 'string') return null;
        return { clientId, apiKey: secretlyAlsoReads };
      },
    });
    expect(() => validateTransportCredentialFields(registry)).toThrow(InvalidCredentialFieldsError);
    expect(() => validateTransportCredentialFields(registry)).toThrow(
      /reads "config.apiKey", which "credentialFields" does not declare/,
    );
  });

  // Direction 2: credentialFields declares a key the parser never reads.
  it('FAILS when credentialFields declares a key the parser never reads', () => {
    const registry = new TransportRegistry();
    registry.register('acme', 'Acme', {
      send: vi.fn(),
      credentialFields: [
        FIELD,
        { key: 'unused', kind: 'text', valueType: 'string', required: true, labelKey: 'x.unused' },
      ],
      parseCredentials: (resolved) => {
        const clientId = resolved.config.clientId;
        // Never reads "unused" — the declaration is stale.
        if (typeof clientId !== 'string') return null;
        return { clientId };
      },
    });
    expect(() => validateTransportCredentialFields(registry)).toThrow(InvalidCredentialFieldsError);
    expect(() => validateTransportCredentialFields(registry)).toThrow(
      /declares "unused" but the parser never reads it/,
    );
  });

  it('FAILS when credentialFields is declared without a matching parseCredentials', () => {
    const registry = new TransportRegistry();
    registry.register('acme', 'Acme', { send: vi.fn(), credentialFields: [FIELD] });
    expect(() => validateTransportCredentialFields(registry)).toThrow(/no "parseCredentials"/);
  });

  it('FAILS when parseCredentials is declared without matching credentialFields', () => {
    const registry = new TransportRegistry();
    registry.register('acme', 'Acme', {
      send: vi.fn(),
      parseCredentials: () => ({}),
    });
    expect(() => validateTransportCredentialFields(registry)).toThrow(/no "credentialFields"/);
  });

  it('a "learnedByBackend" field is read by the parser but never required as a form field — still accounted for', () => {
    const registry = new TransportRegistry();
    registry.register('acme', 'Acme', {
      send: vi.fn(),
      credentialFields: [
        FIELD,
        {
          key: 'learnedToken',
          kind: 'text',
          valueType: 'string',
          required: false,
          labelKey: 'x.learnedToken',
          learnedByBackend: true,
        },
      ],
      parseCredentials: (resolved) => {
        const clientId = resolved.config.clientId;
        const learnedToken = resolved.config.learnedToken;
        if (typeof clientId !== 'string') return null;
        return { clientId, learnedToken };
      },
    });
    expect(() => validateTransportCredentialFields(registry)).not.toThrow();
  });

  it("valueType picks a dummy value the parser's own typeof guard accepts (number/boolean, not just string)", () => {
    const registry = new TransportRegistry();
    registry.register('acme', 'Acme', {
      send: vi.fn(),
      credentialFields: [
        { key: 'port', kind: 'text', valueType: 'number', required: true, labelKey: 'x.port' },
        { key: 'secure', kind: 'text', valueType: 'boolean', required: false, labelKey: 'x.secure' },
      ],
      parseCredentials: (resolved) => {
        const port = resolved.config.port;
        const secure = resolved.config.secure;
        if (typeof port !== 'number') return null;
        return { port, secure: secure === true };
      },
    });
    expect(() => validateTransportCredentialFields(registry)).not.toThrow();
  });
});
