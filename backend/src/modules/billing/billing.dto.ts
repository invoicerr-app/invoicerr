/** The company is resolved server-side via `@ActiveCompany()`, never taken from the client. */
export interface StartCheckoutDto {
  slug: 'monthly' | 'yearly';
  successUrl: string;
  returnUrl: string;
}

/** `null` or omitted clears the override back to the company's contact email. */
export interface SetBillingEmailDto {
  billingEmail?: string | null;
}

/** Plain interface, not a class-validator DTO: there is no `ValidationPipe`, so `moveMemberSeat`
 *  enforces the value itself. Named so the Swagger CLI plugin can document the body. */
export interface MoveSeatDto {
  seatIndex: number;
}
