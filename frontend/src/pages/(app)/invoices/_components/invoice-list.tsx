import {
	Banknote,
	Code,
	Download,
	Edit,
	Eye,
	FileText,
	Mail,
	Plus,
	ReceiptText,
	Trash2,
} from "lucide-react";
import React from "react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGet, useGetRaw, usePost } from "@/hooks/use-fetch";
import { Invoice } from "@/types";
import BetterPagination from "../../../../components/pagination";
import { InvoiceDeleteDialog } from "./invoice-delete";
import { InvoicePdfModal } from "./invoice-pdf-view";
import { InvoiceUpsert } from "./invoice-upsert";
import { InvoiceViewDialog } from "./invoice-view";

interface InvoiceListProps {
	invoices: Invoice[];
	loading: boolean;
	title: string;
	description: string;
	page?: number;
	pageCount?: number;
	setPage?: (page: number) => void;
	mutate?: () => void;
	emptyState: React.ReactNode;
	showCreateButton?: boolean;
}

export interface InvoiceListHandle {
	handleAddClick: () => void;
}

interface PluginPdfFormat {
	format_name: string;
	format_key: string;
}

export const InvoiceList = forwardRef<InvoiceListHandle, InvoiceListProps>(
	(
		{
			invoices,
			loading,
			title,
			description,
			page,
			pageCount,
			setPage,
			mutate,
			emptyState,
			showCreateButton = false,
		},
		ref,
	) => {
		const { t } = useTranslation();
		const { data: pdf_formats } = useGet<PluginPdfFormat[]>(
			"/api/plugins/formats",
		);
		const { trigger: triggerMarkAsPaid } = usePost(
			`/api/invoices/mark-as-paid`,
		);
		const { trigger: triggerSendInvoiceByEmail } =
			usePost(`/api/invoices/send`);
		const { trigger: triggerCreateReceipt } = usePost(
			`/api/receipts/create-from-invoice`,
		);

		const [createInvoiceDialog, setCreateInvoiceDialog] =
			useState<boolean>(false);
		const [editInvoiceDialog, setEditInvoiceDialog] = useState<Invoice | null>(
			null,
		);
		const [viewInvoiceDialog, setViewInvoiceDialog] = useState<Invoice | null>(
			null,
		);
		const [viewInvoicePdfDialog, setViewInvoicePdfDialog] =
			useState<Invoice | null>(null);
		const [deleteInvoiceDialog, setDeleteInvoiceDialog] =
			useState<Invoice | null>(null);
		const [downloadTrigger, setDownloadTrigger] = useState<{
			invoice: Invoice;
			format: string;
			file_format: "pdf" | "xml";
			id: number;
		} | null>(null);

		const { data: file } = useGetRaw<Response>(
			`/api/invoices/${downloadTrigger?.invoice?.id}/download/${downloadTrigger?.file_format}?format=${downloadTrigger?.format}`,
		);

		useImperativeHandle(ref, () => ({
			handleAddClick() {
				setCreateInvoiceDialog(true);
			},
		}));

		useEffect(() => {
			if (downloadTrigger && file) {
				file
					.arrayBuffer()
					.then((buffer) => {
						const blob = new Blob([buffer], {
							type: `application/${downloadTrigger.file_format}`,
						});
						const url = URL.createObjectURL(blob);
						const link = document.createElement("a");
						link.href = url;
						link.download = `invoice-${downloadTrigger.invoice.number}-${downloadTrigger.format}.${downloadTrigger.file_format}`;
						document.body.appendChild(link);
						link.click();
						document.body.removeChild(link);
						URL.revokeObjectURL(url);
						setDownloadTrigger(null); // Reset
					})
					.catch(() => {});
			}
		}, [downloadTrigger, file]);

		function handleEdit(invoice: Invoice) {
			setEditInvoiceDialog(invoice);
		}

		function handleView(invoice: Invoice) {
			setViewInvoiceDialog(invoice);
		}

		function handleViewPdf(invoice: Invoice) {
			setViewInvoicePdfDialog(invoice);
		}

		function handleDelete(invoice: Invoice) {
			setDeleteInvoiceDialog(invoice);
		}

		function handleMarkAsPaid(invoiceId: string) {
			triggerMarkAsPaid({ invoiceId })
				.then(() => {
					toast.success(t("invoices.list.messages.markAsPaidSuccess"));
					mutate && mutate();
				})
				.catch((error) => {
					console.error("Error marking invoice as paid:", error);
					toast.error(t("invoices.list.messages.markAsPaidError"));
				});
		}

		function handleDownload({
			invoice,
			format,
			file_format,
		}: {
			invoice: Invoice;
			format: string;
			file_format: "pdf" | "xml";
		}) {
			setDownloadTrigger({ invoice, format, file_format, id: Date.now() });
		}

		function handleCreateReceiptFromInvoice(invoiceId: string) {
			triggerCreateReceipt({ id: invoiceId })
				.then(() => {
					toast.success(t("invoices.list.messages.createReceiptSuccess"));
					mutate && mutate();
				})
				.catch((error) => {
					console.error("Error creating receipt from invoice:", error);
					toast.error(t("invoices.list.messages.createReceiptError"));
				});
		}

		const getStatusColor = (status: string) => {
			switch (status) {
				case "SENT":
					return "bg-yellow-100 text-yellow-800";
				case "UNPAID":
					return "bg-blue-100 text-blue-800";
				case "OVERDUE":
					return "bg-red-100 text-red-800";
				case "PAID":
					return "bg-green-100 text-green-800";
				default:
					return "bg-gray-100 text-gray-800";
			}
		};

		const getStatusLabel = (status: string) => {
			return t(`invoices.list.status.${status.toLowerCase()}`);
		};

		const handleSendInvoiceByEmail = (invoiceId: string) => {
			triggerSendInvoiceByEmail({ id: invoiceId })
				.then(() => {
					toast.success(t("invoices.list.messages.sendByEmailSuccess"));
				})
				.catch((error) => {
					console.error("Error sending invoice by email:", error);
					toast.error(t("invoices.list.messages.sendByEmailError"));
				});
		};

		return (
			<>
				<Card className="gap-0">
					<CardHeader className="border-b flex flex-row items-center justify-between">
						<div>
							<CardTitle className="flex items-center space-x-2">
								<ReceiptText className="h-5 w-5 " />
								<span>{title}</span>
							</CardTitle>
							<CardDescription>{description}</CardDescription>
						</div>
						{showCreateButton && (
							<Button onClick={() => setCreateInvoiceDialog(true)}>
								<Plus className="h-4 w-4 mr-0 md:mr-2" />
								<span className="hidden md:inline-flex">
									{t("invoices.list.actions.addNew")}
								</span>
							</Button>
						)}
					</CardHeader>

					<CardContent className="p-0">
						{loading ? (
							<div className="flex items-center justify-center py-12">
								<div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
							</div>
						) : invoices.length === 0 ? (
							emptyState
						) : (
							<div className="divide-y">
								{invoices.map((invoice, index) => (
									<div key={index} className="p-4 sm:p-6" data-cy="invoice-row">
										<div className="flex flex-row sm:items-center sm:justify-between gap-4">
											<div className="flex flex-row items-center gap-4 w-full">
												<div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
													<ReceiptText className="h-5 w-5 text-blue-600" />
												</div>
												<div className="flex-1">
													<div className="flex flex-wrap items-center gap-2">
														<h3 className="font-medium text-foreground break-words">
															{t("invoices.list.item.title", {
																number: invoice.rawNumber || invoice.number,
																title: invoice.title,
															})}
														</h3>
														<span
															data-cy="invoice-status"
															className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(invoice.status)}`}
														>
															{getStatusLabel(invoice.status)}
														</span>
													</div>
													<div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
														<div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
															<span>
																<span className="font-medium text-foreground">
																	{t("invoices.list.item.client")}:
																</span>{" "}
																{invoice.client.name ||
																	invoice.client.contactFirstname +
																		" " +
																		invoice.client.contactLastname}
															</span>
															<span>
																<span className="font-medium text-foreground">
																	{t("invoices.list.item.issued")}:
																</span>{" "}
																{new Date(
																	invoice.createdAt,
																).toLocaleDateString()}
															</span>
															<span>
																<span className="font-medium text-foreground">
																	{t("invoices.list.item.due")}:
																</span>{" "}
																{new Date(invoice.dueDate).toLocaleDateString()}
															</span>
															{invoice.paymentMethod && (
																<span>
																	<span className="font-medium text-foreground">
																		{t("invoices.list.item.payment")}:
																	</span>{" "}
																	{invoice.paymentMethod?.name ??
																		invoice.paymentMethod?.type ??
																		"-"}
																</span>
															)}
															<span>
																<span className="font-medium text-foreground">
																	{t("invoices.list.item.totalHT")}:
																</span>{" "}
																{t("common.valueWithCurrency", {
																	currency: invoice.currency,
																	amount: invoice.totalHT.toFixed(2),
																})}
															</span>
															<span>
																<span className="font-medium text-foreground">
																	{t("invoices.list.item.totalTTC")}:
																</span>{" "}
																{t("common.valueWithCurrency", {
																	currency: invoice.currency,
																	amount: invoice.totalTTC.toFixed(2),
																})}
															</span>
														</div>
													</div>
												</div>
											</div>

											<div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
												<Button
													tooltip={t("invoices.list.tooltips.view")}
													variant="ghost"
													size="icon"
													onClick={() => handleView(invoice)}
													className="text-gray-600 hover:text-blue-600"
												>
													<Eye className="h-4 w-4" />
												</Button>

												<Button
													tooltip={t("invoices.list.tooltips.viewPdf")}
													variant="ghost"
													size="icon"
													onClick={() => handleViewPdf(invoice)}
													className="text-gray-600 hover:text-pink-600"
												>
													<ReceiptText className="h-4 w-4" />
												</Button>

												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															tooltip={t("invoices.list.tooltips.downloadPdf")}
															variant="ghost"
															size="icon"
															className="text-gray-600 hover:text-amber-600"
														>
															<Download className="h-4 w-4" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent
														align="center"
														className="[&>*]:cursor-pointer w-48"
													>
														<DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
															<FileText className="h-3 w-3" />
															{t("invoices.list.actions.downloadPdf")}
														</DropdownMenuLabel>

														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "",
																	file_format: "pdf",
																})
															}
														>
															Standard
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "facturx",
																	file_format: "pdf",
																})
															}
														>
															Factur-X
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "zugferd",
																	file_format: "pdf",
																})
															}
														>
															ZUGFeRD
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "xrechnung",
																	file_format: "pdf",
																})
															}
														>
															XRechnung
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "ubl",
																	file_format: "pdf",
																})
															}
														>
															UBL
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "cii",
																	file_format: "pdf",
																})
															}
														>
															CII
														</DropdownMenuItem>

														<DropdownMenuSeparator />

														<DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
															<Code className="h-3 w-3" />
															{t("invoices.list.actions.downloadXml")}
														</DropdownMenuLabel>

														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "facturx",
																	file_format: "xml",
																})
															}
														>
															Factur-X
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "zugferd",
																	file_format: "xml",
																})
															}
														>
															ZUGFeRD
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "xrechnung",
																	file_format: "xml",
																})
															}
														>
															XRechnung
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "ubl",
																	file_format: "xml",
																})
															}
														>
															UBL
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																handleDownload({
																	invoice,
																	format: "cii",
																	file_format: "xml",
																})
															}
														>
															CII
														</DropdownMenuItem>
														{pdf_formats?.map((format) => (
															<DropdownMenuItem
																key={format.format_key}
																onClick={() =>
																	handleDownload({
																		invoice,
																		format: format.format_key,
																		file_format: "xml",
																	})
																}
															>
																{format.format_name}
															</DropdownMenuItem>
														))}
													</DropdownMenuContent>
												</DropdownMenu>

												{invoice.status !== "PAID" && (
													<Button
														data-cy="invoice-edit-button"
														tooltip={t("invoices.list.tooltips.edit")}
														variant="ghost"
														size="icon"
														onClick={() => handleEdit(invoice)}
														className="text-gray-600 hover:text-blue-600"
													>
														<Edit className="h-4 w-4" />
													</Button>
												)}

												{invoice.status !== "PAID" && (
													<Button
														tooltip={t("invoices.list.tooltips.sendByEmail")}
														variant="ghost"
														size="icon"
														onClick={() => {
															handleSendInvoiceByEmail(invoice.id);
														}}
														className="text-gray-600 hover:text-purple-600"
													>
														<Mail className="h-4 w-4" />
													</Button>
												)}

												{invoice.status !== "PAID" && (
													<Button
														tooltip={t("invoices.list.tooltips.markAsPaid")}
														variant="ghost"
														size="icon"
														onClick={() => handleMarkAsPaid(invoice.id)}
														className="text-gray-600 hover:text-blue-600"
													>
														<Banknote className="h-4 w-4" />
													</Button>
												)}

												{invoice.status !== "PAID" &&
													invoice.status !== "OVERDUE" && (
														<Button
															tooltip={t("invoices.list.tooltips.delete")}
															variant="ghost"
															size="icon"
															onClick={() => handleDelete(invoice)}
															className="text-gray-600 hover:text-red-600"
														>
															<Trash2 className="h-4 w-4" />
														</Button>
													)}

												<Button
													tooltip={t("invoices.list.tooltips.createReceipt")}
													variant="ghost"
													size="icon"
													onClick={() =>
														handleCreateReceiptFromInvoice(invoice.id)
													}
													className="text-gray-600 hover:text-green-600"
												>
													<Plus className="h-4 w-4" />
												</Button>
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>

					{page && pageCount && setPage && (
						<CardFooter>
							{!loading && invoices.length > 0 && (
								<BetterPagination
									pageCount={pageCount}
									page={page}
									setPage={setPage}
								/>
							)}
						</CardFooter>
					)}
				</Card>

				<InvoiceUpsert
					open={createInvoiceDialog}
					onOpenChange={(open: boolean) => {
						setCreateInvoiceDialog(open);
						if (!open) mutate && mutate();
					}}
				/>

				<InvoiceUpsert
					open={!!editInvoiceDialog}
					invoice={editInvoiceDialog}
					onOpenChange={(open: boolean) => {
						if (!open) setEditInvoiceDialog(null);
						mutate && mutate();
					}}
				/>

				<InvoiceViewDialog
					invoice={viewInvoiceDialog}
					onOpenChange={(open: boolean) => {
						if (!open) setViewInvoiceDialog(null);
					}}
				/>

				<InvoicePdfModal
					invoice={viewInvoicePdfDialog}
					onOpenChange={(open: boolean) => {
						if (!open) setViewInvoicePdfDialog(null);
					}}
				/>

				<InvoiceDeleteDialog
					invoice={deleteInvoiceDialog}
					onOpenChange={(open: boolean) => {
						if (!open) setDeleteInvoiceDialog(null);
						mutate && mutate();
					}}
				/>
			</>
		);
	},
);
