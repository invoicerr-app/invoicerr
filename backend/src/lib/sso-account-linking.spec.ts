import { handleOAuthUserInfo } from 'better-auth/oauth2';

import {
  type AccountLinkingOptions,
  type ValidateUserInfoHook,
  accountLinkingOptions,
  companyProviderId,
  companyThatMustVouchForLink,
  ssoLinkValidator,
} from '@/lib/sso-policy';

/**
 * Whether one company's identity provider can be made to sign somebody in AS a user of another
 * company — driven through better-auth's OWN linking code (`better-auth/oauth2`'s
 * `handleOAuthUserInfo`, the function every OAuth callback and every `sign-in/social` funnels
 * through), not through a re-implementation of it.
 *
 * That matters more than usual here. The whole defect this file pins was a LIBRARY behaviour the
 * repository never stated: a provider listed in `account.accountLinking.trustedProviders` is allowed
 * to adopt an existing local account found by EMAIL ALONE (`dist/oauth2/link-account.mjs`, the
 * `findUserByEmail` lookup and the `isTrustedProvider` branch right after it). Asserting that our
 * own configuration object holds some value would prove nothing about that: the configuration is only
 * dangerous because of what the library does with it, and a library upgrade that changes the meaning
 * of a field would leave such a test green while reopening the hole. So the options object built by
 * `sso-policy.ts#accountLinkingOptions` — the exact one `lib/auth.ts` passes to `betterAuth()` — is
 * fed to the real function, with a fake database underneath, and the assertion is on the OUTCOME:
 * whose session comes back.
 *
 * `lib/auth.ts` itself is deliberately never imported (see `sso-policy.ts`'s own module header:
 * importing it builds a live Prisma client and reads the real `.env`), which is precisely why the
 * options block lives in `sso-policy.ts` where a spec can reach it.
 */

// Two tenants that have nothing to do with each other. `COMPANY_A` is the victim's employer, whose
// IdP is honest; `COMPANY_B` is the attacker's own company, created through the open
// `POST /api/companies` route and carrying an IdP the attacker hosts and can make assert anything.
const COMPANY_A = 'clx3k2j1p0000qwer1234asdf';
const COMPANY_B = 'clx9z8y7w0000hjkl5678zxcv';

const VICTIM = {
  id: 'user_marie',
  email: 'marie@company-a.example',
  name: 'Marie Martin',
  // TRUE, and that is the point: better-auth's `requireLocalEmailVerified` gate (default on) is the
  // only thing that keeps the takeover off an account that never verified its address. Every account
  // provisioned through any IdP is written with this flag set from the provider's own claim
  // (`dist/oauth2/link-account.mjs`'s `createUser`), so on any instance that actually uses SSO — the
  // only instances where a tenant provider exists at all — this is the normal state, not a corner
  // case. A spec that exercised an unverified victim would pass for a reason unrelated to the fix.
  emailVerified: true,
} as const;

/** What the attacker's own identity provider returns for the victim's address. Every field is his. */
const ATTACKER_ASSERTION = {
  id: 'sub-chosen-by-the-attacker',
  email: VICTIM.email,
  name: 'Marie Martin',
  // An IdP asserting `email_verified` is asserting it about ITS OWN directory. Nothing stops a
  // provider from claiming it for an address in somebody else's domain, which is why this claim can
  // never be the thing that authorises adopting an existing account.
  emailVerified: true,
} as const;

interface FakeDb {
  linked: Array<{ providerId: string; accountId: string; userId: string }>;
  sessions: Array<{ userId: string }>;
}

/**
 * The `account.accountLinking` block this file used to ship, kept as the control arm: the attack is
 * replayed against it so the harness can prove it still SEES the takeover (see the case that uses it).
 */
const AS_IT_USED_TO_BE: AccountLinkingOptions = {
  enabled: true,
  trustedProviders: [companyProviderId(COMPANY_B)],
};

/** A membership directory: Marie belongs to exactly these companies and to nothing else. */
const membershipsOf =
  (...companies: string[]) =>
  async (userId: string, companyId: string) =>
    userId === VICTIM.id && companies.includes(companyId);

/**
 * The slice of better-auth's `GenericEndpointContext` that `handleOAuthUserInfo` actually touches on
 * the "an account with this email already exists" path, backed by an in-memory database.
 *
 * Built by hand rather than by booting a real better-auth instance: booting one needs a database
 * adapter, a secret, and a live HTTP layer, none of which change the decision under test. Everything
 * the decision DOES read — the options object, the resolved trusted-provider list, the user found by
 * email — is real.
 */
