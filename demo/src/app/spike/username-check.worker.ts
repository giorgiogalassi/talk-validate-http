/// <reference lib="webworker" />
// Stand-in for any non-HTTP async check (IndexedDB, WASM, a local model…). The work is async
// on purpose, so a `cancel` message can actually stop it: honoring the abort is our job here.
import { TAKEN } from './taken';

const inFlight = new Map<number, ReturnType<typeof setTimeout>>();

type Message = { type: 'check'; id: number; username: string; latencyMs: number } | { type: 'cancel'; id: number };

addEventListener('message', ({ data }: MessageEvent<Message>) => {
  if (data.type === 'cancel') {
    clearTimeout(inFlight.get(data.id));
    inFlight.delete(data.id);
    return;
  }
  const { id, username, latencyMs } = data;
  inFlight.set(
    id,
    setTimeout(() => {
      inFlight.delete(id);
      postMessage({ id, available: !TAKEN.includes(username) });
    }, latencyMs),
  );
});
