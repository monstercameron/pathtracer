import { html } from 'htm/preact';
import {
  activeMaterialPresetId,
  applyMaterialPreset,
  clearMaterialTextureAssignment,
  glossiness,
  lightColor,
  lightIntensity,
  lightSize,
  material,
  materialUvBlendSharpness,
  materialUvProjectionMode,
  materialUvScale,
  MATERIAL_TEXTURE_CHANNELS,
  MATERIAL_UV_PROJECTION_MODES,
  materialTextureAssignments,
  savedMaterialPresets,
  saveMaterialPreset,
  setLightColor,
  setMaterial,
  setMaterialUvBlendSharpness,
  setMaterialUvProjectionMode,
  setMaterialUvScale,
  selectedMaterialTextureChannel,
  setMaterialTextureAssignment,
  setSelectedMaterialTextureChannel,
  swapMaterialTextureAssignments
} from '../../store.js';
import { selectedSceneItem, selectedSceneItemComponentRows, isSceneItemLight } from '../../sceneStore.js';
import { SliderField } from '../SliderField.js';
import { CheckboxField, ColorField, NumberInputGroup, SelectField } from '../controls/EditorFields.js';

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
  { value: 13, label: 'Fire Plasma' },
  { value: 14, label: 'Thin Film' },
  { value: 15, label: 'Retroreflector' },
  { value: 16, label: 'Velvet Sheen' },
  { value: 17, label: 'Voronoi Cracks' },
  { value: 18, label: 'Diffraction Grating' },
  { value: 19, label: 'Anisotropic GGX' },
  { value: 20, label: 'Blackbody' },
  { value: 21, label: 'Emissive' },
  { value: 22, label: 'Toon' },
  { value: 23, label: 'X-Ray' }
]);

const MATERIAL_EMISSIVE = 21;
const DEFAULT_EMISSIVE_COLOR = Object.freeze([0.64, 0.92, 1]);
const DEFAULT_EMISSIVE_INTENSITY = 1.65;

const readSelectedName = () => selectedSceneItem.value ? selectedSceneItem.value.name : 'No selection';
const readPosition = (item) => {
  const position = item && (item.centerPosition || item.position || item.translation);
  return Array.isArray(position) || ArrayBuffer.isView(position) ? position : [];
};

const readPositionAxis = (item, axisIndex) => {
  const position = readPosition(item);
  const value = Number(position[axisIndex]);
  return Number.isFinite(value) ? value.toFixed(2) : '';
};

const readPhysicsNumber = (item, key, fallback = 0) => {
  const value = Number(item && item[key]);
  return Number.isFinite(value) ? value : fallback;
};

const readEmissiveColor = (item) => {
  const value = item && item.emissiveColor;
  return Array.isArray(value) || ArrayBuffer.isView(value) ? value : DEFAULT_EMISSIVE_COLOR;
};

const readEmissiveIntensity = (item) => readPhysicsNumber(item, 'emissiveIntensity', DEFAULT_EMISSIVE_INTENSITY);
const readEmissionEnabled = (item) => {
  if (!item) {
    return false;
  }
  if (item.isEmissionEnabled !== undefined) {
    return Boolean(item.isEmissionEnabled);
  }
  if (item.emissionEnabled !== undefined) {
    return Boolean(item.emissionEnabled);
  }
  return Number(item.material) === MATERIAL_EMISSIVE;
};

const textureChannelOptions = MATERIAL_TEXTURE_CHANNELS.map((channel) => ({
  value: channel.key,
  label: channel.label
}));
const uvProjectionModeOptions = MATERIAL_UV_PROJECTION_MODES.map((mode) => ({
  value: mode.key,
  label: mode.label
}));

const readElementValueById = (event, elementId) => {
  const element = event.currentTarget?.ownerDocument?.getElementById(elementId);
  return element && 'value' in element ? element.value : '';
};

const readMaterialPresetNameInput = (event) => (
  readElementValueById(event, 'material-preset-name').trim() || 'Saved material'
);

const createTextureDescriptorFromFile = (file, channelKey) => ({
  id: `${channelKey}:${file.name}:${file.size}:${file.lastModified || 0}`,
  name: file.name,
  source: 'local-file',
  mimeType: file.type || null,
  size: file.size,
  lastModified: file.lastModified || null,
  status: 'assigned'
});

