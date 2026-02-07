"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
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
import { authenticatedFetch, usePatch, usePost } from "@/hooks/use-fetch";

const paymentMethodSchema = z.object({
	name: z.string().min(1, { message: "Name is required" }),
	details: z.string().optional(),
	type: z.enum(["BANK_TRANSFER", "PAYPAL", "CASH", "CHECK", "OTHER"]),
});

type PaymentMethodForm = z.infer<typeof paymentMethodSchema>;

interface PaymentMethod {
	id: string;
	name: string;
	details?: string;
	type?: "BANK_TRANSFER" | "PAYPAL" | "CASH" | "CHECK" | "OTHER";
	isActive?: boolean;
}

interface PaymentMethodUpsertProps {
	paymentMethod?: PaymentMethod | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function PaymentMethodUpsert({
	paymentMethod,
	open,
	onOpenChange,
}: PaymentMethodUpsertProps) {
	const { t } = useTranslation();
	const isEdit = !!paymentMethod;

	const { trigger: createTrigger, loading: creating } = usePost(
		"/api/payment-methods",
	);
	const { trigger: updateTrigger, loading: updating } = usePatch(
		`/api/payment-methods/${paymentMethod?.id || ""}`,
	);

	const form = useForm<PaymentMethodForm>({
		resolver: zodResolver(paymentMethodSchema),
		defaultValues: {
			name: "",
			details: "",
			type: "BANK_TRANSFER",
		},
	});

	useEffect(() => {
		if (paymentMethod) {
			form.reset({
				name: paymentMethod.name || "",
				details: paymentMethod.details || "",
				type: paymentMethod.type || "BANK_TRANSFER",
			});
		} else {
			form.reset({ name: "", details: "", type: "BANK_TRANSFER" });
		}
	}, [paymentMethod, open, form]);

	const onSubmit = async (data: PaymentMethodForm) => {
		try {
			if (isEdit) {
				if (updateTrigger) {
					await updateTrigger({ ...data });
				} else {
					const res = await authenticatedFetch(
						`${import.meta.env.VITE_BACKEND_URL || ""}/api/payment-methods/${paymentMethod?.id}`,
						{
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(data),
						},
					);
					if (!res.ok) throw new Error("Update failed");
				}
				toast.success(
					t("paymentMethods.upsert.messages.updateSuccess") ||
						"Payment method updated",
				);
			} else {
				await createTrigger(data);
				toast.success(
					t("paymentMethods.upsert.messages.addSuccess") ||
						"Payment method added",
				);
			}
			onOpenChange(false);
		} catch (err) {
			console.error(err);
			toast.error(
				isEdit
					? t("paymentMethods.upsert.messages.updateError") ||
							"Failed to update payment method"
					: t("paymentMethods.upsert.messages.addError") ||
							"Failed to add payment method",
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-7xl min-w-fit"
				dataCy="payment-method-dialog"
			>
				<DialogHeader>
					<DialogTitle>
						{t(`paymentMethods.upsert.title.${isEdit ? "edit" : "create"}`)}
					</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="space-y-4"
						data-cy="payment-method-form"
					>
						<FormField
							name="name"
							control={form.control}
							render={({ field }) => (
								<FormItem>
									<FormLabel required>
										{t("paymentMethods.fields.name.label")}
									</FormLabel>
									<FormControl>
										<Input
											{...field}
											placeholder={
												t("paymentMethods.fields.name.placeholder") as string
											}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							name="details"
							control={form.control}
							render={({ field }) => (
								<FormItem>
									<FormLabel>
										{t("paymentMethods.fields.details.label")}
									</FormLabel>
									<FormControl>
										<Input
											{...field}
											placeholder={
												t("paymentMethods.fields.details.placeholder") as string
											}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							name="type"
							control={form.control}
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("paymentMethods.fields.type.label")}</FormLabel>
									<FormControl>
										<Select
											value={field.value}
											onValueChange={(val) =>
												field.onChange(
													val as
														| "BANK_TRANSFER"
														| "PAYPAL"
														| "CASH"
														| "CHECK"
														| "OTHER",
												)
											}
										>
											<SelectTrigger
												className="w-full"
												size="sm"
												aria-label={
													t("paymentMethods.fields.type.label") as string
												}
												dataCy="payment-method-type-trigger"
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent dataCy="payment-method-type-content">
												<SelectItem
													value="BANK_TRANSFER"
													dataCy="payment-method-type-bank-transfer"
												>
													{t("paymentMethods.fields.type.bank_transfer")}
												</SelectItem>
												<SelectItem
													value="PAYPAL"
													dataCy="payment-method-type-paypal"
												>
													{t("paymentMethods.fields.type.paypal")}
												</SelectItem>
												<SelectItem
													value="CHECK"
													dataCy="payment-method-type-check"
												>
													{t("paymentMethods.fields.type.check")}
												</SelectItem>
												<SelectItem
													value="CASH"
													dataCy="payment-method-type-cash"
												>
													{t("paymentMethods.fields.type.cash")}
												</SelectItem>
												<SelectItem
													value="OTHER"
													dataCy="payment-method-type-other"
												>
													{t("paymentMethods.fields.type.other")}
												</SelectItem>
											</SelectContent>
										</Select>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="flex justify-end gap-2">
							<Button
								variant="outline"
								type="button"
								onClick={() => onOpenChange(false)}
							>
								{t("paymentMethods.actions.cancel") || "Cancel"}
							</Button>
							<Button
								type="submit"
								disabled={creating || updating}
								dataCy="payment-method-submit"
							>
								{isEdit
									? t("paymentMethods.actions.save") || "Save"
									: t("paymentMethods.actions.add") || "Add"}
							</Button>
						</div>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

export default PaymentMethodUpsert;
