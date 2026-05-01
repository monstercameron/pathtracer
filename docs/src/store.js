import { batch, signal } from '@preact/signals';

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

export const DEFAULT_APPLICATION_STATE = Object.freeze({
  cameraAngleX: 0,
  cameraAngleY: 0,
  cameraDistance: 2.8,
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
  cameraFieldOfViewDegrees: 55,
  cameraFocusDistance: 2.5,
  cameraAperture: 0,
  motionBlurStrength: 0,
  denoiserStrength: 0.65,
  bloomStrength: 0.25,
  bloomThreshold: 1,
  glareStrength: 0.1,
  renderScale: 1,
  renderWidth: 512,
  renderHeight: 512,
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
  previousPointerX: 0,
  previousPointerY: 0,
  isInitialFrameReady: false,
  animationFrameId: 0,
  animationFrameCallback: null
});

export const APPLICATION_STATE_FIELDS = Object.freeze(Object.keys(DEFAULT_APPLICATION_STATE));

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

export const getApplicationSignals = () => applicationStateSignals;

export const getApplicationStateSignal = (fieldName) => {
  const fieldSignal = applicationStateSignals[fieldName];
  if (!fieldSignal) {
    throw new RangeError(`Unknown application state field "${fieldName}".`);
  }
  return fieldSignal;
};

export const getApplicationValue = (fieldName) => getApplicationStateSignal(fieldName).value;

export const setApplicationValue = (fieldName, value) => {
  const fieldSignal = getApplicationStateSignal(fieldName);
  const nextValue = cloneSignalValue(value);
  if (!Object.is(fieldSignal.value, nextValue)) {
    fieldSignal.value = nextValue;
  }
  return nextValue;
};

export const patchApplicationState = (partialState) => {
  if (!partialState || typeof partialState !== 'object') {
    return applicationStateSignals;
  }

  batch(() => {
    for (const [fieldName, value] of Object.entries(partialState)) {
      if (Object.prototype.hasOwnProperty.call(applicationStateSignals, fieldName)) {
        setApplicationValue(fieldName, value);
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
        signals[fieldName].value = cloneSignalValue(value);
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
export const previousPointerX = applicationStateSignals.previousPointerX;
export const previousPointerY = applicationStateSignals.previousPointerY;
export const isInitialFrameReady = applicationStateSignals.isInitialFrameReady;
export const animationFrameId = applicationStateSignals.animationFrameId;
export const animationFrameCallback = applicationStateSignals.animationFrameCallback;

export const setCameraAngleX = (value) => setApplicationValue('cameraAngleX', value);
export const setCameraAngleY = (value) => setApplicationValue('cameraAngleY', value);
export const setCameraDistance = (value) => setApplicationValue('cameraDistance', value);
export const setEyePosition = (value) => setApplicationValue('eyePosition', value);
export const setLightPosition = (value) => setApplicationValue('lightPosition', value);
export const setLightColor = (value) => setApplicationValue('lightColor', value);
export const setMaterial = (value) => setApplicationValue('material', value);
export const setGlossiness = (value) => setApplicationValue('glossiness', value);
export const setEnvironment = (value) => setApplicationValue('environment', value);
export const setLightIntensity = (value) => setApplicationValue('lightIntensity', value);
export const setLightSize = (value) => setApplicationValue('lightSize', value);
export const setFogDensity = (value) => setApplicationValue('fogDensity', value);
export const setSkyBrightness = (value) => setApplicationValue('skyBrightness', value);
export const setLightBounceCount = (value) => setApplicationValue('lightBounceCount', value);
export const setRaysPerPixel = (value) => setApplicationValue('raysPerPixel', value);
export const setTemporalBlendFrames = (value) => setApplicationValue('temporalBlendFrames', value);
export const setDenoiserStrength = (value) => setApplicationValue('denoiserStrength', value);
export const setColorExposure = (value) => setApplicationValue('colorExposure', value);
export const setColorBrightness = (value) => setApplicationValue('colorBrightness', value);
export const setColorContrast = (value) => setApplicationValue('colorContrast', value);
export const setColorSaturation = (value) => setApplicationValue('colorSaturation', value);
export const setColorGamma = (value) => setApplicationValue('colorGamma', value);
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
export const setCameraAutoRotating = (value) => setApplicationValue('isCameraAutoRotating', value);
export const setFramePaused = (value) => setApplicationValue('isFramePaused', value);
export const setConvergencePauseEnabled = (value) => setApplicationValue('isConvergencePauseEnabled', value);
export const setConvergencePaused = (value) => setApplicationValue('isConvergencePaused', value);
export const setPickingFocus = (value) => setApplicationValue('isPickingFocus', value);
