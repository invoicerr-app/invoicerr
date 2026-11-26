import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { routeTemplateOf } from '../observability/route-template';
import { captureServerError } from './error-tracking';

/**
 * Reports what reaches the client as a 5xx: anything that is not an `HttpException`, and an
 * `HttpException` with a 5xx status. 4xx answers are the API working as intended and stay out of the
 * tracker, and so does anything under `UNTRACKED_PATH_PREFIXES`. The error is rethrown untouched, so Nest still builds the same response.
 */
export function shouldReport(error: unknown): boolean {
  if (error instanceof HttpException) return error.getStatus() >= 500;
  return true;
}

/**
 * Path prefixes never reported, whatever fails there: they serve people outside the account (a client
 * on the portal, a signer or a reader on a public link) or people not signed in yet (sign-in, legal
 * pages). Those people never agreed to anything, and the URL itself carries their access token.
 * Machine callbacks under `/api/public/` (payment and e-invoicing network webhooks) stay reported:
 * nobody is behind them.
 */
const UNTRACKED_PATH_PREFIXES: readonly string[] = [
  '/api/portal',
  '/api/public/signatures',
  '/api/public/documents',
  '/api/auth',
  '/api/legal',
];

export function isUntrackedPath(path: string): boolean {
  const cut = path.search(/[?#]/);
  const bare = (cut === -1 ? path : path.slice(0, cut)).toLowerCase();
  // `/api/auth` also covers `/api/auth-extended`: both are sign-in flows.
  return UNTRACKED_PATH_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(prefix));
}

type HttpRequest = { originalUrl?: string; url?: string; baseUrl?: string; route?: { path?: unknown } };

/** The HTTP request behind the context; undefined outside HTTP (a queue handler). */
function httpRequest(context: ExecutionContext): HttpRequest | undefined {
  if (typeof context?.getType !== 'function' || context.getType() !== 'http') return undefined;
  return context.switchToHttp().getRequest<HttpRequest>();
}

@Injectable()
export class ErrorTrackingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const request = httpRequest(context);
        const path = request?.originalUrl ?? request?.url;
        if (shouldReport(error) && !(path && isUntrackedPath(path))) {
          captureServerError(error, { route: routeTemplateOf(request) });
        }
        return throwError(() => error);
      }),
    );
  }
}
