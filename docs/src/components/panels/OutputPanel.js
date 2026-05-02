import { html } from 'htm/preact';
import {
  renderHeight,
  renderScale,
  renderWidth,
  setRenderHeight,
  setRenderScale,
  setRenderWidth
} from '../../store.js';
import { SliderField } from '../SliderField.js';
import { NumberInputGroup, SelectField } from '../controls/EditorFields.js';

const formatScale = (value) => `${Number(value).toFixed(2).replace(/\.?0+$/, '')}x`;

const RENDER_BACKEND_OPTIONS = Object.freeze([
  { value: 'webgl', label: 'WebGL', selected: true },
  { value: 'webgpu', label: 'WebGPU unavailable', disabled: true }
]);
const RENDER_SCALE_MODE_OPTIONS = Object.freeze([
  { value: 'fractional', label: 'Fractional HQ', selected: true },
  { value: 'pixel-perfect', label: 'Pixel Perfect' }
]);
const RENDER_RESOLUTION_OPTIONS = Object.freeze([
  { value: '256', label: '256 x 256' },
  { value: '384', label: '384 x 384' },
  { value: '512', label: '512 x 512', selected: true },
  { value: '768', label: '768 x 768' },
  { value: '1024', label: '1024 x 1024' },
  { value: 'custom', label: 'Custom width x height' }
]);
const RENDER_SCALE_FRACTIONAL_OPTIONS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
const RENDER_SCALE_PIXEL_PERFECT_OPTIONS = Object.freeze([1, 4, 6, 8]);

const readNumberInputValue = (event, fallback) => {
  const nextValue = Number.parseFloat(event.currentTarget.value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
};

export function OutputPanel({ id = 'output-panel' }) {
  const currentRenderWidth = renderWidth.value;
  const currentRenderHeight = renderHeight.value;
  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section">
        <div className="section-title">Resolution / Export</div>
        <${SelectField}
          id="renderer-backend"
          label="Renderer backend"
          options=${RENDER_BACKEND_OPTIONS}
        >
          <div id="renderer-backend-status" className="export-status" role="status" aria-live="polite">WebGL active</div>
        </${SelectField}>
        <${SelectField}
          id="render-scale-mode"
          label="Scale Mode"
          options=${RENDER_SCALE_MODE_OPTIONS}
        />
        <${SliderField}
          id="render-scale"
          label="Render Scale"
          min=${0.25}
          max=${3}
          step=${0.25}
          value=${renderScale.value}
          formatter=${formatScale}
          list="render-scale-fractional-ticks"
          onInput=${(value, event) => setRenderScale(readNumberInputValue(event, 1))}
        >
          <datalist id="render-scale-fractional-ticks">
            ${RENDER_SCALE_FRACTIONAL_OPTIONS.map((scale) => html`
              <option key=${scale} value=${scale}></option>
            `)}
          </datalist>
          <datalist id="render-scale-pixel-perfect-ticks">
            ${RENDER_SCALE_PIXEL_PERFECT_OPTIONS.map((scale) => html`
              <option key=${scale} value=${scale}></option>
            `)}
          </datalist>
          <div id="render-scale-resolution" className="export-status" role="status" aria-live="polite">${currentRenderWidth} x ${currentRenderHeight} render target</div>
        </${SliderField}>
        <${SelectField}
          id="resolution-preset"
          label="Exact render size"
          options=${RENDER_RESOLUTION_OPTIONS}
        />
        <div className="button-row">
          <button type="button" data-resolution-preset="256">256</button>
          <button type="button" data-resolution-preset="512">512</button>
          <button type="button" data-resolution-preset="1024">1024</button>
        </div>
        <${NumberInputGroup}
          labelFor="custom-render-width"
          label="Custom render resolution"
          className="resolution-pair"
          inputs=${[
            { id: 'custom-render-width', min: '1', max: '8192', step: '1', value: currentRenderWidth, ariaLabel: 'Custom render width', onInput: (event) => setRenderWidth(readNumberInputValue(event, currentRenderWidth)) },
            { id: 'custom-render-height', min: '1', max: '8192', step: '1', value: currentRenderHeight, ariaLabel: 'Custom render height', onInput: (event) => setRenderHeight(readNumberInputValue(event, currentRenderHeight)) }
          ]}
        >
          <div id="ui-canvas-resolution" className="export-status" role="status" aria-live="polite">Canvas: page size - UI: render aspect</div>
        </${NumberInputGroup}>
        <div className="button-row two-up">
          <button type="button" data-action="apply-resolution">Apply Size</button>
          <button type="button" data-action="toggle-canvas-fullscreen">Fullscreen</button>
        </div>
        <button type="button" data-action="save-bitmap">Save PNG</button>
        <div id="export-status" className="export-status" role="status" aria-live="polite">Canvas-sized render target</div>
      </div>
    </div>
  `;
}
