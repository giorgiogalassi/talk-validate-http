# Implementation Plan — The Validator That Isn't

Living build doc for the deck and its demo. Abstract and original run of show live in the
vault (`drafts/pieces/2026-07-29-validate-http-internals/talk/`); the deck (`slides.md`) is now
the source of truth for structure and timing. Stage procedure: `demo/STAGE.md`.

Last updated: 2026-09-30 (aligned with the final CFP abstract: primitive + policy framing, Worker cancellation, two rules, payoff).

## Version pin

angular/angular **v22.1.1** (commit `565dbb2`), matching the article's source trace. Cited lines
checked against the tag: `validate_http.ts` L96–110, `validate_async.ts` L128–180,
`standard_schema.ts` L104–124. Re-check only if a newer release moves a cited line.

**Demo on 22.3.0 since 2026-11-24.** The source trace stays pinned to v22.1.1. Checked against the
22.3.0 build (`fesm2022/signals.mjs`): `validateHttp()` is still one `validateAsync()` call and
`validateAsync()` is unchanged. One behaviour change in core: `ResourceImpl.loadEffect()` now calls
`abortInProgressLoad()` before the `request === undefined` check, so a resource going idle aborts the
load in flight (see "Lazy aborts"). Cited line numbers not re-checked against the 22.3.0 tag.

## Status

- **Deck:** `slides.md`, 40 min, 41 slides incl. 5 backup. 25-min cut: `slides-25.md` (imports
  29 slides, `#1-5,7,10-11,13-22,27-28,30,34-41`: drops the debounce section and the testing payoff,
  keeps the Web Worker swap + both rules + the timing slide + the payoff). `slides-type.md` mirrors
  the same content (45 slides with its beat slides). All three build; the new/changed slides were
  exported to PNG and checked for overflow at 1280×720.
- **Demo:** 5 variants (A `validateHttp` · B `validateAsync`+`httpResource` · C `validateAsync`+
  hand-rolled `resource()` on a Web Worker · D `validateAsync`+`rxResource` on the Worker · E
  `validateAsync`+`resource()` debouncing itself with `debounced()` + `ctx.chain()`). Real local API
  with configurable latency; `npm run stage` = 2 s latency; `?debounce=0` turns debounce off for the
  cancel demo; username `offline` exercises `onError`.
- **Worker cancellation:** `UsernameWorker.check(username, abortSignal)` (`username-lookup.ts`) posts
  `check`, and on `abort` posts `cancel` and rejects. The Worker (`createUsernameChecker` in
  `username-check.ts`, wrapped by `username-check.worker.ts`) clears the job and replies `stopped`,
  which the log shows, so "aborted" (loader saw the signal) and "stopped" (work really ended) are
  distinct. Cooperative cancel was chosen over `terminate()`+respawn because the work yields; the
  deck names `terminate()` as the tool for synchronous CPU-bound work.
- **Spec:** `equivalence.spec.ts`, **50/50**, stable over 3 repeated runs: 5 variants × 7 scenarios
  (idle, pending+coalesce, valid, error, cancel incl. Worker `stopped`, one-tick pending, invalid
  mid-flight) + 4 variants × 3 debounce-off scenarios (synchronous pending, every superseding
  keystroke aborts, idle aborts since 22.3) + rule 1 (effect read sees the sentinel) + rule 2 (honoured:
  Worker stops the job; ignored: same UI, Worker finishes both). The Worker's real code runs
  in-process (`in-process-worker.ts`, jsdom has no Worker); the old timer fake is gone.
- **Browser-verified 2026-09-30** (Chromium, 600 ms, `?debounce=0`): A → 4 × `ERR_ABORTED` on the
  network; C and E → `aborted` + `stopped` per keystroke, zero requests; D `offline` → `unreachable`.

## Verified findings (all used on slides)

- **Framing (2026-09-30):** every layer is a primitive, a policy, or a preset. `validateHttp()` is a
  preset (it only picks `httpResource()`), `validateAsync()` is the policy (sync gate, `when`,
  debounce, status → errors), `resource()`/`ResourceImpl` is the primitive. Replaces the old
  "disguise or enhancement?" lens everywhere in both decks.
- **`chain` / `debounced()` checked against `demo/node_modules` (22.1.1), 2026-09-30:** no standalone
  `chain` export; it's `ResourceParamsContext.chain` (`readonly chain: <T>(resource: Resource<T>) => T`),
  and `@angular/core` exports it only as private `ɵchain`. `debounced` is exported from `@angular/core`
  with docblock `@experimental 22.0`. `debounced()` evaluates its source with `setInParamsFunction(true)`,
  so a factory can debounce itself (variant E) without breaking rule 1.
- **validateHttp = validateAsync + httpResource factory.** The docs call validateAsync "a lower-level
  API"; it's the same API. `validateStandardSchema` is the framework's own non-HTTP swap.
- **Factory contract:** read `params` only inside a resource's params evaluation. With debounce,
  reading it elsewhere throws `ResourceParamsStatus.LOADING`. Five shapes tested: direct, arrow-wrapped,
  computed-wrapped, read-in-loader work; effect read sees the sentinel.
