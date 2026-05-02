import { batch, signal } from '@preact/signals';
import { uiLogger } from './logger.js';

const cloneSignalValue = (value) => {
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (ArrayBuffer.isView(value) && typeof value.slice === 'function') {
    return value.slice();
  }
  if (value && typeof value === 'object') {
    return { ...value };
  }
  return value;
};

const areArrayValuesEqual = (previousValue, nextValue) => {
  if (previousValue.length !== nextValue.length) {
    return false;
  }
  for (let valueIndex = 0; valueIndex < previousValue.length; valueIndex += 1) {
    if (!Object.is(previousValue[valueIndex], nextValue[valueIndex])) {
      return false;
    }
  }
  return true;
};

const arePlainObjectValuesEqual = (previousValue, nextValue) => {
  const previousKeys = Object.keys(previousValue);
  const nextKeys = Object.keys(nextValue);
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(nextValue, key) || !Object.is(previousValue[key], nextValue[key])) {
      return false;
    }
  }
  return true;
};

const areArrayBufferViewValuesEqual = (previousValue, nextValue) => {
  if (
    previousValue.constructor !== nextValue.constructor ||
    previousValue.byteLength !== nextValue.byteLength
  ) {
    return false;
  }
  if (typeof previousValue.length === 'number' && typeof nextValue.length === 'number') {
    return areArrayValuesEqual(previousValue, nextValue);
  }
  const previousBytes = new Uint8Array(previousValue.buffer, previousValue.byteOffset, previousValue.byteLength);
  const nextBytes = new Uint8Array(nextValue.buffer, nextValue.byteOffset, nextValue.byteLength);
  return areArrayValuesEqual(previousBytes, nextBytes);
};

export const areSignalValuesEqual = (previousValue, nextValue) => {
  if (Object.is(previousValue, nextValue)) {
    return true;
  }
  if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
    return areArrayValuesEqual(previousValue, nextValue);
  }
  if (ArrayBuffer.isView(previousValue) && ArrayBuffer.isView(nextValue)) {
    return areArrayBufferViewValuesEqual(previousValue, nextValue);
  }
  if (
    previousValue &&
    nextValue &&
    typeof previousValue === 'object' &&
    typeof nextValue === 'object' &&
    previousValue.constructor === Object &&
    nextValue.constructor === Object
  ) {
    return arePlainObjectValuesEqual(previousValue, nextValue);
  }
  return false;
};

const DEFAULT_RENDER_DIMENSION = 512;
const MIN_RENDER_DIMENSION = 1;
const MAX_RENDER_DIMENSION = 8192;

const normalizeRenderDimension = (value, fallbackValue = DEFAULT_RENDER_DIMENSION) => {
  const parsedValue = Number.parseFloat(value);
  if (!Number.isFinite(parsedValue)) {
    return fallbackValue;
  }
  return Math.min(Math.max(Math.round(parsedValue), MIN_RENDER_DIMENSION), MAX_RENDER_DIMENSION);
};

const readDefaultRenderDimensions = () => {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    return { width: DEFAULT_RENDER_DIMENSION, height: DEFAULT_RENDER_DIMENSION };
  }

  const stageElement = document.getElementById('main');
  if (stageElement && typeof stageElement.getBoundingClientRect === 'function') {
    const stageBounds = stageElement.getBoundingClientRect();
    if (stageBounds.width > 0 && stageBounds.height > 0) {
      return {
        width: normalizeRenderDimension(stageBounds.width),
        height: normalizeRenderDimension(stageBounds.height)
      };
    }
  }

  if (typeof window !== 'undefined') {
    return {
      width: normalizeRenderDimension(window.innerWidth),
      height: normalizeRenderDimension(window.innerHeight)
    };
  }

  return { width: DEFAULT_RENDER_DIMENSION, height: DEFAULT_RENDER_DIMENSION };
};

const DEFAULT_RENDER_DIMENSIONS = readDefaultRenderDimensions();

