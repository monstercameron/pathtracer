import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
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
  TRANSFORM_ANIMATION_TYPES,
  TRANSFORM_ANIMATION_TYPE_OPTIONS,
  attachTransformAnimationToSceneItem,
  canDeleteSceneItems,
  canGroupSceneItems,
  canUngroupSceneItems,
  deleteSelectedSceneItems,
  groupSelectedSceneItems,
  readSceneItemTransformAnimations,
  removeTransformAnimationFromSceneItem,
  selectedItemIds,
  selectedSceneItem,
  selectedSceneItems,
  setTransformAnimationEnabled,
  toggleSelectedSceneItemsHidden,
  toggleSelectedSceneItemsLocked,
  updateTransformAnimationConfig,
  ungroupSelectedSceneItems
} from '../sceneStore.js';
import { setUiPanelOpen, uiPanelOpenSignals, uiWindowVisibilitySignals } from '../store.js';
import { NumberInputGroup } from './controls/EditorFields.js';

export const INSPECTOR_SECTIONS = Object.freeze([
  { key: 'render', title: 'Render', accentColor: '#5cb85c', defaultOpen: true, render: () => html`<${RenderPanel} />` },
  { key: 'camera', title: 'Camera', accentColor: '#f0ad4e', render: () => html`<${CameraPanel} />` },
  { key: 'output', title: 'Output', accentColor: '#9b59b6', render: () => html`<${OutputPanel} />` },
  { key: 'image-correction', title: 'Image Correction', accentColor: '#40b8c8', render: () => html`<${ImageCorrectionPanel} />` },
  { key: 'preset', title: 'Presets', accentColor: '#7f8c8d', render: () => html`<${PresetPanel} />` }
]);

const readNumberInputValue = (event, fallbackValue) => {
  const nextValue = Number.parseFloat(event.currentTarget.value);
  return Number.isFinite(nextValue) ? nextValue : fallbackValue;
};

function AnimationNumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  onInput
}) {
  return html`
    <div className="field">
      <label for=${id}>${label}</label>
      <input
        id=${id}
        type="number"
        min=${min}
        max=${max}
        step=${step}
        value=${value}
        disabled=${disabled}
        onInput=${onInput}
      />
    </div>
  `;
}

const readAnimationConfig = (animation) => animation.config || {};

function TransformAnimationConfigFields({ selectedItem, animation, disabled }) {
  const itemId = selectedItem?.id ?? null;
  const config = readAnimationConfig(animation);
  const animationId = animation.id;
  const updateConfig = (patch) => {
    if (!itemId) {
      return;
    }
    const didUpdate = updateTransformAnimationConfig(itemId, animationId, patch);
    uiLogger.info(didUpdate ? 'ui:inspector-transform-animation-config' : 'ui:inspector-transform-animation-config-noop', {
      itemId,
      animationId,
      patch
    });
  };
  const numberField = (key, label, fallbackValue, options = {}) => html`
    <${AnimationNumberField}
      id=${`transform-animation-${animationId}-${key}`}
      label=${label}
      min=${options.min}
      max=${options.max}
      step=${options.step ?? '0.01'}
      value=${config[key] ?? fallbackValue}
      disabled=${disabled}
      onInput=${(event) => updateConfig({ [key]: readNumberInputValue(event, config[key] ?? fallbackValue) })}
    />
  `;

  if (animation.animationType === TRANSFORM_ANIMATION_TYPES.BOB) {
    return html`
      ${numberField('amplitude', 'Amplitude', 0.12, { min: '0', max: '4', step: '0.01' })}
      ${numberField('frequencyHertz', 'Frequency', 1, { min: '0', max: '12', step: '0.05' })}
      ${numberField('phaseDegrees', 'Phase', 0, { min: '-360', max: '360', step: '1' })}
    `;
  }

  if (animation.animationType === TRANSFORM_ANIMATION_TYPES.PULSE) {
    return html`
      ${numberField('amplitude', 'Amplitude', 0.12, { min: '0', max: '0.95', step: '0.01' })}
      ${numberField('frequencyHertz', 'Frequency', 1, { min: '0', max: '12', step: '0.05' })}
      ${numberField('phaseDegrees', 'Phase', 0, { min: '-360', max: '360', step: '1' })}
    `;
  }

  if (animation.animationType === TRANSFORM_ANIMATION_TYPES.ORBIT) {
    const center = Array.isArray(config.center) ? config.center : [0, 0, 0];
    const updateCenterAxis = (axisIndex, event) => {
      const nextCenter = [...center];
      nextCenter[axisIndex] = readNumberInputValue(event, center[axisIndex] ?? 0);
      updateConfig({ center: nextCenter });
    };
    return html`
      <${NumberInputGroup}
        label="Center"
        labelFor=${`transform-animation-${animationId}-center-x`}
        inputs=${[
          { id: `transform-animation-${animationId}-center-x`, step: '0.05', placeholder: 'X', value: center[0] ?? 0, disabled, ariaLabel: 'Orbit center X', onInput: (event) => updateCenterAxis(0, event) },
          { id: `transform-animation-${animationId}-center-y`, step: '0.05', placeholder: 'Y', value: center[1] ?? 0, disabled, ariaLabel: 'Orbit center Y', onInput: (event) => updateCenterAxis(1, event) },
          { id: `transform-animation-${animationId}-center-z`, step: '0.05', placeholder: 'Z', value: center[2] ?? 0, disabled, ariaLabel: 'Orbit center Z', onInput: (event) => updateCenterAxis(2, event) }
        ]}
      />
      ${numberField('radius', 'Radius', 1, { min: '0', max: '12', step: '0.05' })}
      ${numberField('speedDegreesPerSecond', 'Speed', 30, { min: '-720', max: '720', step: '1' })}
      ${numberField('phaseDegrees', 'Phase', 0, { min: '-360', max: '360', step: '1' })}
    `;
  }

  if (animation.animationType === TRANSFORM_ANIMATION_TYPES.WOBBLE) {
    return html`
      ${numberField('amplitudeDegrees', 'Amplitude', 4, { min: '0', max: '45', step: '0.5' })}
      ${numberField('frequencyHertz', 'Frequency', 8, { min: '0', max: '30', step: '0.25' })}
      ${numberField('seed', 'Seed', 1, { min: '0', max: '9999', step: '1' })}
    `;
  }

  return html`
    ${numberField('speedDegreesPerSecond', 'Speed', 45, { min: '-720', max: '720', step: '1' })}
    ${numberField('phaseDegrees', 'Phase', 0, { min: '-360', max: '360', step: '1' })}
  `;
}

