import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { memberHoldsSeat, seatHolders } from './seat-holders';

function member(userId: string, role: CompanyRole, createdAt: string) {
  return { userId, role, createdAt: new Date(createdAt) };
}

describe('seatHolders', () => {
  it('seats everyone when capacity covers the whole company', () => {
    const members = [
      member('owner', CompanyRole.OWNER, '2026-01-01'),
      member('m1', CompanyRole.MEMBER, '2026-01-02'),
      member('m2', CompanyRole.MEMBER, '2026-01-03'),
    ];

    const { seated, waiting } = seatHolders(members, 5);

    expect(seated.map((m) => m.userId)).toEqual(['owner', 'm1', 'm2']);
    expect(waiting).toEqual([]);
  });

  it('the OWNER always holds a seat, even past capacity', () => {
    const members = [
      member('owner', CompanyRole.OWNER, '2026-01-01'),
      member('m1', CompanyRole.MEMBER, '2026-01-02'),
    ];

    const { seated, waiting } = seatHolders(members, 0);

    expect(seated.map((m) => m.userId)).toEqual(['owner']);
    expect(waiting.map((m) => m.userId)).toEqual(['m1']);
  });

  it('non-owners keep their seat in ARRIVAL order — the earliest joiners fill capacity first', () => {
    const members = [
      member('owner', CompanyRole.OWNER, '2026-01-01'),
      member('late', CompanyRole.MEMBER, '2026-01-05'),
      member('early', CompanyRole.MEMBER, '2026-01-02'),
      member('mid', CompanyRole.MEMBER, '2026-01-03'),
    ];

    const { seated, waiting } = seatHolders(members, 3);

    expect(seated.map((m) => m.userId)).toEqual(['owner', 'early', 'mid']);
    expect(waiting.map((m) => m.userId)).toEqual(['late']);
  });

  it('waiting is returned most-recently-arrived first', () => {
    const members = [
      member('owner', CompanyRole.OWNER, '2026-01-01'),
      member('a', CompanyRole.MEMBER, '2026-01-02'),
      member('b', CompanyRole.MEMBER, '2026-01-03'),
      member('c', CompanyRole.MEMBER, '2026-01-04'),
    ];

    const { waiting } = seatHolders(members, 1);

    expect(waiting.map((m) => m.userId)).toEqual(['c', 'b', 'a']);
  });

  it('ADMIN and MEMBER compete for the same capacity — role beyond OWNER does not protect a seat', () => {
    const members = [
      member('owner', CompanyRole.OWNER, '2026-01-01'),
      member('admin', CompanyRole.ADMIN, '2026-01-03'),
      member('member', CompanyRole.MEMBER, '2026-01-02'),
    ];

    const { seated, waiting } = seatHolders(members, 2);

    expect(seated.map((m) => m.userId)).toEqual(['owner', 'member']);
    expect(waiting.map((m) => m.userId)).toEqual(['admin']);
  });

  it('ignores seatIndex entirely — not part of SeatMember, so it cannot influence the split', () => {
    const members = [
      { ...member('owner', CompanyRole.OWNER, '2026-01-01'), seatIndex: 99 },
      { ...member('m1', CompanyRole.MEMBER, '2026-01-02'), seatIndex: null },
    ];

    const { seated } = seatHolders(members, 2);

    expect(seated.map((m) => m.userId)).toEqual(['owner', 'm1']);
  });
});

describe('memberHoldsSeat', () => {
  const members = [
    member('owner', CompanyRole.OWNER, '2026-01-01'),
    member('early', CompanyRole.MEMBER, '2026-01-02'),
    member('late', CompanyRole.MEMBER, '2026-01-03'),
  ];

  it('true for a seated member', () => {
    expect(memberHoldsSeat(members, 2, 'early')).toBe(true);
  });

  it('false for a member past capacity', () => {
    expect(memberHoldsSeat(members, 2, 'late')).toBe(false);
  });

  it('true for the OWNER regardless of capacity', () => {
    expect(memberHoldsSeat(members, 0, 'owner')).toBe(true);
  });
});