export const DEFAULT_APPLICATION_STATE = Object.freeze({
  cameraAngleX: 0,
  cameraAngleY: 0,
  cameraDistance: 2.5,
  eyePosition: Object.freeze([0, 0, 0]),
  lightPosition: Object.freeze([0.4, 0.5, -0.6]),
  lightColor: Object.freeze([1, 1, 1]),
  nextObjectId: 0,
  material: 0,
  glossiness: 0.6,
  environment: 0,
  lightIntensity: 0.5,
  lightSize: 0.1,
  fogDensity: 0,
  skyBrightness: 1.25,
  isLightIntensityCycling: false,
  lightIntensityCycleDirection: 1,
  lightBounceCount: 5,
  raysPerPixel: 12,
  temporalBlendFrames: 16,
  colorExposure: 0,
  colorBrightness: 0,
  colorContrast: 1,
  colorSaturation: 1,
  colorGamma: 1,
  toneMappingMode: 0,
  cameraFieldOfViewDegrees: 55,
  cameraFocusDistance: 2.5,
  cameraAperture: 0,
  motionBlurStrength: 0,
  denoiserStrength: 0.65,
  bloomStrength: 0.25,
  bloomThreshold: 1,
  glareStrength: 0.1,
  renderScale: 1,
  renderWidth: DEFAULT_RENDER_DIMENSIONS.width,
  renderHeight: DEFAULT_RENDER_DIMENSIONS.height,
  renderDebugViewMode: 0,
  isRotatingCamera: false,
  isPickingFocus: false,
  isPointerDown: false,
  isFramePaused: false,
  didResumeFromFramePause: false,
  isConvergencePauseEnabled: false,
  isConvergencePaused: false,
  convergenceSampleCount: 2048,
  isCameraAutoRotating: true,
  cameraAutoRotationSpeed: 0.25,
  cameraShots: Object.freeze([null, null, null]),
  isBenchmarkModeActive: false,
  activeBenchmarkSceneName: null,
  sceneAnimationElapsedSeconds: 0,
  sceneAnimationUpdate: null,
  previousPointerX: 0,
  previousPointerY: 0,
  isInitialFrameReady: false,
  isWebGlContextLost: false,
  animationFrameId: 0,
  animationFrameCallback: null
});

export const APPLICATION_STATE_FIELDS = Object.freeze(Object.keys(DEFAULT_APPLICATION_STATE));

export const QUALITY_PRESETS = Object.freeze({
  draft: Object.freeze({
    lightBounceCount: 2,
    raysPerPixel: 2,
    temporalBlendFrames: 4,
    denoiserStrength: 0.85,
    bloomStrength: 0.12,
    bloomThreshold: 1.25,
    glareStrength: 0.04
  }),
  preview: Object.freeze({
    lightBounceCount: DEFAULT_APPLICATION_STATE.lightBounceCount,
    raysPerPixel: DEFAULT_APPLICATION_STATE.raysPerPixel,
    temporalBlendFrames: DEFAULT_APPLICATION_STATE.temporalBlendFrames,
    denoiserStrength: DEFAULT_APPLICATION_STATE.denoiserStrength,
    bloomStrength: DEFAULT_APPLICATION_STATE.bloomStrength,
    bloomThreshold: DEFAULT_APPLICATION_STATE.bloomThreshold,
    glareStrength: DEFAULT_APPLICATION_STATE.glareStrength
  }),
  final: Object.freeze({
    lightBounceCount: 8,
    raysPerPixel: 32,
    temporalBlendFrames: 24,
    denoiserStrength: 0.45,
    bloomStrength: 0.32,
    bloomThreshold: 0.9,
    glareStrength: 0.16
  })
});

export const createApplicationSignals = (initialState = DEFAULT_APPLICATION_STATE) => {
  const signals = {};
  for (const fieldName of APPLICATION_STATE_FIELDS) {
    const initialValue = Object.prototype.hasOwnProperty.call(initialState, fieldName)
      ? initialState[fieldName]
      : DEFAULT_APPLICATION_STATE[fieldName];
    signals[fieldName] = signal(cloneSignalValue(initialValue));
  }
  return Object.freeze(signals);
};

export const applicationStateSignals = createApplicationSignals();
export const appSignals = applicationStateSignals;

const createBooleanSignalMap = (initialValues) => Object.freeze(
  Object.fromEntries(Object.entries(initialValues).map(([key, value]) => [key, signal(Boolean(value))]))
);

