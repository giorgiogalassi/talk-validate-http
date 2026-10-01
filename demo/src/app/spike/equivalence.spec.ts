import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  EnvironmentInjector,
  ResourceLoader,
  effect,
  provideZonelessChangeDetection,
  resource,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form, validateAsync } from '@angular/forms/signals';
import { fakeUsernameApi, logUsernameRequests } from './http';
import { InProcessWorker } from './in-process-worker';
import { LookupLog, Transport } from './lookup-log';
import { Availability } from './taken';
import { Usernames, createUsernameForm } from './username-form';
import { USERNAME_WORKER_PORT, UsernameWorker, WORKER_LATENCY_MS } from './username-lookup';
import { DEBOUNCE } from './validators';

/**
 * Claim under test: swapping validateHttp()'s httpResource() for any Resource via validateAsync()'s
 * factory keeps the same behaviour (skip while sync-invalid → idle, debounce, pending, valid, error,
 * cancel-in-flight), as long as the two rules hold. Each scenario runs identically against
 *   A validateHttp · B validateAsync+httpResource            (HTTP, answered by an interceptor)
 *   C validateAsync+resource · D validateAsync+rxResource    (the Web Worker)
 *   E validateAsync+resource with its own debounced() + ctx.chain() (the Web Worker)
 * The Worker is the real worker code (createUsernameChecker) run in-process: jsdom has no Worker,
 * so only the thread boundary is simulated.
 */
const ALL: { key: keyof Usernames; transport: Transport }[] = [
  { key: 'a', transport: 'http' },
  { key: 'b', transport: 'http' },
  { key: 'c', transport: 'worker' },
  { key: 'd', transport: 'worker' },
  { key: 'e', transport: 'worker' },
];
/** E brings its own debounce, so it has no "debounce off" mode. */
const WITH_DEBOUNCE_OPTION = ALL.filter((v) => v.key !== 'e');

const LATENCY_MS = 150;
const DEBOUNCE_MS = 60;

const starts = (log: LookupLog, transport: Transport) =>
  log.events().filter((e) => e.transport === transport && e.kind === 'start').length;

