# TODOs

Audit note: checked items reflect implemented behavior or documented decisions as of 2026-05-02. Unchecked items are still real implementation work, not hidden scope.

## Workstream 1: Scene Data And Documents
- [x] Make every object in the scene a separate ECS item
- [x] Define the ECS entity and component model for scene objects
- [x] Convert existing primitives, lights, and special objects into ECS-backed entities
- [x] Add a stable ID and name for each scene item

### Entity And Component Model
- [x] Add a canonical `entityId: string` field to every scene object class (`SphereSceneObject`, `CubeSceneObject`, `SdfSceneObject` and all subclasses, the light object) â€” set to `String(objectId)` in each constructor so `sceneStore.normalizeSceneItem()` can read it directly and retire the `id ?? sceneObjectId ?? objectId ?? index` fallback chain
- [x] Add `parentEntityId: string | null` to every scene object (null = scene root); `GroupEntity` sets this field on children when they are added to the group and clears it when they are removed; `syncSceneTree()` uses this field to derive display order without assuming a flat list
- [x] Define a `GroupEntity` class that holds `childEntityIds: string[]` and a world-space transform but generates no GLSL uniform or intersection code; include it in `sceneObjects` like any other object so it participates in the ECS tree, hide/lock, and naming systems; the path-trace shader ignores it via a type-check guard in `joinObjectShaderCode()`
- [x] Extract physics state (`physicsRigidBody`, body type, friction, restitution) from inline scene object fields into a standalone `PhysicsComponent` data class in `src/components/PhysicsComponent.js`; keep backward-compatible getters on the scene objects (`get physicsRigidBody()`) so the existing `physicsWorld.rebuildScene()` path compiles without changes during migration
- [x] Extract material state (`material` integer, `glossiness` float) from inline fields into a `MaterialComponent` in `src/components/MaterialComponent.js`; keep `this.material` as a forwarding getter so all GLSL-generating methods (`getIntersectCode`, `getNormalCalculationCode`, etc.) continue to work unchanged
- [x] Unify the two selection systems: replace `SelectionRenderer.selectedObject` (direct object reference, stale across scene resets) with `selectedEntityId: string | null`; resolve to the live scene object by ID inside `render()`, `syncSelectedItemReadout()`, and `selectSceneObjectByIndex()` so there is one source of truth matching the `sceneStore.selectedItemId` signal
- [x] Add per-item settings and expand the property model over time
- [x] Decide which settings are shared across all items and which are type-specific
- [x] Add scene save and load support
- [x] Define a scene file format that can store objects, materials, lights, and settings
- [x] Add a reset or new scene flow
- [x] Show a startup loading screen when the app first launches covering WebGL init, shader compilation, physics setup, and initial scene build
- [x] Display a progress status string on the startup screen such as initialising renderer, compiling shaders, or loading scene
- [x] Fade or dismiss the startup screen once the first rendered frame is ready and the app is fully interactive
- [x] Show a loading overlay with a spinner and status message when a scene is loading or switching
- [x] Show a brief loading indicator when a new item is being added to the scene and the shader is recompiling
- [x] Display a short human-readable status string during load such as compiling shaders or building scene
- [x] Dismiss the loading overlay automatically once the first rendered frame is ready
- [x] Ensure the loading state makes clear that skipped or blank frames during setup are expected and not errors

## Workstream 2: Scene Editing And Selection
- [x] Add an ECS tree view that mirrors the live scene
- [x] Clicking an item in the scene tree selects it and immediately populates the inspector panel with that object's settings
- [x] Keep tree selection and canvas selection in sync
- [x] Support selecting and dragging multiple items in the ECS tree
- [x] Add Shift + click and Ctrl + click selection behavior in both the tree and the viewport
- [x] Show a clear visual state for primary selection vs secondary selected items
- [ ] Add marquee or box selection in the viewport if it fits the editor workflow
- [x] Add bulk actions for the current multi-selection
- [x] Add a "Group Selected" action (Edit menu, shortcut Ctrl+G) that wraps all currently selected items under a new Group entity in the ECS tree; the group has its own transform, name, hide/lock state, and physics body while each child retains its own material and geometry unchanged
- [x] Render the group as a collapsible parent node in the scene tree with expand/collapse toggle; selecting the group selects all children simultaneously so transforms and inspector actions apply to the whole group
- [x] Add an "Ungroup" action (Ctrl+Shift+G) that dissolves a selected group and re-parents all children directly to the scene root, preserving each child's world-space transform
- [ ] Add a "CSG Merge" action available only when all selected items are SDF-compatible primitives (sphere, ellipsoid, capsule, rounded box, metaballs, mandelbulb, SDF fractal, torus, cone, cylinder); converts the selection into a single `MultiCsgSceneObject` using union mode by default with a mode dropdown shown in the inspector before the merge is confirmed
- [ ] Make CSG Merge destructive and undoable â€” the original primitives are removed and replaced with one CSG node; warn in a confirmation dialog that the individual shapes can only be recovered via undo
- [ ] Show the constituent SDF expressions of a CSG node as read-only child entries in the scene tree so the user can see what was merged, even though the children are no longer independent scene objects

### CSG Shaped Holes And Per-Shape Materials
- [ ] Replace the hardcoded `CsgSceneObject` (box minus sphere at fixed sizes) with a general `MultiCsgSceneObject` that stores an ordered list of `{ sdfExpression, role: 'base' | 'cutter', materialIndex }` operands; the GLSL distance function body is generated from this list using `min` for union, `max` for intersection, and `max(A, -B)` for each cutter against the accumulated base so any combination of shapes and roles is expressible
- [ ] Add a **Difference / Hole-Cut** mode to the CSG Merge UI: when two items are selected, allow the user to designate one as the **base** and one as the **cutter**; the cutter's volume is subtracted from the base using `max(dBase, -dCutter)` in the generated GLSL; show the cutter shape as a semi-transparent ghost in the scene tree and inspector while the CSG node is selected
- [ ] Add **Smooth Union** as a fourth CSG mode alongside union / intersection / difference: use the polynomial smooth-min `smin(dA, dB, k)` with a user-controlled blend radius `k` (default 0.1, range 0â€“0.5) so two shapes blend into each other organically rather than meeting at a hard edge; expose the blend radius as a slider in the inspector when smooth union mode is active
- [ ] Support multi-material CSG: each operand in a `MultiCsgSceneObject` retains its own `materialIndex` from before the merge; at ray-hit time, determine which operand owns the surface by evaluating all individual SDF distances at the hit point â€” the operand with the minimum (for union) or maximum (for intersection/difference base) distance owns the hit and its `materialIndex` is used for shading; emit this operand-selection logic as part of the generated `getNormalCalculationCode()` so the path tracer applies the correct material without any extra ray cast
- [ ] Show each operand's material as a labelled chip in the CSG node's inspector section (e.g. "Shape A â€” GGX PBR", "Shape B (cutter) â€” Glass") with an inline material-type select so the material of any constituent can be changed after the merge without re-merging
- [ ] Allow changing a CSG node's per-operand mode (base â†” cutter) after creation via a toggle in the inspector's constituent list; regenerate the GLSL distance function body and re-trigger shader compilation when any operand role or material changes
- [x] Add duplicate, rename, and delete actions for scene items
- [x] Add hide, show, and lock controls for scene items

### Scene Tree Hierarchy And Component Rows
- [x] Update `syncSceneTree()` to derive display order from `parentEntityId` rather than the flat `sceneObjects` index: collect root items (null parent) first, then DFS-append each item's children; re-key `this.sceneTreeButtons` by entity ID string instead of array index so button reuse survives reordering
- [x] Store group expand/collapsed state in a `Set<string>` of expanded entity IDs on the tree manager; add a chevron element to each group button that rotates on expand; toggle child button `hidden` attribute on click; persist the expanded ID set to `localStorage` so the tree reopens in the same state after a scene reload
- [x] Add component sub-rows (`<div class="scene-tree-component-row">`) immediately after each item's button: one row displaying the material name (derived from the `MATERIAL` constant reverse-map), one row showing the physics body type if `physicsRigidBody` is non-null, one row showing the animation name if an animation component is attached; sub-rows are indented one level deeper than the item and receive no click or keyboard handling
- [x] Add a `+` icon button inside `#scene-tree-header` beside the item-count `<span>` that opens a small inline popover listing "Sphere / Cube / Cylinder / Torus / Capsule / Light" â€” dispatches the same `data-action` events used by the Create panel; once this path is live and verified, remove the "Create" tab from the inspector tab strip and move its keyboard shortcut (Ctrl+1) to trigger this popover instead
- [ ] Add a translate gizmo with draggable per-axis arrows and a free-move plane handle
- [ ] Add a scale gizmo with draggable per-axis handles and a uniform scale center handle
- [ ] Add Ctrl + drag on the scale gizmo to scale uniformly across all axes
- [ ] Add a rotate gizmo with draggable per-axis arc handles (X, Y, Z rings)
- [ ] Add a free-rotate handle on the rotate gizmo for screen-space rotation
- [ ] Split transform editing into translate, rotate, and scale modes switchable via keyboard shortcuts (W, E, R)
- [ ] Keep gizmos aligned with the selected item's local or world space
- [x] Add numeric transform inputs for precise editing
- [ ] Support moving, scaling, and rotating multiple selected items around a shared pivot
- [x] Define how mixed-value fields are shown in the settings panel
- [ ] Add undo and redo for scene edits
- [x] Reset accumulation when a transform or scene edit changes the image

## Workstream 3: Assets, Materials, And Animation
- [ ] Add support for importing external 3D models into the scene
- [x] Choose and document the initial supported model formats
- [ ] Convert imported models into ECS-backed scene items and sub-items
- [ ] Preserve model hierarchy, pivots, and named nodes when importing
- [ ] Add support for textured materials on imported assets
- [x] Handle texture loading, caching, missing-texture fallbacks, and asset relinking
- [x] Add controls for assigning and swapping textures in the editor
- [x] Define how textured materials map into the path tracing material system
- [x] Add reusable material presets or saved materials

