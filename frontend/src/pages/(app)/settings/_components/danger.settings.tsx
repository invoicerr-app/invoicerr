import { AlertTriangle, Database, Loader2, RotateCcw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router"
import { usePost } from "@/hooks/use-fetch"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export default function DangerZoneSettings() {
    const { t } = useTranslation()
    const [currentAction, setCurrentAction] = useState<"app" | "all" | null>(null)
    const [otp, setOtp] = useState("")
    const { trigger: sendOTP, loading: isLoadingOtp } = usePost("/api/danger/otp")
    const { trigger: sendAction } = usePost(`/api/danger/reset/${currentAction}?otp=${otp}`)
    const [otpModalOpen, setOtpModalOpen] = useState(false)

    const navigate = useNavigate()

    const requestOtp = (action: "app" | "all") => {
        setCurrentAction(action)
        setOtpModalOpen(true)
        setOtp("")
        sendOTP()
            .then(() => {
                toast.success(t("settings.dangerZone.messages.otpSentSuccess"))
            })
            .catch((error) => {
                toast.error(t("settings.dangerZone.messages.otpSentError"), {
                    description: error instanceof Error ? error.message : t("settings.dangerZone.messages.unexpectedError"),
                })
            })
    }

    const executeReset = () => {
        if (!currentAction || !otp) return

        sendAction({ otp })
            .then((d) => {
                if (!d) {
                    throw new Error(t("settings.dangerZone.messages.actionFailed"))
                }
                toast.success(t("settings.dangerZone.messages.actionSuccess"))
                setOtpModalOpen(false)
                setOtp("")
                setCurrentAction(null)
                if (currentAction === "all") {
                    navigate("/auth/log-out")
                } else {
                    navigate("/dashboard")
                }
            })
            .catch((error) => {
                toast.error(t("settings.dangerZone.messages.actionError"), {
                    description: error instanceof Error ? error.message : t("settings.dangerZone.messages.unexpectedError"),
                })
            })
    }

    const formatOtp = (value: string) => {
        const cleaned = value.replace(/\D/g, "").slice(0, 8)
        if (cleaned.length <= 4) return cleaned
        return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
    }

    const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setOtp(formatOtp(e.target.value))
    }

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-3xl font-bold">{t("settings.dangerZone.title")}</h1>
                <p className="text-muted-foreground">{t("settings.dangerZone.description")}</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-orange-200 dark:border-orange-900/50">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-lg">
                            <RotateCcw className="h-4 w-4" />
                            {t("settings.dangerZone.resetApp.title")}
                        </CardTitle>
                        <CardDescription className="text-sm">{t("settings.dangerZone.resetApp.description")}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <Button
                            variant="outline"
                            className="w-full border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-900/50 dark:text-orange-400 dark:hover:bg-orange-950/50 bg-transparent"
                            onClick={() => requestOtp("app")}
                            loading={isLoadingOtp}
                        >
                            {t("settings.dangerZone.resetApp.button")}
                        </Button>
                    </CardContent>
                </Card>

                <Card className="border-red-200 dark:border-red-900/50">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400 text-lg">
                            <Database className="h-4 w-4" />
                            {t("settings.dangerZone.resetDatabase.title")}
                        </CardTitle>
                        <CardDescription className="text-sm">{t("settings.dangerZone.resetDatabase.description")}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <Button
                            variant="outline"
                            className="w-full border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/50 bg-transparent"
                            onClick={() => requestOtp("all")}
                            disabled={isLoadingOtp}
                        >
                            {isLoadingOtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                            {t("settings.dangerZone.resetDatabase.button")}
                        </Button>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={otpModalOpen} onOpenChange={setOtpModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            {t("settings.dangerZone.modal.title")}
                        </DialogTitle>
                        <DialogDescription>{t("settings.dangerZone.modal.description")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="otp">{t("settings.dangerZone.modal.otpLabel")}</Label>
                            <Input
                                id="otp"
                                value={otp}
                                onChange={handleOtpChange}
                                placeholder={t("settings.dangerZone.modal.otpPlaceholder")}
                                className="text-center text-lg font-mono tracking-wider"
                                maxLength={9}
                            />
                        </div>
                        {currentAction && (
                            <div className="bg-muted p-3 rounded-lg">
                                <p className="text-sm font-medium">
                                    {currentAction === "app"
                                        ? t("settings.dangerZone.modal.warningApp")
                                        : t("settings.dangerZone.modal.warningDatabase")}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {currentAction === "app"
                                        ? t("settings.dangerZone.modal.warningAppDescription")
                                        : t("settings.dangerZone.modal.warningDatabaseDescription")}
                                </p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOtpModalOpen(false)}>
                            {t("settings.dangerZone.modal.cancel")}
                        </Button>
                        <Button variant="destructive" onClick={executeReset} disabled={otp.length !== 9}>
                            {t("settings.dangerZone.modal.confirm")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