const buildContext = async (
  accountLinking: AccountLinkingOptions,
  db: FakeDb,
  options: { validateUserInfo?: ValidateUserInfoHook } = {},
) => {
  const trusted = accountLinking.trustedProviders;
  const trustedProviders = typeof trusted === 'function' ? await trusted(undefined) : (trusted ?? []);

  const context = {
    options: {
      account: { accountLinking },
      ...(options.validateUserInfo ? { user: { validateUserInfo: options.validateUserInfo } } : {}),
    },
    trustedProviders,
    socialProviders: [],
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    internalAdapter: {
      findAccountOwnerByKey: async ({ providerId, accountId }: { providerId: string; accountId: string }) => {
        const account = db.linked.find((a) => a.providerId === providerId && a.accountId === accountId);
        return account ? { kind: 'owned', user: VICTIM, account } : undefined;
      },
      findUserByEmail: async (email: string) =>
        email === VICTIM.email ? { user: VICTIM, accounts: [] } : null,
      linkAccount: async (account: { providerId: string; accountId: string; userId: string }) => {
        db.linked.push(account);
        return { id: 'acc_1', ...account };
      },
      updateUser: async () => VICTIM,
      createSession: async (userId: string) => {
        const session = { id: 'sess_1', userId };
        db.sessions.push(session);
        return session;
      },
    },
  };

  return { context } as unknown as Parameters<typeof handleOAuthUserInfo>[0];
};

/** Replay the attacker's callback: his own provider, his own `sub`, the victim's address. */
const signInThroughAttackerIdp = async (
  accountLinking: AccountLinkingOptions,
  options: { validateUserInfo?: ValidateUserInfoHook } = {},
) => {
  const db: FakeDb = { linked: [], sessions: [] };
  const providerId = companyProviderId(COMPANY_B);
  const result = await handleOAuthUserInfo(await buildContext(accountLinking, db, options), {
    userInfo: { ...ATTACKER_ASSERTION },
    account: { providerId, accountId: ATTACKER_ASSERTION.id },
    callbackURL: '/',
  });
  return { result, db };
};

