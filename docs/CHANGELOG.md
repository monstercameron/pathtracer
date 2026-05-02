# Changelog

Changes are grouped by commit date, newest first. Each bullet represents one commit.

## 2026-05-02

- This commit - Render bundled reference mesh scene:
  - Add generated Suzanne/Sponza reference metadata, including normalized low-triangle Suzanne triangle data and Sponza GLB triangle-count metadata.
  - Add the `Suzanne Reference Mesh` Scene preset, renderable reference mesh scene-object support, menu/preset-panel entries, and Electron smoke coverage that compiles the new preset.
  - Keep the full Sponza GLB as the benchmark reference asset while the default Sponza Atrium remains a deterministic primitive benchmark until the BVH/texture-atlas mesh path is ready.
  - Fix Preact/legacy floating-window event overlap so reopened persisted panels do not immediately hide again.
- This commit - Close WS9 validation and TODO audit:
  - Move incomplete active-runtime performance work into a deferred follow-up section instead of marking it complete without code contracts.
  - Add smoke checks for no unchecked WS9 TODOs, migration validation docs, GitHub Pages deploy smoke documentation, and CPU-side performance coverage notes.
- This commit - Add bundled reference model assets:
  - Add Khronos-derived Suzanne OBJ and low-triangle OBJ references with upstream CC0 license metadata.
  - Pack the Khronos Sponza glTF sample into a self-contained GLB, keep the upstream CryEngine license notice beside it, and add smoke coverage for the bundled references.
- This commit - Complete WS11 benchmark scenes and lighting tuning:
  - Add the default Sponza Atrium benchmark with deterministic primitive atrium geometry, exact opening camera metadata, 8-bounce/16-ray target settings, and a glass Lissajous animation.
  - Add Sponza and Particle Fluid entries to migrated benchmark menus, tune over-bright sky/fog/neon/caustic lighting, defer scene menu loads through renderer teardown and a browser-frame yield, show an offload/reload step dialog during scene changes, and expand smoke coverage for the new default benchmark.
- This commit - Update changelog for grouped runtime work:
  - Record the grouped scene-store, runtime, verification, and TODO audit commits.
- `e13cea8` - Refresh TODO audit and workstream notes:
  - Mark completed ECS grouping, procedural transform animation, spring joint, material preset, texture assignment, tri-planar projection, and verification items.
  - Update ECS and workstream decision docs for active runtime groups, material projection metadata, spring joints, and renderer post-process behavior.
- `30574eb` - Expand smoke and deploy verification:
  - Add GitHub Pages project-path smoke coverage and wire it into the default test command.
  - Extend Electron/browser smoke checks for project-path asset resolution and main-menu dropdown placement.
  - Add renderer smoke contracts for post-process bypass, temporal denoise, camera-drag brightness, material projection, spring joints, and runtime ECS groups.
- `fc825f5` - Wire runtime ECS groups and material projection:
  - Add active runtime `GroupEntity` support, entity-ID selection, group hierarchy save/load, spring joint controls, and scene-store runtime synchronization.
  - Add material presets, texture assignment descriptors, emission modifiers, UV projection controls, and tri-planar checker projection in the WebGL shader path.
  - Keep temporal denoise active after accumulation settles and preserve configured bounces/post-processing while dragging the camera.
- `8963dc5` - Add scene-store grouping and transform animations:
  - Add serializable `GroupEntity` and procedural transform animation records to `sceneStore`.
  - Add inspector controls for stackable spin, bob, pulse, orbit, and wobble animation components.

## 2026-05-01

- `2965be9` - Update changelog and TODO audit:
  - Record the grouped commit hashes for editor, import, Particle Fluid, smoke, and docs work.
  - Mark verified completed TODOs while leaving unfinished viewport, model-scene, CSG, and WebGPU items open.
- `36e3a6c` - Cover Particle Fluid benchmark smoke:
  - Add smoke checks for the Particle Fluid factory, registry entry, spring joints, constants, target settings, material/container setup, menu button, and controls.
  - Document the live Electron/browser smoke harness and make Electron smoke output quieter by default.
- `cf2eb26` - Keep Electron smoke window alive:
  - Prevent Electron from exiting before both root and docs smoke paths finish.
- `949e120` - Improve Electron smoke failure output:
  - Include Electron exit status and signal when a smoke result file is missing.
- `a3605b4` - Wire Particle Fluid benchmark controls:
  - Read, clamp, and sync Particle Fluid count, radius, and stiffness controls.
  - Reload the Particle Fluid benchmark with the applied settings and harden Electron smoke reload/proxy checks.
