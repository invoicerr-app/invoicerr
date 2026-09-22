import { ActionHandler, ActionRegistry } from './action-registry';

describe('ActionRegistry', () => {
  it('resolves a handler that was registered for this (type, action) pair', async () => {
    const registry = new ActionRegistry();
    registry.register('quote', 'save-draft', async (ctx) => ({
      document: {
        id: 'doc-1',
        typeId: ctx.typeId,
        status: 'draft',
        data: ctx.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      changed: true,
    }));

    const handler = registry.resolve('quote', 'save-draft');
    expect(handler).toBeDefined();

    const result = await handler!({ companyId: 'c1', typeId: 'quote', data: { notes: 'hi' }, params: {} });
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'doc-1', typeId: 'quote', status: 'draft' });
  });

  // This is the mechanism the task calls out explicitly: a declared-but-unimplemented action must
  // be BLOCKED and say so — never silently ignored. The registry's contribution to that is simply
  // returning `undefined` instead of throwing or inventing a no-op handler; DocumentsService.runAction
  // is what turns that into a clear, loud 501 (see documents.service.spec.ts's "convert-to-invoice"
  // coverage — a real, declared action on the real quote descriptor, genuinely never registered).
  it('resolves to undefined for an action nobody registered an implementation for', () => {
    const registry = new ActionRegistry();
    registry.register('quote', 'save-draft', async (ctx) => ({
      document: {
        id: 'doc-1',
        typeId: ctx.typeId,
        status: 'draft',
        data: ctx.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      changed: true,
    }));

    expect(registry.resolve('quote', 'convert-to-invoice')).toBeUndefined();
    expect(registry.resolve('invoice', 'save-draft')).toBeUndefined();
  });

  it('refuses registering the same (type, action) pair twice', () => {
    const registry = new ActionRegistry();
    const handler: ActionHandler = async (ctx) => ({
      document: {
        id: 'x',
        typeId: ctx.typeId,
        status: 'draft',
        data: ctx.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      changed: true,
    });

    registry.register('quote', 'save-draft', handler);
    expect(() => registry.register('quote', 'save-draft', handler)).toThrow(/already registered/);
  });

  describe('params-defaults resolvers', () => {
    it('resolves undefined when no resolver was registered — a normal state, not an error', () => {
      const registry = new ActionRegistry();
      expect(registry.resolveParamsDefaults('quote', 'send')).toBeUndefined();
    });

    it('resolves a registered defaults resolver and runs it with the action context', async () => {
      const registry = new ActionRegistry();
      registry.registerParamsDefaults('quote', 'send', async ({ data }) => ({
        recipient: data.client === 'client-1' ? 'client-1@example.com' : '',
      }));

      const resolver = registry.resolveParamsDefaults('quote', 'send');
      expect(resolver).toBeDefined();
      await expect(
        resolver!({ companyId: 'c1', typeId: 'quote', data: { client: 'client-1' }, params: {} }),
      ).resolves.toEqual({ recipient: 'client-1@example.com' });
    });

    it('refuses registering a second defaults resolver for the same (type, action) pair', () => {
      const registry = new ActionRegistry();
      registry.registerParamsDefaults('quote', 'send', async () => ({}));

      expect(() => registry.registerParamsDefaults('quote', 'send', async () => ({}))).toThrow(
        /already registered/,
      );
    });
  });
});
