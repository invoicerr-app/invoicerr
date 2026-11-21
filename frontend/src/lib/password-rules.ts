export type PasswordRuleId = "length" | "letter" | "number" | "special"

/**
 * The four rules a password must satisfy - ONE list, read both by the account security form's zod
 * schema (`pages/(app)/account/security.tsx`, each unmet rule becomes the error shown under the field)
 * and by the sign-up page's strength meter (`PasswordStrength`, each met rule lights one segment), so
 * the meter can never call "strong" a password the form then refuses.
 * The keys are the pre-existing `auth.signup.errors.password*` messages.
 */
export const PASSWORD_RULES: ReadonlyArray<{
  id: PasswordRuleId
  messageKey: string
  test: (value: string) => boolean
}> = [
  { id: "length", messageKey: "auth.signup.errors.passwordMinLength", test: (v) => v.length >= 8 },
  { id: "letter", messageKey: "auth.signup.errors.passwordLetter", test: (v) => /[A-Za-z]/.test(v) },
  { id: "number", messageKey: "auth.signup.errors.passwordNumber", test: (v) => /\d/.test(v) },
  { id: "special", messageKey: "auth.signup.errors.passwordSpecial", test: (v) => /[^A-Za-z0-9]/.test(v) },
]

export function passwordScore(value: string): number {
  return PASSWORD_RULES.filter((rule) => rule.test(value)).length
}