const readTextureAssignmentName = (assignments, channelKey) => (
  assignments[channelKey]?.name || 'Unassigned'
);

const DEFAULT_PHYSICS_MASS = 1;
const MIN_PHYSICS_MASS = 0.1;
const MAX_PHYSICS_MASS = 10;
const DEFAULT_PHYSICS_GRAVITY_SCALE = 1;
const MIN_PHYSICS_GRAVITY_SCALE = 0;
const MAX_PHYSICS_GRAVITY_SCALE = 3;
const PHYSICS_BODY_TYPES = Object.freeze({
  DYNAMIC: 'dynamic',
  KINEMATIC: 'kinematic',
  STATIC: 'static',
  FIXED: 'fixed'
});
const PHYSICS_BODY_OPTIONS = Object.freeze([
  { value: PHYSICS_BODY_TYPES.DYNAMIC, label: 'Dynamic' },
  { value: PHYSICS_BODY_TYPES.KINEMATIC, label: 'Kinematic' },
  { value: PHYSICS_BODY_TYPES.STATIC, label: 'Static' }
]);

const normalizePhysicsBodyType = (bodyType, fallbackBodyType = PHYSICS_BODY_TYPES.STATIC) => {
  const normalizedBodyType = String(bodyType || '').trim().toLowerCase();
  if (normalizedBodyType === PHYSICS_BODY_TYPES.DYNAMIC) {
    return PHYSICS_BODY_TYPES.DYNAMIC;
  }
  if (normalizedBodyType === PHYSICS_BODY_TYPES.KINEMATIC) {
    return PHYSICS_BODY_TYPES.KINEMATIC;
  }
  if (
    normalizedBodyType === PHYSICS_BODY_TYPES.STATIC ||
    normalizedBodyType === PHYSICS_BODY_TYPES.FIXED
  ) {
    return PHYSICS_BODY_TYPES.STATIC;
  }
  return fallbackBodyType;
};

const readSceneItemTypeText = (item) => String(
  item && (
    item.primitiveType ||
    item.type ||
    item.kind ||
    item.source?.constructor?.name ||
    item.constructor?.name ||
    ''
  )
).toLowerCase();

const isPhysicsRuntimeSupported = (item) => {
  if (!item || item.isPhysicsSupported === false) {
    return false;
  }
  if (item.isPhysicsSupported === true) {
    return true;
  }

  const typeText = readSceneItemTypeText(item);
  return (
    typeText.includes('sphere') ||
    typeText.includes('cube') ||
    item.radius !== undefined ||
    (item.minCorner !== undefined && item.maxCorner !== undefined)
  );
};

const readDefaultPhysicsBodyType = (item) => (
  readSceneItemTypeText(item).includes('sphere') || item?.radius !== undefined
    ? PHYSICS_BODY_TYPES.DYNAMIC
    : PHYSICS_BODY_TYPES.STATIC
);

const readPhysicsHelpText = (selectedItem, isPhysicsSupported, isPhysicsEnabled, isLocked, physicsBodyType) => {
  if (!selectedItem) {
    return 'Select a supported sphere or cube to edit physics.';
  }
  if (!isPhysicsSupported) {
    return 'Physics is currently available for spheres and cubes only.';
  }
  if (isLocked) {
    return 'Unlock this item to edit physics.';
  }
  if (!isPhysicsEnabled) {
    return 'Enable physics to edit body behavior.';
  }
  if (physicsBodyType === PHYSICS_BODY_TYPES.DYNAMIC) {
    return 'Dynamic bodies use mass, gravity, friction, and restitution on rebuild.';
  }
  return 'Kinematic and static bodies ignore mass and gravity; collision material settings still apply.';
};

