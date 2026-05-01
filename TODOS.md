# TODOs

Audit note: checked items reflect implemented behavior or documented decisions as of 2026-05-01. Unchecked items are still real implementation work, not hidden scope.

## Workstream 1: Scene Data And Documents
- [ ] Make every object in the scene a separate ECS item
- [ ] Define the ECS entity and component model for scene objects
- [ ] Convert existing primitives, lights, and special objects into ECS-backed entities
- [x] Add a stable ID and name for each scene item

### Entity And Component Model
- [x] Add a canonical `entityId: string` field to every scene object class (`SphereSceneObject`, `CubeSceneObject`, `SdfSceneObject` and all subclasses, the light object) — set to `String(objectId)` in each constructor so `sceneStore.normalizeSceneItem()` can read it directly and retire the `id ?? sceneObjectId ?? objectId ?? index` fallback chain
- [ ] Add `parentEntityId: string | null` to every scene object (null = scene root); `GroupEntity` sets this field on children when they are added to the group and clears it when they are removed; `syncSceneTree()` uses this field to derive display order without assuming a flat list
- [ ] Define a `GroupEntity` class that holds `childEntityIds: string[]` and a world-space transform but generates no GLSL uniform or intersection code; include it in `sceneObjects` like any other object so it participates in the ECS tree, hide/lock, and naming systems; the path-trace shader ignores it via a type-check guard in `joinObjectShaderCode()`
- [ ] Extract physics state (`physicsRigidBody`, body type, friction, restitution) from inline scene object fields into a standalone `PhysicsComponent` data class in `src/components/PhysicsComponent.js`; keep backward-compatible getters on the scene objects (`get physicsRigidBody()`) so the existing `physicsWorld.rebuildScene()` path compiles without changes during migration
- [ ] Extract material state (`material` integer, `glossiness` float) from inline fields into a `MaterialComponent` in `src/components/MaterialComponent.js`; keep `this.material` as a forwarding getter so all GLSL-generating methods (`getIntersectCode`, `getNormalCalculationCode`, etc.) continue to work unchanged
- [ ] Unify the two selection systems: replace `SelectionRenderer.selectedObject` (direct object reference, stale across scene resets) with `selectedEntityId: string | null`; resolve to the live scene object by ID inside `render()`, `syncSelectedItemReadout()`, and `selectSceneObjectByIndex()` so there is one source of truth matching the `sceneStore.selectedItemId` signal
- [x] Add per-item settings and expand the property model over time
- [x] Decide which settings are shared across all items and which are type-specific
- [ ] Add scene save and load support
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
- [ ] Add an ECS tree view that mirrors the live scene
- [x] Clicking an item in the scene tree selects it and immediately populates the inspector panel with that object's settings
- [x] Keep tree selection and canvas selection in sync
- [ ] Support selecting and dragging multiple items in the ECS tree
- [ ] Add Shift + click and Ctrl + click selection behavior in both the tree and the viewport
- [ ] Show a clear visual state for primary selection vs secondary selected items
- [ ] Add marquee or box selection in the viewport if it fits the editor workflow
- [ ] Add bulk actions for the current multi-selection
- [ ] Add a "Group Selected" action (Edit menu, shortcut Ctrl+G) that wraps all currently selected items under a new Group entity in the ECS tree; the group has its own transform, name, hide/lock state, and physics body while each child retains its own material and geometry unchanged
- [ ] Render the group as a collapsible parent node in the scene tree with expand/collapse toggle; selecting the group selects all children simultaneously so transforms and inspector actions apply to the whole group
- [ ] Add an "Ungroup" action (Ctrl+Shift+G) that dissolves a selected group and re-parents all children directly to the scene root, preserving each child's world-space transform
- [ ] Add a "CSG Merge" action available only when all selected items are SDF-compatible primitives (sphere, ellipsoid, capsule, rounded box, metaballs, mandelbulb, SDF fractal, torus, cone, cylinder); converts the selection into a single `MultiCsgSceneObject` using union mode by default with a mode dropdown shown in the inspector before the merge is confirmed
- [ ] Make CSG Merge destructive and undoable — the original primitives are removed and replaced with one CSG node; warn in a confirmation dialog that the individual shapes can only be recovered via undo
- [ ] Show the constituent SDF expressions of a CSG node as read-only child entries in the scene tree so the user can see what was merged, even though the children are no longer independent scene objects

### CSG Shaped Holes And Per-Shape Materials
- [ ] Replace the hardcoded `CsgSceneObject` (box minus sphere at fixed sizes) with a general `MultiCsgSceneObject` that stores an ordered list of `{ sdfExpression, role: 'base' | 'cutter', materialIndex }` operands; the GLSL distance function body is generated from this list using `min` for union, `max` for intersection, and `max(A, -B)` for each cutter against the accumulated base so any combination of shapes and roles is expressible
- [ ] Add a **Difference / Hole-Cut** mode to the CSG Merge UI: when two items are selected, allow the user to designate one as the **base** and one as the **cutter**; the cutter's volume is subtracted from the base using `max(dBase, -dCutter)` in the generated GLSL; show the cutter shape as a semi-transparent ghost in the scene tree and inspector while the CSG node is selected
- [ ] Add **Smooth Union** as a fourth CSG mode alongside union / intersection / difference: use the polynomial smooth-min `smin(dA, dB, k)` with a user-controlled blend radius `k` (default 0.1, range 0–0.5) so two shapes blend into each other organically rather than meeting at a hard edge; expose the blend radius as a slider in the inspector when smooth union mode is active
- [ ] Support multi-material CSG: each operand in a `MultiCsgSceneObject` retains its own `materialIndex` from before the merge; at ray-hit time, determine which operand owns the surface by evaluating all individual SDF distances at the hit point — the operand with the minimum (for union) or maximum (for intersection/difference base) distance owns the hit and its `materialIndex` is used for shading; emit this operand-selection logic as part of the generated `getNormalCalculationCode()` so the path tracer applies the correct material without any extra ray cast
- [ ] Show each operand's material as a labelled chip in the CSG node's inspector section (e.g. "Shape A — GGX PBR", "Shape B (cutter) — Glass") with an inline material-type select so the material of any constituent can be changed after the merge without re-merging
- [ ] Allow changing a CSG node's per-operand mode (base ↔ cutter) after creation via a toggle in the inspector's constituent list; regenerate the GLSL distance function body and re-trigger shader compilation when any operand role or material changes
- [x] Add duplicate, rename, and delete actions for scene items
- [x] Add hide, show, and lock controls for scene items

### Scene Tree Hierarchy And Component Rows
- [ ] Update `syncSceneTree()` to derive display order from `parentEntityId` rather than the flat `sceneObjects` index: collect root items (null parent) first, then DFS-append each item's children; re-key `this.sceneTreeButtons` by entity ID string instead of array index so button reuse survives reordering
- [ ] Store group expand/collapsed state in a `Set<string>` of expanded entity IDs on the tree manager; add a chevron element to each group button that rotates on expand; toggle child button `hidden` attribute on click; persist the expanded ID set to `localStorage` so the tree reopens in the same state after a scene reload
- [ ] Add component sub-rows (`<div class="scene-tree-component-row">`) immediately after each item's button: one row displaying the material name (derived from the `MATERIAL` constant reverse-map), one row showing the physics body type if `physicsRigidBody` is non-null, one row showing the animation name if an animation component is attached; sub-rows are indented one level deeper than the item and receive no click or keyboard handling
- [ ] Add a `+` icon button inside `#scene-tree-header` beside the item-count `<span>` that opens a small inline popover listing "Sphere / Cube / Cylinder / Torus / Capsule / Light" — dispatches the same `data-action` events used by the Create panel; once this path is live and verified, remove the "Create" tab from the inspector tab strip and move its keyboard shortcut (Ctrl+1) to trigger this popover instead
- [ ] Add a translate gizmo with draggable per-axis arrows and a free-move plane handle
- [ ] Add a scale gizmo with draggable per-axis handles and a uniform scale center handle
- [ ] Add Ctrl + drag on the scale gizmo to scale uniformly across all axes
- [ ] Add a rotate gizmo with draggable per-axis arc handles (X, Y, Z rings)
- [ ] Add a free-rotate handle on the rotate gizmo for screen-space rotation
- [ ] Split transform editing into translate, rotate, and scale modes switchable via keyboard shortcuts (W, E, R)
- [ ] Keep gizmos aligned with the selected item's local or world space
- [x] Add numeric transform inputs for precise editing
- [ ] Support moving, scaling, and rotating multiple selected items around a shared pivot
- [ ] Define how mixed-value fields are shown in the settings panel
- [ ] Add undo and redo for scene edits
- [x] Reset accumulation when a transform or scene edit changes the image

