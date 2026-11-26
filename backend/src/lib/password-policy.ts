/**
 * The minimum password length outside demo mode, written once for the better-auth config
 * (`lib/auth.ts`, the same value as better-auth's own default) and `POST /auth-extended/set-password`
 * (Swagger schema, length check and its message). The frontend's copy is the `length` rule of
 * `frontend/src/lib/password-rules.ts`. A demo instance lowers better-auth's minimum to the demo
 * account's password (`lib/auth.ts`); `set-password` is refused there anyway.
 */
export const MIN_PASSWORD_LENGTH = 8;
