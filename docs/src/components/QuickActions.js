import { html } from 'htm/preact';
import { quickActionPressedSignals } from '../store.js';

export const QUICK_ACTION_ITEMS = Object.freeze([
  { key: 'preset-sphere-column', label: 'Sphere Column', wide: true, preset: 'sphereColumn', tooltip: 'Load Sphere Column', ariaLabel: 'Load Sphere Column' },
  { key: 'preset-shader-showcase', label: 'Shader Demo', wide: true, preset: 'shaderShowcase', tooltip: 'Load Shader Showcase', ariaLabel: 'Load Shader Showcase' },
  { key: 'preset-primitive-showcase', label: 'Primitive Demo', wide: true, preset: 'primitiveShowcase', tooltip: 'Load Primitive Showcase', ariaLabel: 'Load Primitive Showcase' },
  { key: 'preset-area-light', label: 'Light Studio', wide: true, preset: 'areaLightShowcase', tooltip: 'Load Area Light Studio', ariaLabel: 'Load Area Light Studio' },
  { key: 'divider-create', type: 'divider' },
  { key: 'add-sphere', label: 'Add Sphere', action: 'add-sphere', tooltip: 'Add Sphere', ariaLabel: 'Add Sphere' },
  { key: 'add-cube', label: 'Add Cube', action: 'add-cube', tooltip: 'Add Cube', ariaLabel: 'Add Cube' },
  { key: 'add-area-light', label: 'Add Light', action: 'add-area-light', tooltip: 'Add Area Light', ariaLabel: 'Add Area Light' },
  { key: 'divider-panels', type: 'divider' },
  { key: 'scene-tree-add', label: 'Add', action: 'toggle-scene-tree-create', tooltip: 'Add Scene Item', ariaLabel: 'Add scene item' },
  { key: 'panel-object', label: 'Object', panelTarget: 'object-panel', activationWindowTarget: 'controls', tooltip: 'Object Inspector', ariaLabel: 'Open Object Inspector' },
  { key: 'panel-render', label: 'Render', panelTarget: 'render-panel', activationWindowTarget: 'controls', tooltip: 'Render Settings', ariaLabel: 'Open Render Settings' },
  { key: 'window-tree', label: 'Scene Tree', windowTarget: 'scene-tree-window', tooltip: 'Scene Tree', ariaLabel: 'Toggle Scene Tree' },
  { key: 'window-benchmark', label: 'Benchmark', windowTarget: 'benchmark', tooltip: 'Benchmark', ariaLabel: 'Toggle Benchmark' },
  { key: 'window-log', label: 'Log', windowTarget: 'log-panel', tooltip: 'Log Panel', ariaLabel: 'Toggle Log Panel' },
  { key: 'divider-render', type: 'divider' },
  {
    key: 'pause-controls',
    type: 'group',
    ariaLabel: 'Pause controls',
    items: Object.freeze([
      { key: 'pause-frames', label: 'Frames', action: 'toggle-frame-pause', tooltip: 'Pause Frames', ariaLabel: 'Pause or resume frames' },
      { key: 'pause-rays', label: 'Rays', action: 'toggle-convergence-pause', tooltip: 'Pause Rays at Converged', ariaLabel: 'Toggle convergence pause' }
    ])
  },
  { key: 'divider-output', type: 'divider' },
  { key: 'reset-physics', label: 'Reset Physics', action: 'reset-physics-interactions', tooltip: 'Reset Physics', ariaLabel: 'Reset physics interactions' },
  { key: 'fullscreen-panels', label: 'Panels', action: 'toggle-fullscreen-panels', tooltip: 'Show Panels in Fullscreen', ariaLabel: 'Show panels in fullscreen' },
  { key: 'fullscreen', label: 'Fullscreen', action: 'toggle-canvas-fullscreen', tooltip: 'Fullscreen', ariaLabel: 'Toggle fullscreen' },
  { key: 'save-png', label: 'Save PNG', action: 'save-bitmap', tooltip: 'Save PNG', ariaLabel: 'Save PNG' }
]);

const readPressedValue = (item, pressedSignals) => {
  const actionSignal = item.action ? pressedSignals[item.action] : null;
  const windowSignal = item.windowTarget ? pressedSignals[`window:${item.windowTarget}`] : null;
  const panelSignal = item.panelTarget ? pressedSignals[`panel:${item.panelTarget}`] : null;
  const targetSignal = actionSignal || panelSignal || windowSignal;
  return targetSignal ? Boolean(targetSignal.value) : undefined;
};

const QUICK_ACTION_GROUP_STYLE = 'display: flex; align-items: center; gap: 3px; min-width: max-content;';

const renderQuickActionButton = (item, pressedSignals, onButtonClick) => {
  const pressedValue = readPressedValue(item, pressedSignals);
  return html`
    <button
      key=${item.key}
      className=${`menu-quick-action ${item.wide ? 'wide' : ''}`.trim()}
      type="button"
      data-action=${item.action}
      data-preset=${item.preset}
      data-panel-target=${item.panelTarget}
      data-window-target=${item.windowTarget}
      data-tooltip=${item.tooltip}
      title=${item.tooltip}
      aria-label=${item.ariaLabel}
      aria-pressed=${pressedValue === undefined ? undefined : String(pressedValue)}
      onClick=${onButtonClick ? (event) => onButtonClick(event, item) : undefined}
    >
      ${item.label}
    </button>
  `;
};

export function QuickActions({
  items = QUICK_ACTION_ITEMS,
  pressedSignals = quickActionPressedSignals,
  onButtonClick
}) {
  return html`
    <div id="menu-quick-actions" className="menu-quick-actions" role="toolbar" aria-label="Quick actions">
      ${items.map((item) => {
        if (item.type === 'divider') {
          return html`<span key=${item.key} className="menu-quick-divider" aria-hidden="true"></span>`;
        }
        if (item.type === 'group') {
          return html`
            <span key=${item.key} className="menu-quick-group" role="group" aria-label=${item.ariaLabel} style=${QUICK_ACTION_GROUP_STYLE}>
              ${item.items.map((groupItem) => renderQuickActionButton(groupItem, pressedSignals, onButtonClick))}
            </span>
          `;
        }
        return renderQuickActionButton(item, pressedSignals, onButtonClick);
      })}
    </div>
  `;
}
