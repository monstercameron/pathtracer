import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { uiLogger } from '../../logger.js';
import {
  cameraAperture,
  cameraFieldOfViewDegrees,
  cameraFocusDistance,
  isPickingFocus,
  motionBlurStrength
} from '../../store.js';
import { SliderField } from '../SliderField.js';

const fixed2 = (value) => Number(value).toFixed(2);

export function CameraPanel({ id = 'camera-panel' }) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'CameraPanel' });
  }, [id]);

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section camera-settings">
        <div className="section-title">Camera effects</div>
        <div className="button-row">
          <button type="button" data-camera-shot-save="0">Save A</button>
          <button type="button" data-camera-shot-save="1">Save B</button>
          <button type="button" data-camera-shot-save="2">Save C</button>
          <button type="button" data-camera-shot-load="0">Shot A</button>
          <button type="button" data-camera-shot-load="1">Shot B</button>
          <button type="button" data-camera-shot-load="2">Shot C</button>
        </div>

        <${SliderField} id="camera-fov" label="FOV" min=${35} max=${85} step=${1} signal=${cameraFieldOfViewDegrees} unit="deg" />
        <${SliderField} id="camera-focus-distance" label="Focus distance" min=${0.5} max=${6} step=${0.1} signal=${cameraFocusDistance} formatter=${fixed2} />
        <button id="focus-pick" className="focus-pick-toggle" type="button" data-action="toggle-focus-pick" aria-pressed=${String(isPickingFocus.value)}>Pick Focus</button>
        <${SliderField} id="camera-aperture" label="Aperture" min=${0} max=${0.2} step=${0.01} signal=${cameraAperture} formatter=${fixed2} />
        <${SliderField} id="motion-blur" label="Motion blur" min=${0} max=${0.95} step=${0.05} signal=${motionBlurStrength} formatter=${fixed2} />
      </div>
    </div>
  `;
}
