# Implementation Plan — The Validator That Isn't

Living build doc for the deck and its demo. Abstract and original run of show live in the
vault (`drafts/pieces/2026-07-29-validate-http-internals/talk/`); the deck (`slides.md`) is now
the source of truth for structure and timing. Stage procedure: `demo/STAGE.md`.

Last updated: 2026-09-28 (deck written, challenge review applied).

## Version pin

angular/angular **v22.1.1** (commit `565dbb2`), matching the article's source trace. Cited lines
checked against the tag: `validate_http.ts` L96–110, `validate_async.ts` L128–180,
`standard_schema.ts` L104–124. Re-check only if a newer release moves a cited line.

## Status

- **Deck:** `slides.md`, 40 min, 35 slides incl. 4 backup. 25-min cut: `slides-25.md` (imports
  26 slides from `slides.md`, `npm run dev:25`). Both build; no slide overflows at 1280×720 with
  14px code font (checked programmatically + screenshots).
- **Demo:** 4 variants (A `validateHttp` · B `validateAsync`+`httpResource` · C `validateAsync`+
  `resource` on a Web Worker · D `validateAsync`+`rxResource` on the Worker). Real local API with
  configurable latency; `npm run stage` = 2 s latency. Browser-verified: A/B show "(canceled)" in
  Network and "client aborted" on the server; C/D make zero network requests.
- **Spec:** `equivalence.spec.ts`, 4 variants × 6 scenarios = **24/24**, stable over repeated runs.

## Verified findings (all used on slides)

- **validateHttp = validateAsync + httpResource factory.** The docs call validateAsync "a lower-level
  API"; it's the same API. `validateStandardSchema` is the framework's own non-HTTP swap.
- **Factory contract:** read `params` only inside a resource's params evaluation. With debounce,
  reading it elsewhere throws `ResourceParamsStatus.LOADING`. Five shapes tested: direct, arrow-wrapped,
  computed-wrapped, read-in-loader work; effect read sees the sentinel.
- **Cancellation has two halves:** resource() signals, the loader must stop the work. The docs'
  `resource()` example ignores `abortSignal`.
- **Pending timing:** without debounce, synchronous (linkedSignal). With debounce, one effect later
  (`debounced()` sets 'loading'), before render. Spec: false synchronously, true after one tick.
- **Lazy aborts:** an in-flight load is aborted only when the next load starts (≈ debounce after the
  keystroke). Going sync-invalid mid-flight never aborts: the load completes and is discarded by
  identity; meanwhile the field is minLength-invalid AND pending for the debounce window.
- **`debounced()` never delays its initial value;** the validation resource is created lazily →
  tests must read field state before typing.
- **`reloadValidation()`** is public on field state and not called automatically in 22.1.1; the
  `IS_ASYNC_VALIDATION_RESOURCE` marker on the metadata key makes custom resources reload too.

## Open items

- [ ] **Record fallbacks** for all three demo steps (video + Network-tab screenshot in `src/`),
      before the CFP deadline if the recording is wanted for the submission. Checklist in `demo/STAGE.md`.
- [ ] **Rehearse with a timer** against the per-section budgets in the speaker notes; the 25-min cut
      is tight (~24 min on paper).
- [ ] **Push the repo** and confirm the URL on the Thank-you slide (placeholder:
      github.com/giorgiogalassi/talk-validate-http).
- [ ] **Commit** the repo: the step-2 fallback (`git checkout -- validators.ts`) needs a committed final state.
- [ ] Optional: make the Worker do real, chunked work (e.g. a hashed local blocklist) instead of a
      timer, if the "contrived worker" objection comes up in rehearsal. The deck already pre-empts it.

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
- 2026-09-28 — restyled after talk-context-engineering (cold open, accent lists, callouts, footer, Thank-you with QR); outcome reframed as a "disguise or enhancement?" lens: framing slide, verdict badges on reveals, verdict column in the stack table, closing "What you take home" slide. Abstract's last paragraph updated to match.