### Bundled Reference Models
- [x] Add `assets/models/suzanne.obj` to the project from the Khronos glTF Sample Assets Suzanne model (CC0-1.0 model files, 3,936 triangulated OBJ faces) so it serves as the canonical mesh import test and a recognisable benchmark reference
- [x] Add `assets/models/suzanne_low.obj` as a 196-triangle generated low-cost variant for testing the import pipeline before committing to the full-resolution model
- [x] Register `Suzanne Reference Mesh` as a named Scene menu preset using the generated low-triangle Suzanne reference data
- [ ] Replace the low-triangle Suzanne reference preset with the full `suzanne.obj` mesh once the BVH/GPU triangle-storage path supports the full asset
- [x] Add a self-contained **Sponza** scene GLB as `assets/models/sponza/sponza.glb` from the Khronos glTF Sample Assets Sponza model; preserve the upstream Cryengine Limited License Agreement notice beside the asset and document that the separate Intel CC-BY Sponza Base Scene package is much larger and not the file bundled here
- [x] Attach the bundled Sponza GLB asset path and triangle count to the `benchmarkSponzaAtrium` metadata so the primitive benchmark has a concrete full-scene mesh reference target

### OBJ Format Support (Phase 1 â€” Implement First)
- [x] Write an `ObjParser` class in `src/loaders/ObjParser.js` that reads `v`, `vn`, `vt`, `f`, `o`, `g`, `usemtl`, and `mtllib` directives from an OBJ string; produce a flat array of triangles each containing three positions, three normals, and three UV coordinates
- [x] Handle face definitions with vertex/texture/normal index triples (`f v/vt/vn`) as well as position-only faces (`f v`) and position+normal faces (`f v//vn`); recompute flat normals for faces that omit normal indices
- [x] Write an `MtlParser` class in `src/loaders/MtlParser.js` that reads `Kd` (diffuse colour), `Ks` (specular), `Ns` (shininess), `d`/`Tr` (opacity), and `map_Kd` (diffuse texture path); map each MTL material to the closest path-tracer material type
- [x] Expose a `loadObjFromUrl(url)` and `loadObjFromText(text)` API so models can be loaded from bundled assets, user file input, or drag-and-drop
- [ ] Support drag-and-drop of `.obj` + `.mtl` file pairs onto the canvas: read both files, parse the OBJ, resolve the MTL, and create a `MeshSceneObject` in the scene

### glTF 2.0 / GLB Format Support (Phase 2)
- [x] Write a `GltfLoader` class in `src/loaders/GltfLoader.js` that handles both JSON `.gltf` (with separate `.bin` buffer) and self-contained binary `.glb` files; extract all mesh primitives, their accessor data (positions, normals, UVs, indices), and their material references
- [x] Map glTF PBR `metallicRoughnessFactor` and `baseColorFactor` to the path tracer's GGX_PBR material with appropriate roughness and metalness uniform values
- [ ] Preserve the glTF scene node hierarchy in the ECS tree; each `node` with a mesh becomes an ECS item under a Group entity that carries the node's local transform
- [ ] Support drag-and-drop of `.glb` files onto the canvas as the primary user flow for glTF import

### STL Format Support (Phase 3)
- [x] Write an `StlParser` class in `src/loaders/StlParser.js` that handles both ASCII STL and binary STL; produce a flat triangle array with face normals; no material data (assign the current active material from the inspector)
- [ ] Support drag-and-drop of `.stl` files onto the canvas

### PLY Format Support (Phase 3)
- [x] Write a `PlyParser` class in `src/loaders/PlyParser.js` that handles ASCII and binary-little-endian PLY; extract `x y z` vertex positions, `nx ny nz` vertex normals if present, and `vertex_indices` face lists; produce a flat triangle array
- [x] If the PLY header contains `red green blue` vertex colour properties, store them as per-vertex colours and use them as the albedo in a DIFFUSE material on the resulting `MeshSceneObject`
- [ ] Support drag-and-drop of `.ply` files onto the canvas
- [ ] Add support for animated models and animation clips
- [ ] Add playback controls for play, pause, stop, speed, and clip selection
- [ ] Keep animation state in sync with transforms, selection, and scene editing
- [x] Decide how animated models interact with physics and benchmark mode
- [x] Add a system for procedural transform animations that can be attached to or detached from any item or group
- [x] Implement a continuous Y-axis spin animation (rotate around up axis at a configurable speed)
- [x] Implement a vertical bob animation (oscillate up and down at a configurable amplitude and frequency)
- [x] Implement a uniform pulse animation (oscillate scale in and out at a configurable amplitude and frequency)
- [x] Implement an orbit animation (circle around a configurable center point at a configurable radius and speed)
- [x] Implement a wobble animation (randomised small-angle rotation jitter to simulate instability or vibration)
- [x] Allow multiple animations to be stacked on the same item so effects can be combined
- [x] Show attached animations as components in the inspector for the selected item
- [x] Allow each animation component to be enabled, disabled, or removed individually from the inspector

## Workstream 4: Cameras, Lighting, And Render View
- [x] Add two distinct camera modes: FPS mode and editor orbit mode
- [x] FPS mode: WASD + mouse look, pointer lock, free-fly through the scene
- [x] Editor orbit mode: tumble around a focal point, optimized for placing and manipulating objects
- [ ] Make the camera a scene-owned object: each scene stores its active camera transform, lens settings, bookmarks, focus target, motion preset, and animation timing in scene data instead of treating camera state as global app state
- [ ] Move camera movement state onto the scene's camera controller: scene load/reset swaps the active camera controller with the scene, benchmark/demo scenes can define deterministic camera motion, and manual camera controls mutate only the current scene camera
- [ ] Add pinch-to-zoom camera controls on the canvas for touchscreens and precision trackpads; map the gesture to orbit-camera dolly/zoom in editor mode and FOV or forward movement only if FPS mode explicitly opts into it
- [ ] Add two-finger up/down/left/right panning on the canvas for touchscreens and trackpads; in editor orbit mode pan the focal point horizontally/vertically in camera space, clear accumulated samples after each gesture update, and avoid conflicting with browser page scrolling
- [x] Add a toggle between FPS and editor mode in the View menu and as a keyboard shortcut
- [x] Remember the last camera position and orientation when switching modes so context is not lost
- [x] Add camera bookmarks or saved shots
- [x] Add camera controls for FOV, focus distance, and aperture or depth of field
- [x] Add a simple shot switcher for comparing scene compositions
- [ ] Add an item-tour camera animation for the scene camera: iterate through visible renderable ECS items, ease toward each item's bounds, zoom in for detail, zoom back out, and skip hidden/locked/group-only items unless explicitly included
- [ ] Add a stable shaky-cam camera motion preset with deterministic seeded noise, amplitude/frequency/smoothing controls, and optional horizon stabilisation so it feels handheld without drifting away from the target
- [ ] Add additional scene-camera movement presets: slow orbit around selected item or full-scene bounds, dolly push-in/pull-back, lateral truck/slide, vertical crane/pedestal, target-follow, and rack-focus moves driven by the scene camera's focus distance
- [x] Add explicit light editing for position, size, intensity, and color
- [x] Add environment or sky controls that are easier to adjust during scene comp
- [x] Add render debug views such as albedo, normals, and depth
- [x] Add draft, preview, and final quality presets
- [x] Add a dedicated benchmark mode with fixed render settings for repeatable comparisons
- [x] Create a specific benchmark scene that stays stable across releases
- [x] Lock camera path, timing, and scene setup while benchmark mode is active
- [x] Show benchmark-only stats that are easy to compare between runs
- [x] Replace Rays/frame, Samples/frame, and Trace time tiles in the benchmark panel with Resolution, Bounces, and GPU renderer
- [x] Update benchmark panel HTML: swap the three low-value metric tiles for Resolution, Bounces, and a full-width GPU renderer label row; update grid to 6 columns
- [x] Update JS element reads: remove benchmarkRaysPerFrame, benchmarkSamplesPerFrame, benchmarkFrameTime readRequiredElement calls; add benchmarkResolution, benchmarkBounces, benchmarkGpuRenderer
- [x] Update BenchmarkDisplay class: remove raysPerFrameElement, samplesPerFrameElement, frameTimeElement constructor args and update() writes; add resolutionElement, bouncesElement, gpuRendererElement
- [x] Wire resolution, bounces, and GPU renderer at init: set resolutionElement to CANVAS_SIZE string, bouncesElement to applicationState.lightBounceCount, gpuRendererElement from readWebGlGpuInfo().renderer at startup
- [x] Wire render resolution (CANVAS_SIZE x CANVAS_SIZE) into a static benchmark context tile
- [x] Wire light bounce count (applicationState.lightBounceCount) into a static benchmark context tile
- [x] Move GPU renderer string from the scene panel into the benchmark panel as a full-width label row
- [x] Keep perceptual FPS and ray memory bandwidth tiles as high-value persistent metrics
- [x] Convert the benchmark view into a regular vertical standing panel with collapse/close controls so benchmark metrics stay visible without overlapping draggable editor windows
- [x] Clarify and enforce three distinct pause modes so they do not interfere with each other
- [x] Pause camera: stops automatic camera rotation only, the world and physics still update and rays keep accumulating
- [x] Pause frames: stops the world simulation and physics entirely, no transforms or animations update, but the camera can still be moved freely
- [x] Pause rays: after the current sample count is reached no new rays are cast, the last converged image is held on screen, camera and world are still live
- [x] Expose all three pause toggles independently in the UI so any combination can be active at once
- [x] Label each control clearly in the menu and benchmark panel so the difference between the three modes is obvious

### Render Comparison And Playback
- [ ] Add a vertical split-screen comparison mode (toggled in the View menu) that renders both halves with independently configurable bounce count, rays-per-pixel, or material override so quality differences are visible side by side on the same scene without switching scenes
- [ ] Add a convergence time-lapse recorder that captures a frame every N accumulated samples from the initial noisy state to near-convergence and plays them back as an in-app animation; useful for demonstrating what progressive path tracing does and for diagnosing fireflies or slow-converging regions
- [ ] Add a kiosk / autoplay mode that cycles through all registered scene presets (or a user-defined ordered subset) with a configurable dwell time per scene and a cross-fade transition; intended for trade-show or unattended display use where the app should run indefinitely without interaction

