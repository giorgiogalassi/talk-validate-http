import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { EnvironmentInjector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fakeUsernameApi, logUsernameRequests } from './http';
import { LookupLog, Transport } from './lookup-log';
import { Usernames, createUsernameForm } from './username-form';
import { USERNAME_LOOKUP, timerLookup } from './username-lookup';
import { DEBOUNCE } from './validators';

/**
 * Claim under test: swapping validateHttp()'s httpResource() for any Resource via validateAsync()
 * keeps the same behavior: skip while sync-invalid, debounce, pending, errors, and cancel-in-flight.
 * Each scenario runs identically against A (validateHttp), B (validateAsync+httpResource),
 * C (validateAsync+resource) and D (validateAsync+rxResource), both non-HTTP (the Worker is swapped
 * for a timer: jsdom has no Worker).
 */
const VARIANTS: { key: keyof Usernames; transport: Transport }[] = [
  { key: 'a', transport: 'http' },
  { key: 'b', transport: 'http' },
  { key: 'c', transport: 'fake' },
  { key: 'd', transport: 'fake' },
];

const LATENCY_MS = 150;
DEBOUNCE.ms = 60;

const starts = (log: LookupLog, transport: Transport) =>
  log.events().filter((e) => e.transport === transport && e.kind === 'start').length;

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

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(withInterceptors([logUsernameRequests, fakeUsernameApi(LATENCY_MS)])),
      { provide: USERNAME_LOOKUP, useFactory: timerLookup(LATENCY_MS) },
    ],
  });
  const log = TestBed.inject(LookupLog);
  const { model, form } = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => createUsernameForm());
  const type = (key: keyof Usernames, value: string) => model.update((m) => ({ ...m, [key]: value }));
  // Read validation state up front, like a template's first render does. The async-validation
  // resource is created lazily on first read, and debounced() never delays its *initial* value:
  // without this, the first keystroke would become that initial value and fire immediately.
  for (const { key } of VARIANTS) form[key]().pending();
  TestBed.tick();
  return { log, form, type };
}

describe.each(VARIANTS)('variant $key ($transport)', ({ key, transport }) => {
  it('skips the lookup while the field is sync-invalid (params → undefined → idle)', async () => {
    const { log, form, type } = setup();
    type(key, 'ab');
    await advance(DEBOUNCE.ms + LATENCY_MS + 100);
    expect(starts(log, transport)).toBe(0);
    expect(form[key]().pending()).toBe(false);
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['minLength']);
  });

  it('is pending during debounce, coalesces keystrokes into one lookup, then reports the error', async () => {
    const { log, form, type } = setup();
    type(key, 'gio');
    await advance(10);
    type(key, 'giorg');
    await advance(10);
    type(key, 'giorgio');
    await advance(10);
    expect(form[key]().pending()).toBe(true);
    expect(starts(log, transport)).toBe(0);

    await advance(DEBOUNCE.ms + LATENCY_MS + 100);
    expect(log.events().filter((e) => e.kind === 'start').map((e) => e.username)).toEqual(['giorgio']);
    expect(form[key]().pending()).toBe(false);
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['taken']);
  });

  it('cancels the in-flight lookup when the value changes', async () => {
    const { log, form, type } = setup();
    type(key, 'giorgio');
    await advance(DEBOUNCE.ms + 40); // lookup for 'giorgio' is now in flight
    expect(starts(log, transport)).toBe(1);

    type(key, 'giorgiox');
    await advance(DEBOUNCE.ms + LATENCY_MS + 100);
    const events = log.events().map((e) => `${e.kind}:${e.username}`);
    expect(events).toContain('aborted:giorgio');
    expect(events).not.toContain('done:giorgio');
    expect(events).toContain('done:giorgiox');
    expect(form[key]().valid()).toBe(true);
  });

  it('reports valid for an available username', async () => {
    const { form, type } = setup();
    type(key, 'freename');
    await advance(DEBOUNCE.ms + LATENCY_MS + 100);
    expect(form[key]().valid()).toBe(true);
    expect(form[key]().errors()).toEqual([]);
  });

  it('flips pending one tick after the change (an effect), not synchronously', async () => {
    const { form, type } = setup();
    type(key, 'freename');
    expect(form[key]().pending()).toBe(false); // debounced() moves to 'loading' in an effect
    TestBed.tick();
    expect(form[key]().pending()).toBe(true); // …which runs before the next render
  });

  it('going sync-invalid mid-flight does not abort: the late result is discarded', async () => {
    const { log, form, type } = setup();
    type(key, 'giorgio');
    await advance(DEBOUNCE.ms + 40); // lookup for 'giorgio' in flight
    type(key, 'gi');
    await advance(10);
    // During the debounce window the field is both sync-invalid and pending.
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['minLength']);
    expect(form[key]().pending()).toBe(true);

    await advance(DEBOUNCE.ms + LATENCY_MS + 100);
    const events = log.events().map((e) => `${e.kind}:${e.username}`);
    expect(events).toContain('done:giorgio'); // never aborted: params went undefined, not to a new request
    expect(events).not.toContain('aborted:giorgio');
    expect(form[key]().pending()).toBe(false);
    expect(form[key]().errors().map((e) => e.kind)).toEqual(['minLength']); // 'taken' never surfaced
  });
});
