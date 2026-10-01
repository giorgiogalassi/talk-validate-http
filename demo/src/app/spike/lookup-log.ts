import { Injectable, signal } from '@angular/core';

export type Transport = 'http' | 'worker';

export interface LookupEvent {
  at: number;
  transport: Transport;
  /** `aborted`: the loader saw the AbortSignal. `stopped`: the Worker confirmed it cleared the job. */
  kind: 'start' | 'done' | 'failed' | 'aborted' | 'stopped';
  username: string;
}

/** Records every lookup that starts, completes, fails, or gets cancelled. */
@Injectable({ providedIn: 'root' })
export class LookupLog {
  private readonly t0 = performance.now();
  readonly events = signal<LookupEvent[]>([]);

  record(transport: Transport, kind: LookupEvent['kind'], username: string): void {
    const at = Math.round(performance.now() - this.t0);
    this.events.update((events) => [...events, { at, transport, kind, username }]);
  }

  clear(): void {
    this.events.set([]);
  }
}
