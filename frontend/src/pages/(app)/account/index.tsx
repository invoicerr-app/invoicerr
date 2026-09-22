import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth"
import { SettingsFormFooter, SettingsSection, useSavedFlash } from "../settings/_components/settings-section"

interface SessionUser {
  firstname?: string
  lastname?: string
  email?: string
}

interface ProfileFormValues {
  firstname: string
  lastname: string
}

interface EmailFormValues {
  newEmail: string
}

export default function AccountProfilePage() {
  const { t } = useTranslation()
  const { data: session, refetch } = authClient.useSession()
  const user = (session as unknown as { user?: SessionUser } | null)?.user
  const [profileSaved, flashProfileSaved] = useSavedFlash()

  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get("email") !== "verified") return
    toast.success(t("account.profile.email.messages.verified"))
    const next = new URLSearchParams(searchParams)
    next.delete("email")
    setSearchParams(next, { replace: true })
    // Runs once per URL that actually carries the flag — `searchParams` is stable between renders
    // unless the URL's own query string changes, so this does not loop.
  }, [searchParams, setSearchParams, t])

  const profileSchema = z.object({
    firstname: z
      .string()
      .trim()
      .min(1, { message: t("account.profile.form.firstname.errors.required") }),
    lastname: z
      .string()
      .trim()
      .min(1, { message: t("account.profile.form.lastname.errors.required") }),
  })

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstname: user?.firstname ?? "", lastname: user?.lastname ?? "" },
  })

  // Pre-fills from the session the moment it resolves (a direct load of /account has no session yet
  // on first render) — but never while the user is mid-edit, so a background session refresh (e.g.
  // another tab) can't clobber unsaved keystrokes.
  useEffect(() => {
    if (!user || profileForm.formState.isDirty) return
    profileForm.reset({ firstname: user.firstname ?? "", lastname: user.lastname ?? "" })
    // Deliberately keyed on the two primitive values, not `user`/`profileForm` (a new object/stable
    // ref respectively) — re-running this effect on every session refetch would fight `isDirty`'s
    // own guard above by resetting the form back to its old values right as a background refetch
    // resolves, even when nothing the user typed changed.
  }, [user?.firstname, user?.lastname])

  const handleProfileSubmit = profileForm.handleSubmit(async (values) => {
    const { error } = await authClient.updateUser({
      // @ts-expect-error additional fields — firstname/lastname aren't part of the base client type,
      // only declared via `additionalFields` in lib/auth.ts.
      firstname: values.firstname,
      lastname: values.lastname,
      // Deliberately NO `email` here: better-auth's `update-user` rejects the request outright the
      // moment it carries one (email changes go through `changeEmail` below, which is the only path
      // that verifies the new address before it takes effect).
    })

    if (error) {
      toast.error(error.message || t("account.profile.messages.updateError"))
      return
    }

    toast.success(t("account.profile.messages.updateSuccess"))
    flashProfileSaved()
    // Refreshes the shared session (the sidebar reads the SAME `authClient.useSession()` store) so
    // the new name shows up everywhere without a full page reload.
    await refetch()
    profileForm.reset(values)
  })

  const emailSchema = z.object({
    newEmail: z
      .string()
      .trim()
      .email({ message: t("account.profile.email.errors.invalid") }),
  })

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { newEmail: "" },
  })

  const handleEmailSubmit = emailForm.handleSubmit(async (values) => {
    const { error } = await authClient.changeEmail({
      newEmail: values.newEmail.trim(),
      callbackURL: `${window.location.origin}/account?email=verified`,
    })

    if (error) {
      toast.error(error.message || t("account.profile.email.messages.error"))
      return
    }

    toast.success(t("account.profile.email.messages.sent", { email: values.newEmail.trim() }))
    emailForm.reset()
  })

  return (
    <div className="grid gap-6">
      <SettingsSection
        title={t("account.profile.title")}
        description={t("account.profile.description")}
        dataCy="account-profile-card"
      >
        <Form {...profileForm}>
          <form onSubmit={handleProfileSubmit} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={profileForm.control}
                name="firstname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("account.profile.form.firstname.label")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("account.profile.form.firstname.placeholder")}
                        data-cy="account-profile-firstname-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={profileForm.control}
                name="lastname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("account.profile.form.lastname.label")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("account.profile.form.lastname.placeholder")}
                        data-cy="account-profile-lastname-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <SettingsFormFooter saved={profileSaved}>
              <Button
                type="submit"
                loading={profileForm.formState.isSubmitting}
                disabled={!profileForm.formState.isDirty}
                data-cy="account-profile-save-button"
              >
                {profileForm.formState.isSubmitting
                  ? t("account.profile.form.saving")
                  : t("account.profile.form.save")}
              </Button>
            </SettingsFormFooter>
          </form>
        </Form>
      </SettingsSection>

      <SettingsSection
        title={t("account.profile.email.title")}
        description={t("account.profile.email.description")}
        dataCy="account-email-card"
        contentClassName="grid gap-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground">{t("account.profile.email.currentLabel")}</Label>
          <p className="text-sm font-medium" data-cy="account-email-current">
            {user?.email}
          </p>
        </div>

        <Form {...emailForm}>
          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <FormField
              control={emailForm.control}
              name="newEmail"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>{t("account.profile.email.newLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder={t("account.profile.email.newPlaceholder")}
                      data-cy="account-email-new-input"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              variant="outline"
              loading={emailForm.formState.isSubmitting}
              data-cy="account-email-send-button"
            >
              {emailForm.formState.isSubmitting
                ? t("account.profile.email.sending")
                : t("account.profile.email.send")}
            </Button>
          </form>
        </Form>
      </SettingsSection>
    </div>
  )
}
