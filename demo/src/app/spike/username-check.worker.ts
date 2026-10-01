/// <reference lib="webworker" />
// The real Worker: a thin shell around createUsernameChecker(), which holds the actual logic
// (and runs in-process in the specs, since jsdom has no Worker).
import { CheckRequest, createUsernameChecker } from './username-check';

const handle = createUsernameChecker((response) => postMessage(response));
addEventListener('message', ({ data }: MessageEvent<CheckRequest>) => handle(data));
