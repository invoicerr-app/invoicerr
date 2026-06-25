import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import CountrySelect from "@/components/country-select";
import CurrencySelect from "@/components/currency-select";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCountryToCurrency } from "@/hooks/use-country-to-currency";
import { useGet, usePost } from "@/hooks/use-fetch";
import { useLookupSiret } from "@/hooks/use-lookup-siret";
import { useRequiredIdentifiers } from "@/hooks/use-required-identifiers";
import type { Company } from "@/types";

export default function CompanySettings() {
	const { t } = useTranslation();

	const ALLOWED_DATE_FORMATS = [
		"dd/MM/yyyy",
		"MM/dd/yyyy",
		"yyyy/MM/dd",
		"dd.MM.yyyy",
		"dd-MM-yyyy",
		"yyyy-MM-dd",
		"EEEE, dd MMM yyyy",
	];

	const validateNumberFormat = (pattern: string): boolean => {
		const patternRegex = /\{(\w+)(?::(\d+))?\}/g;
		const validKeys = ["year", "month", "day", "number"];
		const requiredKeys = ["number"];

		let match;
		const matches = [];

		while ((match = patternRegex.exec(pattern)) !== null) {
			matches.push(match);
		}

		for (const key of requiredKeys) {
			if (!matches.some((m) => m[1] === key)) {
				return false;
			}
		}

		for (const match of matches) {
			const key = match[1];
			const padding = match[2];

			if (!validKeys.includes(key)) {
				return false;
			}

			if (padding !== undefined) {
				const paddingNum = Number.parseInt(padding, 10);
				if (Number.isNaN(paddingNum) || paddingNum < 0 || paddingNum > 20) {
					return false;
				}
			}
		}

		return true;
	};

	const companySchema = z.object({
		name: z
			.string({
				required_error: t("settings.company.form.company.errors.required"),
			})
			.min(1, t("settings.company.form.company.errors.empty"))
			.max(100, t("settings.company.form.company.errors.maxLength")),
		description: z
			.string()
			.max(500, t("settings.company.form.description.errors.maxLength")),
		foundedAt: z
			.date()
			.refine(
				(date) => date <= new Date(),
				t("settings.company.form.foundedAt.errors.future"),
			),
		currency: z
			.string({
				required_error: t("settings.company.form.currency.errors.required"),
			})
			.min(1, t("settings.company.form.currency.errors.select")),
		address: z.string().min(1, t("settings.company.form.address.errors.empty")),
		addressLine2: z.string().optional(),
		postalCode: z.string().refine((val) => {
			return /^[0-9A-Z\s-]{3,10}$/.test(val);
		}, t("settings.company.form.postalCode.errors.format")),
		city: z.string().min(1, t("settings.company.form.city.errors.empty")),
		state: z.string().optional(),
		country: z.string().min(1, t("settings.company.form.country.errors.empty")),
		countryCode: z.string().optional(),
		phone: z
			.string()
			.min(8, t("settings.company.form.phone.errors.minLength"))
			.refine((val) => {
				return /^[+]?[0-9\s\-()]{8,20}$/.test(val);
			}, t("settings.company.form.phone.errors.format")),
		email: z
			.string()
			.email()
			.min(1, t("settings.company.form.email.errors.required"))
			.refine((val) => {
				return z.string().email().safeParse(val).success;
			}, t("settings.company.form.email.errors.format")),
		quoteStartingNumber: z
			.number()
			.min(1, t("settings.company.form.quoteStartingNumber.errors.min")),
		quoteNumberFormat: z
			.string()
			.min(1, t("settings.company.form.quoteNumberFormat.errors.required"))
			.max(100, t("settings.company.form.quoteNumberFormat.errors.maxLength"))
			.refine((val) => {
				return validateNumberFormat(val);
			}, t("settings.company.form.quoteNumberFormat.errors.format")),
		invoiceStartingNumber: z
			.number()
			.min(1, t("settings.company.form.invoiceStartingNumber.errors.min")),
		invoiceNumberFormat: z
			.string()
			.min(1, t("settings.company.form.invoiceNumberFormat.errors.required"))
			.max(100, t("settings.company.form.invoiceNumberFormat.errors.maxLength"))
			.refine((val) => {
				return validateNumberFormat(val);
			}, t("settings.company.form.invoiceNumberFormat.errors.format")),
		paymentStartingNumber: z
			.number()
			.min(1, t("settings.company.form.paymentStartingNumber.errors.min")),
		paymentNumberFormat: z
			.string()
			.min(1, t("settings.company.form.paymentNumberFormat.errors.required"))
			.max(100, t("settings.company.form.paymentNumberFormat.errors.maxLength"))
			.refine((val) => {
				return validateNumberFormat(val);
			}, t("settings.company.form.paymentNumberFormat.errors.format")),
		invoicePDFFormat: z.string().refine((val) => {
			const validFormats = [
				"pdf",
				"facturx",
				"zugferd",
				"xrechnung",
				"ubl",
				"cii",
			];
			return validFormats.includes(val.toLowerCase());
		}, t("settings.company.form.invoicePDFFormat.errors.format")),
		dateFormat: z
			.string()
			.min(1, t("settings.company.form.dateFormat.errors.required"))
			.max(50, t("settings.company.form.dateFormat.errors.maxLength"))
			.refine((val) => {
				return ALLOWED_DATE_FORMATS.includes(val);
			}, t("settings.company.form.dateFormat.errors.format")),
		exemptVat: z.boolean().optional(),
		identifiers: z
			.array(z.object({ scheme: z.string(), value: z.string() }))
			.optional(),
	});

	const { data } = useGet<Company>("/api/company/info");
	const { trigger } = usePost<Company>("/api/company/info");
	const [isLoading, setIsLoading] = useState(false);

	const form = useForm<z.infer<typeof companySchema>>({
		resolver: zodResolver(companySchema),
		defaultValues: {
			name: "",
			description: "",
			exemptVat: false,
			foundedAt: new Date(),
			currency: "",
			address: "",
			addressLine2: "",
			postalCode: "",
			city: "",
			state: "",
			country: "",
			countryCode: "",
			phone: "",
			email: "",
			invoicePDFFormat: "",
			quoteStartingNumber: 1,
			quoteNumberFormat: "Q-{year}-{number}",
			invoiceStartingNumber: 1,
			invoiceNumberFormat: "INV-{year}-{number}",
			paymentStartingNumber: 1,
			paymentNumberFormat: "PAY-{year}-{number}",
			identifiers: [],
		},
	});

	useEffect(() => {
		if (data && Object.keys(data).length > 0) {
			form.reset({
				...data,
				countryCode: data.countryCode ?? undefined,
				description: data.description ?? "",
				addressLine2: data.addressLine2 ?? "",
				state: data.state ?? "",
				foundedAt: new Date(data.foundedAt),
				exemptVat: !!data.exemptVat,
				identifiers: (data.partyIdentifiers || []).map((pi: any) => ({
					scheme: pi.scheme,
					value: pi.value,
				})),
			});
		}
	}, [data, form]);

	const identifiers = form.watch("identifiers") || [];
	const legalIdEntry = identifiers.find((i: any) => i.scheme === "LEGAL_ID");
	const legalIdValue = legalIdEntry?.value || "";
	const countryValue = form.watch("country");
	const isFranceOrUnset =
		!countryValue || /^fr(ance)?$/i.test(countryValue.trim());

	const { lookup: onLookupSiret, isLoading: siretLookupLoading } =
		useLookupSiret(form, {
			messages: {
				invalid: t("clients.upsert.messages.siretInvalid"),
				notFound: t("clients.upsert.messages.siretNotFound"),
				success: t("clients.upsert.messages.siretSuccess"),
				error: t("clients.upsert.messages.siretError"),
			},
		});
	useCountryToCurrency(form);

	const countryCodeValue = form.watch("countryCode");
	const { data: requiredIdentifiers } = useRequiredIdentifiers(
		countryCodeValue || undefined,
		"COMPANY",
	);

	useEffect(() => {
		if (!requiredIdentifiers) return;
		const requiredSchemes = new Set(requiredIdentifiers.map((r) => r.scheme));
		const current: { scheme: string; value: string }[] =
			form.getValues("identifiers") || [];
		const formSchemes = new Set(current.map((i) => i.scheme));
		const next = [...current];
		let changed = false;
		for (const scheme of requiredSchemes) {
			if (!formSchemes.has(scheme)) {
				next.push({ scheme, value: "" });
				changed = true;
			}
		}
		for (let i = next.length - 1; i >= 0; i--) {
			if (next[i].scheme && !requiredSchemes.has(next[i].scheme)) {
				next.splice(i, 1);
				changed = true;
			}
		}
		if (changed) {
			form.setValue("identifiers", next);
		}
	}, [requiredIdentifiers, form]);

	const isSiretLookupDisabled =
		siretLookupLoading ||
		!legalIdValue ||
		legalIdValue.replace(/\D/g, "").length !== 14;

	async function onSubmit(values: z.infer<typeof companySchema>) {
		if (requiredIdentifiers) {
			for (const req of requiredIdentifiers) {
				if (req.required) {
					const val = (values.identifiers || []).find(
						(i) => i.scheme === req.scheme,
					)?.value;
					if (!val || val.trim() === "") {
						const idx = (values.identifiers || []).findIndex(
							(i) => i.scheme === req.scheme,
						);
						form.setError(`identifiers.${idx}.value` as any, {
							message: `${req.label} is required`,
						});
						return;
					}
				}
			}
		}

		setIsLoading(true);
		const payload = {
			...values,
			identifiers: (values.identifiers || []).filter(
				(i) => i.value.trim() !== "",
			),
		};
		trigger(payload)
			.then(() => {
				toast.success(t("settings.company.messages.updateSuccess"));
			})
			.catch((error) => {
				console.error("Error updating company settings:", error);
				toast.error(t("settings.company.messages.updateError"));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}

	const getDateFormatOption = (dateFormat: string) => {
		return `${format(new Date(), dateFormat)} - (${dateFormat})`;
	};

	return (
		<div>
			<div className="mb-4">
				<h1 className="text-3xl font-bold">{t("settings.company.title")}</h1>
				<p className="text-muted-foreground">
					{t("settings.company.description")}
				</p>
			</div>

			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{t("settings.company.basicInfo")}</CardTitle>
							<CardDescription>
								{t("settings.company.basicInfoDescription")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.company.label")}
											</FormLabel>
											<FormControl>
												<Input
													placeholder={t(
														"settings.company.form.company.placeholder",
													)}
													{...field}
													data-cy="company-name-input"
												/>
											</FormControl>
											<FormDescription>
												{t("settings.company.form.company.description")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="description"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("settings.company.form.description.label")}
											</FormLabel>
											<FormControl>
												<Input
													placeholder={t(
														"settings.company.form.description.placeholder",
													)}
													{...field}
													data-cy="company-description-input"
												/>
											</FormControl>
											<FormDescription>
												{t("settings.company.form.description.description")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="foundedAt"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.foundedAt.label")}
											</FormLabel>
											<FormControl>
												<DatePicker
													className="w-full bg-opacity-100"
													value={field.value || null}
													onChange={field.onChange}
													placeholder={t(
														"settings.company.form.foundedAt.placeholder",
													)}
													data-cy="company-foundedat-input"
												/>
											</FormControl>
											<FormDescription>
												{t("settings.company.form.foundedAt.description")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								<FormField
									control={form.control}
									name="country"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.country.label")}
											</FormLabel>
											<FormControl>
												<CountrySelect
													value={field.value}
													onChange={(value) => field.onChange(value)}
													onCountryCodeChange={(code) =>
														form.setValue("countryCode", code)
													}
													data-cy="company-country-input"
												/>
											</FormControl>
											<FormDescription>
												{t("settings.company.form.country.description")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="currency"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.currency.label")}
											</FormLabel>
											<FormControl>
												<CurrencySelect
													value={field.value}
													onChange={(value) => field.onChange(value)}
													data-cy="company-currency-select"
												/>
											</FormControl>
											<FormDescription>
												{t("settings.company.form.currency.description")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							{requiredIdentifiers?.length ? (
								<div className="space-y-4 border rounded-lg p-4 bg-muted/30">
									<p className="text-sm font-medium text-muted-foreground">
										{t("settings.company.form.identifiers.label") ||
											"Country-specific identifiers"}
									</p>
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										{requiredIdentifiers.map((req) => {
											const current = form.watch("identifiers") || [];
											const formIndex = current.findIndex(
												(i) => i.scheme === req.scheme,
											);
											if (formIndex < 0) return null;
											const isLegalId = req.scheme === "LEGAL_ID";
											return (
												<FormField
													key={req.scheme}
													control={form.control}
													name={`identifiers.${formIndex}.value`}
													render={({ field }) => (
														<FormItem>
															<FormLabel required={req.required}>
																{req.label}
															</FormLabel>
															<FormControl>
																<div className="flex gap-2">
																	<Input
																		{...field}
																		placeholder={req.label}
																		data-cy={
																			isLegalId
																				? "company-legalid-input"
																				: req.scheme === "VAT"
																					? "company-vat-input"
																					: undefined
																		}
																	/>
																	{isLegalId && isFranceOrUnset && (
																		<Button
																			type="button"
																			variant="outline"
																			size="icon"
																			disabled={isSiretLookupDisabled}
																			onClick={() =>
																				onLookupSiret(legalIdValue)
																			}
																			title={t(
																				"clients.upsert.actions.lookupSiret",
																			)}
																			data-cy="company-siret-lookup"
																		>
																			{siretLookupLoading ? (
																				<Loader2 className="animate-spin" />
																			) : (
																				<Search />
																			)}
																		</Button>
																	)}
																</div>
															</FormControl>
															{req.helpText && (
																<p className="text-xs text-muted-foreground">
																	{req.helpText}
																</p>
															)}
															<FormMessage />
														</FormItem>
													)}
												/>
											);
										})}
									</div>
								</div>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("settings.company.address.title")}</CardTitle>
							<CardDescription>
								{t("settings.company.address.description")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<FormField
								control={form.control}
								name="address"
								render={({ field }) => (
									<FormItem>
										<FormLabel required>
											{t("settings.company.form.address.label")}
										</FormLabel>
										<FormControl>
											<Input
												placeholder={t(
													"settings.company.form.address.placeholder",
												)}
												{...field}
												data-cy="company-address-input"
											/>
										</FormControl>
										<FormDescription>
											{t("settings.company.form.address.description")}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="addressLine2"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("settings.company.form.addressLine2.label")}
										</FormLabel>
										<FormControl>
											<Input
												placeholder={t(
													"settings.company.form.addressLine2.placeholder",
												)}
												{...field}
												data-cy="company-address-line2-input"
											/>
										</FormControl>
										<FormDescription>
											{t("settings.company.form.addressLine2.description")}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
								<FormField
									control={form.control}
									name="postalCode"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.postalCode.label")}
											</FormLabel>
											<FormControl>
												<Input
													placeholder={t(
														"settings.company.form.postalCode.placeholder",
													)}
													{...field}
													data-cy="company-postalcode-input"
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="city"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.city.label")}
											</FormLabel>
											<FormControl>
												<Input
													placeholder={t(
														"settings.company.form.city.placeholder",
													)}
													{...field}
													data-cy="company-city-input"
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="state"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("settings.company.form.state.label")}
											</FormLabel>
											<FormControl>
												<Input
													placeholder={t(
														"settings.company.form.state.placeholder",
													)}
													{...field}
													data-cy="company-state-input"
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("settings.company.contact.title")}</CardTitle>
							<CardDescription>
								{t("settings.company.contact.description")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								<FormField
									control={form.control}
									name="phone"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.phone.label")}
											</FormLabel>
											<FormControl>
												<Input
													type="tel"
													placeholder={t(
														"settings.company.form.phone.placeholder",
													)}
													{...field}
													data-cy="company-phone-input"
												/>
											</FormControl>
											<FormDescription>
												{t("settings.company.form.phone.description")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="email"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("settings.company.form.email.label")}
											</FormLabel>
											<FormControl>
												<Input
													type="email"
													placeholder={t(
														"settings.company.form.email.placeholder",
													)}
													{...field}
													data-cy="company-email-input"
												/>
											</FormControl>
											<FormDescription>
												{t("settings.company.form.email.description")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("settings.company.numberFormats.title")}</CardTitle>
							<CardDescription>
								{t("settings.company.numberFormats.description")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="space-y-6">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
									<FormField
										control={form.control}
										name="quoteStartingNumber"
										render={({ field }) => (
											<FormItem>
												<FormLabel required>
													{t("settings.company.form.quoteStartingNumber.label")}
												</FormLabel>
												<FormControl>
													<Input
														type="number"
														placeholder={t(
															"settings.company.form.quoteStartingNumber.placeholder",
														)}
														{...field}
														onChange={(e) =>
															field.onChange(Number(e.target.value))
														}
														data-cy="company-quote-starting-number-input"
													/>
												</FormControl>
												<FormDescription>
													{t(
														"settings.company.form.quoteStartingNumber.description",
													)}
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="quoteNumberFormat"
										render={({ field }) => (
											<FormItem>
												<FormLabel required>
													{t("settings.company.form.quoteNumberFormat.label")}
												</FormLabel>
												<FormControl>
													<Input
														placeholder={t(
															"settings.company.form.quoteNumberFormat.placeholder",
														)}
														{...field}
														data-cy="company-quote-number-format-input"
													/>
												</FormControl>
												<FormDescription>
													{t(
														"settings.company.form.quoteNumberFormat.description",
													)}
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
									<FormField
										control={form.control}
										name="invoiceStartingNumber"
										render={({ field }) => (
											<FormItem>
												<FormLabel required>
													{t(
														"settings.company.form.invoiceStartingNumber.label",
													)}
												</FormLabel>
												<FormControl>
													<Input
														type="number"
														placeholder={t(
															"settings.company.form.invoiceStartingNumber.placeholder",
														)}
														{...field}
														onChange={(e) =>
															field.onChange(Number(e.target.value))
														}
														data-cy="company-invoice-starting-number-input"
													/>
												</FormControl>
												<FormDescription>
													{t(
														"settings.company.form.invoiceStartingNumber.description",
													)}
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="invoiceNumberFormat"
										render={({ field }) => (
											<FormItem>
												<FormLabel required>
													{t("settings.company.form.invoiceNumberFormat.label")}
												</FormLabel>
												<FormControl>
													<Input
														placeholder={t(
															"settings.company.form.invoiceNumberFormat.placeholder",
														)}
														{...field}
														data-cy="company-invoice-number-format-input"
													/>
												</FormControl>
												<FormDescription>
													{t(
														"settings.company.form.invoiceNumberFormat.description",
													)}
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
									<FormField
										control={form.control}
										name="paymentStartingNumber"
										render={({ field }) => (
											<FormItem>
												<FormLabel required>
													{t(
														"settings.company.form.paymentStartingNumber.label",
													)}
												</FormLabel>
												<FormControl>
													<Input
														type="number"
														placeholder={t(
															"settings.company.form.paymentStartingNumber.placeholder",
														)}
														{...field}
														onChange={(e) =>
															field.onChange(Number(e.target.value))
														}
														data-cy="company-payment-starting-number-input"
													/>
												</FormControl>
												<FormDescription>
													{t(
														"settings.company.form.paymentStartingNumber.description",
													)}
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="paymentNumberFormat"
										render={({ field }) => (
											<FormItem>
												<FormLabel required>
													{t("settings.company.form.paymentNumberFormat.label")}
												</FormLabel>
												<FormControl>
													<Input
														placeholder={t(
															"settings.company.form.paymentNumberFormat.placeholder",
														)}
														{...field}
														data-cy="company-payment-number-format-input"
													/>
												</FormControl>
												<FormDescription>
													{t(
														"settings.company.form.paymentNumberFormat.description",
													)}
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("settings.company.other.title")}</CardTitle>
							<CardDescription>
								{t("settings.company.other.description")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6 grid grid-cols-1 md:grid-cols-2 gap-6">
							<FormField
								control={form.control}
								name="invoicePDFFormat"
								render={({ field }) => (
									<FormItem>
										<FormLabel required>
											{t("settings.company.form.invoicePDFFormat.label")}
										</FormLabel>
										<FormControl>
											<Select
												onValueChange={field.onChange}
												value={field.value}
											>
												<SelectTrigger
													className="w-full"
													data-cy="company-pdfformat-select"
												>
													<SelectValue
														placeholder={t(
															"settings.company.form.invoicePDFFormat.placeholder",
														)}
													/>
												</SelectTrigger>
												<SelectContent data-cy="company-pdfformat-options">
													<SelectItem
														value="pdf"
														data-cy="company-pdfformat-option-pdf"
													>
														{t(
															"settings.company.form.invoicePDFFormat.options.pdf",
														)}
													</SelectItem>
													<SelectItem
														value="facturx"
														data-cy="company-pdfformat-option-facturx"
													>
														{t(
															"settings.company.form.invoicePDFFormat.options.facturx",
														)}
													</SelectItem>
													<SelectItem
														value="zugferd"
														data-cy="company-pdfformat-option-zugferd"
													>
														{t(
															"settings.company.form.invoicePDFFormat.options.zugferd",
														)}
													</SelectItem>
													<SelectItem
														value="xrechnung"
														data-cy="company-pdfformat-option-xrechnung"
													>
														{t(
															"settings.company.form.invoicePDFFormat.options.xrechnung",
														)}
													</SelectItem>
													<SelectItem
														value="ubl"
														data-cy="company-pdfformat-option-ubl"
													>
														{t(
															"settings.company.form.invoicePDFFormat.options.ubl",
														)}
													</SelectItem>
													<SelectItem
														value="cii"
														data-cy="company-pdfformat-option-cii"
													>
														{t(
															"settings.company.form.invoicePDFFormat.options.cii",
														)}
													</SelectItem>
												</SelectContent>
											</Select>
										</FormControl>
										<FormDescription>
											{t("settings.company.form.invoicePDFFormat.description")}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="dateFormat"
								render={({ field }) => (
									<FormItem>
										<FormLabel required>
											{t("settings.company.form.dateFormat.label")}
										</FormLabel>
										<FormControl>
											<Select
												onValueChange={field.onChange}
												value={field.value}
											>
												<SelectTrigger
													className="w-full"
													data-cy="company-dateformat-select"
												>
													<SelectValue
														placeholder={t(
															"settings.company.form.dateFormat.placeholder",
														)}
													/>
												</SelectTrigger>
												<SelectContent data-cy="company-dateformat-options">
													{ALLOWED_DATE_FORMATS.map((format) => (
														<SelectItem
															key={format}
															value={format}
															data-cy={`company-dateformat-option-${format.replace(/\//g, "-")}`}
														>
															{getDateFormatOption(format)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</FormControl>
										<FormDescription>
											{t("settings.company.form.dateFormat.description")}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="exemptVat"
								render={({ field }) => (
									<FormItem className="flex flex-col space-y-3">
										<FormLabel>
											{t("settings.company.form.exemptVat.label")}
										</FormLabel>
										<FormControl>
											<Switch
												checked={!!field.value}
												onCheckedChange={(val) => field.onChange(val)}
												data-cy="company-exemptvat-switch"
											/>
										</FormControl>
										<FormDescription>
											{t("settings.company.form.exemptVat.description")}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</CardContent>
					</Card>

					<div className="flex justify-end">
						<Button
							type="submit"
							disabled={isLoading}
							className="min-w-32"
							data-cy="company-submit-btn"
						>
							{isLoading
								? t("settings.company.form.saving")
								: t("settings.company.form.saveSettings")}
						</Button>
					</div>
				</form>
			</Form>
		</div>
	);
}
