import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { uiLogger } from '../../logger.js';
import {
  denoiserStrength,
  environment,
  fogDensity,
  isCameraAutoRotating,
  isConvergencePauseEnabled,
  isFramePaused,
  isLightIntensityCycling,
  lightColor,
  lightBounceCount,
  lightIntensity,
  lightPosition,
  lightSize,
  raysPerPixel,
  setEnvironment,
  setLightColor,
  setLightPosition,
  skyBrightness,
  temporalBlendFrames
} from '../../store.js';
import { SliderField } from '../SliderField.js';
import { ColorField, NumberInputGroup, SelectField } from '../controls/EditorFields.js';

const fixed2 = (value) => Number(value).toFixed(2);
const toHexByte = (value) => {
  const normalizedValue = Math.max(0, Math.min(1, Number(value)));
  return Math.round(normalizedValue * 255).toString(16).padStart(2, '0');
};
const formatLightColor = (value) => `#${toHexByte(value[0])}${toHexByte(value[1])}${toHexByte(value[2])}`;
const readLightPositionAxis = (axisIndex) => {
  const value = Number(lightPosition.value[axisIndex]);
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
};
const updateLightPositionAxis = (axisIndex, rawValue) => {
  const nextValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(nextValue)) {
    return;
  }
  const nextPosition = [...lightPosition.value];
  nextPosition[axisIndex] = nextValue;
  setLightPosition(nextPosition);
};
const readLightColor = (rawValue) => {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(rawValue));
  return match
    ? [
        Number.parseInt(match[1], 16) / 255,
        Number.parseInt(match[2], 16) / 255,
        Number.parseInt(match[3], 16) / 255
      ]
    : lightColor.value;
};

export const ENVIRONMENT_OPTIONS = Object.freeze([
  { value: 0, label: 'Cornell Box - Yellow and Blue' },
  { value: 1, label: 'Cornell Box - Red and Green' },
  { value: 2, label: 'Open Studio Sky' }
]);

export function RenderPanel({ id = 'render-panel' }) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'RenderPanel' });
  }, [id]);

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section">
        <${SelectField}
          id="environment"
          label="Environment"
          value=${environment.value}
          options=${ENVIRONMENT_OPTIONS}
          onChange=${(event) => setEnvironment(Number.parseInt(event.currentTarget.value, 10))}
        />
      </div>

      <div className="control-section render-state-controls">
        <div className="section-title">Render state</div>
        <button id="camera-playback" className="camera-playback" type="button" data-action="toggle-camera-playback" aria-pressed=${String(isCameraAutoRotating.value)}>
          ${isCameraAutoRotating.value ? 'Pause Camera' : 'Play Camera'}
        </button>
        <button id="frame-pause" className="render-pause-toggle" type="button" data-action="toggle-frame-pause" aria-pressed=${String(isFramePaused.value)}>
          ${isFramePaused.value ? 'Resume Frames' : 'Pause Frames'}
        </button>
        <button id="convergence-pause" className="render-pause-toggle" type="button" data-action="toggle-convergence-pause" aria-pressed=${String(isConvergencePauseEnabled.value)}>
          Pause Rays at Converged
        </button>
      </div>

      <div className="control-section render-settings">
        <div className="section-title">Quality preset</div>
        <div className="button-row">
          <button type="button" data-quality-preset="draft">Draft</button>
          <button type="button" data-quality-preset="preview">Preview</button>
          <button type="button" data-quality-preset="final">Final</button>
        </div>

        <${SliderField} id="light-bounces" label="Light bounces" min=${1} max=${12} step=${1} signal=${lightBounceCount} />
        <${NumberInputGroup}
          label="Light position"
          inputs=${[
            { id: 'light-position-x', min: '-1', max: '1', step: '0.05', value: readLightPositionAxis(0), ariaLabel: 'Light X position', onInput: (event) => updateLightPositionAxis(0, event.currentTarget.value) },
            { id: 'light-position-y', min: '-1', max: '1', step: '0.05', value: readLightPositionAxis(1), ariaLabel: 'Light Y position', onInput: (event) => updateLightPositionAxis(1, event.currentTarget.value) },
            { id: 'light-position-z', min: '-1', max: '1', step: '0.05', value: readLightPositionAxis(2), ariaLabel: 'Light Z position', onInput: (event) => updateLightPositionAxis(2, event.currentTarget.value) }
          ]}
        />
        <${SliderField} id="light-intensity" label="Light brightness" min=${0.1} max=${1} step=${0.01} signal=${lightIntensity} formatter=${fixed2} />
        <button id="light-cycle" className="light-cycle-toggle" type="button" data-action="toggle-light-cycle" aria-pressed=${String(isLightIntensityCycling.value)}>Cycle Light</button>
        <${SliderField} id="light-size" label="Light size" min=${0.02} max=${0.5} step=${0.01} signal=${lightSize} formatter=${fixed2} />
        <${ColorField}
          id="light-color"
          label="Light color"
          value=${formatLightColor(lightColor.value)}
          onInput=${(event) => setLightColor(readLightColor(event.currentTarget.value))}
        />
        <${SliderField} id="fog-density" label="Fog density" min=${0} max=${2} step=${0.05} signal=${fogDensity} formatter=${fixed2} />
        <${SliderField} id="sky-brightness" label="Sky brightness" min=${0.1} max=${5} step=${0.05} signal=${skyBrightness} formatter=${fixed2} />
        <${SliderField} id="rays-per-pixel" label="Rays per pixel" min=${1} max=${64} step=${1} signal=${raysPerPixel} />
        <${SliderField} id="temporal-blend-frames" label="Temporal AA" min=${1} max=${32} step=${1} signal=${temporalBlendFrames} />
        <${SliderField} id="denoiser-strength" label="Denoiser" min=${0} max=${1} step=${0.05} signal=${denoiserStrength} formatter=${fixed2} />
      </div>
    </div>
  `;
}
