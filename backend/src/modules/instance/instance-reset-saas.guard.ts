import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

import { isBillingEnabled } from '@/modules/billing/billing-flag';

/**
 * Masks the ENTIRE instance-reset surface (`InstanceController`) on SaaS — a 404, not a 403. Owner
 * decision: this whole surface must look like it does not exist to a hosted customer, never merely
 * "exists but you can't touch it" (a 403 would itself leak that instance-wide reset is a capability of
 * this product at all).
 *
 * Deliberately its OWN guard, separate from `InstanceOperatorGuard` — that one is shared with `GET
 * /api/backup/status`, which must keep answering for a real operator EVEN on SaaS (the hosted-billing
 * operator still runs their own instance and still needs to see its backup status); only the reset
 * flow itself is an owner decision to hide outright. Stacked in FRONT of `InstanceOperatorGuard` on
 * `InstanceController` (`@UseGuards(InstanceResetSaasGuard, InstanceOperatorGuard)`) so the 404 wins
 * before the operator check ever runs — a hosted customer probing this route learns nothing about
 * whether they happen to be on an allowlist that, on this deployment, does not even apply.
 */
@Injectable()
export class InstanceResetSaasGuard implements CanActivate {
  canActivate(): boolean {
    if (isBillingEnabled()) {
      throw new NotFoundException();
    }
    return true;
  }
}
