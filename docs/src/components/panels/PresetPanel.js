import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { uiLogger } from '../../logger.js';

export const PRESET_SCENE_BUTTONS = Object.freeze([
  { preset: 'sphereColumn', label: 'Sphere Column' },
  { preset: 'spherePyramid', label: 'Sphere Pyramid' },
  { preset: 'sphereAndCube', label: 'Sphere and Cube' },
  { preset: 'cubeAndSpheres', label: 'Cube and Spheres' },
  { preset: 'tableAndChair', label: 'Table and Chair' },
  { preset: 'stacks', label: 'Stacks' },
  { preset: 'shaderShowcase', label: 'Shader Showcase' },
  { preset: 'recursiveSpheres', label: 'Recursive Spheres' },
  { preset: 'primitiveShowcase', label: 'Primitive Showcase' },
  { preset: 'curvedPrimitiveShowcase', label: 'Curved Primitives' },
  { preset: 'flatPrimitiveShowcase', label: 'Flat Primitives' },
  { preset: 'implicitPrimitiveShowcase', label: 'Implicit Primitives' },
  { preset: 'areaLightShowcase', label: 'Area Light Studio' }
]);

export const BENCHMARK_SCENE_BUTTONS = Object.freeze([
  { benchmarkScene: 'default', label: 'Standard Benchmark' },
  { benchmarkScene: 'benchmarkShaderGauntlet', label: 'Shader Gauntlet' },
  { benchmarkScene: 'benchmarkPhysicsChaos', label: 'Physics Chaos' },
  { benchmarkScene: 'benchmarkSdfComplexity', label: 'SDF Complexity' },
  { benchmarkScene: 'benchmarkCausticPool', label: 'Caustic Pool' },
  { benchmarkScene: 'benchmarkMotionBlurStress', label: 'Motion Blur Stress' },
  { benchmarkScene: 'benchmarkVolumetricFog', label: 'Volumetric Fog Flythrough' }
]);

export const DEMO_SCENE_BUTTONS = Object.freeze([
  { preset: 'corridorOfLight', label: 'Corridor of Light' },
  { preset: 'corridorOfLightGlassSphere', label: 'Corridor + Glass Sphere' },
  { preset: 'corridorOfLightMirrorCube', label: 'Corridor + Mirror Cube' },
  { preset: 'depthOfFieldPortrait', label: 'Depth-of-Field Portrait' },
  { preset: 'shadowStudy', label: 'Shadow Study' },
  { preset: 'mirrorRoom', label: 'Mirror Room' },
  { preset: 'skySphere', label: 'Sky Sphere' },
  { preset: 'fogCorridor', label: 'Fog Corridor' },
  { preset: 'materialGrid', label: 'Material Grid' },
  { preset: 'neonRoom', label: 'Neon Room' }
]);

export function PresetPanel({ id = 'preset-panel' }) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', {
      panelId: id,
      panelName: 'PresetPanel',
      presetCount: PRESET_SCENE_BUTTONS.length + DEMO_SCENE_BUTTONS.length,
      benchmarkSceneCount: BENCHMARK_SCENE_BUTTONS.length
    });
  }, [id]);

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section presets">
        <div className="section-title">Load preset scene</div>
        ${PRESET_SCENE_BUTTONS.map((item) => html`
          <button key=${item.preset} type="button" data-preset=${item.preset}>${item.label}</button>
        `)}
        <div className="section-title">Benchmark scenes</div>
        ${BENCHMARK_SCENE_BUTTONS.map((item) => html`
          <button key=${item.benchmarkScene} type="button" data-benchmark-scene=${item.benchmarkScene}>${item.label}</button>
        `)}
        <div className="section-title">Demo scenes</div>
        ${DEMO_SCENE_BUTTONS.map((item) => html`
          <button key=${item.preset} type="button" data-preset=${item.preset}>${item.label}</button>
        `)}
        <button className="reset-all" type="button" data-action="reset-all">Reset All</button>
      </div>
    </div>
  `;
}
