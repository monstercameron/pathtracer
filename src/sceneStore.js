import { batch, computed, signal } from '@preact/signals';

const readItemId = (item, index) => {
  if (item && typeof item === 'object') {
    return item.entityId ?? item.id ?? `scene-item-${index}`;
  }
  return `scene-item-${index}`;
};

const readItemName = (item, index) => {
  if (item && typeof item === 'object') {
    return item.name ?? item.displayName ?? item.label ?? `Scene item #${index}`;
  }
  return `Scene item #${index}`;
};

const normalizeOptionalEntityId = (entityId) => (
  entityId === null || entityId === undefined || entityId === '' ? null : String(entityId)
);

const normalizeEntityIdList = (itemIds) => {
  const normalizedItemIds = [];
  const seenItemIds = new Set();
  for (const itemId of Array.isArray(itemIds) ? itemIds : []) {
    const normalizedItemId = normalizeOptionalEntityId(itemId);
    if (normalizedItemId !== null && !seenItemIds.has(normalizedItemId)) {
      seenItemIds.add(normalizedItemId);
      normalizedItemIds.push(normalizedItemId);
    }
  }
  return Object.freeze(normalizedItemIds);
};

const readParentEntityId = (item) => {
  if (!item || typeof item !== 'object') {
    return null;
  }
  return normalizeOptionalEntityId(item.parentEntityId);
};

const normalizeOptionalText = (value) => (
  value === null || value === undefined || value === '' ? null : String(value)
);

const readGroupName = (item) => {
  if (!item || typeof item !== 'object') {
    return null;
  }
  return normalizeOptionalText(item.groupName ?? item.group?.name ?? item.group?.label);
};

const readSceneItemKind = (item) => {
  if (!item || typeof item !== 'object') {
    return 'item';
  }
  const kind = item.kind ?? item.type ?? item.sceneItemKind;
  if (typeof kind === 'string' && kind.trim().toLowerCase() === 'group') {
    return 'group';
  }
  if (item.isGroup === true || Array.isArray(item.childEntityIds)) {
    return 'group';
  }
  return 'item';
};

const readDisplayOrder = (item, index = 0) => {
  if (!item || typeof item !== 'object') {
    return index;
  }
  const value = item.displayOrder ?? item.displayIndex ?? item.order ?? item.index;
  return Number.isFinite(value) ? value : index;
};

const compareSceneItemsForDisplay = (left, right) => {
  const leftOrder = readDisplayOrder(left, left.index ?? 0);
  const rightOrder = readDisplayOrder(right, right.index ?? 0);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftIndex = Number.isFinite(left.index) ? left.index : 0;
  const rightIndex = Number.isFinite(right.index) ? right.index : 0;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return String(left.id).localeCompare(String(right.id));
};

const sortSceneItemsForDisplay = (items) => [...items].sort(compareSceneItemsForDisplay);

const DEFAULT_GROUP_POSITION = Object.freeze([0, 0, 0]);
const DEFAULT_GROUP_ROTATION = Object.freeze([0, 0, 0]);
const DEFAULT_GROUP_SCALE = Object.freeze([1, 1, 1]);

const normalizeFiniteNumber = (value, fallbackValue = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
};

const normalizeNumberVector = (value, fallbackValue) => {
  const sourceValues = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [];
  return Object.freeze(fallbackValue.map((fallbackEntry, index) => (
    normalizeFiniteNumber(sourceValues[index], fallbackEntry)
  )));
};

export const TRANSFORM_ANIMATION_COMPONENT_TYPE = 'procedural-transform-animation';
export const TRANSFORM_ANIMATION_TYPES = Object.freeze({
  SPIN: 'spin',
  BOB: 'bob',
  PULSE: 'pulse',
  ORBIT: 'orbit',
  WOBBLE: 'wobble'
});
export const TRANSFORM_ANIMATION_TYPE_OPTIONS = Object.freeze([
  Object.freeze({ value: TRANSFORM_ANIMATION_TYPES.SPIN, label: 'Spin' }),
  Object.freeze({ value: TRANSFORM_ANIMATION_TYPES.BOB, label: 'Bob' }),
  Object.freeze({ value: TRANSFORM_ANIMATION_TYPES.PULSE, label: 'Pulse' }),
  Object.freeze({ value: TRANSFORM_ANIMATION_TYPES.ORBIT, label: 'Orbit' }),
  Object.freeze({ value: TRANSFORM_ANIMATION_TYPES.WOBBLE, label: 'Wobble' })
]);

const TRANSFORM_ANIMATION_LABELS = Object.freeze(new Map(
  TRANSFORM_ANIMATION_TYPE_OPTIONS.map((option) => [option.value, option.label])
));
const TRANSFORM_ANIMATION_DEFAULT_CONFIGS = Object.freeze({
  [TRANSFORM_ANIMATION_TYPES.SPIN]: Object.freeze({
    speedDegreesPerSecond: 45,
    phaseDegrees: 0
  }),
  [TRANSFORM_ANIMATION_TYPES.BOB]: Object.freeze({
    amplitude: 0.12,
    frequencyHertz: 1,
    phaseDegrees: 0
  }),
  [TRANSFORM_ANIMATION_TYPES.PULSE]: Object.freeze({
    amplitude: 0.12,
    frequencyHertz: 1,
    phaseDegrees: 0
  }),
  [TRANSFORM_ANIMATION_TYPES.ORBIT]: Object.freeze({
    center: Object.freeze([0, 0, 0]),
    radius: 1,
    speedDegreesPerSecond: 30,
    phaseDegrees: 0
  }),
  [TRANSFORM_ANIMATION_TYPES.WOBBLE]: Object.freeze({
    amplitudeDegrees: 4,
    frequencyHertz: 8,
    seed: 1
  })
});

const TRANSFORM_ANIMATION_TYPE_SET = Object.freeze(new Set(Object.values(TRANSFORM_ANIMATION_TYPES)));
const TRANSFORM_ANIMATION_FULL_TURN_DEGREES = 360;

const normalizeNonNegativeNumber = (value, fallbackValue = 0) => (
  Math.max(0, normalizeFiniteNumber(value, fallbackValue))
);

const normalizeTransformAnimationType = (value, fallbackType = TRANSFORM_ANIMATION_TYPES.SPIN) => {
  const normalizedType = String(value ?? '').trim().toLowerCase();
  return TRANSFORM_ANIMATION_TYPE_SET.has(normalizedType) ? normalizedType : fallbackType;
};

const readTransformAnimationLabel = (type) => (
  TRANSFORM_ANIMATION_LABELS.get(type) ?? TRANSFORM_ANIMATION_LABELS.get(TRANSFORM_ANIMATION_TYPES.SPIN)
);

const readTransformAnimationFrequency = (source, fallbackValue) => (
  normalizeNonNegativeNumber(source.frequencyHertz ?? source.frequency ?? source.cyclesPerSecond, fallbackValue)
);

const readTransformAnimationSpeed = (source, fallbackValue) => (
  normalizeFiniteNumber(source.speedDegreesPerSecond ?? source.speed ?? source.degreesPerSecond, fallbackValue)
);

const readTransformAnimationPhase = (source, fallbackValue) => (
  normalizeFiniteNumber(source.phaseDegrees ?? source.phase ?? source.offsetDegrees, fallbackValue)
);

const normalizeTransformAnimationConfig = (type, config = {}) => {
  const source = config && typeof config === 'object' ? config : {};
  const defaultConfig = TRANSFORM_ANIMATION_DEFAULT_CONFIGS[type] ?? TRANSFORM_ANIMATION_DEFAULT_CONFIGS[TRANSFORM_ANIMATION_TYPES.SPIN];

  if (type === TRANSFORM_ANIMATION_TYPES.BOB) {
    return Object.freeze({
      amplitude: normalizeNonNegativeNumber(source.amplitude ?? source.height, defaultConfig.amplitude),
      frequencyHertz: readTransformAnimationFrequency(source, defaultConfig.frequencyHertz),
      phaseDegrees: readTransformAnimationPhase(source, defaultConfig.phaseDegrees)
    });
  }

  if (type === TRANSFORM_ANIMATION_TYPES.PULSE) {
    return Object.freeze({
      amplitude: Math.min(normalizeNonNegativeNumber(source.amplitude ?? source.scaleAmplitude, defaultConfig.amplitude), 0.95),
      frequencyHertz: readTransformAnimationFrequency(source, defaultConfig.frequencyHertz),
      phaseDegrees: readTransformAnimationPhase(source, defaultConfig.phaseDegrees)
    });
  }

  if (type === TRANSFORM_ANIMATION_TYPES.ORBIT) {
    return Object.freeze({
      center: normalizeNumberVector(source.center ?? source.centerPosition ?? source.origin, defaultConfig.center),
      radius: normalizeNonNegativeNumber(source.radius, defaultConfig.radius),
      speedDegreesPerSecond: readTransformAnimationSpeed(source, defaultConfig.speedDegreesPerSecond),
      phaseDegrees: readTransformAnimationPhase(source, defaultConfig.phaseDegrees)
    });
  }

  if (type === TRANSFORM_ANIMATION_TYPES.WOBBLE) {
    return Object.freeze({
      amplitudeDegrees: normalizeNonNegativeNumber(source.amplitudeDegrees ?? source.amplitude, defaultConfig.amplitudeDegrees),
      frequencyHertz: readTransformAnimationFrequency(source, defaultConfig.frequencyHertz),
      seed: normalizeFiniteNumber(source.seed, defaultConfig.seed)
    });
  }

  return Object.freeze({
    speedDegreesPerSecond: readTransformAnimationSpeed(source, defaultConfig.speedDegreesPerSecond),
    phaseDegrees: readTransformAnimationPhase(source, defaultConfig.phaseDegrees)
  });
};

