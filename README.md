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
- Add spheres and cubes to the scene.
- Let Rapier physics move the spheres.
- Change light bounces, rays per pixel, light size, light intensity, fog, bloom, glare, and denoising.
- Toggle camera rotation.
- Load preset scenes.
- Use the open-sky environment instead of a closed Cornell box.

## How To Use It

Open the page and let the image settle for a few seconds. Higher rays per pixel and more light bounces improve quality but cost more GPU time.

Useful controls:

- `Pause Camera` / `Play Camera`: starts or stops the slow camera orbit.
- `Add Sphere` / `Add Cube`: adds objects to the scene.
- `Select Light`: selects the light so it can be moved.
- `Material`: changes the material used for scene objects.
- `Environment`: switches between Cornell boxes and the open-sky scene.
- `Light Bounces`: controls path depth.
- `Rays Per Pixel`: controls samples per frame.
- `Frame Blend` and `Denoiser`: smooth temporal noise.
- `Bloom`, `Glare`, and color controls: tune the final image.

Click objects in the canvas to select and move them.

The benchmark score is a 60-second rolling active-rays-per-second score, rounded to reduce jitter. To compare graphics performance across computers, use the same scene and settings on each machine.

## Running Locally

Install dependencies:

```sh
npm install
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
