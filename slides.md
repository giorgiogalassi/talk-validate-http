---
theme: default
title: "The Validator That Isn't"
author: Giorgio Galassi
highlighter: shiki
lineNumbers: false
drawings:
  persist: false
transition: slide-left
mdc: true
fonts:
  sans: Roboto
  mono: Roboto Mono
---

# The Validator That Isn't

## resource(), httpResource(), and the Reactive Graph Behind Signal Forms

Giorgio Galassi

<!--
Speaker notes:
Let the title sit. No preamble.
40-minute extended slot, Advanced. Everything on screen is pinned to Angular v22.1.1,
and the demo app runs on exactly that version. The 25-minute cut is slides-25.md.
Before walking on (see demo/STAGE.md): `npm run stage` in demo/ (API with 2 s latency + dev server),
browser on http://localhost:4200/?latency=2000, DevTools on the Network tab, lookup log cleared,
editor on validators.ts, a second terminal pane showing the [api] log.
-->

---

# You add a username field.

It has to ask the server if the name is free.

Easy. Until the user starts typing.

<!--
Speaker notes:
~3 minutes for this opening, including the next two slides.
Cold open, no bio: that's on the last slide. Say it plainly, let "until the user starts typing" land.
Everyone in the room has built this field. Everyone has regretted it a little.
-->

---

# Async validation is where forms libraries grow a pile

1. **<span class="accent">Gate</span>** — wait until the sync validators pass
2. **<span class="accent">Debounce</span>** — don't fire on every keystroke
3. **<span class="accent">Pending</span>** — show a spinner that doesn't flicker
4. **<span class="accent">Cancel</span>** — drop the request a newer value made obsolete
5. **<span class="accent">Order</span>** — never let a slow response overwrite a fast one

<!--
Speaker notes:
Let's be honest: this is the part of any forms library where you brace yourself.
Walk the list slowly, one line at a time. Every one of these is a bug you've shipped
at some point, and every library that has ever done async validation grew a pile of
bespoke machinery for it: timers, flags, subscriptions, "is this still the latest request" checks.
Ask the room: who has written a debounce-and-cancel for a username field by hand? Hands go up.
-->

---

# Signal Forms ships it in one call

```ts
form(this.model, (p) => {
  required(p.username);
  minLength(p.username, 3);

  validateHttp(p.username, {
    request: ({ value }) => `/api/username?u=${value()}`,
    debounce: 300,
    onSuccess: (res: { available: boolean }) =>
      res.available ? undefined : { kind: 'taken' },
    onError: () => ({ kind: 'unreachable' }),
  });
});
```

<div class="callout">All five just work. <span class="accent">So where is the pile?</span></div>

<!--
Speaker notes:
This is the whole user-facing API, and it's unremarkable, which is the point.
The request waits for required and minLength, field().pending() is true while it runs,
a newer value cancels the previous call, debounce is one option.
When this shipped, I opened the source expecting a few hundred lines of async bookkeeping.
Beat. "I didn't find it." That's the talk.
-->

---

# Every API is one of two things

- **<span class="accent">A disguise</span>** — another API with some arguments filled in. Adds no behaviour.
- **<span class="accent">An enhancement</span>** — another API, plus behaviour of its own.

<div class="callout">Two questions for every API you meet: <span class="accent">disguise or enhancement? Of what?</span></div>

<p class="text-sm opacity-60">Let's ask them all the way down, starting from <code>validateHttp()</code>.</p>

<!--
Speaker notes:
~1 minute. This is the lens for the whole talk, so say it slowly.
A disguise is a preset: if you know what it wraps, you already know how it behaves.
An enhancement is where you actually have something new to learn, and only that new part.
Every layer we open gets a verdict, a little badge in the corner. By the end the badges add up
to a map of the whole stack, and you'll be able to do this yourself on the next API Angular ships.
-->

---
layout: section
---

# Layer 1 · validateHttp()

<!--
~4 minutes for this section.
-->

---

# The entire function <span class="verdict disguise">Disguise</span>