const formatTransformAnimationNumber = (value) => {
  const normalizedValue = normalizeFiniteNumber(value, 0);
  return Number.isInteger(normalizedValue) ? String(normalizedValue) : normalizedValue.toFixed(2).replace(/\.?0+$/u, '');
};

export const formatTransformAnimationConfigSummary = (component) => {
  if (!component || typeof component !== 'object') {
    return '';
  }
  const type = normalizeTransformAnimationType(component.animationType ?? component.type);
  const config = normalizeTransformAnimationConfig(type, component.config);

  if (type === TRANSFORM_ANIMATION_TYPES.BOB) {
    return `${formatTransformAnimationNumber(config.amplitude)}u at ${formatTransformAnimationNumber(config.frequencyHertz)} Hz`;
  }
  if (type === TRANSFORM_ANIMATION_TYPES.PULSE) {
    return `${formatTransformAnimationNumber(config.amplitude * 100)}% at ${formatTransformAnimationNumber(config.frequencyHertz)} Hz`;
  }
  if (type === TRANSFORM_ANIMATION_TYPES.ORBIT) {
    return `r ${formatTransformAnimationNumber(config.radius)}, ${formatTransformAnimationNumber(config.speedDegreesPerSecond)} deg/s`;
  }
  if (type === TRANSFORM_ANIMATION_TYPES.WOBBLE) {
    return `${formatTransformAnimationNumber(config.amplitudeDegrees)} deg at ${formatTransformAnimationNumber(config.frequencyHertz)} Hz`;
  }
  return `${formatTransformAnimationNumber(config.speedDegreesPerSecond)} deg/s`;
};

export class TransformAnimationComponent {
  constructor(options = {}) {
    const type = normalizeTransformAnimationType(options.animationType ?? options.type ?? options.kind);
    const config = normalizeTransformAnimationConfig(type, options.config ?? options);
    const label = normalizeOptionalText(options.label ?? options.name) ?? readTransformAnimationLabel(type);
    this.id = normalizeOptionalText(options.id) ?? `transform-${type}`;
    this.componentType = TRANSFORM_ANIMATION_COMPONENT_TYPE;
    this.kind = 'animation';
    this.type = type;
    this.animationType = type;
    this.label = label;
    this.name = label;
    this.enabled = options.enabled !== false;
    this.config = config;
    this.summary = `${this.enabled ? 'On' : 'Off'}: ${formatTransformAnimationConfigSummary({ type, config })}`;
  }
}

const normalizeTransformAnimationComponent = (component, index = 0) => {
  const source = component && typeof component === 'object' ? component : {};
  const type = normalizeTransformAnimationType(source.animationType ?? source.type ?? source.kind);
  const id = normalizeOptionalText(source.id) ?? `transform-${type}-${index + 1}`;
  return Object.freeze(new TransformAnimationComponent({
    ...source,
    id,
    type,
    config: source.config ?? source.parameters ?? source.settings ?? source,
    enabled: source.enabled !== false
  }));
};

export const normalizeTransformAnimationComponents = (value) => {
  const sourceComponents = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? [value] : []);
  return Object.freeze(sourceComponents.map((component, index) => normalizeTransformAnimationComponent(component, index)));
};

export const readSceneItemTransformAnimations = (item) => {
  if (!item || typeof item !== 'object') {
    return Object.freeze([]);
  }

  const animationSources = [
    item.transformAnimations,
    item.proceduralTransformAnimations,
    item.components?.transformAnimations,
    item.components?.proceduralTransformAnimations,
    item.animationComponent?.componentType === TRANSFORM_ANIMATION_COMPONENT_TYPE ? item.animationComponent : null,
    item.components?.animation?.componentType === TRANSFORM_ANIMATION_COMPONENT_TYPE ? item.components.animation : null
  ];

  for (const animationSource of animationSources) {
    const animations = normalizeTransformAnimationComponents(animationSource);
    if (animations.length > 0) {
      return animations;
    }
  }
  return Object.freeze([]);
};

const readSceneItemPosition = (item) => {
  const position = item && (item.centerPosition ?? item.position ?? item.translation);
  return Array.isArray(position) || ArrayBuffer.isView(position) ? Array.from(position) : null;
};

const readSceneItemAuthoredPosition = (item) => normalizeNumberVector(readSceneItemPosition(item), DEFAULT_GROUP_POSITION);

const readSceneItemAuthoredRotationDegrees = (item) => normalizeNumberVector(
  item && (item.rotationEulerDegrees ?? item.rotationEuler ?? item.rotation),
  DEFAULT_GROUP_ROTATION
);

const readSceneItemAuthoredScale = (item) => {
  const scale = item && (item.scale ?? item.uniformScale);
  if (typeof scale === 'number') {
    return Object.freeze([scale, scale, scale].map((value) => normalizeFiniteNumber(value, 1)));
  }
  return normalizeNumberVector(scale, DEFAULT_GROUP_SCALE);
};

export const readSceneItemAuthoredTransform = (item) => Object.freeze({
  position: readSceneItemAuthoredPosition(item),
  rotationEulerDegrees: readSceneItemAuthoredRotationDegrees(item),
  scale: readSceneItemAuthoredScale(item)
});

const readAnimationElapsedSeconds = (elapsedSeconds) => normalizeFiniteNumber(elapsedSeconds, 0);
const degreesToRadians = (degrees) => degrees * (Math.PI / 180);
const readCycleAngleRadians = (frequencyHertz, elapsedSeconds, phaseDegrees = 0) => (
  (Math.PI * 2 * frequencyHertz * elapsedSeconds) + degreesToRadians(phaseDegrees)
);

const freezeTransformVector = (value) => Object.freeze(value.map((entry) => normalizeFiniteNumber(entry, 0)));

export const evaluateSceneItemTransformAnimations = (
  item,
  elapsedSeconds = 0,
  authoredTransform = readSceneItemAuthoredTransform(item)
) => {
  const seconds = readAnimationElapsedSeconds(elapsedSeconds);
  const basePosition = normalizeNumberVector(authoredTransform.position, DEFAULT_GROUP_POSITION);
  const baseRotation = normalizeNumberVector(authoredTransform.rotationEulerDegrees, DEFAULT_GROUP_ROTATION);
  const baseScale = normalizeNumberVector(authoredTransform.scale, DEFAULT_GROUP_SCALE);
  const position = Array.from(basePosition);
  const rotationEulerDegrees = Array.from(baseRotation);
  const scale = Array.from(baseScale);
  const appliedAnimationIds = [];

  for (const component of readSceneItemTransformAnimations(item)) {
    if (!component.enabled) {
      continue;
    }

    const type = normalizeTransformAnimationType(component.animationType ?? component.type);
    const config = normalizeTransformAnimationConfig(type, component.config);
    appliedAnimationIds.push(component.id);

    if (type === TRANSFORM_ANIMATION_TYPES.BOB) {
      const angle = readCycleAngleRadians(config.frequencyHertz, seconds, config.phaseDegrees);
      position[1] += Math.sin(angle) * config.amplitude;
    } else if (type === TRANSFORM_ANIMATION_TYPES.PULSE) {
      const angle = readCycleAngleRadians(config.frequencyHertz, seconds, config.phaseDegrees);
      const multiplier = Math.max(0.05, 1 + (Math.sin(angle) * config.amplitude));
      scale[0] *= multiplier;
      scale[1] *= multiplier;
      scale[2] *= multiplier;
    } else if (type === TRANSFORM_ANIMATION_TYPES.ORBIT) {
      const orbitAngle = degreesToRadians((config.speedDegreesPerSecond * seconds) + config.phaseDegrees);
      const currentYDelta = position[1] - basePosition[1];
      position[0] = config.center[0] + Math.cos(orbitAngle) * config.radius;
      position[1] = config.center[1] + currentYDelta;
      position[2] = config.center[2] + Math.sin(orbitAngle) * config.radius;
    } else if (type === TRANSFORM_ANIMATION_TYPES.WOBBLE) {
      const wobbleAngle = readCycleAngleRadians(config.frequencyHertz, seconds, config.seed * TRANSFORM_ANIMATION_FULL_TURN_DEGREES);
      rotationEulerDegrees[0] += Math.sin(wobbleAngle + config.seed * 12.9898) * config.amplitudeDegrees;
      rotationEulerDegrees[1] += Math.sin(wobbleAngle * 0.73 + config.seed * 37.719) * config.amplitudeDegrees * 0.35;
      rotationEulerDegrees[2] += Math.sin(wobbleAngle * 1.37 + config.seed * 78.233) * config.amplitudeDegrees;
    } else {
      rotationEulerDegrees[1] += (config.speedDegreesPerSecond * seconds) + config.phaseDegrees;
    }
  }

  return Object.freeze({
    position: freezeTransformVector(position),
    rotationEulerDegrees: freezeTransformVector(rotationEulerDegrees),
    scale: freezeTransformVector(scale),
    appliedAnimationIds: Object.freeze(appliedAnimationIds)
  });
};

