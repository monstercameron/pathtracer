# TODOs

## Workstream 1: Scene Data And Documents
- [ ] Make every object in the scene a separate ECS item
- [ ] Define the ECS entity and component model for scene objects
- [ ] Convert existing primitives, lights, and special objects into ECS-backed entities
- [ ] Add a stable ID and name for each scene item
- [ ] Add per-item settings and expand the property model over time
- [ ] Decide which settings are shared across all items and which are type-specific
- [ ] Add scene save and load support
- [ ] Define a scene file format that can store objects, materials, lights, and settings
- [ ] Add a reset or new scene flow

## Workstream 2: Scene Editing And Selection
- [ ] Add an ECS tree view that mirrors the live scene
- [ ] Keep tree selection and canvas selection in sync
- [ ] Support selecting and dragging multiple items in the ECS tree
- [ ] Add Shift + click and Ctrl + click selection behavior in both the tree and the viewport
- [ ] Show a clear visual state for primary selection vs secondary selected items
- [ ] Add marquee or box selection in the viewport if it fits the editor workflow
- [ ] Add bulk actions for the current multi-selection
- [ ] Add duplicate, rename, and delete actions for scene items
- [ ] Add hide, show, and lock controls for scene items
- [ ] Add draggable scale gizmos for individual axes
- [ ] Add Ctrl + drag to scale uniformly across all axes
- [ ] Split transform editing into translate, rotate, and scale modes
- [ ] Keep gizmos aligned with the selected item's local or world space
- [ ] Add numeric transform inputs for precise editing
- [ ] Support moving, scaling, and rotating multiple selected items around a shared pivot
- [ ] Define how mixed-value fields are shown in the settings panel
- [ ] Add undo and redo for scene edits
- [ ] Reset accumulation when a transform or scene edit changes the image

## Workstream 3: Assets, Materials, And Animation
- [ ] Add support for importing external 3D models into the scene
- [ ] Choose and document the initial supported model formats
- [ ] Convert imported models into ECS-backed scene items and sub-items
- [ ] Preserve model hierarchy, pivots, and named nodes when importing
- [ ] Add support for textured materials on imported assets
- [ ] Handle texture loading, caching, missing-texture fallbacks, and asset relinking
- [ ] Add controls for assigning and swapping textures in the editor
- [ ] Define how textured materials map into the path tracing material system
- [ ] Add reusable material presets or saved materials
- [ ] Add support for animated models and animation clips
- [ ] Add playback controls for play, pause, stop, speed, and clip selection
- [ ] Keep animation state in sync with transforms, selection, and scene editing
- [ ] Decide how animated models interact with physics and benchmark mode

## Workstream 4: Cameras, Lighting, And Render View
- [ ] Add camera bookmarks or saved shots
- [ ] Add camera controls for FOV, focus distance, and aperture or depth of field
- [ ] Add a simple shot switcher for comparing scene compositions
- [ ] Add explicit light editing for position, size, intensity, and color
- [ ] Add environment or sky controls that are easier to adjust during scene comp
- [ ] Add render debug views such as albedo, normals, and depth
- [ ] Add draft, preview, and final quality presets
- [ ] Add a dedicated benchmark mode with fixed render settings for repeatable comparisons
- [ ] Create a specific benchmark scene that stays stable across releases
- [ ] Lock camera path, timing, and scene setup while benchmark mode is active
- [ ] Show benchmark-only stats that are easy to compare between runs

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
- [x] Add movable window panels for the ECS tree and selected-object settings
- [x] Allow floating panels to be dragged, focused, collapsed, and reopened
- [x] Keep ECS and object-settings windows in sync with the current selection and active scene
- [x] Decide whether floating panels can dock or should remain free-floating only
- [x] Save and restore panel positions, sizes, and visibility between sessions

## Workstream 6: Physics And Codebase Structure
- [ ] Allow physics to be enabled per item
- [ ] Add per-item physics settings
- [ ] Define which ECS components create Rapier bodies and colliders
- [ ] Sync transforms between editor state and physics state
- [ ] Add toggles for dynamic, kinematic, and static behavior
- [ ] Expose common physics controls such as mass, friction, restitution, and gravity
- [ ] Split the files into smaller logic-focused modules to keep them manageable
- [ ] Separate scene state, editor UI, renderer integration, and physics integration into distinct modules
- [ ] Extract reusable editor controls for item settings panels

## Workstream 7: Rendering Backends And WebGPU
- [ ] Add a renderer abstraction so WebGL and WebGPU can share the same scene and app state
- [ ] Keep scene, camera, materials, and editor logic backend-agnostic where possible
- [ ] Add initial WebGPU support for the core rendering path
- [ ] Decide which features must work in both backends and which can stay WebGPU-only at first
- [ ] Add runtime selection between WebGL and WebGPU
- [ ] Detect WebGPU support at startup and fall back to WebGL when unavailable
- [ ] Add a visible backend selector in the app settings or render menu
- [ ] Define whether backend switching requires a renderer restart or can happen live
- [ ] Make backend changes rebuild the required GPU resources safely
- [ ] Keep benchmark reporting aware of the active rendering backend
- [ ] Add backend-specific ray-rate profiling so WebGL and WebGPU hotspots can be compared directly
- [ ] Measure the cost of accumulation texture transfers and reduce extra full-frame copies where possible
- [ ] Review whether preserveDrawingBuffer is still needed and disable it when export does not require it
- [ ] Reduce unnecessary post-process passes for bloom, glare, and display composition in draft modes
- [ ] Minimize per-frame uniform and state updates by batching or caching unchanged renderer state
- [ ] Add dynamic quality controls that can lower rays per pixel or internal render resolution to protect ray rate
- [ ] Investigate scene acceleration structures or faster scene queries for larger object counts
- [ ] Specialize shaders or pipelines for common material paths instead of paying for rarely used branches every frame
- [ ] Add WebGL-specific optimization passes for texture bandwidth, framebuffer usage, shader branching, and draw-pass count
- [ ] Add WebGPU-specific optimization passes for compute-based accumulation, buffer layouts, workgroup sizing, and async resource uploads
