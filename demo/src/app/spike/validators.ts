import { httpResource } from '@angular/common/http';
import { inject, resource } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SchemaPath, ValidationError, validateAsync, validateHttp } from '@angular/forms/signals';
import { Observable } from 'rxjs';
import { USERNAME_API } from './http';
import { Availability } from './taken';
import { USERNAME_LOOKUP } from './username-lookup';

/** Debounce shared by all variants (ms). Tests shorten it before building the form. */
export const DEBOUNCE = { ms: 300 };

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

/** B · validateHttp() rewritten by hand: validateAsync() + httpResource(). Same code as the framework's. */
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
 * C · same validateAsync() call, only the factory changed: a plain resource() whose loader
 * never touches the network. Two rules make the swap safe:
 *  1. read `params` only inside the resource's params (direct, wrapped, or via computed): with
 *     debounce on, reading it throws a chain() sentinel that only that evaluation catches, so a
 *     read from an effect or a template sees ResourceParamsStatus.LOADING instead of a value;
 *  2. the loader must honor `abortSignal`, because resource() can only signal, not stop the work.
 */
export function viaValidateAsyncResource(path: SchemaPath<string>): void {
  validateAsync(path, {
    params: ({ value }) => value(),
    debounce: DEBOUNCE.ms,
    factory: (params) => {
      const lookup = inject(USERNAME_LOOKUP);
      return resource({
        params,
        loader: ({ params: username, abortSignal }) => lookup(username, abortSignal),
      });
    },
    onSuccess: taken,
    onError: unreachable,
  });
}

/**
 * D · same again with rxResource(): the loader is an Observable, and cancellation is unsubscribe.
 * The teardown is where we turn "unsubscribed" back into an abort for the lookup.
 */
export function viaValidateAsyncRxResource(path: SchemaPath<string>): void {
  validateAsync(path, {
    params: ({ value }) => value(),
    debounce: DEBOUNCE.ms,
    factory: (params) => {
      const lookup = inject(USERNAME_LOOKUP);
      return rxResource({
        params,
        stream: ({ params: username }) =>
          new Observable<Availability>((subscriber) => {
            const controller = new AbortController();
            lookup(username, controller.signal).then(
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