```ts {all|5}
export function validateHttp(path, opts) {
  validateAsync(path, {
    params: opts.request,
    debounce: opts.debounce,
    factory: (request) => httpResource(request, opts.options),
    onSuccess: opts.onSuccess,
    onError: opts.onError,
    when: opts.when,
  });
}
```

<p class="text-sm opacity-60">forms/signals/src/api/rules/validation/validate_http.ts · v22.1.1 · L96–110 · types stripped</p>

<!--
Speaker notes:
This is not simplified, apart from the generics and one cast I stripped to fit. This is the body.
One call to validateAsync, options passed through. No await, no subscription, no cancellation logic.
Click to highlight the factory. Out of the whole file, that's the only line that does anything
HTTP-related. Everything else that says "HTTP" in that file is an import, a type, or a doc comment.
Verdict: disguise. validateHttp is validateAsync with the factory filled in, and it adds nothing.
Plant the seed: "Remember that line. We're going to change it."
25-min cut (no step 1 slide): bridge straight to validateAsync: "So the pile must be one level down. It isn't there either."
-->

---

# So you can write it yourself

```ts
validateAsync(p.username, {
  params: ({ value }) => `/api/username?u=${value()}`,
  debounce: 300,
  factory: (request) => httpResource<Availability>(request),
  onSuccess: (res) => (res?.available === false ? { kind: 'taken' } : undefined),
  onError: () => ({ kind: 'unreachable' }),
});
```

Field **A** uses `validateHttp()`. Field **B** uses this. Watch the log.

<!--
Speaker notes:
DEMO STEP 1 (~1 min, no typing of code). validateAsync is public API, so this is legal user code.
Browser: type "giorgio" in field A, then in field B. Same pending, same "taken", and the lookup log
shows one request per pause for each. Type "freename" in B: valid.
Line to say: "If you can write the framework's implementation in your own file, it isn't a black box anymore."
Transition: "So the pile must be one level down, in validateAsync. It isn't there either."
-->

---
layout: section
---

# Layer 2 · validateAsync()

<!--
~6 minutes for this section. Three behaviours, zero new mechanisms.
-->

---

# Sync-before-async is a `return undefined` <span class="verdict enhancement">Enhancement</span>

```ts {4-6}
metadata(path, RESOURCE, (ctx) => {
  const validationState = ctx.stateOf(path).validationState;

  if (validationState.shouldSkipValidation() || !validationState.syncValid()) {
    return undefined;
  }
  if (opts.when && !opts.when(ctx)) return undefined;

  return opts.params(ctx);
});
```

<div class="callout">A resource whose params are <code>undefined</code> goes <span class="accent">idle</span> and doesn't start a load. Nobody wrote the gate.</div>

<p class="text-sm opacity-60">validate_async.ts · v22.1.1 · L128–180 · condensed</p>

<!--
Speaker notes:
Verdict: enhancement. validateAsync is a resource plus three things of its own: the gate, the debounce,
and the mapping from resource status to form errors. This slide and the next are two of them.
This computation feeds the resource's params. When sync validation fails, it returns undefined.
The `when` option you may have used is the same trick: return undefined, validation is off.
And a resource with undefined params goes idle and doesn't start a load. That is documented,
public resource behaviour, not a forms detail.
So the docs promise "async validation runs only after sync validation passes", and nobody wrote
code to keep that promise. It falls out of a rule that was already there.
(Precision: going idle doesn't abort a load that's already running; it gets discarded. More on that later, or just this sentence in the 25-min cut.)
Demo tie-in if time allows: type "ab" in any field, the log stays empty.
-->

---

# `pending()` is a resource status, read through a rule

```ts
switch (res.status()) {
  case 'idle':                      return undefined;
  case 'loading': case 'reloading': return 'pending';
  case 'resolved': case 'local':
    return res.hasValue() ? opts.onSuccess(res.value(), ctx) : undefined;
  case 'error':                     return opts.onError(res.error(), ctx);
}
```

<div class="callout">Six resource statuses collapse into four form outcomes. <code>pending()</code> holds <span class="accent">no state of its own</span>.</div>

