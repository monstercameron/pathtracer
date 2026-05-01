import { html } from 'htm/preact';
import { glossiness, material, setGlossiness, setMaterial } from '../../store.js';
import { selectedSceneItem } from '../../sceneStore.js';

export const MATERIAL_OPTIONS = Object.freeze([
  { value: 0, label: 'Diffuse' },
  { value: 1, label: 'Mirror' },
  { value: 2, label: 'Glossy' },
  { value: 3, label: 'Glass' },
  { value: 4, label: 'GGX PBR' },
  { value: 5, label: 'Spectral Glass' },
  { value: 6, label: 'Subsurface' },
  { value: 7, label: 'Caustics' },
  { value: 8, label: 'Procedural Pack' },
  { value: 9, label: 'SDF Fractal' },
  { value: 10, label: 'Volumetric Shafts' },
  { value: 11, label: 'Bokeh' },
  { value: 12, label: 'Motion Blur Stress' },
  { value: 13, label: 'Fire Plasma' }
]);

const readSelectedName = () => selectedSceneItem.value ? selectedSceneItem.value.name : 'No selection';

export function ObjectPanel({ id = 'object-panel' }) {
  const selectedItem = selectedSceneItem.value;
  const selectedName = readSelectedName();

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section">
        <div className="section-title">Selected item</div>
        <div id="selected-item-name" className="selection-readout">${selectedName}</div>
        <div className="field">
          <label for="selected-item-name-input">Name</label>
          <input id="selected-item-name-input" type="text" placeholder="Scene item" value=${selectedItem ? selectedName : ''} disabled=${!selectedItem} />
          <button type="button" data-action="rename-selection" disabled=${!selectedItem}>Rename</button>
        </div>
        <div className="button-row two-up">
          <button type="button" data-action="select-light">Light</button>
          <button type="button" data-action="delete-selection" disabled=${!selectedItem}>Delete</button>
        </div>
        <div className="button-row">
          <button type="button" data-action="duplicate-selection" disabled=${!selectedItem}>Duplicate</button>
          <button id="selection-hidden-toggle" type="button" data-action="toggle-selection-hidden" aria-pressed=${String(Boolean(selectedItem && selectedItem.isHidden))} disabled=${!selectedItem}>
            ${selectedItem && selectedItem.isHidden ? 'Show' : 'Hide'}
          </button>
          <button id="selection-lock-toggle" type="button" data-action="toggle-selection-locked" aria-pressed=${String(Boolean(selectedItem && selectedItem.isLocked))} disabled=${!selectedItem}>
            ${selectedItem && selectedItem.isLocked ? 'Unlock' : 'Lock'}
          </button>
        </div>
      </div>

      <div className="control-section">
        <div className="field">
          <label for="material">Object shader</label>
          <select id="material" value=${material.value} onChange=${(event) => setMaterial(Number.parseInt(event.currentTarget.value, 10))}>
            ${MATERIAL_OPTIONS.map((option) => html`
              <option key=${option.value} value=${option.value}>${option.label}</option>
            `)}
          </select>
          <button type="button" data-action="apply-object-shader" disabled=${!selectedItem}>Apply to Selection</button>
          <span id="glossiness-factor">
            with glossiness factor:
            <input
              id="glossiness"
              value=${glossiness.value}
              onInput=${(event) => setGlossiness(Number.parseFloat(event.currentTarget.value))}
            />
          </span>
        </div>
      </div>
    </div>
  `;
}
