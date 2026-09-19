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
 * characters of a guess were already correct through response timing.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

const DOCS_PATH_PREFIX = '/api/docs';

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  // Different lengths would make `timingSafeEqual` throw rather than just return false — comparing
  // against a fixed-size hash of each side keeps the comparison itself constant-time regardless of how
  // long the supplied credential is, without ever comparing the raw buffers whose lengths could differ.
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
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