export const uiWindowVisibilitySignals = createBooleanSignalMap({
  controls: true,
  'scene-tree-window': true,
  benchmark: true,
  'log-panel': false
});

export const uiPanelOpenSignals = createBooleanSignalMap({
  'object-panel': false,
  'scene-panel': false,
  'render-panel': true,
  'camera-panel': false,
  'output-panel': false,
  'preset-panel': false
});

export const isCanvasFullscreen = signal(false);
export const shouldShowFullscreenPanels = signal(false);
export const isSceneTreeCreateMenuOpen = signal(false);

export const SCENE_TREE_CREATE_PANEL_ID = 'scene-panel';

const readBooleanSignal = (signalMap, key) => {
  const valueSignal = signalMap[key];
  if (!valueSignal) {
    uiLogger.warn('ui:unknown-signal', {
      key,
      availableKeys: Object.keys(signalMap)
    });
    throw new RangeError(`Unknown UI signal "${key}".`);
  }
  return valueSignal;
};

export const setUiWindowVisible = (windowId, isVisible) => {
  const windowSignal = readBooleanSignal(uiWindowVisibilitySignals, windowId);
  const previousValue = Boolean(windowSignal.value);
  const nextValue = Boolean(isVisible);
  if (previousValue !== nextValue) {
    uiLogger.info('ui:window-visibility', {
      windowId,
      previousValue,
      nextValue
    });
    windowSignal.value = nextValue;
  }
  return windowSignal.value;
};

export const toggleUiWindowVisible = (windowId, shouldForceShow = false) => {
  const windowSignal = readBooleanSignal(uiWindowVisibilitySignals, windowId);
  const previousValue = Boolean(windowSignal.value);
  const nextValue = shouldForceShow ? true : !previousValue;
  if (previousValue !== nextValue) {
    uiLogger.info('ui:window-toggle', {
      windowId,
      previousValue,
      nextValue,
      shouldForceShow: Boolean(shouldForceShow)
    });
    windowSignal.value = nextValue;
  }
  return windowSignal.value;
};

export const setUiPanelOpen = (panelId, isOpen) => {
  if (panelId === SCENE_TREE_CREATE_PANEL_ID) {
    const previousValue = Boolean(uiPanelOpenSignals[SCENE_TREE_CREATE_PANEL_ID].value);
    const previousMenuValue = Boolean(isSceneTreeCreateMenuOpen.value);
    const previousWindowValue = Boolean(uiWindowVisibilitySignals['scene-tree-window'].value);
    const nextOpen = Boolean(isOpen);
    const shouldUpdate =
      previousValue !== nextOpen ||
      previousMenuValue !== nextOpen ||
      (nextOpen && !previousWindowValue);
    if (shouldUpdate) {
      uiLogger.info('ui:panel-open', {
        panelId,
        previousValue,
        nextValue: nextOpen,
        createMenuPreviousValue: previousMenuValue,
        sceneTreeWindowForcedVisible: nextOpen && !previousWindowValue
      });
      batch(() => {
        if (previousValue !== nextOpen) {
          uiPanelOpenSignals[SCENE_TREE_CREATE_PANEL_ID].value = nextOpen;
        }
        if (previousMenuValue !== nextOpen) {
          isSceneTreeCreateMenuOpen.value = nextOpen;
        }
        if (nextOpen && !previousWindowValue) {
          uiWindowVisibilitySignals['scene-tree-window'].value = true;
        }
      });
    }
    return nextOpen;
  }

  const panelSignal = readBooleanSignal(uiPanelOpenSignals, panelId);
  const previousValue = Boolean(panelSignal.value);
  const nextValue = Boolean(isOpen);
  if (previousValue !== nextValue) {
    uiLogger.info('ui:panel-open', {
      panelId,
      previousValue,
      nextValue
    });
    panelSignal.value = nextValue;
  }
  return panelSignal.value;
};

export const openUiPanel = (panelId) => setUiPanelOpen(panelId, true);

