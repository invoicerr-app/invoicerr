import type { GithubRelease, GithubReleaseClientPort } from './github-release-client';

/**
 * `GITHUB_RELEASES_FAKE=1` (set only in `backend/.env.test`, the e2e backend's own env, never in
 * dev/prod) swaps this in for `RealGithubReleaseClient` — the exact same opt-in-escape-hatch shape
 * `VAT_VALIDATION_FAKE=1` already holds for `FakeSyntaxOnlyVatValidationClient`
 * (`modules/clients/clients.module.ts`'s own header is the precedent this mirrors).
 *
 * Cypress cannot intercept a call this backend makes to GitHub — there is no browser request to
 * stub — and "CI must never depend on the real GitHub API being reachable" (the same contract
 * `16-company-lookup.cy.ts` already states for VIES/INSEE) rules out actually calling it from a test
 * run. This is the seam that lets `82-version-check.cy.ts` observe the "update available" sidebar
 * badge through a REAL browser without either problem: network-free, deterministic, always reports
 * exactly one fake release.
 *
 * `v999.0.0` is chosen deliberately absurd — higher than any version this product will plausibly
 * ever publish — so "a newer version exists" holds regardless of what `getInstalledVersion()`
 * resolves to in the e2e stack (no `INVOICERR_REF_NAME` there, so the `package.json` fallback, today
 * "0.0.1"). Marked `prerelease: false` so it clears BOTH branches of `version.service.ts`'s own
 * stable/pre-release comparison policy, whichever one the running instance's current version lands
 * in.
 */
export class FakeGithubReleaseClient implements GithubReleaseClientPort {
  async fetchReleases(): Promise<GithubRelease[]> {
    return [
      {
        tagName: 'v999.0.0',
        htmlUrl: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v999.0.0',
        prerelease: false,
      },
    ];
  }
}
