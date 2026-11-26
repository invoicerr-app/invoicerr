import { OTP_WINDOW_MS } from './otp';

describe('signature OTP policy', () => {
  it("the OTP window is 5 minutes, down from the removed module's own 15", () => {
    expect(OTP_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