<!--
Speaker notes:
Lightly condensed: the real one wraps each result in addDefaultField() to attach it to the field.
The point: field().pending() is a projection of res.status(). There's no "isChecking" flag
anywhere in Signal Forms. If you already know resource(), you already know every state an async
validator can be in.
-->

---

# Pending comes from the graph, not a flag <span class="verdict engine">Engine</span>

```ts
// no debounce: ResourceImpl's state linkedSignal, synchronous
status = request === undefined ? 'idle' : 'loading';

// with debounce: debounced()'s effect sets 'loading'
//   → chain() throws ResourceParamsStatus.LOADING
//   → ResourceImpl catches it in its params evaluation → status 'loading'
```

- **<span class="accent">No debounce</span>** — the first read after the change already says `'loading'`
- **<span class="accent">With debounce</span>** — one effect later, and effects flush before render

<div class="callout">Either way, no flicker. <span class="accent">Only the data is async.</span></div>

<!--
Speaker notes:
The third badge: engine. ResourceImpl isn't a disguise or an enhancement of anything, it's what
everything else wraps. Status, cancellation and staleness live here.
Two paths, and I want to be precise because this is where "it's synchronous" gets said loosely.
Without debounce, the transition lives in a linkedSignal: lazy, but pure and synchronous, so the
very next read of status() says loading.
With debounce, which is how everyone uses this, the switch to loading happens in debounced()'s
effect. I tested it: set the value and read pending() in the same line, you get false; one tick
later, true. Root effects run before the view refreshes, so the user never sees a gap.
Nothing here is a flag someone remembered to set. It's the graph.
-->

---
layout: section
---

# The factory is the seam

<!--
~10 minutes. The centrepiece. What's new here isn't the swap itself (the docs show one),
it's that the swap IS validateHttp, plus the contract and the abort gap nobody writes down.
Protect this section in the 25-min cut.
-->

---

# The docs call it "lower-level"

> "`validateAsync()` is **a lower-level API** that exposes Angular's resource primitive directly."

<p class="text-sm opacity-60">angular.dev · Forms › Signal Forms › Async operations</p>

<div class="callout">It isn't lower. <code>validateHttp()</code> <em>is</em> <code>validateAsync()</code>, with the factory filled in.</div>

<!--
Speaker notes:
If you've read the async-operations guide, you've seen validateAsync with resource() and with rxResource().
So I'm not going to pretend the swap is a secret. What the docs frame as two tools, a convenient one
and a lower-level one, is one tool: we just saw that validateHttp's body is a validateAsync call.
The "lower-level API" is the only API. The HTTP one is a preset.
-->

---

# What does validateAsync() actually need?

```ts
factory: (params: Signal<TParams | undefined>) => Resource<TResult | undefined>
```

- **<span class="accent">Reads</span>** — `status()`, `value()`, `hasValue()`, `error()`
- **<span class="accent">Never touches</span>** — URLs, `HttpClient`, `fetch`

<div class="callout">Anything that is a <code>Resource</code> fits. <span class="accent">HTTP is just the first one they shipped.</span></div>

<!--
Speaker notes:
Read the type out loud. The factory gets a signal of params and must give back a Resource.
validateAsync only ever reads status, value, hasValue and error. It has no way of knowing,
and no reason to care, that there's HTTP behind those signals.
-->

---

# The framework already does the swap <span class="verdict disguise">Disguise</span>

```ts {6-10}
export function validateStandardSchema(path, schema) {
  // … sync issues via validateTree() …

  validateAsync(path, {
    params: ({ state }) => /* the schema's pending Promise, or undefined */,
    factory: (params) =>
      resource({
        params,
        loader: async ({ params }) => (await params)?.issues ?? [],
      }),
    onSuccess: (issues, { fieldTreeOf }) => /* map issues to errors */,
    onError: () => {},
  });
}
```

<p class="text-sm opacity-60">validation/standard_schema.ts · v22.1.1 · L104–124 · condensed</p>

