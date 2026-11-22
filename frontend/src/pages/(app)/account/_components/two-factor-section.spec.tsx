import { fireEvent, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

vi.mock("@/lib/auth", () => ({
  authClient: {
    useSession: vi.fn(),
    twoFactor: {
      enable: vi.fn(),
      verifyTotp: vi.fn(),
      disable: vi.fn(),
      generateBackupCodes: vi.fn(),
    },
  },
}))
import { authClient } from "@/lib/auth"

import { secretFromTotpUri, TwoFactorSection } from "./two-factor-section"

const TOTP_URI = "otpauth://totp/Invoicerr:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Invoicerr"

const refetch = vi.fn()

function mockSession(twoFactorEnabled: boolean) {
  vi.mocked(authClient.useSession).mockReturnValue({
    data: { user: { id: "u1", twoFactorEnabled } },
    refetch,
  } as unknown as ReturnType<typeof authClient.useSession>)
}

function typePassword(value = "correct horse") {
  fireEvent.change(document.querySelector('[data-cy="two-factor-password-input"]') as HTMLInputElement, {
    target: { value },
  })
}

function byCy(name: string) {
  return document.querySelector(`[data-cy="${name}"]`) as HTMLElement
}

describe("secretFromTotpUri", () => {
  it("reads the base32 secret from an otpauth URI", () => {
    expect(secretFromTotpUri(TOTP_URI)).toBe("JBSWY3DPEHPK3PXP")
  })

  it("returns an empty string for anything else", () => {
    expect(secretFromTotpUri("not a uri")).toBe("")
    expect(secretFromTotpUri("otpauth://totp/Invoicerr")).toBe("")
  })
})

describe("<TwoFactorSection>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("enables the second factor: password, scan, code, then backup codes", async () => {
    mockSession(false)
    vi.mocked(authClient.twoFactor.enable).mockResolvedValue({
      data: { totpURI: TOTP_URI, backupCodes: ["aaaa-1111", "bbbb-2222"] },
      error: null,
    } as never)
    vi.mocked(authClient.twoFactor.verifyTotp).mockResolvedValue({ data: {}, error: null } as never)
    render(<TwoFactorSection hasCredentialAccount demoMode={false} />)

    expect(byCy("two-factor-enable")).toBeDisabled()
    typePassword()
    fireEvent.click(byCy("two-factor-enable"))

    await waitFor(() => expect(byCy("two-factor-secret")).toHaveTextContent("JBSWY3DPEHPK3PXP"))
    expect(authClient.twoFactor.enable).toHaveBeenCalledWith({ password: "correct horse" })

    // The sixth digit submits on its own: no click on the confirm button.
    fireEvent.change(byCy("two-factor-setup-code-input"), { target: { value: "123456" } })

    await waitFor(() => expect(byCy("two-factor-backup-codes")).toBeInTheDocument())
    expect(authClient.twoFactor.verifyTotp).toHaveBeenCalledTimes(1)
    expect(authClient.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: "123456" })
    expect(document.querySelectorAll('[data-cy="two-factor-backup-code"]')).toHaveLength(2)
    expect(toast.success).toHaveBeenCalled()
    expect(refetch).toHaveBeenCalled()
  })

  it("stays on the scan step when the code is refused", async () => {
    mockSession(false)
    vi.mocked(authClient.twoFactor.enable).mockResolvedValue({
      data: { totpURI: TOTP_URI, backupCodes: [] },
      error: null,
    } as never)
    vi.mocked(authClient.twoFactor.verifyTotp).mockResolvedValue({
      data: null,
      error: { message: "Invalid code" },
    } as never)
    render(<TwoFactorSection hasCredentialAccount demoMode={false} />)

    typePassword()
    fireEvent.click(byCy("two-factor-enable"))
    await waitFor(() => expect(byCy("two-factor-setup-code-input")).toBeInTheDocument())
    fireEvent.change(byCy("two-factor-setup-code-input"), { target: { value: "000000" } })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invalid code"))
    expect(byCy("two-factor-setup-code-input")).toBeInTheDocument()
    // Emptied for the next try, which submits on its sixth digit again.
    await waitFor(() => expect(byCy("two-factor-setup-code-input")).toHaveValue(""))
    expect(refetch).not.toHaveBeenCalled()
  })

  it("keeps the confirm button for a code typed without the auto-submit, and takes digits only", async () => {
    mockSession(false)
    vi.mocked(authClient.twoFactor.enable).mockResolvedValue({
      data: { totpURI: TOTP_URI, backupCodes: [] },
      error: null,
    } as never)
    vi.mocked(authClient.twoFactor.verifyTotp).mockResolvedValue({ data: {}, error: null } as never)
    render(<TwoFactorSection hasCredentialAccount demoMode={false} />)

    typePassword()
    fireEvent.click(byCy("two-factor-enable"))
    await waitFor(() => expect(byCy("two-factor-setup-code-input")).toBeInTheDocument())

    fireEvent.change(byCy("two-factor-setup-code-input"), { target: { value: "12ab" } })
    expect(byCy("two-factor-setup-code-input")).toHaveValue("")
    fireEvent.change(byCy("two-factor-setup-code-input"), { target: { value: "12345" } })
    expect(byCy("two-factor-confirm")).toBeDisabled()
    expect(authClient.twoFactor.verifyTotp).not.toHaveBeenCalled()
  })

  it("disables the second factor with the password", async () => {
    mockSession(true)
    vi.mocked(authClient.twoFactor.disable).mockResolvedValue({ data: {}, error: null } as never)
    render(<TwoFactorSection hasCredentialAccount demoMode={false} />)

    typePassword()
    fireEvent.click(byCy("two-factor-disable"))

    await waitFor(() =>
      expect(authClient.twoFactor.disable).toHaveBeenCalledWith({ password: "correct horse" }),
    )
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it("shows fresh backup codes after regenerating them", async () => {
    mockSession(true)
    vi.mocked(authClient.twoFactor.generateBackupCodes).mockResolvedValue({
      data: { backupCodes: ["cccc-3333"] },
      error: null,
    } as never)
    render(<TwoFactorSection hasCredentialAccount demoMode={false} />)

    typePassword()
    fireEvent.click(byCy("two-factor-regenerate"))

    await waitFor(() => expect(byCy("two-factor-backup-codes")).toHaveTextContent("cccc-3333"))
  })

  it("explains that a password is needed for accounts without one", () => {
    mockSession(false)
    render(<TwoFactorSection hasCredentialAccount={false} demoMode={false} />)

    expect(byCy("two-factor-needs-password")).toBeInTheDocument()
    expect(byCy("two-factor-enable")).toBeNull()
  })

  it("keeps the setup buttons disabled in demo mode", () => {
    mockSession(false)
    render(<TwoFactorSection hasCredentialAccount demoMode />)

    typePassword()
    expect(byCy("two-factor-enable")).toBeDisabled()
  })
})
