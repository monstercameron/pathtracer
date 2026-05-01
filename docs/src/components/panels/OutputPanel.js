import { html } from 'htm/preact';
import {
  bloomStrength,
  bloomThreshold,
  colorBrightness,
  colorContrast,
  colorExposure,
  colorGamma,
  colorSaturation,
  glareStrength,
  renderHeight,
  renderScale,
  renderWidth,
  setRenderHeight,
  setRenderScale,
  setRenderWidth
} from '../../store.js';
import { SliderField } from '../SliderField.js';

const fixed2 = (value) => Number(value).toFixed(2);
const percent = (value) => `${Math.round(Number(value) * 100)}%`;

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
        <div className="field">
          <label for="renderer-backend">Renderer backend</label>
          <select id="renderer-backend">
            <option value="webgl" selected>WebGL</option>
            <option value="webgpu" disabled>WebGPU unavailable</option>
          </select>
          <div id="renderer-backend-status" className="export-status" role="status" aria-live="polite">WebGL active</div>
        </div>
        <div className="field slider-field">
          <label for="render-scale">
            Render Scale
            <span id="render-scale-value" className="slider-value">${percent(renderScale.value)}</span>
          </label>
          <input
            id="render-scale"
            type="range"
            min="0.25"
            max="2"
            step="0.25"
            value=${renderScale.value}
            list="render-scale-ticks"
            onInput=${(event) => setRenderScale(readNumberInputValue(event, 1))}
          />
          <datalist id="render-scale-ticks">
            <option value="0.25" label="25%"></option>
            <option value="0.5" label="50%"></option>
            <option value="1" label="100%"></option>
            <option value="1.5" label="150%"></option>
            <option value="2" label="200%"></option>
          </datalist>
          <div id="render-scale-resolution" className="export-status" role="status" aria-live="polite">${currentRenderWidth} x ${currentRenderHeight} render target</div>
        </div>
        <div className="field">
          <label for="resolution-preset">Exact render size</label>
          <select id="resolution-preset">
            <option value="256">256 x 256</option>
            <option value="384">384 x 384</option>
            <option value="512" selected>512 x 512</option>
            <option value="768">768 x 768</option>
            <option value="1024">1024 x 1024</option>
            <option value="custom">Custom width x height</option>
          </select>
        </div>
        <div className="button-row">
          <button type="button" data-resolution-preset="256">256</button>
          <button type="button" data-resolution-preset="512">512</button>
          <button type="button" data-resolution-preset="1024">1024</button>
        </div>
        <div className="field">
          <label for="custom-render-width">Custom render resolution</label>
          <div className="resolution-pair">
            <input
              id="custom-render-width"
              type="number"
              min="256"
              max="2048"
              step="1"
              value=${currentRenderWidth}
              aria-label="Custom render width"
              onInput=${(event) => setRenderWidth(readNumberInputValue(event, currentRenderWidth))}
            />
            <input
              id="custom-render-height"
              type="number"
              min="256"
              max="2048"
              step="1"
              value=${currentRenderHeight}
              aria-label="Custom render height"
              onInput=${(event) => setRenderHeight(readNumberInputValue(event, currentRenderHeight))}
            />
          </div>
          <div id="ui-canvas-resolution" className="export-status" role="status" aria-live="polite">Canvas fit: page size</div>
        </div>
        <div className="button-row two-up">
          <button type="button" data-action="apply-resolution">Apply Size</button>
          <button type="button" data-action="toggle-canvas-fullscreen">Fullscreen</button>
        </div>
        <button type="button" data-action="save-bitmap">Save PNG</button>
        <div id="export-status" className="export-status" role="status" aria-live="polite">512 x 512 square</div>
      </div>

      <div className="control-section color-settings">
        <div className="section-title">Color correction</div>
        <${SliderField} id="color-exposure" label="Exposure" min=${-4} max=${4} step=${0.25} signal=${colorExposure} formatter=${fixed2} />
        <${SliderField} id="color-brightness" label="Brightness" min=${-1} max=${1} step=${0.05} signal=${colorBrightness} formatter=${fixed2} />
        <${SliderField} id="color-contrast" label="Contrast" min=${0} max=${2} step=${0.05} signal=${colorContrast} formatter=${fixed2} />
        <${SliderField} id="color-saturation" label="Saturation" min=${0} max=${2} step=${0.05} signal=${colorSaturation} formatter=${fixed2} />
        <${SliderField} id="color-gamma" label="Gamma" min=${0.2} max=${3} step=${0.05} signal=${colorGamma} formatter=${fixed2} />
        <button className="color-reset" type="button" data-action="reset-color-correction">Reset Color</button>
      </div>

      <div className="control-section bloom-settings">
        <div className="section-title">Bloom / Glare</div>
        <${SliderField} id="bloom-strength" label="Bloom" min=${0} max=${2} step=${0.05} signal=${bloomStrength} formatter=${fixed2} />
        <${SliderField} id="bloom-threshold" label="Bloom threshold" min=${0} max=${4} step=${0.05} signal=${bloomThreshold} formatter=${fixed2} />
        <${SliderField} id="glare-strength" label="Glare" min=${0} max=${2} step=${0.05} signal=${glareStrength} formatter=${fixed2} />
      </div>
    </div>
  `;
}