### Benchmark Informatics And Result Sharing
- [x] Add a **samples-accumulated counter** tile to the benchmark panel showing total sample count since the last scene change plus a convergence status label ("Converging" / "Stable") derived from a rolling per-pixel variance estimate falling below a threshold; tells the user whether the current image is still meaningfully improving or has plateaued
- [x] Add a **GPU buffer memory** estimate row to the benchmark panel: compute the byte cost of all live render targets (accumulation buffer, bloom intermediate, display composite â€” each width Ã— height Ã— channels Ã— bytes-per-channel) and display as "GPU buffers: X MB" so users understand the VRAM cost of high render resolutions before hitting a silent OOM
- [x] Add a **scene complexity** stat row (object count, active shader variant count, and once mesh rendering is live: total triangle count) that updates on every `rebuildScene` call; surface it as a footer in the scene tree panel and as a tile in the benchmark panel so both casual and technical users can gauge scene complexity at a glance
- [x] Add a **"Share Result" button** to the benchmark panel that encodes the current score, GPU renderer string, canvas resolution, bounce count, scene name, and ISO date as a compact base64 JSON in the URL hash (`#result=<base64>`); copies the full URL to the clipboard and shows a transient "Copied!" toast â€” no server required, the URL is self-contained
- [x] Add an **"Export Score Card" PNG** button to the benchmark summary: use the 2D Canvas API to render a 800Ã—400 summary card with score, GPU name, scene name, resolution, bounce count, date, and delta-vs-baseline if a baseline exists; trigger an automatic download via a transient `<a download>` element so benchmark results are self-documenting shareable images
- [x] Add **metric explanation tooltips** (HTML `title` attribute on each tile `<dt>`) to the benchmark panel: "Score â€” composite ray throughput Ã— quality factor, higher is better"; "Active rays/s â€” rays reaching at least one surface per second weighted by bounce depth"; "Ray mem BW â€” estimated bytes read/written to the accumulation texture per second at current resolution and sample rate"; "Perceptual FPS â€” rendered frames per second smoothed over 1 s, independent of accumulation sample count"

- [x] Normalize frame-estimated benchmark scores to a fixed 512 x 512 reference render target so score comparisons are not dominated by render resolution, while raw active rays/s still reports current render-target throughput

## Workstream 5: App UI, Output, And Global Tools
- [x] Add a menu strip at the top of the page for global tools and settings
- [x] Decide which controls belong in the top menu vs the per-item editor panels
- [x] Group global render, camera, environment, and benchmark controls into clear menu sections
- [x] Redesign the UI to make scene settings easier to edit
- [x] Add a clearer workflow for creating, selecting, and editing scene items
- [x] Add page or viewport resolution settings for the renderer and UI layout
- [x] Define how resolution presets, custom resolution input, and aspect ratio locking should work
- [x] Make resolution changes update the canvas and any related render targets safely
- [x] Keep the visible canvas fitted to the page when the internal render size changes
- [x] Add a canvas fullscreen toggle for inspecting supersampled renders
- [x] Add an option to save a bitmap from the canvas
- [x] Decide which export formats are supported first and whether export uses current resolution or a custom output size
- [x] Ensure bitmap export works with progressive accumulation and produces a clean final frame
- [x] Make the app layout full-screen with the render canvas filling the entire page
- [x] Move editor panels into overlay UI that sits on top of the canvas instead of beside it
- [x] Make sure overlay panels do not block basic camera navigation more than necessary
- [x] Convert the top menu strip into a traditional application-style menu bar
- [x] Define top-level menus such as File, Edit, View, Create, Render, and Help
- [x] Add keyboard shortcuts to the menu bar for the main app actions
- [x] Add top-menu quick actions for common scene, primitive, panel, render, fullscreen, benchmark, and export actions
- [x] Add quick action toggle buttons to show and hide the scene tree panel
- [x] Add quick action toggle buttons to show and hide the inspector panel
- [x] Add quick action toggle buttons to show and hide the benchmark panel
- [x] Add a quick action to reset physics interactions without rebuilding the whole scene: restore physics-enabled objects to their last authored/editor transforms, rebuild or resync Rapier bodies, clear accumulated samples, and leave materials, lights, camera, quality settings, and scene membership unchanged
- [x] Move the scene pause controls into their own compact quick-access control box: group the frame/world pause and ray-accumulation pause toggles together, keep their active states visually distinct, and keep them reachable without opening Render, Benchmark, or menu panels
- [x] Keep each toggle button visually active or inactive to reflect the current panel visibility state
- [x] Add a fullscreen panel mode that keeps overlay controls and benchmark visible over the canvas
- [x] Add movable window panels for the ECS tree and selected-object settings
- [x] Allow floating panels to be dragged, focused, collapsed, and reopened
- [x] Keep ECS and object-settings windows in sync with the current selection and active scene
- [x] Decide whether floating panels can dock or should remain free-floating only
- [x] Save and restore panel positions, sizes, and visibility between sessions
- [x] Split resolution settings into two independent controls: one for the UI canvas and one for the 3D render target
- [x] Default the UI canvas resolution to the browser canvas size
- [x] Default the 3D render resolution to the canvas element's CSS pixel size at startup instead of the hardcoded `DEFAULT_CANVAS_SIZE = 512`; read the canvas display bounds on both axes and round only to whole pixels so the initial render fills the visible area without a scale-up or 64 px snapping
- [x] Add render scaling as the primary resolution control: store a `renderScale` value, derive the actual render dimensions from the canvas/stage width and height without 64 px rounding, default 1x to the canvas stage size on both axes, and split safe scaling into Fractional HQ and Pixel Perfect modes
- [x] Show the render scale control in the Output panel (label "Render Scale") as a slider with a mode toggle: Fractional HQ snaps to 0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 1.75x, 2x, 2.5x, and 3x; Pixel Perfect snaps to 1x, 4x, 6x, and 8x; display the resolved pixel dimensions in real time next to it (e.g. "512 x 512") so the user always knows the exact render size without mental arithmetic
- [x] Separate the three resolution concepts: canvas/stage size is the available browser drawing area, render resolution is the WebGL target derived from scale or arbitrary custom width/height, and UI canvas size is the contained on-screen canvas that always respects the active render aspect ratio
- [x] Default render aspect ratio to the canvas/stage aspect for scaled renders while keeping square 1:1 presets and arbitrary custom render sizes available
- [x] Keep the three hardcoded pixel-size presets (256, 512, 1024) as secondary "pin to size" buttons alongside the scale slider for workflows where an exact pixel count matters; selecting a preset overrides the scale value and updates the slider to the nearest equivalent scale, but does not lock the slider from future changes
- [x] Make the default render aspect ratio follow the live canvas aspect ratio on first load and reset, deriving the initial render width/height from the canvas bounds instead of defaulting back to a square target when no explicit render size is requested
- [x] Keep 1:1 square render ratios available as explicit presets, including the existing 256 x 256, 512 x 512, and 1024 x 1024 options, so users can still pin the render target to a square output when they want icon, benchmark, or social-preview framing
- [x] Allow any custom width and height to be entered for the render resolution, supporting arbitrary aspect ratios
- [x] Keep the UI canvas aspect ratio locked to the render resolution aspect ratio at all times so they never drift
- [x] When render resolution changes, resize the UI canvas to match the new aspect ratio
- [x] Show both resolution controls in the render or view settings section of the menu bar

### Menu Bar Restructure
- [x] Add a **Scene** top-level menu between Create and Render to house all scene-loading actions; this removes preset and benchmark scene items from Help and Render respectively where they currently do not belong
- [x] Scene menu: add a "Load Preset" labelled group listing all 13 `scenePresetFactories` entries split by two separators (Core presets / Shader and recursive / Primitive and light showcases)
- [x] Scene menu: add a "Benchmark Scenes" labelled group listing Standard Benchmark (shortcut: Fixed) plus all WS11 benchmark scene entries; move these out of the Render menu
- [x] Scene menu: add a "Run Benchmark Sequence" item and keep the "Demo Scenes" submenu placeholder greyed out for WS12 scenes
- [x] File menu: add "New Scene" (Ctrl+N) at the top; move "Output Settings" (Ctrl+5) into File below a separator so all file-output actions are co-located; remove Output from the Render menu
- [x] Edit menu: add greyed-out "Undo" (Ctrl+Z) and "Redo" (Ctrl+Y) stubs at the top above the existing separator; add a greyed-out "Duplicate Selected" (Ctrl+D) below "Delete Selected"
- [x] Edit menu: remove "Object Settings" panel link (a View action, not an Edit action); keep Select Light and Delete Selected only
- [x] View menu: add a "Camera Auto-Rotate" toggle (shortcut C) since it controls what is visible, not how rendering is computed; remove it from the Render menu if it appears there
- [x] Render menu: add debug-view actions for Beauty, Normals, Albedo, and Depth; fix the Fullscreen Panels button so it shows no shortcut hint instead of the live state value "Off"
- [x] Remove the inspector Create panel and route Ctrl+1 to the scene-tree add popover alongside the top quick Add action
- [x] Render menu: keep only render-execution controls â€” Pause Frames (P), Pause Rays (K), and quality preset buttons (Draft 1 / Preview 2 / Final 3); move Render Settings (Ctrl+3), Camera Settings (Ctrl+4), and Environment Settings here as a settings group; remove benchmark scene entries and Output (both moved)
- [x] Keep Render-panel environment switching wired to a scene rebuild even after React signal sync has already updated the shared environment state
- [x] Quick actions toolbar: rename terse labels to recognisable words such as `Sphere`, `Light`, `Add`, `Object`, `Render`, and `Benchmark`
- [x] Quick actions toolbar: rename pause buttons from `P` and `K` (shortcut letters, meaningless as labels) to `â€–Frm` and `â€–Rays` so the action is legible without a tooltip
- [x] Quick actions toolbar: remove the `Std` (standard benchmark) button â€” the standard benchmark is now reachable via the Scene menu and the toolbar is already too wide; remove `Cyl` and `Tor` shape shortcuts for the same reason
- [x] Quick actions toolbar: ensure the four preset scene buttons (Col, Mat, Prim, Lit) remain as the leftmost group since they are the most common scene-switch actions
- [x] Convert quick-action-adjacent menu groups into nested submenus for presets, benchmark scenes, panel visibility, render quality/debug views, and export actions so top-level menus match the toolbar's mental model

