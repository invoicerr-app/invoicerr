/**
 * `CompanyService` constructed DIRECTLY (never `CompanyModule` — same reason
 * `clients.vat-validation.spec.ts` gives for `ClientsService`), real Prisma.
 *
 * Covers the mass-assignment close on `createCompany` — the sibling of `company.service.spec.ts`'s own
 * `editCompanyInfo` coverage, but for the OTHER write path: `createCompany` used to spread the raw
 * `EditCompanyDto` body (minus `identifiers`) straight into `prisma.company.create`. `EditCompanyDto`
 * is a TypeScript interface, erased at compile time, and this API has no `ValidationPipe`, so that
 * spread accepted every key `CompanyCreateInput` knows about — including a nested write on any of
 * `Company`'s ~30 relations. Because the foreign key on those relations lives on the CHILD row, a
 * `connect` there REASSIGNS an existing row rather than merely failing, and a `create` fabricates one
 * with no upstream fact behind it (no Polar customer for a fabricated `subscription`, in particular).
 * `pickCompanyInput` (`company.service.ts`) is the fix: the single scalar allow-list both `createCompany`
 * and `editCompanyInfo` now write through.
 */

import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { CompanyService, pickCompanyInput } from './company.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

describe('pickCompanyInput — pure allow-list function', () => {
  it('drops every key outside the scalar allow-list, however the caller names it', () => {
    const picked = pickCompanyInput({
      name: 'Attacker Co',
      currency: 'EUR',
      country: 'France',
      // None of these are `EditCompanyDto` fields — a plain object literal happily carries them
      // anyway, exactly like a parsed JSON request body would.
      id: 'some-other-company-id',
      createdAt: new Date('1999-01-01'),
      subscription: { create: { status: 'ACTIVE' } },
      documents: { connect: [{ id: 'victim-document-id' }] },
      clients: { connect: [{ id: 'victim-client-id' }] },
      signingCertificates: { connect: [{ id: 'victim-cert-id' }] },
      channelConfigs: { connect: [{ id: 'victim-channel-id' }] },
    } as never);

    expect(picked).not.toHaveProperty('id');
    expect(picked).not.toHaveProperty('createdAt');
    expect(picked).not.toHaveProperty('subscription');
    expect(picked).not.toHaveProperty('documents');
    expect(picked).not.toHaveProperty('clients');
    expect(picked).not.toHaveProperty('signingCertificates');
    expect(picked).not.toHaveProperty('channelConfigs');
    expect(picked.name).toBe('Attacker Co');
    expect(picked.currency).toBe('EUR');
    expect(picked.country).toBe('France');
  });
});

describe('CompanyService — mass-assignment allow-list on createCompany', () => {
  let service: CompanyService;
  let userId: string;

  beforeAll(async () => {
    service = new CompanyService(fakeWebhookDispatcher);
    const user = await prisma.user.create({
      data: {
        id: `company-create-mass-assignment-${Date.now()}-${Math.random()}`,
        firstname: 'Mass',
        lastname: 'Assignment',
        email: `company-create-mass-assignment-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it('creates a company normally — the fix does not break ordinary onboarding', async () => {
    const created = await service.createCompany(userId, {
      name: 'Ordinary Onboarding Co',
      currency: 'EUR',
      country: 'France',
    } as never);
    try {
      expect(created.name).toBe('Ordinary Onboarding Co');
    } finally {
      await prisma.company.delete({ where: { id: created.id } }).catch(() => undefined);
    }
  });

  it(
    'ignores a nested `subscription.create` in the body — the zero-prerequisite exploit: no Polar ' +
      'customer behind it, `billing/status-reconcile.ts` would never reconcile it away',
    async () => {
      const created = await service.createCompany(userId, {
        name: 'Free Subscription Co',
        currency: 'EUR',
        country: 'France',
        subscription: {
          create: {
            status: 'ACTIVE',
            trialStartedAt: new Date(),
            trialEndsAt: new Date(),
          },
        },
      } as never);

      try {
        const row = await prisma.company.findUnique({
          where: { id: created.id },
          include: { subscription: true },
        });
        expect(row?.subscription).toBeNull();
      } finally {
        await prisma.company.delete({ where: { id: created.id } }).catch(() => undefined);
      }
    },
  );

  it('ignores `id` in the body instead of creating (or colliding with) the named row', async () => {
    const created = await service.createCompany(userId, {
      name: 'Spoofed Id Co',
      currency: 'EUR',
      country: 'France',
      id: 'some-other-company-id-that-must-not-be-used',
    } as never);

    try {
      expect(created.id).not.toBe('some-other-company-id-that-must-not-be-used');
      expect(
        await prisma.company.findUnique({ where: { id: 'some-other-company-id-that-must-not-be-used' } }),
      ).toBeNull();
    } finally {
      await prisma.company.delete({ where: { id: created.id } }).catch(() => undefined);
    }
  });
});
