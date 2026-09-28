# Stage runbook

## Before walking on

1. `npm run stage` (API with 2 s latency + `ng serve`, both stop together on Ctrl-C).
   If it says port 4312 is busy: `lsof -ti :4312 | xargs kill`, then retry.
2. Browser: <http://localhost:4200/?latency=2000> (the query param sets the Worker's latency to match the API).
3. DevTools docked, **Network** tab, filter `username`. "Preserve log" off.
4. Second terminal pane showing the `[api]` log lines (the ← / → / ✕ markers).
5. Editor on `src/app/spike/validators.ts`. **Pre-stage variant C** as a copy of variant B:
   `params: ({ value }) => usernameUrl(value())` and `factory: (request) => httpResource<Availability>(request)`.
   Don't save until the live step, and **turn editor auto-save off** (otherwise the pre-staged copy is saved early).
6. Click **clear** on the lookup log. Font size up in editor and browser.

## Step 1 · A vs B (≈1 min, no code typing)

Type `giorgio` in A, then in B: pending → `taken`, one lookup each. Type `freename` in B → valid.

## Step 2 · swap the factory (≈4 min)

Edit variant C: `params: ({ value }) => value()` and the `resource({ params, loader })` factory with
`inject(USERNAME_LOOKUP)`. Save.

- Type `giorgio`, stop → pending, then `taken` after ~2 s. Network: nothing. Log: `worker start/done`.
- Type `giorgio`, **wait ~1 s**, type `x` → log: `worker aborted giorgio` + `worker start giorgiox`.
  Fast typing coalesces into one lookup: nothing to abort, so don't expect one.

**Fallback:** `git checkout -- src/app/spike/validators.ts` restores the finished C.

## Step 3 · watch it cancel (≈2 min)

Field A. Type `giorgio`, **wait ~1 s** (anything between 0.3 s and 2 s works), type `x`.

- Network: `username?u=giorgio` → **(canceled)**; `giorgiox` completes ~2 s later.
- API pane: `✕ giorgio (client aborted)`.
- The cancel lands ~300 ms after the `x`: the lazy abort.

## Fallback assets (record at rehearsal)

- [ ] `src/fallback-step2.mp4`: step 2 end to end, Network tab visible
- [ ] `src/fallback-step3.mp4`: step 3, Network + API pane visible
- [ ] `../src/network-canceled.png`: Network tab with the red (canceled) row (slide-ready)

## Latency knobs

- API: `node scripts/dev.mjs <ms>` (`npm start` = 600, `npm run stage` = 2000)
- Worker: `?latency=<ms>` in the URL (default 600)
- Debounce: `DEBOUNCE.ms` in `validators.ts` (300)