<!--
Speaker notes:
This is the answer to anyone who thinks a non-HTTP resource here is a hack.
Async Standard Schema validation, Zod with async refinements for example, is validateAsync with a
plain resource() whose loader awaits a Promise. First-party, shipped, no HTTP.
So validateHttp and validateStandardSchema are siblings: same validateAsync, different factory.
Same verdict too: a disguise. Two presets of one enhancement.
-->

---
layout: center
---

# <span class="accent">LIVE</span> · swap the factory yourself

Field **C**: same call, a `resource()` that asks a Web Worker

<!--
Speaker notes:
DEMO STEP 2 (~4 min). Editor: validators.ts, variant C. Pre-staged per STAGE.md: C starts as a copy
of B (URL params + httpResource factory).
Live edit, two lines: params becomes ({ value }) => value(), factory becomes the resource() + lookup.
Save; the app reloads.
Browser, Network tab visible, running with ?latency=2000:
 1. Type "giorgio", stop. Pending, then "taken" after ~2 s. Network tab: EMPTY. Log: "worker start/done".
 2. Type "giorgio", wait about a second (the lookup is now running), type "x".
    Log: "worker aborted giorgio" then "worker start giorgiox". Still nothing on the network.
Don't type fast and expect an abort: fast typing coalesces into one lookup, so nothing gets aborted.
Line to say: "Same debounce, same pending, same cancellation, and nothing went over the wire."
Fallback: `git checkout -- src/app/spike/validators.ts` restores the finished variant C.
-->

---

# One factory changed

```ts {2,4-10}
validateAsync(p.username, {
  params: ({ value }) => value(),
  debounce: 300,
  factory: (params) => {
    const lookup = inject(USERNAME_LOOKUP);   // a Web Worker behind a DI token
    return resource({
      params,
      loader: ({ params: username, abortSignal }) => lookup(username, abortSignal),
    });
  },
  onSuccess: (res) => (res?.available === false ? { kind: 'taken' } : undefined),
  onError: () => ({ kind: 'unreachable' }),
});
```

<div class="callout">Gate, debounce, pending, errors, cancel: <span class="accent">all still there.</span></div>

<!--
Speaker notes:
The diff is the factory, and params becoming the raw value instead of a URL.
The worker is a stand-in, and I'll say it before someone else does: it's a timer in a thread.
What matters is that it's async, abortable, and not HTTP; swap in IndexedDB, WASM, a local model.
If you want a non-contrived example, you just saw one: validateStandardSchema.
Everything we listed in the first section came along for free, because none of it ever lived in the HTTP part.
-->

---

# The one rule for your factory

While debouncing, reading `params()` **throws**. On purpose.

```ts
// ✅ inside a resource's params: direct, wrapped, or through a computed
factory: (params) => resource({ params, loader })
factory: (params) => resource({ params: () => ({ q: params() }), loader })

// ❌ outside it: an effect, a template, an untracked read
factory: (params) => { effect(() => log(params())); return resource({ params, loader }); }
//                                  ^ throws ResourceParamsStatus.LOADING while debouncing
```

Only a resource's params evaluation catches the `chain()` sentinel and turns it into a status.

<!--
Speaker notes:
This is the one contract the types don't enforce. With debounce on, the signal you get is a
computed that calls chain() on the debounced resource. While the debounce is pending, chain()
doesn't return a value: it throws a sentinel, ResourceParamsStatus.LOADING.
ResourceImpl catches that sentinel inside its params evaluation and turns it into status 'loading'.
Wrapping is fine, even through a computed, because the throw still surfaces inside that evaluation.
Reading it in the loader is fine too, because the loader only runs once params have resolved.
Read it anywhere else, an effect, a template binding, and you catch the sentinel yourself.
I tested five shapes; only the effect one saw it.
The API doc says: "The given params should be used as is to create the resource." Now you know why.
-->

---

# Where the abstraction stops

`resource()` **signals** the abort. Stopping the work is **your loader's job**.

```ts {6-9}
return (username, abortSignal) =>
  new Promise((resolve, reject) => {
    worker.postMessage({ type: 'check', id, username });
    worker.addEventListener('message', onResult);

    abortSignal.addEventListener('abort', () => {
      worker.postMessage({ type: 'cancel', id });   // actually stop the work
      reject(abortSignal.reason);
    });
  });
```

