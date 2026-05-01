import { html } from 'htm/preact';

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

export function PresetPanel({ id = 'preset-panel' }) {
  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section presets">
        <div className="section-title">Load preset scene</div>
        ${PRESET_SCENE_BUTTONS.map((item) => html`
          <button key=${item.preset} type="button" data-preset=${item.preset}>${item.label}</button>
        `)}
        <button className="reset-all" type="button" data-action="reset-all">Reset All</button>
      </div>
    </div>
  `;
}
