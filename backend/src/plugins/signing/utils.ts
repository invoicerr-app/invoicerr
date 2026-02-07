import { PDFDocument } from "@fin.cx/einvoice/dist_ts/plugins";

export async function uploadQuoteFileToUrl(
	fileBuffer: Uint8Array,
	uploadUrl: string,
) {
	fileBuffer = Buffer.isBuffer(fileBuffer)
		? fileBuffer
		: Buffer.from(fileBuffer);

	const response = await fetch(uploadUrl, {
		method: "PUT",
		body: fileBuffer as unknown as BodyInit,
		headers: {
			"Content-Type": "application/octet-stream",
		},
	});

	if (!response.ok) {
		throw new Error(`Upload failed with status: ${response.status}`);
	}
}

export async function countPdfPages(pdfBytes: Uint8Array) {
	const pdfDoc = await PDFDocument.load(pdfBytes);
	const pages = pdfDoc.getPages();

	return pages.length;
}