## Workstream 3: Assets, Materials, And Animation
- [ ] Add support for importing external 3D models into the scene
- [x] Choose and document the initial supported model formats
- [ ] Convert imported models into ECS-backed scene items and sub-items
- [ ] Preserve model hierarchy, pivots, and named nodes when importing
- [ ] Add support for textured materials on imported assets
- [ ] Handle texture loading, caching, missing-texture fallbacks, and asset relinking
- [ ] Add controls for assigning and swapping textures in the editor
- [x] Define how textured materials map into the path tracing material system
- [ ] Add reusable material presets or saved materials

### Bundled Reference Models
- [ ] Add `assets/models/suzanne.obj` to the project — the Blender Suzanne monkey head (CC0, ~500 triangles) serves as the canonical mesh import test and a recognisable benchmark reference; source from the Blender open-data repository or export directly from Blender with triangulated faces and vertex normals enabled
- [ ] Add `assets/models/suzanne_low.obj` as a 200-triangle decimated version for testing the import pipeline at lower cost before committing to the full-resolution model
- [ ] Register Suzanne as a named preset in the Scene menu once mesh rendering is implemented so it can be loaded with one click alongside the existing SDF presets
- [ ] Download the **Intel Sponza** scene (Khronos GLTF Sample Assets, CC-BY 4.0) as `assets/models/sponza/sponza.glb`; this self-contained GLB bundles ~260 K triangles, ~26 named material groups, and full PBR texture sets (base colour, normal, metallic/roughness, emissive) for all surfaces including the curtains, arches, columns, and flagstone floor — it is the authoritative textured scene for validating multi-material mesh rendering and serves as the default benchmark environment

### OBJ Format Support (Phase 1 — Implement First)
- [x] Write an `ObjParser` class in `src/loaders/ObjParser.js` that reads `v`, `vn`, `vt`, `f`, `o`, `g`, `usemtl`, and `mtllib` directives from an OBJ string; produce a flat array of triangles each containing three positions, three normals, and three UV coordinates
- [x] Handle face definitions with vertex/texture/normal index triples (`f v/vt/vn`) as well as position-only faces (`f v`) and position+normal faces (`f v//vn`); recompute flat normals for faces that omit normal indices
- [x] Write an `MtlParser` class in `src/loaders/MtlParser.js` that reads `Kd` (diffuse colour), `Ks` (specular), `Ns` (shininess), `d`/`Tr` (opacity), and `map_Kd` (diffuse texture path); map each MTL material to the closest path-tracer material type
- [x] Expose a `loadObjFromUrl(url)` and `loadObjFromText(text)` API so models can be loaded from bundled assets, user file input, or drag-and-drop
- [ ] Support drag-and-drop of `.obj` + `.mtl` file pairs onto the canvas: read both files, parse the OBJ, resolve the MTL, and create a `MeshSceneObject` in the scene

### glTF 2.0 / GLB Format Support (Phase 2)
- [ ] Write a `GltfLoader` class in `src/loaders/GltfLoader.js` that handles both JSON `.gltf` (with separate `.bin` buffer) and self-contained binary `.glb` files; extract all mesh primitives, their accessor data (positions, normals, UVs, indices), and their material references
- [ ] Map glTF PBR `metallicRoughnessFactor` and `baseColorFactor` to the path tracer's GGX_PBR material with appropriate roughness and metalness uniform values
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
- [ ] Add a system for procedural transform animations that can be attached to or detached from any item or group
- [ ] Implement a continuous Y-axis spin animation (rotate around up axis at a configurable speed)
- [ ] Implement a vertical bob animation (oscillate up and down at a configurable amplitude and frequency)
- [ ] Implement a uniform pulse animation (oscillate scale in and out at a configurable amplitude and frequency)
- [ ] Implement an orbit animation (circle around a configurable center point at a configurable radius and speed)
- [ ] Implement a wobble animation (randomised small-angle rotation jitter to simulate instability or vibration)
- [ ] Allow multiple animations to be stacked on the same item so effects can be combined
- [ ] Show attached animations as components in the inspector for the selected item
- [ ] Allow each animation component to be enabled, disabled, or removed individually from the inspector

