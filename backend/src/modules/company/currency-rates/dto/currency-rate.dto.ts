export class CreateCurrencyRateDto {
  from: string;
  to: string;
  rate: number;
  /** ISO date-time string; defaults to "now" when omitted (see the controller). */
  asOf?: string;
}
