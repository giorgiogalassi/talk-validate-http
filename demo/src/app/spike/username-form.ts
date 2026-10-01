import { WritableSignal, signal } from '@angular/core';
import { form, minLength, required, schema } from '@angular/forms/signals';
import {
  viaValidateAsyncHttp,
  viaValidateAsyncOwnDebounce,
  viaValidateAsyncResource,
  viaValidateAsyncRxResource,
  viaValidateHttp,
} from './validators';

export interface Usernames {
  a: string;
  b: string;
  c: string;
  d: string;
  e: string;
}

export const VARIANTS = [
  { key: 'a', label: 'A · validateHttp()' },
  { key: 'b', label: 'B · validateAsync() + httpResource()' },
  { key: 'c', label: 'C · validateAsync() + resource() (Web Worker)' },
  { key: 'd', label: 'D · validateAsync() + rxResource() (Web Worker)' },
  { key: 'e', label: 'E · validateAsync() + resource() + own debounced() (Web Worker)' },
] as const;

/**
 * required() + minLength(3) run first: while a field is sync-invalid, validateAsync() reports its params
 * as undefined, so the resource goes idle and no lookup starts.
 */
export const usernameSchema = schema<Usernames>((p) => {
  for (const path of [p.a, p.b, p.c, p.d, p.e]) {
    required(path);
    minLength(path, 3);
  }
  viaValidateHttp(p.a);
  viaValidateAsyncHttp(p.b);
  viaValidateAsyncResource(p.c);
  viaValidateAsyncRxResource(p.d);
  viaValidateAsyncOwnDebounce(p.e);
});

/** Must be called in an injection context. */
export function createUsernameForm(model: WritableSignal<Usernames> = signal({ a: '', b: '', c: '', d: '', e: '' })) {
  return { model, form: form(model, usernameSchema) };
}
