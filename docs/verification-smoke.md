# Verification Smoke Checks

Run the focused workstream verification from the repository root:

```powershell
npm run test:smoke
```

The smoke runner checks:

- Node syntax for `electron-main.cjs`, `src/**/*.js`, and `docs/src/**/*.js`.
- Root/docs parity for the stable mirrored artifacts: README, changelog, app HTML, built CSS, and model source notes, plus existence checks for mirrored `src/**/*.js` / `src/**/*.css` files.
- Vendored Preact, HTM, Preact Signals, and Rapier files in both root and `docs/`, including non-empty file checks for Windows-friendly local verification.
- Importmap and static asset references for the root app and GitHub Pages `/docs` app, ensuring every relative `href`, `src`, and vendored importmap target resolves without a dev server.
- Keyboard shortcut and nested-menu contracts after the menu migration, ensuring the bundled keydown handler targets existing menu buttons, submenu popovers render, and README shortcut documentation stays aligned.
- Floating window drag, collapse, close, show, and localStorage persistence contracts for the inspector and scene tree windows, plus standing benchmark panel drag/collapse/close controls.
- WS9 migration validation: the TODO section has no unchecked items, deferred active-runtime follow-ups stay visible outside WS9, README/decision docs describe the validation boundary, and the default `npm test` command includes Pages deploy coverage.
- CPU-side performance contracts for DOM write guards, benchmark throttling, scene tree diffing, reusable physics translation buffers, rolling benchmark sample reuse, cached uniform/program state, and constructor display-name lookup.
- Scene store grouping and serialization coverage for `GroupEntity` creation, ordered `childEntityIds`, group selection expansion, parent ID round trips, ungrouping, and bulk hide/lock/delete actions.
- Active runtime ECS contracts for `GroupEntity` in `sceneObjects`, renderable-object shader guards, group scene JSON save/load fields, and runtime-to-`sceneStore` item synchronization.
- Material texture coverage for channel assignment state, UV/tri-planar projection controls, renderer-side tri-planar albedo sampling, and projection metadata scene JSON round trips.
- Benchmark scene coverage for the default `benchmarkSponzaAtrium` registry entry, its 8-bounce/16-ray target settings, exact opening camera metadata, Lissajous tuning constants, capped primitive object budget, deferred scene-load teardown path, visible loading-step dialog, fallback menu buttons, and lighting guardrails for sky, neon, fog, and caustic presets.
- Loader smoke coverage for OBJ/MTL, STL, PLY, glTF JSON, GLB, mesh fit metadata, fitted triangle data, and mesh memory estimates.
- Import coordinator smoke coverage for grouped OBJ/MTL/texture drops, glTF JSON/GLB/STL/PLY drops, texture fallback metadata, mesh records, fitted triangle arrays, bounds, fit data, memory estimates, and captured `assetPipeline` model import logs for every imported model format.
- Documentation evidence for the TODO audit decisions.

The Pages deploy smoke simulates the GitHub Pages project URL locally:

```powershell
npm run test:pages-deploy
```

It serves `docs/` at `/pathtracer/`, verifies the index, static HTML assets, CSS `url(...)` references, importmap targets, static and dynamic module references, and imported WASM artifacts all resolve below that project subpath, and rejects origin-root serving so root-relative path regressions are visible.

The default test command also runs a live Electron/browser smoke harness:

```powershell
npm run test:electron-smoke
```

That harness launches Electron with an isolated temporary profile, loads the root `index.html` through the Electron `loadFile` path, and serves `docs/` through a loopback HTTP server at `/pathtracer/` to simulate the GitHub Pages/browser deploy without external network access. It verifies:

- First-frame app load, dismissed loading overlay, required panels, and nonblank WebGL canvas readback in both Electron and the HTTP-served `docs` build.
- Runtime importmap resolution for the vendored Preact, HTM, and Preact Signals modules.
- Every shortcut in the legacy keydown shortcut maps dispatches to the expected button target.
- Benchmark metric DOM updates arrive at the expected throttled cadence while `requestAnimationFrame` remains active and severe frame stalls are rejected.
- Deferred benchmark scene loads expose loading-step diagnostics and are checked for frame-pacing stalls around scene offload, browser-frame yield, compile, and first-frame scheduling.
- Floating scene-tree window drag, collapse, close, localStorage persistence, reload restore, and reopen behavior.
- All browser-served docs requests stay below the GitHub Pages project subpath and requested assets resolve.
- No non-local HTTP or HTTPS requests are made during the smoke run.

For syntax-only checks:

```powershell
npm run check:syntax
```
