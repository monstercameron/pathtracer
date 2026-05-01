import { render } from 'preact';
import { html } from 'htm/preact';
import { BenchmarkPanel } from './components/BenchmarkPanel.js';
import { InspectorPanel } from './components/InspectorPanel.js';
import { MenuBar } from './components/MenuBar.js';
import { RenderCanvas } from './components/RenderCanvas.js';
import { SceneTreeWindow } from './components/SceneTreeWindow.js';

export function AppScaffold({ active = false, includeCanvas = false, onCanvasReady }) {
  if (!active) {
    return html`<div data-preact-scaffold="inert" hidden></div>`;
  }

  return html`
    <>
      <${MenuBar} />
      ${includeCanvas ? html`
        <div id="main" className="render-stage">
          <${RenderCanvas} onCanvasReady=${onCanvasReady} />
        </div>
      ` : null}
      <${SceneTreeWindow} />
      <${InspectorPanel} />
      <${BenchmarkPanel} />
    </>
  `;
}

export const mountApp = (rootElement = globalThis.document && globalThis.document.getElementById('ui-root'), options = {}) => {
  if (!rootElement) {
    return null;
  }

  render(html`<${AppScaffold} ...${options} />`, rootElement);
  return rootElement;
};

export const unmountApp = (rootElement = globalThis.document && globalThis.document.getElementById('ui-root')) => {
  if (!rootElement) {
    return null;
  }

  render(null, rootElement);
  return rootElement;
};

mountApp();