The docs' own `resource()` example never reads `abortSignal`. `httpResource()` gets it for free; a custom loader has to earn it.

<!--
Speaker notes:
This is the honest part of the talk. When a new load starts, resource() aborts the old one's
AbortController and throws away the stale result, so your UI is always correct. But if your loader
ignores the abortSignal, the work keeps running: the worker keeps computing, the IndexedDB
transaction keeps going. Correct UI, wasted work.
And the example in the official guide doesn't take abortSignal at all. It's correct, and it
wastes work on every superseded keystroke. httpResource wires the signal all the way down to fetch.
With your own loader, honoring abortSignal is the one thing you must write yourself.
-->

---
layout: section
---

# Debounce and lazy aborts

<!--
~5 minutes. CUT in the 25-minute version; the lazy-abort idea survives as one sentence in demo step 3.
-->

---

# Debounce: two primitives, no timer in forms

```ts
if (opts.debounce !== undefined) {
  const debouncedResource = debounced(() => params(), opts.debounce);
  const wrappedParams = computed(() => ɵchain(debouncedResource));
  return opts.factory(wrappedParams);
}
return opts.factory(params);
```

- **<span class="accent">debounced()</span>** — public, `@experimental` `@angular/core` primitive (the timer lives here)
- **<span class="accent">ɵchain</span>** — the internal side of `ctx.chain()`, the resource-composition helper

<!--
Speaker notes:
No setTimeout in forms. They wrap the params in a debounced() resource and chain it into the
params the factory receives, exactly the way you'd chain two resources in your own code.
The timer exists, inside debounced() in core; forms just composes it.
Note the ɵ: chain has no public export on @angular/core, you reach it through the params context
of a resource. And debounced() is still experimental while validateAsync is stable, so the forms
team is dogfooding an experimental API inside a stable feature. Worth noticing.
-->

---

# Aborts are lazy

```text
"giorgio" ──300ms──▶ load giorgio starts
"x"                  (giorgio keeps running…)
          ──300ms──▶ giorgio ABORTED + load giorgiox starts

"giorgio" ──300ms──▶ load giorgio starts
"gi" (too short)     field shows minLength AND pending
          ──300ms──▶ params → undefined: giorgio NOT aborted, it finishes and is discarded
```

- **<span class="accent">Abort</span>** — `loadEffect()` returns before `abortInProgressLoad()` unless there's a new request to load
- **<span class="accent">Discard</span>** — a late result is dropped by identity: `untracked(this.extRequest) !== extRequest`

<!--
Speaker notes:
Two details I only found by logging, and both are now test cases in the repo.
First: the keystroke doesn't cancel the request. The old load keeps running through the debounce
window and is aborted at the moment the new one starts.
Second, the surprising one: delete back to "gi". The field is sync-invalid immediately, but it's
also pending for the debounce window, because undefined goes through debounced() like any value.
Then params resolve to undefined, the resource goes idle, and idle never aborts: the giorgio request
completes on the network and is thrown away by identity. Its "taken" never shows up.
Correct UI in both cases. But "cancel" means "discard, and abort when convenient".
-->

---
layout: section
---

# Watch it cancel

<!--
~3 minutes.
-->

---
layout: center
---

# <span class="accent">LIVE</span> · type faster than the server

Field **A**, DevTools → Network, and the server log

<!--
Speaker notes:
DEMO STEP 3 (~2 min). Field A (the real validateHttp). Stage server latency is 2 s, debounce 300 ms.
Type "giorgio", wait about a second (anything between 0.3 s and 2 s works), type "x".
Network tab: the giorgio request goes "(canceled)" in red, giorgiox completes 2 s later.
Terminal pane: "[api] ✕ giorgio (client aborted)". The abort crossed the network.
Note the cancel lands ~300 ms after the "x", not on the keystroke: that's the lazy abort
(one sentence here in the 25-min cut).
Line to say: "That red line is four different cancellation mechanisms handing off to each other."
Fallback: recording + screenshot in src/ (STAGE.md checklist).
-->

---

