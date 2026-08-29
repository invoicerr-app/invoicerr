import { ActionHandler, ActionRegistry } from './action-registry';

describe('ActionRegistry', () => {
  it('resolves a handler that was registered for this (type, action) pair', async () => {
    const registry = new ActionRegistry();
    registry.register('quote', 'save-draft', async (ctx) => ({
      id: 'doc-1',
      typeId: ctx.typeId,
      status: 'draft',
      data: ctx.data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const handler = registry.resolve('quote', 'save-draft');
    expect(handler).toBeDefined();

    const result = await handler!({ companyId: 'c1', typeId: 'quote', data: { notes: 'hi' } });
    expect(result).toMatchObject({ id: 'doc-1', typeId: 'quote', status: 'draft' });
  });

  // This is the mechanism the task calls out explicitly: a declared-but-unimplemented action must
  // be BLOCKED and say so — never silently ignored. The registry's contribution to that is simply
  // returning `undefined` instead of throwing or inventing a no-op handler; DocumentsService.runAction
  // is what turns that into a clear, loud 501 (see documents.service.spec.ts-equivalent coverage via
  // the quote descriptor's real "send" action, which is genuinely left unregistered on purpose).
  it('resolves to undefined for an action nobody registered an implementation for', () => {
    const registry = new ActionRegistry();
    registry.register('quote', 'save-draft', async (ctx) => ({
      id: 'doc-1',
      typeId: ctx.typeId,
      status: 'draft',
      data: ctx.data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    expect(registry.resolve('quote', 'send')).toBeUndefined();
    expect(registry.resolve('invoice', 'save-draft')).toBeUndefined();
  });

  it('refuses registering the same (type, action) pair twice', () => {
    const registry = new ActionRegistry();
    const handler: ActionHandler = async (ctx) => ({
      id: 'x',
      typeId: ctx.typeId,
      status: 'draft',
      data: ctx.data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    registry.register('quote', 'save-draft', handler);
    expect(() => registry.register('quote', 'save-draft', handler)).toThrow(/already registered/);
  });
});
