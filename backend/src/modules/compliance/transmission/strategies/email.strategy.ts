import { Injectable } from '@nestjs/common';
import { MailService } from '@/mail/mail.service';
import { TransmissionPayload, TransmissionResult, TransmissionStrategy } from '../transmission.interface';

@Injectable()
export class EmailTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'email';

  constructor(private readonly mailService: MailService) {}

  supports(platform: string): boolean {
    return platform === 'email' || !platform;
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    try {
      await this.mailService.sendMail({
        to: payload.recipient.email,
        subject: `Invoice ${payload.invoiceNumber}`,
        text: `Please find attached invoice ${payload.invoiceNumber} from ${payload.sender.name}.`,
        attachments: [
          {
            filename: `invoice-${payload.invoiceNumber}.pdf`,
            content: payload.pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      return {
        success: true,
        message: `Invoice sent to ${payload.recipient.email}`,
      };
    } catch (error) {
      return {
        success: false,
        errorCode: 'EMAIL_SEND_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