# One abort, four relays

1. **<span class="accent">AbortController</span>** — a new load starts, `ResourceImpl` aborts the old one
2. **<span class="accent">Unsubscribe</span>** — the `httpResource` loader drops its `HttpClient` subscription
3. **<span class="accent">Teardown</span>** — RxJS aborts a second `AbortController` inside `FetchBackend`
4. **<span class="accent">fetch()</span>** — that second signal is the one the platform sees

<div class="callout">Four idioms, one red line. <span class="accent">Nobody in forms wrote any of it.</span></div>

<!--
Speaker notes:
Four different cancellation idioms, relayed in sequence: AbortController, RxJS unsubscribe,
teardown logic, and the platform's fetch signal. Nobody in forms wrote any of it.
Compare with the worker version: there, steps 2 to 4 are the one postMessage we wrote ourselves.
-->

---
layout: section
---

# Zoom out

<!--
~4 minutes.
-->

---

# The whole stack, sorted

| Layer | Verdict | Of what | Adds |
| --- | --- | --- | --- |
| `validateHttp()` | <span class="verdict disguise">Disguise</span> | `validateAsync()` | nothing |
| `validateAsync()` | <span class="verdict enhancement">Enhancement</span> | a `Resource` | gate, debounce, status → errors |
| `httpResource()` | <span class="verdict enhancement">Enhancement</span> | `ResourceImpl` | HTTP loader, `headers()`, `statusCode()`, `progress()` |
| `ResourceImpl` | <span class="verdict engine">Engine</span> | — | status, cancellation, staleness |
| `HttpClient` | <span class="verdict enhancement">Enhancement</span> | `HttpBackend` | interceptors, XSRF, transfer cache |
| `FetchBackend` | <span class="verdict engine">Floor</span> | `fetch()` | the platform |

<!--
Speaker notes:
Every badge from the talk, in one table. Read the Verdict column top to bottom:
one disguise, three enhancements, and an engine with the platform under it.
The only thing forms actually added is validateAsync's three behaviours. The async machinery lives
in ResourceImpl, and neither it nor the transport is a forms thing.
There is no forms-specific async system to learn, work around, or wait on the team to extend.
-->

---

# The payoff: test the validator, not the network

```ts
TestBed.configureTestingModule({
  providers: [
    provideHttpClient(withInterceptors([logUsernameRequests, fakeUsernameApi(150)])),
    { provide: USERNAME_LOOKUP, useFactory: timerLookup(150) },
  ],
});

describe.each([
  'validateHttp',
  'validateAsync + httpResource',
  'validateAsync + resource',
  'validateAsync + rxResource',
])
```

<div class="callout">4 implementations × 6 scenarios, <span class="accent">24/24 green</span>: gate, debounce + pending, cancel, valid, one-tick pending, going invalid mid-flight.</div>

<!--
Speaker notes:
Because the validator is just a resource, testing it is just testing a resource.
The demo repo has one spec that runs the same six scenarios against all four variants.
Swap the worker for a timer through DI, swap HTTP for an interceptor, and the same assertions
pass for all four. That's the strongest evidence I have that they're the same thing.
One gotcha if you write these tests: read the field's state once before typing, like a template
does on first render (backup slide if anyone asks).
-->

---

# What you take home

1. **<span class="accent">A lens</span>** — for every new API: disguise or enhancement, and of what? A disguise you already know. An enhancement, learn only what it adds.
2. **<span class="accent">A skill</span>** — an async validator on any source: `validateAsync()` + any `Resource`. Two rules: read `params` only inside the resource, honor `abortSignal`.
3. **<span class="accent">Predictions</span>** — pending flips before render, aborts wait for the next load, a result for a value that's already too short never shows up.

<div class="callout">Learn <code>resource()</code> once. <span class="accent">Not three APIs. One.</span></div>

<!--
Speaker notes:
~2 minutes to close. Three things, one per line, and don't rush them.
The lens is the one that outlives this talk: Angular will ship another convenience API next year,
and the first thing to ask is what it's a disguise or an enhancement of.
The skill is Monday-morning usable: IndexedDB, a Worker, a WebSocket, whatever async source you have.
The predictions are what let you debug it at 6pm on a Friday, because you know where each behaviour lives.
Then the callout, and straight to Thank you.
-->