describe("a tenant's own identity provider cannot sign in as another tenant's user", () => {
  // The exact object `lib/auth.ts` hands `betterAuth()`, on an instance where both tenants have
  // registered an IdP and both are live in this process — the state any instance with two SSO
  // customers is in.
  const accountLinking = accountLinkingOptions({ env: { providerId: 'oidc', registered: true } });

  it('refuses the sign-in outright — no session is issued for the victim', async () => {
    const { result, db } = await signInThroughAttackerIdp(accountLinking);

    // THE property. Not "the configuration says X": no session belonging to Marie may come back from
    // a callback that only ever proved the attacker controls his own Keycloak.
    expect(db.sessions).toEqual([]);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("never attaches the attacker's provider account to the victim's user row", async () => {
    // The session is the immediate prize, but the durable one is the account row: once
    // `c_<attacker company>` + his chosen `sub` points at Marie's user id, every later sign-in
    // through it is an ordinary, fully "legitimate" one that no later hardening of the linking rules
    // would even look at.
    const { db } = await signInThroughAttackerIdp(accountLinking);

    expect(db.linked).toEqual([]);
  });

  it("does not list any tenant provider as trusted for linking — only the operator's own", async () => {
    const trusted = accountLinking.trustedProviders;
    const ids = typeof trusted === 'function' ? await trusted(undefined) : (trusted ?? []);

    // `trustedProviders` waives the "the provider must assert email_verified" requirement on the
    // EXPLICIT link paths too (`dist/api/routes/callback.mjs`'s `link` branch and
    // `dist/api/routes/account.mjs`'s `linkSocial`), which is why the list is narrowed rather than
    // merely being made irrelevant by the gate above. An id an operator put in the environment is
    // vouched for by the operator; an id a customer typed into a settings form is not.
    expect(ids).toEqual(['oidc']);
    expect(ids).not.toContain(companyProviderId(COMPANY_A));
    expect(ids).not.toContain(companyProviderId(COMPANY_B));
  });

  it('still refuses even if a future edit puts tenant providers back in the trusted list', async () => {
    // Defence in depth, stated as a test so it cannot quietly become untrue: the narrowing above and
    // the gate are two independent locks, and this drives the same attack with the trusted list
    // deliberately re-widened to what it used to be.
    const reWidened: AccountLinkingOptions = {
      ...accountLinking,
      trustedProviders: [companyProviderId(COMPANY_A), companyProviderId(COMPANY_B), 'oidc'],
    };
    const { result, db } = await signInThroughAttackerIdp(reWidened);

    expect(db.sessions).toEqual([]);
    expect(result.data).toBeNull();
  });

  it('is what the gate does, not what the fake database does — the harness can see the takeover', async () => {
    // A guard on the guard. If a better-auth upgrade ever renamed the field this fix sets, every
    // assertion above would keep passing for the wrong reason: the harness would simply have stopped
    // being able to express the attack. So the same attack is replayed once against the permissive
    // configuration this code used to ship, and the takeover MUST still happen there. The day this
    // case fails is the day the cases above stopped proving anything.
    const { result, db } = await signInThroughAttackerIdp(AS_IT_USED_TO_BE);

    expect(db.sessions).toEqual([{ id: 'sess_1', userId: VICTIM.id }]);
    expect(result.data?.user.id).toBe(VICTIM.id);
  });

  it('is refused by the membership gate alone, with the linking gate deliberately removed', async () => {
    // The two locks are independent, and this proves the SECOND one on its own — the permissive
    // configuration above, plus `ssoLinkValidator` exactly as `lib/auth.ts` installs it, over a
    // directory in which Marie belongs to company A and to nothing else. better-auth turns this
    // hook's refusal into a 403 rather than continuing.
    await expect(
      signInThroughAttackerIdp(AS_IT_USED_TO_BE, {
        validateUserInfo: ssoLinkValidator({ isCompanyMember: membershipsOf(COMPANY_A) }),
      }),
    ).rejects.toThrow();
  });
});

describe('a tenant provider may only ever vouch for a user inside its own company', () => {
  const linkFromCompanyB = {
    action: 'link-account',
    method: 'oauth',
    oauth: { providerId: companyProviderId(COMPANY_B) },
  } as const;

  /** The hook as `lib/auth.ts` builds it, over a directory where Marie is a member of `companies`. */
  const validator = (...companies: string[]) =>
    ssoLinkValidator({ isCompanyMember: membershipsOf(...companies) });

  const refuse = async (
    hook: ReturnType<typeof validator>,
    source: unknown,
    user: Record<string, unknown> = { id: VICTIM.id },
  ) => hook({ user: user as never, source: source as never }, undefined as never);

  it('refuses the link when the user does not belong to that company', async () => {
    expect(await refuse(validator(COMPANY_A), linkFromCompanyB)).toEqual({
      error: expect.any(String),
      errorDescription: expect.any(String),
    });
  });

  it("allows a member of that company to link their own employer's IdP", async () => {
    expect(await refuse(validator(COMPANY_A, COMPANY_B), linkFromCompanyB)).toBeUndefined();
  });

  it('fails closed when there is no user to check the membership of', async () => {
    // "We could not tell whether this user is a member" must never read as "they are" — this hook is
    // the last thing between a tenant's identity provider and somebody else's account.
    expect(await refuse(validator(COMPANY_A, COMPANY_B), linkFromCompanyB, {})).not.toBeUndefined();
  });

  it('fails closed when the membership lookup itself fails', async () => {
    const hook = ssoLinkValidator({
      isCompanyMember: async () => {
        throw new Error('database unavailable');
      },
    });

    // A throw is better-auth's own fail-closed path (`dist/utils/validate-user-info.mjs` turns it
    // into a 403 rather than letting the sign-in continue), so letting it propagate IS the refusal.
    await expect(refuse(hook, linkFromCompanyB)).rejects.toThrow('database unavailable');
  });

  it('leaves the instance-wide provider alone — it is the operator who vouches for that one', async () => {
    const fromEnvProvider = { action: 'link-account', method: 'oauth', oauth: { providerId: 'oidc' } };

    expect(companyThatMustVouchForLink(fromEnvProvider)).toBeNull();
    expect(await refuse(validator(), fromEnvProvider)).toBeUndefined();
  });

  it('leaves sign-up and sign-in alone — it is ADOPTING an existing account that is gated', async () => {
    // A brand-new user arriving through their employer's IdP has no local account to adopt, and an
    // account already bound to this provider proved that binding when it was made. Gating either
    // would refuse an employee their own employer's IdP without closing anything.
    for (const action of ['create-user', 'sign-in']) {
      const source = { ...linkFromCompanyB, action };
      expect(companyThatMustVouchForLink(source)).toBeNull();
      expect(await refuse(validator(), source)).toBeUndefined();
    }
  });

  it('reads an SSO-plugin source too, not only the generic-OAuth one', () => {
    // Nothing mounts better-auth's own SSO plugin today; reading `sso.providerId` as well as
    // `oauth.providerId` is what stops mounting one later from stepping around this gate in silence.
    const viaSsoPlugin = {
      action: 'link-account',
      method: 'sso-oidc',
      sso: { providerId: companyProviderId(COMPANY_B) },
    };

    expect(companyThatMustVouchForLink(viaSsoPlugin)).toBe(COMPANY_B);
  });

  it.each([
    null,
    undefined,
    42,
    'link-account',
    {},
    { action: 'link-account' },
  ])('never throws on the untrusted shape %p that better-auth hands the hook', (source) => {
    expect(() => companyThatMustVouchForLink(source)).not.toThrow();
    expect(companyThatMustVouchForLink(source)).toBeNull();
  });
});