const readSceneItemsPivot = (items) => {
  const positions = items.map(readSceneItemPosition).filter(Boolean);
  if (positions.length === 0) {
    return DEFAULT_GROUP_POSITION;
  }

  const pivot = positions.reduce((sum, position) => [
    sum[0] + normalizeFiniteNumber(position[0]),
    sum[1] + normalizeFiniteNumber(position[1]),
    sum[2] + normalizeFiniteNumber(position[2])
  ], [0, 0, 0]);
  return Object.freeze(pivot.map((value) => value / positions.length));
};

const createGroupComponentMap = (childEntityIds, components = null) => {
  const childCount = childEntityIds.length;
  const componentMap = components && typeof components === 'object' && !Array.isArray(components)
    ? { ...components }
    : {};
  componentMap.group = Object.freeze({
    label: 'Group',
    summary: `${childCount} ${childCount === 1 ? 'child' : 'children'}`
  });
  return Object.freeze(componentMap);
};

export class GroupEntity {
  constructor(options = {}) {
    const entityId = normalizeOptionalEntityId(options.entityId ?? options.id) ?? 'group';
    const childEntityIds = normalizeEntityIdList(options.childEntityIds);
    this.id = entityId;
    this.entityId = entityId;
    this.objectId = entityId;
    this.index = Number.isFinite(options.index) ? options.index : 0;
    this.name = normalizeOptionalText(options.name ?? options.displayName) ?? 'Group';
    this.displayName = this.name;
    this.parentEntityId = normalizeOptionalEntityId(options.parentEntityId);
    this.groupName = normalizeOptionalText(options.groupName);
    this.sceneItemKind = 'group';
    this.kind = 'group';
    this.type = 'group';
    this.isGroup = true;
    this.childEntityIds = childEntityIds;
    this.displayOrder = Number.isFinite(options.displayOrder) ? options.displayOrder : this.index;
    this.centerPosition = normalizeNumberVector(
      options.centerPosition ?? options.position ?? options.translation,
      DEFAULT_GROUP_POSITION
    );
    this.position = this.centerPosition;
    this.rotation = normalizeNumberVector(options.rotation, DEFAULT_GROUP_ROTATION);
    this.scale = normalizeNumberVector(options.scale, DEFAULT_GROUP_SCALE);
    this.isHidden = Boolean(options.isHidden);
    this.isLocked = Boolean(options.isLocked);
    this.physicsRigidBody = options.physicsRigidBody ?? null;
    this.isPhysicsEnabled = Boolean(options.isPhysicsEnabled ?? options.physicsEnabled);
    this.physicsBodyType = normalizeOptionalText(options.physicsBodyType ?? options.bodyType) ?? 'static';
    this.physicsMass = normalizeFiniteNumber(options.physicsMass ?? options.mass, childEntityIds.length || 1);
    this.physicsFriction = normalizeFiniteNumber(options.physicsFriction ?? options.friction, 0);
    this.physicsRestitution = normalizeFiniteNumber(options.physicsRestitution ?? options.restitution, 0);
    this.physicsLinearDamping = normalizeFiniteNumber(options.physicsLinearDamping ?? options.linearDamping, 0);
    this.physicsAngularDamping = normalizeFiniteNumber(options.physicsAngularDamping ?? options.angularDamping, 0);
    this.components = createGroupComponentMap(childEntityIds, options.components);
  }
}

const MATERIAL_LABELS = Object.freeze(new Map([
  [0, 'Diffuse'],
  [1, 'Mirror'],
  [2, 'Glossy'],
  [3, 'Glass'],
  [4, 'GGX PBR'],
  [5, 'Spectral Glass'],
  [6, 'Subsurface'],
  [7, 'Caustics'],
  [8, 'Procedural Pack'],
  [9, 'SDF Fractal'],
  [10, 'Volumetric Shafts'],
  [11, 'Bokeh'],
  [12, 'Motion Blur Stress'],
  [13, 'Fire Plasma'],
  [14, 'Thin Film'],
  [15, 'Retroreflector'],
  [16, 'Velvet Sheen'],
  [17, 'Voronoi Cracks'],
  [18, 'Diffraction Grating'],
  [19, 'Anisotropic GGX'],
  [20, 'Blackbody'],
  [21, 'Emissive'],
  [22, 'Toon'],
  [23, 'X-Ray']
]));

const isListLikeComponentValue = (value) => (
  Array.isArray(value) || ArrayBuffer.isView(value)
);

const formatComponentLabel = (value) => String(value ?? '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')
  .split(' ')
  .filter(Boolean)
  .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
  .join(' ');

const formatComponentNumber = (value) => (
  Number.isInteger(value) ? String(value) : value.toFixed(2)
);

const formatComponentObjectEntries = (value, depth, excludedKeys = new Set()) => (
  Object.entries(value)
    .filter(([key, entry]) => (
      !excludedKeys.has(key) &&
      entry !== null &&
      entry !== undefined &&
      entry !== '' &&
      typeof entry !== 'function'
    ))
    .slice(0, 3)
    .map(([key, entry]) => {
      const summary = formatComponentValue(entry, depth + 1);
      return summary ? `${formatComponentLabel(key)}: ${summary}` : '';
    })
    .filter(Boolean)
    .join(', ')
);

const formatComponentObjectValue = (value, depth) => {
  if (depth > 1) {
    return '';
  }

  const namedValue = value.name ?? value.displayName ?? value.label ?? value.type ?? value.kind ?? value.id;
  if (namedValue !== null && namedValue !== undefined && namedValue !== '') {
    return formatComponentValue(namedValue, depth + 1);
  }

  return formatComponentObjectEntries(value, depth);
};

