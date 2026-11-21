/** `PATCH /api/billing/seats/:userId` — a plain TypeScript interface, not a `class-validator` DTO:
 *  there is no `ValidationPipe` anywhere in this API (see `company.service.ts`/`clients.service.ts`'s
 *  own comments on why — decorators nothing ever interprets would be decoration, not validation), so
 *  the ACTUAL enforcement is, and stays, the explicit `Number.isInteger(seatIndex) && seatIndex >= 1`
 *  check `seats-view.ts#moveMemberSeat` already runs before touching Prisma. This interface exists so
 *  the request body has a name (the `@nestjs/swagger` CLI plugin, `nest-cli.json`, reads it straight
 *  off this type for `PATCH`'s Swagger schema) instead of the controller's previous unnamed inline
 *  object type, which documented nothing. */
export interface MoveSeatDto {
  seatIndex: number;
}
