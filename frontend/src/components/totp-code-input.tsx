import { REGEXP_ONLY_DIGITS } from "input-otp"

import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"

/**
 * How many digits an authenticator-app (TOTP) code has: the boxes below and the callers' complete checks.
 * Must stay equal to `totpOptions.digits` in `backend/src/lib/two-factor-options.ts`, which makes the
 * server issue and verify codes of this length.
 */
export const TOTP_LENGTH = 6

/** The boxes of each of the two groups the code is shown in, the way the apps display it. */
const GROUP_SIZE = TOTP_LENGTH / 2

/** Keeps the digits of a pasted code, so "123 456" or "123-456" from an authenticator app fills all six boxes. */
function digitsOnly(pasted: string): string {
  return pasted.replace(/\D/g, "")
}

/**
 * The six-digit authenticator-app (TOTP) code as six boxes in two groups of three, the way the apps
 * display it. Digits only, `one-time-code` autocomplete so the phone keyboard can offer the code, and
 * a whole pasted code is accepted. The real `<input>` underneath carries `id`, `name` and `data-cy`,
 * so labels, form reads and tests keep pointing at it.
 */
export function TotpCodeInput({
  value,
  onChange,
  onComplete,
  id,
  name,
  disabled,
  autoFocus,
  "data-cy": dataCy,
}: Readonly<{
  value?: string
  onChange?: (value: string) => void
  onComplete?: (value: string) => void
  id?: string
  name?: string
  disabled?: boolean
  autoFocus?: boolean
  "data-cy"?: string
}>) {
  return (
    <InputOTP
      maxLength={TOTP_LENGTH}
      pattern={REGEXP_ONLY_DIGITS}
      pasteTransformer={digitsOnly}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      id={id}
      name={name}
      disabled={disabled}
      autoFocus={autoFocus}
      data-cy={dataCy}
    >
      <TotpSlotGroup from={0} />
      <InputOTPSeparator className="text-muted-foreground" />
      <TotpSlotGroup from={GROUP_SIZE} />
    </InputOTP>
  )
}

/** One group of boxes, for the code positions `from` to `from + GROUP_SIZE - 1`. */
function TotpSlotGroup({ from }: Readonly<{ from: number }>) {
  const positions = Array.from({ length: GROUP_SIZE }, (_, offset) => from + offset)
  return (
    <InputOTPGroup>
      {positions.map((position) => (
        <InputOTPSlot key={position} index={position} className="h-10 w-10 text-base" />
      ))}
    </InputOTPGroup>
  )
}
