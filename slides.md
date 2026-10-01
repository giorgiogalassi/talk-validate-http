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

<p class="text-sm caption">Angular 22+ · source quoted at v22.1.1</p>

<!--
Speaker notes:
Let the title sit. No preamble.
40-minute extended slot, Advanced. Everything here holds for Angular 22+; every source line on screen
is pinned to v22.1.1, and the demo app runs on exactly that version. The 25-minute cut is slides-25.md.
Before walking on (see demo/STAGE.md): `npm run stage` in demo/ (API with 2 s latency + dev server).
Two browser tabs: http://localhost:4200/?latency=2000 (debounce 300, steps 1–2) and
http://localhost:4200/?latency=2000&debounce=0 (debounce off, step 3). DevTools on the Network tab,
lookup log cleared, editor on validators.ts, a second terminal pane showing the [api] log.
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

# One question for every API

- **<span class="accent">The primitive</span>** — the reactive thing that holds async state: params in; status, value, error out; stale work cancelled
- **<span class="accent">The policy</span>** — the decisions on top: when to run, how long to wait, what a result means

<div class="callout">What's the primitive, <span class="accent">and what's the policy on top?</span></div>

<p class="text-sm caption">Let's ask it all the way down, starting from <code>validateHttp()</code>.</p>

<!--
Speaker notes:
~1 minute. This is the lens for the whole talk, so say it slowly.
The primitive is the part you learn once: it's the same whether you're fetching a product list or
validating a username. The policy is the part that's actually new in a new API, and usually it's small.
Every layer we open gets a badge: primitive, policy, or preset (a policy with the primitive already
picked for you). By the end we'll have traced exactly where the primitive ends and the policy begins,
and you'll be able to do the same on the next API Angular ships.
-->

---
layout: section
---

# Layer 1 · validateHttp()

<!--
~3 minutes for this section.
-->

---

# The entire function <span class="verdict preset">Preset</span>

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

<p class="text-sm caption">forms/signals/src/api/rules/validation/validate_http.ts · v22.1.1 · L96–110 · types stripped</p>

<!--
Speaker notes:
This is not simplified, apart from the generics and one cast I stripped to fit. This is the body.
One call to validateAsync, options passed through. No await, no subscription, no cancellation logic.
Click to highlight the factory. Out of the whole file, that's the only line that does anything
HTTP-related, and it's the only line that picks a primitive: httpResource. Every other line forwards
policy (request, debounce, when, onSuccess, onError) to validateAsync untouched.
Verdict: preset. validateHttp adds no policy of its own; it's validateAsync with the primitive picked.
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

<div class="callout">The primitive: <code>httpResource()</code>. Everything else in that call: <span class="accent">policy.</span></div>

<!--
Speaker notes:
DEMO STEP 1 (~1 min, no typing of code). Tab 1 (debounce 300). validateAsync is public API, so this is legal user code.
Browser: type "giorgio" in field A, then in field B. Same pending, same "taken", and the lookup log
shows one request per pause for each. Type "freename" in B: valid.
Line to say: "If you can write the framework's implementation in your own file, it isn't a black box anymore."
Transition: "So the pile must be one level down, in validateAsync. It isn't there either."
-->

---
layout: section
---

# Layer 2 · validateAsync(), the policy

<!--
~7 minutes for this section. Four pieces of policy, zero new async mechanisms, then the trace.
-->

---

# Sync-before-async is a `return undefined` <span class="verdict policy">Policy</span>

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

<p class="text-sm caption">validate_async.ts · v22.1.1 · L128–180 · condensed</p>

<!--
Speaker notes:
Verdict: policy. validateAsync is where all the policy lives, and there are four pieces of it:
the sync-validation gate, `when`, debounce, and the mapping from resource status to form errors.
This slide is the first two.
This computation feeds the resource's params. When sync validation fails, it returns undefined.
The `when` option is the same trick: return undefined, validation is off.
And a resource with undefined params goes idle and doesn't start a load. That is documented,
public resource behaviour: the primitive's, not a forms detail.
So the docs promise "async validation runs only after sync validation passes", and nobody wrote
code to keep that promise. The policy decides; the primitive already knew how to sit still.
(Precision: going idle doesn't abort a load that's already running; it gets discarded. More on that later, or just this sentence in the 25-min cut.)
Demo tie-in if time allows: type "ab" in any field, the log stays empty.
-->

