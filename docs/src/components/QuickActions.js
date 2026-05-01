import { html } from 'htm/preact';
import { isConvergencePauseEnabled, isFramePaused } from '../store.js';

export const QUICK_ACTION_ITEMS = Object.freeze([
  { key: 'preset-sphere-column', label: 'Col', wide: true, preset: 'sphereColumn', tooltip: 'Load Sphere Column', ariaLabel: 'Load Sphere Column' },
  { key: 'preset-shader-showcase', label: 'Mat', wide: true, preset: 'shaderShowcase', tooltip: 'Load Shader Showcase', ariaLabel: 'Load Shader Showcase' },
  { key: 'preset-primitive-showcase', label: 'Prim', wide: true, preset: 'primitiveShowcase', tooltip: 'Load Primitive Showcase', ariaLabel: 'Load Primitive Showcase' },
  { key: 'preset-area-light', label: 'Lit', wide: true, preset: 'areaLightShowcase', tooltip: 'Load Area Light Studio', ariaLabel: 'Load Area Light Studio' },
  { key: 'divider-create', type: 'divider' },
  { key: 'add-sphere', label: 'Sphere', action: 'add-sphere', tooltip: 'Add Sphere', ariaLabel: 'Add Sphere' },
  { key: 'add-cube', label: 'Box', action: 'add-cube', tooltip: 'Add Cube', ariaLabel: 'Add Cube' },
  { key: 'add-area-light', label: 'Light', action: 'add-area-light', tooltip: 'Add Area Light', ariaLabel: 'Add Area Light' },
  { key: 'divider-panels', type: 'divider' },
  { key: 'panel-create', label: 'Create', panelTarget: 'scene-panel', windowTarget: 'controls', tooltip: 'Create Panel', ariaLabel: 'Open Create Panel' },
  { key: 'panel-object', label: 'Inspect', panelTarget: 'object-panel', windowTarget: 'controls', tooltip: 'Inspector', ariaLabel: 'Open Inspector' },
  { key: 'panel-render', label: 'Render', panelTarget: 'render-panel', windowTarget: 'controls', tooltip: 'Render Settings', ariaLabel: 'Open Render Settings' },
  { key: 'window-tree', label: 'Tree', windowTarget: 'scene-tree-window', tooltip: 'Scene Tree', ariaLabel: 'Toggle Scene Tree' },
  { key: 'window-benchmark', label: 'Bench', windowTarget: 'benchmark', tooltip: 'Benchmark', ariaLabel: 'Toggle Benchmark' },
  { key: 'divider-render', type: 'divider' },
  { key: 'pause-frames', label: 'Frames', action: 'toggle-frame-pause', tooltip: 'Pause Frames', ariaLabel: 'Pause or resume frames' },
  { key: 'pause-rays', label: 'Rays', action: 'toggle-convergence-pause', tooltip: 'Pause Rays at Converged', ariaLabel: 'Toggle convergence pause' },
  { key: 'fullscreen-panels', label: 'UI', action: 'toggle-fullscreen-panels', tooltip: 'Show Panels in Fullscreen', ariaLabel: 'Show panels in fullscreen' },
  { key: 'fullscreen', label: 'FS', action: 'toggle-canvas-fullscreen', tooltip: 'Fullscreen', ariaLabel: 'Toggle fullscreen' },
  { key: 'save-png', label: 'PNG', action: 'save-bitmap', tooltip: 'Save PNG', ariaLabel: 'Save PNG' }
]);

const DEFAULT_PRESSED_SIGNALS = Object.freeze({
  'toggle-frame-pause': isFramePaused,
  'toggle-convergence-pause': isConvergencePauseEnabled
});

const readPressedValue = (item, pressedSignals) => {
  const actionSignal = item.action ? pressedSignals[item.action] : null;
  const windowSignal = item.windowTarget ? pressedSignals[`window:${item.windowTarget}`] : null;
  const panelSignal = item.panelTarget ? pressedSignals[`panel:${item.panelTarget}`] : null;
  const targetSignal = actionSignal || windowSignal || panelSignal;
  return targetSignal ? Boolean(targetSignal.value) : undefined;
};

export function QuickActions({ items = QUICK_ACTION_ITEMS, pressedSignals = DEFAULT_PRESSED_SIGNALS }) {
  return html`
    <div id="menu-quick-actions" className="menu-quick-actions" role="toolbar" aria-label="Quick actions">
      ${items.map((item) => {
        if (item.type === 'divider') {
          return html`<span key=${item.key} className="menu-quick-divider" aria-hidden="true"></span>`;
        }
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
          >
            ${item.label}
          </button>
        `;
      })}
    </div>
  `;
}
