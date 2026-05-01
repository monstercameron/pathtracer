import { html } from 'htm/preact';
import {
  denoiserStrength,
  environment,
  fogDensity,
  isLightIntensityCycling,
  lightColor,
  lightBounceCount,
  lightIntensity,
  lightSize,
  raysPerPixel,
  setEnvironment,
  setLightColor,
  skyBrightness,
  temporalBlendFrames
} from '../../store.js';
import { SliderField } from '../SliderField.js';

const fixed2 = (value) => Number(value).toFixed(2);
const toHexByte = (value) => {
  const normalizedValue = Math.max(0, Math.min(1, Number(value)));
  return Math.round(normalizedValue * 255).toString(16).padStart(2, '0');
};
const formatLightColor = (value) => `#${toHexByte(value[0])}${toHexByte(value[1])}${toHexByte(value[2])}`;
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
  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section">
        <div className="field">
          <label for="environment">Environment</label>
          <select id="environment" value=${environment.value} onChange=${(event) => setEnvironment(Number.parseInt(event.currentTarget.value, 10))}>
            ${ENVIRONMENT_OPTIONS.map((option) => html`
              <option key=${option.value} value=${option.value}>${option.label}</option>
            `)}
          </select>
        </div>
      </div>

      <div className="control-section render-settings">
        <div className="section-title">Quality preset</div>
        <div className="button-row">
          <button type="button" data-quality-preset="draft">Draft</button>
          <button type="button" data-quality-preset="preview">Preview</button>
          <button type="button" data-quality-preset="final">Final</button>
        </div>

        <${SliderField} id="light-bounces" label="Light bounces" min=${1} max=${12} step=${1} signal=${lightBounceCount} />
        <${SliderField} id="light-intensity" label="Light intensity" min=${0} max=${5} step=${0.05} signal=${lightIntensity} formatter=${fixed2} />
        <button id="light-cycle" className="light-cycle-toggle" type="button" data-action="toggle-light-cycle" aria-pressed=${String(isLightIntensityCycling.value)}>Cycle Light</button>
        <${SliderField} id="light-size" label="Light size" min=${0.02} max=${0.5} step=${0.01} signal=${lightSize} formatter=${fixed2} />
        <div className="field">
          <label for="light-color">Light color</label>
          <input
            id="light-color"
            type="color"
            value=${formatLightColor(lightColor.value)}
            aria-label="Light color"
            onInput=${(event) => setLightColor(readLightColor(event.currentTarget.value))}
          />
        </div>
        <${SliderField} id="fog-density" label="Fog density" min=${0} max=${2} step=${0.05} signal=${fogDensity} formatter=${fixed2} />
        <${SliderField} id="sky-brightness" label="Sky brightness" min=${0.1} max=${5} step=${0.05} signal=${skyBrightness} formatter=${fixed2} />
        <${SliderField} id="rays-per-pixel" label="Rays per pixel" min=${1} max=${64} step=${1} signal=${raysPerPixel} />
        <${SliderField} id="temporal-blend-frames" label="Temporal AA" min=${1} max=${32} step=${1} signal=${temporalBlendFrames} />
        <${SliderField} id="denoiser-strength" label="Denoiser" min=${0} max=${1} step=${0.05} signal=${denoiserStrength} formatter=${fixed2} />
      </div>
    </div>
  `;
}