export const setSceneTreeCreateMenuOpen = (isOpen) => {
  const nextOpen = Boolean(isOpen);
  const previousValue = Boolean(isSceneTreeCreateMenuOpen.value);
  const previousPanelValue = Boolean(uiPanelOpenSignals[SCENE_TREE_CREATE_PANEL_ID].value);
  const previousWindowValue = Boolean(uiWindowVisibilitySignals['scene-tree-window'].value);
  const shouldUpdate =
    previousValue !== nextOpen ||
    previousPanelValue !== nextOpen ||
    (nextOpen && !previousWindowValue);
  if (shouldUpdate) {
    uiLogger.info('ui:create-menu-open', {
      previousValue,
      nextValue: nextOpen,
      panelPreviousValue: previousPanelValue,
      sceneTreeWindowForcedVisible: nextOpen && !previousWindowValue
    });
    batch(() => {
      if (previousValue !== nextOpen) {
        isSceneTreeCreateMenuOpen.value = nextOpen;
      }
      if (previousPanelValue !== nextOpen) {
        uiPanelOpenSignals[SCENE_TREE_CREATE_PANEL_ID].value = nextOpen;
      }
      if (nextOpen && !previousWindowValue) {
        uiWindowVisibilitySignals['scene-tree-window'].value = true;
      }
    });
  }
  return nextOpen;
};

export const toggleSceneTreeCreateMenuOpen = () => (
  setSceneTreeCreateMenuOpen(!isSceneTreeCreateMenuOpen.value)
);

export const quickActionPressedSignals = Object.freeze({
  'toggle-camera-playback': applicationStateSignals.isCameraAutoRotating,
  'toggle-frame-pause': applicationStateSignals.isFramePaused,
  'toggle-convergence-pause': applicationStateSignals.isConvergencePauseEnabled,
  'toggle-light-cycle': applicationStateSignals.isLightIntensityCycling,
  'toggle-focus-pick': applicationStateSignals.isPickingFocus,
  'toggle-canvas-fullscreen': isCanvasFullscreen,
  'toggle-fullscreen-panels': shouldShowFullscreenPanels,
  'window:controls': uiWindowVisibilitySignals.controls,
  'window:scene-tree-window': uiWindowVisibilitySignals['scene-tree-window'],
  'window:benchmark': uiWindowVisibilitySignals.benchmark,
  'window:log-panel': uiWindowVisibilitySignals['log-panel'],
  'panel:object-panel': uiPanelOpenSignals['object-panel'],
  [`panel:${SCENE_TREE_CREATE_PANEL_ID}`]: isSceneTreeCreateMenuOpen,
  'panel:render-panel': uiPanelOpenSignals['render-panel'],
  'panel:camera-panel': uiPanelOpenSignals['camera-panel'],
  'panel:output-panel': uiPanelOpenSignals['output-panel'],
  'panel:preset-panel': uiPanelOpenSignals['preset-panel']
});

export const getApplicationSignals = () => applicationStateSignals;

export const getApplicationStateSignal = (fieldName) => {
  const fieldSignal = applicationStateSignals[fieldName];
  if (!fieldSignal) {
    uiLogger.warn('state:unknown-field', {
      fieldName,
      availableFields: APPLICATION_STATE_FIELDS
    });
    throw new RangeError(`Unknown application state field "${fieldName}".`);
  }
  return fieldSignal;
};

export const getApplicationValue = (fieldName) => getApplicationStateSignal(fieldName).value;

export const setApplicationValue = (fieldName, value) => {
  const fieldSignal = getApplicationStateSignal(fieldName);
  const nextValue = cloneSignalValue(value);
  if (!areSignalValuesEqual(fieldSignal.value, nextValue)) {
    uiLogger.debug('state:set', {
      fieldName,
      previousValue: cloneSignalValue(fieldSignal.value),
      nextValue: cloneSignalValue(nextValue)
    });
    fieldSignal.value = nextValue;
  }
  return fieldSignal.value;
};

export const toggleApplicationBoolean = (fieldName) => {
  const fieldSignal = getApplicationStateSignal(fieldName);
  const previousValue = Boolean(fieldSignal.value);
  const nextValue = !previousValue;
  setApplicationValue(fieldName, nextValue);
  uiLogger.info('state:toggle', {
    fieldName,
    previousValue,
    nextValue
  });
  return nextValue;
};

