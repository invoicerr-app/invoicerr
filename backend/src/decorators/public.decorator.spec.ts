import { vi } from 'vitest';

import { SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// `@thallesp/nestjs-better-auth`'s own package ships an ESM-only transitive dependency
// (better-auth/dist/integrations/node.mjs) jest's ts-jest transform doesn't parse — mocked here, the
// same way `legal.controller.spec.ts`/`public-documents.controller.spec.ts` already do, rather than
// widening jest's transformIgnorePatterns for one decorator whose only job is to set metadata
// AuthGuard reads. This mock mirrors the REAL package's own `AllowAnonymous` implementation exactly
// (confirmed by reading `node_modules/@thallesp/nestjs-better-auth/dist/index.mjs`:
// `const AllowAnonymous = () => SetMetadata("PUBLIC", true);`) rather than a stub that sets nothing —
// this spec's whole point is proving THIS file's `Public` forwards to that exact key.
vi.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => SetMetadata('PUBLIC', true),
}));

import { Public } from './public.decorator';

/**
 * Reproduces the actual defect: this file used to set its OWN metadata key (`'isPublic'`), while
 * `guards/auth.guard.ts` only ever reads the key `@thallesp/nestjs-better-auth` sets (`'PUBLIC'`). A
 * handler decorated with the OLD `@Public()` from this file therefore stayed protected — the guard
 * would read `undefined`, never `true`. This spec fails on that old implementation and passes once
 * this file is a plain re-export of the real decorator.
 */
describe('Public (decorators/public.decorator.ts)', () => {
  it('sets the exact "PUBLIC" metadata key AuthGuard reads — the same real decorator, not a homonym', () => {
    class Target {
      @Public()
      handler(): void {
        /* no-op */
      }
    }

    const reflector = new Reflector();
    const isPublic = reflector.get<boolean>('PUBLIC', Target.prototype.handler);
    expect(isPublic).toBe(true);
  });

  it('never sets the OLD, unread key — a regression back to it would silently reopen the mismatch', () => {
    class Target {
      @Public()
      handler(): void {
        /* no-op */
      }
    }

    const reflector = new Reflector();
    expect(reflector.get<boolean | undefined>('isPublic', Target.prototype.handler)).toBeUndefined();
  });
});