const formatComponentValue = (value, depth = 0) => {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (isListLikeComponentValue(value)) {
    const values = Array.from(value);
    const visibleValues = values
      .slice(0, 4)
      .map((entry) => formatComponentValue(entry, depth + 1))
      .filter(Boolean);
    const suffix = values.length > 4 ? `${visibleValues.length > 0 ? ', ' : ''}...` : '';
    return `${visibleValues.join(', ')}${suffix}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? formatComponentNumber(value) : '';
  }
  if (typeof value === 'object') {
    return formatComponentObjectValue(value, depth);
  }
  return String(value);
};

const readComponentName = (component, index, fallbackName = null) => {
  if (typeof component === 'string') {
    return formatComponentLabel(component) || component;
  }
  if (component && typeof component === 'object') {
    return formatComponentLabel(
      component.label ?? component.name ?? component.type ?? component.kind ?? fallbackName ?? `Component ${index + 1}`
    );
  }
  return formatComponentLabel(fallbackName ?? `Component ${index + 1}`);
};

const readComponentSummary = (component) => {
  if (!component || typeof component !== 'object' || typeof component === 'string') {
    return '';
  }

  const directSummary = component.summary ?? component.value ?? component.status ?? component.enabled;
  const formattedSummary = formatComponentValue(directSummary);
  if (formattedSummary) {
    return formattedSummary;
  }

  return formatComponentObjectEntries(component, 0, new Set(['id', 'kind', 'label', 'name', 'type']));
};

export const readSceneItemTypeName = (item) => {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const constructorName = item.source?.constructor?.name ?? item.constructor?.name ?? '';
  return String(
    item.kind ??
    item.type ??
    item.primitiveType ??
    item.componentType ??
    item.sceneItemKind ??
    (constructorName === 'Object' ? '' : constructorName) ??
    ''
  );
};

export const isSceneItemLight = (item) => {
  if (!item || typeof item !== 'object') {
    return false;
  }
  if (String(item.id ?? item.entityId ?? '').toLowerCase() === 'light') {
    return true;
  }
  const searchableText = [
    readSceneItemTypeName(item),
    item.name,
    item.displayName,
    item.label
  ].filter(Boolean).join(' ');
  return /light/i.test(searchableText);
};

const addComponentRow = (rows, key, label, value) => {
  const summary = formatComponentValue(value);
  if (summary && !rows.some((row) => row.key === key)) {
    rows.push(Object.freeze({ key, label: formatComponentLabel(label), summary }));
  }
};

const readMaterialSummary = (item) => {
  const materialValue = item.materialName ?? item.materialLabel ?? item.material;
  if (typeof materialValue === 'number' && MATERIAL_LABELS.has(materialValue)) {
    return MATERIAL_LABELS.get(materialValue);
  }
  return materialValue;
};

export const summarizeTransformAnimationStack = (animations) => {
  const transformAnimations = normalizeTransformAnimationComponents(animations);
  if (transformAnimations.length === 0) {
    return '';
  }

  if (transformAnimations.length === 1) {
    const [animation] = transformAnimations;
    return `${animation.label} (${animation.enabled ? 'on' : 'off'})`;
  }

  const enabledCount = transformAnimations.filter((animation) => animation.enabled).length;
  const visibleLabels = transformAnimations
    .slice(0, 3)
    .map((animation) => animation.label)
    .join(', ');
  const suffix = transformAnimations.length > 3 ? ', ...' : '';
  return `${enabledCount}/${transformAnimations.length} enabled: ${visibleLabels}${suffix}`;
};

const readAnimationSummary = (item) => {
  const transformAnimations = readSceneItemTransformAnimations(item);
  const transformAnimationSummary = summarizeTransformAnimationStack(transformAnimations);
  if (transformAnimationSummary) {
    return transformAnimationSummary;
  }

  const animationValue = (
    item.animationName ??
    item.animationLabel ??
    item.animation?.name ??
    item.animation?.label ??
    item.animationComponent?.name ??
    item.animationComponent?.label ??
    item.animationClip?.name ??
    item.animationClip?.label
  );
  if (animationValue !== null && animationValue !== undefined && animationValue !== '') {
    return animationValue;
  }

  const animationComponent = item.components?.animation ?? item.components?.Animation;
  return animationComponent ? readComponentSummary(animationComponent) || readComponentName(animationComponent, 0, 'Animation') : '';
};

const readPhysicsSummary = (item, physicsEnabled) => {
  const explicitBodyType = item.physicsBodyType ?? item.bodyType;
  if (explicitBodyType !== null && explicitBodyType !== undefined && explicitBodyType !== '') {
    return explicitBodyType;
  }

  const rigidBodyType = item.physicsRigidBody && typeof item.physicsRigidBody === 'object'
    ? item.physicsRigidBody.bodyType ?? item.physicsRigidBody.type ?? item.physicsRigidBody.status
    : null;
  if (typeof rigidBodyType === 'function') {
    return 'Attached';
  }
  return rigidBodyType ?? physicsEnabled ?? 'Attached';
};

const addTransformAnimationComponentRows = (rows, item) => {
  readSceneItemTransformAnimations(item).forEach((component, index) => {
    rows.push(Object.freeze({
      key: `animation-${component.id}`,
      label: component.label || `Animation ${index + 1}`,
      summary: component.summary
    }));
  });
};

const addExplicitComponentRows = (rows, components) => {
  if (Array.isArray(components)) {
    components.forEach((component, index) => {
      const label = readComponentName(component, index);
      rows.push(Object.freeze({
        key: `component-${index}`,
        label,
        summary: readComponentSummary(component)
      }));
    });
  } else if (components && typeof components === 'object') {
    Object.entries(components).forEach(([componentKey, component], index) => {
      const label = readComponentName(component, index, componentKey);
      rows.push(Object.freeze({
        key: `component-${componentKey}`,
        label,
        summary: readComponentSummary(component)
      }));
    });
  }
};

export const readSceneItemComponentRows = (item) => {
  if (!item || typeof item !== 'object') {
    return Object.freeze([]);
  }

  const rows = [];
  addComponentRow(rows, 'type', 'Type', item.primitiveType ?? item.type ?? item.kind ?? readSceneItemTypeName(item));
  if (isSceneItemLight(item)) {
    addComponentRow(rows, 'light', 'Light', 'Emitter');
  }
  addComponentRow(rows, 'parent', 'Parent', item.parentEntityId);
  addComponentRow(rows, 'display-order', 'Display Order', item.displayOrder);
  addComponentRow(rows, 'mesh', 'Mesh', item.meshName ?? item.objectName);
  addComponentRow(rows, 'group', 'Group', item.groupName);
  addComponentRow(rows, 'material', 'Material', readMaterialSummary(item));
  addComponentRow(rows, 'triangles', 'Triangles', item.triangleCount ?? item.triangles?.length);
  addComponentRow(rows, 'position', 'Position', item.centerPosition ?? item.position ?? item.translation);
  addComponentRow(rows, 'size', 'Size', item.scale ?? item.size ?? item.radius ?? item.radii ?? item.halfExtents ?? item.boundsHalfExtents);

  const status = [
    item.isHidden ? 'Hidden' : 'Visible',
    item.isLocked ? 'Locked' : 'Editable'
  ].join(', ');
  addComponentRow(rows, 'visibility', 'Visibility', status);

  const physicsEnabled = item.isPhysicsEnabled ?? item.physicsEnabled;
  if (physicsEnabled !== undefined || item.physicsBodyType || item.bodyType || item.physicsRigidBody) {
    addComponentRow(rows, 'physics', 'Physics', readPhysicsSummary(item, physicsEnabled));
  }
  addComponentRow(rows, 'animation', 'Animation', readAnimationSummary(item));
  addTransformAnimationComponentRows(rows, item);

  addExplicitComponentRows(rows, item.components);

  return Object.freeze(rows);
};

export const normalizeSceneItem = (item, index = 0) => {
  const id = String(readItemId(item, index));
  if (!item || typeof item !== 'object') {
    return Object.freeze({
      id,
      index,
      name: readItemName(item, index),
      parentEntityId: null,
      groupName: null,
      sceneItemKind: 'item',
      displayOrder: index,
      isHidden: false,
      isLocked: false,
      source: item
    });
  }

  const sceneItemKind = readSceneItemKind(item);
  const childEntityIds = sceneItemKind === 'group'
    ? normalizeEntityIdList(item.childEntityIds)
    : undefined;
  const transformAnimations = readSceneItemTransformAnimations(item);

  return Object.freeze({
    ...item,
    id,
    index: item.index ?? index,
    name: readItemName(item, index),
    parentEntityId: readParentEntityId(item),
    groupName: readGroupName(item),
    sceneItemKind,
    displayOrder: readDisplayOrder(item, index),
    isHidden: Boolean(item.isHidden),
    isLocked: Boolean(item.isLocked),
    ...(sceneItemKind === 'group'
      ? {
        childEntityIds,
        components: createGroupComponentMap(childEntityIds, item.components)
      }
      : {}),
    transformAnimations: transformAnimations.length > 0 ? transformAnimations : undefined,
    source: item
  });
};

const isSceneGroupItem = (item) => (
  Boolean(item) &&
  (
    item.sceneItemKind === 'group' ||
    item.isGroup === true ||
    Array.isArray(item.childEntityIds)
  )
);

const writeSceneItemSourceFields = (item, fields) => {
  const source = item && item.source && typeof item.source === 'object' ? item.source : null;
  if (!source || Object.isFrozen(source)) {
    return;
  }

  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    try {
      source[fieldName] = fieldValue;
    } catch {
      // Runtime scene objects may expose read-only fields; the immutable store copy remains authoritative.
    }
  }
};

const assignSceneItemFields = (item, fields) => {
  writeSceneItemSourceFields(item, fields);
  return Object.freeze({
    ...item,
    ...fields
  });
};

export const sceneItems = signal([]);
export const selectedItemId = signal(null);
export const selectedItemIds = signal(Object.freeze([]));

const normalizeSelectedItemIds = normalizeEntityIdList;

const areSelectedItemIdsEqual = (leftItemIds, rightItemIds) => (
  leftItemIds.length === rightItemIds.length &&
  leftItemIds.every((itemId, index) => itemId === rightItemIds[index])
);

const readSceneItemSubtreeIds = (rootItemIds, items = sceneItems.value) => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const childIdsByParentId = new Map();
  for (const item of sortSceneItemsForDisplay(items)) {
    const parentId = normalizeOptionalEntityId(item.parentEntityId);
    if (parentId === null) {
      continue;
    }
    if (!childIdsByParentId.has(parentId)) {
      childIdsByParentId.set(parentId, []);
    }
    childIdsByParentId.get(parentId).push(item.id);
  }

  const subtreeIds = [];
  const seenItemIds = new Set();
  const visitItem = (itemId) => {
    const normalizedItemId = normalizeOptionalEntityId(itemId);
    if (
      normalizedItemId === null ||
      seenItemIds.has(normalizedItemId) ||
      !itemById.has(normalizedItemId)
    ) {
      return;
    }
    seenItemIds.add(normalizedItemId);
    subtreeIds.push(normalizedItemId);
    for (const childItemId of childIdsByParentId.get(normalizedItemId) ?? []) {
      visitItem(childItemId);
    }
  };

  normalizeSelectedItemIds(rootItemIds).forEach(visitItem);
  return Object.freeze(subtreeIds);
};

export const expandSceneSelectionIds = (itemIds, items = sceneItems.value) => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const expandedItemIds = [];
  const seenItemIds = new Set();
  for (const itemId of normalizeSelectedItemIds(itemIds)) {
    const item = itemById.get(itemId);
    const nextItemIds = isSceneGroupItem(item)
      ? readSceneItemSubtreeIds([itemId], items)
      : [itemId];
    for (const nextItemId of nextItemIds) {
      if (!seenItemIds.has(nextItemId)) {
        seenItemIds.add(nextItemId);
        expandedItemIds.push(nextItemId);
      }
    }
  }
  return Object.freeze(expandedItemIds);
};

const commitSceneSelection = (itemIds, primaryItemId = selectedItemId.value) => {
  let nextSelectedItemIds = expandSceneSelectionIds(itemIds);
  let nextPrimaryItemId = normalizeOptionalEntityId(primaryItemId);

  if (nextPrimaryItemId !== null && !nextSelectedItemIds.includes(nextPrimaryItemId)) {
    nextSelectedItemIds = expandSceneSelectionIds([nextPrimaryItemId, ...nextSelectedItemIds]);
  }
  if (nextPrimaryItemId === null && nextSelectedItemIds.length > 0) {
    nextPrimaryItemId = nextSelectedItemIds[0];
  }

  if (!areSelectedItemIdsEqual(selectedItemIds.value, nextSelectedItemIds)) {
    selectedItemIds.value = nextSelectedItemIds;
  }
  if (selectedItemId.value !== nextPrimaryItemId) {
    selectedItemId.value = nextPrimaryItemId;
  }
};

export const selectedSceneItem = computed(() => {
  const selectedId = selectedItemId.value;
  if (selectedId === null || selectedId === undefined) {
    return null;
  }
  return sceneItems.value.find((item) => item.id === String(selectedId)) || null;
});

export const selectedSceneItems = computed(() => {
  if (selectedItemIds.value.length === 0) {
    return Object.freeze([]);
  }

  const itemById = new Map(sceneItems.value.map((item) => [item.id, item]));
  return Object.freeze(selectedItemIds.value.map((itemId) => itemById.get(itemId)).filter(Boolean));
});

export const sceneItemCountLabel = computed(() => {
  const itemCount = sceneItems.value.length;
  return `${itemCount} scene ${itemCount === 1 ? 'item' : 'items'}`;
});

const wouldCreateSceneTreeCycle = (itemId, parentId, itemById) => {
  const visitedParentIds = new Set();
  let currentParentId = parentId;
  while (currentParentId !== null) {
    if (currentParentId === itemId) {
      return true;
    }
    if (visitedParentIds.has(currentParentId)) {
      return true;
    }
    visitedParentIds.add(currentParentId);
    const parentItem = itemById.get(currentParentId);
    currentParentId = parentItem ? parentItem.parentEntityId : null;
  }
  return false;
};

const readDeclaredGroupParentsByChildId = (items, itemById) => {
  const parentByChildId = new Map();
  for (const item of items) {
    if (!isSceneGroupItem(item)) {
      continue;
    }
    for (const childEntityId of normalizeEntityIdList(item.childEntityIds)) {
      if (itemById.has(childEntityId) && childEntityId !== item.id && !parentByChildId.has(childEntityId)) {
        parentByChildId.set(childEntityId, item.id);
      }
    }
  }
  return parentByChildId;
};

const readValidatedSceneParentId = (item, itemById, declaredParentByChildId) => {
  const currentParentId = normalizeOptionalEntityId(item.parentEntityId);
  const declaredParentId = declaredParentByChildId.get(item.id) ?? null;
  const preferredParentId = currentParentId !== null && itemById.has(currentParentId)
    ? currentParentId
    : declaredParentId;
  if (
    preferredParentId === null ||
    !itemById.has(preferredParentId) ||
    preferredParentId === item.id ||
    wouldCreateSceneTreeCycle(item.id, preferredParentId, itemById)
  ) {
    return null;
  }
  return preferredParentId;
};

const syncSceneGroupChildEntityIds = (items) => {
  const childIdsByParentId = new Map();
  const itemById = new Map(items.map((item) => [item.id, item]));

  for (const item of sortSceneItemsForDisplay(items)) {
    const parentId = normalizeOptionalEntityId(item.parentEntityId);
    if (parentId === null || !itemById.has(parentId)) {
      continue;
    }
    if (!childIdsByParentId.has(parentId)) {
      childIdsByParentId.set(parentId, []);
    }
    childIdsByParentId.get(parentId).push(item.id);
  }

  return Object.freeze(items.map((item) => {
    if (!isSceneGroupItem(item)) {
      return item;
    }
    const childEntityIds = Object.freeze(childIdsByParentId.get(item.id) ?? []);
    const nextComponents = createGroupComponentMap(childEntityIds, item.components);
    if (
      areSelectedItemIdsEqual(normalizeEntityIdList(item.childEntityIds), childEntityIds) &&
      item.components?.group?.summary === nextComponents.group.summary
    ) {
      return item;
    }
    return assignSceneItemFields(item, {
      childEntityIds,
      components: nextComponents
    });
  }));
};

const normalizeSceneHierarchy = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return Object.freeze([]);
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  const declaredParentByChildId = readDeclaredGroupParentsByChildId(items, itemById);
  const parentNormalizedItems = items.map((item) => {
    const nextParentId = readValidatedSceneParentId(item, itemById, declaredParentByChildId);
    return item.parentEntityId === nextParentId
      ? item
      : assignSceneItemFields(item, { parentEntityId: nextParentId });
  });

  return syncSceneGroupChildEntityIds(parentNormalizedItems);
};

const freezeSceneTreeNode = (node, depth = 0) => Object.freeze({
  item: node.item,
  depth,
  children: Object.freeze(node.children.map((childNode) => freezeSceneTreeNode(childNode, depth + 1)))
});

export const buildSceneTree = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return Object.freeze([]);
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  const nodeById = new Map(items.map((item) => [item.id, { item, children: [] }]));
  const roots = [];

  for (const item of sortSceneItemsForDisplay(items)) {
    const node = nodeById.get(item.id);
    const parentId = normalizeOptionalEntityId(item.parentEntityId);
    const parentNode = parentId ? nodeById.get(parentId) : null;
    if (
      parentNode &&
      parentId !== item.id &&
      !wouldCreateSceneTreeCycle(item.id, parentId, itemById)
    ) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return Object.freeze(sortSceneItemsForDisplay(roots.map((node) => node.item))
    .map((item) => freezeSceneTreeNode(nodeById.get(item.id))));
};

export const sceneTreeRoots = computed(() => buildSceneTree(sceneItems.value));

const readSceneTreeMoveRootIds = (itemIds, itemById) => {
  const candidateItemIds = normalizeSelectedItemIds(itemIds).filter((itemId) => itemById.has(itemId));
  const candidateItemIdSet = new Set(candidateItemIds);
  return candidateItemIds.filter((itemId) => {
    let parentId = normalizeOptionalEntityId(itemById.get(itemId)?.parentEntityId);
    while (parentId !== null) {
      if (candidateItemIdSet.has(parentId)) {
        return false;
      }
      parentId = normalizeOptionalEntityId(itemById.get(parentId)?.parentEntityId);
    }
    return true;
  });
};

export const canReparentSceneItems = (itemIds, parentItemId = null) => {
  const itemById = new Map(sceneItems.value.map((item) => [item.id, item]));
  const nextParentId = normalizeOptionalEntityId(parentItemId);
  if (nextParentId !== null && !itemById.has(nextParentId)) {
    return false;
  }

  const moveRootIds = readSceneTreeMoveRootIds(itemIds, itemById);
  if (moveRootIds.length === 0 || moveRootIds.includes(nextParentId)) {
    return false;
  }

  return moveRootIds.some((itemId) => itemById.get(itemId)?.parentEntityId !== nextParentId) &&
    moveRootIds.every((itemId) => !wouldCreateSceneTreeCycle(itemId, nextParentId, itemById));
};

export const reparentSceneItems = (itemIds, parentItemId = null) => {
  if (!canReparentSceneItems(itemIds, parentItemId)) {
    return false;
  }

  const itemById = new Map(sceneItems.value.map((item) => [item.id, item]));
  const nextParentId = normalizeOptionalEntityId(parentItemId);
  const moveRootIdSet = new Set(readSceneTreeMoveRootIds(itemIds, itemById));
  const nextSiblingDisplayOrder = sceneItems.value
    .filter((item) => item.parentEntityId === nextParentId && !moveRootIdSet.has(item.id))
    .reduce((maxOrder, item) => Math.max(maxOrder, readDisplayOrder(item, item.index)), -1) + 1;
  let movedItemOffset = 0;

  const nextItems = sceneItems.value.map((item) => (
    moveRootIdSet.has(item.id)
      ? assignSceneItemFields(item, {
        parentEntityId: nextParentId,
        displayOrder: nextSiblingDisplayOrder + movedItemOffset++
      })
      : item
  ));
  updateSceneSignals(nextItems, selectedItemId.value, selectedItemIds.value);
  return true;
};

const readCommonSceneTreeParentId = (items) => {
  if (items.length === 0) {
    return null;
  }
  const firstParentId = normalizeOptionalEntityId(items[0].parentEntityId);
  return items.every((item) => normalizeOptionalEntityId(item.parentEntityId) === firstParentId)
    ? firstParentId
    : null;
};

const createSceneGroupEntityId = (itemById, preferredId = null) => {
  const normalizedPreferredId = normalizeOptionalEntityId(preferredId);
  if (normalizedPreferredId !== null && !itemById.has(normalizedPreferredId)) {
    return normalizedPreferredId;
  }

  let groupIndex = 1;
  let groupId = `group-${groupIndex}`;
  while (itemById.has(groupId)) {
    groupIndex += 1;
    groupId = `group-${groupIndex}`;
  }
  return groupId;
};

const createSceneGroupItem = (groupId, options = {}) => normalizeSceneItem(new GroupEntity({
  ...options,
  entityId: groupId,
  index: options.index ?? sceneItems.value.length
}), options.index ?? sceneItems.value.length);

export const canGroupSceneItems = (itemIds = selectedItemIds.value) => {
  const itemById = new Map(sceneItems.value.map((item) => [item.id, item]));
  return readSceneTreeMoveRootIds(itemIds, itemById).length > 1;
};

export const groupSceneItems = (itemIds = selectedItemIds.value, options = {}) => {
  const itemById = new Map(sceneItems.value.map((item) => [item.id, item]));
  const moveRootIds = readSceneTreeMoveRootIds(itemIds, itemById);
  if (moveRootIds.length < 2) {
    return null;
  }

  const moveRootIdSet = new Set(moveRootIds);
  const movedItems = sortSceneItemsForDisplay(moveRootIds.map((itemId) => itemById.get(itemId)).filter(Boolean));
  const parentEntityId = options.parentEntityId === undefined
    ? readCommonSceneTreeParentId(movedItems)
    : normalizeOptionalEntityId(options.parentEntityId);
  if (parentEntityId !== null && (!itemById.has(parentEntityId) || moveRootIdSet.has(parentEntityId))) {
    return null;
  }

  const groupId = createSceneGroupEntityId(itemById, options.entityId ?? options.id);
  const groupDisplayOrder = Number.isFinite(options.displayOrder)
    ? options.displayOrder
    : movedItems.reduce((lowestOrder, item) => Math.min(lowestOrder, readDisplayOrder(item, item.index)), Number.POSITIVE_INFINITY);
  const groupItem = createSceneGroupItem(groupId, {
    ...options,
    childEntityIds: movedItems.map((item) => item.id),
    displayOrder: Number.isFinite(groupDisplayOrder) ? groupDisplayOrder : 0,
    parentEntityId,
    position: options.position ?? options.centerPosition ?? readSceneItemsPivot(movedItems)
  });

  let childDisplayOrder = 0;
  const nextItems = [
    ...sceneItems.value.map((item) => (
      moveRootIdSet.has(item.id)
        ? assignSceneItemFields(item, {
          parentEntityId: groupId,
          displayOrder: childDisplayOrder++
        })
        : item
    )),
    groupItem
  ];

  updateSceneSignals(nextItems, groupId, [groupId, ...groupItem.childEntityIds]);
  return groupItem;
};

export const groupSelectedSceneItems = (options = {}) => groupSceneItems(selectedItemIds.value, options);

export const canUngroupSceneItems = (itemIds = selectedItemIds.value) => {
  const itemById = new Map(sceneItems.value.map((item) => [item.id, item]));
  return normalizeSelectedItemIds(itemIds).some((itemId) => isSceneGroupItem(itemById.get(itemId)));
};

export const ungroupSceneItems = (itemIds = selectedItemIds.value) => {
  const itemById = new Map(sceneItems.value.map((item) => [item.id, item]));
  const groupIds = normalizeSelectedItemIds(itemIds).filter((itemId) => isSceneGroupItem(itemById.get(itemId)));
  if (groupIds.length === 0) {
    return false;
  }

  const groupIdSet = new Set(groupIds);
  const childOrderById = new Map();
  for (const groupId of groupIds) {
    const groupItem = itemById.get(groupId);
    const childItems = sortSceneItemsForDisplay(sceneItems.value.filter((item) => item.parentEntityId === groupId));
    childItems.forEach((childItem, childIndex) => {
      childOrderById.set(childItem.id, {
        parentEntityId: normalizeOptionalEntityId(groupItem.parentEntityId),
        displayOrder: readDisplayOrder(groupItem, groupItem.index) + childIndex
      });
    });
  }

  const nextItems = sceneItems.value
    .filter((item) => !groupIdSet.has(item.id))
    .map((item) => (
      childOrderById.has(item.id)
        ? assignSceneItemFields(item, childOrderById.get(item.id))
        : item
    ));
  const nextSelectedItemIds = Array.from(childOrderById.keys());
  updateSceneSignals(nextItems, nextSelectedItemIds[0] ?? null, nextSelectedItemIds);
  return true;
};

export const ungroupSelectedSceneItems = () => ungroupSceneItems(selectedItemIds.value);

export const canDeleteSceneItems = (itemIds = selectedItemIds.value) => (
  readSceneItemSubtreeIds(itemIds).length > 0
);

export const deleteSceneItems = (itemIds = selectedItemIds.value) => {
  const deleteItemIds = readSceneItemSubtreeIds(itemIds);
  if (deleteItemIds.length === 0) {
    return false;
  }

  const deleteItemIdSet = new Set(deleteItemIds);
  const nextItems = sceneItems.value.filter((item) => !deleteItemIdSet.has(item.id));
  const nextSelectedItemIds = selectedItemIds.value.filter((itemId) => !deleteItemIdSet.has(itemId));
  updateSceneSignals(nextItems, nextSelectedItemIds[0] ?? null, nextSelectedItemIds);
  return true;
};

export const deleteSelectedSceneItems = () => deleteSceneItems(selectedItemIds.value);

const patchExactSceneItemsById = (itemIds, patcher) => {
  const sceneItemIds = new Set(sceneItems.value.map((item) => item.id));
  const patchItemIdSet = new Set(normalizeSelectedItemIds(itemIds).filter((itemId) => sceneItemIds.has(itemId)));
  if (patchItemIdSet.size === 0) {
    return false;
  }

  let didPatch = false;
  const nextItems = sceneItems.value.map((item) => {
    if (!patchItemIdSet.has(item.id)) {
      return item;
    }
    const patch = patcher(item);
    if (!patch || typeof patch !== 'object') {
      return item;
    }
    didPatch = true;
    return assignSceneItemFields(item, patch);
  });

  if (didPatch) {
    updateSceneSignals(nextItems, selectedItemId.value, selectedItemIds.value);
  }
  return didPatch;
};

const createTransformAnimationComponentId = (item, type) => {
  const existingAnimationIds = new Set(readSceneItemTransformAnimations(item).map((component) => component.id));
  const baseId = `transform-${normalizeTransformAnimationType(type)}`;
  if (!existingAnimationIds.has(baseId)) {
    return baseId;
  }

  let index = existingAnimationIds.size + 1;
  let candidateId = `${baseId}-${index}`;
  while (existingAnimationIds.has(candidateId)) {
    index += 1;
    candidateId = `${baseId}-${index}`;
  }
  return candidateId;
};

export const attachTransformAnimationToSceneItem = (itemId, animationType, options = {}) => {
  let attachedComponent = null;
  const didPatch = patchExactSceneItemsById([itemId], (item) => {
    const type = normalizeTransformAnimationType(animationType ?? options.animationType ?? options.type);
    const existingAnimations = readSceneItemTransformAnimations(item);
    attachedComponent = normalizeTransformAnimationComponent({
      ...options,
      id: normalizeOptionalText(options.id) ?? createTransformAnimationComponentId(item, type),
      type,
      config: options.config ?? options,
      enabled: options.enabled !== false
    }, existingAnimations.length);
    return {
      transformAnimations: Object.freeze([...existingAnimations, attachedComponent])
    };
  });
  return didPatch ? attachedComponent : null;
};

export const attachTransformAnimationToSelectedItem = (animationType, options = {}) => (
  selectedItemId.value === null
    ? null
    : attachTransformAnimationToSceneItem(selectedItemId.value, animationType, options)
);

export const updateTransformAnimationComponent = (itemId, animationId, updates = {}) => {
  const normalizedAnimationId = normalizeOptionalText(animationId);
  if (normalizedAnimationId === null) {
    return false;
  }

  return patchExactSceneItemsById([itemId], (item) => {
    let didUpdate = false;
    const nextAnimations = readSceneItemTransformAnimations(item).map((component) => {
      if (component.id !== normalizedAnimationId) {
        return component;
      }
      didUpdate = true;
      return normalizeTransformAnimationComponent({
        ...component,
        ...updates,
        id: component.id,
        type: updates.animationType ?? updates.type ?? component.animationType,
        label: updates.label ?? updates.name ?? component.label,
        enabled: updates.enabled ?? component.enabled,
        config: updates.config
          ? { ...component.config, ...updates.config }
          : component.config
      });
    });
    return didUpdate ? { transformAnimations: Object.freeze(nextAnimations) } : null;
  });
};

export const updateTransformAnimationConfig = (itemId, animationId, config) => (
  updateTransformAnimationComponent(itemId, animationId, { config })
);

export const setTransformAnimationEnabled = (itemId, animationId, enabled) => (
  updateTransformAnimationComponent(itemId, animationId, { enabled: Boolean(enabled) })
);

export const removeTransformAnimationFromSceneItem = (itemId, animationId) => {
  const normalizedAnimationId = normalizeOptionalText(animationId);
  if (normalizedAnimationId === null) {
    return false;
  }

  return patchExactSceneItemsById([itemId], (item) => {
    const existingAnimations = readSceneItemTransformAnimations(item);
    const nextAnimations = existingAnimations.filter((component) => component.id !== normalizedAnimationId);
    return nextAnimations.length === existingAnimations.length
      ? null
      : { transformAnimations: nextAnimations.length > 0 ? Object.freeze(nextAnimations) : undefined };
  });
};

export const detachTransformAnimationFromSceneItem = removeTransformAnimationFromSceneItem;

const patchSceneItemsById = (itemIds, patcher) => {
  const patchItemIdSet = new Set(expandSceneSelectionIds(itemIds));
  if (patchItemIdSet.size === 0) {
    return false;
  }

  let didPatch = false;
  const nextItems = sceneItems.value.map((item) => {
    if (!patchItemIdSet.has(item.id)) {
      return item;
    }
    const patch = patcher(item);
    if (!patch || typeof patch !== 'object') {
      return item;
    }
    didPatch = true;
    return assignSceneItemFields(item, patch);
  });

  if (didPatch) {
    updateSceneSignals(nextItems, selectedItemId.value, selectedItemIds.value);
  }
  return didPatch;
};

export const setSceneItemsHidden = (itemIds, isHidden) => patchSceneItemsById(
  itemIds,
  (item) => (item.isHidden === Boolean(isHidden) ? null : { isHidden: Boolean(isHidden) })
);

export const setSceneItemsLocked = (itemIds, isLocked) => patchSceneItemsById(
  itemIds,
  (item) => (item.isLocked === Boolean(isLocked) ? null : { isLocked: Boolean(isLocked) })
);

const readSceneItemsForIds = (itemIds) => {
  const itemIdSet = new Set(expandSceneSelectionIds(itemIds));
  return sceneItems.value.filter((item) => itemIdSet.has(item.id));
};

export const toggleSceneItemsHidden = (itemIds = selectedItemIds.value) => {
  const selectedItems = readSceneItemsForIds(itemIds);
  const shouldHide = selectedItems.some((item) => !item.isHidden);
  return setSceneItemsHidden(itemIds, shouldHide);
};

export const toggleSceneItemsLocked = (itemIds = selectedItemIds.value) => {
  const selectedItems = readSceneItemsForIds(itemIds);
  const shouldLock = selectedItems.some((item) => !item.isLocked);
  return setSceneItemsLocked(itemIds, shouldLock);
};

export const toggleSelectedSceneItemsHidden = () => toggleSceneItemsHidden(selectedItemIds.value);
export const toggleSelectedSceneItemsLocked = () => toggleSceneItemsLocked(selectedItemIds.value);

const SCENE_ITEM_RUNTIME_KEYS = Object.freeze(new Set(['source', 'physicsRigidBody']));

const cloneSerializableSceneValue = (value) => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value, cloneSerializableSceneValue);
  }
  if (typeof value !== 'object') {
    return undefined;
  }

  const entries = Object.keys(value)
    .filter((key) => !SCENE_ITEM_RUNTIME_KEYS.has(key))
    .sort()
    .map((key) => [key, cloneSerializableSceneValue(value[key])])
    .filter(([, entryValue]) => entryValue !== undefined);
  return Object.fromEntries(entries);
};

const readSceneItemsPayload = (payload) => {
  if (typeof payload === 'string') {
    return readSceneItemsPayload(JSON.parse(payload));
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
};

export const serializeSceneItems = (items = sceneItems.value) => Object.freeze(
  sortSceneItemsForDisplay(normalizeSceneHierarchy(Array.isArray(items)
    ? items.map((item, index) => normalizeSceneItem(item, index))
    : []))
    .map((item, index) => {
      const normalizedItem = normalizeSceneItem(item, index);
      return Object.freeze(cloneSerializableSceneValue({
        ...normalizedItem,
        parentEntityId: normalizedItem.parentEntityId,
        groupName: normalizedItem.groupName,
        sceneItemKind: normalizedItem.sceneItemKind,
        displayOrder: normalizedItem.displayOrder
      }));
    })
);

export const deserializeSceneItems = (payload) => Object.freeze(
  normalizeSceneHierarchy(readSceneItemsPayload(payload).map((item, index) => normalizeSceneItem(item, index)))
);

const filterSceneSelectionIds = (itemIds, items = sceneItems.value) => {
  const sceneItemIds = new Set(items.map((item) => item.id));
  return Object.freeze(normalizeSelectedItemIds(itemIds).filter((itemId) => sceneItemIds.has(itemId)));
};

export const serializeSceneState = () => {
  const nextSelectedItemIds = filterSceneSelectionIds(selectedItemIds.value);
  const nextSelectedItemId = normalizeOptionalEntityId(selectedItemId.value);
  return Object.freeze({
    items: serializeSceneItems(sceneItems.value),
    selectedItemId: nextSelectedItemId !== null && nextSelectedItemIds.includes(nextSelectedItemId)
      ? nextSelectedItemId
      : nextSelectedItemIds[0] ?? null,
    selectedItemIds: nextSelectedItemIds
  });
};

export const deserializeSceneState = (payload) => {
  const sceneState = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const items = deserializeSceneItems(sceneState);
  const itemIds = new Set(items.map((item) => item.id));
  const nextSelectedItemId = sceneState && typeof sceneState === 'object'
    ? normalizeOptionalEntityId(sceneState.selectedItemId)
    : null;
  const nextSelectedItemIds = sceneState && typeof sceneState === 'object'
    ? filterSceneSelectionIds(sceneState.selectedItemIds, items)
    : Object.freeze([]);
  updateSceneSignals(
    items,
    nextSelectedItemId !== null && itemIds.has(nextSelectedItemId) ? nextSelectedItemId : nextSelectedItemIds[0] ?? null,
    nextSelectedItemIds
  );
  return serializeSceneState();
};

export const runSceneStoreSmokeSamples = () => {
  const previousItems = sceneItems.value;
  const previousSelectedItemId = selectedItemId.value;
  const previousSelectedItemIds = selectedItemIds.value;

  try {
    setSceneItems([
      { entityId: 'sphere-a', name: 'Sphere A', displayOrder: 2, material: 0 },
      { entityId: 'cube-b', name: 'Cube B', displayOrder: 1, material: 1 },
      { entityId: 'light', name: 'Light', displayOrder: 3, type: 'light' }
    ]);
    setSelectedItemIds(['sphere-a', 'cube-b'], 'sphere-a');

    const groupItem = groupSelectedSceneItems({ id: 'group-test', name: 'Smoke Group' });
    const spinAnimation = attachTransformAnimationToSceneItem(groupItem.id, TRANSFORM_ANIMATION_TYPES.SPIN, {
      speedDegreesPerSecond: 90
    });
    const bobAnimation = attachTransformAnimationToSceneItem(groupItem.id, TRANSFORM_ANIMATION_TYPES.BOB, {
      amplitude: 0.25,
      frequencyHertz: 1
    });
    const pulseAnimation = attachTransformAnimationToSceneItem('sphere-a', TRANSFORM_ANIMATION_TYPES.PULSE, {
      amplitude: 0.2,
      frequencyHertz: 0,
      phaseDegrees: 90
    });
    const orbitAnimation = attachTransformAnimationToSceneItem('sphere-a', TRANSFORM_ANIMATION_TYPES.ORBIT, {
      center: [0, 0, 0],
      radius: 1,
      speedDegreesPerSecond: 45
    });
    const wobbleAnimation = attachTransformAnimationToSceneItem('sphere-a', TRANSFORM_ANIMATION_TYPES.WOBBLE, {
      amplitudeDegrees: 6,
      frequencyHertz: 3,
      seed: 7
    });
    const didDisableBobAnimation = setTransformAnimationEnabled(groupItem.id, bobAnimation?.id, false);
    const didUpdateOrbitAnimation = updateTransformAnimationConfig('sphere-a', orbitAnimation?.id, {
      center: [1, 0, 1],
      radius: 2,
      speedDegreesPerSecond: 90
    });
    const sphereAnimationStateBeforeRemove = evaluateSceneItemTransformAnimations(
      sceneItems.value.find((item) => item.id === 'sphere-a'),
      1
    );
    const didRemoveWobbleAnimation = removeTransformAnimationFromSceneItem('sphere-a', wobbleAnimation?.id);
    const groupAnimationState = evaluateSceneItemTransformAnimations(
      sceneItems.value.find((item) => item.id === groupItem.id),
      1
    );
    const groupedState = serializeSceneState();
    const groupedItems = groupedState.items;
    const groupedItem = groupedItems.find((item) => item.id === groupItem.id);
    const groupedChildren = groupedItems.filter((item) => item.parentEntityId === groupItem.id);
    const groupedAnimationRows = readSceneItemComponentRows(groupedItem)
      .filter((row) => row.key === 'animation' || row.key.startsWith('animation-'));
    const groupedSphere = groupedItems.find((item) => item.id === 'sphere-a');
    setSelectedItemId('group-test');
    const expandedGroupSelectionIds = selectedItemIds.value;
    const roundTripState = deserializeSceneState(JSON.stringify(groupedState));
    const didUngroup = ungroupSceneItems(['group-test']);
    const ungroupedState = serializeSceneState();
    const didHideSelection = toggleSelectedSceneItemsHidden();
    const didLockSelection = toggleSelectedSceneItemsLocked();
    const bulkEditedState = serializeSceneState();
    const didDeleteSelection = deleteSelectedSceneItems();
    const deletedState = serializeSceneState();

    return Object.freeze({
      groupId: groupItem.id,
      groupEntityClassName: groupItem.source?.constructor?.name ?? null,
      groupedChildEntityIds: groupedItem?.childEntityIds ?? [],
      expandedGroupSelectionIds,
      groupedItemCount: groupedItems.length,
      groupedChildCount: groupedChildren.length,
      transformAnimationComponentType: spinAnimation?.componentType ?? null,
      groupedAnimationIds: readSceneItemTransformAnimations(groupedItem).map((animation) => animation.id),
      groupedAnimationEnabledFlags: readSceneItemTransformAnimations(groupedItem).map((animation) => animation.enabled),
      groupedAnimationSummary: groupedAnimationRows.find((row) => row.key === 'animation')?.summary ?? '',
      groupedAnimationRowKeys: groupedAnimationRows.map((row) => row.key),
      sphereAnimationIdsAfterRemove: readSceneItemTransformAnimations(groupedSphere).map((animation) => animation.id),
      sphereAnimationTypesAfterRemove: readSceneItemTransformAnimations(groupedSphere).map((animation) => animation.animationType),
      didDisableBobAnimation,
      didUpdateOrbitAnimation,
      didRemoveWobbleAnimation,
      groupAnimationAppliedIdsAtOneSecond: groupAnimationState.appliedAnimationIds,
      groupAnimationRotationYAtOneSecond: groupAnimationState.rotationEulerDegrees[1],
      groupAnimationPositionYAtOneSecond: groupAnimationState.position[1],
      sphereAnimationAppliedIdsBeforeRemove: sphereAnimationStateBeforeRemove.appliedAnimationIds,
      sphereAnimationPositionBeforeRemove: sphereAnimationStateBeforeRemove.position,
      sphereAnimationScaleBeforeRemove: sphereAnimationStateBeforeRemove.scale,
      sphereAnimationRotationBeforeRemove: sphereAnimationStateBeforeRemove.rotationEulerDegrees,
      groupedSelectedItemId: groupedState.selectedItemId,
      groupedSelectedItemIds: groupedState.selectedItemIds,
      roundTripGroupParent: roundTripState.items.find((item) => item.id === 'group-test')?.parentEntityId ?? null,
      roundTripGroupAnimationCount: readSceneItemTransformAnimations(
        roundTripState.items.find((item) => item.id === 'group-test')
      ).length,
      roundTripSphereAnimationCount: readSceneItemTransformAnimations(
        roundTripState.items.find((item) => item.id === 'sphere-a')
      ).length,
      roundTripChildParentIds: roundTripState.items
        .filter((item) => item.id === 'sphere-a' || item.id === 'cube-b')
        .map((item) => item.parentEntityId),
      didUngroup,
      ungroupedItemCount: ungroupedState.items.length,
      ungroupedRootIds: ungroupedState.items
        .filter((item) => item.parentEntityId === null)
        .map((item) => item.id),
      didHideSelection,
      didLockSelection,
      bulkEditedItemIds: bulkEditedState.items
        .filter((item) => item.isHidden && item.isLocked)
        .map((item) => item.id),
      didDeleteSelection,
      deletedItemCount: deletedState.items.length,
      deletedRemainingIds: deletedState.items.map((item) => item.id)
    });
  } finally {
    batch(() => {
      sceneItems.value = previousItems;
      selectedItemId.value = previousSelectedItemId;
      selectedItemIds.value = previousSelectedItemIds;
    });
  }
};

export const selectedSceneItemComponentRows = computed(() => (
  readSceneItemComponentRows(selectedSceneItem.value)
));

export const setSceneItems = (items) => {
  const normalizedItems = Array.isArray(items)
    ? items.map((item, index) => normalizeSceneItem(item, index))
    : [];
  sceneItems.value = normalizeSceneHierarchy(normalizedItems);

  const sceneItemIds = new Set(sceneItems.value.map((item) => item.id));
  const currentPrimaryItemId = normalizeOptionalEntityId(selectedItemId.value);
  const currentSelectedItemIds = selectedItemIds.value.length > 0
    ? selectedItemIds.value
    : (currentPrimaryItemId === null ? [] : [currentPrimaryItemId]);
  const nextSelectedItemIds = currentSelectedItemIds.filter((itemId) => sceneItemIds.has(itemId));
  const nextPrimaryItemId = currentPrimaryItemId !== null && sceneItemIds.has(currentPrimaryItemId)
    ? currentPrimaryItemId
    : nextSelectedItemIds[0] ?? null;

  if (
    !areSelectedItemIdsEqual(selectedItemIds.value, nextSelectedItemIds) ||
    selectedItemId.value !== nextPrimaryItemId
  ) {
    commitSceneSelection(nextSelectedItemIds, nextPrimaryItemId);
  }
};

export const setSelectedItemId = (itemId) => {
  const normalizedItemId = normalizeOptionalEntityId(itemId);
  batch(() => {
    commitSceneSelection(normalizedItemId === null ? [] : [normalizedItemId], normalizedItemId);
  });
};

export const setSelectedItemIds = (itemIds, primaryItemId = selectedItemId.value) => {
  batch(() => {
    commitSceneSelection(itemIds, primaryItemId);
  });
};

export const selectSceneItem = setSelectedItemId;

export const updateSceneSignals = (
  items,
  nextSelectedItemId = selectedItemId.value,
  nextSelectedItemIds = undefined
) => {
  batch(() => {
    setSceneItems(items);
    if (nextSelectedItemIds === undefined) {
      setSelectedItemId(nextSelectedItemId);
    } else {
      setSelectedItemIds(nextSelectedItemIds, nextSelectedItemId);
    }
  });
};

export const clearSceneSelection = () => setSelectedItemId(null);
