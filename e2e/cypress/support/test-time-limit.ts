// Cypress has no per-test timeout: every command is bounded, but a test of many bounded commands
// (each waiting out its own timeout against a stalled stack) can run for minutes before failing.
// The limit is checked at each command, so a stuck test fails with a clear message at the next one.
const TEST_TIME_LIMIT_MS = 180_000;

let testStartedAt = 0;

beforeEach(() => {
    testStartedAt = Date.now();
});

Cypress.on('command:start', () => {
    if (testStartedAt === 0) return;
    const elapsed = Date.now() - testStartedAt;
    if (elapsed > TEST_TIME_LIMIT_MS) {
        testStartedAt = 0;
        throw new Error(`Test exceeded its ${TEST_TIME_LIMIT_MS / 1000}s time limit (${Math.round(elapsed / 1000)}s elapsed)`);
    }
});
