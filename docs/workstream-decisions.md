# Workstream Decisions

These notes capture decisions made during the 2026-05-01 TODO audit. They are intentionally narrow so the TODO list can distinguish completed decisions from larger architecture work.

Detailed ECS, mixed inspector value, and Rapier component ownership rules are defined in [`ecs-scene-model.md`](ecs-scene-model.md).

## Scene Documents

Scene files should use a versioned JSON document first. The initial shape should store app render settings, camera settings, lights, primitive items, materials, and per-item transform/settings payloads. Imported assets should reference external files by relative path instead of embedding binary content.

The current scene objects already have stable runtime IDs and display names, but they are not yet ECS entities. The ECS conversion remains a larger architecture task.

## Imported Assets

The first external model format should be glTF 2.0 binary files (`.glb`). It gives the project one container for meshes, materials, textures, hierarchy, pivots, named nodes, and animation clips.

Imported material mapping should begin with:

- Base color or texture to diffuse albedo.
- Metallic/roughness reduced into the closest current material mode until the shader model supports full PBR.
- Alpha treated as opaque at first unless a later pass adds transmissive or masked materials.
- Missing textures replaced by a neutral checker or flat fallback so imports remain visible.

Animated imported models should be treated as editor animation state, not Rapier-driven dynamic bodies, until ECS physics components exist. Benchmark mode should freeze imported animation unless the benchmark explicitly includes animation.

## Renderer Backends

WebGL is the active renderer. WebGPU support should begin as a separate MVP renderer after a renderer abstraction exists. Runtime backend switching should require a renderer restart/rebuild at first; live hot-swapping can be revisited once both backends share a stable scene/material interface.

Both backends should eventually share camera, scene, material, benchmark, and editor state. WebGPU-only features are acceptable for early experiments if the UI labels them clearly and WebGL remains the fallback.

## Material Emission

Emission is now a per-object material modifier instead of only an `EMISSIVE` material branch. The legacy `EMISSIVE` material still enables the modifier by default, but any material-bearing primitive can persist an `emission` payload with `enabled`, `color`, and `intensity`.

Tri-planar projection remains blocked on renderer-side material texture bindings. The importer can describe texture assets, but the WebGL hit shader does not yet bind per-material albedo samplers, so adding projection math now would not affect rendered materials.

## Particle Fluid Benchmark

The particle fluid benchmark uses only current primitives and Rapier rigid bodies: subsurface sphere particles are connected with Rapier spring impulse joints, and the glass rounded-box container gets an approximate static cuboid collider. This keeps the scene mesh-free and repeatable while still exercising physics transform invalidation, transparent/subsurface shading, and benchmark runner sequencing.

The fallback benchmark panel owns the initial hot-reload controls for particle count, radius, and spring stiffness. These controls update application state and reload only `benchmarkParticleFluid`; they should move into the React benchmark panel when the React shell becomes the active entrypoint.

## Canvas Export

`preserveDrawingBuffer` remains enabled for now because PNG export reads the live canvas. Export now renders one clean frame without the selection outline before calling `toBlob`, but disabling `preserveDrawingBuffer` should wait until export renders into a dedicated offscreen target or performs an explicit final readback.

## Verification Coverage

The smoke runner is the lightweight gate for verification-style TODOs that can be proven without a browser automation dependency. It now covers six workstreams: syntax, root/docs mirror parity, vendored/importmap/static assets, keyboard shortcut selectors after the menu migration, floating window persistence/drag/collapse/close contracts, and loader/importer parser smoke behavior.

The keyboard checks intentionally validate the bundled handler selectors against real fallback menu buttons and README shortcut documentation. They do not prove visual focus behavior or browser-native fullscreen behavior.

The floating-window checks validate the component and fallback HTML contracts for persisted geometry, hidden/collapsed state, drag pointer capture, viewport clamping, close, collapse, and show behavior. They do not replace an end-to-end browser drag test.

## React CSS Selector Audit

The migrated React components intentionally preserve the dynamic selector contracts used by `src/app.css` and `docs/src/app.css`.

- `MenuGroup` emits `.menu-group.is-open` while a menu is open, so `.menu-group.is-open .menu-popover` still displays migrated menus.
- `MenuGroup` and `QuickActions` render `aria-pressed` from the relevant signal maps, so `.menu-popover button[aria-pressed="true"]` and `.menu-quick-action[aria-pressed="true"]` still style pressed menu commands.
- `FloatingWindow` emits `.floating-window.is-collapsed`, preserving the collapsed window and hidden-body selectors.
- `SceneTreeWindow`, `RenderPanel`, and `CameraPanel` render the matching `aria-pressed` attributes for the scene create button, pause toggles, light cycling, and focus pick controls.

The remaining dynamic class selectors for `canvas.focus-pick-mode`, `.loading-overlay.is-hidden`, `.loading-overlay.is-error`, `.gpu-status.is-preferred`, and `.gpu-status.is-fallback` are still owned by the legacy WebGL runtime because those nodes have not moved fully into React yet.

## React Canvas CSS Variables

`RenderCanvas` is the React-side owner for the canvas sizing CSS custom properties. Its mounted effect writes `--canvas-render-size`, `--canvas-render-width`, `--canvas-render-height`, and `--canvas-aspect-ratio` through one helper and restores previous root values on cleanup.

The active `index.html` entrypoint still loads `webgl-path-tracing.js` against the static fallback `<canvas id="canvas">`; `src/main.jsx.js` mounts an inert scaffold by default. Because the legacy renderer also derives render dimensions from URL parameters before it creates WebGL resources, its document-root writes must remain until the active entrypoint mounts `RenderCanvas` and starts the render loop through `renderBridge`. The smoke runner now verifies that split: React owns the migrated document-root effect, while the legacy bundle only writes the same custom properties to `document.documentElement` for the fallback canvas and never to canvas inline style.
