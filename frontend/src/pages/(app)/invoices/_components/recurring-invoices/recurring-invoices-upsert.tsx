import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import React from "react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { BetterInput } from "@/components/better-input";
import CurrencySelect from "@/components/currency-select";
import { DatePicker } from "@/components/date-picker";
import SearchSelect from "@/components/search-input";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useGet, usePatch, usePost } from "@/hooks/use-fetch";
import { Client, PaymentMethod, Quote, RecurringInvoice } from "@/types";
import { type InvoiceItemType, PaymentMethodType } from "@/types";
import { ClientUpsert } from "../../../clients/_components/client-upsert";

interface RecurringInvoiceUpsertDialogProps {
	recurringInvoice?: RecurringInvoice | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function RecurringInvoiceUpsert({
	recurringInvoice,
	open,
	onOpenChange,
}: RecurringInvoiceUpsertDialogProps) {
	const { t } = useTranslation();
	const isEdit = !!recurringInvoice;

	const recurringInvoiceSchema = z.object({
		quoteId: z.string().optional(),
		clientId: z
			.string()
			.min(1, t("recurringInvoices.upsert.form.client.errors.required"))
			.refine((val) => val !== "", {
				message: t("recurringInvoices.upsert.form.client.errors.required"),
			}),
		notes: z.string().optional(),
		paymentMethodId: z.string().optional(),
		frequency: z.enum(
			[
				"WEEKLY",
				"BIWEEKLY",
				"MONTHLY",
				"BIMONTHLY",
				"QUARTERLY",
				"QUADMONTHLY",
				"SEMIANNUALLY",
				"ANNUALLY",
			],
			{
				errorMap: () => ({
					message: t("recurringInvoices.upsert.form.frequency.errors.required"),
				}),
			},
		),
		count: z.number().optional(),
		until: z.date().optional(),
		currency: z.string().optional(),
		autoSend: z.boolean().optional(),
		items: z.array(
			z.object({
				id: z.string().optional(),
				description: z
					.string()
					.min(
						1,
						t(
							"recurringInvoices.upsert.form.items.description.errors.required",
						),
					)
					.refine((val) => val !== "", {
						message: t(
							"recurringInvoices.upsert.form.items.description.errors.required",
						),
					}),
				type: z.string(),
				quantity: z
					.number({
						invalid_type_error: t(
							"recurringInvoices.upsert.form.items.quantity.errors.required",
						),
					})
					.min(
						0.001,
						t("recurringInvoices.upsert.form.items.quantity.errors.min"),
					)
					.refine((val) => !isNaN(val), {
						message: t(
							"recurringInvoices.upsert.form.items.quantity.errors.invalid",
						),
					}),
				unitPrice: z
					.number({
						invalid_type_error: t(
							"recurringInvoices.upsert.form.items.unitPrice.errors.required",
						),
					})
					.min(0, t("recurringInvoices.upsert.form.items.unitPrice.errors.min"))
					.refine((val) => !isNaN(val), {
						message: t(
							"recurringInvoices.upsert.form.items.unitPrice.errors.invalid",
						),
					}),
				vatRate: z
					.number({
						invalid_type_error: t(
							"recurringInvoices.upsert.form.items.vatRate.errors.required",
						),
					})
					.min(0, t("recurringInvoices.upsert.form.items.vatRate.errors.min")),
				order: z.number(),
			}),
		),
	});

	const [clientSearchTerm, setClientsSearchTerm] = useState("");
	const [quoteSearchTerm, setQuoteSearchTerm] = useState("");
	const [clientDialogOpen, setClientDialogOpen] = useState(false);
	const { data: clients } = useGet<Client[]>(
		`/api/clients/search?query=${clientSearchTerm}`,
	);
	const { data: quotes } = useGet<Quote[]>(
		`/api/quotes/search?query=${quoteSearchTerm}`,
	);
	const { data: paymentMethods } =
		useGet<PaymentMethod[]>(`/api/payment-methods`);

	const { trigger: createTrigger } = usePost("/api/recurring-invoices");
	const { trigger: updateTrigger } = usePatch(
		`/api/recurring-invoices/${recurringInvoice?.id}`,
	);

	const form = useForm<z.infer<typeof recurringInvoiceSchema>>({
		resolver: zodResolver(recurringInvoiceSchema),
		defaultValues: {
			quoteId: undefined,
			clientId: "",
			items: [],
			notes: "",
			frequency: "MONTHLY",
			autoSend: false,
		},
	});

	useEffect(() => {
		if (isEdit && recurringInvoice) {
			form.reset({
				notes: recurringInvoice.notes || "",
				paymentMethodId:
					(recurringInvoice.paymentMethodId ??
						recurringInvoice.paymentMethod?.id) ||
					"",
				frequency: recurringInvoice.frequency || "MONTHLY",
				count: recurringInvoice.count,
				until: recurringInvoice.until
					? new Date(recurringInvoice.until)
					: undefined,
				autoSend: recurringInvoice.autoSend || false,
				items: recurringInvoice.items
					.sort((a, b) => a.order - b.order)
					.map((item) => ({
						id: item.id,
						type: item.type,
						description: item.description || "",
						quantity: item.quantity || 1,
						unitPrice: item.unitPrice || 0,
						vatRate: item.vatRate || 0,
						order: item.order || 0,
					})),
			});
		} else {
			form.reset({
				quoteId: undefined,
				clientId: "",
				items: [],
				notes: "",
				frequency: "MONTHLY",
				autoSend: false,
			});
		}
	}, [recurringInvoice, form, isEdit]);

	const { control, handleSubmit, setValue } = form;
	const { fields, append, move, remove } = useFieldArray({
		control,
		name: "items",
	});

	const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor));

	const onDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (active.id !== over?.id) {
			const oldIndex = fields.findIndex((f) => f.id === String(active.id));
			const newIndex = fields.findIndex((f) => f.id === String(over?.id));
			move(oldIndex, newIndex);
			const reordered = arrayMove(fields, oldIndex, newIndex);
			reordered.forEach((_, index) => {
				setValue(`items.${index}.order`, index);
			});
		}
	};

	useEffect(() => {
		fields.forEach((_, i) => {
			setValue(`items.${i}.order`, i);
		});
	}, [fields, setValue]);

	const onRemove = (index: number) => {
		remove(index);
	};

	const onSubmit = (data: z.infer<typeof recurringInvoiceSchema>) => {
		console.debug("Submitting recurringInvoice data:", data);

		const trigger = isEdit ? updateTrigger : createTrigger;

		trigger(data)
			.then(() => {
				onOpenChange(false);
				form.reset();
			})
			.catch((err) => console.error(err));
	};

	const handleClose = (open: boolean) => {
		onOpenChange(!!open);
		form.reset();
	};

	const handleClientCreate = (newClient: Client) => {
		setClientsSearchTerm("");
		form.setValue("clientId", newClient.id);
		clients?.push(newClient);
		form.trigger("clientId");
	};

	return (
		<>
			<Dialog open={open} onOpenChange={handleClose}>
				<DialogContent
					className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden"
					dataCy="recurring-invoice-dialog"
				>
					<DialogHeader>
						<DialogTitle>
							{t(
								`recurringInvoices.upsert.title.${isEdit ? "edit" : "create"}`,
							)}
						</DialogTitle>
					</DialogHeader>
					<Form {...form}>
						<form
							onSubmit={handleSubmit(onSubmit)}
							className="space-y-4 overflow-auto mt-2 flex-1"
							data-cy="recurring-invoice-form"
						>
							<FormField
								control={control}
								name="quoteId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("recurringInvoices.upsert.form.quote.label")}
										</FormLabel>
										<FormControl>
											<SearchSelect
												options={(quotes || []).map((c) => ({
													label: `${c.number}${c.title ? ` (${c.title})` : ""}`,
													value: c.id,
												}))}
												value={field.value ?? ""}
												onValueChange={(val) => {
													field.onChange(val || null);
													if (val) {
														const quote = quotes?.find((q) => q.id === val);
														if (!quote) return;
														form.setValue("clientId", quote.clientId);
														form.setValue("notes", quote.notes);
														form.setValue(
															"paymentMethodId",
															quote.paymentMethodId ??
																quote.paymentMethod?.id ??
																"",
														);
														form.setValue(
															"currency",
															quotes?.find((q) => q.id === val)?.currency || "",
														);
														form.setValue(
															"items",
															quote.items.map((item) => ({
																id: item.id,
																type: item.type,
																description: item.description || "",
																quantity: item.quantity || 1,
																unitPrice: item.unitPrice || 0,
																vatRate: item.vatRate ?? 0,
																order: item.order || 0,
															})),
														);
													}
												}}
												onSearchChange={setQuoteSearchTerm}
												placeholder={t(
													"recurringInvoices.upsert.form.quote.placeholder",
												)}
											/>
										</FormControl>
									</FormItem>
								)}
							/>

							<FormField
								control={control}
								name="clientId"
								render={({ field }) => (
									<FormItem>
										<FormLabel required>
											{t("recurringInvoices.upsert.form.client.label")}
										</FormLabel>
										<FormControl>
											<SearchSelect
												options={(clients || []).map((c) => ({
													label:
														c.name ||
														c.contactFirstname + " " + c.contactLastname,
													value: c.id,
												}))}
												value={field.value ?? ""}
												onValueChange={(val) => field.onChange(val || null)}
												onSearchChange={setClientsSearchTerm}
												placeholder={t(
													"recurringInvoices.upsert.form.client.placeholder",
												)}
												data-cy="recurring-invoice-client-select"
												noResultsComponent={
													<Button
														variant="link"
														onClick={() => setClientDialogOpen(true)}
													>
														{t(
															"recurringInvoices.upsert.form.client.noOptions",
														)}
													</Button>
												}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="currency"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("recurringInvoices.upsert.form.currency.label")}
										</FormLabel>
										<FormControl>
											<CurrencySelect
												value={field.value}
												onChange={(value) => field.onChange(value)}
												data-cy="recurring-invoice-currency-select"
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={control}
								name="notes"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("recurringInvoices.upsert.form.notes.label")}
										</FormLabel>
										<FormControl>
											<Textarea
												{...field}
												placeholder={t(
													"recurringInvoices.upsert.form.notes.placeholder",
												)}
												className="max-h-40"
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<section className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<FormField
									control={control}
									name="paymentMethodId"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("recurringInvoices.upsert.form.paymentMethod.label")}
											</FormLabel>
											<FormControl>
												<Select
													value={field.value ?? ""}
													onValueChange={(val) => field.onChange(val || "")}
												>
													<SelectTrigger>
														<SelectValue
															placeholder={t(
																"recurringInvoices.upsert.form.paymentMethod.placeholder",
															)}
														/>
													</SelectTrigger>
													<SelectContent>
														{paymentMethods?.map((pm: PaymentMethod) => (
															<SelectItem key={pm.id} value={pm.id}>
																{pm.name} -{" "}
																{pm.type == PaymentMethodType.BANK_TRANSFER
																	? t(
																			"paymentMethods.fields.type.bank_transfer",
																		)
																	: pm.type == PaymentMethodType.PAYPAL
																		? t("paymentMethods.fields.type.paypal")
																		: pm.type == PaymentMethodType.CHECK
																			? t("paymentMethods.fields.type.check")
																			: pm.type == PaymentMethodType.CASH
																				? t("paymentMethods.fields.type.cash")
																				: pm.type == PaymentMethodType.OTHER
																					? t(
																							"paymentMethods.fields.type.other",
																						)
																					: pm.type}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</FormControl>
											<FormDescription>
												{t(
													"recurringInvoices.upsert.form.paymentMethod.description",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</section>

							<Separator className="my-4" />

							<section className="grid grid-cols-1 md:grid-cols-3 gap-4">
								<FormField
									control={control}
									name="frequency"
									render={({ field }) => (
										<FormItem>
											<FormLabel required>
												{t("recurringInvoices.upsert.form.frequency.label")}
											</FormLabel>
											<FormControl>
												<Select
													value={field.value}
													onValueChange={field.onChange}
												>
													<SelectTrigger>
														<SelectValue
															placeholder={t(
																"recurringInvoices.upsert.form.frequency.placeholder",
															)}
														/>
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="WEEKLY">
															{t("recurringInvoices.frequency.weekly")}
														</SelectItem>
														<SelectItem value="BIWEEKLY">
															{t("recurringInvoices.frequency.biweekly")}
														</SelectItem>
														<SelectItem value="MONTHLY">
															{t("recurringInvoices.frequency.monthly")}
														</SelectItem>
														<SelectItem value="BIMONTHLY">
															{t("recurringInvoices.frequency.bimonthly")}
														</SelectItem>
														<SelectItem value="QUARTERLY">
															{t("recurringInvoices.frequency.quarterly")}
														</SelectItem>
														<SelectItem value="QUADMONTHLY">
															{t("recurringInvoices.frequency.quadmonthly")}
														</SelectItem>
														<SelectItem value="SEMIANNUALLY">
															{t("recurringInvoices.frequency.semiannually")}
														</SelectItem>
														<SelectItem value="ANNUALLY">
															{t("recurringInvoices.frequency.annually")}
														</SelectItem>
													</SelectContent>
												</Select>
											</FormControl>
											<FormMessage />
											<FormDescription>
												{t(
													"recurringInvoices.upsert.form.frequency.description",
												)}
											</FormDescription>
										</FormItem>
									)}
								/>

								<FormField
									control={control}
									name="count"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("recurringInvoices.upsert.form.count.label")}
											</FormLabel>
											<FormControl>
												<BetterInput
													{...field}
													type="number"
													placeholder={t(
														"recurringInvoices.upsert.form.count.placeholder",
													)}
													onChange={(e) =>
														field.onChange(
															e.target.value === ""
																? undefined
																: Number(e.target.value),
														)
													}
												/>
											</FormControl>
											<FormMessage />
											<FormDescription>
												{t("recurringInvoices.upsert.form.count.description")}
											</FormDescription>
										</FormItem>
									)}
								/>

								<FormField
									control={control}
									name="until"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("recurringInvoices.upsert.form.until.label")}
											</FormLabel>
											<FormControl>
												<DatePicker
													{...field}
													className="w-full"
													placeholder={t(
														"recurringInvoices.upsert.form.until.placeholder",
													)}
													value={field.value || null}
													onChange={field.onChange}
												/>
											</FormControl>
											<FormMessage />
											<FormDescription>
												{t("recurringInvoices.upsert.form.until.description")}
											</FormDescription>
										</FormItem>
									)}
								/>
							</section>

							<Separator className="my-4" />

							<FormItem>
								<FormLabel>
									{t("recurringInvoices.upsert.form.items.label")}
								</FormLabel>
								<DndContext
									sensors={sensors}
									collisionDetection={closestCenter}
									onDragEnd={onDragEnd}
								>
									<SortableContext
										items={fields.map((f) => f.id)}
										strategy={verticalListSortingStrategy}
									>
										<div className="space-y-2">
											{fields.map((fieldItem, index) => (
												<SortableItem
													key={fieldItem.id}
													id={fieldItem.id}
													dragHandle={
														<GripVertical className="cursor-grab text-muted-foreground" />
													}
												>
													<div className="flex gap-2 items-center">
														<FormField
															control={control}
															name={`items.${index}.description`}
															render={({ field }) => (
																<FormItem>
																	<FormControl>
																		<Input
																			{...field}
																			placeholder={t(
																				"recurringInvoices.upsert.form.items.description.placeholder",
																			)}
																		/>
																	</FormControl>
																	<FormMessage />
																</FormItem>
															)}
														/>

														<FormField
															control={control}
															name={`items.${index}.type`}
															render={({ field }) => (
																<FormItem>
																	<FormControl>
																		<Select
																			value={field.value ?? "SERVICE"}
																			onValueChange={(val) =>
																				field.onChange(val as InvoiceItemType)
																			}
																		>
																			<SelectTrigger
																				className="w-32"
																				size="sm"
																				aria-label={
																					t(
																						"recurringInvoices.upsert.form.items.type.label",
																					) as string
																				}
																			>
																				<SelectValue />
																			</SelectTrigger>
																			<SelectContent>
																				<SelectItem value="HOUR">
																					{t(
																						"recurringInvoices.upsert.form.items.type.hour",
																					)}
																				</SelectItem>
																				<SelectItem value="DAY">
																					{t(
																						"recurringInvoices.upsert.form.items.type.day",
																					)}
																				</SelectItem>
																				<SelectItem value="DEPOSIT">
																					{t(
																						"recurringInvoices.upsert.form.items.type.deposit",
																					)}
																				</SelectItem>
																				<SelectItem value="SERVICE">
																					{t(
																						"recurringInvoices.upsert.form.items.type.service",
																					)}
																				</SelectItem>
																				<SelectItem value="PRODUCT">
																					{t(
																						"recurringInvoices.upsert.form.items.type.product",
																					)}
																				</SelectItem>
																			</SelectContent>
																		</Select>
																	</FormControl>
																	<FormMessage />
																</FormItem>
															)}
														/>

														<FormField
															control={control}
															name={`items.${index}.quantity`}
															render={({ field }) => (
																<FormItem>
																	<FormControl>
																		<BetterInput
																			{...field}
																			defaultValue={field.value || ""}
																			postAdornment={t(
																				"recurringInvoices.upsert.form.items.quantity.unit",
																			)}
																			type="number"
																			step="0.001"
																			placeholder={t(
																				"recurringInvoices.upsert.form.items.quantity.placeholder",
																			)}
																			onChange={(e) =>
																				field.onChange(
																					e.target.value === ""
																						? undefined
																						: Number(e.target.value),
																				)
																			}
																		/>
																	</FormControl>
																	<FormMessage />
																</FormItem>
															)}
														/>

														<FormField
															control={control}
															name={`items.${index}.unitPrice`}
															render={({ field }) => (
																<FormItem>
																	<FormControl>
																		<BetterInput
																			{...field}
																			defaultValue={field.value || ""}
																			postAdornment="$"
																			type="number"
																			step="0.01"
																			placeholder={t(
																				"recurringInvoices.upsert.form.items.unitPrice.placeholder",
																			)}
																			onChange={(e) =>
																				field.onChange(
																					e.target.value === ""
																						? undefined
																						: Number(e.target.value),
																				)
																			}
																		/>
																	</FormControl>
																	<FormMessage />
																</FormItem>
															)}
														/>

														<FormField
															control={control}
															name={`items.${index}.vatRate`}
															render={({ field }) => (
																<FormItem>
																	<FormControl>
																		<BetterInput
																			{...field}
																			defaultValue={field.value || 0}
																			postAdornment="%"
																			type="number"
																			step="0.01"
																			placeholder={t(
																				"recurringInvoices.upsert.form.items.vatRate.placeholder",
																			)}
																			onChange={(e) =>
																				field.onChange(
																					e.target.value === ""
																						? undefined
																						: Number.parseFloat(
																								e.target.value.replace(
																									",",
																									".",
																								),
																							),
																				)
																			}
																		/>
																	</FormControl>
																	<FormMessage />
																</FormItem>
															)}
														/>

														<Button
															variant={"outline"}
															onClick={() => onRemove(index)}
														>
															<Trash2 className="h-4 w-4 text-red-700" />
														</Button>
													</div>
												</SortableItem>
											))}
										</div>
									</SortableContext>
								</DndContext>

								<Button
									type="button"
									variant="outline"
									onClick={() =>
										append({
											description: "",
											type: "HOUR",
											quantity: Number.NaN,
											unitPrice: Number.NaN,
											vatRate: Number.NaN,
											order: fields.length,
										})
									}
								>
									<Plus className="mr-2 h-4 w-4" />
									{t("recurringInvoices.upsert.form.items.addItem")}
								</Button>
							</FormItem>

							<Separator className="my-4" />

							<FormField
								control={control}
								name="autoSend"
								render={({ field }) => (
									<FormItem className="mt-4">
										<Switch
											id="autoSend"
											checked={field.value}
											onCheckedChange={field.onChange}
										/>
										<FormLabel className="ml-2" htmlFor="autoSend">
											{t("recurringInvoices.upsert.form.autoSend.label")}
										</FormLabel>
										<FormDescription>
											{t("recurringInvoices.upsert.form.autoSend.description")}
										</FormDescription>
									</FormItem>
								)}
							/>

							<DialogFooter className="flex justify-end">
								<Button variant="outline" onClick={() => handleClose(false)}>
									{t("recurringInvoices.upsert.actions.cancel")}
								</Button>
								<Button type="submit" dataCy="recurring-invoice-submit">
									{t(
										`recurringInvoices.upsert.actions.${isEdit ? "save" : "create"}`,
									)}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>

			<ClientUpsert
				open={clientDialogOpen}
				onOpenChange={setClientDialogOpen}
				onCreate={handleClientCreate} // Gestion du client créé
			/>
		</>
	);
}

function SortableItem({
	id,
	children,
	dragHandle,
}: {
	id: string;
	children: React.ReactNode;
	dragHandle: React.ReactNode;
}) {
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable({ id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div ref={setNodeRef} style={style} className="flex items-center gap-2">
			{children}
			<div {...attributes} {...listeners}>
				{dragHandle}
			</div>
		</div>
	);
}
