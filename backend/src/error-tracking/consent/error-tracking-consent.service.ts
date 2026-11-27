import { Injectable } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import {
  ERROR_TRACKING_CONSENT_TEXT_VERSION,
  type ErrorTrackingConsentChannel,
  type ErrorTrackingConsentView,
  type StoredConsentDecision,
  buildConsentView,
  decisionFor,
} from './consent-policy';

const STORED_DECISION_SELECT = { decision: true, textVersion: true, decidedAt: true } as const;

@Injectable()
export class ErrorTrackingConsentService {
  async getView(userId: string, now: Date = new Date()): Promise<ErrorTrackingConsentView> {
    return buildConsentView(await this.latestDecision(userId), now);
  }

  /**
   * Appends the decision; rows are never updated or deleted here. A "no" that follows a grant is
   * stored as `withdrawn`, so the withdrawal date is that row's `decidedAt`.
   */
  async decide(
    userId: string,
    granted: boolean,
    channel: ErrorTrackingConsentChannel,
    now: Date = new Date(),
  ): Promise<ErrorTrackingConsentView> {
    const latest = await this.latestDecision(userId);
    const decision = decisionFor(granted, latest);
    const created = await prisma.errorTrackingConsent.create({
      data: { userId, decision, channel, textVersion: ERROR_TRACKING_CONSENT_TEXT_VERSION, decidedAt: now },
      select: STORED_DECISION_SELECT,
    });
    return buildConsentView(created, now);
  }

  private async latestDecision(userId: string): Promise<StoredConsentDecision | null> {
    return prisma.errorTrackingConsent.findFirst({
      where: { userId },
      orderBy: { decidedAt: 'desc' },
      select: STORED_DECISION_SELECT,
    });
  }
}
