import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth"
import { authenticatedFetch } from "@/hooks/use-fetch"
import { useHasCredentialAccount } from "./_components/use-has-credential-account"

export default function AccountSecurityPage() {
  const { t } = useTranslation()
  const [hasCredentialAccount, setHasCredentialAccount] = useHasCredentialAccount()

  const passwordSchema = z
    .object({
      currentPassword: hasCredentialAccount
        ? z.string().min(1, { message: t("account.security.password.form.currentPassword.errors.required") })
        : z.string().optional(),
      password: z
        .string()
        .min(8, { message: t("account.security.password.form.password.errors.minLength") })
        .regex(/[a-zA-Z]/, { message: t("account.security.password.form.password.errors.letter") })
        .regex(/[0-9]/, { message: t("account.security.password.form.password.errors.number") })
        .regex(/[^a-zA-Z0-9]/, {
          message: t("account.security.password.form.password.errors.special"),
        })
        .trim(),
      confirmPassword: z.string().trim(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("account.security.password.form.confirmPassword.errors.match"),
      path: ["confirmPassword"],
    })

  // Inferred from the schema itself (rather than a hand-written interface): `currentPassword` is
  // only required when `hasCredentialAccount` is true, which zod already encodes above — a separate
  // interface would have to redeclare that same conditional or drift from it.
  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  })

  const handlePasswordSubmit = passwordForm.handleSubmit(async (values) => {
    if (hasCredentialAccount) {
      const { error } = await authClient.changePassword({
        currentPassword: values.currentPassword!,
        newPassword: values.password,
      })

      if (error) {
        // better-auth's own `changePassword` already names a wrong current password in
        // `error.message` ("Invalid password" or similar) — shown verbatim rather than replaced with
        // a generic one, same discipline as `sign-in.tsx`.
        toast.error(error.message || t("account.security.messages.updateError"))
        return
      }

      toast.success(t("account.security.messages.updateSuccess"))
      passwordForm.reset()
      return
    }

    // OIDC-only account with no password yet: a dedicated backend route (better-auth's own
    // `changePassword` requires a CURRENT password to change, which by definition doesn't exist here).
    try {
      const res = await authenticatedFetch("/api/auth-extended/set-password", {
        method: "POST",
        body: JSON.stringify({ newPassword: values.password }),
      })
      if (!res.ok) throw new Error("failed")
      toast.success(t("account.security.messages.updateSuccess"))
      passwordForm.reset()
      setHasCredentialAccount(true)
    } catch {
      toast.error(t("account.security.messages.updateError"))
    }
  })

  return (
    <Card data-cy="account-security-card">
      <CardHeader>
        <CardTitle>{t("account.security.password.title")}</CardTitle>
        <CardDescription>{t("account.security.password.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasCredentialAccount === null ? (
          <div className="py-4 text-center text-muted-foreground">
            {t("account.security.password.loading")}
          </div>
        ) : (
          <>
            {!hasCredentialAccount && (
              <div className="mb-4 rounded-md bg-muted p-3">
                <p className="text-sm text-muted-foreground">
                  {t("account.security.password.noPasswordSet")}
                </p>
              </div>
            )}
            <Form {...passwordForm}>
              <form onSubmit={handlePasswordSubmit} className="grid gap-4 sm:max-w-sm">
                {hasCredentialAccount && (
                  <FormField
                    control={passwordForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("account.security.password.form.currentPassword.label")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder={t("account.security.password.form.currentPassword.placeholder")}
                            data-cy="account-security-current-password-input"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={passwordForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {hasCredentialAccount
                          ? t("account.security.password.form.password.label")
                          : t("account.security.password.form.password.labelNew")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder={t("account.security.password.form.password.placeholder")}
                          data-cy="account-security-password-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("account.security.password.form.confirmPassword.label")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder={t("account.security.password.form.confirmPassword.placeholder")}
                          data-cy="account-security-confirm-password-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div>
                  <Button
                    type="submit"
                    loading={passwordForm.formState.isSubmitting}
                    data-cy="account-security-submit-button"
                  >
                    {passwordForm.formState.isSubmitting
                      ? t("account.security.password.form.submitting")
                      : hasCredentialAccount
                        ? t("account.security.password.form.submit")
                        : t("account.security.password.form.submitNew")}
                  </Button>
                </div>
              </form>
            </Form>
          </>
        )}
      </CardContent>
    </Card>
  )
}
