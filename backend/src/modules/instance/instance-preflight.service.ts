import { Injectable } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

export interface InstancePreflightView {
  companies: number;
  users: number;
  documents: number;
}

/**
 * `GET /instance/danger/preflight` — the one thing the reset screen needs before it even shows the
 * "RESET INSTANCE" flow: a quick, honest snapshot of how much is about to disappear. Deliberately
 * just three counts, never a full company/user listing — an instance operator on a real multi-tenant
 * deployment could be looking at hundreds of companies, and this route exists to answer "is this
 * really the right moment", never to browse tenant data an operator normally has no reason to see.
 *
 * This is ALSO the frontend's only signal that the whole feature exists on this deployment at all —
 * `InstanceOperatorGuard` sits in front of this route exactly like every other one on this
 * controller, so a non-200 here (404 in SaaS, 403 for anyone not on `INSTANCE_OPERATOR_EMAILS`) is
 * what makes `instance-reset.section.tsx` render nothing.
 */
@Injectable()
export class InstancePreflightService {
  async getPreflight(): Promise<InstancePreflightView> {
    const [companies, users, documents] = await Promise.all([
      prisma.company.count(),
      prisma.user.count(),
      prisma.documentInstance.count(),
    ]);
    return { companies, users, documents };
  }
}
