# CLAUDE.md

Guidance for AI agents working in this repository.

## What this is

Sail Trim Trainer: a dependency-free static web app (vanilla ES modules, SVG + canvas) for practising
sail plan and trim on a 40 ft sloop. A pure-JS sailing model scores the user's setup and produces
coaching text. No framework, no bundler, no build step.

## Commands

```sh
npm start          # node serve.mjs → http://localhost:5173
npm test           # unit tests for the model (node --test)
npm run test:e2e   # real pointer drags in headless Chrome over CDP (needs Chrome installed)
```

The page uses ES modules, so it must be served over HTTP; `file://` will not work.

## Layout

- `index.html`, `styles.css` — page shell and windy.com-inspired dark theme.
- `src/model.js` — **the domain model, pure functions only.** Polar table, apparent wind, sail
  aerodynamics (lift/drag vs angle of attack per aero profile), headsail inventory with wind-angle
  envelopes and wind-speed limits, reefing stages, the `recommend()` planner, `evaluate()` scoring
  and feedback text. Anything about *what is correct sailing* lives here and is unit-tested.
- `src/scene.js` — SVG top-down scene and all direct manipulation (drag handles, snap rings).
- `src/particles.js` — animated wind streaks on a full-window canvas.
- `src/palette.js` — wind-speed colour scale.
- `src/main.js` — DOM wiring: controls, coach panel, quiz mode, URL parameters, localStorage.
- `test/model.test.js` — model tests. `test/e2e/drag.mjs` — CDP-driven drag checks.
- `staticwebapp.config.json`, `.github/workflows/` — Azure Static Web Apps deploy on push to `main`.

## Conventions

- Keep the model free of DOM access; the UI reads `evaluate()` results and never re-derives physics.
- State shape is `{ tws, twd, hdg, main:{reef, sheet}, head:{type, size, sheet, windward}, inventory }`.
  `normaliseState()` migrates older shapes (e.g. the legacy `genoa` key); use it at every entry point.
- Angles: compass bearings clockwise from north; `twa`/`awa` signed, positive = wind over starboard.
  In the SVG boat frame +x is starboard and the bow points to −y; `dir(bearing)` converts.
- Adding a headsail: extend `HEADSAILS` in the model (aero profile, envelope, states) and
  `HEAD_GEOM` in the scene (tack point, foot lengths, snap radii). The planner in `recommend()`
  decides when it is recommended.
- Every behaviour claim in coaching text should be backed by a test in `test/model.test.js`.
  The "recommended setup scores ≥ 85 everywhere" test is the regression net for the planner.
- **All user-facing text goes through `src/i18n.js`.** The model emits feedback as `{key, params}` and
  resolves `title`/`detail` with `t()`; the UI uses `t()`, `data-i18n` attributes and the label helpers
  (`sailName`, `mainLabel`, `headStateShort`, …). Never hard-code an English sentence in `main.js`,
  `scene.js` or `model.js`. Every key must exist in both `en` and `nb` with the same placeholders; a
  unit test enforces it. Norwegian uses real sailing terminology (bidevind, slør, lens, skjøte,
  sommerfugl, lo/le); English is British spelling. Code and comments are US English.
- Switching language reloads the page (static SVG text is created once); the choice lives in
  localStorage under `sail-trim-sim.lang`, and `?lang=nb` overrides it.
- Run `npm test` before committing; run the e2e suite after touching `scene.js` or `main.js`.
