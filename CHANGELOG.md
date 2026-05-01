# Changelog

Changes are grouped by commit date, newest first. Each bullet represents one commit.

## 2026-05-01

- This commit - Complete the editor UI and rendering control pass:
  - Add extended scene primitives, SDF shapes, visible area lights, and primitive showcase presets.
  - Keep new primitive materials aligned with the current object material instead of forcing special shader materials.
  - Add frame pause and convergence pause behavior with benchmark metrics that report paused states accurately.
  - Add render resolution presets, custom square render size, fitted supersampled canvas display, canvas fullscreen, and PNG export.
  - Add Tailwind CSS build tooling and generated root/docs CSS output.
  - Complete Workstream 5 with a full-screen render stage, File/Edit/View/Create/Render/Help menu bar, floating scene tree, floating inspector, floating benchmark panel, keyboard shortcuts, and persisted panel layout.
  - Update README and TODO tracking for the new workflow.
  - Update Rapier initialization to the current object-form API.

## 2026-04-30

- `f021c18` - Optimize sphere shadow tests.
- `059ad6b` - Reuse ray length for sphere tests.
- `69e94b9` - Reuse inverse ray for cube tests.
- `b0094e2` - Simplify sphere intersection math.
- `725a868` - Avoid unused surface point math.
- `74c97fb` - Throttle benchmark frame snapshots.
- `f754339` - Gate direct light normalization.
- `0187538` - Tighten temporal filter sampling.
- `7a8b300` - Prefer half float render textures.
- `b31fe00` - Skip empty direct-light shadow rays.
- `6dacc01` - Reduce per-sample light jitter cost.
- `e0cf939` - Request lean WebGL backbuffer.
- `def4dc0` - Gate scene uniform uploads by dirty state.
- `d3bef1f` - Precompute ray jitter sequence.
- `f05a004` - Bypass settled temporal display pass.
- `9e02bfb` - Reuse GPU benchmark timer queries.
- `ee3cb43` - Throttle GPU benchmark timer queries.
- `5cd1d49` - Reduce benchmark and physics frame overhead.
- `7ebacc1` - Optimize shader and render hot paths.
- `1536749` - Add per-object benchmark shader modes.

## 2026-04-29

- `1279ab1` - Update sample slider max attributes.
- `97714a4` - Raise interactive path tracing sample caps.
- `a9f9691` - Add ray memory bandwidth benchmark metric.
- `7208b64` - Stabilize comparable benchmark score.
- `986d082` - Add reset all defaults.
- `547c13e` - Normalize benchmark score by throughput.
- `bf4c7dd` - Weight stable benchmark score by workload.
- `ef0f63b` - Stabilize benchmark scoring.
- `e88ba1f` - Add benchmark framerate and score.
- `55bfd6f` - Add live demo link to README.
- `72b4133` - Add GPU rays benchmark panel.
- `a2dab4e` - Expand README guide.
- `4fde7bb` - Set up GitHub Pages docs.
- `5ff7bca` - Fix BestBuys typo.
- `3c6c6ed` - Add README attribution.
- `40d35a7` - Initial path tracer demo.
