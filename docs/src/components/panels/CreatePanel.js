import { html } from 'htm/preact';
import {
  isCameraAutoRotating,
  isConvergencePauseEnabled,
  isFramePaused
} from '../../store.js';

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
  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <button id="camera-playback" className="camera-playback" type="button" data-action="toggle-camera-playback" aria-pressed=${String(isCameraAutoRotating.value)}>
        ${isCameraAutoRotating.value ? 'Pause Camera' : 'Play Camera'}
      </button>
      <button id="frame-pause" className="render-pause-toggle" type="button" data-action="toggle-frame-pause" aria-pressed=${String(isFramePaused.value)}>
        ${isFramePaused.value ? 'Resume Frames' : 'Pause Frames'}
      </button>
      <button id="convergence-pause" className="render-pause-toggle" type="button" data-action="toggle-convergence-pause" aria-pressed=${String(isConvergencePauseEnabled.value)}>
        Pause Rays at Converged
      </button>

      <div className="control-section primitive-actions">
        <div className="section-title">Add primitive</div>
        ${PRIMITIVE_ACTIONS.map((item) => html`
          <button key=${item.action} className=${item.className} type="button" data-action=${item.action}>${item.label}</button>
        `)}
      </div>
    </div>
  `;
}
