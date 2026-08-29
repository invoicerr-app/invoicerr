import { Controller, Get, Query } from '@nestjs/common';
import { StateMachinePreviewResponse, StateMachinePreviewService } from './state-machine-preview.service';

/**
 * Backs the `/dev/state-machine` frontend page: pick a supplier/buyer country pair, a document
 * kind, a buyer role and a date, and see exactly what the compliance engine's `resolve()` +
 * `assembleFromPlan()` produce for it. Read-only — no invoice, no company, no database write.
 *
 * Deliberately under normal session auth (no `@Public()`), unlike its onboarding-facing siblings in
 * `required-fields.controller.ts`: those must be reachable before a session exists (onboarding),
 * this is an internal diagnostic tool with no such constraint.
 */
@Controller('compliance')
export class StateMachinePreviewController {
  constructor(private readonly preview: StateMachinePreviewService) {}

  /** Country codes that have a real (non-fallback) compliance profile — for the page's selectors. */
  @Get('countries')
  getCountries(): { countries: string[] } {
    return { countries: this.preview.countries() };
  }

  @Get('state-machine-preview')
  getPreview(
    @Query('supplierCountry') supplierCountry: string,
    @Query('buyerCountry') buyerCountry: string,
    @Query('buyerRole') buyerRole: string,
    @Query('documentKind') documentKind?: string,
    @Query('issueDate') issueDate?: string,
    @Query('supplyType') supplyType?: string,
  ): StateMachinePreviewResponse {
    return this.preview.preview({
      supplierCountry,
      buyerCountry,
      buyerRole,
      documentKind,
      issueDate,
      supplyType,
    });
  }
}