const fixed2 = (value) => Number(value).toFixed(2);
const toHexByte = (value) => {
  const normalizedValue = Math.max(0, Math.min(1, Number(value)));
  return Math.round(normalizedValue * 255).toString(16).padStart(2, '0');
};
const formatLightColor = (value) => `#${toHexByte(value[0])}${toHexByte(value[1])}${toHexByte(value[2])}`;
const readLightColor = (rawValue) => {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(rawValue));
  return match
    ? [
        Number.parseInt(match[1], 16) / 255,
        Number.parseInt(match[2], 16) / 255,
        Number.parseInt(match[3], 16) / 255
      ]
    : lightColor.value;
};
const clampByte = (value) => Math.max(0, Math.min(255, value));
const normalizeLightTemperature = (value) => {
  const normalizedValue = Number(value);
  const finiteValue = Number.isFinite(normalizedValue) ? normalizedValue : 6500;
  return Math.max(1800, Math.min(10000, Math.round(finiteValue / 100) * 100));
};
const lightColorFromTemperature = (temperatureKelvin) => {
  const temperature = normalizeLightTemperature(temperatureKelvin) / 100;
  const red = temperature <= 66
    ? 255
    : clampByte(329.698727446 * ((temperature - 60) ** -0.1332047592));
  const green = temperature <= 66
    ? clampByte(99.4708025861 * Math.log(temperature) - 161.1195681661)
    : clampByte(288.1221695283 * ((temperature - 60) ** -0.0755148492));
  const blue = temperature >= 66
    ? 255
    : (temperature <= 19 ? 0 : clampByte(138.5177312231 * Math.log(temperature - 10) - 305.0447927307));
  return [red / 255, green / 255, blue / 255];
};
const colorDistance = (firstColor, secondColor) => (
  ((firstColor[0] - secondColor[0]) ** 2) +
  ((firstColor[1] - secondColor[1]) ** 2) +
  ((firstColor[2] - secondColor[2]) ** 2)
);
const estimateLightTemperature = (value) => {
  let bestTemperature = 6500;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let temperature = 1800; temperature <= 10000; temperature += 100) {
    const distance = colorDistance(value, lightColorFromTemperature(temperature));
    if (distance < bestDistance) {
      bestTemperature = temperature;
      bestDistance = distance;
    }
  }
  return bestTemperature;
};
const formatLightTemperature = (value) => `${Math.round(value)} K`;

function LightSelectionControls() {
  const lightTemperature = estimateLightTemperature(lightColor.value);
  return html`
    <div id="selected-light-controls" className="control-section" data-selection-control="light">
      <div className="section-title">Light controls</div>
      <${SliderField} id="selected-light-intensity" label="Brightness" min=${0.1} max=${1} step=${0.01} signal=${lightIntensity} formatter=${fixed2} />
      <${SliderField}
        id="selected-light-temperature"
        label="Color temp"
        min=${1800}
        max=${10000}
        step=${100}
        value=${lightTemperature}
        formatter=${formatLightTemperature}
        onInput=${(value) => setLightColor(lightColorFromTemperature(value))}
      />
      <${SliderField} id="selected-light-size" label="Size" min=${0.02} max=${0.5} step=${0.01} signal=${lightSize} formatter=${fixed2} />
      <${ColorField}
        id="selected-light-color"
        label="Color"
        value=${formatLightColor(lightColor.value)}
        ariaLabel="Selected light color"
        onInput=${(event) => setLightColor(readLightColor(event.currentTarget.value))}
      />
    </div>
  `;
}

