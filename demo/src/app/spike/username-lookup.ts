import { InjectionToken, inject } from '@angular/core';
import { LookupLog } from './lookup-log';
import { Availability, TAKEN } from './taken';

/** Any async username check. Must honor `abortSignal`: resource() only signals, it can't stop the work. */
export type UsernameLookup = (username: string, abortSignal: AbortSignal) => Promise<Availability>;

export const USERNAME_LOOKUP = new InjectionToken<UsernameLookup>('USERNAME_LOOKUP', {
  providedIn: 'root',
  factory: workerLookup,
});

/** Simulated lookup latency; `?latency=2000` widens the on-stage cancel window. Matches the API server's LATENCY_MS. */
const workerLatencyMs = () => Number(new URLSearchParams(globalThis.location?.search).get('latency') ?? 600);

/** Default: ask a Web Worker. Nothing touches the network. */
export function workerLookup(): UsernameLookup {
  const log = inject(LookupLog);
  const worker = new Worker(new URL('./username-check.worker', import.meta.url), { type: 'module' });
  let nextId = 0;

  return (username, abortSignal) => {
    const id = nextId++;
    log.record('worker', 'start', username);
    return new Promise((resolve, reject) => {
      const onMessage = ({ data }: MessageEvent<{ id: number } & Availability>) => {
        if (data.id !== id) return;
        cleanup();
        log.record('worker', 'done', username);
        resolve({ available: data.available });
      };
      const onAbort = () => {
        cleanup();
        worker.postMessage({ type: 'cancel', id });
        log.record('worker', 'aborted', username);
        reject(abortSignal.reason);
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        abortSignal.removeEventListener('abort', onAbort);
      };
      worker.addEventListener('message', onMessage);
      abortSignal.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ type: 'check', id, username, latencyMs: workerLatencyMs() });
    });
  };
}

/** Tests only: same contract on a timer (jsdom has no Worker). */
export function timerLookup(latencyMs: number): () => UsernameLookup {
  return () => {
    const log = inject(LookupLog);
    return (username, abortSignal) => {
      log.record('fake', 'start', username);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          abortSignal.removeEventListener('abort', onAbort);
          log.record('fake', 'done', username);
          resolve({ available: !TAKEN.includes(username) });
        }, latencyMs);
        const onAbort = () => {
          clearTimeout(timer);
          log.record('fake', 'aborted', username);
          reject(abortSignal.reason);
        };
        abortSignal.addEventListener('abort', onAbort, { once: true });
      });
    };
  };
}
