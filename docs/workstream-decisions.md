# Workstream Decisions

These notes capture decisions made during the 2026-05-01 TODO audit. They are intentionally narrow so the TODO list can distinguish completed decisions from larger architecture work.

## Scene Documents

Scene files should use a versioned JSON document first. The initial shape should store app render settings, camera settings, lights, primitive items, materials, and per-item transform/settings payloads. Imported assets should reference external files by relative path instead of embedding binary content.

The current scene objects already have stable runtime IDs and display names, but they are not yet ECS entities. The ECS conversion remains a larger architecture task.

## Imported Assets

The first external model format should be glTF 2.0 binary files (`.glb`). It gives the project one container for meshes, materials, textures, hierarchy, pivots, named nodes, and animation clips.

Imported material mapping should begin with:

- Base color or texture to diffuse albedo.
- Metallic/roughness reduced into the closest current material mode until the shader model supports full PBR.
- Alpha treated as opaque at first unless a later pass adds transmissive or masked materials.
- Missing textures replaced by a neutral checker or flat fallback so imports remain visible.

Animated imported models should be treated as editor animation state, not Rapier-driven dynamic bodies, until ECS physics components exist. Benchmark mode should freeze imported animation unless the benchmark explicitly includes animation.

## Renderer Backends

WebGL is the active renderer. WebGPU support should begin as a separate MVP renderer after a renderer abstraction exists. Runtime backend switching should require a renderer restart/rebuild at first; live hot-swapping can be revisited once both backends share a stable scene/material interface.

Both backends should eventually share camera, scene, material, benchmark, and editor state. WebGPU-only features are acceptable for early experiments if the UI labels them clearly and WebGL remains the fallback.

## Canvas Export

`preserveDrawingBuffer` remains enabled for now because PNG export reads the live canvas. Export now renders one clean frame without the selection outline before calling `toBlob`, but disabling `preserveDrawingBuffer` should wait until export renders into a dedicated offscreen target or performs an explicit final readback.
