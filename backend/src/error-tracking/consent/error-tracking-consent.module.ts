import { Module } from '@nestjs/common';

import { ErrorTrackingConsentController } from './error-tracking-consent.controller';
import { ErrorTrackingConsentService } from './error-tracking-consent.service';

/**
 * Always imported: the route answers `available: false` on an instance without browser error
 * tracking, so the frontend has one place to ask whether there is anything to decide.
 */
@Module({
  controllers: [ErrorTrackingConsentController],
  providers: [ErrorTrackingConsentService],
})
export class ErrorTrackingConsentModule {}
