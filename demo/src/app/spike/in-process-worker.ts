import { CheckRequest, CheckResponse, createUsernameChecker } from './username-check';
import { WorkerPort } from './username-lookup';

/**
 * Tests only (jsdom has no Worker): runs the Worker's real code in-process, with a macrotask hop
 * each way to mimic the thread boundary. Also records what the Worker actually finished or
 * stopped, so specs can tell "cancelled" apart from "ignored and thrown away".
 */
export class InProcessWorker implements WorkerPort {
  readonly completed: string[] = [];
  readonly stopped: string[] = [];
  private readonly usernames = new Map<number, string>();
  private readonly listeners: ((event: MessageEvent<CheckResponse>) => void)[] = [];

  private readonly handle = createUsernameChecker((response: CheckResponse) => {
    const username = this.usernames.get(response.id) ?? '?';
    (response.type === 'stopped' ? this.stopped : this.completed).push(username);
    setTimeout(() => this.listeners.forEach((listener) => listener(new MessageEvent('message', { data: response }))));
  });

  postMessage(request: CheckRequest): void {
    if (request.type === 'check') this.usernames.set(request.id, request.username);
    setTimeout(() => this.handle(request));
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<CheckResponse>) => void): void {
    this.listeners.push(listener);
  }
}
