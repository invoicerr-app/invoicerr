import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '@/mail/mail.service';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { assertValid, validateEmailPayload } from '../validation';

@Injectable()
export class EmailTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'email';
  readonly supportedPlatforms = ['email'];
  private readonly logger = new Logger(EmailTransmissionStrategy.name);

  constructor(private readonly mailService: MailService) {}

  supports(platform: string): boolean {
    return platform === 'email' || !platform;
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // Validate payload
    const validation = validateEmailPayload(payload);
    assertValid(validation, 'email transmission');

    try {
      const attachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }> = [
        {
          filename: `invoice-${payload.invoiceNumber}.pdf`,
          content: payload.pdfBuffer,
          contentType: 'application/pdf',
        },
      ];

      // Add XML attachment if available
      if (payload.xmlContent) {
        attachments.push({
          filename: `invoice-${payload.invoiceNumber}.xml`,
          content: Buffer.from(payload.xmlContent, 'utf-8'),
          contentType: 'application/xml',
        });
      }

      await this.mailService.sendMail({
        to: payload.recipient.email,
        subject: `Invoice ${payload.invoiceNumber} from ${payload.sender.name}`,
        text: this.generateEmailBody(payload),
        html: this.generateEmailHtml(payload),
        attachments,
      });

      this.logger.log(`Invoice ${payload.invoiceNumber} sent to ${payload.recipient.email}`);

      return {
        success: true,
        status: 'delivered',
        message: `Invoice sent to ${payload.recipient.email}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send invoice ${payload.invoiceNumber}:`, error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'EMAIL_SEND_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkStatus(_externalId: string): Promise<TransmissionStatus> {
    // Email transmission doesn't support real-time status tracking.
    // Status remains 'delivered' after successful send.
    // For actual delivery confirmation, consider using email tracking services
    // or webhooks from your email provider (SendGrid, Mailgun, etc.)
    return 'delivered';
  }

  async cancel(_externalId: string): Promise<boolean> {
    // Email cannot be recalled once sent
    return false;
  }

  private generateEmailBody(payload: TransmissionPayload): string {
    return `
Dear ${payload.recipient.name},

Please find attached invoice ${payload.invoiceNumber} from ${payload.sender.name}.

Invoice Details:
- Invoice Number: ${payload.invoiceNumber}
- From: ${payload.sender.name}

If you have any questions about this invoice, please contact us.

Best regards,
${payload.sender.name}
    `.trim();
  }

  private generateEmailHtml(payload: TransmissionPayload): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background: #f5f5f5; padding: 20px; margin-bottom: 20px; }
    .content { padding: 20px; }
    .invoice-details { background: #fafafa; padding: 15px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>Invoice ${payload.invoiceNumber}</h2>
  </div>
  <div class="content">
    <p>Dear ${payload.recipient.name},</p>
    <p>Please find attached invoice <strong>${payload.invoiceNumber}</strong> from <strong>${payload.sender.name}</strong>.</p>
    <div class="invoice-details">
      <h3>Invoice Details</h3>
      <ul>
        <li><strong>Invoice Number:</strong> ${payload.invoiceNumber}</li>
        <li><strong>From:</strong> ${payload.sender.name}</li>
      </ul>
    </div>
    <p>If you have any questions about this invoice, please contact us.</p>
    <p>Best regards,<br>${payload.sender.name}</p>
  </div>
</body>
</html>
    `.trim();
  }
}
