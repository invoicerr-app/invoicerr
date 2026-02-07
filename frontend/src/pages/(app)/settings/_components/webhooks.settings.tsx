"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { authenticatedFetch, useGet, usePost } from "@/hooks/use-fetch";

interface Webhook {
	id: string;
	url: string;
	secret?: string;
	type: string;
	events: string[];
}

export default function WebhooksSettings() {
	const { t } = useTranslation();
	const { data: webhooks, mutate } = useGet<Webhook[]>("/api/webhooks");
	const { trigger: createWebhook, loading: creating } =
		usePost("/api/webhooks");
	const { data: options } = useGet<{ types: string[]; events: string[] }>(
		"/api/webhooks/options",
	);

	const [createdSecret, setCreatedSecret] = useState<string | null>(null);
	const [multiResetKey, setMultiResetKey] = useState(0);

	// options.events will be populated from the backend

	useEffect(() => {
		if (options?.types && options.types.length) {
			form.reset({ ...form.getValues(), type: options.types[0] });
		}
	}, [options]);

	const form = useForm<{ url: string; type: string; events: string[] }>({
		defaultValues: {
			url: "",
			type: options?.types?.[0] ?? "GENERIC",
			events: [],
		},
	});

	const handleCreate = form.handleSubmit(async (values) => {
		if (!values.url?.trim()) return;
		try {
			const res = await createWebhook(values);
			if (
				res &&
				(res as { success: boolean; data?: { secret?: string } }).success
			) {
				const secret = (res as { data?: { secret?: string } }).data?.secret;
				if (secret) setCreatedSecret(secret);
				form.reset({
					url: "",
					type: options?.types?.[0] ?? "GENERIC",
					events: [],
				});
				// force remount of MultiSelect so it picks up cleared value
				setMultiResetKey((k) => k + 1);
				mutate();
			}
		} catch (e) {
			console.error("Error creating webhook:", e);
		}
	});

	const handleDelete = async (id: string) => {
		try {
			const backendUrl = import.meta.env.VITE_BACKEND_URL || "";
			const res = await authenticatedFetch(`${backendUrl}/api/webhooks/${id}`, {
				method: "DELETE",
			});
			if (!res.ok) return;
			const json = await res.json();
			if (json && json.success) mutate();
		} catch {
			// Silent error handling
		}
	};

	const handleEdit = async (id: string, currentUrl: string) => {
		try {
			const newUrl = window.prompt(
				t("settings.webhooks.card.editPrompt") || "New webhook URL",
				currentUrl,
			);
			if (!newUrl) return;
			const backendUrl = import.meta.env.VITE_BACKEND_URL || "";
			const res = await authenticatedFetch(`${backendUrl}/api/webhooks/${id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: newUrl }),
			});
			if (!res.ok) {
				console.error("Failed to update webhook", res.status);
				return;
			}
			const json = await res.json();
			if (json && json.success) mutate();
		} catch (e) {
			console.error("Error updating webhook:", e);
		}
	};

	return (
		<div className="h-full">
			<div className="mb-4">
				<h1 className="text-3xl font-bold">{t("settings.webhooks.title")}</h1>
				<p className="text-muted-foreground">
					{t("settings.webhooks.description")}
				</p>
			</div>

			{createdSecret && (
				<Card className="mb-4">
					<CardContent>
						<CardTitle>
							{t("settings.webhooks.createdSecretTitle") || "Webhook secret"}
						</CardTitle>
						<CardDescription>
							<div className="break-all font-mono bg-muted p-2 rounded">
								{createdSecret}
							</div>
							<div className="text-sm text-muted-foreground mt-2">
								{t("settings.webhooks.createdSecretNotice") ||
									"This secret will be shown only once. Store it securely."}
							</div>
						</CardDescription>
					</CardContent>
				</Card>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<div className="lg:col-span-2 space-y-4 pr-2 overflow-hidden">
					{webhooks?.map((wh) => (
						<Card key={wh.id} className="w-full">
							<CardHeader className="w-full">
								<CardTitle className="text-sm flex items-center gap-2">
									<span className="font-medium">{wh.type}</span>
									<span
										className={`inline-block w-1/2 max-w-full text-xs text-muted-foreground truncate overflow-hidden`}
									>
										{wh.url}
									</span>
								</CardTitle>
								<CardDescription className="w-4/5 overflow-hidden text-ellipsis text-nowrap">
									{t("settings.webhooks.card.events", {
										events: wh.events.join(", "),
									})}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="w-full flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => handleEdit(wh.id, wh.url)}
									>
										{t("settings.webhooks.card.edit") || "Edit"}
									</Button>
									<Button
										variant="destructive"
										size="sm"
										onClick={() => handleDelete(wh.id)}
									>
										{t("settings.webhooks.card.delete") || "Delete"}
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>

				<Card>
					<CardHeader>
						<CardTitle>{t("settings.webhooks.create.title")}</CardTitle>
						<CardDescription>
							{t("settings.webhooks.create.description")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<Form {...form}>
								<form
									className="space-y-2"
									onSubmit={(e) => {
										e.preventDefault();
										handleCreate();
									}}
								>
									<FormField
										name="url"
										control={form.control}
										render={({ field }) => (
											<FormItem>
												<FormLabel>
													{t("settings.webhooks.create.url")}
												</FormLabel>
												<FormControl>
													<Input {...field} />
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
												<FormLabel>
													{t("settings.webhooks.create.type")}
												</FormLabel>
												<FormControl>
													<Select
														value={field.value}
														onValueChange={field.onChange}
													>
														<SelectTrigger className="w-full h-10">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{(options?.types || []).map((type) => (
																<SelectItem key={type} value={type}>
																	{type}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									<FormField
										name="events"
										control={form.control}
										render={({ field }) => (
											<FormItem>
												<FormLabel>
													{t("settings.webhooks.create.events")}
												</FormLabel>
												<FormControl>
													<MultiSelect
														key={multiResetKey}
														defaultValue={field.value || []}
														options={(options?.events || []).map((event) => ({
															label: event,
															value: event,
														}))}
														onValueChange={field.onChange}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									<div className="flex justify-end">
										<Button type="submit" disabled={creating}>
											{t("settings.webhooks.create.button")}
										</Button>
									</div>
								</form>
							</Form>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
