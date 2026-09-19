/**
 * Instance operators — a coarse, env-var allowlist of e-mail addresses trusted with INSTANCE-WIDE
 * actions (today: wiping the whole instance — see `modules/instance/instance-reset.service.ts`).
 * Deliberately NOT a `CompanyRole`: every existing role (`guards/roles.guard.ts`) is scoped to ONE
 * company via `@ActiveCompany()`, and there is no "OWNER of every company on this deployment" concept
 * anywhere else in this schema — `backup.controller.ts` used to lean on "any company's OWNER" as a
 * stand-in for exactly that, a doctrine this module retires (see that controller's own updated
 * header).
 *
 * `INSTANCE_OPERATOR_EMAILS` — comma-separated, case-insensitive, trimmed. Left unset (the default
 * for every self-hosted instance, and the ONLY state a SaaS deployment is ever in — see
 * `guards/instance-operator.guard.ts`'s own SaaS refusal) means the list is empty, which means
 * `isInstanceOperator` returns `false` for EVERY caller, including whoever owns the very first
 * company on the instance: there is deliberately no "nobody configured this yet, so trust somebody by
 * default" fallback. An instance-wide wipe with no explicit operator stays permanently unavailable
 * until an operator actually sets this variable (and the process restarts to pick it up).
 */
export function instanceOperatorEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.INSTANCE_OPERATOR_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isInstanceOperator(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!email) return false;
  return instanceOperatorEmails(env).includes(email.trim().toLowerCase());
}