---

# `pending()` is a resource status, read through a rule <span class="verdict policy">Policy</span>

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
The fourth piece of policy: error mapping. Lightly condensed: the real one wraps each result in
addDefaultField() to attach it to the field.
The point: field().pending() is a projection of res.status(). There's no "isChecking" flag
anywhere in Signal Forms. If you already know resource(), you already know every state an async
validator can be in.
(The third piece, debounce, gets its own section later. 25-min cut: just name it, the section is skipped.)
-->

---

# Pending comes from the graph, not a flag <span class="verdict primitive">Primitive</span>

```ts
// no debounce: ResourceImpl's state linkedSignal, synchronous
status = request === undefined ? 'idle' : 'loading';

// with debounce: debounced()'s effect sets 'loading'
//   → ɵchain (ctx.chain) throws ResourceParamsStatus.LOADING
//   → ResourceImpl catches it in its params evaluation → status 'loading'
```

- **<span class="accent">No debounce</span>** — the first read after the change already says `'loading'`
- **<span class="accent">With debounce</span>** — one effect later, and effects flush before render

<div class="callout">Either way, no flicker. <span class="accent">Only the data is async.</span></div>

<!--
Speaker notes:
The third badge: primitive. ResourceImpl is the engine behind every resource(), httpResource() and
rxResource(). Status, cancellation and staleness live here, not in forms.
Two paths, and I want to be precise because this is where "it's synchronous" gets said loosely.
Without debounce, the transition lives in a linkedSignal: lazy, but pure and synchronous, so the
very next read of status() says loading.
With debounce, the switch to loading happens in debounced()'s effect. It's in the spec: set the value
and read pending() in the same line, you get false; one tick later, true. Root effects run before
the view refreshes, so the user never sees a gap.
Nothing here is a flag someone remembered to set. It's the graph.
-->

---

# Where the primitive ends and the policy begins

<div class="dense">

| Policy · `validateAsync()` (forms) | Primitive · any `Resource` (core) |
| --- | --- |
| sync-validation gate → params `undefined` | params `undefined` → `idle`, no load |
| `when` → params `undefined` | new params → `loading`, the previous load aborted |
| `debounce` → `debounced()` + `ctx.chain` | a late result for old params is discarded |
| status → `pending` · `onSuccess` · `onError` | `status()` · `value()` · `error()` |

</div>

<div class="callout">They meet in one place, the <code>factory</code>: <span class="accent">params go in as a signal, a <code>Resource</code> comes back.</span></div>

<!--
Speaker notes:
This is the trace the talk promised. Left column: everything validateAsync adds, the whole policy,
about fifty lines of forms code. Right column: behaviour that existed before Signal Forms and works
the same for a data fetch in any component.
Read across the rows: every policy decision is expressed as params (undefined, or a debounced value),
and every outcome is read back as status. The policy never touches a request, a timer handle or an
AbortController directly.
And the boundary between the columns is one option: factory. Params in as a signal, a Resource out.
That's the seam we're about to cut.
-->

---
layout: section
---

# The factory is the seam

<!--
~11 minutes. The centrepiece. What's new here isn't the swap itself (the docs show one),
it's that the swap IS validateHttp with another primitive, plus the two rules nobody writes down.
Protect this section in the 25-min cut.
-->

---

# The docs call it "lower-level"

> "`validateAsync()` is **a lower-level API** that exposes Angular's resource primitive directly."

<p class="text-sm caption">angular.dev · Forms › Signal Forms › Async operations</p>

<div class="callout">It isn't lower. <code>validateHttp()</code> <em>is</em> <code>validateAsync()</code>, with the primitive picked for you.</div>