function ProceduralAnimationControls({ selectedItem }) {
  const [animationTypeToAdd, setAnimationTypeToAdd] = useState(TRANSFORM_ANIMATION_TYPE_OPTIONS[0].value);
  const itemId = selectedItem?.id ?? null;
  const animations = readSceneItemTransformAnimations(selectedItem);
  const disabled = !selectedItem || selectedItem.isLocked;

  const handleAddAnimation = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const animation = itemId ? attachTransformAnimationToSceneItem(itemId, animationTypeToAdd) : null;
    uiLogger.info(animation ? 'ui:inspector-transform-animation-attach' : 'ui:inspector-transform-animation-attach-noop', {
      itemId,
      animationType: animationTypeToAdd,
      animationId: animation?.id ?? null
    });
  };

  const handleToggleAnimation = (animation, event) => {
    const enabled = event.currentTarget.checked;
    const didUpdate = itemId ? setTransformAnimationEnabled(itemId, animation.id, enabled) : false;
    uiLogger.info(didUpdate ? 'ui:inspector-transform-animation-toggle' : 'ui:inspector-transform-animation-toggle-noop', {
      itemId,
      animationId: animation.id,
      enabled
    });
  };

  const handleRemoveAnimation = (animation, event) => {
    event.preventDefault();
    event.stopPropagation();
    const didRemove = itemId ? removeTransformAnimationFromSceneItem(itemId, animation.id) : false;
    uiLogger.info(didRemove ? 'ui:inspector-transform-animation-remove' : 'ui:inspector-transform-animation-remove-noop', {
      itemId,
      animationId: animation.id
    });
  };

  return html`
    <div className="control-section" data-transform-animation-controls>
      <div className="section-title">Transform animations</div>
      <div className="field">
        <label for="transform-animation-add-type">Add animation</label>
        <select
          id="transform-animation-add-type"
          value=${animationTypeToAdd}
          disabled=${disabled}
          onChange=${(event) => setAnimationTypeToAdd(event.currentTarget.value)}
        >
          ${TRANSFORM_ANIMATION_TYPE_OPTIONS.map((option) => html`
            <option key=${option.value} value=${option.value}>${option.label}</option>
          `)}
        </select>
        <button
          type="button"
          data-action="attach-transform-animation"
          disabled=${disabled}
          onClick=${handleAddAnimation}
        >
          Attach
        </button>
      </div>
      ${animations.length > 0 ? animations.map((animation) => html`
        <div
          key=${animation.id}
          className="field component-row"
          data-transform-animation-component
          data-transform-animation-id=${animation.id}
          data-transform-animation-type=${animation.animationType}
        >
          <span>${animation.label}</span>
          <strong>${animation.summary}</strong>
        </div>
        <div className="button-row two-up" key=${`${animation.id}-actions`}>
          <label className="checkbox-field">
            <input
              type="checkbox"
              data-action="toggle-transform-animation-enabled"
              checked=${animation.enabled}
              disabled=${disabled}
              onChange=${(event) => handleToggleAnimation(animation, event)}
            />
            Enabled
          </label>
          <button
            type="button"
            data-action="remove-transform-animation"
            disabled=${disabled}
            onClick=${(event) => handleRemoveAnimation(animation, event)}
          >
            Remove
          </button>
        </div>
        <${TransformAnimationConfigFields}
          key=${`${animation.id}-config`}
          selectedItem=${selectedItem}
          animation=${animation}
          disabled=${disabled || !animation.enabled}
        />
      `) : html`<div className="selection-readout">No transform animations</div>`}
    </div>
  `;
}

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
          <${ProceduralAnimationControls} selectedItem=${selectedItem} />
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
