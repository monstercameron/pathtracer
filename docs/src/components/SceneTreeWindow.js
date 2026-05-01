import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import {
  sceneItemCountLabel,
  sceneItems,
  selectedItemId,
  setSelectedItemId
} from '../sceneStore.js';
import { FloatingWindow } from './FloatingWindow.js';
import { PRIMITIVE_ACTIONS } from './panels/CreatePanel.js';

const PANEL_LINKS = Object.freeze([
  { label: 'Create', panelTarget: 'scene-panel' },
  { label: 'Object', panelTarget: 'object-panel' },
  { label: 'Render', panelTarget: 'render-panel' },
  { label: 'Camera', panelTarget: 'camera-panel' },
  { label: 'Output', panelTarget: 'output-panel' },
  { label: 'Presets', panelTarget: 'preset-panel' }
]);

const formatItemLabel = (item) => {
  const status = [
    item.isHidden ? 'hidden' : '',
    item.isLocked ? 'locked' : ''
  ].filter(Boolean).join(', ');
  const label = item.name || `Scene item #${item.index}`;
  return status ? `${label} (${status})` : label;
};

export function SceneTreeWindow({
  id = 'scene-tree-window',
  defaultPosition = { top: 48, left: 18, width: 320, height: 'min(74vh, 680px)' },
  onSelectItem
}) {
  const [isCreateOpen, setCreateOpen] = useState(true);
  const items = sceneItems.value;
  const currentSelectedId = selectedItemId.value;

  const handleSelect = (item) => {
    setSelectedItemId(item.id);
    if (onSelectItem) {
      onSelectItem(item);
    }
  };

  return html`
    <${FloatingWindow}
      id=${id}
      windowKey="scene-tree"
      title="Scene Tree"
      defaultPosition=${defaultPosition}
      defaultVisible=${true}
    >
      <div id="scene-tree-count" className="scene-tree-summary">${sceneItemCountLabel.value}</div>
      <div className="scene-tree-tools">
        <div className="section-title">Selection</div>
        <button type="button" data-action="select-light">Select Light</button>
        <button type="button" data-action="delete-selection">Delete Selected</button>
        <div className="section-title">Settings</div>
        ${PANEL_LINKS.map((item) => html`
          <button key=${item.panelTarget} type="button" data-panel-target=${item.panelTarget} data-window-target="controls">${item.label}</button>
        `)}
      </div>

      <div className="scene-tree-create">
        <button
          className="wide-control"
          type="button"
          aria-expanded=${String(isCreateOpen)}
          onClick=${() => setCreateOpen(!isCreateOpen)}
        >
          Create primitive
        </button>
        ${isCreateOpen ? PRIMITIVE_ACTIONS.map((item) => html`
          <button key=${item.action} className=${item.className} type="button" data-action=${item.action}>${item.label}</button>
        `) : null}
      </div>

      <ul id="scene-tree-list" className="scene-tree-list" role="listbox" aria-label="Scene items">
        ${items.map((item) => html`
          <li key=${item.id}>
            <button
              type="button"
              role="option"
              data-scene-object-id=${item.id}
              data-scene-object-index=${item.index}
              aria-selected=${String(item.id === currentSelectedId)}
              aria-pressed=${String(item.id === currentSelectedId)}
              onClick=${() => handleSelect(item)}
            >
              ${formatItemLabel(item)}
            </button>
          </li>
        `)}
      </ul>
    <//>
  `;
}
