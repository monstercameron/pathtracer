import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { AccordionSection } from './AccordionSection.js';
import { FloatingWindow } from './FloatingWindow.js';
import { LogPanel } from './LogPanel.js';
import { CameraPanel } from './panels/CameraPanel.js';
import { ImageCorrectionPanel } from './panels/ImageCorrectionPanel.js';
import { ObjectPanel } from './panels/ObjectPanel.js';
import { OutputPanel } from './panels/OutputPanel.js';
import { PresetPanel } from './panels/PresetPanel.js';
import { RenderPanel } from './panels/RenderPanel.js';
import { uiLogger } from '../logger.js';
import {
  canDeleteSceneItems,
  canGroupSceneItems,
  canUngroupSceneItems,
  deleteSelectedSceneItems,
  groupSelectedSceneItems,
  selectedItemIds,
  selectedSceneItem,
  selectedSceneItems,
  toggleSelectedSceneItemsHidden,
  toggleSelectedSceneItemsLocked,
  ungroupSelectedSceneItems
} from '../sceneStore.js';
import { setUiPanelOpen, uiPanelOpenSignals, uiWindowVisibilitySignals } from '../store.js';

export const INSPECTOR_SECTIONS = Object.freeze([
  { key: 'render', title: 'Render', accentColor: '#5cb85c', defaultOpen: true, render: () => html`<${RenderPanel} />` },
  { key: 'camera', title: 'Camera', accentColor: '#f0ad4e', render: () => html`<${CameraPanel} />` },
  { key: 'output', title: 'Output', accentColor: '#9b59b6', render: () => html`<${OutputPanel} />` },
  { key: 'image-correction', title: 'Image Correction', accentColor: '#40b8c8', render: () => html`<${ImageCorrectionPanel} />` },
  { key: 'preset', title: 'Presets', accentColor: '#7f8c8d', render: () => html`<${PresetPanel} />` }
]);

export function InspectorPanel({
  id = 'controls',
  defaultPosition = { top: 48, right: 18, width: 360, height: 'min(74vh, 680px)' }
}) {
  const selectedItem = selectedSceneItem.value;
  const currentSelectedItemIds = selectedItemIds.value;
  const currentSelectedItems = selectedSceneItems.value;
  const selectedCount = currentSelectedItems.length;
  const canDeleteSelection = canDeleteSceneItems(currentSelectedItemIds);
  const canGroupSelection = canGroupSceneItems(currentSelectedItemIds);
  const canUngroupSelection = canUngroupSceneItems(currentSelectedItemIds);
  const shouldShowBulkControls = selectedCount > 1 || canUngroupSelection;
  const hiddenActionLabel = currentSelectedItems.some((item) => !item.isHidden) ? 'Hide' : 'Show';
  const lockActionLabel = currentSelectedItems.some((item) => !item.isLocked) ? 'Lock' : 'Unlock';
  const objectTitle = selectedItem ? selectedItem.name : 'Nothing selected';

  const handleDeleteSelected = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const didDelete = deleteSelectedSceneItems();
    uiLogger.info(didDelete ? 'ui:inspector-delete-selected' : 'ui:inspector-delete-selected-noop', {
      selectedItemIds: currentSelectedItemIds
    });
  };

  const handleGroupSelected = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const groupItem = groupSelectedSceneItems();
    uiLogger.info(groupItem ? 'ui:inspector-group-selected' : 'ui:inspector-group-selected-noop', {
      selectedItemIds: currentSelectedItemIds,
      groupId: groupItem?.id ?? null
    });
  };

  const handleUngroupSelected = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const didUngroup = ungroupSelectedSceneItems();
    uiLogger.info(didUngroup ? 'ui:inspector-ungroup-selected' : 'ui:inspector-ungroup-selected-noop', {
      selectedItemIds: currentSelectedItemIds
    });
  };

  const handleToggleHidden = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const didUpdate = toggleSelectedSceneItemsHidden();
    uiLogger.info(didUpdate ? 'ui:inspector-toggle-hidden' : 'ui:inspector-toggle-hidden-noop', {
      selectedItemIds: currentSelectedItemIds
    });
  };

  const handleToggleLocked = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const didUpdate = toggleSelectedSceneItemsLocked();
    uiLogger.info(didUpdate ? 'ui:inspector-toggle-locked' : 'ui:inspector-toggle-locked-noop', {
      selectedItemIds: currentSelectedItemIds
    });
  };

  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'InspectorPanel', sectionCount: INSPECTOR_SECTIONS.length + 1 });
  }, [id]);

  useEffect(() => {
    if (selectedItem) {
      setUiPanelOpen('object-panel', true);
    }
  }, [selectedItem]);

  return html`
    <>
      <${FloatingWindow}
        id=${id}
        windowKey="inspector"
        title="Inspector"
        defaultPosition=${defaultPosition}
        defaultVisible=${true}
        visibleSignal=${uiWindowVisibilitySignals.controls}
      >
        <${AccordionSection}
          sectionKey="object"
          title=${objectTitle}
          accentColor="#63a7ff"
          defaultOpen=${Boolean(selectedItem)}
          openSignal=${uiPanelOpenSignals['object-panel']}
        >
          ${shouldShowBulkControls ? html`
            <div className="control-section" data-selection-bulk-controls>
              <div className="section-title">${selectedCount} selected</div>
              <div className="button-row">
                <button type="button" data-action="delete-selection" disabled=${!canDeleteSelection} onClick=${handleDeleteSelected}>Delete</button>
                <button type="button" data-action="toggle-selection-hidden" onClick=${handleToggleHidden}>${hiddenActionLabel}</button>
                <button type="button" data-action="toggle-selection-locked" onClick=${handleToggleLocked}>${lockActionLabel}</button>
              </div>
              <div className="button-row two-up">
                <button type="button" data-action="group-selection" disabled=${!canGroupSelection} onClick=${handleGroupSelected}>Group</button>
                <button type="button" data-action="ungroup-selection" disabled=${!canUngroupSelection} onClick=${handleUngroupSelected}>Ungroup</button>
              </div>
            </div>
          ` : null}
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
            openSignal=${uiPanelOpenSignals[`${section.key}-panel`]}
          >
            ${section.render()}
          <//>
        `)}
      <//>
      <${LogPanel} />
    </>
  `;
}