### Accordion Inspector Redesign
- [x] Replace the tab row (`<div>` of `<button data-panel-target>` elements) in `#controls` with a vertical accordion using native `<details>`/`<summary>` elements: one `<details>` per section (Object, Render, Camera, Environment, Output); each wraps the existing control markup verbatim so no logic changes are needed in this pass
- [x] Drive the Object section's `open` attribute from JS selection events: add `open` when `syncSelectedItemReadout()` selects a non-null item, remove it when selection clears; set the summary text to the selected item's display name when open and "Nothing selected" when closed so it doubles as a selection readout
- [x] Add a CSS custom property `--section-accent` to each `<summary>` (`#4a90e2` Object, `#5cb85c` Render, `#f0ad4e` Camera, `#9b59b6` Output) and apply it as `border-left: 3px solid var(--section-accent)` plus tinting the expand chevron so sections are visually distinct without relying on tab position or color alone
- [x] Persist each global section's open/closed state to `localStorage` under the key `inspector-section-{sectionKey}` via a `toggle` event listener on each `<details>`; restore the persisted state on page load before the first render so the inspector reopens in the layout the user left it in
- [x] Remove the `data-control-panel` / `hidden` attribute toggle JavaScript once `<details>` self-manages open state; menu shortcuts now open the target section while the Object section is driven by selection

### UI Polish And Refinement
- [x] Replace the quick-actions toolbar text abbreviations (`Col`, `Mat`, `Prim`, `Lit`, `FS`, `PNG`, etc.) with compact SVG icons or clearer full-word labels so the toolbar reads instantly without relying on tooltips
- [x] Replace the floating-window collapse and close glyphs (`-` and `x`) with polished symbols or icons so the titlebar controls align cleanly and match the rest of the interface
- [x] Replace the accordion summary chevron text glyph (`>`) with a proper chevron icon or glyph so collapsed and expanded states look crisp across platforms
- [x] Revisit the inspector section accent palette so it feels less like legacy Bootstrap defaults; give Create and Object distinct accents instead of reusing the same blue
- [x] Change the scene-tree selected-item highlight from the current amber-brown state to a clearer selection color that reads as active selection instead of warning or modified state
- [x] Move the camera/frame/ray pause controls out of the Create panel so object creation starts with creation tools only and render-state controls live in Render-oriented surfaces
- [x] Remove the large primitive-create grid from the Scene Tree window and replace it with a lean add-item affordance so the outliner stays focused on hierarchy and selection
- [x] Restyle the glossiness-factor control as a first-class labeled field or slider instead of inline prose plus a raw input so it matches the surrounding inspector controls
- [x] Replace or wrap the native light-color picker with a custom-styled control so it matches the dark inspector UI on Windows and other platforms
- [x] Add a short inline explanation for disabled physics controls so users understand why the fields are inert and how to enable them
- [x] Increase the visible canvas edge definition slightly so the render surface reads as an intentional frame against the dark background
- [x] Increase the small uppercase section-title typography slightly for better readability on non-HiDPI displays
- [x] Keep Help limited to documentation and support links; move scene and preset-entry actions out of Help when any remain there
- [x] Keep debug-view actions grouped with Render controls rather than View/window management so navigation and rendering concerns are separated cleanly
- [x] Add baseline styling for the benchmark runner summary area so dynamic result text has consistent spacing, color, and hierarchy
## Workstream 6: Physics And Codebase Structure
- [x] Allow physics to be enabled per item
- [x] Add per-item physics settings
- [x] Define which ECS components create Rapier bodies and colliders
- [x] Sync transforms between editor state and physics state
- [x] Add toggles for dynamic, kinematic, and static behavior
- [x] Expose common physics controls such as mass, friction, restitution, and gravity

### Compound Physics Bodies
- [ ] When a Group entity has physics enabled, create a single Rapier compound rigid body whose collider shape is the union of all children's bounding volumes rather than one rigid body per child; this allows complex multi-primitive objects to interact with physics as a single mass
- [ ] Propagate the group body's transform to each child every physics step so children follow the group without having their own Rapier bodies; children that had their own physics bodies before grouping should have those bodies removed and replaced by the group body
- [ ] Expose group-level physics properties (mass, friction, restitution, linear/angular damping) in the inspector when the group is selected; compute the effective mass as the sum of child masses or as a single override value
- [ ] When a group is ungrouped, distribute the group body's current velocity to each newly independent child that has physics enabled so momentum is not lost on ungroup
- [ ] Allow a child inside a group to be marked as a trigger collider (no physical response, collision events only) via a per-child checkbox in the inspector, without affecting the group body's physics
- [ ] Validate that CSG-merged nodes can also participate in compound group physics; the CSG node's bounding box is used as the collider shape since the SDF surface cannot be directly converted to a convex hull
- [ ] Split the files into smaller logic-focused modules to keep them manageable
- [ ] Separate scene state, editor UI, renderer integration, and physics integration into distinct modules
- [x] Extract reusable editor controls for item settings panels

### Stability And Resilience
- [x] Handle WebGL context loss (`webglcontextlost` / `webglcontextrestored` events): pause the render loop on loss, show an overlay message, and on restoration rebuild all framebuffers, shader programs, and uniform buffers without a page reload; log a `renderer` channel error on loss and `info` on successful restore so silent context resets are no longer invisible
- [x] Enforce physics world bounds: any dynamic rigid body whose Y translation falls below a configurable `PHYSICS_OUT_OF_BOUNDS_Y` threshold (default âˆ’5.0) should have its Rapier body removed and `physicsRigidBody` reference cleared; log a `physics` channel warning and leave the scene object in the ECS tree so the user can re-enable physics â€” prevents the infinite-fall case where objects tunnel out of the scene and generate Rapier NaN positions
- [x] Guard shader recompilation against rapid slider input: add a 100 ms trailing debounce to the `rebuildScene` + `clearSamples` sequence triggered by range `input` events so dragging a bounce-count or rays-per-pixel slider does not fire a new `gl.compileShader` for every pixel of travel
- [x] Wrap every scene preset factory call in a try/catch inside `loadPresetScene`; on factory error log the failure with the scene key, recover to a blank scene via `createEmptyScene()`, and surface the error message in `#error` so the app stays usable rather than freezing with an empty or broken canvas
- [x] Add a startup smoke-test: after `initializeRapierRuntime` resolves, iterate every registered benchmark scene factory, call it with an empty array, and assert the returned object list is non-empty and contains no `undefined` entries; report failures at `error` level with the offending key so regressions in scene factories are caught before a user loads that scene

- [x] Show a scene-change progress dialog that lists renderer offload, shader/program release, memory cleanup, new asset/component loading, shader compilation, and ready steps while scene changes are paced through clean teardown and reload

### Physics Controls And Joints
- [x] Add a global gravity control in the Scene or Physics settings panel: a direction dropdown (Down / Up / Zero-G / Custom) and a magnitude slider (0â€“20, default 9.81); write the resulting `{x, y, z}` vector to `world.gravity` at the start of each physics step so any scene can be switched to zero-G or reversed gravity at runtime without a preset change
- [x] Store a `gravityScale` override in each benchmark and preset scene's metadata object (e.g. `gravityScale: 0` for the particle fluid scene) and apply it when the scene is loaded so scenes that require specific gravity configurations are self-contained
- [x] Add spring joint creation between two selected physics-enabled objects: when exactly two physics items are selected, show a "Connect Spring" button in the inspector that creates a Rapier `JointData.spring()` between their centres with configurable rest length, stiffness, and damping sliders; record the joint handle on both scene objects and render the connection as a dashed-line annotation in the scene tree component rows
- [x] Allow joints to be deleted from the inspector: when a physics-enabled object is selected, show a "Connected joints" list displaying each joint's partner object name and a remove button; the remove button calls `world.removeImpulseJoint()`, clears the handle from both objects' records, and triggers a scene-tree refresh

### Logging And Debug Instrumentation
- [x] Define a structured logger with named channels (e.g. `renderer`, `physics`, `sceneLoad`, `ui`, `assetPipeline`) and four levels (`debug`, `info`, `warn`, `error`); gate `debug` messages behind a `localStorage` flag so they are off in production but trivially re-enabled per channel in DevTools without a rebuild
- [x] Add `renderer` channel logs at WebGL/WebGPU init: log the resolved backend, GPU renderer string, context attributes, max texture size, and any capability checks that fail silently today (e.g. `EXT_color_buffer_float` presence, `timestamp-query` availability)
- [x] Add `renderer` channel logs around each frame phase: shader compile time (once at startup), accumulation pass, bloom/glare post-process pass, and display composite pass â€” log only the first frame and on changes so the console is not flooded
- [x] Add `physics` channel logs: log world creation and teardown, `rebuildScene` call count and object counts per rebuild, Rapier WASM init time, and any `returnFailure` paths inside `addFixedSphere` / `addDynamicSphere` / `addFixedCube` / `addDynamicCube` / `addRoomBoundaryCollider`
- [x] Add `sceneLoad` channel logs: log scene name, object count, and load duration for every preset scene load and every `rebuildScene`; log any missing or defaulted fields encountered when deserialising saved scene JSON
- [x] Add `assetPipeline` channel logs: log model file name, triangle count, BVH build time, and GPU upload size (bytes) for every `MeshSceneObject` import; log texture atlas dimensions and layer count when the atlas is built
- [x] Add `ui` channel logs at panel init, event-listener registration failures (any `readOptionalElement` that returns null for an expected element), and any `returnFailure` paths inside `updateSelectedPhysicsFromControls`, `updateMaterialFromSelect`, and `applyMaterialToSelection`
- [x] Add a **Log Panel** (toggled in the View menu, default hidden): a fixed-height scrollable `<pre>` overlay in the corner that captures the last N `warn` and `error` log lines with timestamps, so runtime errors are visible without opening DevTools â€” useful in Electron and fullscreen modes

