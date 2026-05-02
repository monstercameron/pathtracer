# Model Assets

This directory contains canonical mesh-import reference assets with source and license notes kept beside the files.

## Suzanne

Bundled files:

- `suzanne.obj`: Blender Suzanne converted from the Khronos glTF Sample Assets `Models/Suzanne` sample.
- `suzanne_low.obj`: a 196-triangle vertex-clustered variant generated from the same source for lower-cost importer testing.
- `suzanne.LICENSE.md`: upstream Khronos license metadata.

Source:

- Khronos glTF Sample Assets `Models/Suzanne`: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Suzanne.

License:

- Model files are listed by Khronos as CC0-1.0.
- Upstream metadocumentation is CC-BY-4.0.

Generation:

- Run `node scripts/prepare-reference-model-assets.mjs` from the repository root to regenerate the OBJ files from the Khronos glTF source.
- The full OBJ currently contains 3,936 triangles. The low OBJ currently contains 196 triangles.
- The `Suzanne Reference Mesh` scene preset uses generated `src/referenceModelData.js` data from `suzanne_low.obj` so the current WebGL shader path can render a recognizable mesh while the full BVH-backed mesh path remains in progress.

## Sponza

Bundled files:

- `sponza/sponza.glb`: a self-contained GLB packed from the Khronos glTF Sample Assets `Models/Sponza/glTF` asset and its external buffer and texture files.
- `sponza/LICENSE.md`: upstream Khronos license metadata.
- `sponza/README.upstream.md`: upstream Khronos model README and attribution notes.

Source:

- Khronos glTF Sample Assets `Models/Sponza`: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Sponza.
- Intel GPU Research Samples lists a separate 3.71 GB "Sponza Base Scene" package under Creative Commons Attribution with 3ds Max, USD, GLTF, and FBX formats: https://www.intel.com/content/www/us/en/developer/topic-technology/graphics-research/samples.html.

License:

- Khronos lists the bundled Sponza model files under the Cryengine Limited License Agreement, SPDX `LicenseRef-CRYENGINE-Agreement`.
- Khronos lists the Sponza metadocumentation as CC-BY-4.0.
- This is not the Intel CC-BY package. The smaller Khronos/Crytek sample is bundled because it is available directly from the Khronos sample asset repository and can be packed into a practical single GLB for this project.

Generation:

- Run `node scripts/prepare-reference-model-assets.mjs` from the repository root to regenerate `sponza/sponza.glb`.
- The active `benchmarkSponzaAtrium` scene is still a deterministic WebGL primitive atrium until the mesh/BVH/texture-atlas renderer path can consume the bundled GLB directly. The benchmark metadata records this GLB's asset path and triangle count as the reference target.