<!--
Speaker notes:
If you've read the async-operations guide, you've seen validateAsync with resource() and with rxResource().
So I'm not going to pretend the swap is a secret. What the docs frame as two tools, a convenient one
and a lower-level one, is one policy: we just saw that validateHttp's body is a validateAsync call.
The "lower-level API" is the policy itself. The HTTP one is a preset of it.
-->

---

# What does validateAsync() actually need?

```ts
factory: (params: Signal<TParams | undefined>) => Resource<TResult | undefined>
```

- **<span class="accent">Reads</span>** — `status()`, `value()`, `hasValue()`, `error()`
- **<span class="accent">Never touches</span>** — URLs, `HttpClient`, `fetch`

<div class="callout">Anything that is a <code>Resource</code> fits. <span class="accent">HTTP is just the first primitive they shipped.</span></div>

<!--
Speaker notes:
Read the type out loud. The factory gets a signal of params and must give back a Resource.
The policy only ever reads status, value, hasValue and error. It has no way of knowing,
and no reason to care, that there's HTTP behind those signals.
-->

---

# The framework already does the swap <span class="verdict preset">Preset</span>

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

<p class="text-sm caption">validation/standard_schema.ts · v22.1.1 · L104–124 · condensed</p>

<!--
Speaker notes:
This is the answer to anyone who thinks a non-HTTP resource here is a hack.
Async Standard Schema validation, Zod with async refinements for example, is validateAsync with a
plain resource() whose loader awaits a Promise. First-party, shipped, no HTTP.
So validateHttp and validateStandardSchema are siblings: same policy, different primitive.
Same badge too: a preset. Two presets of one policy.
-->

---
layout: center
---

# <span class="accent">LIVE</span> · swap the primitive yourself

Field **C**: same policy, a hand-rolled `resource()` that posts to a Web Worker

<!--
Speaker notes:
DEMO STEP 2 (~4 min). Tab 1 (debounce 300). Editor: validators.ts, variant C. Pre-staged per
STAGE.md: C starts as a copy of B (URL params + httpResource factory).
Live edit, two lines: params becomes ({ value }) => value(), factory becomes the resource() whose
loader calls worker.check(username, abortSignal) (inject(UsernameWorker)). Save; the app reloads.
Browser, Network tab visible, running with ?latency=2000:
 1. Type "giorgio", stop. Pending, then "taken" after ~2 s. Network tab: EMPTY. Log: "worker start/done".
 2. Type "giorgio", wait about a second (the lookup is now running), type "x".
    Log: "worker aborted giorgio", "worker stopped giorgio", "worker start giorgiox". Still nothing on the network.
    "aborted" is the loader seeing the AbortSignal; "stopped" is the Worker confirming it dropped the job.
Don't type fast and expect an abort here: with debounce on, fast typing coalesces into one lookup,
so nothing is in flight to cancel. Step 3 turns debounce off for exactly that reason.
Line to say: "Same policy, same pending, same cancellation, and nothing went over the wire."
Fallback: `git checkout -- src/app/spike/validators.ts` restores the finished variant C.
-->

---

# One factory changed

```ts {2,4-10}
validateAsync(p.username, {
  params: ({ value }) => value(),
  debounce: 300,
  factory: (params) => {
    const worker = inject(UsernameWorker);   // posts to a Web Worker
    return resource({
      params,
      loader: ({ params: username, abortSignal }) => worker.check(username, abortSignal),
    });
  },
  onSuccess: (res) => (res?.available === false ? { kind: 'taken' } : undefined),
  onError: () => ({ kind: 'unreachable' }),
});
```

<div class="callout">Gate, <code>when</code>, debounce, pending, errors: <span class="accent">same policy, new primitive.</span></div>

