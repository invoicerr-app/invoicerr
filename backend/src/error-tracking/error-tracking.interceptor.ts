import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
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
export const UNTRACKED_PATH_PREFIXES: readonly string[] = [
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

function requestPath(context: ExecutionContext): string | undefined {
  if (typeof context?.getType !== 'function' || context.getType() !== 'http') return undefined;
  const request = context.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
  return request?.originalUrl ?? request?.url;
}

/**
 * The Express route template (`/api/clients/:id`), never the concrete URL: the template says which
 * endpoint failed without carrying which record. Undefined outside HTTP (a queue handler).
 */
export function routeTemplate(context: ExecutionContext): string | undefined {
  if (typeof context?.getType !== 'function' || context.getType() !== 'http') return undefined;
  const request = context.switchToHttp().getRequest<{ baseUrl?: string; route?: { path?: unknown } }>();
  const path = request?.route?.path;
  if (typeof path !== 'string') return undefined;
  return `${request.baseUrl ?? ''}${path}`;
}

@Injectable()
export class ErrorTrackingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const path = requestPath(context);
        if (shouldReport(error) && !(path && isUntrackedPath(path))) {
          captureServerError(error, { route: routeTemplate(context) });
        }
        return throwError(() => error);
      }),
    );
  }
}
