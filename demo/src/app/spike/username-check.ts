// The Worker's side of the protocol, as a plain function so the same code runs in the real
// Worker (username-check.worker.ts) and in-process in the specs (in-process-worker.ts).
// Stand-in for any non-HTTP async check (a hashed local blocklist, WASM, a local model…).
import { FAILING, TAKEN } from './taken';

export type CheckRequest =
  | { type: 'check'; id: number; username: string; latencyMs: number }
  | { type: 'cancel'; id: number };

export type CheckResponse =
  | { type: 'result'; id: number; available: boolean }
  | { type: 'failed'; id: number; message: string }
  | { type: 'stopped'; id: number };

/**
 * The work is asynchronous on purpose, so a `cancel` message can actually reach it and stop it
 * (cooperative cancellation). CPU-bound, synchronous work can't read a message mid-loop: there the
 * loader would `terminate()` the Worker and spawn a new one instead.
 */
export function createUsernameChecker(post: (response: CheckResponse) => void): (request: CheckRequest) => void {
  const inFlight = new Map<number, ReturnType<typeof setTimeout>>();

  return (request) => {
    if (request.type === 'cancel') {
      const job = inFlight.get(request.id);
      if (job === undefined) return; // already finished: nothing left to stop
      clearTimeout(job);
      inFlight.delete(request.id);
      post({ type: 'stopped', id: request.id }); // proof the work really stopped, not just got ignored
      return;
    }
    const { id, username, latencyMs } = request;
    inFlight.set(
      id,
      setTimeout(() => {
        inFlight.delete(id);
        post(
          username === FAILING
            ? { type: 'failed', id, message: 'blocklist unavailable' }
            : { type: 'result', id, available: !TAKEN.includes(username) },
        );
      }, latencyMs),
    );
  };
}