<!--
Speaker notes:
The diff is the factory, and params becoming the raw value instead of a URL. Nothing else moved.
The Worker is a stand-in, and I'll say it before someone else does: the "work" is a timer in a thread.
What matters is that it's async, cancellable, and not HTTP; put WASM or a local model behind the same messages.
If you want a non-contrived example, you just saw one: validateStandardSchema.
Everything we listed in the first section came along for free, because none of it ever lived in the HTTP part.
But "behaves identically" has two conditions. Next slide.
-->

---

# "Behaves identically", on two conditions

1. **<span class="accent">Rule 1</span>** — read `params` only inside the resource's params evaluation
2. **<span class="accent">Rule 2</span>** — the loader honours `abortSignal` itself

<div class="callout">Break rule 1: you read a sentinel instead of a value. Break rule 2: the UI is still right, <span class="accent">but the work never stops.</span></div>

<!--
Speaker notes:
These are the two rules for putting any async source behind a validator. Neither is in the type
signature, which is why they're worth a slide.
Both are tests in the repo, not opinions: rule 1 with an effect that reads params while debouncing,
rule 2 with a loader that drops the abortSignal: same UI, and the Worker finishes both jobs anyway.
One slide each, with the code.
-->

---

# Rule 1 · read `params` only inside params evaluation

While debouncing, reading `params()` **throws**. On purpose.

```ts
// ✅ inside a resource's params: direct, wrapped, or through a computed
factory: (params) => resource({ params, loader })
factory: (params) => resource({ params: () => ({ q: params() }), loader })

// ❌ outside it: an effect, a template, an untracked read
factory: (params) => { effect(() => log(params())); return resource({ params, loader }); }
//                                  ^ throws ResourceParamsStatus.LOADING while debouncing
```

Only a resource's params evaluation catches the `ctx.chain()` sentinel and turns it into a status.

<!--
Speaker notes:
With debounce on, the signal you get is a computed that calls ɵchain, the same function a resource's
params receive as ctx.chain, on the debounced resource. While the debounce is pending, it doesn't
return a value: it throws a sentinel, ResourceParamsStatus.LOADING.
ResourceImpl catches that sentinel inside its params evaluation and turns it into status 'loading'.
Wrapping is fine, even through a computed, because the throw still surfaces inside that evaluation.
Reading it in the loader is fine too, because the loader only runs once params have resolved.
Read it anywhere else, an effect, a template binding, and you catch the sentinel yourself.
I tested five shapes; only the effect one saw it, and that case is in the spec.
The API doc says: "The given params should be used as is to create the resource." Now you know why.
-->

---

# Rule 2 · the loader honours `abortSignal`

`resource()` **signals** the abort. Stopping the work is **your loader's job**.

```ts {6-9}
check(username: string, abortSignal: AbortSignal): Promise<Availability> {
  const id = this.nextId++;
  return new Promise((resolve, reject) => {
    this.jobs.set(id, { resolve, reject });
    this.port.postMessage({ type: 'check', id, username });
    abortSignal.addEventListener('abort', () => {
      this.port.postMessage({ type: 'cancel', id });   // the Worker clears the job
      reject(abortSignal.reason);
    }, { once: true });
  });
}
```

The docs' own `resource()` example never reads `abortSignal`. `httpResource()` gets it for free; a custom loader has to earn it.

<p class="text-sm caption">demo · username-lookup.ts · UsernameWorker.check() · condensed</p>

<!--
Speaker notes:
This is the honest part of the talk. When a new load starts, resource() aborts the old load's
AbortController and throws away the stale result, so your UI is always correct. But if your loader
ignores the abortSignal, the work keeps running. Correct UI, wasted work.
The spec proves the difference: same resource, same Worker; with the signal wired, the Worker reports
"stopped" and finishes one job. Drop the signal, the UI is identical, and the Worker finishes both.
This is cooperative cancellation: the Worker's work yields, so the cancel message gets through.
If your Worker runs a synchronous CPU loop, a message can't interrupt it: terminate() the Worker on
abort and spawn a new one instead. Same rule, blunter tool.
The example in the official guide doesn't take abortSignal at all. It's correct, and it wastes work
on every superseded keystroke. httpResource wires the signal all the way down to fetch.
-->

