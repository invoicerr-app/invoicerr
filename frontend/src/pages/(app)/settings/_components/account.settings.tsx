import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
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
import { authClient } from "@/lib/auth";

export default function AccountSettings() {
	const { t } = useTranslation();

	const [updateUserLoading, setUpdateUserLoading] = useState(false);
	const [updatePasswordLoading, setUpdatePasswordLoading] = useState(false);
	const [hasCredentialAccount, setHasCredentialAccount] = useState<
		boolean | null
	>(null);

	// Check if user has a credential account (email/password)
	useEffect(() => {
		authClient
			.listAccounts()
			.then(({ data }) => {
				console.log("User accounts:", data);
				const hasCredential =
					data?.some((account) => account.providerId === "credential") ?? false;
				setHasCredentialAccount(hasCredential);
			})
			.catch(() => {
				setHasCredentialAccount(false);
			});
	}, []);

	const profileSchema = z
		.object({
			firstname: z
				.string()
				.min(1, {
					message: t("settings.account.form.firstname.errors.required"),
				}),
			lastname: z
				.string()
				.min(1, {
					message: t("settings.account.form.lastname.errors.required"),
				}),
			email: z
				.string()
				.email({ message: t("settings.account.form.email.errors.invalid") }),
		})
		.refine(
			(data) =>
				data.firstname.trim() !== "" &&
				data.lastname.trim() !== "" &&
				data.email.trim() !== "",
			{
				message: t("settings.account.form.errors.fieldsEmpty"),
			},
		);

	const passwordSchema = z
		.object({
			currentPassword: hasCredentialAccount
				? z
						.string()
						.min(1, {
							message: t(
								"settings.account.form.currentPassword.errors.required",
							),
						})
				: z.string().optional(),
			password: z
				.string()
				.min(8, {
					message: t("settings.account.form.password.errors.minLength"),
				})
				.regex(/[a-zA-Z]/, {
					message: t("settings.account.form.password.errors.letter"),
				})
				.regex(/[0-9]/, {
					message: t("settings.account.form.password.errors.number"),
				})
				.regex(/[^a-zA-Z0-9]/, {
					message: t("settings.account.form.password.errors.special"),
				})
				.trim(),
			confirmPassword: z.string().trim(),
		})
		.refine((data) => data.password === data.confirmPassword, {
			message: t("settings.account.form.confirmPassword.errors.match"),
			path: ["confirmPassword"],
		});

	const profileForm = useForm<z.infer<typeof profileSchema>>({
		resolver: zodResolver(profileSchema),
		defaultValues: {
			firstname: "",
			lastname: "",
			email: "",
		},
	});

	const passwordForm = useForm<z.infer<typeof passwordSchema>>({
		resolver: zodResolver(passwordSchema),
		defaultValues: {
			currentPassword: "",
			password: "",
			confirmPassword: "",
		},
	});

	const handleProfileUpdate = async (values: z.infer<typeof profileSchema>) => {
		setUpdateUserLoading(true);
		authClient
			.updateUser({
				// @ts-expect-error - additional fields not in type definition
				firstname: values.firstname,
				lastname: values.lastname,
				email: values.email,
			})
			.then(() => {
				toast.success(t("settings.account.messages.profileUpdateSuccess"));
			})
			.catch((error) => {
				console.error("Error updating profile:", error);
				toast.error(t("settings.account.messages.profileUpdateError"));
			})
			.finally(() => {
				setUpdateUserLoading(false);
			});
	};

	const handlePasswordUpdate = async (
		values: z.infer<typeof passwordSchema>,
	) => {
		setUpdatePasswordLoading(true);

		if (hasCredentialAccount) {
			// User has a password, use changePassword
			authClient
				.changePassword({
					currentPassword: values.currentPassword!,
					newPassword: values.password,
				})
				.then(() => {
					toast.success(t("settings.account.messages.passwordUpdateSuccess"));
					passwordForm.reset();
				})
				.catch((error) => {
					console.error("Error updating password:", error);
					toast.error(t("settings.account.messages.passwordUpdateError"));
				})
				.finally(() => {
					setUpdatePasswordLoading(false);
				});
		} else {
			// User doesn't have a password (OIDC only), use setPassword endpoint
			fetch(
				`${import.meta.env.VITE_BACKEND_URL || ""}/api/auth-extended/set-password`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					credentials: "include",
					body: JSON.stringify({ newPassword: values.password }),
				},
			)
				.then(async (res) => {
					if (!res.ok) {
						throw new Error("Failed to set password");
					}
					toast.success(t("settings.account.messages.passwordUpdateSuccess"));
					passwordForm.reset();
					setHasCredentialAccount(true); // Now user has a credential account
				})
				.catch((error) => {
					console.error("Error setting password:", error);
					toast.error(t("settings.account.messages.passwordUpdateError"));
				})
				.finally(() => {
					setUpdatePasswordLoading(false);
				});
		}
	};

	return (
		<div>
			<div className="mb-4">
				<h1 className="text-3xl font-bold">{t("settings.account.title")}</h1>
				<p className="text-muted-foreground">
					{t("settings.account.description")}
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<Card className="h-fit">
					<CardHeader>
						<CardTitle>{t("settings.account.profile.title")}</CardTitle>
						<CardDescription>
							{t("settings.account.profile.description")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Form {...profileForm}>
							<form
								onSubmit={profileForm.handleSubmit(handleProfileUpdate)}
								className="space-y-4"
							>
								<FormField
									control={profileForm.control}
									name="firstname"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("settings.account.form.firstname.label")}
											</FormLabel>
											<FormControl>
												<Input
													placeholder={t(
														"settings.account.form.firstname.placeholder",
													)}
													{...field}
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
											<FormLabel>
												{t("settings.account.form.lastname.label")}
											</FormLabel>
											<FormControl>
												<Input
													placeholder={t(
														"settings.account.form.lastname.placeholder",
													)}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={profileForm.control}
									name="email"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("settings.account.form.email.label")}
											</FormLabel>
											<FormControl>
												<Input
													type="email"
													placeholder={t(
														"settings.account.form.email.placeholder",
													)}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								<Button type="submit" disabled={updateUserLoading}>
									{updateUserLoading
										? t("settings.account.form.updatingProfile")
										: t("settings.account.form.updateProfile")}
								</Button>
							</form>
						</Form>
					</CardContent>
				</Card>

				<Card className="h-fit">
					<CardHeader>
						<CardTitle>{t("settings.account.password.title")}</CardTitle>
						<CardDescription>
							{t("settings.account.password.description")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{hasCredentialAccount === null ? (
							<div className="text-center text-muted-foreground py-4">
								{t("settings.account.password.loading")}
							</div>
						) : (
							<>
								{!hasCredentialAccount && (
									<div className="mb-4 p-3 bg-muted rounded-md">
										<p className="text-sm text-muted-foreground">
											{t("settings.account.password.noPasswordSet")}
										</p>
									</div>
								)}
								<Form {...passwordForm}>
									<form
										onSubmit={passwordForm.handleSubmit(handlePasswordUpdate)}
										className="space-y-4"
									>
										{hasCredentialAccount && (
											<FormField
												control={passwordForm.control}
												name="currentPassword"
												render={({ field }) => (
													<FormItem>
														<FormLabel>
															{t("settings.account.form.currentPassword.label")}
														</FormLabel>
														<FormControl>
															<Input
																type="password"
																placeholder={t(
																	"settings.account.form.currentPassword.placeholder",
																)}
																{...field}
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										)}

										<FormField
											control={passwordForm.control}
											name="password"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														{hasCredentialAccount
															? t("settings.account.form.password.label")
															: t("settings.account.form.password.labelNew")}
													</FormLabel>
													<FormControl>
														<Input
															type="password"
															placeholder={t(
																"settings.account.form.password.placeholder",
															)}
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={passwordForm.control}
											name="confirmPassword"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														{t("settings.account.form.confirmPassword.label")}
													</FormLabel>
													<FormControl>
														<Input
															type="password"
															placeholder={t(
																"settings.account.form.confirmPassword.placeholder",
															)}
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<Button type="submit" disabled={updatePasswordLoading}>
											{updatePasswordLoading
												? t("settings.account.form.updatingPassword")
												: hasCredentialAccount
													? t("settings.account.form.updatePassword")
													: t("settings.account.form.setPassword")}
										</Button>
									</form>
								</Form>
							</>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
