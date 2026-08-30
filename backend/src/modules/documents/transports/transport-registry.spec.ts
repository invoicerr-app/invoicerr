import { TransportRegistry, UnknownTransportError } from './transport-registry';

describe('TransportRegistry', () => {
  it('resolves a transport that was registered', () => {
    const registry = new TransportRegistry();
    const transport = { send: jest.fn() };
    registry.register('email', 'Email', transport);

    expect(registry.resolve('email')).toBe(transport);
  });

  it('lists every registered transport, id and label only — what a company chooses from', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: jest.fn() });
    registry.register('acme-portal', 'Acme Portal', { send: jest.fn() });

    expect(registry.list()).toEqual([
      { id: 'email', label: 'Email' },
      { id: 'acme-portal', label: 'Acme Portal' },
    ]);
  });

  it('refuses an unknown transport cleanly, instead of returning undefined', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: jest.fn() });

    expect(() => registry.resolve('fax')).toThrow(UnknownTransportError);
    expect(() => registry.resolve('fax')).toThrow(/Unknown transport "fax"/);
  });

  it('refuses registering the same id twice', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: jest.fn() });

    expect(() => registry.register('email', 'Email again', { send: jest.fn() })).toThrow(
      /already registered/,
    );
  });

  it('has() reports presence without throwing', () => {
    const registry = new TransportRegistry();
    registry.register('email', 'Email', { send: jest.fn() });

    expect(registry.has('email')).toBe(true);
    expect(registry.has('fax')).toBe(false);
  });

  // The open-registry proof, the same shape as field-kinds.spec.ts's plugin test and
  // action-extensions.spec.ts's third-party action: nothing about TransportRegistry, or about
  // invoice-actions.ts's "send" handler, needs to change for a THIRD PARTY to add a brand-new
  // transport a company can then choose.
  it('a third-party transport registers and resolves exactly like the built-in one', async () => {
    const registry = new TransportRegistry();
    const thirdPartyTransport = { send: jest.fn().mockResolvedValue({ message: 'delivered via Acme' }) };
    registry.register('acme-portal', 'Acme Portal', thirdPartyTransport);

    const resolved = registry.resolve('acme-portal');
    await expect(
      resolved.send({ companyId: 'c1', document: { id: 'd1' } as never, label: 'Invoice', text: 'hi' }),
    ).resolves.toEqual({ message: 'delivered via Acme' });
  });
});
