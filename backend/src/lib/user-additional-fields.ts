/**
 * The `user.additionalFields` block `lib/auth.ts` hands better-auth, in a module a spec can import.
 *
 * `lib/auth.ts` itself cannot be imported from a spec: it builds a live Prisma adapter and reads the
 * real `.env` at import time (see `sso-policy.ts`'s module header). That made the field definitions
 * (including the `required: true` on `firstname`/`lastname` that better-auth enforces before any
 * database hook runs) impossible to assert against the real object, so a spec had to recopy them.
 * A copy cannot fail when the real declaration changes, which is exactly the drift this module
 * removes.
 *
 * `User.firstname` and `User.lastname` are `String` (NOT NULL) in `schema.prisma`, while an identity
 * provider is under no obligation to send `given_name`/`family_name`; `mapOidcProfileToUser` in
 * `sso-policy.ts` is what fills them from whatever claims the provider did send.
 */

import type { BetterAuthOptions } from 'better-auth';

/** better-auth's own type for the block, so the definitions below cannot drift from the library. */
export type UserAdditionalFields = NonNullable<NonNullable<BetterAuthOptions['user']>['additionalFields']>;

export const USER_ADDITIONAL_FIELDS = {
  firstname: {
    type: 'string',
    required: true,
    input: true,
  },
  lastname: {
    type: 'string',
    required: true,
    input: true,
  },
  // The "Mon compte" language preference (`schema.prisma`'s own comment on `User.locale` for the
  // full rationale). `input: true` is what makes `signUp.email({ locale: ... })` land in `data` for
  // the `userHookFunction` in `lib/auth.ts` to normalize. WITHOUT this declaration, better-auth's
  // own adapter would neither accept the field on write nor include it when building `session.user`,
  // and `PATCH /api/auth-extended/preferences` (which writes the column directly through Prisma,
  // bypassing better-auth entirely) would have no way to make its change visible in the session at
  // all. `required: false`: unset is a legitimate state (falls back to `Company.language`, then
  // 'en', see `resolve-user-language.ts`), not an error.
  locale: {
    type: 'string',
    required: false,
    input: true,
  },
} satisfies UserAdditionalFields;
