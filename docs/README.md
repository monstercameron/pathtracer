# WebGL Path Tracing

Welcome. This is a modernized WebGL path tracing tech demo with interactive scene controls, Rapier-powered sphere and cube physics, temporal anti-aliasing, bloom/glare, fog, glass and shader-material experiments, asset-loader scaffolding, and an optional open-sky environment.

Live demo:
https://monstercameron.github.io/pathtracer/

The project is forked from Evan Wallace's original WebGL path tracing demo:
https://madebyevan.com/webgl-path-tracing/

I am probably 90% of the traffic to that site from BestBuys, since I use it as a benchmark of sorts.

## What It Does

This demo renders a small path-traced scene directly in the browser. It progressively refines the image over time, so the picture starts noisy and settles as more rays accumulate.

You can:

- Switch between diffuse, mirror, glossy, glass, PBR, volumetric, procedural, spectral, emissive, toon, X-Ray, and other shader-material options.
- Add spheres, cubes, and extended primitives to the scene.
- Let Rapier physics move eligible sphere and cube scene items.
- Change FOV, depth of field, light bounces, rays per pixel, light size, light intensity, fog, bloom, glare, and denoising.
- Use the File/Edit/View/Create/Scene/Render/Help menu bar to run commands, load scenes, and open floating panels.
- Use polished top-menu quick actions for one-click scene presets, common primitives, panels, benchmark, fullscreen, pause, and PNG actions.
- Save and load editable scene JSON from the File menu.
- Rename, duplicate, hide, lock, and position selected scene items from the inspector.
- Switch between orbit camera and FPS camera modes.
- Change render scale or exact render dimensions, keep the visible canvas fitted to the page, use canvas-only or panel-preserving fullscreen, and export a clean PNG without the editor selection outline.
- Move, collapse, close, and reopen the floating inspector, scene tree, and benchmark panels.
- Toggle camera rotation.
- Load preset, demo, and benchmark scenes.
- Review rolling benchmark metrics, copy stable JSON results, create shareable result URLs, save score-card PNGs, and compare against a local baseline.
- See startup progress while the renderer compiles; startup failures show a copyable error stack in the loading overlay.
- Use the open-sky environment instead of a closed Cornell box.

Supported extended geometry includes cylinders, cones/frustums, capsules, ellipsoids, toruses, rounded boxes, disks/planes, triangles/wedges/prisms, metaballs, CSG shapes, Mandelbulb/SDF fractals, and visible area light geometry.

The asset-loader scaffold in `src/loaders` can parse OBJ/MTL, STL, PLY, glTF 2.0 JSON (`.gltf`), and binary GLB (`.glb`) files into flat triangle data for the upcoming mesh scene-object path. GLTF helpers are exposed as `GltfLoader`, `parseGltf()`, `loadGltfFromText()`, `loadGltfFromBinary()`, and `loadGltfFromUrl()`. The `src/importers` coordinator groups File-like drops such as OBJ+MTL pairs, `.gltf`+`.bin` pairs, and texture siblings, then routes OBJ, glTF, GLB, STL, and PLY inputs through smoke-tested parsers. Canvas or file-input handlers can pass a `DragEvent`, `DataTransfer`, `FileList`, or plain file array to `getDroppedFiles()` or `importDroppedSource()`. OBJ imports resolve dropped sibling diffuse texture files into cached texture assets; unresolved paths get neutral checker fallback metadata without requiring the renderer mesh path. Imports also create an isolated CPU-side `MeshRecord` with source-space bounds, material/object/group triangle summaries, estimated triangle payload bytes, and default unit-cube fitting metadata (`longestAxis = 1.0`) so scene insertion can consume a normalized transform later. The GLTF path handles GLB 2.0 chunks, supplied buffers, data URI buffers, fetched sibling buffers, triangle/strip/fan primitives, positions, normals, UVs, and PBR material metadata mapped to the closest current path-tracer material. Reference model source notes live in `assets/models/README.md`; Suzanne OBJ assets remain unbundled until a clearly compatible source is selected.

## How To Use It

Open the page and let the image settle for a few seconds. Higher rays per pixel and more light bounces improve quality but cost more GPU time.

Useful controls:

- Menu bar: uses File/Edit/View/Create/Scene/Render/Help menus for global commands, creation, scene loading, render controls, panel visibility, benchmark scenes, and export.
- Top-menu quick actions: mirrors the most-used scene, primitive, panel, benchmark, fullscreen, pause, and export actions with compact buttons, hover labels, and synced pressed states.
- Floating panels: move, collapse, close, and reopen the scene tree, accordion inspector, and benchmark windows; panel layout is restored in the browser.
- File menu: saves and loads scene JSON, and exports PNG snapshots.
- Scene tree: mirrors the active scene, owns the add-item `+` popover for all primitives and visible area lights, exposes settings-panel shortcuts, and stays synced with canvas selection and the selected-object inspector.
- Object: rename, duplicate, hide/show, lock/unlock, and edit the selected item's position numerically.
- Physics: edit supported sphere/cube bodies as dynamic, kinematic, or static; tune mass, gravity scale, friction, restitution, and collision participation; use the top quick action to reset physics interactions back to authored transforms.
- `Pause Camera` / `Play Camera`: starts or stops the slow camera orbit.
- `Pause Frames`: freezes the render loop without adding new frames.
- `Pause Rays at Converged`: keeps rendering until the current scene reaches the convergence sample target, then stops adding new rays.
- `Create` / `Add primitive`: exposes every primitive directly, including spheres, cubes, curved SDF shapes, flat primitives, implicit shapes, fractals, and visible area light panels.
- `Scene`: loads core presets, shader/recursive presets, primitive and area-light showcases, demo scenes, and fixed benchmark scenes. Demo scenes include Corridor of Light, Depth-of-Field Portrait, Shadow Study, Mirror Room, Sky Sphere, Fog Corridor, Material Grid, and Neon Room. Benchmark scenes include the standard benchmark, shader gauntlet, physics chaos, SDF complexity, caustic pool, motion blur stress, and volumetric fog flythrough; `Run Benchmark Sequence` measures every registered benchmark scene in order.
- `Object`: shows the current selection, selects the light, deletes the selected item, and applies object shaders.
- `Material`: changes the material used for new scene objects, including diffuse, mirror, glossy, glass, GGX PBR, spectral glass, subsurface, caustics, procedural, SDF fractal, volumetric shafts, bokeh, motion blur stress, fire plasma, thin film, retroreflector, velvet, Voronoi cracks, diffraction grating, anisotropic GGX, blackbody, emissive, toon, and X-Ray surfaces. Selected EMISSIVE objects expose emission intensity and color controls.
- `Environment`: switches between Cornell boxes and the open-sky scene.
- `Light`: edits position, intensity, size, and color.
- `Debug views`: switch the renderer between beauty, albedo, normals, and depth views from the Render menu.
- `Light Bounces`: controls path depth.
- `Rays Per Pixel`: controls samples per frame.
- `Camera`: adjusts FOV, focus distance, aperture, motion blur, saved camera shots, and orbit/FPS camera mode. FPS mode uses pointer-lock mouse look plus WASD movement with Q/E or Space/Shift for vertical movement.
- Camera shots: save and restore three quick camera compositions from the Camera panel.
- Quality presets: Draft, Preview, and Final quickly adjust bounces, rays per pixel, temporal blending, and denoising.
- `Frame Blend` and `Denoiser`: smooth temporal noise.
- `Bloom`, `Glare`, and color controls: tune the final image.
- `Output`: shows the active renderer backend, separates canvas/stage size, render resolution, and UI canvas size, derives the default 1x render target from the canvas stage aspect, keeps render scale as a slider with separate Fractional HQ and Pixel Perfect modes, keeps exact 256/512/1024 buttons, accepts arbitrary custom width and height values, fits the UI canvas to the render aspect ratio, opens fullscreen, and saves the current canvas as PNG. Applying a render-size change reloads the page so the WebGL target and related framebuffers are recreated cleanly.
- Fullscreen panels: turn on `Fullscreen Panels` from the View menu or top-menu quick actions before entering fullscreen to keep the menu bar, floating panels, and benchmark visible over the canvas.
- Shortcuts: `Ctrl+1` opens the scene-tree add popover, `Ctrl+2` through `Ctrl+6` open the matching inspector accordion sections, `Ctrl+N` starts a new scene, `1`/`2`/`3` apply Draft/Preview/Final quality, `C` toggles camera auto-rotate, `P` pauses frames, `K` pauses rays at convergence, `F` toggles canvas fullscreen, `I` toggles the inspector, `T` toggles the scene tree, `B` toggles benchmark, `L` selects the light, and `Ctrl+S` saves PNG.

Click objects in the canvas to select and move them.

The benchmark score is a 60-second rolling active-rays-per-second score, rounded to reduce jitter. The benchmark source labels the active backend, such as WebGL GPU timer or WebGL frame estimate. The benchmark panel tracks score, active rays/s, estimated ray memory bandwidth, perceptual FPS, render resolution, bounces, accumulated samples, convergence, estimated GPU buffer memory, and scene complexity. It can share the current score as a `#result=` URL, save an 800 x 400 score-card PNG, run the full sequence with configurable warm-up and measurement windows, then show min/max/median/P5/P95 scene summaries, copy stable JSON results, and save a local baseline that flags median-score drops of more than 10 percent on later runs. Shared result URLs hydrate the benchmark summary on page load.

If startup fails, the loading overlay remains visible and shows the startup error message plus stack/details in a scrollable panel. Use the copy button in that panel when reporting WebGL, shader-compile, or browser-support failures.

Current backend status: WebGL is the active renderer. The app detects whether WebGPU is available and shows it in the Output panel, but WebGPU rendering is still planned.

Implementation decisions from the TODO audit are tracked in `docs/workstream-decisions.md`.

## Running Locally

Install dependencies:

```sh
npm install
```

Build the Tailwind CSS used by the UI:

```sh
npm run build:css
```

Run the Electron app:

```sh
npm start
```

The static web version can also be served from the repo root or from `/docs`.

## GitHub Pages

This repo includes a `/docs` directory for GitHub Pages. Configure Pages to deploy from the `main` branch and `/docs` folder.

After GitHub Pages is enabled, the site should be available at:

```text
https://monstercameron.github.io/pathtracer/
```

## Notes

This is a browser GPU benchmark-style toy, not a production renderer. Performance depends heavily on the browser, graphics driver, and whether the page gets a real hardware WebGL context instead of a software fallback.
