# WebGL Path Tracing

Welcome. This is a modernized WebGL path tracing tech demo with interactive scene controls, Rapier-powered sphere physics, temporal anti-aliasing, bloom/glare, fog, glass materials, and an optional open-sky environment.

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
- Let Rapier physics move the spheres.
- Change light bounces, rays per pixel, light size, light intensity, fog, bloom, glare, and denoising.
- Use the File/Edit/View/Create/Render/Help menu bar to run commands and open floating panels.
- Change square render resolution, keep the canvas fitted to the page, use fullscreen, and export the current canvas as a PNG.
- Move, collapse, close, and reopen the floating inspector, scene tree, and benchmark panels.
- Toggle camera rotation.
- Load preset scenes.
- Use the open-sky environment instead of a closed Cornell box.

Supported extended geometry includes cylinders, cones/frustums, capsules, ellipsoids, toruses, rounded boxes, disks/planes, triangles/wedges/prisms, metaballs, CSG shapes, Mandelbulb/SDF fractals, and visible area light geometry.

## How To Use It

Open the page and let the image settle for a few seconds. Higher rays per pixel and more light bounces improve quality but cost more GPU time.

Useful controls:

- Menu bar: uses File/Edit/View/Create/Render/Help menus for global commands, creation, render controls, panel visibility, presets, and export.
- Floating panels: move, collapse, close, and reopen the scene tree, inspector, and benchmark windows; panel layout is restored in the browser.
- Scene tree: mirrors the active scene and stays synced with canvas selection and the selected-object inspector.
- `Pause Camera` / `Play Camera`: starts or stops the slow camera orbit.
- `Pause Frames`: freezes the render loop without adding new frames.
- `Pause Rays at Converged`: keeps rendering until the current scene reaches the convergence sample target, then stops adding new rays.
- `Add primitive`: adds spheres, cubes, SDF primitives, and visible area light panels to the scene.
- `Object`: shows the current selection, selects the light, deletes the selected item, and applies object shaders.
- `Material`: changes the material used for new scene objects.
- `Environment`: switches between Cornell boxes and the open-sky scene.
- `Light Bounces`: controls path depth.
- `Rays Per Pixel`: controls samples per frame.
- `Frame Blend` and `Denoiser`: smooth temporal noise.
- `Bloom`, `Glare`, and color controls: tune the final image.
- `Output`: changes the internal square render size with a safe reload, keeps the visible canvas fitted to the page for supersampling, opens the canvas fullscreen, and saves the current canvas as PNG.
- Shortcuts: `Ctrl+1` through `Ctrl+6` open the inspector tabs, `P` pauses frames, `K` pauses rays at convergence, `F` toggles canvas fullscreen, `I` toggles the inspector, `T` toggles the scene tree, `B` toggles benchmark, `L` selects the light, and `Ctrl+S` saves PNG.

Click objects in the canvas to select and move them.

The benchmark score is a 60-second rolling active-rays-per-second score, rounded to reduce jitter. To compare graphics performance across computers, use the same scene and settings on each machine.

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