## Workstream 7: Rendering Backends And WebGPU
- [ ] Add a renderer abstraction so WebGL and WebGPU can share the same scene and app state
- [ ] Keep scene, camera, materials, and editor logic backend-agnostic where possible
- [ ] Add initial WebGPU support for the core rendering path
- [x] Decide which features must work in both backends and which can stay WebGPU-only at first
- [ ] Add runtime selection between WebGL and WebGPU
- [x] Detect WebGPU support at startup and fall back to WebGL when unavailable
- [x] Add a visible backend selector in the app settings or render menu
- [x] Define whether backend switching requires a renderer restart or can happen live
- [ ] Make backend changes rebuild the required GPU resources safely
- [x] Keep benchmark reporting aware of the active rendering backend
- [ ] Add backend-specific ray-rate profiling so WebGL and WebGPU hotspots can be compared directly
- [ ] Measure the cost of accumulation texture transfers and reduce extra full-frame copies where possible
- [x] Review whether preserveDrawingBuffer is still needed and disable it when export does not require it
- [x] Reduce unnecessary post-process passes for bloom, glare, and display composition in draft modes
- [x] Minimize per-frame uniform and state updates by batching or caching unchanged renderer state
- [x] Add dynamic quality controls that can lower rays per pixel or internal render resolution to protect ray rate
- [ ] Investigate scene acceleration structures or faster scene queries for larger object counts
- [x] Specialize shaders or pipelines for common material paths instead of paying for rarely used branches every frame
- [ ] Add WebGL-specific optimization passes for texture bandwidth, framebuffer usage, shader branching, and draw-pass count
- [ ] Add WebGPU-specific optimization passes for compute-based accumulation, buffer layouts, workgroup sizing, and async resource uploads

