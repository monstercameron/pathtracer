import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { uiLogger } from '../../logger.js';

export const PRIMITIVE_ACTIONS = Object.freeze([
  { action: 'add-sphere', label: 'Sphere' },
  { action: 'add-cube', label: 'Cube' },
  { action: 'add-cylinder', label: 'Cylinder' },
  { action: 'add-cone', label: 'Cone' },
  { action: 'add-frustum', label: 'Frustum' },
  { action: 'add-capsule', label: 'Capsule' },
  { action: 'add-ellipsoid', label: 'Ellipsoid' },
  { action: 'add-torus', label: 'Torus' },
  { action: 'add-rounded-box', label: 'Rounded Box' },
  { action: 'add-plane', label: 'Plane' },
  { action: 'add-disk', label: 'Disk' },
  { action: 'add-triangle', label: 'Triangle' },
  { action: 'add-wedge', label: 'Wedge' },
  { action: 'add-prism', label: 'Prism' },
  { action: 'add-metaballs', label: 'Metaballs' },
  { action: 'add-csg-shape', label: 'CSG Shape' },
  { action: 'add-mandelbulb', label: 'Mandelbulb' },
  { action: 'add-sdf-fractal', label: 'SDF Fractal' },
  { action: 'add-area-light', label: 'Area Light', className: 'wide-control' }
]);

export function CreatePanel({ id = 'scene-panel' }) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'CreatePanel', actionCount: PRIMITIVE_ACTIONS.length });
  }, [id]);

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section primitive-actions">
        <div className="section-title">Add primitive</div>
        ${PRIMITIVE_ACTIONS.map((item) => html`
          <button key=${item.action} className=${item.className} type="button" data-action=${item.action}>${item.label}</button>
        `)}
      </div>
    </div>
  `;
}
