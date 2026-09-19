/** `POST /api/billing/checkout` — matches one of the two `POLAR_PRODUCT_ID_MONTHLY`/`YEARLY` products
 *  (`checkout-session.ts#resolveCheckoutProductId`). No `referenceId`/company id here — the ACTIVE
 *  COMPANY is resolved server-side (`@ActiveCompany()`), never trusted from the client (option A,
 *  `checkout-session.ts`'s own header on why this differs from the removed better-auth checkout body). */
export interface StartCheckoutDto {
  slug: 'monthly' | 'yearly';
  successUrl: string;
  returnUrl: string;
}

/** `PUT /api/billing/billing-email` — see `billing-email.ts`'s own header. `null` (or omitted) clears
 *  the override back to "use the company's own contact email". */
export interface SetBillingEmailDto {
  billingEmail?: string | null;
}

/** `PATCH /api/billing/seats/:userId` — a plain TypeScript interface, not a `class-validator` DTO:
 *  there is no `ValidationPipe` anywhere in this API (see `company.service.ts`/`clients.service.ts`'s
 *  own comments on why — decorators nothing ever interprets would be decoration, not validation), so
 *  the ACTUAL enforcement is, and stays, the explicit `Number.isInteger(seatIndex) && seatIndex >= 1`
 *  check `seats-view.ts#moveMemberSeat` already runs before touching Prisma. This interface exists so
 *  the request body has a name (the `@nestjs/swagger` CLI plugin, `nest-cli.json`, reads it straight
 *  off this type for `PATCH`'s Swagger schema — the same mechanism `StartCheckoutDto`/
 *  `SetBillingEmailDto` above already rely on) instead of the controller's previous unnamed inline
 *  object type, which documented nothing. */
export interface MoveSeatDto {
  seatIndex: number;
}
