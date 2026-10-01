# The Validator That Isn't: resource(), httpResource(), and the Reactive Graph Behind Signal Forms

A Slidev presentation by **Giorgio Galassi**, the talk version of Angular Internals #2
("validateHttp() Has No Async Machinery: A Trace From Signal Forms Down to fetch()").

## Abstract

Signal Forms' `validateHttp()` looks like a black-box async validator, but it's actually
`httpResource()` wired into the form's reactive graph: same dependency tracking, same
request cancellation, same signal semantics as any other Angular resource. This talk
live-builds a custom async validator from raw `resource()`/`httpResource()` that behaves
identically to `validateHttp()`, cancels in-flight requests on user input, and traces
where the abstraction starts and stops.

## Format

40-minute extended talk · Advanced · live coding. A 25-minute cut drops the debounce
layer and the testing payoff and keeps the generalization reveal.

## Getting started

```bash
npm install
npm run dev        # 40-min deck
npm run dev:25     # 25-min cut
npm run dev:type   # same talk, typography-as-architecture style (under evaluation)

cd demo && npm install
npm start          # username API (600 ms) + ng serve → http://localhost:4200
npm run stage      # same with 2 s latency, for the talk → http://localhost:4200/?latency=2000
npx ng test --watch=false   # 50 tests: 5 variants × equivalence scenarios + the two rules
```

Deck: http://localhost:3030.

## Structure

```
slides.md               — slide content and speaker notes (40 min)
slides-25.md            — 25-min cut, imports slides from slides.md
demo/                   — Angular 22.1.1 demo app (cd demo && npm start); stage runbook in demo/STAGE.md
IMPLEMENTATION-PLAN.md  — living build doc: demo spike, risks, changelog
src/                    — images used in slides
styles/                 — custom CSS
```

## Author

**Giorgio Galassi** — Senior Frontend Engineer (Freelancer) · GDG Roma Città Organizer

## License

ISC
