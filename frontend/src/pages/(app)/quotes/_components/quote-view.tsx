import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { languageToLocale } from "@/lib/i18n";
import { type PaymentMethod, PaymentMethodType, type Quote } from "@/types";

interface QuoteViewDialogProps {
	quote: Quote | null;
	onOpenChange: (open: boolean) => void;
}

export function QuoteViewDialog({ quote, onOpenChange }: QuoteViewDialogProps) {
	const { t, i18n } = useTranslation();

	if (!quote) return null;

	const formatDate = (date?: Date) =>
		date
			? format(new Date(date), "PPP", {
					locale: languageToLocale(i18n.language),
				})
			: "—";

	const getStatusLabel = (status: string) => {
		return t(`quotes.view.status.${status.toLowerCase()}`);
	};

	return (
		<Dialog open={!!quote} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col">
				<DialogHeader className="flex-shrink-0">
					<DialogTitle className="text-xl font-semibold">
						{t("quotes.view.title", { number: quote.number })}
					</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{t("quotes.view.description")}
					</DialogDescription>
				</DialogHeader>

				<div className="overflow-auto mt-2 flex-1 flex flex-col gap-2">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.title")}
							</p>
							<p className="font-medium">{quote.title || "—"}</p>
						</div>

						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.status")}
							</p>
							<p className="font-medium capitalize">
								{getStatusLabel(quote.status)}
							</p>
						</div>

						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.createdAt")}
							</p>
							<p className="font-medium">{formatDate(quote.createdAt)}</p>
						</div>

						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.validUntil")}
							</p>
							<p className="font-medium">{formatDate(quote.validUntil)}</p>
						</div>

						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.signedAt")}
							</p>
							<p className="font-medium">{formatDate(quote.signedAt)}</p>
						</div>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-muted/50 p-4 rounded-lg">
						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.client")}
							</p>
							<p className="font-medium">
								{quote.client.name ||
									quote.client.contactFirstname +
										" " +
										quote.client.contactLastname}
							</p>
						</div>
						<div>
							<p className="text-sm text-muted-foreground">
								{t("invoices.view.fields.paymentMethod")}
							</p>
							<p className="font-medium">
								{(() => {
									const pm = quote.paymentMethod;
									if (pm) {
										return (
											pm.name +
											" - " +
											(pm.type == PaymentMethodType.BANK_TRANSFER
												? t("paymentMethods.fields.type.bank_transfer")
												: pm.type == PaymentMethodType.PAYPAL
													? t("paymentMethods.fields.type.paypal")
													: pm.type == PaymentMethodType.CHECK
														? t("paymentMethods.fields.type.check")
														: pm.type == PaymentMethodType.CASH
															? t("paymentMethods.fields.type.cash")
															: pm.type == PaymentMethodType.OTHER
																? t("paymentMethods.fields.type.other")
																: pm.type)
										);
									}
									return "—";
								})()}
							</p>
						</div>

						{!!quote.signedAt && (
							<div>
								<p className="text-sm text-muted-foreground">
									{t("quotes.view.fields.signedBy")}
								</p>
								<p className="font-medium">
									{quote.client.contactEmail ||
										quote.client?.contactFirstname +
											" " +
											quote.client?.contactLastname ||
										quote.client?.name ||
										"—"}
								</p>
							</div>
						)}
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-muted/50 p-4 rounded-lg">
						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.totalHT")}
							</p>
							<p className="font-medium">
								{t("common.valueWithCurrency", {
									currency: quote.currency,
									amount: quote.totalHT.toFixed(2),
								})}
							</p>
						</div>

						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.totalVAT")}
							</p>
							<p className="font-medium">
								{t("common.valueWithCurrency", {
									currency: quote.currency,
									amount: quote.totalVAT.toFixed(2),
								})}
							</p>
						</div>

						<div>
							<p className="text-sm text-muted-foreground">
								{t("quotes.view.fields.totalTTC")}
							</p>
							<p className="font-medium">
								{t("common.valueWithCurrency", {
									currency: quote.currency,
									amount: quote.totalTTC.toFixed(2),
								})}
							</p>
						</div>
					</div>

					{quote.signatureSvg && (
						<div className="bg-muted/50 p-4 rounded-lg">
							<p className="text-sm text-muted-foreground mb-2">
								{t("quotes.view.fields.signature")}
							</p>
							<div
								className="border rounded bg-white p-2"
								dangerouslySetInnerHTML={{ __html: quote.signatureSvg }}
							/>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