- **Cancellation has two halves:** resource() signals, the loader must stop the work. The docs'
  `resource()` example ignores `abortSignal`.
- **Pending timing:** without debounce, synchronous (linkedSignal). With debounce, one effect later
  (`debounced()` sets 'loading'), before render. Spec: false synchronously, true after one tick.
- **Lazy aborts:** an in-flight load is aborted when the next load starts (≈ debounce after the
  keystroke). **Since 22.3** going sync-invalid mid-flight aborts too: params go `undefined`, the
  resource goes idle and `loadEffect()` aborts the load in flight. Up to 22.2 it never aborted: the
  load completed and was discarded by identity. With debounce on, the field is still minLength-invalid
  AND pending for the debounce window.
- **`debounced()` never delays its initial value;** the validation resource is created lazily →
  tests must read field state before typing.
- **`reloadValidation()`** is public on field state and not called automatically in 22.1.1 (not re-checked on 22.3.0); the
  `IS_ASYNC_VALIDATION_RESOURCE` marker on the metadata key makes custom resources reload too.

## Open items

- [ ] **Record fallbacks** for all three demo steps (video + Network-tab screenshot in `src/`),
      before the CFP deadline if the recording is wanted for the submission. Checklist in `demo/STAGE.md`.
- [ ] **Rehearse with a timer** against the per-section budgets in the speaker notes; the 25-min cut
      is tight (~24 min on paper).
- [x] Repo pushed 2026-09-28: https://github.com/giorgiogalassi/talk-validate-http (public; matches the Thank-you slide).
      The step-2 fallback (`git checkout -- validators.ts`) now has a committed final state.
- [ ] Optional: make the Worker do real, chunked work (e.g. a hashed local blocklist) instead of a
      timer, if the "contrived worker" objection comes up in rehearsal. The deck already pre-empts it.
- [ ] **Rehearse step 3 with debounce off** (tab 2, `?latency=2000&debounce=0`) and re-record the
      fallbacks: the step-2/3 logs now include `stopped` lines and step 3 cancels once per keystroke.
- [ ] **Timing:** the 40-min deck gained 4 content slides (trace, two rules, own debounce, timing) and
      the payoff; section budgets in the notes sum to ~39 min. The 25-min cut is 29 slides (was 26):
      time it; if long, drop slide 17 (`validateStandardSchema`) from the range first.
- [ ] Re-run the spec on Angular v23 when it ships (the abstract says "Angular 22+"; `debounced()` is
      experimental and may move).

## Challenge review (2026-09-28), applied

All four parts came back "revise", none "reconsider". Applied: corrected the pending-timing slide
(was "synchronous, same tick", wrong with debounce); added the going-invalid lazy case (+ spec);
reframed section 4 against the docs ("lower-level") with `validateStandardSchema` as first-party
proof; moved the factory rule next to the live swap; "no timer in forms" title; demo step 1 turned
into a reveal (no live typing); stage latency 2 s to widen the cancel window from ~300 ms to ~1.7 s;
fixed the step-2 note (fast typing can't show an abort); `scripts/dev.mjs` launcher + port guard;
rxResource variant D tested; explicit 25-min cut; reloadValidation backup retitled (no submit caller).

## Changelog

- 2026-09-28 — project scaffolded from the talk-a2ui layout.
- 2026-09-28 — generalization spike: 3 variants, 12/12.
- 2026-09-28 — deck written; demo made stage-ready (API server, Worker, DI lookup); factory-rule claim corrected after testing five shapes.
- 2026-09-28 — challenge review applied (see above); rxResource variant; 24/24; 25-min cut; code font 14px.
- 2026-09-30 — aligned with the final CFP abstract. Framing is now "what's the primitive, and what's the
  policy on top?" (badges Preset / Policy / Primitive; new trace slide "Where the primitive ends and the
  policy begins"). Live swap explicitly through `validateAsync()`'s `factory`; Web Worker is the single
  non-HTTP source (IndexedDB mentions dropped). New slides: two rules (+ Rule 1 / Rule 2 in code), own
  debounce with `debounced()` + `ctx.chain()`, "when pending flips, when work is really cancelled",
  closing payoff + closing line; Q&A on chain/`debounced()` status. Step 3 runs with debounce off.
  Demo: Worker client/worker split, `stopped` ack, variant E, `offline` error path, `?debounce=`;
  spec 24 → 50. 25-min cut now drops the testing payoff as the README always said.
- 2026-09-28 — restyled after talk-context-engineering (cold open, accent lists, callouts, footer, Thank-you with QR); outcome reframed as a "disguise or enhancement?" lens: framing slide, verdict badges on reveals, verdict column in the stack table, closing "What you take home" slide. Abstract's last paragraph updated to match.
- 2026-11-24 — demo moved to Angular 22.3.0. 9 equivalence tests (all 5 variants) flipped from "going idle never
  aborts" to "going idle aborts" (core change in `ResourceImpl.loadEffect()`); 50/50 green. Slide text not
  changed: slides.md 215–230, 299–301, 629–644, 711–725 (and the same content in slides-type.md and the
  25-min cut) still say idle never aborts and need Giorgio's rewrite.
