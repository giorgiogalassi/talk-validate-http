# Slidev Presentation — Angular Internals #2 (validateHttp)

## Project
Slidev deck for the talk:
"The Validator That Isn't: resource(), httpResource(), and the Reactive Graph Behind Signal Forms"
by Giorgio Galassi. Advanced level, 40-min extended slot (25-min cut defined in the vault notes).

## Source of truth
- Abstract, run of show, open items: `~/second-brain/drafts/pieces/2026-07-29-validate-http-internals/talk/`
- Technical source (pinned to angular/angular v22.1.1): `.../medium/research-brief.md` and `.../medium/source-trace.md`
- Vault status: `~/second-brain/projects/talk-validate-http/status.md`
Do not re-derive source claims; cite from the source trace.

## Demo app
`demo/` is a standalone Angular 22.1.1 CLI app (own package.json, `cd demo && npm start`). Keep the Angular version exact — it matches the source-trace pin; don't bump it without updating IMPLEMENTATION-PLAN.md.

## Stack
- Slidev, Vue 3, UnoCSS, Shiki

## Conventions
- All slide content lives in `slides.md`; do not split across files unless asked
- Speaker notes go in `<!-- -->` blocks at the bottom of each slide
- `slides.md` is the full 40-min deck with speaker notes (timings per section in the section-divider notes). `slides-25.md` is the 25-min cut: it imports slides from `slides.md` by number (`src: ./slides.md#…`), so **adding, removing or reordering slides in `slides.md` means updating that range**
- Stage procedure and fallbacks: `demo/STAGE.md`
- `slides-type.md` is a full alternative of the 40-min deck in the "typography as architecture" style (layout `layouts/ruled.vue`, `components/FitText.vue`, `.ta-*` classes in `styles/index.css`, Roboto Flex via `index.html`). Same content and speaker notes, plus three number beats. Under evaluation: until one version is chosen, **content changes must be made in both files**
- `IMPLEMENTATION-PLAN.md` is the living build doc (demo spike, risks, changelog). Update it when a demo/scope decision changes

## Colour and contrast
- Colours come from CSS variables in `styles/index.css` (`--accent`, `--muted-text`, `--ta-*`), with light and dark values tuned to WCAG AA (4.5:1). Never hard-code a hex colour for text; use the variables.
- Code themes are set in `setup/shiki.ts` (GitHub high-contrast light / GitHub dark default).
- Slidev follows the system colour scheme, so both themes must stay readable.

## Rules
- Never modify slide text or speaker notes unless explicitly asked
- Always preserve the `---` slide separators exactly
- If a layout change breaks a slide visually, report it before applying

## Commands
- `npm run dev` · `npm run build` · `npm run export` · `npm run export-dark`
- 25-min cut: `npm run dev:25` · `npm run build:25` · `npm run export:25`
- Type-style deck: `npm run dev:type` · `npm run build:type` · `npm run export:type` (contact sheets in `type-sample/`)
- Demo: `cd demo && npm start` (600 ms latency) · `npm run stage` (2 s, for the talk) · `npx ng test --watch=false`
