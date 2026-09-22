/**
 * Durable, cross-replica replacement for the two bare, in-process `Map`s `lib/auth.ts` used to keep
 * short-lived signup state in: `pendingInvitationCodes` (deposited by `POST /invitations/validate`,
 * read back by the `signUp.email` hook) and `pendingMembershipsForDeletedUser` (deposited by
 * `deleteUser.beforeDelete`, read back by `deleteUser.afterDelete`).
 *
 * A bare `Map` only works when the request that WRITES a fact and the request that READS it back land
 * on the same process. Behind nginx with more than one API replica, nothing guarantees that — the read
 * simply finds nothing, indistinguishable from "this was never deposited": a signup is refused with
 * "registration is not allowed", or a company sync after account deletion is silently skipped.
 * `docker-compose.scale.yml` only replicates the WORKER today, so this was latent rather than observed
 * — but Redis is already a hard boot dependency for this backend
 * (`modules/documents/queue/redis-required.guard.ts`), so the fix does not need to wait for someone to
 * actually scale the API to notice the gap.
 *
 * Deliberately its OWN `ioredis` client rather than importing
 * `modules/documents/queue/redis.config.ts` — a different module's internal helper. Mirroring that
 * file's host/port/URL precedence here (rather than depending on it) keeps `lib/` and
 * `modules/documents/` decoupled, the same "own plain instance, not a shared import" choice
 * `lib/auth.ts` already makes for its own Prisma client (see that file's own header).
 *
 * `createPendingSignupStore` takes the client as a parameter specifically so a spec can drive it
 * against a fake honoring the same minimal interface, without opening a real connection — the same
 * "pure function over injected facts" shape `lib/secret-guard.ts#assertSecretsConfiguredForBoot`
 * already uses `env` for.
 */
import Redis from 'ioredis';

import { AccountMembership } from '@/modules/auth-extended/account-lifecycle';

/** The exact subset of `ioredis`'s own API this module calls — never the whole client — so a test
 *  double never has to implement anything beyond it. */
export interface PendingSignupRedisClient {
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

// A pending invitation code only needs to outlive one signup form submission — an hour is generous
// slack for someone who validated a code, then took a call before finishing the form, while still
// making sure a ghost entry cannot outlive the (short) session it was meant for.
const INVITATION_CODE_TTL_SECONDS = 60 * 60;

// `beforeDelete` → `afterDelete` are two hooks of the SAME `deleteUser` request — this only needs to
// bridge that one request's own lifetime. Five minutes is slack for a slow request, never meant to
// survive past it.
const DELETED_USER_MEMBERSHIPS_TTL_SECONDS = 5 * 60;

const invitationCodeKey = (email: string): string => `pending-signup:invitation-code:${email.toLowerCase()}`;
const deletedUserMembershipsKey = (userId: string): string =>
  `pending-signup:deleted-user-memberships:${userId}`;

export interface PendingSignupStore {
  setPendingInvitationCode(email: string, code: string): Promise<void>;
  getPendingInvitationCode(email: string): Promise<string | null>;
  deletePendingInvitationCode(email: string): Promise<void>;
  setPendingMembershipsForDeletedUser(userId: string, memberships: AccountMembership[]): Promise<void>;
  /** Reads AND deletes in one call — the two `Map` call sites in `lib/auth.ts` always did both
   *  together (`get` then `delete`), and a row that outlives its own read must not be replayable by a
   *  later, unrelated request for the same `userId` (a user id is only ever reused after full deletion,
   *  but there is no reason to rely on that instead of just not leaving the fact lying around). */
  takePendingMembershipsForDeletedUser(userId: string): Promise<AccountMembership[]>;
}

export function createPendingSignupStore(client: PendingSignupRedisClient): PendingSignupStore {
  return {
    async setPendingInvitationCode(email, code) {
      await client.set(invitationCodeKey(email), code, 'EX', INVITATION_CODE_TTL_SECONDS);
    },
    async getPendingInvitationCode(email) {
      return client.get(invitationCodeKey(email));
    },
    async deletePendingInvitationCode(email) {
      await client.del(invitationCodeKey(email));
    },
    async setPendingMembershipsForDeletedUser(userId, memberships) {
      await client.set(
        deletedUserMembershipsKey(userId),
        JSON.stringify(memberships),
        'EX',
        DELETED_USER_MEMBERSHIPS_TTL_SECONDS,
      );
    },
    async takePendingMembershipsForDeletedUser(userId) {
      const key = deletedUserMembershipsKey(userId);
      const raw = await client.get(key);
      await client.del(key);
      return raw ? (JSON.parse(raw) as AccountMembership[]) : [];
    },
  };
}

/** Same `REDIS_URL` / `REDIS_HOST`+`REDIS_PORT`+`REDIS_PASSWORD` precedence as
 *  `modules/documents/queue/redis.config.ts#createIoredisClient` (kept in sync deliberately, not
 *  imported — see this file's own header). Called at module scope by every consumer that needs this
 *  store (`lib/auth.ts`, `invitations/invitations.controller.ts`) — each gets its own client, the same
 *  "no shared instance required, only shared key names" choice `invitations.controller.ts`'s own
 *  comment on this explains.
 *
 * `lazyConnect: true`: the socket is opened on the FIRST actual command, never at construction —
 * so merely importing a module that calls this (as a controller does, at module scope) never itself
 * opens a connection or leaves an open handle behind, which matters for a future spec that imports
 * `invitations.controller.ts` without ever exercising `POST /invitations/validate`. */
export function createRedisClientForPendingSignups(): Redis {
  if (process.env.REDIS_URL) return new Redis(process.env.REDIS_URL, { lazyConnect: true });
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    lazyConnect: true,
  });
}
