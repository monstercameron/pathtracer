# WebGL Path Tracing

Welcome. This is a modernized WebGL path tracing tech demo with interactive scene controls, Rapier-powered sphere and cube physics, temporal anti-aliasing, bloom/glare, fog, glass materials, and an optional open-sky environment.

Live demo:
https://monstercameron.github.io/pathtracer/

The project is forked from Evan Wallace's original WebGL path tracing demo:
https://madebyevan.com/webgl-path-tracing/

I am probably 90% of the traffic to that site from BestBuys, since I use it as a benchmark of sorts.

## What It Does

This demo renders a small path-traced scene directly in the browser. It progressively refines the image over time, so the picture starts noisy and settles as more rays accumulate.

You can:

- Switch between diffuse, mirror, glossy, and glass materials.
- Add spheres, cubes, and extended primitives to the scene.
- Let Rapier physics move eligible sphere and cube scene items.
- Change FOV, depth of field, light bounces, rays per pixel, light size, light intensity, fog, bloom, glare, and denoising.
- Use the File/Edit/View/Create/Scene/Render/Help menu bar to run commands, load scenes, and open floating panels.
- Use top-menu quick actions for one-click scene presets, common primitives, panels, benchmark, fullscreen, pause, and PNG actions.
- Rename, duplicate, hide, lock, and position selected scene items from the inspector.
- Change render scale or exact render dimensions, keep the visible canvas fitted to the page, use fullscreen, and export a clean PNG without the editor selection outline.
- Move, collapse, close, and reopen the floating inspector, scene tree, and benchmark panels.
- Toggle camera rotation.
- Load preset scenes.
- Use the open-sky environment instead of a closed Cornell box.

Supported extended geometry includes cylinders, cones/frustums, capsules, ellipsoids, toruses, rounded boxes, disks/planes, triangles/wedges/prisms, metaballs, CSG shapes, Mandelbulb/SDF fractals, and visible area light geometry.

The asset-loader scaffold in `src/loaders` can parse OBJ/MTL, STL, and PLY files into flat triangle data for the upcoming mesh scene-object path. OBJ helpers are exposed as `loadObjFromText()` and `loadObjFromUrl()`.

## How To Use It

Open the page and let the image settle for a few seconds. Higher rays per pixel and more light bounces improve quality but cost more GPU time.

Useful controls:

- Menu bar: uses File/Edit/View/Create/Scene/Render/Help menus for global commands, creation, scene loading, render controls, panel visibility, benchmark scenes, and export.
- Top-menu quick actions: mirrors the most-used scene, primitive, panel, benchmark, fullscreen, pause, and export actions with compact icon buttons and hover labels.
- Floating panels: move, collapse, close, and reopen the scene tree, accordion inspector, and benchmark windows; panel layout is restored in the browser.
- Scene tree: mirrors the active scene, exposes all creation actions and settings panels, and stays synced with canvas selection and the selected-object inspector.
- Object: rename, duplicate, hide/show, lock/unlock, and edit the selected item's position numerically.
- `Pause Camera` / `Play Camera`: starts or stops the slow camera orbit.
- `Pause Frames`: freezes the render loop without adding new frames.
- `Pause Rays at Converged`: keeps rendering until the current scene reaches the convergence sample target, then stops adding new rays.
- `Create` / `Add primitive`: exposes every primitive directly, including spheres, cubes, curved SDF shapes, flat primitives, implicit shapes, fractals, and visible area light panels.
- `Scene`: loads preset scenes and fixed benchmark scenes, including the standard benchmark, shader gauntlet, physics chaos, SDF complexity, caustic pool, motion blur stress, and volumetric fog flythrough; `Run Benchmark Sequence` measures every registered benchmark scene in order.
- `Object`: shows the current selection, selects the light, deletes the selected item, and applies object shaders.
- `Material`: changes the material used for new scene objects, including diffuse, mirror, glass, PBR, spectral, thin-film, retroreflective, velvet, Voronoi, and diffraction-style surfaces.
- `Environment`: switches between Cornell boxes and the open-sky scene.
- `Light`: edits position, intensity, size, and color.
- `Debug views`: switch the renderer between beauty, albedo, normals, and depth views from the View menu.
- `Light Bounces`: controls path depth.
- `Rays Per Pixel`: controls samples per frame.
- `Camera`: adjusts FOV, focus distance, aperture, and motion blur.
- Camera shots: save and restore three quick camera compositions from the Camera panel.
- Quality presets: Draft, Preview, and Final quickly adjust bounces, rays per pixel, temporal blending, and denoising.
- `Frame Blend` and `Denoiser`: smooth temporal noise.
- `Bloom`, `Glare`, and color controls: tune the final image.
- `Output`: shows the active renderer backend, previews render scale from 25% to 200% with 100% as the canvas-sized default, keeps exact 256/512/1024 buttons, accepts custom width and height, preserves the visible canvas fit for supersampling, opens fullscreen, and saves the current canvas as PNG. Applying a render-size change reloads the page so the WebGL target and related framebuffers are recreated cleanly.
- Fullscreen panels: turn on `Fullscreen Panels` from the View menu or top-menu quick actions before entering fullscreen to keep the menu bar, floating panels, and benchmark visible over the canvas.
- Shortcuts: `Ctrl+1` through `Ctrl+6` open the matching inspector accordion sections, `Ctrl+N` starts a new scene, `1`/`2`/`3` apply Draft/Preview/Final quality, `C` toggles camera auto-rotate, `P` pauses frames, `K` pauses rays at convergence, `F` toggles canvas fullscreen, `I` toggles the inspector, `T` toggles the scene tree, `B` toggles benchmark, `L` selects the light, and `Ctrl+S` saves PNG.

Click objects in the canvas to select and move them.

The benchmark score is a 60-second rolling active-rays-per-second score, rounded to reduce jitter. The benchmark source labels the active backend, such as WebGL GPU timer or WebGL frame estimate. The benchmark panel can run the full sequence with configurable warm-up and measurement windows, then show min/max/median/P5/P95 scene summaries, copy stable JSON results, and save a local baseline that flags median-score drops of more than 10 percent on later runs. To compare graphics performance across computers, use the same scene and settings on each machine.

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
