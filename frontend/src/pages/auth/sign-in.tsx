import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    EyeClosedIcon,
    EyeIcon
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type React from "react"
import { authClient } from "@/lib/auth"
import { toast } from "sonner"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export default function LoginPage() {
    const { t } = useTranslation()

    const [errors] = useState<Record<string, string[]>>({})
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        setLoading(true);

        const result = await authClient.signIn.email({
            email: (event.currentTarget.elements.namedItem("email") as HTMLInputElement).value,
            password: (event.currentTarget.elements.namedItem("password") as HTMLInputElement).value,
            rememberMe: true,
        })

        if (result.error) {
            toast.error(result.error.message || t("auth.login.messages.loginError"));
        }

        if (result.data?.user.createdAt) {
            toast.success(t("auth.login.messages.loginSuccess"))
            // Force a full page reload to refresh the session state
            window.location.href = "/dashboard";
            return;
        }

        setLoading(false);
    }

    const getEnvVariable = (key: string): string | undefined => {
        return (window as any).__APP_CONFIG__?.[key] || import.meta.env[key];
    }

    const handleOIDCLogin = () => {
        const oidcProviderId = getEnvVariable("VITE_OIDC_PROVIDER_ID");

        authClient.signIn.oauth2({
            providerId: oidcProviderId || 'oidc',
            callbackURL: "/dashboard",
        });
    }

    return (
        <div className="min-h-screen flex items-center justify-center">
            <Card className="w-full max-w-sm md:max-w-md">
                <CardHeader>
                    <CardTitle className="text-2xl text-center">{t("auth.login.title")}</CardTitle>
                    <CardDescription className="text-center">{t("auth.login.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">{t("auth.login.form.email.label")}</Label>
                            <Input id="email" name="email" type="email" disabled={loading} data-cy="auth-email-input" />
                            {errors.email && <p className="text-sm text-red-600" data-cy="auth-email-error">{errors.email[0]}</p>}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">{t("auth.login.form.password.label")}</Label>
                            <div className="flex items-center justify-between gap-2">
                                <Input
                                    id="password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    disabled={loading}
                                    data-cy="auth-password-input"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                >
                                    {showPassword ? (
                                        <EyeClosedIcon className="h-4 w-4" />
                                    ) : (
                                        <EyeIcon className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                            {errors.password && <p className="text-sm text-red-600">{errors.password[0]}</p>}
                        </div>
                        <Button type="submit" className="w-full" disabled={loading} data-cy="auth-submit-btn">
                            {loading ? t("auth.login.form.loggingIn") : t("auth.login.form.loginButton")}
                        </Button>
                    </form>
                    <section className="flex flex-col mt-4 gap-1">
                        <div className="text-center text-sm">
                            {t("auth.login.noAccount")}{" "}
                            <a href="/auth/sign-up" className="underline hover:text-primary" data-cy="auth-signup-link">
                                {t("auth.login.signUpLink")}
                            </a>
                        </div>
                        {(getEnvVariable("VITE_OIDC_PROVIDER_ID")) && (
                            <div className="text-center text-sm">
                                {t("auth.login.oidc")}{" "}
                                <Button variant="link" onClick={handleOIDCLogin} className="underline hover:text-primary p-0">
                                    {t("auth.login.oidcLink")}
                                </Button>
                            </div>
                        )}
                    </section>
                </CardContent>
            </Card>
        </div>
    )
}
