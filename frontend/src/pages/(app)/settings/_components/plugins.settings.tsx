"use client";

import { ExternalLink, GitBranch, Plus, Trash2 } from "lucide-react";
import React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormConfig } from "@/components/form-modal";
import { DynamicFormModal } from "@/components/form-modal";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WebhookInstructionsModal } from "@/components/webhook-instructions-modal";
import { useDelete, useGet, usePost, usePut } from "@/hooks/use-fetch";

interface PluginResponse {
	success: boolean;
	webhookUrl?: string;
	webhookSecret?: string;
	instructions?: string;
	requiresConfiguration?: boolean;
	formConfig?: {
		form: {
			fields: any[];
		};
	};
	currentConfig?: Record<string, unknown>;
}

interface Plugin {
	uuid: string;
	name: string;
	description: string;
}

interface InAppPlugin {
	id: string;
	name: string;
	isActive: boolean;
	hasWebhook?: boolean;
}

interface InAppPluginCategories {
	category: string;
	plugins: InAppPlugin[];
}

export default function PluginsSettings() {
	const { t } = useTranslation();

	const [gitUrl, setGitUrl] = useState("");
	const [isDeleting, setIsDeleting] = useState<string | null>(null);
	const [configModalOpen, setConfigModalOpen] = useState(false);
	const [configFormData, setConfigFormData] = useState<{
		pluginId: string;
		formConfig: FormConfig;
		currentConfig: Record<string, unknown>;
	} | null>(null);
	const [togglingPluginId, setTogglingPluginId] = useState<string | null>(null);
	const [webhookInstructionsOpen, setWebhookInstructionsOpen] = useState(false);
	const [webhookInstructions, setWebhookInstructions] = useState<{
		pluginName: string;
		webhookUrl: string;
		webhookSecret: string;
		instructions: string[];
	} | null>(null);

	const { data: plugins, mutate } = useGet<Plugin[]>("/api/plugins");
	const { data: inAppPlugins, mutate: mutateInAppPlugins } = useGet<
		InAppPluginCategories[]
	>("/api/plugins/in-app");

	const { trigger: addPlugin, loading: addLoading } = usePost("/api/plugins");
	const { trigger: deletePlugin, loading: deleteLoading } =
		useDelete("/api/plugins");
	const { trigger: togglePlugin } = usePut(`/api/plugins/in-app/toggle`);
	const { trigger: configurePlugin } = usePost(`/api/plugins/in-app/configure`);
	const { trigger: validatePlugin } = usePost(`/api/plugins/in-app/validate`);

	const handleDeletePlugin = async (uuid: string) => {
		setIsDeleting(uuid);
		try {
			deletePlugin({ uuid })
				.then((response: PluginResponse) => {
					if (!response.success) {
						throw new Error("Failed to delete plugin");
					}
					toast.success(t("settings.plugins.messages.deleteSuccess"));
					mutate();
				})
				.catch(() => {
					toast.error(t("settings.plugins.messages.deleteError"));
				});
		} catch {
			toast.error(t("settings.plugins.messages.deleteError"));
		} finally {
			setIsDeleting(null);
		}
	};

	const handleAddPlugin = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!gitUrl.trim()) return;

		try {
			const cleanUrl = gitUrl.replace(/\.git$/, "");

			addPlugin({ gitUrl: cleanUrl })
				.then((response) => {
					if (!response) {
						throw new Error("Failed to add plugin");
					}
					toast.success(t("settings.plugins.messages.addSuccess"));
					setGitUrl("");
					mutate();
				})
				.catch(() => {
					toast.error(t("settings.plugins.messages.addError"));
				});
		} catch {
			toast.error(t("settings.plugins.messages.addError"));
		}
	};

	const handleToggleInAppPlugin = async (pluginId: string) => {
		try {
			setTogglingPluginId(pluginId);
			const response = (await togglePlugin({ pluginId })) as PluginResponse;

			if (!response) throw new Error("Failed to toggle plugin");

			if (response.success === true) {
				toast.success(t("settings.plugins.messages.toggleSuccess"));
				mutateInAppPlugins();

				if (response.webhookUrl && response.instructions) {
					const plugin = inAppPlugins
						?.flatMap((cat) => cat.plugins)
						.find((p) => p.id === pluginId);
					setWebhookInstructions({
						pluginName: plugin?.name || "Plugin",
						webhookUrl: response.webhookUrl,
						webhookSecret: response.webhookSecret,
						instructions: response.instructions,
					});
					setWebhookInstructionsOpen(true);
				}
			} else if (response.requiresConfiguration) {
				setConfigFormData({
					pluginId,
					formConfig: response.formConfig,
					currentConfig: response.currentConfig || {},
				});
				setConfigModalOpen(true);
			}
		} catch (error: unknown) {
			toast.error(
				(error instanceof Error ? error.message : String(error)) ||
					t("settings.plugins.messages.toggleError"),
			);
		} finally {
			setTogglingPluginId(null);
		}
	};

	const handleConfigurePlugin = async (config: Record<string, unknown>) => {
		if (!configFormData) return;

		try {
			const response = await configurePlugin({
				pluginId: configFormData.pluginId,
				config,
			});

			if (!response) throw new Error("Failed to configure plugin");

			if ((response as PluginResponse).success === true) {
				toast.success(t("settings.plugins.messages.configureSuccess"));
				setConfigModalOpen(false);
				setConfigFormData(null);
				mutateInAppPlugins();

				const responseTyped = response as PluginResponse;
				if (responseTyped.webhookUrl && responseTyped.instructions) {
					const plugin = inAppPlugins
						?.flatMap((cat) => cat.plugins)
						.find((p) => p.id === configFormData.pluginId);
					setWebhookInstructions({
						pluginName: plugin?.name || "Plugin",
						webhookUrl: responseTyped.webhookUrl,
						webhookSecret: responseTyped.webhookSecret,
						instructions: responseTyped.instructions,
					});
					setWebhookInstructionsOpen(true);
				}
			}
		} catch (error: unknown) {
			toast.error(
				(error instanceof Error ? error.message : String(error)) ||
					t("settings.plugins.messages.configureError"),
			);
		}
	};

	const handlePluginInstructions = async (pluginId: string) => {
		try {
			const response = await validatePlugin({ pluginId });

			if (!response) throw new Error("Failed to validate plugin");

			const responseTyped = response as PluginResponse;
			if (responseTyped.success === true) {
				mutateInAppPlugins();

				if (
					responseTyped.webhookUrl &&
					responseTyped.webhookSecret &&
					responseTyped.instructions
				) {
					const plugin = inAppPlugins
						?.flatMap((cat) => cat.plugins)
						.find((p) => p.id === pluginId);
					setWebhookInstructions({
						pluginName: plugin?.name || "Plugin",
						webhookUrl: responseTyped.webhookUrl,
						webhookSecret: responseTyped.webhookSecret,
						instructions: responseTyped.instructions,
					});
					setWebhookInstructionsOpen(true);
				}
			}
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	};

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold mb-2">
					{t("settings.plugins.title", { count: plugins?.length || 0 })}
				</h1>
				<p className="text-muted-foreground">
					{t("settings.plugins.description")}
				</p>
			</div>

			{inAppPlugins && inAppPlugins.length > 0 && (
				<div className="space-y-4">
					<div>
						<h2 className="text-xl font-semibold mb-4">In-app Plugins</h2>
					</div>
					{inAppPlugins.map((category) => (
						<Card key={category.category}>
							<CardHeader>
								<CardTitle className="capitalize">
									{category.category}
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									{category.plugins.map((plugin) => (
										<div
											key={plugin.id}
											className="flex items-center justify-between p-3 border rounded-lg"
										>
											<div>
												<p className="font-medium">{plugin.name}</p>
											</div>
											<div className="flex items-center gap-2">
												{plugin.isActive && plugin.hasWebhook && (
													<Button
														variant="outline"
														size="sm"
														onClick={() => handlePluginInstructions(plugin.id)}
														className="flex items-center gap-2"
													>
														<ExternalLink className="h-4 w-4" />
														Webhook
													</Button>
												)}
												<Switch
													checked={plugin.isActive}
													onCheckedChange={() =>
														handleToggleInAppPlugin(plugin.id)
													}
													disabled={togglingPluginId === plugin.id}
												/>
											</div>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<DynamicFormModal
				open={configModalOpen}
				title="Configure Plugin"
				description="Please fill in the required configuration fields"
				config={configFormData?.formConfig || null}
				currentValues={configFormData?.currentConfig}
				onCancel={() => {
					setConfigModalOpen(false);
					setConfigFormData(null);
				}}
				onSubmit={(formData) => handleConfigurePlugin(formData)}
			/>

			<WebhookInstructionsModal
				open={webhookInstructionsOpen}
				onOpenChange={setWebhookInstructionsOpen}
				pluginName={webhookInstructions?.pluginName || ""}
				webhookUrl={webhookInstructions?.webhookUrl || ""}
				webhookSecret={webhookInstructions?.webhookSecret || ""}
				instructions={webhookInstructions?.instructions || []}
			/>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Plus className="h-5 w-5" />
						{t("settings.plugins.add.title")}
					</CardTitle>
					<CardDescription>
						{t("settings.plugins.add.description")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleAddPlugin} className="flex gap-2">
						<div className="flex-1">
							<Label htmlFor="git-url" className="sr-only">
								{t("settings.plugins.add.gitUrl.label")}
							</Label>
							<Input
								id="git-url"
								type="url"
								placeholder={t("settings.plugins.add.gitUrl.placeholder")}
								value={gitUrl}
								onChange={(e) => setGitUrl(e.target.value)}
								disabled={addLoading}
							/>
						</div>
						<Button type="submit" disabled={addLoading || !gitUrl.trim()}>
							{addLoading
								? t("settings.plugins.actions.addLoading")
								: t("settings.plugins.actions.add")}
						</Button>
					</form>
				</CardContent>
			</Card>

			<div className="space-y-4">
				{plugins?.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center justify-center py-8">
							<GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
							<p className="text-muted-foreground text-center">
								{t("settings.plugins.emptyState.noPlugins")}
							</p>
						</CardContent>
					</Card>
				) : (
					plugins?.map((plugin: Plugin) => (
						<Card key={plugin.uuid}>
							<CardContent>
								<div className="flex items-start justify-between">
									<div>
										<CardTitle className="text-lg">{plugin.name}</CardTitle>
										<CardDescription className="mt-1">
											{plugin.description}
										</CardDescription>
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={() => handleDeletePlugin(plugin.uuid)}
										disabled={deleteLoading && isDeleting === plugin.uuid}
										className="text-destructive hover:text-destructive"
									>
										<Trash2 className="h-4 w-4" />
										<span className="sr-only">
											{deleteLoading && isDeleting === plugin.uuid
												? t("settings.plugins.actions.deleting")
												: t("settings.plugins.actions.delete")}
										</span>
									</Button>
								</div>
							</CardContent>
						</Card>
					))
				)}
			</div>
		</div>
	);
}
