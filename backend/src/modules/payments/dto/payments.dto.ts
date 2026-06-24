import { ApiProperty } from '@nestjs/swagger';

export class PaymentItem {
    @ApiProperty({ description: 'ID of the invoice item this payment applies to' })
    invoiceItemId: string;

    @ApiProperty({ description: 'Amount paid for this item (can be partial payment)' })
    amountPaid: number | string;
}

export class CreatePaymentDto {
    @ApiProperty({ description: 'ID of the invoice this payment is for' })
    invoiceId: string;

    @ApiProperty({ description: 'List of items being paid, with amounts allocated', type: [PaymentItem] })
    items: PaymentItem[];

    @ApiProperty({ description: 'ID of the payment method used', required: false })
    paymentMethodId?: string;

    @ApiProperty({ description: 'Name of the payment method (if not using a saved method)', required: false })
    paymentMethod?: string;

    @ApiProperty({ description: 'Additional payment details or reference', required: false })
    paymentDetails?: string;
}

export class EditPaymentDto extends CreatePaymentDto {
    @ApiProperty({ description: 'ID of the payment to update' })
    id: string;
}