export const patchApplicationState = (partialState) => {
  if (!partialState || typeof partialState !== 'object') {
    uiLogger.warn('state:patch-invalid', { valueType: typeof partialState });
    return applicationStateSignals;
  }

  batch(() => {
    for (const [fieldName, value] of Object.entries(partialState)) {
      if (Object.prototype.hasOwnProperty.call(applicationStateSignals, fieldName)) {
        setApplicationValue(fieldName, value);
      } else {
        uiLogger.warn('state:patch-unknown-field', { fieldName });
      }
    }
  });
  return applicationStateSignals;
};

export const updateApplicationSignalsFromState = patchApplicationState;

export const snapshotApplicationState = (signals = applicationStateSignals) => {
  const snapshot = {};
  for (const fieldName of APPLICATION_STATE_FIELDS) {
    snapshot[fieldName] = cloneSignalValue(signals[fieldName].value);
  }
  return snapshot;
};

export const bindApplicationStateObject = (targetState, signals = applicationStateSignals) => {
  if (!targetState || typeof targetState !== 'object') {
    throw new TypeError('bindApplicationStateObject requires a mutable target object.');
  }

  for (const fieldName of APPLICATION_STATE_FIELDS) {
    Object.defineProperty(targetState, fieldName, {
      configurable: true,
      enumerable: true,
      get() {
        return signals[fieldName].value;
      },
      set(value) {
        const nextValue = cloneSignalValue(value);
        if (signals === applicationStateSignals) {
          setApplicationValue(fieldName, nextValue);
        } else if (!areSignalValuesEqual(signals[fieldName].value, nextValue)) {
          signals[fieldName].value = nextValue;
        }
      }
    });
  }
  return targetState;
};

export const cameraAngleX = applicationStateSignals.cameraAngleX;
export const cameraAngleY = applicationStateSignals.cameraAngleY;
export const cameraDistance = applicationStateSignals.cameraDistance;
export const eyePosition = applicationStateSignals.eyePosition;
export const lightPosition = applicationStateSignals.lightPosition;
export const lightColor = applicationStateSignals.lightColor;
export const nextObjectId = applicationStateSignals.nextObjectId;
export const material = applicationStateSignals.material;
export const glossiness = applicationStateSignals.glossiness;
export const environment = applicationStateSignals.environment;
export const lightIntensity = applicationStateSignals.lightIntensity;
export const lightSize = applicationStateSignals.lightSize;
export const fogDensity = applicationStateSignals.fogDensity;
export const skyBrightness = applicationStateSignals.skyBrightness;
export const isLightIntensityCycling = applicationStateSignals.isLightIntensityCycling;
export const lightIntensityCycleDirection = applicationStateSignals.lightIntensityCycleDirection;
export const lightBounceCount = applicationStateSignals.lightBounceCount;
export const raysPerPixel = applicationStateSignals.raysPerPixel;
export const temporalBlendFrames = applicationStateSignals.temporalBlendFrames;
export const colorExposure = applicationStateSignals.colorExposure;
export const colorBrightness = applicationStateSignals.colorBrightness;
export const colorContrast = applicationStateSignals.colorContrast;
export const colorSaturation = applicationStateSignals.colorSaturation;
export const colorGamma = applicationStateSignals.colorGamma;
export const toneMappingMode = applicationStateSignals.toneMappingMode;
export const cameraFieldOfViewDegrees = applicationStateSignals.cameraFieldOfViewDegrees;
export const cameraFocusDistance = applicationStateSignals.cameraFocusDistance;
export const cameraAperture = applicationStateSignals.cameraAperture;
export const motionBlurStrength = applicationStateSignals.motionBlurStrength;
export const denoiserStrength = applicationStateSignals.denoiserStrength;
export const bloomStrength = applicationStateSignals.bloomStrength;
export const bloomThreshold = applicationStateSignals.bloomThreshold;
export const glareStrength = applicationStateSignals.glareStrength;
export const renderScale = applicationStateSignals.renderScale;
export const renderWidth = applicationStateSignals.renderWidth;
export const renderHeight = applicationStateSignals.renderHeight;
export const renderDebugViewMode = applicationStateSignals.renderDebugViewMode;
export const isRotatingCamera = applicationStateSignals.isRotatingCamera;
export const isPickingFocus = applicationStateSignals.isPickingFocus;
export const isPointerDown = applicationStateSignals.isPointerDown;
export const isFramePaused = applicationStateSignals.isFramePaused;
export const didResumeFromFramePause = applicationStateSignals.didResumeFromFramePause;
export const isConvergencePauseEnabled = applicationStateSignals.isConvergencePauseEnabled;
export const isConvergencePaused = applicationStateSignals.isConvergencePaused;
export const convergenceSampleCount = applicationStateSignals.convergenceSampleCount;
export const isCameraAutoRotating = applicationStateSignals.isCameraAutoRotating;
export const cameraAutoRotationSpeed = applicationStateSignals.cameraAutoRotationSpeed;
export const cameraShots = applicationStateSignals.cameraShots;
export const isBenchmarkModeActive = applicationStateSignals.isBenchmarkModeActive;
export const activeBenchmarkSceneName = applicationStateSignals.activeBenchmarkSceneName;
export const sceneAnimationElapsedSeconds = applicationStateSignals.sceneAnimationElapsedSeconds;
export const sceneAnimationUpdate = applicationStateSignals.sceneAnimationUpdate;
export const previousPointerX = applicationStateSignals.previousPointerX;
export const previousPointerY = applicationStateSignals.previousPointerY;
export const isInitialFrameReady = applicationStateSignals.isInitialFrameReady;
export const isWebGlContextLost = applicationStateSignals.isWebGlContextLost;
export const animationFrameId = applicationStateSignals.animationFrameId;
export const animationFrameCallback = applicationStateSignals.animationFrameCallback;

