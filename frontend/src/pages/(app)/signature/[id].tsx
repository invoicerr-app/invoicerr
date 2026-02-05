import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, CheckCircle, Clock, Download, FileText, Mail, RefreshCw, ZoomIn, ZoomOut } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"
import { useEffect, useState } from "react"
import { useGet, useGetRaw, usePost } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { Quote } from "@/types"
import type React from "react"
import { toast } from "sonner"
import { useParams } from "react-router"

interface Signature {
    id: string
    expiresAt: Date
    isActive: boolean
    signedAt: Date | null
    quote: Quote
}

type SignatureState = "loading" | "ready" | "otp-sent" | "signing" | "signed" | "expired" | "error"

export default function Signature() {
    const { id } = useParams()
    const { data: signature, mutate } = useGet<Signature>(`/api/signatures/${id}`)
    const { data: pdfResponse } = useGetRaw<Response>(`/api/quotes/${signature?.quote.id}/pdf`)

    const { trigger: sendOtp, loading: optCodeloading } = usePost(`/api/signatures/${id}/otp`)
    const { trigger: sign, loading: signingLoading } = usePost(`/api/signatures/${id}/sign`)

    const [state, setState] = useState<SignatureState>("loading")
    const [otpCode, setOtpCode] = useState("")
    const [zoom, setZoom] = useState(1)
    const [pdfUrl, setPdfUrl] = useState<string | null>(null)
    const [pdfError, setPdfError] = useState(false)

    useEffect(() => {
        if (pdfResponse) {
            pdfResponse
                .arrayBuffer()
                .then((buffer) => {
                    const blob = new Blob([buffer], { type: "application/pdf" })
                    const url = URL.createObjectURL(blob)
                    setPdfUrl(url)
                    setPdfError(false)
                })
                .catch(() => {
                    setPdfError(true)
                })
        }

        return () => {
            if (pdfUrl) {
                URL.revokeObjectURL(pdfUrl)
            }
        }
    }, [pdfResponse])

    useEffect(() => {
        if (signature) {
            if (signature.quote.status === "SIGNED") {
                setState("signed")
            } else if (
                signature.quote.status === "EXPIRED" ||
                !signature.isActive ||
                new Date(signature.expiresAt) < new Date()
            ) {
                setState("expired")
            } else {
                setState("ready")
            }
        }
    }, [signature])

    const handleSendOtp = async () => {
        if (!signature) return

        sendOtp()
            .then(() => {
                setState("otp-sent")
                setOtpCode("")
            })
            .catch((error) => {
                toast.error(error.message || "Failed to send OTP code")
                setState("error")
            })
    }

    const handleSignWithOtp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!signature || !otpCode.trim()) return

        sign({ otpCode: otpCode.trim() })
            .then(() => {
                setState("signed")
                setOtpCode("")
                mutate()
            })
            .catch((error) => {
                toast.error(error.message || "Failed to sign quote")
                setState("error")
            })
    }

    const handleDownloadPdf = () => {
        if (pdfUrl) {
            const link = document.createElement("a")
            link.href = pdfUrl
            link.download = `quote-${signature?.quote.number}.pdf`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
        }
    }

    const handleRefreshPdf = () => {
        setPdfError(false)
        if (pdfUrl) {
            URL.revokeObjectURL(pdfUrl)
            setPdfUrl(null)
        }
    }

    const handleOtpPaste = (e: React.ClipboardEvent) => {
        e.preventDefault()
        const pastedText = e.clipboardData.getData("text")
        const cleanedText = pastedText.replace(/[^0-9]/g, "").slice(0, 8)
        setOtpCode(cleanedText)
    }

    const handleOtpChange = (value: string) => {
        const cleanedValue = value.replace(/[^0-9]/g, "").slice(0, 8)
        setOtpCode(cleanedValue)
    }

    const renderSignatureStatus = () => {
        switch (state) {
            case "loading":
                return (
                    <Card>
                        <CardContent className="flex items-center justify-center p-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                            <span className="ml-3">Loading...</span>
                        </CardContent>
                    </Card>
                )

            case "signed":
                return (
                    <Card className="border-green-200 bg-green-50">
                        <CardContent className="flex items-center p-6">
                            <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
                            <div>
                                <h3 className="font-semibold text-green-800">Quote signed</h3>
                                <p className="text-sm text-green-600">
                                    This quote was signed on{" "}
                                    {signature?.signedAt ? new Date(signature.signedAt).toLocaleDateString() : ""}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                )

            case "expired":
                return (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="flex items-center p-6">
                            <Clock className="h-6 w-6 text-red-600 mr-3" />
                            <div>
                                <h3 className="font-semibold text-red-800">Signature expired</h3>
                                <p className="text-sm text-red-600">
                                    This signature link expired on{" "}
                                    {signature?.expiresAt ? new Date(signature.expiresAt).toLocaleDateString() : ""}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                )

            case "ready":
                return (
                    <Card>
                        <CardHeader>
                            <h3 className="font-semibold flex items-center">
                                <FileText className="h-5 w-5 mr-2" />
                                Quote signature
                            </h3>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                To sign this quote, click the button below. A verification code will be sent by email.
                            </p>
                            <Button data-cy="send-otp-btn" onClick={handleSendOtp} disabled={optCodeloading} className="w-full">
                                <Mail className="h-4 w-4 mr-2" />
                                {optCodeloading ? "Sending..." : "Send verification code"}
                            </Button>
                        </CardContent>
                    </Card>
                )

            case "otp-sent":
                return (
                    <Card>
                        <CardHeader>
                            <h3 className="font-semibold flex items-center">
                                <Mail className="h-5 w-5 mr-2" />
                                Verification code sent
                            </h3>
                        </CardHeader>
                        <CardContent>
                            <Alert className="mb-4">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>
                                    A verification code has been sent to your email address. Please enter it below to sign the quote.
                                </AlertDescription>
                            </Alert>

                            <form onSubmit={handleSignWithOtp} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="otp">Verification code</Label>
                                    <section className="flex flex-col items-center">
                                        <InputOTP autoComplete={"one-time-code"} maxLength={8} minLength={8} value={otpCode} onChange={handleOtpChange} onPaste={handleOtpPaste} className="w-full">
                                            <InputOTPGroup>
                                                {[...Array(4)].map((_, index) => (
                                                    <InputOTPSlot key={index} index={index} />
                                                ))}
                                            </InputOTPGroup>
                                            <InputOTPSeparator />
                                            <InputOTPGroup>
                                                {[...Array(4)].map((_, index) => (
                                                    <InputOTPSlot key={index + 4} index={index + 4} />
                                                ))}
                                            </InputOTPGroup>
                                        </InputOTP>
                                    </section>
                                </div>

                                <div className="flex gap-2">
                                    <Button data-cy="sign-quote-btn" type="submit" disabled={signingLoading || !otpCode.trim()} className="flex-1">
                                        {signingLoading ? "Signing in progress..." : "Sign quote"}
                                    </Button>
                                    <Button type="button" variant="outline" onClick={() => setState("ready")} disabled={signingLoading}>
                                        Cancel
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                )

            case "signing":
                return (
                    <Card>
                        <CardContent className="flex items-center justify-center p-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                            <span className="ml-3">Signing in progress...</span>
                        </CardContent>
                    </Card>
                )

            case "error":
                return (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="p-6">
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>
                                    An error occurred while processing your request. Please try again later.
                                </AlertDescription>
                            </Alert>
                            <Button onClick={() => setState("ready")} variant="outline" className="mt-4">
                                Retry
                            </Button>
                        </CardContent>
                    </Card>
                )

            default:
                return null
        }
    }

    if (!signature) {
        return (
            <div className="max-w-7xl mx-auto space-y-6 px-6 py-8">
                <Card>
                    <CardContent className="flex items-center justify-center p-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                        <span className="ml-3">Loading signature...</span>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6 px-6 py-8">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold">Quote Signature</h1>
                <p className="text-muted-foreground">
                    Quote #{signature.quote.number} • Expires on {new Date(signature.expiresAt).toLocaleDateString()}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <h2 className="font-semibold">Quote Preview</h2>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                                    disabled={zoom <= 0.5}
                                >
                                    <ZoomOut className="h-4 w-4" />
                                </Button>
                                <span className="text-sm text-muted-foreground min-w-[60px] text-center">
                                    {Math.round(zoom * 100)}%
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                                    disabled={zoom >= 2}
                                >
                                    <ZoomIn className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleRefreshPdf}>
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!pdfUrl}>
                                    <Download className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-lg overflow-hidden bg-gray-50">
                                {pdfUrl && !pdfError ? (
                                    <div className="h-[800px] w-full overflow-auto">
                                        <iframe
                                            src={`${pdfUrl}#toolbar=1&navpanes=0&scrollbar=1&zoom=${Math.round(zoom * 100)}`}
                                            className="w-full h-full border-0"
                                            title={`Quote #${signature.quote.number}`}
                                            style={{
                                                minHeight: "800px",
                                            }}
                                        />
                                    </div>
                                ) : pdfError ? (
                                    <div className="flex flex-col items-center justify-center h-96 p-8 text-center">
                                        <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
                                        <p className="text-red-600 mb-4">Error loading PDF</p>
                                        <div className="flex gap-2">
                                            <Button onClick={handleRefreshPdf} variant="outline">
                                                <RefreshCw className="h-4 w-4 mr-2" />
                                                Retry
                                            </Button>
                                            <Button onClick={handleDownloadPdf} variant="outline">
                                                <Download className="h-4 w-4 mr-2" />
                                                Download PDF
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-96">
                                        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                                        <span className="ml-3">Loading PDF...</span>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    {renderSignatureStatus()}
                    <Card>
                        <CardHeader>
                            <h3 className="font-semibold">Quote Information</h3>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Number:</span>
                                <span className="font-medium">#{signature.quote.number}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Status:</span>
                                <span
                                    className={`font-medium ${signature.quote.status === "SIGNED"
                                        ? "text-green-600"
                                        : signature.quote.status === "EXPIRED"
                                            ? "text-red-600"
                                            : "text-blue-600"
                                        }`}
                                >
                                    {signature.quote.status === "SIGNED"
                                        ? "Signed"
                                        : signature.quote.status === "EXPIRED"
                                            ? "Expired"
                                            : signature.quote.status === "VIEWED"
                                                ? "Viewed"
                                                : signature.quote.status === "SENT"
                                                    ? "Sent"
                                                    : "Draft"}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Expires on:</span>
                                <span className="font-medium">{new Date(signature.expiresAt).toLocaleDateString()}</span>
                            </div>
                            {signature.signedAt && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Signed on:</span>
                                    <span className="font-medium text-green-600">
                                        {new Date(signature.signedAt).toLocaleDateString()}
                                    </span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