---
layout: section
---

# Debounce and lazy aborts

<!--
~6 minutes. CUT in the 25-minute version; the lazy-abort idea survives in the timing slide after demo step 3.
-->

---

# Debounce: two primitives, no timer in validateAsync()

```ts
if (opts.debounce !== undefined) {
  const debouncedResource = debounced(() => params(), opts.debounce);
  const wrappedParams = computed(() => ɵchain(debouncedResource));
  return opts.factory(wrappedParams);
}
return opts.factory(params);
```

- **<span class="accent">debounced()</span>** — exported from `@angular/core`, docblock `@experimental 22.0`. The timer lives here.
- **<span class="accent">ɵchain</span>** — the private export behind `ResourceParamsContext.chain`. In your code: `ctx.chain(resource)`. There is no standalone `chain()`.

<!--
Speaker notes:
No setTimeout in validateAsync. It wraps the params in a debounced() resource and chains it into the
params the factory receives, exactly the way you'd chain two resources in your own code.
The timer exists, inside debounced() in core; validateAsync just composes it. Debounce is policy
built out of two primitives.
(Precision if challenged: forms' separate debounce() rule, the one that debounces the field value itself, does use setTimeout. This slide is about validateAsync's debounce option.)
Say it carefully: there's no chain() function you can import. The public door is the params context
of a resource: resource({ params: (ctx) => ctx.chain(other) }). Forms uses the ɵ export of the same function.
And debounced() is exported but still experimental while validateAsync is stable, so the forms team
is dogfooding an experimental API inside a stable feature. Worth noticing.
-->

---

# Your validator can debounce the same way

```ts {3-9}
validateAsync(p.username, {
  params: ({ value }) => value(),                 // no debounce option
  factory: (params) => {
    const worker = inject(UsernameWorker);
    const settled = debounced(params, 300);       // @experimental 22.0
    return resource({
      params: (ctx) => ctx.chain(settled),        // throws 'loading' while settling
      loader: ({ params: username, abortSignal }) => worker.check(username, abortSignal),
    });
  },
  onSuccess, onError,
});
```

<div class="callout">Variant <b>E</b>: same pending timing, same lazy aborts, <span class="accent">same scenarios green.</span></div>

<!--
Speaker notes:
If the framework can compose it, so can you, with public API. No debounce option on validateAsync;
the factory does it: debounced() over the params, ctx.chain() into the resource.
Rule 1 still holds: debounced() evaluates its source as a params function too, and the only other
read is inside the resource's params.
Why bother? Per-source debounce, debouncing only the expensive part, or a custom wait: debounced()
also takes a function that returns a promise. The caveat is the one from the last slide: debounced()
is experimental, so pin your Angular version if you rely on it.
Variant E in the demo runs the same spec as the others.
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
Correct UI in both cases. But "cancel" means "discard, and abort when the next load starts".
-->

---
layout: section
---

# Watch it cancel

<!--
~4 minutes.
-->

---
layout: center
---

# <span class="accent">LIVE</span> · type faster than the server

Debounce **off**. Field **A**, then field **C**: DevTools → Network, the server log, the lookup log

<!--
Speaker notes:
DEMO STEP 3 (~2 min). Switch to tab 2: ?latency=2000&debounce=0. Say it out loud:
"I've turned debounce off. With debounce on, fast typing coalesces into one request and there's
nothing in flight to cancel. Off, every keystroke starts a load, so every next keystroke cancels one."
Field A (the real validateHttp): type "giorgio" at normal speed.
Network tab: gio, gior, giorg, giorgi go "(canceled)" in red, giorgio completes ~2 s later.
Terminal pane: "[api] ✕ … (client aborted)" per keystroke. The abort crossed the network.
Field C (the Worker): same typing. Lookup log: "aborted" + "stopped" pairs per keystroke, network empty.
The Worker version cancels just as precisely, because the loader honours rule 2.
Optional, back in tab 1 (debounce on): type "giorgio", wait ~1 s, type "x": one cancel, landing
~300 ms after the "x", not on the keystroke. That's the lazy abort.
Line to say: "That red line is four different cancellation mechanisms handing off to each other."
25-min cut: the next slide (four relays) is skipped; say the line and go straight to the timing slide.
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
teardown logic, and the platform's fetch signal. Nobody in forms wrote any of it: it's the primitive.
Compare with the Worker version: there, steps 2 to 4 are the one cancel message we wrote ourselves,
and "stopped" in the log is the Worker confirming it.
-->

