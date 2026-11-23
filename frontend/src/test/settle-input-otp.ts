import { cleanup } from "@testing-library/react"

/**
 * input-otp re-syncs its caret on 0, 10 and 50 ms timers it never clears on unmount. Fired after the
 * file's jsdom environment is torn down, their state update throws "window is not defined" and fails
 * the run. Unmount, then let those timers fire while jsdom is still alive.
 */
export async function settleInputOtpTimers() {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 60))
}
