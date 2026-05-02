# Workstream Decisions

These notes capture decisions made during the 2026-05-01 TODO audit. They are intentionally narrow so the TODO list can distinguish completed decisions from larger architecture work.

Detailed ECS, mixed inspector value, and Rapier component ownership rules are defined in [`ecs-scene-model.md`](ecs-scene-model.md).

## Scene Documents

Scene files use a versioned JSON document first. The active runtime stores app render settings, camera settings, lights, primitive items, materials, and per-item transform/settings payloads. Imported assets should reference external files by relative path instead of embedding binary content.

The active WebGL runtime now treats primitives, SDF objects, area lights, the primary light, and `GroupEntity` records as scene items with stable IDs and names. `GroupEntity` instances live in `sceneObjects` so grouping participates in the ECS tree, naming, hide/lock, selection, and scene-store systems.

Scene JSON persists ECS identity and hierarchy fields: each saved object can carry `entityId`, grouped children carry `parentEntityId`, and group snapshots carry ordered `childEntityIds`. Load restores `GroupEntity` objects into `sceneObjects`, accepts legacy parent aliases, and re-syncs parent links with group child lists before the renderer and physics paths rebuild.

Groups and other non-renderable scene items remain valid runtime scene objects, but renderer shader, uniform, and material paths guard with the renderable-object predicate before reading render methods. `syncSceneObjectsToRendererAndPhysics()` normalizes group child links and pushes the runtime `sceneObjects` list into `sceneStore`, keeping React/editor consumers aligned with the active renderer.

## Imported Assets

The first external model format should be glTF 2.0 binary files (`.glb`). It gives the project one container for meshes, materials, textures, hierarchy, pivots, named nodes, and animation clips.

Imported material mapping should begin with:

- Base color or texture to diffuse albedo.
- Metallic/roughness reduced into the closest current material mode until the shader model supports full PBR.
- Alpha treated as opaque at first unless a later pass adds transmissive or masked materials.
- Missing textures replaced by a neutral checker or flat fallback so imports remain visible.

Animated imported models should be treated as editor animation state, not Rapier-driven dynamic bodies, until ECS physics components exist. Benchmark mode should freeze imported animation unless the benchmark explicitly includes animation.

## Procedural Transform Animations

The migrated scene store now represents procedural transform animations as serializable `TransformAnimationComponent` records on any item or group. Components are stackable and can store spin, bob, pulse, orbit, and wobble configurations. The Inspector can attach, enable, disable, edit, and remove each component individually.

`sceneStore` includes deterministic transform evaluation for editor-side consumers and smoke coverage, but the active WebGL renderer still does not consume these components. Visual renderer motion remains blocked until the renderer bridge applies evaluated transforms per frame and invalidates accumulation.

## Renderer Backends

WebGL is the active renderer. WebGPU support should begin as a separate MVP renderer after a renderer abstraction exists. Runtime backend switching should require a renderer restart/rebuild at first; live hot-swapping can be revisited once both backends share a stable scene/material interface.

Both backends should eventually share camera, scene, material, benchmark, and editor state. WebGPU-only features are acceptable for early experiments if the UI labels them clearly and WebGL remains the fallback.

## Material Emission

Emission is now a per-object material modifier instead of only an `EMISSIVE` material branch. The legacy `EMISSIVE` material still enables the modifier by default, but any material-bearing primitive can persist an `emission` payload with `enabled`, `color`, and `intensity`.

## Material Presets And Texture Assignment

Reusable material presets live in the signal store as serializable editor data: each preset has an id, label, path-tracer material index, glossiness, optional emission settings, and texture assignments keyed by channel. The initial editor channels are albedo, normal, metallic/roughness, emissive, and AO so OBJ/MTL and glTF imports can share the same material slot vocabulary.

The React object inspector can load and save material presets, assign a local image file descriptor to a selected texture channel, clear individual channels, and swap two channel assignments. These assignments are descriptors until per-import material texture upload lands, but material presets already persist projection mode, scale, and tri-planar blend sharpness so the UI schema does not need another migration.

The active legacy WebGL entrypoint now exposes material projection controls in the fallback inspector and dispatches them directly to selected scene objects. Material preset and file-assignment actions remain part of the migrated React editor contract until the active entrypoint owns local texture-file upload and preset persistence.

## Material Texture Projection

Tri-planar projection is a material addressing mode, not a new material enum. `MaterialComponent` owns `uvProjectionMode`, `uvScale`, and `uvBlendSharpness`, scene JSON persists non-default projection settings under `textureProjection`, and the WebGL shader generator bakes projection decisions per object to avoid dynamic branches.

When an object uses `tri-planar`, the hit shader declares `surfaceObjectPoint`, samples a repeatable material albedo texture on the YZ, XZ, and XY planes, and blends the three lookups by normalized `abs(normal)` weights. This path works for diffuse, reflective, transparent, procedural, and future texture-backed materials because it is composed around the generated object material snippet rather than encoded as its own material type.

The current WebGL fallback binds a procedural checker albedo texture as `materialAlbedoTexture` so the projection path is visible and testable without waiting for imported texture atlases. Imported mesh texture assets should keep their descriptors and prefer authored UV projection by default; primitive, SDF, and UV-less mesh materials can opt into tri-planar projection when the material texture upload path is expanded.

## Particle Fluid Benchmark

The particle fluid benchmark uses only current primitives and Rapier rigid bodies: subsurface sphere particles are connected with Rapier spring impulse joints, and the glass rounded-box container gets an approximate static cuboid collider. This keeps the scene mesh-free and repeatable while still exercising physics transform invalidation, transparent/subsurface shading, and benchmark runner sequencing.

The fallback benchmark panel owns the initial hot-reload controls for particle count, radius, and spring stiffness. These controls update application state and reload only `benchmarkParticleFluid`; they should move into the React benchmark panel when the React shell becomes the active entrypoint.

## Physics Spring Joints

Fallback spring joints are runtime editor state on physics-capable scene objects. Exactly two selected, physics-enabled fallback objects expose `JointData.spring()` controls for rest length, stiffness, and damping; created joint records are mirrored on both endpoints and refreshed with new Rapier handles whenever the physics world rebuilds.

The fallback scene tree renders selected spring endpoints and connected spring partners as text annotations until the React scene tree owns joint rows. The inspector removes joints through `world.removeImpulseJoint()` when a live handle is available, then clears both endpoint records and refreshes the tree.

## Canvas Export

`preserveDrawingBuffer` remains enabled for now because PNG export reads the live canvas. Export now renders one clean frame without the selection outline before calling `toBlob`, but disabling `preserveDrawingBuffer` should wait until export renders into a dedicated offscreen target or performs an explicit final readback.

## Renderer Draft Post-Processing

Draft quality is a throughput-first path only while the render state exactly matches the Draft preset or while the interactive camera throttle is active. In that mode the WebGL renderer presents the current accumulation texture directly to the final screen composite, clears temporal display history, and sends zero bloom/glare strengths so the composite shader skips those tap gathers.

The final screen composite still runs because it is the canvas draw that applies color correction and tone mapping. The smoke runner verifies the draft bypass helper, the temporal display texture bypass, the effective bloom/glare uniforms, and root/docs renderer parity; it does not replace a browser GPU timing capture.

## Verification Coverage

The smoke runner is the lightweight gate for verification-style TODOs that can be proven without a browser automation dependency. It covers syntax, root/docs mirror parity, vendored/importmap/static assets, keyboard shortcut selectors after the menu migration, floating window persistence/drag/collapse/close contracts, active runtime ECS group contracts, renderer post-process contracts, and loader/importer parser smoke behavior.

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