export const setCameraAngleX = (value) => setApplicationValue('cameraAngleX', value);
export const setCameraAngleY = (value) => setApplicationValue('cameraAngleY', value);
export const setCameraDistance = (value) => setApplicationValue('cameraDistance', value);
export const setEyePosition = (value) => setApplicationValue('eyePosition', value);
export const setLightPosition = (value) => setApplicationValue('lightPosition', value);
export const setLightColor = (value) => setApplicationValue('lightColor', value);
export const setNextObjectId = (value) => setApplicationValue('nextObjectId', value);
export const setMaterial = (value) => setApplicationValue('material', value);
export const setGlossiness = (value) => setApplicationValue('glossiness', value);
export const setEnvironment = (value) => setApplicationValue('environment', value);
export const setLightIntensity = (value) => setApplicationValue('lightIntensity', value);
export const setLightSize = (value) => setApplicationValue('lightSize', value);
export const setFogDensity = (value) => setApplicationValue('fogDensity', value);
export const setSkyBrightness = (value) => setApplicationValue('skyBrightness', value);
export const setLightIntensityCycling = (value) => setApplicationValue('isLightIntensityCycling', value);
export const setLightIntensityCycleDirection = (value) => setApplicationValue('lightIntensityCycleDirection', value);
export const setLightBounceCount = (value) => setApplicationValue('lightBounceCount', value);
export const setRaysPerPixel = (value) => setApplicationValue('raysPerPixel', value);
export const setTemporalBlendFrames = (value) => setApplicationValue('temporalBlendFrames', value);
export const setDenoiserStrength = (value) => setApplicationValue('denoiserStrength', value);
export const setColorExposure = (value) => setApplicationValue('colorExposure', value);
export const setColorBrightness = (value) => setApplicationValue('colorBrightness', value);
export const setColorContrast = (value) => setApplicationValue('colorContrast', value);
export const setColorSaturation = (value) => setApplicationValue('colorSaturation', value);
export const setColorGamma = (value) => setApplicationValue('colorGamma', value);
export const setToneMappingMode = (value) => setApplicationValue('toneMappingMode', value);
export const setCameraFieldOfViewDegrees = (value) => setApplicationValue('cameraFieldOfViewDegrees', value);
export const setCameraFocusDistance = (value) => setApplicationValue('cameraFocusDistance', value);
export const setCameraAperture = (value) => setApplicationValue('cameraAperture', value);
export const setMotionBlurStrength = (value) => setApplicationValue('motionBlurStrength', value);
export const setBloomStrength = (value) => setApplicationValue('bloomStrength', value);
export const setBloomThreshold = (value) => setApplicationValue('bloomThreshold', value);
export const setGlareStrength = (value) => setApplicationValue('glareStrength', value);
export const setRenderScale = (value) => setApplicationValue('renderScale', value);
export const setRenderWidth = (value) => setApplicationValue('renderWidth', value);
export const setRenderHeight = (value) => setApplicationValue('renderHeight', value);
export const setRenderDebugViewMode = (value) => setApplicationValue('renderDebugViewMode', value);
export const setRotatingCamera = (value) => setApplicationValue('isRotatingCamera', value);
export const setCameraAutoRotating = (value) => setApplicationValue('isCameraAutoRotating', value);
export const setPointerDown = (value) => setApplicationValue('isPointerDown', value);
export const setFramePaused = (value) => setApplicationValue('isFramePaused', value);
export const setDidResumeFromFramePause = (value) => setApplicationValue('didResumeFromFramePause', value);
export const setConvergencePauseEnabled = (value) => setApplicationValue('isConvergencePauseEnabled', value);
export const setConvergencePaused = (value) => setApplicationValue('isConvergencePaused', value);
export const setConvergenceSampleCount = (value) => setApplicationValue('convergenceSampleCount', value);
export const setPickingFocus = (value) => setApplicationValue('isPickingFocus', value);
export const setCameraShots = (value) => setApplicationValue('cameraShots', value);
export const setBenchmarkModeActive = (value) => setApplicationValue('isBenchmarkModeActive', value);
export const setActiveBenchmarkSceneName = (value) => setApplicationValue('activeBenchmarkSceneName', value);
export const setSceneAnimationElapsedSeconds = (value) => setApplicationValue('sceneAnimationElapsedSeconds', value);
export const setSceneAnimationUpdate = (value) => setApplicationValue('sceneAnimationUpdate', value);
export const setPreviousPointerX = (value) => setApplicationValue('previousPointerX', value);
export const setPreviousPointerY = (value) => setApplicationValue('previousPointerY', value);
export const setInitialFrameReady = (value) => setApplicationValue('isInitialFrameReady', value);
export const setWebGlContextLost = (value) => setApplicationValue('isWebGlContextLost', value);
export const setAnimationFrameId = (value) => setApplicationValue('animationFrameId', value);
export const setAnimationFrameCallback = (value) => setApplicationValue('animationFrameCallback', value);