---

# When pending flips, when work is really cancelled

<div class="dense">

| | Debounce off | Debounce on |
| --- | --- | --- |
| `pending()` becomes true | synchronously, on the next read | one effect later, before render |
| in-flight load aborted | when the next load starts: the next effect | when the next load starts: ≈ debounce after the keystroke |
| field goes sync-invalid mid-flight | never aborted: finishes, discarded | never aborted: finishes, discarded (pending for the window) |
| the work actually stops | `httpResource()`: down to `fetch()` · your loader: only if it honours `abortSignal` | same |

</div>

<div class="callout">A stale result is <b>always</b> discarded. The load is aborted only when a newer one starts. <span class="accent">The work stops only if the loader listens.</span></div>

<!--
Speaker notes:
This is the precise picture, and every cell is an assertion in the demo spec, for every variant.
Pending: synchronous without debounce (linkedSignal), one effect later with it (debounced()'s effect).
Abort: never on the keystroke itself, always when the next load starts, which is either the next
effect or the end of the debounce window.
Going idle never aborts, with or without debounce: the late result is dropped by identity.
And "cancelled" has three meanings that people mix up: discarded (always, the primitive guarantees it),
aborted (the signal fires when a newer load starts), stopped (only if the loader listens: rule 2).
-->

---
layout: section
---

# Zoom out

<!--
~4 minutes, including the close.
-->

---

# The whole stack, sorted

| Layer | Role | Adds |
| --- | --- | --- |
| `validateHttp()` | <span class="verdict preset">Preset</span> | picks `httpResource()` as the primitive, nothing else |
| `validateAsync()` | <span class="verdict policy">Policy</span> | gate, `when`, debounce, status → errors |
| `httpResource()` | <span class="verdict primitive">Primitive</span> | HTTP loader, `headers()`, `statusCode()`, `progress()` |
| `ResourceImpl` | <span class="verdict primitive">Primitive</span> | the engine: status, cancellation, staleness |
| `HttpClient` | Transport | interceptors, XSRF, transfer cache |
| `FetchBackend` | Floor | the platform's `fetch()` |

<!--
Speaker notes:
Every badge from the talk, in one table. Read the Role column top to bottom:
one preset, one policy, the primitive and its engine, and the transport under it.
The only thing forms actually added is validateAsync's policy. The async machinery lives
in ResourceImpl, and neither it nor the transport is a forms thing.
There is no forms-specific async system to learn, work around, or wait on the team to extend.
-->

---

# The payoff: test the validator, not the network

```ts
TestBed.configureTestingModule({
  providers: [
    provideHttpClient(withInterceptors([logUsernameRequests, fakeUsernameApi(150)])),
    { provide: USERNAME_WORKER_PORT, useFactory: () => new InProcessWorker() },
  ],
});

describe.each([
  'validateHttp',                      'validateAsync + httpResource',
  'validateAsync + resource (Worker)', 'validateAsync + rxResource (Worker)',
  'validateAsync + resource + own debounced() (Worker)',
])
```

<div class="callout">5 implementations, one spec: idle, pending, valid, error, cancel, pending timing, invalid mid-flight, debounce off, both rules. <span class="accent">50/50 green.</span></div>

<!--
Speaker notes:
Because the validator is a policy on a resource, testing it is testing a resource.
The demo repo has one spec that runs the same scenarios against all five variants: HTTP answered by
an interceptor, the Worker's real code run in-process (jsdom has no Worker, so only the thread hop is
simulated). Same assertions, all green. That's the strongest evidence I have that they're the same thing.
Plus one test per rule: an effect that reads params sees the sentinel; a loader that drops
abortSignal leaves the Worker finishing work nobody wants.
One gotcha if you write these tests: read the field's state once before typing, like a template
does on first render (backup slide if anyone asks).
-->