## Workstream 4: Cameras, Lighting, And Render View
- [ ] Add two distinct camera modes: FPS mode and editor orbit mode
- [ ] FPS mode: WASD + mouse look, pointer lock, free-fly through the scene
- [ ] Editor orbit mode: tumble around a focal point, optimized for placing and manipulating objects
- [ ] Add a toggle between FPS and editor mode in the View menu and as a keyboard shortcut
- [ ] Remember the last camera position and orientation when switching modes so context is not lost
- [x] Add camera bookmarks or saved shots
- [x] Add camera controls for FOV, focus distance, and aperture or depth of field
- [x] Add a simple shot switcher for comparing scene compositions
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
- [ ] Make the benchmark floating window wider and shorter — expand it horizontally so all tiles fit in fewer rows, reduce its default height so it is a thin horizontal band rather than a tall column
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
- [ ] Add a **samples-accumulated counter** tile to the benchmark panel showing total sample count since the last scene change plus a convergence status label ("Converging" / "Stable") derived from a rolling per-pixel variance estimate falling below a threshold; tells the user whether the current image is still meaningfully improving or has plateaued
- [ ] Add a **GPU buffer memory** estimate row to the benchmark panel: compute the byte cost of all live render targets (accumulation buffer, bloom intermediate, display composite — each width × height × channels × bytes-per-channel) and display as "GPU buffers: X MB" so users understand the VRAM cost of high render resolutions before hitting a silent OOM
- [ ] Add a **scene complexity** stat row (object count, active shader variant count, and once mesh rendering is live: total triangle count) that updates on every `rebuildScene` call; surface it as a footer in the scene tree panel and as a tile in the benchmark panel so both casual and technical users can gauge scene complexity at a glance
- [ ] Add a **"Share Result" button** to the benchmark panel that encodes the current score, GPU renderer string, canvas resolution, bounce count, scene name, and ISO date as a compact base64 JSON in the URL hash (`#result=<base64>`); copies the full URL to the clipboard and shows a transient "Copied!" toast — no server required, the URL is self-contained
- [ ] Add an **"Export Score Card" PNG** button to the benchmark summary: use the 2D Canvas API to render a 800×400 summary card with score, GPU name, scene name, resolution, bounce count, date, and delta-vs-baseline if a baseline exists; trigger an automatic download via a transient `<a download>` element so benchmark results are self-documenting shareable images
- [ ] Add **metric explanation tooltips** (HTML `title` attribute on each tile `<dt>`) to the benchmark panel: "Score — composite ray throughput × quality factor, higher is better"; "Active rays/s — rays reaching at least one surface per second weighted by bounce depth"; "Ray mem BW — estimated bytes read/written to the accumulation texture per second at current resolution and sample rate"; "Perceptual FPS — rendered frames per second smoothed over 1 s, independent of accumulation sample count"

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
- [x] Keep each toggle button visually active or inactive to reflect the current panel visibility state
- [x] Add a fullscreen panel mode that keeps overlay controls and benchmark visible over the canvas
- [x] Add movable window panels for the ECS tree and selected-object settings
- [x] Allow floating panels to be dragged, focused, collapsed, and reopened
- [x] Keep ECS and object-settings windows in sync with the current selection and active scene
- [x] Decide whether floating panels can dock or should remain free-floating only
- [x] Save and restore panel positions, sizes, and visibility between sessions
- [x] Split resolution settings into two independent controls: one for the UI canvas and one for the 3D render target
- [x] Default the UI canvas resolution to the browser canvas size
- [x] Default the 3D render resolution to the canvas element's CSS pixel size at startup instead of the hardcoded `DEFAULT_CANVAS_SIZE = 512`; read `canvas.clientWidth` / `canvas.clientHeight` (rounded to the nearest `CANVAS_SIZE_STEP = 64`) after the canvas is inserted into the DOM so the initial render fills the visible area without a scale-up
- [x] Add render scaling as the primary resolution control: store a `renderScale` value (default 1.0, min 0.25, max 2.0, step 0.25) and derive the actual render dimensions as `Math.round(canvas.clientWidth * renderScale / CANVAS_SIZE_STEP) * CANVAS_SIZE_STEP` so the render target tracks the canvas if the window is resized; at 0.5x the render target is half the CSS pixel size, at 1.0x it matches CSS pixels, and at 2.0x it super-samples for export
- [x] Show the render scale control as a slider in the Output panel (label "Render Scale", ticks at 25 / 50 / 100 / 150 / 200%) with the resolved pixel dimensions displayed in real time next to it (e.g. "512 × 512") so the user always knows the exact render size without mental arithmetic
- [x] Keep the three hardcoded pixel-size presets (256, 512, 1024) as secondary "pin to size" buttons alongside the scale slider for workflows where an exact pixel count matters; selecting a preset overrides the scale value and updates the slider to the nearest equivalent scale, but does not lock the slider from future changes
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
- [x] View menu: add greyed-out debug view stubs — "Debug: Normals", "Debug: Albedo", "Debug: Depth" — below a separator after the fullscreen toggles; fix the Fullscreen Panels button so it shows no shortcut hint instead of the live state value "Off"
- [x] View menu: remove "Create Panel" link at the bottom of the Create menu (panel openers belong only in View); instead add "Create Panel" (Ctrl+1) to the View menu alongside Inspector, Scene Tree, and Benchmark Panel
- [x] Render menu: keep only render-execution controls — Pause Frames (P), Pause Rays (K), and quality preset buttons (Draft 1 / Preview 2 / Final 3); move Render Settings (Ctrl+3), Camera Settings (Ctrl+4), and Environment Settings here as a settings group; remove benchmark scene entries and Output (both moved)
- [x] Quick actions toolbar: rename `S` → `Sphere`, `Lux` → `Light`, `New` → `Create`, `Obj` → `Inspect`, `R` → `Render`, `Bm` → `Bench` so every button label is a recognisable word rather than an ambiguous single character or unit symbol
- [x] Quick actions toolbar: rename pause buttons from `P` and `K` (shortcut letters, meaningless as labels) to `‖Frm` and `‖Rays` so the action is legible without a tooltip
- [x] Quick actions toolbar: remove the `Std` (standard benchmark) button — the standard benchmark is now reachable via the Scene menu and the toolbar is already too wide; remove `Cyl` and `Tor` shape shortcuts for the same reason
- [x] Quick actions toolbar: ensure the four preset scene buttons (Col, Mat, Prim, Lit) remain as the leftmost group since they are the most common scene-switch actions
### Accordion Inspector Redesign
- [x] Replace the tab row (`<div>` of `<button data-panel-target>` elements) in `#controls` with a vertical accordion using native `<details>`/`<summary>` elements: one `<details>` per section (Object, Render, Camera, Environment, Output); each wraps the existing control markup verbatim so no logic changes are needed in this pass
- [x] Drive the Object section's `open` attribute from JS selection events: add `open` when `syncSelectedItemReadout()` selects a non-null item, remove it when selection clears; set the summary text to the selected item's display name when open and "Nothing selected" when closed so it doubles as a selection readout
- [x] Add a CSS custom property `--section-accent` to each `<summary>` (`#4a90e2` Object, `#5cb85c` Render, `#f0ad4e` Camera, `#9b59b6` Output) and apply it as `border-left: 3px solid var(--section-accent)` plus tinting the expand chevron so sections are visually distinct without relying on tab position or color alone
- [x] Persist each global section's open/closed state to `localStorage` under the key `inspector-section-{sectionKey}` via a `toggle` event listener on each `<details>`; restore the persisted state on page load before the first render so the inspector reopens in the layout the user left it in
- [x] Remove the `data-control-panel` / `hidden` attribute toggle JavaScript once `<details>` self-manages open state; menu shortcuts now open the target section while the Object section is driven by selection
## Workstream 6: Physics And Codebase Structure
- [x] Allow physics to be enabled per item
- [x] Add per-item physics settings
- [ ] Define which ECS components create Rapier bodies and colliders
- [x] Sync transforms between editor state and physics state
- [ ] Add toggles for dynamic, kinematic, and static behavior
- [ ] Expose common physics controls such as mass, friction, restitution, and gravity

### Compound Physics Bodies
- [ ] When a Group entity has physics enabled, create a single Rapier compound rigid body whose collider shape is the union of all children's bounding volumes rather than one rigid body per child; this allows complex multi-primitive objects to interact with physics as a single mass
- [ ] Propagate the group body's transform to each child every physics step so children follow the group without having their own Rapier bodies; children that had their own physics bodies before grouping should have those bodies removed and replaced by the group body
- [ ] Expose group-level physics properties (mass, friction, restitution, linear/angular damping) in the inspector when the group is selected; compute the effective mass as the sum of child masses or as a single override value
- [ ] When a group is ungrouped, distribute the group body's current velocity to each newly independent child that has physics enabled so momentum is not lost on ungroup
- [ ] Allow a child inside a group to be marked as a trigger collider (no physical response, collision events only) via a per-child checkbox in the inspector, without affecting the group body's physics
- [ ] Validate that CSG-merged nodes can also participate in compound group physics; the CSG node's bounding box is used as the collider shape since the SDF surface cannot be directly converted to a convex hull
- [ ] Split the files into smaller logic-focused modules to keep them manageable
- [ ] Separate scene state, editor UI, renderer integration, and physics integration into distinct modules
- [ ] Extract reusable editor controls for item settings panels

### Stability And Resilience
- [ ] Handle WebGL context loss (`webglcontextlost` / `webglcontextrestored` events): pause the render loop on loss, show an overlay message, and on restoration rebuild all framebuffers, shader programs, and uniform buffers without a page reload; log a `renderer` channel error on loss and `info` on successful restore so silent context resets are no longer invisible
- [ ] Enforce physics world bounds: any dynamic rigid body whose Y translation falls below a configurable `PHYSICS_OUT_OF_BOUNDS_Y` threshold (default −5.0) should have its Rapier body removed and `physicsRigidBody` reference cleared; log a `physics` channel warning and leave the scene object in the ECS tree so the user can re-enable physics — prevents the infinite-fall case where objects tunnel out of the scene and generate Rapier NaN positions
- [ ] Guard shader recompilation against rapid slider input: add a 100 ms trailing debounce to the `rebuildScene` + `clearSamples` sequence triggered by range `input` events so dragging a bounce-count or rays-per-pixel slider does not fire a new `gl.compileShader` for every pixel of travel
- [ ] Wrap every scene preset factory call in a try/catch inside `loadPresetScene`; on factory error log the failure with the scene key, recover to a blank scene via `createEmptyScene()`, and surface the error message in `#error` so the app stays usable rather than freezing with an empty or broken canvas
- [ ] Add a startup smoke-test: after `initializeRapierRuntime` resolves, iterate every registered benchmark scene factory, call it with an empty array, and assert the returned object list is non-empty and contains no `undefined` entries; report failures at `error` level with the offending key so regressions in scene factories are caught before a user loads that scene

### Physics Controls And Joints
- [ ] Add a global gravity control in the Scene or Physics settings panel: a direction dropdown (Down / Up / Zero-G / Custom) and a magnitude slider (0–20, default 9.81); write the resulting `{x, y, z}` vector to `world.gravity` at the start of each physics step so any scene can be switched to zero-G or reversed gravity at runtime without a preset change
- [ ] Store a `gravityScale` override in each benchmark and preset scene's metadata object (e.g. `gravityScale: 0` for the particle fluid scene) and apply it when the scene is loaded so scenes that require specific gravity configurations are self-contained
- [ ] Add spring joint creation between two selected physics-enabled objects: when exactly two physics items are selected, show a "Connect Spring" button in the inspector that creates a Rapier `JointData.spring()` between their centres with configurable rest length, stiffness, and damping sliders; record the joint handle on both scene objects and render the connection as a dashed-line annotation in the scene tree component rows
- [ ] Allow joints to be deleted from the inspector: when a physics-enabled object is selected, show a "Connected joints" list displaying each joint's partner object name and a remove button; the remove button calls `world.removeImpulseJoint()`, clears the handle from both objects' records, and triggers a scene-tree refresh

