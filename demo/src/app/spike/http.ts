import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { delay, dematerialize, finalize, of, tap } from 'rxjs';
import { LookupLog } from './lookup-log';
import { Availability, FAILING, TAKEN } from './taken';

export const USERNAME_API = '/api/username';

const usernameOf = (urlWithParams: string) => new URL(urlWithParams, 'http://x').searchParams.get('u') ?? '';

/**
 * Pass-through interceptor that logs each username request. httpResource cancels by
 * unsubscribing, so a request torn down before its response shows up as `aborted`.
 */
export const logUsernameRequests: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(USERNAME_API)) return next(req);
  const log = inject(LookupLog);
  const username = usernameOf(req.urlWithParams);
  let settled = false;
  log.record('http', 'start', username);
  return next(req).pipe(
    tap({
      complete: () => ((settled = true), log.record('http', 'done', username)),
      error: () => ((settled = true), log.record('http', 'failed', username)),
    }),
    finalize(() => settled || log.record('http', 'aborted', username)),
  );
};

/** Tests only: answers the username API in-process, so specs need no server. */
export function fakeUsernameApi(latencyMs: number): HttpInterceptorFn {
  return (req, next) => {
    if (!req.url.startsWith(USERNAME_API)) return next(req);
    const username = usernameOf(req.urlWithParams);
    if (username === FAILING) {
      const error = new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable', url: req.urlWithParams });
      return of({ kind: 'E' as const, error }).pipe(delay(latencyMs), dematerialize());
    }
    const body: Availability = { available: !TAKEN.includes(username) };
    return of(new HttpResponse({ status: 200, body })).pipe(delay(latencyMs));
  };
}
