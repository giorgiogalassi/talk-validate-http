import { Injectable, InjectionToken, inject } from '@angular/core';
import { LookupLog } from './lookup-log';
import { Availability } from './taken';
import { CheckRequest, CheckResponse } from './username-check';

/** The slice of the Worker API we use: the real Worker in the app, an in-process one in the specs (jsdom has no Worker). */
export interface WorkerPort {
  postMessage(request: CheckRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<CheckResponse>) => void): void;
}

export const USERNAME_WORKER_PORT = new InjectionToken<WorkerPort>('USERNAME_WORKER_PORT', {
  providedIn: 'root',
  factory: () => new Worker(new URL('./username-check.worker', import.meta.url), { type: 'module' }),
});

/** Simulated work time; `?latency=2000` widens the on-stage cancel window. Matches the API server's LATENCY_MS. */
export const WORKER_LATENCY_MS = new InjectionToken<number>('WORKER_LATENCY_MS', {
  providedIn: 'root',
  factory: () => Number(new URLSearchParams(globalThis.location?.search).get('latency') ?? 600),
});

interface Job {
  username: string;
  resolve: (result: Availability) => void;
  reject: (reason: unknown) => void;
  stopListening: () => void;
}

/**
 * The main-thread side of the Worker: what a resource() loader calls. Nothing touches the network.
 *
 * Rule 2 lives here: resource() only *signals* the abort (it aborts the loader's AbortSignal when
 * a newer load starts), so check() turns that signal into a `cancel` message that stops the work
 * inside the Worker. The Worker answers `stopped`, which is logged, so the cancellation is visible.
 */
@Injectable({ providedIn: 'root' })
export class UsernameWorker {
  private readonly port = inject(USERNAME_WORKER_PORT);
  private readonly latencyMs = inject(WORKER_LATENCY_MS);
  private readonly log = inject(LookupLog);
  private readonly jobs = new Map<number, Job>();
  private readonly cancelled = new Map<number, string>();
  private nextId = 0;

  constructor() {
    this.port.addEventListener('message', ({ data }) => this.onResponse(data));
  }

  check(username: string, abortSignal: AbortSignal): Promise<Availability> {
    const id = this.nextId++;
    this.log.record('worker', 'start', username);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.jobs.delete(id);
        this.cancelled.set(id, username);
        this.port.postMessage({ type: 'cancel', id }); // rule 2: actually stop the work
        this.log.record('worker', 'aborted', username);
        reject(abortSignal.reason);
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
      const stopListening = () => abortSignal.removeEventListener('abort', onAbort);
      this.jobs.set(id, { username, resolve, reject, stopListening });
      this.port.postMessage({ type: 'check', id, username, latencyMs: this.latencyMs });
    });
  }

  private onResponse(response: CheckResponse): void {
    if (response.type === 'stopped') {
      const username = this.cancelled.get(response.id);
      this.cancelled.delete(response.id);
      if (username !== undefined) this.log.record('worker', 'stopped', username);
      return;
    }
    const job = this.jobs.get(response.id);
    if (job === undefined) {
      this.cancelled.delete(response.id); // finished before the cancel reached it
      return;
    }
    this.jobs.delete(response.id);
    job.stopListening();
    if (response.type === 'failed') {
      this.log.record('worker', 'failed', job.username);
      job.reject(new Error(response.message));
    } else {
      this.log.record('worker', 'done', job.username);
      job.resolve({ available: response.available });
    }
  }
}