### Logging And Debug Instrumentation
- [ ] Define a structured logger with named channels (e.g. `renderer`, `physics`, `sceneLoad`, `ui`, `assetPipeline`) and four levels (`debug`, `info`, `warn`, `error`); gate `debug` messages behind a `localStorage` flag so they are off in production but trivially re-enabled per channel in DevTools without a rebuild
- [ ] Add `renderer` channel logs at WebGL/WebGPU init: log the resolved backend, GPU renderer string, context attributes, max texture size, and any capability checks that fail silently today (e.g. `EXT_color_buffer_float` presence, `timestamp-query` availability)
- [ ] Add `renderer` channel logs around each frame phase: shader compile time (once at startup), accumulation pass, bloom/glare post-process pass, and display composite pass — log only the first frame and on changes so the console is not flooded
- [ ] Add `physics` channel logs: log world creation and teardown, `rebuildScene` call count and object counts per rebuild, Rapier WASM init time, and any `returnFailure` paths inside `addFixedSphere` / `addDynamicSphere` / `addFixedCube` / `addDynamicCube` / `addRoomBoundaryCollider`
- [ ] Add `sceneLoad` channel logs: log scene name, object count, and load duration for every preset scene load and every `rebuildScene`; log any missing or defaulted fields encountered when deserialising saved scene JSON
- [ ] Add `assetPipeline` channel logs: log model file name, triangle count, BVH build time, and GPU upload size (bytes) for every `MeshSceneObject` import; log texture atlas dimensions and layer count when the atlas is built
- [ ] Add `ui` channel logs at panel init, event-listener registration failures (any `readOptionalElement` that returns null for an expected element), and any `returnFailure` paths inside `updateSelectedPhysicsFromControls`, `updateMaterialFromSelect`, and `applyMaterialToSelection`
- [ ] Add a **Log Panel** (toggled in the View menu, default hidden): a fixed-height scrollable `<pre>` overlay in the corner that captures the last N `warn` and `error` log lines with timestamps, so runtime errors are visible without opening DevTools — useful in Electron and fullscreen modes

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
- [ ] Reduce unnecessary post-process passes for bloom, glare, and display composition in draft modes
- [x] Minimize per-frame uniform and state updates by batching or caching unchanged renderer state
- [x] Add dynamic quality controls that can lower rays per pixel or internal render resolution to protect ray rate
- [ ] Investigate scene acceleration structures or faster scene queries for larger object counts
- [x] Specialize shaders or pipelines for common material paths instead of paying for rarely used branches every frame
- [ ] Add WebGL-specific optimization passes for texture bandwidth, framebuffer usage, shader branching, and draw-pass count
- [ ] Add WebGPU-specific optimization passes for compute-based accumulation, buffer layouts, workgroup sizing, and async resource uploads

