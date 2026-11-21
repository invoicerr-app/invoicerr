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
 * tracker. The error is rethrown untouched, so Nest still builds the same response.
 */
export function shouldReport(error: unknown): boolean {
  if (error instanceof HttpException) return error.getStatus() >= 500;
  return true;
}

@Injectable()
export class ErrorTrackingInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (shouldReport(error)) captureServerError(error);
        return throwError(() => error);
      }),
    );
  }
}
