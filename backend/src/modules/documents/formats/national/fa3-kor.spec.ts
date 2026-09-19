/**
 * fa3-kor.ts — proves the KSeF-number BRANCH the statute's own exception (art. 106j ust. 2 pkt 2a)
 * requires: a corrected invoice genuinely sent through KSeF must have an OBSERVED, CLEARED ksefNumber
 * before a KOR can be built (refuse otherwise — never a silent `NrKSeFN` lie), while a corrected
 * invoice sent through any OTHER channel (or never sent at all through one this codebase can report a
 * `channelProviderId` for) falls back to `NrKSeFN` outright — no number to wait for, per the statute's
 * own exception. `../../persistence` and `../../conformity/authority-events.persistence` are mocked
 * wholesale, the same `vi.mock('../persistence')` discipline `conformity-sweep-runner.spec.ts`
 * already holds — this proves the BRANCHING logic, never a real database round-trip.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import * as authorityEventsPersistence from '../../conformity/authority-events.persistence';
import * as persistence from '../../persistence';
import { resolveFaVatKorContext } from './fa3-kor';

vi.mock('../../persistence');
vi.mock('../../conformity/authority-events.persistence');

const findOwnedDocument = persistence.findOwnedDocument as Mock;
const listAuthorityEvents = authorityEventsPersistence.listAuthorityEvents as Mock;

// A structurally valid `TNumerKSeF` (schemat_FA3.xsd's own pattern) — NIP-YYYYMMDD-XXXXXX-XXXXXX-XX.
const VALID_KSEF_NUMBER = '5260001246-20260901-010203-040506-AB';

describe('fa3-kor — resolveFaVatKorContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('a KSeF-sent original with an observed, non-empty ksefNumber: the NrKSeF branch', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-1',
      displayNumber: 'FA-2026-0001',
      channelProviderId: 'ksef',
      data: { issueDate: '2026-09-01T00:00:00.000Z' },
    });
    listAuthorityEvents.mockResolvedValue([
      { providerId: 'ksef', rawPayload: { ksefNumber: VALID_KSEF_NUMBER }, observedAt: new Date() },
    ]);

    const ctx = await resolveFaVatKorContext('company-1', 'orig-1');
    expect(ctx).toEqual({
      originalDisplayNumber: 'FA-2026-0001',
      originalIssueDate: '2026-09-01',
      originalKsefNumber: VALID_KSEF_NUMBER,
    });
    expect(findOwnedDocument).toHaveBeenCalledWith('company-1', 'invoice', 'orig-1');
  });

  it('an original never sent through KSeF (a different channelProviderId): falls back to NrKSeFN, no number to wait for — never calls the events store', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-2',
      displayNumber: 'FA-2026-0002',
      channelProviderId: 'email',
      data: { issueDate: '2026-09-02' },
    });

    const ctx = await resolveFaVatKorContext('company-1', 'orig-2');
    expect(ctx.originalKsefNumber).toBeUndefined();
    expect(ctx.originalDisplayNumber).toBe('FA-2026-0002');
    expect(listAuthorityEvents).not.toHaveBeenCalled();
  });

  it('an original never sent through any transport at all (channelProviderId null): same fallback', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-2b',
      displayNumber: 'FA-2026-0002B',
      channelProviderId: null,
      data: { issueDate: '2026-09-02' },
    });

    const ctx = await resolveFaVatKorContext('company-1', 'orig-2b');
    expect(ctx.originalKsefNumber).toBeUndefined();
  });

  it('sent through KSeF but no CLEARED ksefNumber observed yet: refuses, naming clearance — never a silent NrKSeFN for an invoice that WAS submitted to KSeF', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-3',
      displayNumber: 'FA-2026-0003',
      channelProviderId: 'ksef',
      data: { issueDate: '2026-09-03' },
    });
    listAuthorityEvents.mockResolvedValue([
      { providerId: 'ksef', rawPayload: { ksefNumber: null }, observedAt: new Date() },
    ]);

    await expect(resolveFaVatKorContext('company-1', 'orig-3')).rejects.toThrow(BadRequestException);
    await expect(resolveFaVatKorContext('company-1', 'orig-3')).rejects.toThrow(/CLEARED/);
  });

  it('sent through KSeF with no authority events journaled at all yet: same refusal', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-3b',
      displayNumber: 'FA-2026-0003B',
      channelProviderId: 'ksef',
      data: { issueDate: '2026-09-03' },
    });
    listAuthorityEvents.mockResolvedValue([]);

    await expect(resolveFaVatKorContext('company-1', 'orig-3b')).rejects.toThrow(BadRequestException);
  });

  it('picks the first non-empty ksefNumber among multiple journaled events (most-recent-first, per listAuthorityEvents own ordering)', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-5',
      displayNumber: 'FA-2026-0005',
      channelProviderId: 'ksef',
      data: { issueDate: '2026-09-05' },
    });
    listAuthorityEvents.mockResolvedValue([
      { providerId: 'ksef', rawPayload: { ksefNumber: null }, observedAt: new Date('2026-09-06') },
      {
        providerId: 'ksef',
        rawPayload: { ksefNumber: VALID_KSEF_NUMBER },
        observedAt: new Date('2026-09-05'),
      },
    ]);

    const ctx = await resolveFaVatKorContext('company-1', 'orig-5');
    expect(ctx.originalKsefNumber).toBe(VALID_KSEF_NUMBER);
  });

  it('ignores a non-"ksef" event even when channelProviderId is "ksef" (defensive — never trusts another provider\'s payload shape)', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-6',
      displayNumber: 'FA-2026-0006',
      channelProviderId: 'ksef',
      data: { issueDate: '2026-09-06' },
    });
    listAuthorityEvents.mockResolvedValue([
      { providerId: 'pdp', rawPayload: { ksefNumber: 'not-really-a-ksef-number' }, observedAt: new Date() },
    ]);

    await expect(resolveFaVatKorContext('company-1', 'orig-6')).rejects.toThrow(BadRequestException);
  });

  it('an original with no displayNumber/issueDate yet: refuses — "must be ISSUED before it can be corrected"', async () => {
    findOwnedDocument.mockResolvedValue({
      id: 'orig-7',
      displayNumber: null,
      channelProviderId: null,
      data: {},
    });

    await expect(resolveFaVatKorContext('company-1', 'orig-7')).rejects.toThrow(/ISSUED/);
  });

  it("propagates a dangling reference as a 404 (findOwnedDocument's own contract), never swallowed", async () => {
    findOwnedDocument.mockRejectedValue(
      new NotFoundException('Document "orig-8" not found for type "invoice".'),
    );

    await expect(resolveFaVatKorContext('company-1', 'orig-8')).rejects.toThrow(NotFoundException);
  });
});
