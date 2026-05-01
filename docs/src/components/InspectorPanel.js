import { html } from 'htm/preact';
import { AccordionSection } from './AccordionSection.js';
import { FloatingWindow } from './FloatingWindow.js';
import { CameraPanel } from './panels/CameraPanel.js';
import { CreatePanel } from './panels/CreatePanel.js';
import { ObjectPanel } from './panels/ObjectPanel.js';
import { OutputPanel } from './panels/OutputPanel.js';
import { PresetPanel } from './panels/PresetPanel.js';
import { RenderPanel } from './panels/RenderPanel.js';
import { selectedSceneItem } from '../sceneStore.js';

export const INSPECTOR_SECTIONS = Object.freeze([
  { key: 'scene', title: 'Create', accentColor: '#4a90e2', defaultOpen: true, render: () => html`<${CreatePanel} />` },
  { key: 'render', title: 'Render', accentColor: '#5cb85c', defaultOpen: true, render: () => html`<${RenderPanel} />` },
  { key: 'camera', title: 'Camera', accentColor: '#f0ad4e', render: () => html`<${CameraPanel} />` },
  { key: 'output', title: 'Output', accentColor: '#9b59b6', render: () => html`<${OutputPanel} />` },
  { key: 'preset', title: 'Presets', accentColor: '#7f8c8d', render: () => html`<${PresetPanel} />` }
]);

export function InspectorPanel({
  id = 'controls',
  defaultPosition = { top: 48, right: 18, width: 360, height: 'min(74vh, 680px)' }
}) {
  const selectedItem = selectedSceneItem.value;
  const objectTitle = selectedItem ? selectedItem.name : 'Nothing selected';

  return html`
    <${FloatingWindow}
      id=${id}
      windowKey="inspector"
      title="Inspector"
      defaultPosition=${defaultPosition}
      defaultVisible=${true}
    >
      <${AccordionSection}
        sectionKey="object"
        title=${objectTitle}
        accentColor="#4a90e2"
        controlledOpen=${Boolean(selectedItem)}
      >
        <${ObjectPanel} />
      <//>
      ${INSPECTOR_SECTIONS.map((section) => html`
        <${AccordionSection}
          key=${section.key}
          sectionKey=${section.key}
          title=${section.title}
          accentColor=${section.accentColor}
          defaultOpen=${Boolean(section.defaultOpen)}
          storageKey=${`inspector-section-${section.key}`}
        >
          ${section.render()}
        <//>
      `)}
    <//>
  `;
}
