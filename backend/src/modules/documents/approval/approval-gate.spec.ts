/**
 * The REAL decision code — only the Prisma CLIENT is mocked (same discipline
 * country-policy/country-policy.spec.ts already established, itself citing the project's own past
 * false-green history on mocking the exact piece a spec claims to verify): `requiresApproval` needs
 * no I/O at all and is exercised completely un-mocked below; `resolveApprovalThresholdMinor` is the
 * one bit of I/O this module has, proven against a mocked `prisma.company.findUnique` rather than a
 * re-implemented fake. `documents.service.approval.spec.ts` is the sibling file that proves
 * `runAction` actually WIRES this in — it mocks this module wholesale (except this file's own
 * `requiresApproval`, kept real via `jest.requireActual`) and is honest about only proving the
 * CALLER's composition, not re-testing the rule itself.
 */
import prisma from '@/prisma/prisma.service';

import { requiresApproval, resolveApprovalThresholdMinor } from './approval-gate';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: jest.fn() } },
}));

const findCompany = prisma.company.findUnique as jest.Mock;

describe('requiresApproval', () => {
  it('never gates when the company has no threshold configured (NULL) — any role, any amount', () => {
    expect(requiresApproval('MEMBER', 1_000_000, null)).toBe(false);
    expect(requiresApproval('MEMBER', 1_000_000, undefined)).toBe(false);
    expect(requiresApproval('OWNER', 1_000_000, null)).toBe(false);
  });

  it('never gates a caller with no role at all — the worker replaying an already-approved send, or any other internal/API-key caller', () => {
    expect(requiresApproval(undefined, 1_000_000, 100)).toBe(false);
  });

  it('never gates OWNER or ADMIN — a higher role sending it past the threshold IS the approval', () => {
    expect(requiresApproval('OWNER', 1_000_000, 100)).toBe(false);
    expect(requiresApproval('ADMIN', 1_000_000, 100)).toBe(false);
  });

  it('gates a MEMBER strictly above the threshold', () => {
    expect(requiresApproval('MEMBER', 101, 100)).toBe(true);
  });

  it('does NOT gate a MEMBER exactly at the threshold — the boundary a company chose to allow', () => {
    expect(requiresApproval('MEMBER', 100, 100)).toBe(false);
  });

  it('does not gate a MEMBER strictly under the threshold', () => {
    expect(requiresApproval('MEMBER', 99, 100)).toBe(false);
  });

  it('never gates a document type with no computable gross (grossMinor 0)', () => {
    expect(requiresApproval('MEMBER', 0, 100)).toBe(false);
  });
});

describe('resolveApprovalThresholdMinor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the configured threshold', async () => {
    findCompany.mockResolvedValue({ approvalThresholdMinor: 500_00 });
    await expect(resolveApprovalThresholdMinor('company-1')).resolves.toBe(50_000);
    expect(findCompany).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      select: { approvalThresholdMinor: true },
    });
  });

  it('returns null when the company never configured one — the default, and the common case', async () => {
    findCompany.mockResolvedValue({ approvalThresholdMinor: null });
    await expect(resolveApprovalThresholdMinor('company-1')).resolves.toBeNull();
  });

  it('returns null rather than throwing if the company row itself cannot be found', async () => {
    findCompany.mockResolvedValue(null);
    await expect(resolveApprovalThresholdMinor('company-1')).resolves.toBeNull();
  });
});
