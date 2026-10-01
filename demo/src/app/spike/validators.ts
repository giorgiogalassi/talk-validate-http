import { httpResource } from '@angular/common/http';
import { debounced, inject, resource } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SchemaPath, ValidationError, validateAsync, validateHttp } from '@angular/forms/signals';
import { Observable } from 'rxjs';
import { USERNAME_API } from './http';
import { Availability } from './taken';
import { UsernameWorker } from './username-lookup';

/**
 * Debounce shared by all variants (ms). `undefined` = no debounce: validateAsync() only wraps
 * params in debounced() when the option is set. `?debounce=0` turns it off for the cancellation
 * demo, so every superseding keystroke aborts the lookup in flight. Tests set it per form.
 */
export const DEBOUNCE: { ms: number | undefined } = { ms: debounceFromUrl() };

function debounceFromUrl(): number | undefined {
  const ms = Number(new URLSearchParams(globalThis.location?.search).get('debounce') ?? 300);
  return ms > 0 ? ms : undefined;
}

const taken = (result: Availability | undefined): ValidationError | undefined =>
  result?.available === false ? { kind: 'taken', message: 'Username is taken' } : undefined;

const unreachable = (): ValidationError => ({ kind: 'unreachable', message: 'Could not check username' });

const usernameUrl = (value: string) => `${USERNAME_API}?u=${encodeURIComponent(value)}`;

/** A · the public convenience API, as shipped. */
export function viaValidateHttp(path: SchemaPath<string>): void {
  validateHttp(path, {
    request: ({ value }) => usernameUrl(value()),
    debounce: DEBOUNCE.ms,
    onSuccess: (result: Availability) => taken(result),
    onError: unreachable,
  });
}

/**
 * B · validateHttp() rewritten by hand: validateAsync() + httpResource(). Same code as the framework's.
 * The primitive is httpResource(); everything else in this call is policy.
 */
export function viaValidateAsyncHttp(path: SchemaPath<string>): void {
  validateAsync(path, {
    params: ({ value }) => usernameUrl(value()),
    debounce: DEBOUNCE.ms,
    factory: (request) => httpResource<Availability>(request),
    onSuccess: taken,
    onError: unreachable,
  });
}

/**
 * C · same validateAsync() call, same policy; only the primitive changed: a hand-rolled resource()
 * whose loader posts to a Web Worker. Two rules make the swap behave identically:
 *  1. read `params` only inside a resource's params evaluation (here: passed as is). With debounce
 *     on, reading it anywhere else (an effect, a template) throws ResourceParamsStatus.LOADING,
 *     a sentinel only a params evaluation turns into a status;
 *  2. the loader must honour `abortSignal` itself: resource() aborts it, UsernameWorker.check()
 *     turns that into a `cancel` message so the work in the Worker actually stops.
 */
export function viaValidateAsyncResource(path: SchemaPath<string>): void {
  validateAsync(path, {
    params: ({ value }) => value(),
    debounce: DEBOUNCE.ms,
    factory: (params) => {
      const worker = inject(UsernameWorker);
      return resource({
        params, // rule 1
        loader: ({ params: username, abortSignal }) => worker.check(username, abortSignal), // rule 2
      });
    },
    onSuccess: taken,
    onError: unreachable,
  });
}

/**
 * D · same again with rxResource(): the loader is an Observable, and cancellation is unsubscribe.
 * The teardown is where we turn "unsubscribed" back into an abort for the Worker.
 */
export function viaValidateAsyncRxResource(path: SchemaPath<string>): void {
  validateAsync(path, {
    params: ({ value }) => value(),
    debounce: DEBOUNCE.ms,
    factory: (params) => {
      const worker = inject(UsernameWorker);
      return rxResource({
        params,
        stream: ({ params: username }) =>
          new Observable<Availability>((subscriber) => {
            const controller = new AbortController();
            worker.check(username, controller.signal).then(
              (result) => (subscriber.next(result), subscriber.complete()),
              (error) => controller.signal.aborted || subscriber.error(error),
            );
            return () => controller.abort();
          }),
      });
    },
    onSuccess: taken,
    onError: unreachable,
  });
}

/**
 * E · a custom validator that debounces the same way validateAsync() does, with public API only:
 * no `debounce` option; the factory composes debounced() (exported from @angular/core, but
 * `@experimental 22.0`) and chains it into the resource's params with `ctx.chain(resource)`
 * (ResourceParamsContext.chain: there is no standalone chain() export).
 * debounced() evaluates its source as a params function too, so rule 1 still holds.
 */
export function viaValidateAsyncOwnDebounce(path: SchemaPath<string>): void {
  validateAsync(path, {
    params: ({ value }) => value(),
    factory: (params) => {
      const worker = inject(UsernameWorker);
      const settled = debounced(params, DEBOUNCE.ms ?? 0);
      return resource({
        params: (ctx) => ctx.chain(settled), // throws 'loading' while debouncing → status 'loading'
        loader: ({ params: username, abortSignal }) => worker.check(username, abortSignal),
      });
    },
    onSuccess: taken,
    onError: unreachable,
  });
}
