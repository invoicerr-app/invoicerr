/**
 * `SwaggerModule.setup()` (`main.ts`) mounts its routes directly on the underlying Express instance,
 * bypassing Nest's own router entirely — none of the three global `APP_GUARD`s (`AuthGuard`,
 * `RolesGuard`, `ThrottlerGuard`) ever see a request for `/api/docs` or `/api/docs-json`, the same
 * "middleware answers before Nest's router ever runs" shape `/api/auth/*` has (see
 * `lib/auth-rate-limit.ts`'s own header). Left fully open, an anonymous visitor gets the complete
 * route map, every DTO shape, every parameter name for this API — reconnaissance that makes every
 * other route in the product easier to probe.
 *
 * `main.ts` mounts Swagger at all only outside `NODE_ENV=production` by default. A production
 * deployment that wants it anyway sets BOTH `SWAGGER_BASIC_AUTH_USER` and
 * `SWAGGER_BASIC_AUTH_PASSWORD`, which gates every `/api/docs*` path (the UI, the JSON/YAML export,
 * and whatever static assets the UI itself loads under that prefix) behind HTTP Basic Auth.
 *
 * A hand-rolled check rather than a dependency (`express-basic-auth` et al.) for the same reason this
 * codebase writes its own OTP/token comparisons: `crypto.timingSafeEqual`, never `===`, on the
 * supplied credentials — a length-dependent short-circuit on `===` would leak how many leading
 * characters of a guess were already correct through response timing. See `constantTimeEquals` below
 * for why the comparison runs over a hash of each side rather than over the credentials themselves.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DOCS_PATH_PREFIX = '/api/docs';

/**
 * Per-process, per-boot HMAC key, never configured and never persisted — it exists only so that the
 * digests compared below are unpredictable to whoever is doing the guessing. Without it the pair
 * being compared would be two plain SHA-256s, one of which the attacker can compute himself for any
 * guess he makes; with it, neither side of the comparison is a value he can work backwards from, so
 * the only thing his guess can learn is the one bit the middleware already returns him.
 */
const COMPARISON_KEY = randomBytes(32);

/**
 * Equality that does not leak the SHAPE of the secret it is comparing against.
 *
 * `timingSafeEqual` refuses two buffers of different lengths (it throws), so a caller has to deal
 * with unequal lengths somehow — and returning early on that check is the thing to avoid here,
 * because the length of a credential is a fact about the credential. A guess shorter or longer than
 * `SWAGGER_BASIC_AUTH_PASSWORD` would come back measurably sooner than one of exactly the right
 * length, which hands an attacker the password's length for free and collapses the space he has to
 * search.
 *
 * So each side is reduced to a fixed-size HMAC first, and the comparison is on the two 32-byte
 * digests — always the same size, whatever was supplied, so `timingSafeEqual` always runs and always
 * over the same number of bytes. Hashing before comparing is the standard shape for this (the
 * "double HMAC" comparison) precisely because it makes the length question disappear rather than
 * having to be answered.
 *
 * Both arguments are secrets here, which is why this is worth the two extra hashes: the middleware
 * below compares the supplied username against `SWAGGER_BASIC_AUTH_USER` and the supplied password
 * against `SWAGGER_BASIC_AUTH_PASSWORD`, the credential pair standing between an anonymous visitor
 * and the complete route map of this API.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const digest = (value: string): Buffer =>
    createHmac('sha256', COMPARISON_KEY).update(value, 'utf-8').digest();

  return timingSafeEqual(digest(a), digest(b));
}

/** Parses a `Authorization: Basic base64(user:password)` header. `null` for anything malformed —
 *  callers treat that identically to a wrong credential (no distinct error, see this file's own
 *  discipline elsewhere in this codebase for not telling an attacker which half of their guess was
 *  shaped correctly). */
function parseBasicAuthHeader(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) return null;
  return { username: decoded.slice(0, separatorIndex), password: decoded.slice(separatorIndex + 1) };
}

/** `true` for `/api/docs` itself and everything nested under it, INCLUDING sibling export routes like
 *  `/api/docs-json`/`/api/docs-yaml` that do not share a `/` with the base path — unlike
 *  `body-parser-auth-skip.ts#isUnderBasePath`'s segment-boundary rule, this is a deliberate plain
 *  prefix match: those two exports carry the exact same route map this guard exists to hide, so they
 *  must be covered too, and being over-inclusive on a hypothetical unrelated `/api/docs-legacy` route
 *  costs nothing (it does not exist) where being under-inclusive on a real export route would. */
function isUnderDocsPath(path: string): boolean {
  return path.startsWith(DOCS_PATH_PREFIX);
}

export function createSwaggerBasicAuthMiddleware(username: string, password: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isUnderDocsPath(req.path)) {
      next();
      return;
    }

    const supplied = parseBasicAuthHeader(req.headers.authorization);
    if (
      supplied &&
      constantTimeEquals(supplied.username, username) &&
      constantTimeEquals(supplied.password, password)
    ) {
      next();
      return;
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Invoicerr API docs"');
    res.status(401).send('Authentication required.');
  };
}