- `120abc4` - Expose Particle Fluid benchmark controls:
  - Add Particle Fluid benchmark menu entries and root/docs controls for count, radius, and stiffness.
- `72cf840` - Add smoke verification and docs:
  - Add root/docs README coverage, ECS scene model notes, smoke verification docs, the Node smoke runner, and the Electron/browser smoke harness.
- `b295ee5` - Add Particle Fluid benchmark scene:
  - Register spring-jointed SUBSURFACE particles, a GLASS rounded-box container, benchmark target settings, and scene metadata.
- `028c837` - Add mesh import pipeline scaffold:
  - Document the GLTF/GLB loader APIs and add GLTF/GLB loading, mesh records, grouped import coordination, model asset notes, and loader/importer smoke samples.
- `ba24508` - Modernize editor shell and scene controls:
  - Add the Preact/HTM component shell, signal stores, logger, scene tree grouping, inspector panels, floating panels, render/output controls, renderer fallback updates, and vendored browser runtime assets.
- `3d0a8fe` - Mirror app updates to docs site:
  - Publish the updated root app, generated CSS, README copy, and source scaffold into `docs/`.
  - Add workstream decision notes for scene documents, imported assets, renderer backends, and canvas export.
- `74f8118` - Add modular UI and asset loader scaffold:
  - Add Preact/HTM signal stores, menu, quick-action, floating-window, inspector, scene-tree, benchmark, canvas, and control-panel components.
  - Add OBJ/MTL, STL, and PLY parser modules plus loader smoke samples for the future mesh-import path.
- `54dc65d` - Expand path tracer editor runtime:
  - Add render-scale and custom width/height output controls, canvas-sized default rendering, fullscreen panel mode, and accordion inspector behavior.
  - Add light color editing, debug views, benchmark sequence execution, benchmark result export/baselines, stable scene entity IDs, and benchmark rolling-window allocation improvements.
  - Add parser wiring notes, physics sync allocation reductions, material/debug fixes, and update Rapier initialization to the current object-form API.
- `ee8bc56` - Complete Workstream 5 renderer UI:
  - Add extended scene primitives, SDF shapes, visible area lights, primitive showcase presets, and material alignment for new primitives.
  - Add pause-frame and pause-ray behavior, clean PNG export, FOV/depth controls, startup loading overlays, object edit controls, camera shots, quality presets, and benchmark context tiles.
  - Extract inline CSS into `src/app.css`, add Tailwind CSS build output, and introduce the full-screen render stage with application-style menus and persisted floating panels.

## 2026-04-30

- `f021c18` - Optimize sphere shadow tests.
- `059ad6b` - Reuse ray length for sphere tests.
- `69e94b9` - Reuse inverse ray for cube tests.
- `b0094e2` - Simplify sphere intersection math.
- `725a868` - Avoid unused surface point math.
- `74c97fb` - Throttle benchmark frame snapshots.
- `f754339` - Gate direct light normalization.
- `0187538` - Tighten temporal filter sampling.
- `7a8b300` - Prefer half float render textures.
- `b31fe00` - Skip empty direct-light shadow rays.
- `6dacc01` - Reduce per-sample light jitter cost.
- `e0cf939` - Request lean WebGL backbuffer.
- `def4dc0` - Gate scene uniform uploads by dirty state.
- `d3bef1f` - Precompute ray jitter sequence.
- `f05a004` - Bypass settled temporal display pass.
- `9e02bfb` - Reuse GPU benchmark timer queries.
- `ee3cb43` - Throttle GPU benchmark timer queries.
- `5cd1d49` - Reduce benchmark and physics frame overhead.
- `7ebacc1` - Optimize shader and render hot paths.
- `1536749` - Add per-object benchmark shader modes.

## 2026-04-29

- `1279ab1` - Update sample slider max attributes.
- `97714a4` - Raise interactive path tracing sample caps.
- `a9f9691` - Add ray memory bandwidth benchmark metric.
- `7208b64` - Stabilize comparable benchmark score.
- `986d082` - Add reset all defaults.
- `547c13e` - Normalize benchmark score by throughput.
- `bf4c7dd` - Weight stable benchmark score by workload.
- `ef0f63b` - Stabilize benchmark scoring.
- `e88ba1f` - Add benchmark framerate and score.
- `55bfd6f` - Add live demo link to README.
- `72b4133` - Add GPU rays benchmark panel.
- `a2dab4e` - Expand README guide.
- `4fde7bb` - Set up GitHub Pages docs.
- `5ff7bca` - Fix BestBuys typo.
- `3c6c6ed` - Add README attribution.
- `40d35a7` - Initial path tracer demo.