const eventsOf = (log: LookupLog) => log.events().map((e) => `${e.kind}:${e.username}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Advance real time while flushing Angular effects / change detection. */
async function advance(ms: number): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    TestBed.tick();
    await sleep(5);
  }
  TestBed.tick();
}

function configure() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(withInterceptors([logUsernameRequests, fakeUsernameApi(LATENCY_MS)])),
      { provide: USERNAME_WORKER_PORT, useFactory: () => new InProcessWorker() },
      { provide: WORKER_LATENCY_MS, useValue: LATENCY_MS },
    ],
  });
  return TestBed.inject(USERNAME_WORKER_PORT) as InProcessWorker;
}

function setup(debounceMs: number | undefined) {
  DEBOUNCE.ms = debounceMs; // read when the schema is applied, i.e. per form
  const worker = configure();
  const log = TestBed.inject(LookupLog);
  const { model, form } = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => createUsernameForm());
  const type = (key: keyof Usernames, value: string) => model.update((m) => ({ ...m, [key]: value }));
  // Read validation state up front, like a template's first render does. The async-validation
  // resource is created lazily on first read, and debounced() never delays its *initial* value:
  // without this, the first keystroke would become that initial value and fire immediately.
  for (const { key } of ALL) form[key]().pending();
  TestBed.tick();
  return { log, form, type, worker };
}

describe.each(ALL)('variant $key ($transport), debounce on', ({ key, transport }) => {
  it('idle: skips the lookup while the field is sync-invalid (params → undefined)', async () => {
    const { log, form, type } = setup(DEBOUNCE_MS);
    type(key, 'ab');
    await advance(DEBOUNCE_MS + LATENCY_MS + 100);
    expect(starts(log, transport)).toBe(0);
    expect(form[key]().pending()).toBe(false);
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['minLength']);
  });

  it('pending during debounce, coalesces keystrokes into one lookup, then reports the error', async () => {
    const { log, form, type } = setup(DEBOUNCE_MS);
    type(key, 'gio');
    await advance(10);
    type(key, 'giorg');
    await advance(10);
    type(key, 'giorgio');
    await advance(10);
    expect(form[key]().pending()).toBe(true);
    expect(starts(log, transport)).toBe(0);

    await advance(DEBOUNCE_MS + LATENCY_MS + 100);
    expect(log.events().filter((e) => e.kind === 'start').map((e) => e.username)).toEqual(['giorgio']);
    expect(form[key]().pending()).toBe(false);
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['taken']);
  });

  it('valid: reports valid for an available username', async () => {
    const { form, type } = setup(DEBOUNCE_MS);
    type(key, 'freename');
    await advance(DEBOUNCE_MS + LATENCY_MS + 100);
    expect(form[key]().valid()).toBe(true);
    expect(form[key]().errors()).toEqual([]);
  });

  it('error: a failing source goes through onError', async () => {
    const { log, form, type } = setup(DEBOUNCE_MS);
    type(key, 'offline');
    await advance(DEBOUNCE_MS + LATENCY_MS + 100);
    expect(eventsOf(log)).toContain('failed:offline');
    expect(form[key]().pending()).toBe(false);
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['unreachable']);
  });

  it('cancels the in-flight lookup when the value changes (and the work really stops)', async () => {
    const { log, form, type, worker } = setup(DEBOUNCE_MS);
    type(key, 'giorgio');
    await advance(DEBOUNCE_MS + 40); // lookup for 'giorgio' is now in flight
    expect(starts(log, transport)).toBe(1);

    type(key, 'giorgiox');
    await advance(DEBOUNCE_MS + LATENCY_MS + 100);
    const events = eventsOf(log);
    expect(events).toContain('aborted:giorgio');
    expect(events).not.toContain('done:giorgio');
    expect(events).toContain('done:giorgiox');
    expect(form[key]().valid()).toBe(true);
    if (transport === 'worker') {
      expect(events).toContain('stopped:giorgio'); // the Worker confirmed it dropped the job
      expect(worker.completed).toEqual(['giorgiox']);
    }
  });

  it('pending flips one tick after the change (an effect), not synchronously', async () => {
    const { form, type } = setup(DEBOUNCE_MS);
    type(key, 'freename');
    expect(form[key]().pending()).toBe(false); // debounced() moves to 'loading' in an effect
    TestBed.tick();
    expect(form[key]().pending()).toBe(true); // …which runs before the next render
  });

  it('going sync-invalid mid-flight does not abort: the late result is discarded', async () => {
    const { log, form, type } = setup(DEBOUNCE_MS);
    type(key, 'giorgio');
    await advance(DEBOUNCE_MS + 40); // lookup for 'giorgio' in flight
    type(key, 'gi');
    await advance(10);
    // During the debounce window the field is both sync-invalid and pending.
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['minLength']);
    expect(form[key]().pending()).toBe(true);

    await advance(DEBOUNCE_MS + LATENCY_MS + 100);
    const events = eventsOf(log);
    expect(events).toContain('done:giorgio'); // never aborted: params went undefined, not to a new request
    expect(events).not.toContain('aborted:giorgio');
    expect(form[key]().pending()).toBe(false);
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['minLength']); // 'taken' never surfaced
  });
});

describe.each(WITH_DEBOUNCE_OPTION)('variant $key ($transport), debounce off (the stage setting for the cancel demo)', ({ key, transport }) => {
  it('pending flips synchronously with the change (linkedSignal, no effect in between)', () => {
    const { form, type } = setup(undefined);
    type(key, 'freename');
    expect(form[key]().pending()).toBe(true);
  });

  it('every superseding keystroke aborts the lookup in flight', async () => {
    const { log, form, type, worker } = setup(undefined);
    type(key, 'gio');
    await advance(10);
    type(key, 'giorg');
    await advance(10);
    type(key, 'giorgio');
    await advance(LATENCY_MS + 100);

    expect(starts(log, transport)).toBe(3);
    const events = eventsOf(log);
    expect(events).toEqual(expect.arrayContaining(['aborted:gio', 'aborted:giorg', 'done:giorgio']));
    expect(events).not.toContain('done:gio');
    expect(events).not.toContain('done:giorg');
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['taken']);
    if (transport === 'worker') {
      expect(worker.stopped).toEqual(['gio', 'giorg']);
      expect(worker.completed).toEqual(['giorgio']);
    }
  });

  it('going sync-invalid mid-flight still does not abort: idle never aborts', async () => {
    const { log, form, type } = setup(undefined);
    type(key, 'giorgio');
    await advance(40);
    type(key, 'gi');
    expect(form[key]().pending()).toBe(false); // no debounce window: idle right away
    await advance(LATENCY_MS + 100);
    expect(eventsOf(log)).toContain('done:giorgio');
    expect(eventsOf(log)).not.toContain('aborted:giorgio');
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['minLength']);
  });
});

describe('rule 1: read params only inside a resource’s params evaluation', () => {
  it('with debounce on, reading params from an effect catches the sentinel instead of a value', async () => {
    configure();
    const seen: string[] = [];
    const model = signal({ username: '' });
    const f = runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      form(model, (p) => {
        validateAsync(p.username, {
          params: ({ value }) => value(),
          debounce: DEBOUNCE_MS,
          factory: (params) => {
            effect(() => {
              try {
                seen.push(`value:${params()}`);
              } catch {
                seen.push('threw');
              }
            });
            return resource({ params, loader: async ({ params: username }) => username }); // ✅ passed as is
          },
          onSuccess: () => undefined,
          onError: () => undefined,
        });
      }),
    );
    f.username().pending();
    TestBed.tick();
    model.set({ username: 'giorgio' });
    await advance(10);
    expect(seen).toContain('threw'); // ❌ the effect saw ResourceParamsStatus.LOADING, not a username
    expect(f.username().pending()).toBe(true); // ✅ the resource turned the same sentinel into a status
    await advance(DEBOUNCE_MS + 50);
    expect(seen.at(-1)).toBe('value:giorgio');
    expect(f.username().valid()).toBe(true);
  });
});

describe('rule 2: the loader must honour abortSignal itself', () => {
  /** A resource on the Worker; the username changes while the first check is in flight. */
  async function supersede(loader: (worker: UsernameWorker) => ResourceLoader<Availability, string>) {
    const port = configure();
    const username = signal('giorgio');
    const res = runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      resource({ params: username, loader: loader(TestBed.inject(UsernameWorker)) }),
    );
    await advance(40);
    username.set('giorgiox');
    await advance(LATENCY_MS + 100);
    return { res, port };
  }

  it('honoured: the Worker stops the superseded job', async () => {
    const { res, port } = await supersede((w) => ({ params, abortSignal }) => w.check(params, abortSignal));
    expect(res.value()).toEqual({ available: true });
    expect(port.stopped).toEqual(['giorgio']);
    expect(port.completed).toEqual(['giorgiox']);
  });

  it('ignored: the UI is just as correct, but the Worker finishes the superseded job anyway', async () => {
    const { res, port } = await supersede((w) => ({ params }) => w.check(params, new AbortController().signal));
    expect(res.value()).toEqual({ available: true }); // stale result discarded by identity
    expect(port.stopped).toEqual([]);
    expect(port.completed).toEqual(['giorgio', 'giorgiox']); // wasted work
  });
});