---

# What you take home

1. **<span class="accent">A question</span>** — for every new Angular API: what's the primitive, and what's the policy on top? Learn the primitive once; for each new API, learn only its policy.
2. **<span class="accent">Two rules</span>** — for any async source behind a validator: read `params` only inside the resource's params evaluation; the loader honours `abortSignal` itself.
3. **<span class="accent">A precise picture</span>** — pending flips on the next read, or one effect later with debounce; a load is aborted only when a newer one starts; the work stops only if the loader listens.

<!--
Speaker notes:
~1 minute. Three things, one per line, and don't rush them.
The question is the one that outlives this talk: Angular will ship another API next year, and the
first thing to ask is which part is the primitive you already know and which part is new policy.
The rules are Monday-morning usable: a Worker, WASM, a WebSocket, whatever async source you have.
The picture is what lets you debug it at 6pm on a Friday, because you know where each behaviour lives.
Then the payoff.
-->

---
layout: center
---

# In modern Angular, a new API is usually a reactive primitive <span class="accent">plus a policy.</span>

Once you can separate the two, you stop waiting for the framework to ship the feature you need.

<div class="callout">You'll stop asking whether Angular supports your async source, and start asking <span class="accent">which resource it is.</span></div>

<!--
Speaker notes:
~1 minute. The payoff. Say the headline slowly.
validateHttp was the example, not the point. It was a preset of a policy on a primitive; once you saw
the split, a "missing feature", validating against a Worker, stopped being a feature request and
became a factory and two rules. debounced() is the same shape one level down: a resource with a
wait policy.
Then the closing line, word for word, and pause:
"You'll stop asking whether Angular supports your async source, and start asking which resource it is."
Straight to Thank you.
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
      <span class="text-sm caption">All my links</span>
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
Repo is live at github.com/giorgiogalassi/talk-validate-http.
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

Yes, it's variant **D** in the demo, and it passes the same scenarios.

```ts
factory: (params) =>
  rxResource({
    params,
    stream: ({ params: username }) =>
      new Observable((subscriber) => {
        const controller = new AbortController();
        worker.check(username, controller.signal).then((r) => (subscriber.next(r), subscriber.complete()));
        return () => controller.abort();   // unsubscribe → abort → cancel message
      }),
  }),
```

<!--
Speaker notes:
rxResource is resource() with an Observable-shaped loader. Cancellation is unsubscribe, so the
Observable's teardown is where you turn "unsubscribed" back into an abort, and rule 2 still applies.
An Observable with proper teardown, like HttpClient's, cancels for free. The docs show an rxResource factory too.
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

---
footer: false
---

# Q&A · "Can I use chain and `debounced()` myself?"

- **<span class="accent">chain</span>** — no standalone export. Public as `ResourceParamsContext.chain`: `resource({ params: (ctx) => ctx.chain(other) })`. Forms imports the private `ɵchain`, the same function.
- **<span class="accent">debounced()</span>** — exported from `@angular/core`, but the docblock says `@experimental 22.0`.
- **<span class="accent">validateAsync() / validateHttp()</span>** — stable since 22.0. A stable policy built on an experimental primitive.

<p class="text-sm caption">debounced(): core/src/resource/debounce.ts:32 · chain: ResourceParamsContext in @angular/core · v22.1.1</p>

<!--
Speaker notes:
The precise answer, because this gets said wrong a lot, including by me in an early draft:
chain isn't internal and isn't a function you import. It's on the params context every resource
gets. debounced() is importable, but experimental: if you build variant E in production, pin
your Angular version and re-check on upgrade.
-->
