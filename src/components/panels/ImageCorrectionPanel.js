import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { uiLogger } from '../../logger.js';
import {
  bloomStrength,
  bloomThreshold,
  colorBrightness,
  colorContrast,
  colorExposure,
  colorGamma,
  colorSaturation,
  glareStrength,
  setToneMappingMode,
  toneMappingMode
} from '../../store.js';
import { SelectField } from '../controls/EditorFields.js';
import { SliderField } from '../SliderField.js';

const fixed2 = (value) => Number(value).toFixed(2);
const TONE_MAPPING_OPTIONS = Object.freeze([
  { value: '0', label: 'Linear' },
  { value: '1', label: 'Reinhard' },
  { value: '2', label: 'ACES' },
  { value: '3', label: 'Uncharted 2' }
]);

const readToneMappingMode = (event) => {
  const nextValue = Number.parseInt(event.currentTarget.value, 10);
  return Number.isFinite(nextValue) ? nextValue : 0;
};

export function ImageCorrectionPanel({ id = 'image-correction-panel' }) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'ImageCorrectionPanel' });
  }, [id]);

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section color-settings">
        <div className="section-title">Color correction</div>
        <${SliderField} id="color-exposure" label="Exposure" min=${-4} max=${4} step=${0.25} signal=${colorExposure} formatter=${fixed2} />
        <${SliderField} id="color-brightness" label="Brightness" min=${-1} max=${1} step=${0.05} signal=${colorBrightness} formatter=${fixed2} />
        <${SliderField} id="color-contrast" label="Contrast" min=${0} max=${2} step=${0.05} signal=${colorContrast} formatter=${fixed2} />
        <${SliderField} id="color-saturation" label="Saturation" min=${0} max=${2} step=${0.05} signal=${colorSaturation} formatter=${fixed2} />
        <${SliderField} id="color-gamma" label="Gamma" min=${0.2} max=${3} step=${0.05} signal=${colorGamma} formatter=${fixed2} />
        <${SelectField}
          id="tone-mapping"
          label="Tone mapping"
          value=${String(toneMappingMode.value)}
          options=${TONE_MAPPING_OPTIONS}
          onChange=${(event) => setToneMappingMode(readToneMappingMode(event))}
        />
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
