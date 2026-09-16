/**
 * `SeatsController` in isolation — `seats-view.ts` is mocked wholesale, its own coverage is
 * `seats-view.spec.ts`'s job. This file's own job is narrower: prove the controller actually
 * delegates to it with the right arguments, and — the point the `MoveSeatDto` addition could
 * otherwise paper over — that `moveSeat` still relies on `moveMemberSeat`'s own runtime check for a
 * `seatIndex` that isn't really a number, rather than trusting the (compile-time-only) DTO shape.
 * There is no `ValidationPipe`/class-validator anywhere in this API (`billing.dto.ts`'s own header on
 * `MoveSeatDto`), so nothing else stands between an untyped caller (curl, a stale client) and Prisma.
 */
import { BadRequestException } from '@nestjs/common';

import { MoveSeatDto } from './billing.dto';
import { getSeatsView, moveMemberSeat, SeatsView } from './seats-view';
import { SeatsController } from './seats.controller';

jest.mock('./seats-view');

const getSeatsViewMock = getSeatsView as jest.Mock;
const moveMemberSeatMock = moveMemberSeat as jest.Mock;

describe('SeatsController', () => {
  afterEach(() => jest.resetAllMocks());

  it('getSeats delegates to getSeatsView for the active company', async () => {
    const view: SeatsView = { seats: 2, members: [], waiting: [] };
    getSeatsViewMock.mockResolvedValue(view);
    const controller = new SeatsController();

    await expect(controller.getSeats('company-1')).resolves.toBe(view);
    expect(getSeatsViewMock).toHaveBeenCalledWith('company-1');
  });

  it('moveSeat delegates to moveMemberSeat with the companyId, target userId and the body seatIndex', async () => {
    const view: SeatsView = { seats: 2, members: [], waiting: [] };
    moveMemberSeatMock.mockResolvedValue(view);
    const controller = new SeatsController();

    await expect(controller.moveSeat('company-1', 'user-1', { seatIndex: 2 })).resolves.toBe(view);
    expect(moveMemberSeatMock).toHaveBeenCalledWith('company-1', 'user-1', 2);
  });

  it(
    "propagates moveMemberSeat's own rejection for a seatIndex that is not actually a number at " +
      'runtime — proving MoveSeatDto only documents the shape, it enforces nothing on its own',
    async () => {
      moveMemberSeatMock.mockRejectedValue(new BadRequestException('seatIndex must be a positive integer.'));
      const controller = new SeatsController();
      // Bypasses the DTO's compile-time-only guarantee — exactly what an untyped caller can send.
      const body = { seatIndex: '2' } as unknown as MoveSeatDto;

      await expect(controller.moveSeat('company-1', 'user-1', body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
});
