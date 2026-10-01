# Stage runbook

## Before walking on

1. `npm run stage` (API with 2 s latency + `ng serve`, both stop together on Ctrl-C).
   If it says port 4312 is busy: `lsof -ti :4312 | xargs kill`, then retry.
2. Browser, two tabs (the `latency` param sets the Worker's latency to match the API):
   - tab 1 <http://localhost:4200/?latency=2000> (debounce 300 ms), steps 1 and 2;
   - tab 2 <http://localhost:4200/?latency=2000&debounce=0> (**debounce off**), step 3.
3. DevTools docked, **Network** tab, filter `username`. "Preserve log" off.
4. Second terminal pane showing the `[api]` log lines (the ← / → / ✕ markers).
5. Editor on `src/app/spike/validators.ts`. **Pre-stage variant C** as a copy of variant B:
   `params: ({ value }) => usernameUrl(value())` and `factory: (request) => httpResource<Availability>(request)`.
   Don't save until the live step, and **turn editor auto-save off** (otherwise the pre-staged copy is saved early).
6. Click **clear** on the lookup log. Font size up in editor and browser.

## Step 1 · A vs B (≈1 min, no code typing)

Type `giorgio` in A, then in B: pending → `taken`, one lookup each. Type `freename` in B → valid.

## Step 2 · swap the primitive (≈4 min, tab 1)

Edit variant C: `params: ({ value }) => value()` and the `resource({ params, loader })` factory with
`const worker = inject(UsernameWorker)` and `loader: ({ params: username, abortSignal }) => worker.check(username, abortSignal)`. Save.

- Type `giorgio`, stop → pending, then `taken` after ~2 s. Network: nothing. Log: `worker start/done`.
- Type `giorgio`, **wait ~1 s**, type `x` → log: `worker aborted giorgio`, `worker stopped giorgio`
  (the Worker confirming it dropped the job), `worker start giorgiox`.
  Fast typing coalesces into one lookup with debounce on: nothing to abort, so don't expect one.

**Fallback:** `git checkout -- src/app/spike/validators.ts` restores the finished C.

## Step 3 · watch it cancel (≈2 min, tab 2: debounce off)

Say it: debounce is off so every keystroke starts a load and the next one cancels it (with debounce on,
fast typing coalesces into one request and nothing is in flight to cancel).

- Field A: type `giorgio` at normal speed. Network: `gio`, `gior`, `giorg`, `giorgi` → **(canceled)**;
  `giorgio` completes ~2 s later. API pane: one `✕ … (client aborted)` per keystroke.
- Field C: same typing. Log: `aborted` + `stopped` per keystroke, network empty.
- Optional, tab 1 (debounce on): `giorgio`, wait ~1 s, `x` → one cancel ~300 ms after the `x`: the lazy abort.

Verified in Chromium 2026-09-30 (600 ms latency): A → 4 × `ERR_ABORTED`, C and E → 4 × `aborted`/`stopped`, 0 requests.

## Fallback assets (record at rehearsal)

- [ ] `src/fallback-step2.mp4`: step 2 end to end, Network tab visible
- [ ] `src/fallback-step3.mp4`: step 3, Network + API pane visible
- [ ] `../src/network-canceled.png`: Network tab with the red (canceled) row (slide-ready)

## Latency knobs

- API: `node scripts/dev.mjs <ms>` (`npm start` = 600, `npm run stage` = 2000)
- Worker: `?latency=<ms>` in the URL (default 600)
- Debounce: `?debounce=<ms>` in the URL (default 300; `0` = off, no `debounce` option passed). Variant E
  debounces itself and uses 0 ms when off.
- Failure path: username `offline` → API 503 / Worker `failed` → `unreachable`
