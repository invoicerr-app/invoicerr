import { REGEXP_ONLY_DIGITS } from "input-otp"

import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"

/** Keeps the digits of a pasted code, so "123 456" or "123-456" from an authenticator app fills all six boxes. */
export function digitsOnly(pasted: string): string {
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
  "aria-invalid": ariaInvalid,
  "data-cy": dataCy,
}: Readonly<{
  value?: string
  onChange?: (value: string) => void
  onComplete?: (value: string) => void
  id?: string
  name?: string
  disabled?: boolean
  autoFocus?: boolean
  "aria-invalid"?: boolean
  "data-cy"?: string
}>) {
  return (
    <InputOTP
      maxLength={6}
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
      aria-invalid={ariaInvalid}
      data-cy={dataCy}
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} className="h-10 w-10 text-base" />
        <InputOTPSlot index={1} className="h-10 w-10 text-base" />
        <InputOTPSlot index={2} className="h-10 w-10 text-base" />
      </InputOTPGroup>
      <InputOTPSeparator className="text-muted-foreground" />
      <InputOTPGroup>
        <InputOTPSlot index={3} className="h-10 w-10 text-base" />
        <InputOTPSlot index={4} className="h-10 w-10 text-base" />
        <InputOTPSlot index={5} className="h-10 w-10 text-base" />
      </InputOTPGroup>
    </InputOTP>
  )
}