### WebGPU Path-Tracing-Specific APIs
- [ ] Migrate the path-tracing kernel from a fragment shader to a WebGPU **compute shader**: dispatch one workgroup invocation per pixel, write radiance directly into a storage texture, and remove the fullscreen quad draw entirely; compute shaders have no rasterisation overhead, allow arbitrary control flow without derivative restrictions, and give direct access to workgroup shared memory for BVH traversal stacks
- [ ] Use the WebGPU **`timestamp-query`** optional feature (`device.features.has('timestamp-query')`) to measure exact GPU time per compute dispatch; replace the current frame-estimate fallback with sub-millisecond GPU-side timing and surface the precise ray-rate figure in the benchmark panel â€” note: Chrome requires `--enable-dawn-features=allow_unsafe_apis` for this feature in some builds
- [ ] Investigate the WebGPU **`subgroups`** extension (`wgsl_language_features.has('subgroups')`) for coherent BVH traversal: use `subgroupBallot` / `subgroupShuffle` to keep threads in a workgroup traversing the same BVH node simultaneously, reducing warp divergence in the iterative traversal loop for triangle mesh scenes
- [ ] Monitor the WebGPU **hardware ray tracing extension** (gpuweb/gpuweb issue #535, tracked as Milestone 4+): as of 2026 there is no browser implementation in Dawn or Chrome, but wgpu has experimental support; revisit when a browser ships `acceleration-structure` and `ray-query` primitives in WGSL â€” these would replace the software BVH traversal loop with a hardware `rayQueryInitialize` / `rayQueryProceed` call and could deliver a large ray-throughput multiplier on RTX/RDNA3/Apple Silicon hardware

### Triangle Mesh GPU Rendering
- [ ] Define a `MeshSceneObject` class that holds a flat triangle array (positions + normals + UVs), a material, a world-space transform, and a CPU-side axis-aligned BVH built at load time using surface-area heuristic (SAH) splitting; this is a parallel rendering path alongside the existing SDF/analytic objects
- [ ] Build a BVH packer that serialises the SAH BVH into two `Float32Array` texture buffers: one 32-bit-per-node buffer storing AABB min/max and left/right child or leaf triangle range, and one tightly-packed triangle soup buffer; upload both to WebGL as `RGBA32F` `samplerBuffer` textures at load time
- [ ] Add MÃ¶llerâ€“Trumbore ray-triangle intersection as a GLSL function in the path-trace shader; it receives a ray origin and direction, samples the triangle buffer by index, and returns hit distance, barycentric coordinates, and the triangle index
- [ ] Add an iterative BVH traversal loop in GLSL that walks the node buffer using a small fixed-size stack (depth 32); at leaf nodes call the MÃ¶llerâ€“Trumbore function for each triangle in the leaf's range; this replaces the per-mesh uniform approach used by SDF objects
- [ ] Interpolate per-vertex normals using barycentric coordinates at the hit point so smooth-shaded meshes (Suzanne, glTF models) produce smooth highlights rather than faceted face normals
- [ ] Interpolate per-vertex UVs using barycentric coordinates and sample a bound `sampler2D` albedo texture if the material has one; fall back to the material's uniform colour if no texture is bound
- [ ] Extend texture support beyond albedo: bind a normal-map `sampler2D` per mesh material and apply TBN tangent-space transform at hit points using barycentric-interpolated tangents/bitangents derived from the UV gradient (`dFdx`/`dFdy` or precomputed per-vertex); bind metallic-roughness, emissive, and AO maps in the same material texture slot array so a full glTF PBR material can be faithfully reproduced in a single path-trace hit evaluation
- [ ] Build a texture atlas for multi-material meshes (e.g. Sponza's 26 material groups): pack all per-material base-colour textures into a single `RGBA8` 2-D texture array (`GL_TEXTURE_2D_ARRAY`) and store a `materialIndex` per triangle in the triangle soup buffer; the GLSL hit shader indexes into the array with `texture(atlasTexture, vec3(uv, float(materialIndex)))` to avoid per-draw-call texture swaps
- [x] Fit every loaded mesh inside the scene's unit cube on import by computing its AABB and uniformly scaling it to a configurable target size (default: longest axis = 1.0 unit) so Suzanne and other models appear at a consistent scale regardless of their original export units
- [ ] Add a `MeshSceneObject` entry in the ECS tree showing triangle count, BVH node count, and memory usage (KB) in a detail row below the item name
- [ ] Validate the full pipeline on Suzanne: load `assets/models/suzanne.obj`, build BVH, upload to GPU, path-trace at 512Ã—512 with DIFFUSE material and confirm normals, silhouette, and shadow all render correctly before enabling other formats

### Denoising And Adaptive Sampling
- [ ] Add a spatial bilateral denoiser post-pass (toggled in the Render menu) that blurs the accumulated image weighted by colour similarity and depth difference; reduces visible noise in converging scenes without changing the path tracer output and makes the quality/performance trade-off visible interactively
- [ ] Add a temporal reprojection pass that reuses samples from the previous frame for pixels whose world-space position has not moved; reduces per-frame ray cost for static regions in slowly-rotating or paused scenes
- [ ] Add adaptive per-pixel sample budgeting â€” track per-pixel variance after each accumulation step and allocate additional rays only to pixels above a variance threshold; expose the variance map as a debug overlay (bright = more samples needed) to demonstrate the technique visually
- [ ] Add a variance heat-map debug view alongside the existing albedo/normals/depth debug views so the adaptive sampling distribution can be inspected at runtime

### Rendering Quality Pipeline
- [ ] Pre-compile all shader variants during the startup loading phase (after Rapier WASM init, before the first rendered frame): enumerate every material-type flag combination used by the scene and call `gl.compileShader` + `gl.linkProgram` for each while the loading overlay is still showing; eliminates the hundreds-of-milliseconds first-frame freeze that currently inflates benchmark warm-up time and corrupts the first score sample
- [x] Add **progressive quality throttle during camera drag**: while a pointer button or touch is held on the canvas, temporarily reduce rays-per-pixel to 1 and bounce count to 2 so dragging the camera feels responsive at any render resolution; restore the configured quality values on `pointerup` and call `clearSamples()` once so clean accumulation resumes from a single frame
- [ ] Add **HDRI environment map loading**: accept a `.hdr` (RGBE) file via a file-picker button or canvas drag-and-drop; decode the RGBE encoding on the CPU into a `Float32Array`, upload as an `RGBA32F` equirectangular `sampler2D`, and sample it in the sky branch of the path-trace shader as a replacement for the procedural gradient; add an "HDRI" option to the environment type selector alongside Open Sky and Studio
- [x] Add **tone mapping presets** selectable in the Image Correction panel: ACES filmic, Reinhard, Uncharted 2 (Hable), and the current linear pass-through; apply the selected curve in the display composite shader as the final step before gamma correction (`linearRgb â†’ tonemapped â†’ pow(x, 1/2.2)`) so all options operate in linear light space without touching light intensity or sky brightness uniforms
- [x] Add an **independent exposure control** (EV stop offset, range âˆ’3 to +3, default 0, step 0.25) applied as `linearRgb *= pow(2.0, exposureEV)` immediately before tone mapping; allows brightness matching across scenes and GPUs without touching per-object light intensity or environment brightness sliders

## Workstream 9: JS Performance (CPU-Side Hot Path Fixes)

### DOM and Display
- [x] `syncActionToggleButtons()` caches button node lists at init time per action name so pause-toggle sync does not run dynamic `querySelectorAll()` calls on every toggle
- [x] `syncAllControlsFromState()` uses previous-value guards for integer and number controls so unchanged preset or scene rebuild state skips DOM `.value` and `.textContent` writes
- [x] `syncSceneTree()` uses an in-place diff keyed by scene entity ID so tree refreshes only create, update, or remove buttons that changed
- [x] `writeElementTextIfChanged()` caches last-written strings in JS state so hot-path text comparisons do not read `element.textContent` from the DOM
- [x] `BenchmarkDisplay.update()` returns at the top of the function when the throttle window has not elapsed, avoiding string formatting and DOM prep on skipped frames

### Physics Sync
- [x] `syncPhysicsObjectsFromBodies()` reads Rapier body translations into reusable buffers and uses the lower-level raw body-set translation path when available, avoiding per-body `{x,y,z}` allocation on supported Rapier builds

### Benchmark Rolling Window
- [x] `recordTraceSample()` writes into a fixed-size circular buffer of preallocated sample objects instead of allocating a new sample record every rendered frame
- [x] `pruneOldEntries()` only runs when the oldest ordered sample is about to fall outside the rolling window instead of on every sample push

### Uniform Uploads
- [x] `setTracerFrameUniforms()` skips scalar uniform object writes and cached-uniform diffs when the frame scalar values have not changed
- [x] `webGlContext.useProgram()` is guarded by a module-level currently-bound-program cache so repeated render paths do not rebind the same WebGL program

### Scene Name Formatting
- [x] `formatSceneObjectDisplayName()` uses a module-level constructor-to-display-name map so scene tree and inspector refreshes do not repeatedly regex-format stable class names

### Setup and Architecture
- [x] Decide between Preact+HTM and React+HTM: prefer Preact for bundle size and signal-based fine-grained updates
- [x] Add an importmap in `index.html` that maps `preact`, `preact/hooks`, `htm/preact`, and `@preact/signals` to vendored ESM assets
- [x] Add a `src/` directory to hold Preact/HTM UI source files as plain ES modules
- [x] Create `src/main.jsx.js` as the app entry point that imports Preact and mounts the root component into `#ui-root`
- [x] Add the `#ui-root` div to `index.html` as a sibling of `#main` at the body root, positioned above the canvas layer
- [x] Keep the active fallback `<canvas>` and `#error` elements in static HTML while the legacy WebGL entrypoint owns rendering
- [x] Extract all CSS from the inline `index.html` style block into `src/app.css` so styles survive HTML teardown
- [x] Verify the app loads and renders correctly in both the Electron shell and the browser/GitHub Pages deploy path after the importmap is added

### State Management
- [x] Create `src/store.js` that converts `createApplicationState()` into Preact signals, one signal per field so components only re-render when their specific field changes
- [x] Export typed signal accessors and setter functions from `src/store.js` to avoid raw `.value` writes scattered across components
- [x] Create `src/benchmarkStore.js` with signals for all `benchmarkSnapshot` fields: score, rays/s, bandwidth, perceptual FPS, resolution, bounces, GPU renderer string, and source label
- [x] Create `src/sceneStore.js` with a signal for the live scene item list and a signal for the current selected item ID
- [x] Wire the existing render loop to call `updateBenchmarkSignals(snapshot)` at the same throttle interval used by `BenchmarkDisplay.update()`

### Component: FloatingWindow
- [x] Create `src/components/FloatingWindow.js` as a generic draggable, collapsible, closeable panel wrapper
- [x] Accept `windowKey`, `title`, `defaultPosition`, `defaultVisible`, and `children` props
- [x] Manage drag state with `useRef` for the offset and `useCallback` for pointer handlers so drag motion does not trigger unnecessary signal re-renders
- [x] Persist panel position and visibility to `localStorage` under the same key scheme as the current `data-window-key` attributes
- [x] Restore persisted position and visibility on mount via `useEffect`
- [x] Expose a collapse toggle that hides the panel body while keeping the title bar visible
- [x] Forward a `ref` so parent components can programmatically show, hide, or focus a window
- [x] Ensure pointer capture is used for drag so fast pointer moves cannot escape the panel boundary

### Component: MenuBar
- [x] Create `src/components/MenuBar.js` as the fixed top navigation bar
- [x] Create `src/components/MenuGroup.js` for a single dropdown group with trigger button and popover
- [x] Use `focus-within` CSS for auto-open and a click-outside `useEffect` to close the open menu when clicking elsewhere
- [x] Recreate File, Edit, View, Create, Render, and Help menu items as data-driven arrays so adding menu entries does not require JSX edits
- [x] Create `src/components/QuickActions.js` for the right-side toolbar of icon buttons and preset loaders
- [x] Keep `data-action`, `data-preset`, and `data-window-target` click routing by delegating to the same `handleMenuAction` path used by the fallback runtime
- [x] Render keyboard shortcut hints in `<span className="menu-shortcut">` inside each menu item from the same data array
- [x] Render `aria-pressed` on quick-action buttons reactively from the relevant signal maps

### Component: InspectorPanel
- [x] Create `src/components/InspectorPanel.js` as the floating inspector window using vertical accordions instead of tabs
- [x] Create `src/components/AccordionSection.js` with persistent open state, accent styling, and a CSS-rotated chevron
- [x] Drive the Object accordion open state from `selectedSceneItem` so selecting an ECS item opens details without overriding manual user scroll/editing unnecessarily
- [x] Remove the active-panel tab model from the migrated inspector; the Create panel moves to the scene tree add button and is not rendered as an inspector section
- [x] Create `src/components/panels/CreatePanel.js` with the add-primitive button grid and camera/pause controls
- [x] Create `src/components/panels/ObjectPanel.js` with selected-item name, material select, glossiness input, and apply button
- [x] Automatically open and scroll the Object/detail inspector section when canvas selection changes to an ECS item
- [x] Create `src/components/panels/RenderPanel.js` with render sliders for bounces, light intensity, light size, fog, sky brightness, rays per pixel, temporal AA, and denoiser
- [x] Create `src/components/panels/CameraPanel.js` with FOV, focus distance, aperture, and motion blur sliders
- [x] Create `src/components/panels/OutputPanel.js` with resolution preset, custom size input, apply/fullscreen/export buttons, renderer backend select, and color correction controls
- [x] Split output controls and image correction into separate inspector groups
- [x] Create `src/components/panels/PresetPanel.js` with the preset scene button grid and reset-all
- [x] Create `src/components/SliderField.js` as a reusable labeled range input with live value display
- [x] Wire each `SliderField` to read from and write to the corresponding signal so application state and sliders stay in sync without separate component-local event plumbing

### Component: SceneTreeWindow
- [x] Create `src/components/SceneTreeWindow.js` as a floating panel wrapping the scene tree
- [x] Render the scene item list as a recursive hierarchy grouped by `parentEntityId`
- [x] Highlight the selected item by comparing each item ID to `sceneStore.selectedItemId`
- [x] Handle item click by writing to the scene-store selection signal so tree, canvas, and inspector selection stay aligned
- [x] Track group expanded/collapsed state in a ref keyed by entity ID so collapsing a group does not re-render the whole tree
- [x] Add a `ComponentRow` sub-component that renders material, physics, and animation chips under each scene item
- [x] Add a `+` icon button in the scene tree window title bar that opens an inline primitive/action menu and dispatches the same create actions used elsewhere
- [x] Show the item count in the summary line from `sceneItems.value.length`

### Component: BenchmarkPanel
- [x] Create `src/components/BenchmarkPanel.js` as a floating panel driven by signals from `benchmarkStore.js`
- [x] Render Score, Active rays/s, Ray mem BW, Perceptual FPS, Resolution, and Bounces from benchmark signals
- [x] Render the GPU renderer label row from the `gpuRenderer` signal
- [x] Render the source label from the `measurementSource` signal
- [x] Use computed signals for formatted display strings so formatting runs only when raw benchmark values change

- [x] Preserve collapse and close windowing controls on the standing benchmark panel after moving it out of the generic floating-window wrapper

### Component: RenderCanvas
- [x] Create `src/components/RenderCanvas.js` as a thin wrapper that renders `<canvas id="canvas">` and `<div id="error">` and forwards a canvas ref
- [x] Attach mouse, touch, and pointer event handlers inside `useEffect` using `addEventListener` directly on the canvas DOM node
- [x] Expose an `onCanvasReady(canvasElement)` callback prop that fires once on mount so a future active React WebGL init chain can proceed
- [x] Keep pointer event handlers off React state setters; hot-path input writes stay on existing application state/signal paths

### Render Loop Bridge
- [x] Create `src/renderBridge.js` that exposes `startRenderLoop(canvas, appState)` and `stopRenderLoop()`
- [x] Batch per-frame signal writes into one Preact `batch(() => { ... })` call to prevent multiple micro re-renders per frame
- [x] Ensure the render loop avoids React state setters and signal writes when values have not changed

### CSS and Style
- [x] Move styles from the inline `index.html` style block into `src/app.css` with matching selectors and values
- [x] Replace the `dist/app.css` reference with `src/app.css` once the inline block is gone
- [x] Audit `src/app.css` for dynamic JS/React selectors (`is-open`, `is-collapsed`, `aria-pressed`) and keep them aligned after the React migration
- [x] Keep canvas CSS custom properties owned by `RenderCanvas` on the React path via one mounted `useEffect`; the active legacy fallback still writes the same document-root properties until the React render loop becomes the active entrypoint, and smoke verifies the split so canvas inline style writes do not come back

### Migration Sequence and Validation
- [x] Migrate and validate components in this order to minimize risk: BenchmarkPanel -> MenuBar -> FloatingWindow -> SceneTreeWindow -> InspectorPanel sub-panels -> CreatePanel -> full InspectorPanel -> RenderCanvas; verification evidence is captured in `docs/verification-smoke.md` and enforced by smoke contracts for shortcuts, panels, stores, render canvas, and root/docs parity
- [x] After each component migration, run the app and confirm parity with the previous behavior before removing the old static HTML for that section; Electron/browser smoke covers the root shell and GitHub Pages-style docs shell for load, first frame, nonblank canvas, panels, shortcuts, and benchmark throttling
- [x] Replace static fallback HTML for migrated menus, panels, and overlays with explicit `data-migrated` tombstone comments once the React shell owns those sections; smoke verifies each tombstoned section has a React/component counterpart before the legacy renderer starts
- [x] Verify keyboard shortcuts still work after the menu bar migration by testing every shortcut in the existing keydown map
- [x] Verify floating window drag, collapse, close, and position persistence all work after `FloatingWindow` migration
- [x] Verify that benchmark values update correctly at the expected throttle rate and do not cause visible frame drops in the render loop
- [x] Verify the Electron shell loads correctly with the importmap; Electron uses vendored importmap assets instead of depending on CDN availability
- [x] Vendor Preact, HTM, and Preact signals into `vendor/` so Electron and static deploys do not depend on network module resolution
- [x] Run the GitHub Pages deploy smoke and confirm all assets load correctly with the new module structure; `npm run test:pages-deploy` serves `docs/` at `/pathtracer/`, verifies importmap/static/dynamic module/WASM assets, and rejects origin-root path masking

## Deferred Performance And React Runtime Follow-Ups

These items remain real implementation work after WS9 closure. They are tracked outside WS9 because the current active runtime still uses the legacy WebGL entrypoint and the working tree does not yet contain the required contracts to mark them complete.

### Physics Sync
- [ ] Wire Rapier `EventQueue` collision/sleep events into a dirty-awake flag so `hasAwakeDynamicPhysicsObjects()` no longer needs a fallback full `isSleeping()` scan when sleep state is unknown
- [ ] Run Rapier on a dedicated worker thread via `SharedArrayBuffer` + `Atomics`: move `world.step()` and the transform read-back loop into a worker; write rigid body translations into a shared `Float32Array` after each step and read them on the main thread via a typed-array view; eliminates the 2-4 ms physics tick from the main-thread frame budget and allows physics and rendering to overlap; requires `Cross-Origin-Isolation` headers (`COOP: same-origin`, `COEP: require-corp`) in both the dev server and Electron main process
- [ ] Add dirty-flag incremental physics rebuild: track a `physicsDirty` boolean per scene object, set it whenever a physics-relevant property changes (body type, friction, restitution, collision group, position override); in `rebuildScene` only remove and re-add Rapier bodies for flagged objects rather than clearing the entire world; reduces `rebuildScene` cost from O(N) to O(changed)

### Active React Runtime
- [x] Strip all inline HTML for panels, menus, and overlays from `index.html` once each React component is the active runtime owner
- [ ] Wire `applicationState` mutations (material changes, slider moves, environment switches, pause toggles) to write through the signal store instead of mutating the plain object directly
- [ ] Remove `BenchmarkDisplay`, `writeElementTextIfChanged`, and `readRequiredElement` call sites once signals drive all benchmark DOM updates
- [ ] Remove `updateGpuStatus()` and its element writes once the GPU renderer signal is populated at init and read by the React component
- [ ] Remove all `readRequiredInput`, `readRequiredSelect`, and input `addEventListener` call sites that correspond to controls owned by active React panels
- [ ] Move the `requestAnimationFrame` loop and all WebGL call sites into `renderBridge.js` so they are decoupled from any React lifecycle
- [ ] Call `renderBridge.startRenderLoop()` from the `onCanvasReady` callback in `RenderCanvas` after WebGL init completes
## Workstream 10: New Material Shaders

### Physically-Based Optics
- [x] Add anisotropic GGX material (ANISOTROPIC_GGX) â€” extends the existing GGX_PBR material with a per-object tangent direction and separate alpha-x / alpha-y roughness values; produces directional highlight stretch seen on brushed metal, hair, satin, and CD grooves
- [x] Add thin film interference material (THIN_FILM) â€” computes wavelength-dependent phase shift as a function of film thickness and view angle; produces iridescent soap bubble and oil slick colour variation that shifts with viewing direction
- [x] Add retroreflector material (RETROREFLECTOR) â€” reflects rays back toward the incoming direction regardless of surface normal; models cat's-eye, road markings, and safety tape; trivial ray direction math but visually distinctive
- [x] Add velvet / sheen material (VELVET) â€” off-specular peak at grazing angles using the Disney sheen term; important for fabric, felt, and peach-fuzz surfaces that look dull head-on and bright at the silhouette

### Procedural Surface
- [x] Add Voronoi cracked-earth material (VORONOI_CRACKS) â€” cellular noise distance field baked into surface colour and normal offset; darkens cell boundaries to simulate dried mud, reptile scales, or fractured ceramic
- [x] Add holographic / diffraction grating material (DIFFRACTION_GRATING) â€” sinusoidal spectral response modulated by dot(viewDir, reflectDir) produces rainbow banding that shifts with viewing angle; complements the existing SPECTRAL_GLASS material
- [x] Add tri-planar UV projection mode usable by any material â€” blends three axis-aligned texture lookups weighted by the absolute surface normal to eliminate seams on SDF objects like capsules, toruses, and fractals; prerequisite for texture-based materials to work correctly on curved primitives

### Volumetric / Atmosphere
- [x] Add heterogeneous fog material (HETEROGENEOUS_FOG) â€” replaces the current uniform fog density with an FBM-modulated density field sampled along each ray march step; produces patchy cloud-like scattering and visually richer god rays than the flat VOLUMETRIC_SHAFTS material
- [x] Add blackbody emitter material (BLACKBODY) â€” maps a temperature uniform (in Kelvin) to emission colour via a Planck curve approximation; enables physically correct glowing objects such as hot coals, molten metal, and forge interiors as an alternative to the current flat emissive tint

### Emissive
- [x] Add self-emitting surface material (EMISSIVE) â€” a surface that emits a configurable colour and intensity without being an area light scene object; unlike area lights it casts no explicit shadow rays but contributes emitted radiance along any path that hits it; useful for glowing screens, neon signs, fire embers, and indicator lights
- [x] Expose per-object emission colour and emission intensity properties in the inspector when the EMISSIVE material is selected, distinct from the surface albedo so a neon tube can be white-hot at the surface while emitting coloured light
- [x] Add an emission strength multiplier constant at the top of the EMISSIVE shader branch so the energy scale can be tuned without changing individual object intensities across a scene

### Stylized
- [x] Add toon / cel shading material (TOON) â€” quantises the diffuse dot product into N discrete bands and adds a hard silhouette outline via a screen-space normal discontinuity test; useful for demonstrating the renderer's flexibility as an art-demo mode alongside the physically-based materials
- [x] Add X-ray / silhouette accumulation material (XRAY) â€” accumulates transparency weighted by the inverse of the view-to-normal dot product so edges glow and surfaces facing the camera are invisible; useful for inspecting SDF scene structure and showcasing the fractal and metaballs primitives

### Additional Material Variety
- [x] Split emission into a composable material modifier so any base surface can also emit light, enabling combinations such as velvet/fuzzy emissive spheres, glossy neon plastic, emissive glass, and procedural glowing cracks without adding one enum value per combination
- [x] Add clear-coat automotive paint material with a tinted diffuse base, metallic flake sparkle, and a glossy transparent top coat; useful for car paint, lacquered objects, and polished product renders
- [x] Add layered ceramic / porcelain glaze material with a smooth coloured glaze over a slightly rough clay or porcelain body; include subtle edge darkening and crackle variation as optional procedural detail
- [x] Add rubber / matte plastic material with broad low-energy highlights, high roughness, and configurable tint; useful for tires, tool grips, toys, and industrial parts
- [x] Add wood grain material with procedural rings, directional fibre noise, and anisotropic highlight response; support warm walnut/oak presets and darker charred wood variants
- [x] Add bark / cork material with deep procedural grooves, flaky raised ridges, and rough porous highlights; useful for tree trunks, cork boards, driftwood, and natural props
- [x] Add marble / veined stone material with volumetric-looking veins, subtle subsurface scatter, and rough polished or honed finish controls
- [x] Add skin / wax material using stronger subsurface scatter, warm backscatter, and soft broad highlights; useful for organic demos, candles, wax seals, and stylized character materials
- [x] Add fur / short-hair material with a soft anisotropic fuzz layer, rim-light catch, and optional colour variation by strand direction; useful for plush toys, animal-like surfaces, felt, and peach-fuzz effects
- [x] Add orange / citrus peel material with dimpled pore normal detail, waxy clear-coat sheen, saturated subsurface orange tint, and colour variation for rind, pith, and blemishes
- [x] Add fruit flesh material for oranges, lemons, grapes, and berries using translucent pulp cells, moist specular highlights, and subtle internal scatter
- [x] Add leaf / plant cuticle material with waxy top-surface reflections, vein structure, and optional translucency when backlit
- [x] Add moss / grass material with high-frequency fibrous variation, soft diffuse response, and small procedural height clumps for ground-cover scenes
- [x] Add leather material with fine grain pores, crease lines, variable roughness, and worn edge highlights for shoes, furniture, straps, and book covers
- [x] Add sand / soil material with granular colour variation, rough microfacet sparkle, and optional dampness that darkens colour and raises specular response
- [x] Add snow / powder material with high albedo, soft subsurface scatter, crystal sparkle, and compressed/icy variants
- [x] Add amber / honey resin material with warm absorption, internal suspended flecks, and glossy refraction for translucent organic objects
- [x] Add soap / foam material with clustered bubbles, thin-film colour at glancing angles, and airy translucent highlights
- [x] Add woven fabric material with thread-direction anisotropy, cross-hatch normal perturbation, and colour variation; cover coarse canvas, denim, and fine satin presets
- [x] Add water / liquid material with transmissive refraction, low roughness reflection, optional absorption tint, and caustic-friendly behaviour for pools, droplets, and glassy fluids
- [x] Add ice / frosted glass material with translucent blue absorption, internal scatter, rough refraction, and optional trapped bubble noise
- [x] Add pearlescent / opal material that shifts between warm and cool colours by view angle, distinct from thin-film rainbow interference and better suited to shells, pearls, and cosmetic finishes
- [x] Add carbon-fibre material combining a woven procedural pattern with anisotropic clear-coat reflections; useful as a high-frequency stress test for material aliasing and tone mapping

## Workstream 11: Benchmark Scenes

### Infrastructure
- [x] Add a `benchmarkScenes` registry alongside `scenePresetFactories` that maps scene keys to factory functions plus a metadata object (displayName, targetBounces, targetRaysPerPixel, description) so benchmark scenes can be loaded with known fixed render settings
- [x] Add a "Load Benchmark Scene" submenu or section in the Render menu that lists all registered benchmark scenes by name
- [x] When a benchmark scene is loaded, automatically apply its target bounce count and rays-per-pixel so the score is always produced under identical conditions
- [x] Add a `?bench=sceneName` URL parameter so any benchmark scene can be deep-linked and auto-loaded on page open, useful for automated or repeated testing
- [x] Lock camera auto-rotation on for all benchmark scenes at a fixed `cameraAutoRotationSpeed` so camera movement is always part of the load
- [x] Add a `defaultBenchmarkScene` key to the `benchmarkScenes` registry (initially `'standard'`, to be updated to `'sponzaAtrium'` once that scene is implemented and validated); the "Standard Benchmark" quick-action button and the `?bench` URL parameter default value both read this key so a single change promotes a new scene to default

### Benchmark Runner
- [x] Add a sequential benchmark runner mode that loads each benchmark scene in order, discards a configurable warm-up window (default 3 s) so GPU clocks can boost before measurement begins, records score for a fixed measurement window (default 10 s), then advances to the next scene automatically
- [x] Collect per-scene statistics during the measurement window: min score, max score, median score, and P5/P95 percentiles; display a live per-scene summary card in the benchmark panel as each scene runs
- [x] After the runner completes all scenes, display a full-run summary table with one row per scene showing its display name, median score, and P5/P95 range
- [x] Add a "Copy Results" button to the summary that puts a JSON object on the clipboard containing GPU name, browser user-agent, date, OS platform, canvas resolution, and the per-scene statistics; the JSON format should be stable across releases so results can be compared programmatically
- [x] Add a regression baseline mechanism: after a full run the user can click "Save As Baseline"; subsequent runs flag any scene whose median score has dropped more than 10 % from the baseline with a warning indicator in the summary table
- [x] Add a **"Share Result" permalink**: after a full run, encode the summary (GPU name, browser UA, OS, date, canvas resolution, per-scene median/P5/P95) as compressed base64 in a URL fragment (`#result=<base64>`); the "Share" button copies the full URL to the clipboard so results can be compared and reproduced with no server â€” the fragment is parsed on page load and pre-fills the baseline comparison if present
- [x] Add an **"Export Score Card" PNG**: after the full runner completes, use the 2D Canvas API to draw a 800Ã—400 summary card (GPU name, browser, OS, date, canvas size, per-scene score rows, delta-vs-baseline badges, composite score), then trigger an automatic `<a download>` so benchmark results are portable self-documenting images that can be attached to issues or forum posts

### Scene: Sponza Atrium (Benchmark Default)
- [x] Create `benchmarkSponzaAtrium` as the new default benchmark scene; the active WebGL renderer-backed implementation uses deterministic stone, fabric, ceiling, and colonnade primitives until the deferred `assets/models/sponza/sponza.glb` mesh/BVH/texture-atlas path is ready
- [x] Position and orient the opening camera at `[0, 0.3, 0]` looking toward `[1, 0.2, 0]` (down the main colonnade axis) and set camera FOV to 65 degrees so the flagstone floor, arched columns, fabric curtains, and stone ceiling are visible
- [x] Set target bounces to 8 and rays-per-pixel to 16 so the atrium is the default high-cost benchmark workload
- [x] Place a single GLASS sphere (radius 0.18) at the centre of the atrium floor `[0, 0.18, 0]` with a static physics body; drive its position every frame using a **3-D Lissajous orbit**: `x(t) = 0.45 * sin(3t * 0.11)`, `y(t) = 0.18 + 0.12 * abs(sin(5t * 0.07))`, `z(t) = 0.38 * sin(7t * 0.09)`
- [x] Call `sphere.setTemporaryTranslation([x(t) - x(0), y(t) - y(0), z(t) - z(0)])` each frame inside the scene's deterministic animation hook; returning `true` from the hook invalidates accumulation through `advanceSceneAnimation()` and `pathTracer.clearSamples(false)`
- [x] Expose the Lissajous frequency coefficients (`lissajousFreqX`, `lissajousFreqY`, `lissajousFreqZ`) and amplitudes as named constants at the top of the scene factory so the animation can be retuned without searching the function body
- [x] Register this scene as the value of `defaultBenchmarkScene` in the `benchmarkScenes` registry metadata after smoke validation
- [x] Keep the primitive Sponza fallback under a capped shader-object budget and defer scene menu loads through path-tracer program teardown, GL flush, and a browser-frame yield so laptop WebGL contexts do not lock during scene changes

### Scene: Shader Gauntlet
- [x] Create `benchmarkShaderGauntlet` â€” a 3Ã—4 grid of spheres each assigned a different expensive material (GGX_PBR, SPECTRAL_GLASS, SUBSURFACE, CAUSTICS, PROCEDURAL, SDF_FRACTAL, VOLUMETRIC_SHAFTS, BOKEH, MOTION_BLUR_STRESS, FIRE_PLASMA, GLASS, MIRROR) arranged so every material is visible from the rotating camera at all times
- [x] Set target bounces to 8 and rays-per-pixel to 16 so glass and caustic materials have enough paths to produce their characteristic effects and exercise the shader branch heavily
- [x] Enable camera auto-rotation at standard speed so the angle to each material's specular lobe cycles continuously and prevents the accumulation buffer from settling

### Scene: Physics Chaos
- [x] Create `benchmarkPhysicsChaos` â€” drop 20 dynamic physics spheres from a fixed height into a bowl-shaped arrangement of static rounded-box walls so they collide, scatter, and keep bouncing indefinitely
- [x] Use a high restitution value so spheres remain in motion and the path tracer must recompile or invalidate accumulation every frame for the full run
- [x] Assign alternating MIRROR and GLASS materials to the spheres so inter-reflection and refraction paths are active simultaneously alongside the physics transform updates
- [x] Set target bounces to 6 and rays-per-pixel to 8 â€” enough for reflections to resolve but low enough that the per-frame transform invalidation cost dominates over shader cost

### Scene: SDF Complexity
- [x] Create `benchmarkSdfComplexity` â€” place a Mandelbulb, an SDF fractal, a metaballs cluster, and a CSG shape side by side with a slow Y-axis orbit animation on each so the camera always sees at least two complex SDF objects at once
- [x] Assign PROCEDURAL material to the Mandelbulb and SDF_FRACTAL material to the fractal object so both the geometry and surface shader are expensive simultaneously
- [x] Set target bounces to 5 and rays-per-pixel to 12; the sphere-march iteration count is the primary cost driver here and should stress-test mid-range GPUs at 512Ã—512

### Scene: Caustic Pool
- [x] Create `benchmarkCausticPool` â€” a large GLASS sphere suspended above a DIFFUSE plane with a small bright area light positioned above and slightly off-axis so the caustic pattern on the floor is complex and shifts as the camera orbits
- [x] Add two smaller SPECTRAL_GLASS spheres flanking the central sphere so chromatic dispersion paths are also active, increasing the variance and sample-count demand
- [x] Set target bounces to 10 and rays-per-pixel to 24 to give caustic and spectral paths enough bounces to converge enough for the score to be meaningful; this scene is intentionally the hardest and will produce the lowest score

### Scene: Motion Blur Stress
- [x] Create `benchmarkMotionBlurStress` â€” eight MOTION_BLUR_STRESS material cubes arranged in a ring, each spinning on a local axis using a procedural orbit animation, with the camera orbiting the ring at a different speed so relative motion is always present
- [x] Add a BOKEH material sphere at the centre of the ring placed exactly at the camera focus distance so the depth-of-field blur kernel is also active while motion blur evaluates
- [x] Set target bounces to 4 and rays-per-pixel to 32 â€” motion blur and bokeh both require many samples to resolve so the bottleneck is sample throughput rather than bounce depth

### Scene: Volumetric Fog Flythrough
- [x] Create `benchmarkVolumetricFog` â€” a dense arrangement of VOLUMETRIC_SHAFTS spheres and tall cylinder columns with fog density set to 0.8 and sky brightness at 2.0 so every ray spends significant time marching through fog before hitting geometry
- [x] Use slow camera auto-rotation at half the standard speed so accumulation is regularly invalidated but not so fast that the image never partially converges, producing a realistic flythrough load pattern
- [x] Set target bounces to 6 and rays-per-pixel to 10; the volume march steps dominate cost so bounce count has diminishing returns here

### Scene: Particle Fluid Simulation
- [x] Create `benchmarkParticleFluid` â€” spawn 24 dynamic physics spheres with small radius (0.06) tightly packed inside an invisible bounding volume at scene centre; apply Rapier spring joints between each sphere and its nearest neighbours (rest length â‰ˆ 0.14, high stiffness, moderate damping) to simulate cohesion so the cluster sloshes and deforms rather than scattering
- [x] Assign SUBSURFACE material to all particle spheres so the translucent organic shading reinforces the fluid appearance and the scattered-light evaluation adds shader cost on top of physics cost
- [x] Add a single static rounded-box "container" with GLASS material below the cluster so the fluid can partially settle into it and produce refraction beneath the particles
- [x] Expose `particleFluidParticleCount` (default 24), `particleFluidRadius` (default 0.06), and `particleFluidSpringStiffness` (default 120) as tunable constants at the top of the scene factory so particle density, sphere size, and surface tension can be adjusted to dial in convincing sloshing versus scatter behaviour
- [x] Add UI controls in the benchmark scene metadata (or a debug panel) to hot-reload the scene with different count and radius values without a full page reload, so visual quality versus performance trade-offs can be explored interactively
- [x] Set target bounces to 6 and rays-per-pixel to 8; physics transform invalidation every frame prevents accumulation convergence so extra rays-per-pixel matter more than bounce depth here

## Workstream 12: Showcase Demo Scenes

### Optical Showcase
- [x] Create `demoCorridorOfLight` (Cornell box variant) â€” a closed-room scene with six DIFFUSE planes in distinct colours (white ceiling/floor, red/green side walls, blue back wall) lit by a single centred area light; no objects initially so the colour bleeding and soft shadows on bare walls demonstrate path tracing's core capability
- [x] Add an option to the Cornell box scene to insert a central GLASS sphere or MIRROR cube as a secondary subject, toggled by a scene parameter, so a single scene can showcase both empty-room colour bleeding and material interaction
- [x] Create `demoDeptOfFieldPortrait` â€” a single GGX_PBR sphere at sharp focus in the foreground with a group of smaller spheres at varying depths behind it, lit by a large soft area light; camera aperture set wide so background blur is pronounced and the bokeh disc shape is clearly visible
- [x] Create `demoShadowStudy` â€” a flat DIFFUSE floor plane with three area lights of different sizes (small/sharp, medium, large/soft) and colours positioned at different angles casting overlapping penumbras onto simple block geometry; intended to isolate and demonstrate soft-shadow quality as bounce count and sample count increase
- [x] Create `demoMirrorRoom` â€” a hollow cube of six MIRROR planes enclosing a single small DIFFUSE coloured sphere at the centre; no environment lighting, only a tiny point-like area light; demonstrates infinite inter-reflection and exposes convergence behaviour at the configured bounce limit

### Environment And Atmosphere
- [x] Create `demoSkySphere` â€” an empty scene (no geometry except a large invisible ground plane) with the open-sky environment enabled and a single MIRROR sphere suspended at scene centre; the sphere reflects the full sky dome and the ground plane catches the sky's sky-light illumination; demonstrates the environment system as the primary visual subject
- [x] Create `demoFogCorridor` â€” two parallel rows of thin DIFFUSE pillars receding into the distance with fog density set near maximum and a warm directional sky; the pillars fade to silhouette in the distance and shafts of scattered light are visible between them; requires the VOLUMETRIC_SHAFTS or HETEROGENEOUS_FOG material to be active on at least one object to seed the scattering

### Material Sampler
- [x] Create `demoMaterialGrid` â€” a 4Ã—4 grid of identical spheres each assigned a different material in a fixed display order, with consistent neutral lighting and a plain DIFFUSE floor and back wall; functions as a live material reference card and can be iterated during material development to see all materials simultaneously
- [x] Create `demoNeonRoom` â€” a dark scene containing several EMISSIVE material objects (tubes, panels, small spheres) in different colours arranged on a reflective floor with MIRROR material; no area lights, only the emissive surfaces provide illumination; demonstrates the EMISSIVE material system and the soft indirect glow it produces on surrounding geometry