### WebGPU Path-Tracing-Specific APIs
- [ ] Migrate the path-tracing kernel from a fragment shader to a WebGPU **compute shader**: dispatch one workgroup invocation per pixel, write radiance directly into a storage texture, and remove the fullscreen quad draw entirely; compute shaders have no rasterisation overhead, allow arbitrary control flow without derivative restrictions, and give direct access to workgroup shared memory for BVH traversal stacks
- [ ] Use the WebGPU **`timestamp-query`** optional feature (`device.features.has('timestamp-query')`) to measure exact GPU time per compute dispatch; replace the current frame-estimate fallback with sub-millisecond GPU-side timing and surface the precise ray-rate figure in the benchmark panel — note: Chrome requires `--enable-dawn-features=allow_unsafe_apis` for this feature in some builds
- [ ] Investigate the WebGPU **`subgroups`** extension (`wgsl_language_features.has('subgroups')`) for coherent BVH traversal: use `subgroupBallot` / `subgroupShuffle` to keep threads in a workgroup traversing the same BVH node simultaneously, reducing warp divergence in the iterative traversal loop for triangle mesh scenes
- [ ] Monitor the WebGPU **hardware ray tracing extension** (gpuweb/gpuweb issue #535, tracked as Milestone 4+): as of 2026 there is no browser implementation in Dawn or Chrome, but wgpu has experimental support; revisit when a browser ships `acceleration-structure` and `ray-query` primitives in WGSL — these would replace the software BVH traversal loop with a hardware `rayQueryInitialize` / `rayQueryProceed` call and could deliver a large ray-throughput multiplier on RTX/RDNA3/Apple Silicon hardware

### Triangle Mesh GPU Rendering
- [ ] Define a `MeshSceneObject` class that holds a flat triangle array (positions + normals + UVs), a material, a world-space transform, and a CPU-side axis-aligned BVH built at load time using surface-area heuristic (SAH) splitting; this is a parallel rendering path alongside the existing SDF/analytic objects
- [ ] Build a BVH packer that serialises the SAH BVH into two `Float32Array` texture buffers: one 32-bit-per-node buffer storing AABB min/max and left/right child or leaf triangle range, and one tightly-packed triangle soup buffer; upload both to WebGL as `RGBA32F` `samplerBuffer` textures at load time
- [ ] Add Möller–Trumbore ray-triangle intersection as a GLSL function in the path-trace shader; it receives a ray origin and direction, samples the triangle buffer by index, and returns hit distance, barycentric coordinates, and the triangle index
- [ ] Add an iterative BVH traversal loop in GLSL that walks the node buffer using a small fixed-size stack (depth 32); at leaf nodes call the Möller–Trumbore function for each triangle in the leaf's range; this replaces the per-mesh uniform approach used by SDF objects
- [ ] Interpolate per-vertex normals using barycentric coordinates at the hit point so smooth-shaded meshes (Suzanne, glTF models) produce smooth highlights rather than faceted face normals
- [ ] Interpolate per-vertex UVs using barycentric coordinates and sample a bound `sampler2D` albedo texture if the material has one; fall back to the material's uniform colour if no texture is bound
- [ ] Extend texture support beyond albedo: bind a normal-map `sampler2D` per mesh material and apply TBN tangent-space transform at hit points using barycentric-interpolated tangents/bitangents derived from the UV gradient (`dFdx`/`dFdy` or precomputed per-vertex); bind metallic-roughness, emissive, and AO maps in the same material texture slot array so a full glTF PBR material can be faithfully reproduced in a single path-trace hit evaluation
- [ ] Build a texture atlas for multi-material meshes (e.g. Sponza's 26 material groups): pack all per-material base-colour textures into a single `RGBA8` 2-D texture array (`GL_TEXTURE_2D_ARRAY`) and store a `materialIndex` per triangle in the triangle soup buffer; the GLSL hit shader indexes into the array with `texture(atlasTexture, vec3(uv, float(materialIndex)))` to avoid per-draw-call texture swaps
- [ ] Fit every loaded mesh inside the scene's unit cube on import by computing its AABB and uniformly scaling it to a configurable target size (default: longest axis = 1.0 unit) so Suzanne and other models appear at a consistent scale regardless of their original export units
- [ ] Add a `MeshSceneObject` entry in the ECS tree showing triangle count, BVH node count, and memory usage (KB) in a detail row below the item name
- [ ] Validate the full pipeline on Suzanne: load `assets/models/suzanne.obj`, build BVH, upload to GPU, path-trace at 512×512 with DIFFUSE material and confirm normals, silhouette, and shadow all render correctly before enabling other formats

### Denoising And Adaptive Sampling
- [ ] Add a spatial bilateral denoiser post-pass (toggled in the Render menu) that blurs the accumulated image weighted by colour similarity and depth difference; reduces visible noise in converging scenes without changing the path tracer output and makes the quality/performance trade-off visible interactively
- [ ] Add a temporal reprojection pass that reuses samples from the previous frame for pixels whose world-space position has not moved; reduces per-frame ray cost for static regions in slowly-rotating or paused scenes
- [ ] Add adaptive per-pixel sample budgeting — track per-pixel variance after each accumulation step and allocate additional rays only to pixels above a variance threshold; expose the variance map as a debug overlay (bright = more samples needed) to demonstrate the technique visually
- [ ] Add a variance heat-map debug view alongside the existing albedo/normals/depth debug views so the adaptive sampling distribution can be inspected at runtime

### Rendering Quality Pipeline
- [ ] Pre-compile all shader variants during the startup loading phase (after Rapier WASM init, before the first rendered frame): enumerate every material-type flag combination used by the scene and call `gl.compileShader` + `gl.linkProgram` for each while the loading overlay is still showing; eliminates the hundreds-of-milliseconds first-frame freeze that currently inflates benchmark warm-up time and corrupts the first score sample
- [ ] Add **progressive quality throttle during camera drag**: while a pointer button or touch is held on the canvas, temporarily reduce rays-per-pixel to 1 and bounce count to 2 so dragging the camera feels responsive at any render resolution; restore the configured quality values on `pointerup` and call `clearSamples()` once so clean accumulation resumes from a single frame
- [ ] Add **HDRI environment map loading**: accept a `.hdr` (RGBE) file via a file-picker button or canvas drag-and-drop; decode the RGBE encoding on the CPU into a `Float32Array`, upload as an `RGBA32F` equirectangular `sampler2D`, and sample it in the sky branch of the path-trace shader as a replacement for the procedural gradient; add an "HDRI" option to the environment type selector alongside Open Sky and Studio
- [ ] Add **tone mapping presets** selectable in the Render or Output panel: ACES filmic, Reinhard, Uncharted 2 (Hable), and the current linear pass-through; apply the selected curve in the display composite shader as the final step before gamma correction (`linearRgb → tonemapped → pow(x, 1/2.2)`) so all options operate in linear light space without touching light intensity or sky brightness uniforms
- [ ] Add an **independent exposure control** (EV stop offset, range −3 to +3, default 0, step 0.25) applied as `linearRgb *= pow(2.0, exposureEV)` immediately before tone mapping; allows brightness matching across scenes and GPUs without touching per-object light intensity or environment brightness sliders

## Workstream 9: JS Performance (CPU-Side Hot Path Fixes)

### DOM and Display
- [x] `syncActionToggleButtons()` (~line 6448) calls `querySelectorAll()` with a dynamic template string every time a pause toggle changes — cache the button node-lists at init time per action name so the query only runs once
- [x] `syncAllControlsFromState()` (~line 6194) unconditionally writes `.value` and `.textContent` on ~20 input/label pairs on every preset load or scene rebuild — add a previous-value guard to each `syncIntegerControlFromState` / `syncNumberControlFromState` call so DOM writes are skipped when the value is unchanged
- [x] `syncSceneTree()` (~line 5129) destroys and rebuilds every list button by setting `textContent = ''` then calling `createElement` + `appendChild` for each object on every call — replace with an in-place diff that only creates, updates, or removes the buttons that changed
- [x] `writeElementTextIfChanged()` (~line 4670) reads `element.textContent` from the DOM every call to compare — cache the last-written string in a parallel JS map keyed by element so the comparison never touches the DOM
- [x] `BenchmarkDisplay.update()` throttle check (~line 4730) happens after all six `writeElementTextIfChanged` calls are prepared — move the throttle guard to the very top of the function before any string formatting runs so the 59 out of 60 frames that are throttled do no work at all

### Physics Sync
- [x] `syncPhysicsObjectsFromBodies()` reads Rapier body translations into a reusable buffer and uses the lower-level raw body-set translation path when available, avoiding the extra `{x,y,z}` object allocated by `rigidBody.translation()` on supported Rapier builds
- [ ] `hasAwakeDynamicPhysicsObjects()` still uses a full `isSleeping()` scan when sleep state is unknown; scans are skipped on normal active physics steps now, but a true collision-event dirty flag still needs Rapier `EventQueue` wiring before this can be considered fully complete
- [ ] Run Rapier on a **dedicated worker thread** via `SharedArrayBuffer` + `Atomics`: move `world.step()` and the transform read-back loop into a worker; write rigid body translations into a shared `Float32Array` after each step and read them on the main thread via a typed-array view; eliminates the ~2–4 ms physics tick from the main-thread frame budget and allows physics and rendering to overlap; requires `Cross-Origin-Isolation` headers (`COOP: same-origin`, `COEP: require-corp`) in both the dev server and Electron main process
- [ ] Add **dirty-flag incremental physics rebuild**: track a `physicsDirty` boolean per scene object, set it whenever a physics-relevant property changes (body type, friction, restitution, collision group, position override); in `rebuildScene` only remove and re-add Rapier bodies for flagged objects rather than clearing the entire world; reduces `rebuildScene` cost from O(N) to O(changed) for large scenes where a single object was edited

### Benchmark Rolling Window
- [x] `recordTraceSample()` (~line 3445) pushes a freshly allocated `{kind, timestampMilliseconds, activeRaysPerFrame, ...}` object into `this.samples` every rendered frame — pre-allocate a fixed-size circular buffer of sample objects and overwrite slots in place to eliminate per-frame GC pressure
- [x] `pruneOldEntries()` is called inside both `recordTraceSample` and `recordFramePacing` on every sample — because samples are already time-ordered, pruning only needs to run when the oldest entry is about to fall outside the window, not on every push; add an age check before calling prune

### Uniform Uploads
- [ ] `setTracerFrameUniforms()` (~line 3933) writes six properties into `this.tracerFrameScalarUniformValues` and then calls `setChangedCachedScalarUniformValues` which diffs them against `previousTracerFrameScalarUniformValues` — the object write + diff happens every frame even when nothing changed; add a single dirty flag on `applicationState` that is set by any setter and cleared here so the entire block can be skipped on unchanged frames
- [x] `webGlContext.useProgram()` is called at four separate points (~lines 4097, 4358, 4439, 4634) each guarded only by the render path taken — track the currently active program in a module-level variable and skip the `useProgram` call when the program is already bound, reducing driver state changes on frames that re-enter the same path

### Scene Name Formatting
- [x] `formatSceneObjectDisplayName()` (~line 4866) runs four chained regex `.replace()` calls on the constructor name every time the scene tree or inspector header renders — the set of class names is fixed at compile time; replace with a `Map<constructor, displayName>` lookup built once at module load so the tree rebuild does no string work per item

### Setup and Architecture
- [x] Decide between Preact+HTM and React+HTM — prefer Preact for bundle size (~3 KB vs ~45 KB) and signal-based fine-grained updates
- [x] Add an importmap in index.html that maps `preact`, `preact/hooks`, `htm/preact`, and `@preact/signals` to ESM CDN URLs (esm.sh or unpkg) with pinned versions
- [x] Add a `src/` directory to hold all React/HTM UI source files as plain ES modules
- [x] Create `src/main.jsx.js` as the app entry point that imports Preact and mounts the root component into a `#ui-root` div
- [x] Add the `#ui-root` div to index.html as a sibling of `#main` at the body root, positioned fixed at z-index above the canvas
- [x] Keep the `<canvas>` and `#error` elements in static HTML; React must never own or re-render the canvas element
- [ ] Strip all inline HTML for panels, menus, and overlays from index.html once each React component is live and tested
- [x] Extract all CSS from the `<style>` block in index.html into `src/app.css` so styles survive the HTML teardown
- [ ] Verify the app loads and renders correctly in both the Electron shell and the browser/GitHub Pages deploy after the importmap is added

### State Management
- [x] Create `src/store.js` that converts `createApplicationState()` into Preact signals — one signal per field so components only re-render when their specific field changes
- [x] Export typed signal accessors and setter functions from `src/store.js` to avoid raw `.value` writes scattered across components
- [x] Create a separate `src/benchmarkStore.js` with signals for all `benchmarkSnapshot` fields — score, rays/s, bandwidth, perceptual fps, resolution, bounces, gpu renderer string, and source label
- [x] Create `src/sceneStore.js` with a signal for the live scene item list and a signal for the currently selected item ID
- [ ] Wire the existing render loop to call `updateBenchmarkSignals(snapshot)` at the same throttle interval currently used by `BenchmarkDisplay.update()`
- [ ] Wire `applicationState` mutations (material changes, slider moves, environment switches, pause toggles) to write through the signal store instead of mutating the plain object directly
- [ ] Remove `BenchmarkDisplay`, `writeElementTextIfChanged`, and `readRequiredElement` call sites once signals drive all benchmark DOM updates
- [ ] Remove `updateGpuStatus()` and its two element writes once the GPU renderer signal is populated at init and read by the React component

### Component: FloatingWindow
- [x] Create `src/components/FloatingWindow.js` as a generic draggable, collapsible, closeable panel wrapper
- [x] Accept `windowKey`, `title`, `defaultPosition`, `defaultVisible`, and `children` props
- [x] Manage drag state with `useRef` for the offset and `useCallback` for pointer event handlers — do not write drag position to Preact signals to avoid unnecessary re-renders
- [x] Persist panel position and visibility to `localStorage` under the same key scheme as the current `data-window-key` attributes
- [x] Restore persisted position and visibility on mount via `useEffect`
- [x] Expose a collapse toggle that hides the panel body while keeping the title bar visible
- [x] Forward a `ref` so parent components can programmatically show, hide, or focus a window
- [x] Ensure pointer capture is used for drag so fast mouse moves cannot escape the panel boundary

### Component: MenuBar
- [x] Create `src/components/MenuBar.js` as the fixed top navigation bar
- [x] Create `src/components/MenuGroup.js` for a single dropdown group with trigger button and popover
- [x] Use `focus-within` CSS for auto-open and a `click-outside` effect via `useEffect` to close the open menu when clicking elsewhere
- [x] Recreate all existing menu items — File, Edit, View, Create, Render, Help — as data-driven arrays so adding a new item does not require JSX edits
- [x] Create `src/components/QuickActions.js` for the right-side toolbar of icon buttons and preset loaders
- [x] Keep all `data-action`, `data-preset`, and `data-window-target` attribute click routing by delegating to the same `handleMenuAction` function used today
- [x] Render keyboard shortcut hints in `<span className="menu-shortcut">` inside each menu item from the same data array
- [ ] Render `aria-pressed` on quick action buttons reactively from the relevant signal (pause state, fullscreen state, panel visibility)

### Component: InspectorPanel
- [x] Create `src/components/InspectorPanel.js` as the floating inspector window using a vertical accordion layout instead of tabs; render the Object section first, then Render, Camera, Environment, Output as independently collapsible sections below
- [x] Create `src/components/AccordionSection.js` accepting `title`, `accentColor`, `storageKey`, and `defaultOpen` props; persist open state to `localStorage` via a `useEffect` on the `open` value; render a `<details>` element with the `<summary>` styled using `border-left: 3px solid` the accent color and a CSS-rotated chevron that animates on toggle
- [x] Drive the Object `AccordionSection` open state from the `selectedSceneItem` computed signal: open it automatically when `selectedSceneItem.value` is non-null, close it when null; override the `storageKey` persistence when a programmatic open/close happens so manual user closes are not overridden on next selection
- [ ] Remove the `activePanel` / `data-panel-target` tab model from `InspectorPanel.js` once the accordion is live; the Create panel moves to the scene tree `+` button — do not render a Create section inside the accordion
- [x] Create `src/components/panels/CreatePanel.js` with the add-primitive button grid and camera/pause controls
- [x] Create `src/components/panels/ObjectPanel.js` with selected-item name, material select, glossiness input, and apply button
- [x] Create `src/components/panels/RenderPanel.js` with all render sliders (bounces, light intensity, light size, fog, sky brightness, rays per pixel, temporal AA, denoiser)
- [x] Create `src/components/panels/CameraPanel.js` with FOV, focus distance, aperture, and motion blur sliders
- [x] Create `src/components/panels/OutputPanel.js` with resolution preset, custom size input, apply/fullscreen/export buttons, renderer backend select, and all color correction and bloom sliders
- [x] Create `src/components/panels/PresetPanel.js` with the preset scene button grid and reset-all
- [x] Create `src/components/SliderField.js` as a reusable labeled range input with live value display — accept `id`, `label`, `min`, `max`, `step`, `signal`, and optional `unit` props
- [x] Wire each `SliderField` to read from and write to the corresponding signal so the application state and slider stay in sync without separate `addEventListener` calls
- [ ] Remove all `readRequiredInput`, `readRequiredSelect`, and input `addEventListener` call sites that correspond to migrated sliders

### Component: SceneTreeWindow
- [x] Create `src/components/SceneTreeWindow.js` as a floating panel wrapping the scene tree
- [ ] Render the scene item list as a recursive hierarchy: build a `Map<string|null, NormalizedSceneItem[]>` from `sceneStore.sceneItems` grouped by `parentEntityId`; render root items (null key) first, then recursively render each item's children as a nested `<ul>` so groups appear as indented sub-trees
- [x] Highlight the selected item by comparing each item's ID to `sceneStore.selectedItemId`
- [ ] Handle item click by writing to `sceneStore.selectedItemId` signal which propagates selection to the canvas and inspector simultaneously
- [ ] Track group expand/collapsed state in a `useRef(new Map())` keyed by entity ID; render a chevron toggle on group items and toggle the child `<ul>` `hidden` via the ref map on click — do not write expand state to Preact signals to avoid re-rendering the whole tree on every collapse
- [ ] Add a `ComponentRow` sub-component that renders inline chips under each scene item: a material name chip, a physics badge (body type) if `source.physicsRigidBody` is non-null, and an animation label if an animation component is present; style as `display: flex; gap: 4px; padding-left: 1.5em; font-size: 0.75em; opacity: 0.7`
- [ ] Add a `+` icon button in the scene tree window title bar (next to the item count) that opens an inline `<menu>` popover listing add-primitive actions; dispatch the same `data-action` events used by the Create panel today; once live, stop rendering the create-primitive grid inside the tree panel body
- [x] Show the item count in the summary line from `sceneItems.value.length`

### Component: BenchmarkPanel
- [x] Create `src/components/BenchmarkPanel.js` as a floating panel driven entirely by signals from `benchmarkStore.js`
- [x] Render the six metric tiles (Score, Active rays/s, Ray mem BW, Perceptual FPS, Resolution, Bounces) from the corresponding signals
- [x] Render the GPU renderer label row from the `gpuRenderer` signal
- [x] Render the source label (Warming up / Rolling / GPU timer / Paused) from the `measurementSource` signal
- [x] Use `computed()` signals for formatted display strings (e.g. `formatBandwidthValue`) so formatting runs only when the raw value changes, not on every component render

### Component: RenderCanvas
- [x] Create `src/components/RenderCanvas.js` as a thin wrapper that renders `<canvas id="canvas">` and `<div id="error">` and forwards a `ref` to the canvas element
- [x] Attach mouse, touch, and pointer event handlers inside `useEffect` using `addEventListener` directly on the canvas DOM node — do not use React synthetic events for performance-critical pointer tracking
- [x] Expose an `onCanvasReady(canvasElement)` callback prop that fires once on mount so the WebGL init chain can proceed
- [x] Never update React state from within pointer event handlers — write directly to `applicationState` signals as today

### Render Loop Bridge
- [x] Create `src/renderBridge.js` that exposes `startRenderLoop(canvas, appState)` and `stopRenderLoop()`
- [ ] Move the `requestAnimationFrame` loop and all WebGL call sites into `renderBridge.js` so they are decoupled from any React lifecycle
- [ ] Call `renderBridge.startRenderLoop()` from the `onCanvasReady` callback in `RenderCanvas` after WebGL init completes
- [x] Batch all per-frame signal writes into a single `batch(() => { ... })` call (Preact signals API) to prevent multiple micro re-renders per frame
- [ ] Ensure the render loop never calls any React state setter or signal write for values that have not changed — keep the existing change-guard logic

### CSS and Style
- [x] Move all styles from the inline `<style>` block in index.html into `src/app.css` with no changes to selectors or values
- [ ] Remove the `<link rel="stylesheet" href="dist/app.css">` reference and replace it with a `<link rel="stylesheet" href="src/app.css">` once the inline block is gone
- [ ] Audit `src/app.css` for any selectors that targeted dynamically-added class names set by JS (`is-open`, `is-collapsed`, `aria-pressed`) and ensure they still match after the React migration
- [ ] Replace raw `element.style.setProperty` calls for CSS custom properties (e.g. `--canvas-render-size`) with a single `useEffect` in the `RenderCanvas` component that writes to `document.documentElement.style`

### Migration Sequence and Validation
- [ ] Migrate and validate components in this order to minimize risk: BenchmarkPanel → MenuBar → FloatingWindow → SceneTreeWindow → InspectorPanel sub-panels → CreatePanel → full InspectorPanel → RenderCanvas
- [ ] After each component migration, run the app and confirm parity with the previous behaviour before removing the old static HTML for that section
- [ ] Add a `data-migrated` attribute to each removed HTML section as a comment tombstone during the transition period, then remove tombstones after all sections are live
- [ ] Verify keyboard shortcuts still work after the menu bar migration by testing every shortcut in the existing keydown map
- [ ] Verify floating window drag, collapse, close, and position persistence all work after `FloatingWindow` migration
- [ ] Verify that benchmark values update correctly at the expected throttle rate and do not cause visible frame drops in the render loop
- [ ] Verify the Electron shell loads correctly with the importmap — Electron's renderer process must allow the CDN URLs or the importmap must fall back to vendored copies
- [ ] Vendor Preact, HTM, and Preact signals into `vendor/` if CDN availability cannot be guaranteed in the Electron context
- [ ] Run the GitHub Pages deploy and confirm all assets load correctly with the new module structure

## Workstream 10: New Material Shaders

### Physically-Based Optics
- [ ] Add anisotropic GGX material (ANISOTROPIC_GGX) — extends the existing GGX_PBR material with a per-object tangent direction and separate alpha-x / alpha-y roughness values; produces directional highlight stretch seen on brushed metal, hair, satin, and CD grooves
- [x] Add thin film interference material (THIN_FILM) — computes wavelength-dependent phase shift as a function of film thickness and view angle; produces iridescent soap bubble and oil slick colour variation that shifts with viewing direction
- [x] Add retroreflector material (RETROREFLECTOR) — reflects rays back toward the incoming direction regardless of surface normal; models cat's-eye, road markings, and safety tape; trivial ray direction math but visually distinctive
- [x] Add velvet / sheen material (VELVET) — off-specular peak at grazing angles using the Disney sheen term; important for fabric, felt, and peach-fuzz surfaces that look dull head-on and bright at the silhouette

### Procedural Surface
- [x] Add Voronoi cracked-earth material (VORONOI_CRACKS) — cellular noise distance field baked into surface colour and normal offset; darkens cell boundaries to simulate dried mud, reptile scales, or fractured ceramic
- [x] Add holographic / diffraction grating material (DIFFRACTION_GRATING) — sinusoidal spectral response modulated by dot(viewDir, reflectDir) produces rainbow banding that shifts with viewing angle; complements the existing SPECTRAL_GLASS material
- [ ] Add tri-planar UV projection mode usable by any material — blends three axis-aligned texture lookups weighted by the absolute surface normal to eliminate seams on SDF objects like capsules, toruses, and fractals; prerequisite for texture-based materials to work correctly on curved primitives

### Volumetric / Atmosphere
- [ ] Add heterogeneous fog material (HETEROGENEOUS_FOG) — replaces the current uniform fog density with an FBM-modulated density field sampled along each ray march step; produces patchy cloud-like scattering and visually richer god rays than the flat VOLUMETRIC_SHAFTS material
- [ ] Add blackbody emitter material (BLACKBODY) — maps a temperature uniform (in Kelvin) to emission colour via a Planck curve approximation; enables physically correct glowing objects such as hot coals, molten metal, and forge interiors as an alternative to the current flat emissive tint

### Emissive
- [ ] Add self-emitting surface material (EMISSIVE) — a surface that emits a configurable colour and intensity without being an area light scene object; unlike area lights it casts no explicit shadow rays but contributes emitted radiance along any path that hits it; useful for glowing screens, neon signs, fire embers, and indicator lights
- [ ] Expose per-object emission colour and emission intensity properties in the inspector when the EMISSIVE material is selected, distinct from the surface albedo so a neon tube can be white-hot at the surface while emitting coloured light
- [ ] Add an emission strength multiplier constant at the top of the EMISSIVE shader branch so the energy scale can be tuned without changing individual object intensities across a scene

### Stylized
- [ ] Add toon / cel shading material (TOON) — quantises the diffuse dot product into N discrete bands and adds a hard silhouette outline via a screen-space normal discontinuity test; useful for demonstrating the renderer's flexibility as an art-demo mode alongside the physically-based materials
- [ ] Add X-ray / silhouette accumulation material (XRAY) — accumulates transparency weighted by the inverse of the view-to-normal dot product so edges glow and surfaces facing the camera are invisible; useful for inspecting SDF scene structure and showcasing the fractal and metaballs primitives

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
- [ ] Add a **"Share Result" permalink**: after a full run, encode the summary (GPU name, browser UA, OS, date, canvas resolution, per-scene median/P5/P95) as compressed base64 in a URL fragment (`#result=<base64>`); the "Share" button copies the full URL to the clipboard so results can be compared and reproduced with no server — the fragment is parsed on page load and pre-fills the baseline comparison if present
- [ ] Add an **"Export Score Card" PNG**: after the full runner completes, use the 2D Canvas API to draw a 800×360 summary card (GPU name, browser, OS, date, canvas size, per-scene score rows, delta-vs-baseline badges, composite score), then trigger an automatic `<a download>` so benchmark results are portable self-documenting images that can be attached to issues or forum posts

### Scene: Sponza Atrium (Benchmark Default)
- [ ] Create `benchmarkSponzaAtrium` as the new default benchmark scene; load `assets/models/sponza/sponza.glb` via the `GltfLoader`, build the SAH BVH over all mesh primitives (~260 K triangles), and upload the full PBR texture atlas so every surface is textured at render time; this scene requires the triangle mesh GPU rendering and texture atlas infrastructure from WS3 and WS7 to be complete before this factory can be registered
- [ ] Position and orient the camera at `[0, 0.3, 0]` looking toward `[1, 0.2, 0]` (down the main colonnade axis) so the flagstone floor, arched columns, fabric curtains, and stone ceiling are all visible from the opening camera angle; set camera FOV to 65° to capture the atrium width without excessive distortion
- [ ] Set target bounces to 8 and rays-per-pixel to 16; the large number of distinct PBR material groups, the mix of rough stone and metallic trim, and the multi-bounce inter-reflections between the columns make this the most demanding texture-sampling and lighting integration workload
- [ ] Place a single GLASS sphere (radius 0.18) at the centre of the atrium floor `[0, 0.18, 0]` with no physics body; drive its position every frame using a **3-D Lissajous orbit**: `x(t) = 0.45 * sin(3t * 0.11)`, `y(t) = 0.18 + 0.12 * abs(sin(5t * 0.07))` (bouncing vertical envelope so it never clips the floor), `z(t) = 0.38 * sin(7t * 0.09)` — the incommensurable frequency ratios (3 : 5 : 7) mean the path never exactly repeats, keeping the caustic footprint on the flagstones continuously shifting and preventing accumulation from settling
- [ ] Call `sphere.setTemporaryTranslation([x(t) - x(0), y(t) - y(0), z(t) - z(0)])` each frame inside the scene's `updateAnimation(elapsedSeconds)` hook and call `pathTracer.clearSamples(false)` to invalidate accumulation; the animation must be deterministic given total elapsed time so the benchmark produces the same camera-to-sphere geometry sequence on every run
- [ ] Expose the Lissajous frequency coefficients (`lissajousFreqX`, `lissajousFreqY`, `lissajousFreqZ`) and amplitudes as named constants at the top of the scene factory so the animation can be retuned without searching the function body
- [ ] Register this scene as the value of `defaultBenchmarkScene` in the `benchmarkScenes` registry metadata once it is implemented and passes a validation run; until then leave `defaultBenchmarkScene = 'standard'`

### Scene: Shader Gauntlet
- [x] Create `benchmarkShaderGauntlet` — a 3×4 grid of spheres each assigned a different expensive material (GGX_PBR, SPECTRAL_GLASS, SUBSURFACE, CAUSTICS, PROCEDURAL, SDF_FRACTAL, VOLUMETRIC_SHAFTS, BOKEH, MOTION_BLUR_STRESS, FIRE_PLASMA, GLASS, MIRROR) arranged so every material is visible from the rotating camera at all times
- [x] Set target bounces to 8 and rays-per-pixel to 16 so glass and caustic materials have enough paths to produce their characteristic effects and exercise the shader branch heavily
- [x] Enable camera auto-rotation at standard speed so the angle to each material's specular lobe cycles continuously and prevents the accumulation buffer from settling

### Scene: Physics Chaos
- [x] Create `benchmarkPhysicsChaos` — drop 20 dynamic physics spheres from a fixed height into a bowl-shaped arrangement of static rounded-box walls so they collide, scatter, and keep bouncing indefinitely
- [x] Use a high restitution value so spheres remain in motion and the path tracer must recompile or invalidate accumulation every frame for the full run
- [x] Assign alternating MIRROR and GLASS materials to the spheres so inter-reflection and refraction paths are active simultaneously alongside the physics transform updates
- [x] Set target bounces to 6 and rays-per-pixel to 8 — enough for reflections to resolve but low enough that the per-frame transform invalidation cost dominates over shader cost

### Scene: SDF Complexity
- [ ] Create `benchmarkSdfComplexity` — place a Mandelbulb, an SDF fractal, a metaballs cluster, and a CSG shape side by side with a slow Y-axis orbit animation on each so the camera always sees at least two complex SDF objects at once
- [x] Assign PROCEDURAL material to the Mandelbulb and SDF_FRACTAL material to the fractal object so both the geometry and surface shader are expensive simultaneously
- [x] Set target bounces to 5 and rays-per-pixel to 12; the sphere-march iteration count is the primary cost driver here and should stress-test mid-range GPUs at 512×512

### Scene: Caustic Pool
- [x] Create `benchmarkCausticPool` — a large GLASS sphere suspended above a DIFFUSE plane with a small bright area light positioned above and slightly off-axis so the caustic pattern on the floor is complex and shifts as the camera orbits
- [x] Add two smaller SPECTRAL_GLASS spheres flanking the central sphere so chromatic dispersion paths are also active, increasing the variance and sample-count demand
- [x] Set target bounces to 10 and rays-per-pixel to 24 to give caustic and spectral paths enough bounces to converge enough for the score to be meaningful; this scene is intentionally the hardest and will produce the lowest score

### Scene: Motion Blur Stress
- [ ] Create `benchmarkMotionBlurStress` — eight MOTION_BLUR_STRESS material cubes arranged in a ring, each spinning on a local axis using a procedural orbit animation, with the camera orbiting the ring at a different speed so relative motion is always present
- [x] Add a BOKEH material sphere at the centre of the ring placed exactly at the camera focus distance so the depth-of-field blur kernel is also active while motion blur evaluates
- [x] Set target bounces to 4 and rays-per-pixel to 32 — motion blur and bokeh both require many samples to resolve so the bottleneck is sample throughput rather than bounce depth

### Scene: Volumetric Fog Flythrough
- [x] Create `benchmarkVolumetricFog` — a dense arrangement of VOLUMETRIC_SHAFTS spheres and tall cylinder columns with fog density set to 0.8 and sky brightness at 2.0 so every ray spends significant time marching through fog before hitting geometry
- [x] Use slow camera auto-rotation at half the standard speed so accumulation is regularly invalidated but not so fast that the image never partially converges, producing a realistic flythrough load pattern
- [x] Set target bounces to 6 and rays-per-pixel to 10; the volume march steps dominate cost so bounce count has diminishing returns here

### Scene: Particle Fluid Simulation
- [ ] Create `benchmarkParticleFluid` — spawn 24 dynamic physics spheres with small radius (0.06) tightly packed inside an invisible bounding volume at scene centre; apply Rapier spring joints between each sphere and its nearest neighbours (rest length ≈ 0.14, high stiffness, moderate damping) to simulate cohesion so the cluster sloshes and deforms rather than scattering
- [ ] Assign SUBSURFACE material to all particle spheres so the translucent organic shading reinforces the fluid appearance and the scattered-light evaluation adds shader cost on top of physics cost
- [ ] Add a single static rounded-box "container" with GLASS material below the cluster so the fluid can partially settle into it and produce refraction beneath the particles
- [ ] Expose `particleFluidParticleCount` (default 24), `particleFluidRadius` (default 0.06), and `particleFluidSpringStiffness` (default 120) as tunable constants at the top of the scene factory so particle density, sphere size, and surface tension can be adjusted to dial in convincing sloshing versus scatter behaviour
- [ ] Add UI controls in the benchmark scene metadata (or a debug panel) to hot-reload the scene with different count and radius values without a full page reload, so visual quality versus performance trade-offs can be explored interactively
- [ ] Set target bounces to 6 and rays-per-pixel to 8; physics transform invalidation every frame prevents accumulation convergence so extra rays-per-pixel matter more than bounce depth here

## Workstream 12: Showcase Demo Scenes

### Optical Showcase
- [ ] Create `demoCorridorOfLight` (Cornell box variant) — a closed-room scene with six DIFFUSE planes in distinct colours (white ceiling/floor, red/green side walls, blue back wall) lit by a single centred area light; no objects initially so the colour bleeding and soft shadows on bare walls demonstrate path tracing's core capability
- [ ] Add an option to the Cornell box scene to insert a central GLASS sphere or MIRROR cube as a secondary subject, toggled by a scene parameter, so a single scene can showcase both empty-room colour bleeding and material interaction
- [ ] Create `demoDeptOfFieldPortrait` — a single GGX_PBR sphere at sharp focus in the foreground with a group of smaller spheres at varying depths behind it, lit by a large soft area light; camera aperture set wide so background blur is pronounced and the bokeh disc shape is clearly visible
- [ ] Create `demoShadowStudy` — a flat DIFFUSE floor plane with three area lights of different sizes (small/sharp, medium, large/soft) and colours positioned at different angles casting overlapping penumbras onto simple block geometry; intended to isolate and demonstrate soft-shadow quality as bounce count and sample count increase
- [ ] Create `demoMirrorRoom` — a hollow cube of six MIRROR planes enclosing a single small DIFFUSE coloured sphere at the centre; no environment lighting, only a tiny point-like area light; demonstrates infinite inter-reflection and exposes convergence behaviour at the configured bounce limit

### Environment And Atmosphere
- [ ] Create `demoSkySphere` — an empty scene (no geometry except a large invisible ground plane) with the open-sky environment enabled and a single MIRROR sphere suspended at scene centre; the sphere reflects the full sky dome and the ground plane catches the sky's sky-light illumination; demonstrates the environment system as the primary visual subject
- [ ] Create `demoFogCorridor` — two parallel rows of thin DIFFUSE pillars receding into the distance with fog density set near maximum and a warm directional sky; the pillars fade to silhouette in the distance and shafts of scattered light are visible between them; requires the VOLUMETRIC_SHAFTS or HETEROGENEOUS_FOG material to be active on at least one object to seed the scattering

### Material Sampler
- [ ] Create `demoMaterialGrid` — a 4×4 grid of identical spheres each assigned a different material in a fixed display order, with consistent neutral lighting and a plain DIFFUSE floor and back wall; functions as a live material reference card and can be iterated during material development to see all materials simultaneously
- [ ] Create `demoNeonRoom` — a dark scene containing several EMISSIVE material objects (tubes, panels, small spheres) in different colours arranged on a reflective floor with MIRROR material; no area lights, only the emissive surfaces provide illumination; demonstrates the EMISSIVE material system and the soft indirect glow it produces on surrounding geometry