export const toggleCameraAutoRotating = () => toggleApplicationBoolean('isCameraAutoRotating');
export const toggleFramePaused = () => toggleApplicationBoolean('isFramePaused');
export const toggleConvergencePauseEnabled = () => toggleApplicationBoolean('isConvergencePauseEnabled');
export const toggleLightIntensityCycling = () => toggleApplicationBoolean('isLightIntensityCycling');
export const togglePickingFocus = () => toggleApplicationBoolean('isPickingFocus');

export const applyQualityPreset = (presetName) => {
  const preset = QUALITY_PRESETS[presetName];
  if (!preset) {
    uiLogger.warn('state:quality-preset-unknown', {
      presetName,
      availablePresets: Object.keys(QUALITY_PRESETS)
    });
    return false;
  }
  uiLogger.info('state:quality-preset', {
    presetName,
    fieldNames: Object.keys(preset)
  });
  patchApplicationState(preset);
  return true;
};

export const resetColorCorrection = () => {
  const fieldNames = [
    'colorExposure',
    'colorBrightness',
    'colorContrast',
    'colorSaturation',
    'colorGamma',
    'toneMappingMode',
    'bloomStrength',
    'bloomThreshold',
    'glareStrength'
  ];
  const resetState = Object.fromEntries(
    fieldNames.map((fieldName) => [fieldName, DEFAULT_APPLICATION_STATE[fieldName]])
  );
  uiLogger.info('state:reset-color-correction', { fieldNames });
  patchApplicationState(resetState);
  return resetState;
};