---
layout: center
footer: false
---

<div class="flex flex-row items-center gap-12 w-full">

  <div class="flex flex-col gap-5 flex-1">

  <div class="thank-you-title">Thank you</div>

The validator that isn't. **<span class="accent">The resource that is.</span>**

**Giorgio Galassi** <br>
Senior Frontend Engineer (Freelancer) · GDG Roma Città Organizer

  <div class="tags">
    <span class="tag">Angular</span>
    <span class="tag">Signal Forms</span>
    <span class="tag">Angular Internals</span>
  </div>

  <div class="flex items-start gap-8">
    <div class="flex flex-col items-center gap-2">
      <img src="/src/qrcode_allmylinks.png" alt="QR code to all my links" class="qr-code w-48 h-48" />
      <span class="text-sm text-gray-400">All my links</span>
    </div>
    <div class="flex flex-col justify-center gap-1 text-sm">
      <span><b>Demo + slides</b><br>github.com/giorgiogalassi/talk-validate-http</span>
      <span><b>Article</b><br>validateHttp() Has No Async Machinery</span>
    </div>
  </div>

  </div>

  <div class="flex-shrink-0">
    <img src="/src/profile.png" alt="Giorgio Galassi" class="rounded-full w-60 h-60 object-cover" />
  </div>

</div>

<!--
Speaker notes:
Land the tagline: the validator that isn't, the resource that is. Pause.
Thank the room. Open for questions, and leave this slide up: QR for links, repo for the demo.
Repo URL is a placeholder until the repo is pushed; confirm before the event.
Backup slides follow for likely questions, don't show them unless asked.
-->

---
layout: section
footer: false
---

# Backup

<!--
Q&A only.
-->

---
footer: false
---

# Q&A · "Can I use rxResource()?"

Yes, it's variant **D** in the demo, and it passes the same 6 scenarios.

```ts
factory: (params) =>
  rxResource({
    params,
    stream: ({ params: username }) =>
      new Observable((subscriber) => {
        const controller = new AbortController();
        lookup(username, controller.signal).then((r) => (subscriber.next(r), subscriber.complete()));
        return () => controller.abort();   // unsubscribe → abort
      }),
  }),
```

<!--
Speaker notes:
rxResource is resource() with an Observable-shaped loader. Cancellation is unsubscribe, so the
Observable's teardown is where you turn "unsubscribed" back into an abort. An Observable with proper
teardown, like HttpClient's, cancels for free. The docs show an rxResource factory too.
-->

---
footer: false
---

# Q&A · "What does `reloadValidation()` reload?"

```ts
// FieldNode._reloadValidation(), behind field().reloadValidation()
for (const key of this.logicNode.logic.getMetadataKeys()) {
  if (key[IS_ASYNC_VALIDATION_RESOURCE]) this.metadata(key).reload?.();
}
```

The marker sits on the metadata **key**, so a custom resource gets reloaded too.

<!--
Speaker notes:
reloadValidation() is public on field state: "Reloads all asynchronous validators for this field
and its descendants." validateAsync tags its metadata key with IS_ASYNC_VALIDATION_RESOURCE, and
reloadValidation walks the keys and calls reload() on whatever resource is behind the tagged ones.
Because the key is marked, not the resource, your custom factory participates for free.
It's not called automatically (not on submit, in 22.1.1); you call it, for example after the server
state changed under you.
-->

---
footer: false
---

# Q&A · "The first keystroke wasn't debounced in my test"

- The validation resource is created **lazily**, on first read of the field's validation state
- `debounced()` resolves its **initial** value immediately
- In a real app the template reads it on first render (empty value), so typing is debounced
- In a test, read `field().pending()` once before typing

<!--
Speaker notes:
I hit this writing the spec. Nothing read the field until after the first value was set,
so that first value became debounced()'s initial value and fired immediately.
Not a bug in an app with a template, just something to know when testing headless.
-->
