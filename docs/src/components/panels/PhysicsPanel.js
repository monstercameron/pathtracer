import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { uiLogger } from '../../logger.js';
import { SliderField } from '../SliderField.js';
import { NumberInputGroup, SelectField } from '../controls/EditorFields.js';

const GLOBAL_GRAVITY_DIRECTION_OPTIONS = Object.freeze([
  { value: 'down', label: 'Down', selected: true },
  { value: 'up', label: 'Up' },
  { value: 'zero-g', label: 'Zero-G' },
  { value: 'custom', label: 'Custom' }
]);

export function PhysicsPanel({ id = 'physics-panel' }) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'PhysicsPanel' });
  }, [id]);

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section physics-world-settings">
        <div className="section-title">Physics world</div>
        <${SelectField}
          id="global-gravity-direction"
          label="Gravity direction"
          options=${GLOBAL_GRAVITY_DIRECTION_OPTIONS}
        />
        <${SliderField}
          id="global-gravity-magnitude"
          label="Gravity magnitude"
          min=${0}
          max=${20}
          step=${0.01}
          value=${9.81}
          formatter=${(value) => Number(value).toFixed(2)}
          onInput=${() => undefined}
        />
        <${NumberInputGroup}
          label="Custom direction"
          inputs=${[
            { id: 'global-gravity-custom-x', min: '-1', max: '1', step: '0.05', value: '0.00', ariaLabel: 'Custom gravity X direction', disabled: true },
            { id: 'global-gravity-custom-y', min: '-1', max: '1', step: '0.05', value: '-1.00', ariaLabel: 'Custom gravity Y direction', disabled: true },
            { id: 'global-gravity-custom-z', min: '-1', max: '1', step: '0.05', value: '0.00', ariaLabel: 'Custom gravity Z direction', disabled: true }
          ]}
        />
      </div>
    </div>
  `;
}
