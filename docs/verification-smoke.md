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
- Keyboard shortcut contracts after the menu migration, ensuring the bundled keydown handler targets existing menu buttons and README shortcut documentation stays aligned.
- Floating window drag, collapse, close, show, and localStorage persistence contracts for the inspector, scene tree, and benchmark windows.
- Loader smoke coverage for OBJ/MTL, STL, PLY, glTF JSON, GLB, mesh fit metadata, fitted triangle data, and mesh memory estimates.
- Import coordinator smoke coverage for grouped OBJ/MTL/texture drops, glTF JSON/GLB/STL/PLY drops, texture fallback metadata, mesh records, fitted triangle arrays, bounds, fit data, memory estimates, and captured `assetPipeline` model import logs for every imported model format.
- Documentation evidence for the TODO audit decisions.

The default test command also runs a live Electron/browser smoke harness:

```powershell
npm run test:electron-smoke
```

That harness launches Electron with an isolated temporary profile, loads the root `index.html` through the Electron `loadFile` path, and serves `docs/` through a loopback HTTP server to simulate the GitHub Pages/browser deploy without external network access. It verifies:

- First-frame app load, dismissed loading overlay, required floating panels, and nonblank WebGL canvas readback in both Electron and the HTTP-served `docs/` build.
- Runtime importmap resolution for the vendored Preact, HTM, and Preact Signals modules.
- Every shortcut in the legacy keydown shortcut maps dispatches to the expected button target.
- Benchmark metric DOM updates arrive at the expected throttled cadence while `requestAnimationFrame` remains active.
- Floating benchmark window drag, collapse, close, localStorage persistence, reload restore, and reopen behavior.
- No non-local HTTP or HTTPS requests are made during the smoke run.

For syntax-only checks:

```powershell
npm run check:syntax
```
