/**
 * This used to be a second, independent `@Public()` decorator that set its OWN metadata key
 * (`'isPublic'`) — a silent foot-gun: `guards/auth.guard.ts` only ever reads the key
 * `@thallesp/nestjs-better-auth` sets (`'PUBLIC'`), so a handler decorated with THIS file's old
 * `@Public()` stayed protected by `AuthGuard` regardless (fails closed, never open — nothing was
 * actually mis-authorized). Nothing in this codebase ever imported it (every controller already uses
 * `Public`/`AllowAnonymous` from `@thallesp/nestjs-better-auth` directly), but a future route written
 * from an editor's auto-import could easily have picked THIS one and gotten an inexplicable 401 — or,
 * had the two keys ever been aligned in the wrong direction instead, silently opened a route.
 *
 * Re-exported as a plain alias instead of deleted outright: several other controllers' own header
 * comments (`public-documents.controller.ts`, `sdi-notifiche.controller.ts`, …) point at this exact
 * file path as the "wrong" decorator to reach for — keeping the file (now genuinely equivalent to the
 * real one) means those comments keep pointing at something that exists, while `import { Public } from
 * '@/decorators/public.decorator'` and `import { Public } from '@thallesp/nestjs-better-auth'` are now
 * simply two spellings of the identical decorator, so there is no wrong one left to pick.
 */
export { AllowAnonymous as Public } from '@thallesp/nestjs-better-auth';