export function ObjectPanel({ id = 'object-panel' }) {
  const selectedItem = selectedSceneItem.value;
  const componentRows = selectedSceneItemComponentRows.value;
  const selectedName = readSelectedName();
  const hasSelection = Boolean(selectedItem);
  const isLightSelection = isSceneItemLight(selectedItem);
  const isPrimaryLightSelection = Boolean(selectedItem && String(selectedItem.id).toLowerCase() === 'light');
  const isPhysicsSupported = Boolean(selectedItem && !isLightSelection && isPhysicsRuntimeSupported(selectedItem));
  const isLocked = Boolean(selectedItem && selectedItem.isLocked);
  const arePhysicsControlsAvailable = Boolean(hasSelection && isPhysicsSupported && !isLocked);
  const rawPhysicsEnabled = selectedItem && (selectedItem.isPhysicsEnabled ?? selectedItem.physicsEnabled);
  const isPhysicsEnabled = Boolean(isPhysicsSupported && rawPhysicsEnabled !== false);
  const arePhysicsDetailsDisabled = !arePhysicsControlsAvailable || !isPhysicsEnabled;
  const physicsBodyType = normalizePhysicsBodyType(
    selectedItem && (selectedItem.physicsBodyType || selectedItem.bodyType),
    readDefaultPhysicsBodyType(selectedItem)
  );
  const areDynamicPhysicsControlsDisabled = arePhysicsDetailsDisabled || physicsBodyType !== PHYSICS_BODY_TYPES.DYNAMIC;
  const physicsMass = readPhysicsNumber(selectedItem, 'physicsMass', readPhysicsNumber(selectedItem, 'mass', DEFAULT_PHYSICS_MASS));
  const physicsGravityScale = readPhysicsNumber(
    selectedItem,
    'physicsGravityScale',
    readPhysicsNumber(selectedItem, 'gravityScale', DEFAULT_PHYSICS_GRAVITY_SCALE)
  );
  const physicsFriction = readPhysicsNumber(selectedItem, 'physicsFriction', readPhysicsNumber(selectedItem, 'friction', 0));
  const physicsRestitution = readPhysicsNumber(
    selectedItem,
    'physicsRestitution',
    readPhysicsNumber(selectedItem, 'restitution', 0)
  );
  const physicsHelpText = readPhysicsHelpText(
    selectedItem,
    isPhysicsSupported,
    isPhysicsEnabled,
    isLocked,
    physicsBodyType
  );
  const isEmissionConfigurableSelection = Boolean(
    selectedItem &&
    !isLightSelection &&
    Number.isFinite(Number(selectedItem.material))
  );
  const isEmissionEnabled = readEmissionEnabled(selectedItem);
  const areEmissionControlsDisabled = !isEmissionConfigurableSelection || isLocked;
  const areEmissionSettingsDisabled = areEmissionControlsDisabled || !isEmissionEnabled;
  const emissiveColor = readEmissiveColor(selectedItem);
  const emissiveIntensity = readEmissiveIntensity(selectedItem);
  const materialPresets = savedMaterialPresets.value;
  const materialPresetOptions = materialPresets.map((preset) => ({ value: preset.id, label: preset.label }));
  const selectedTextureChannel = selectedMaterialTextureChannel.value;
  const textureAssignments = materialTextureAssignments.value;
  const swapTextureChannel = MATERIAL_TEXTURE_CHANNELS.find((channel) => channel.key !== selectedTextureChannel)?.key ??
    selectedTextureChannel;
  const handleMaterialTextureFileChange = (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    setMaterialTextureAssignment(selectedTextureChannel, createTextureDescriptorFromFile(file, selectedTextureChannel));
    event.currentTarget.value = '';
  };
  const handleMaterialTextureSwap = (event) => {
    swapMaterialTextureAssignments(
      selectedTextureChannel,
      readElementValueById(event, 'material-texture-swap-channel') || swapTextureChannel
    );
  };

  return html`
    <div id=${id} className="control-panel" data-control-panel>
      <div className="control-section">
        <div className="section-title">Selected item</div>
        <div id="selected-item-name" className="selection-readout">${selectedName}</div>
        <div className="field" hidden=${isLightSelection}>
          <label for="selected-item-name-input">Name</label>
          <input id="selected-item-name-input" type="text" placeholder="Scene item" value=${selectedItem ? selectedName : ''} disabled=${!selectedItem} />
          <button type="button" data-action="rename-selection" disabled=${!selectedItem}>Rename</button>
        </div>
        <div className="button-row two-up">
          <button type="button" data-action="select-light">Light</button>
          <button type="button" data-action="delete-selection" disabled=${!selectedItem || isPrimaryLightSelection}>Delete</button>
        </div>
        <div className="button-row">
          <button type="button" data-action="duplicate-selection" disabled=${!selectedItem || isPrimaryLightSelection}>Duplicate</button>
          <button id="selection-hidden-toggle" type="button" data-action="toggle-selection-hidden" aria-pressed=${String(Boolean(selectedItem && selectedItem.isHidden))} disabled=${!selectedItem || isPrimaryLightSelection}>
            ${selectedItem && selectedItem.isHidden ? 'Show' : 'Hide'}
          </button>
          <button id="selection-lock-toggle" type="button" data-action="toggle-selection-locked" aria-pressed=${String(Boolean(selectedItem && selectedItem.isLocked))} disabled=${!selectedItem || isPrimaryLightSelection}>
            ${selectedItem && selectedItem.isLocked ? 'Unlock' : 'Lock'}
          </button>
        </div>
        <${NumberInputGroup}
          label="Position"
          inputs=${[
            { id: 'selected-position-x', min: '-2', max: '2', step: '0.05', placeholder: 'X', value: readPositionAxis(selectedItem, 0), disabled: !hasSelection },
            { id: 'selected-position-y', min: '-2', max: '2', step: '0.05', placeholder: 'Y', value: readPositionAxis(selectedItem, 1), disabled: !hasSelection },
            { id: 'selected-position-z', min: '-2', max: '2', step: '0.05', placeholder: 'Z', value: readPositionAxis(selectedItem, 2), disabled: !hasSelection }
          ]}
        />
        <div className="field" hidden=${isLightSelection}>
          <label for="selected-physics-enabled">Physics</label>
          <div className="button-row two-up">
            <label className="checkbox-field">
              <input id="selected-physics-enabled" type="checkbox" checked=${isPhysicsEnabled} disabled=${!arePhysicsControlsAvailable} />
              Enabled
            </label>
            <select id="selected-physics-body-type" aria-label="Physics body type" value=${physicsBodyType} disabled=${arePhysicsDetailsDisabled}>
              ${PHYSICS_BODY_OPTIONS.map((option) => html`
                <option key=${option.value} value=${option.value}>${option.label}</option>
              `)}
            </select>
          </div>
        </div>
        <${SliderField}
          id="selected-physics-mass"
          label="Mass"
          min=${MIN_PHYSICS_MASS}
          max=${MAX_PHYSICS_MASS}
          step=${0.1}
          value=${physicsMass}
          formatter=${fixed2}
          disabled=${areDynamicPhysicsControlsDisabled}
          hidden=${isLightSelection}
        />
        <${SliderField}
          id="selected-physics-gravity-scale"
          label="Gravity"
          min=${MIN_PHYSICS_GRAVITY_SCALE}
          max=${MAX_PHYSICS_GRAVITY_SCALE}
          step=${0.05}
          value=${physicsGravityScale}
          formatter=${fixed2}
          disabled=${areDynamicPhysicsControlsDisabled}
          hidden=${isLightSelection}
        />
        <${SliderField}
          id="selected-physics-friction"
          label="Friction"
          min=${0}
          max=${1}
          step=${0.01}
          value=${physicsFriction}
          formatter=${fixed2}
          disabled=${arePhysicsDetailsDisabled}
          hidden=${isLightSelection}
        />
        <${SliderField}
          id="selected-physics-restitution"
          label="Restitution"
          min=${0}
          max=${1}
          step=${0.01}
          value=${physicsRestitution}
          formatter=${fixed2}
          disabled=${arePhysicsDetailsDisabled}
          hidden=${isLightSelection}
        />
        <${CheckboxField}
          id="selected-physics-collide-with-objects"
          label="Collide with objects"
          checked=${selectedItem ? selectedItem.collideWithObjects !== false : true}
          disabled=${arePhysicsDetailsDisabled}
          hidden=${isLightSelection}
        />
        <div id="selected-physics-help" className="field-help" hidden=${isLightSelection}>
          ${physicsHelpText}
        </div>
      </div>

      ${isLightSelection ? html`<${LightSelectionControls} />` : null}

      <div className="control-section" hidden=${isLightSelection}>
        <div className="section-title">Components</div>
        ${selectedItem && componentRows.length > 0 ? componentRows.map((row) => html`
          <div key=${row.key} className="field component-row">
            <span>${row.label}</span>
            <strong>${row.summary || 'Attached'}</strong>
          </div>
        `) : html`<div className="selection-readout">No components</div>`}
      </div>

      <div className="control-section" hidden=${isLightSelection}>
        <${SelectField}
          id="material"
          label="Object shader"
          value=${material.value}
          options=${MATERIAL_OPTIONS}
          onChange=${(event) => setMaterial(Number.parseInt(event.currentTarget.value, 10))}
        >
          <button type="button" data-action="apply-object-shader" disabled=${!selectedItem}>Apply to Selection</button>
          <${SliderField}
            fieldId="glossiness-factor"
            id="glossiness"
            label="Glossiness"
            min=${0}
            max=${1}
            step=${0.01}
            signal=${glossiness}
            formatter=${fixed2}
          />
          <div id="emissive-controls" hidden=${!isEmissionConfigurableSelection}>
            <${CheckboxField}
              id="emission-enabled"
              label="Emission"
              checked=${isEmissionEnabled}
              disabled=${areEmissionControlsDisabled}
            />
            <${SliderField}
              id="emissive-intensity"
              label="Emission Strength"
              min=${0}
              max=${6}
              step=${0.05}
              value=${emissiveIntensity}
              formatter=${fixed2}
              disabled=${areEmissionSettingsDisabled}
            />
            <${ColorField}
              id="emissive-color"
              label="Emission Color"
              value=${formatLightColor(emissiveColor)}
              ariaLabel="Selected object emission color"
              disabled=${areEmissionSettingsDisabled}
            />
          </div>
        </${SelectField}>
      </div>

      <div className="control-section" data-material-preset-controls hidden=${isLightSelection}>
        <div className="section-title">Saved materials</div>
        <${SelectField}
          id="material-preset"
          label="Preset"
          value=${activeMaterialPresetId.value}
          options=${materialPresetOptions}
          onChange=${(event) => applyMaterialPreset(event.currentTarget.value)}
        >
          <div className="button-row two-up">
            <button type="button" data-action="apply-material-preset" onClick=${() => applyMaterialPreset(activeMaterialPresetId.value)}>Load Preset</button>
            <button
              type="button"
              data-action="save-material-preset"
              onClick=${(event) => saveMaterialPreset({ label: readMaterialPresetNameInput(event) })}
            >
              Save Current
            </button>
          </div>
          <input id="material-preset-name" type="text" placeholder="Preset name" aria-label="Material preset name" />
        </${SelectField}>
      </div>

      <div className="control-section" data-material-texture-controls hidden=${isLightSelection}>
        <div className="section-title">Textures</div>
        <${SelectField}
          id="material-texture-channel"
          label="Channel"
          value=${selectedTextureChannel}
          options=${textureChannelOptions}
          onChange=${(event) => setSelectedMaterialTextureChannel(event.currentTarget.value)}
        >
          <input
            id="material-texture-file"
            type="file"
            accept="image/*"
            data-action="assign-material-texture"
            data-texture-channel=${selectedTextureChannel}
            onChange=${handleMaterialTextureFileChange}
          />
        </${SelectField}>
        <${SelectField}
          id="material-uv-projection-mode"
          label="Projection"
          value=${materialUvProjectionMode.value}
          options=${uvProjectionModeOptions}
          onChange=${(event) => setMaterialUvProjectionMode(event.currentTarget.value)}
        />
        <${SliderField}
          id="material-uv-scale"
          label="UV Scale"
          min=${0.05}
          max=${64}
          step=${0.05}
          signal=${materialUvScale}
          formatter=${fixed2}
        />
        <${SliderField}
          id="material-uv-blend-sharpness"
          label="Tri-planar Blend"
          min=${1}
          max=${12}
          step=${0.25}
          signal=${materialUvBlendSharpness}
          formatter=${fixed2}
        />
        <${SelectField}
          id="material-texture-swap-channel"
          label="Swap with"
          value=${swapTextureChannel}
          options=${textureChannelOptions}
        >
          <button type="button" data-action="swap-material-textures" onClick=${handleMaterialTextureSwap}>Swap</button>
        </${SelectField}>
        ${MATERIAL_TEXTURE_CHANNELS.map((channel) => html`
          <div key=${channel.key} className="field material-texture-row" data-texture-channel=${channel.key}>
            <span>${channel.label}</span>
            <strong>${readTextureAssignmentName(textureAssignments, channel.key)}</strong>
            <button
              type="button"
              data-action="clear-material-texture"
              data-texture-channel=${channel.key}
              disabled=${!textureAssignments[channel.key]}
              onClick=${() => clearMaterialTextureAssignment(channel.key)}
            >
              Clear
            </button>
          </div>
        `)}
      </div>
    </div>
  `;
}
