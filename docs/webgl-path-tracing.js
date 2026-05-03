/*
 WebGL Path Tracing (https://madebyevan.com/webgl-path-tracing/)
 License: MIT License

 Copyright (c) 2010 Evan Wallace
 Modernized local runtime changes copyright (c) 2026.
*/

import { effect } from '@preact/signals';
import {
  formattedBounces,
  formattedConvergence,
  formattedConvergenceTitle,
  formattedGpuMemory,
  formattedGpuMemoryTitle,
  formattedGpuRenderer,
  formattedMeasurementSource,
  formattedPerceptualFramesPerSecond,
  formattedPerformanceScore,
  formattedRayBandwidth,
  formattedRaysPerSecond,
  formattedResolution,
  formattedSamples,
  formattedSamplesTitle,
  formattedSceneComplexity,
  formattedSceneComplexityTitle,
  setBenchmarkGpuRenderer,
  updateBenchmarkSignals
} from './src/benchmarkStore.js';
import { applyRenderCanvasCssProperties } from './src/components/RenderCanvas.js';
import { captureLoggerEntry } from './src/logger.js';
import { bindLegacyApplicationStateObject } from './src/store.js';
import { setUiWindowVisible } from './src/store.js';
import {
  cancelScheduledRenderFrame,
  invokeWebGlRenderer,
  registerRenderCanvas,
  scheduleRenderFrame
} from './src/renderBridge.js';
import {
  SPONZA_GLB_REFERENCE_MODEL,
  SUZANNE_LOW_REFERENCE_MODEL
} from './src/referenceModelData.js';
import {
  DEFAULT_MATERIAL_GLOSSINESS,
  DEFAULT_MATERIAL_UV_BLEND_SHARPNESS,
  DEFAULT_MATERIAL_UV_PROJECTION_MODE,
  DEFAULT_MATERIAL_UV_SCALE,
  MaterialComponent,
  normalizeMaterialUvBlendSharpness,
  normalizeMaterialUvProjectionMode,
  normalizeMaterialUvScale
} from './src/components/MaterialComponent.js';
import { PhysicsComponent } from './src/components/PhysicsComponent.js';
import {
  selectedItemId as sceneStoreSelectedItemId,
  selectedItemIds as sceneStoreSelectedItemIds,
  setSceneItems as setSceneStoreSceneItems,
  setSelectedItemIds as setSceneStoreSelectedItemIds
} from './src/sceneStore.js';

'use strict';

const DEFAULT_CANVAS_SIZE = 512;
const MIN_CANVAS_SIZE = 1;
const MAX_CANVAS_SIZE = 8192;
const CANVAS_SIZE_PRESETS = Object.freeze([256, 384, 512, 768, 1024]);
const DEFAULT_RENDER_SCALE = 1;
const MIN_RENDER_SCALE = 0.25;
const MAX_RENDER_SCALE = 8;
const RENDER_SCALE_MODE_FRACTIONAL = 'fractional';
const RENDER_SCALE_MODE_PIXEL_PERFECT = 'pixel-perfect';
const RENDER_SCALE_FRACTIONAL_OPTIONS = Object.freeze([
  0.25,
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3
]);
const RENDER_SCALE_PIXEL_PERFECT_OPTIONS = Object.freeze([
  1,
  4,
  6,
  8
]);
const RENDER_SCALE_OPTIONS = Object.freeze([
  ...RENDER_SCALE_FRACTIONAL_OPTIONS,
  4,
  6,
  8
]);
const SHADER_REBUILD_INPUT_DEBOUNCE_MS = 100;
const normalizeCanvasDimension = (value, fallbackValue = DEFAULT_CANVAS_SIZE) => {
  const parsedSize = Number.parseFloat(value);
  if (!Number.isFinite(parsedSize)) {
    return fallbackValue;
  }
  return Math.min(Math.max(Math.round(parsedSize), MIN_CANVAS_SIZE), MAX_CANVAS_SIZE);
};
const normalizeCustomCanvasDimension = (value, fallbackValue = DEFAULT_CANVAS_SIZE) => {
  const parsedSize = Number.parseFloat(value);
  if (!Number.isFinite(parsedSize)) {
    return fallbackValue;
  }
  return Math.min(Math.max(Math.round(parsedSize), MIN_CANVAS_SIZE), MAX_CANVAS_SIZE);
};
const normalizeCanvasSize = (value) => normalizeCanvasDimension(value, DEFAULT_CANVAS_SIZE);
const readMaximumRenderScaleForCanvas = (visibleCanvasSize = null) => {
  if (!visibleCanvasSize || visibleCanvasSize.width <= 0 || visibleCanvasSize.height <= 0) {
    return MAX_RENDER_SCALE;
  }
  return Math.min(
    MAX_RENDER_SCALE,
    MAX_CANVAS_SIZE / visibleCanvasSize.width,
    MAX_CANVAS_SIZE / visibleCanvasSize.height
  );
};
const normalizeRenderScaleMode = (value) => (
  value === RENDER_SCALE_MODE_PIXEL_PERFECT
    ? RENDER_SCALE_MODE_PIXEL_PERFECT
    : RENDER_SCALE_MODE_FRACTIONAL
);
const readRenderScaleOptionsForMode = (renderScaleMode) => (
  normalizeRenderScaleMode(renderScaleMode) === RENDER_SCALE_MODE_PIXEL_PERFECT
    ? RENDER_SCALE_PIXEL_PERFECT_OPTIONS
    : RENDER_SCALE_FRACTIONAL_OPTIONS
);
const normalizeRenderScale = (value, visibleCanvasSize = null, renderScaleMode = null) => {
  const parsedScale = Number.parseFloat(value);
  const maximumRenderScale = readMaximumRenderScaleForCanvas(visibleCanvasSize);
  const baseScaleOptions = renderScaleMode === null
    ? RENDER_SCALE_OPTIONS
    : readRenderScaleOptionsForMode(renderScaleMode);
  const allowedScaleOptions = baseScaleOptions.filter((scale) => (
    scale >= MIN_RENDER_SCALE &&
    scale <= maximumRenderScale + Number.EPSILON
  ));
  const safeScaleOptions = allowedScaleOptions.length > 0 ? allowedScaleOptions : [MIN_RENDER_SCALE];
  if (!Number.isFinite(parsedScale)) {
    return safeScaleOptions.reduce((nearestScale, candidateScale) => (
      Math.abs(candidateScale - DEFAULT_RENDER_SCALE) < Math.abs(nearestScale - DEFAULT_RENDER_SCALE)
        ? candidateScale
        : nearestScale
    ), safeScaleOptions[0]);
  }
  const clampedScale = Math.min(Math.max(parsedScale, MIN_RENDER_SCALE), maximumRenderScale);
  return safeScaleOptions.reduce((nearestScale, candidateScale) => (
    Math.abs(candidateScale - clampedScale) < Math.abs(nearestScale - clampedScale)
      ? candidateScale
      : nearestScale
  ), safeScaleOptions[0]);
};
const formatRenderScaleNumber = (renderScale) => Number(renderScale).toFixed(2).replace(/\.?0+$/, '');
const formatRenderScaleValue = (renderScale) => `${formatRenderScaleNumber(renderScale)}x`;
const formatRenderResolution = (renderWidth, renderHeight) => `${renderWidth} x ${renderHeight}`;
const readStageCanvasSize = () => {
  const fallbackDimensions = (() => {
    if (typeof window === 'undefined') {
      return { width: DEFAULT_CANVAS_SIZE, height: DEFAULT_CANVAS_SIZE };
    }
    const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : DEFAULT_CANVAS_SIZE;
    const viewportHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : DEFAULT_CANVAS_SIZE;
    return {
      width: normalizeCanvasDimension(viewportWidth, DEFAULT_CANVAS_SIZE),
      height: normalizeCanvasDimension(viewportHeight, DEFAULT_CANVAS_SIZE)
    };
  })();

  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    return fallbackDimensions;
  }

  const stageElement = document.getElementById('main');
  const stageBounds = stageElement && typeof stageElement.getBoundingClientRect === 'function'
    ? stageElement.getBoundingClientRect()
    : null;
  const stageWidth = stageBounds && stageBounds.width > 0 ? stageBounds.width : 0;
  const stageHeight = stageBounds && stageBounds.height > 0 ? stageBounds.height : 0;
  if (stageWidth > 0 && stageHeight > 0) {
    return {
      width: normalizeCanvasDimension(stageWidth, fallbackDimensions.width),
      height: normalizeCanvasDimension(stageHeight, fallbackDimensions.height)
    };
  }
  return fallbackDimensions;
};
const deriveContainedUiCanvasSize = (renderWidth, renderHeight, stageCanvasSize = readStageCanvasSize()) => {
  const safeRenderWidth = normalizeCanvasDimension(renderWidth, DEFAULT_CANVAS_SIZE);
  const safeRenderHeight = normalizeCanvasDimension(renderHeight, DEFAULT_CANVAS_SIZE);
  const renderAspectRatio = safeRenderHeight > 0 ? safeRenderWidth / safeRenderHeight : 1;
  const stageAspectRatio = stageCanvasSize.height > 0 ? stageCanvasSize.width / stageCanvasSize.height : 1;
  if (renderAspectRatio >= stageAspectRatio) {
    const uiWidth = stageCanvasSize.width;
    return {
      width: normalizeCanvasDimension(uiWidth, DEFAULT_CANVAS_SIZE),
      height: normalizeCanvasDimension(uiWidth / renderAspectRatio, DEFAULT_CANVAS_SIZE)
    };
  }
  const uiHeight = stageCanvasSize.height;
  return {
    width: normalizeCanvasDimension(uiHeight * renderAspectRatio, DEFAULT_CANVAS_SIZE),
    height: normalizeCanvasDimension(uiHeight, DEFAULT_CANVAS_SIZE)
  };
};
const estimateRenderScaleForResolution = (renderWidth, renderHeight, stageCanvasSize = readStageCanvasSize()) => {
  const widthScale = stageCanvasSize.width > 0 ? renderWidth / stageCanvasSize.width : DEFAULT_RENDER_SCALE;
  const heightScale = stageCanvasSize.height > 0 ? renderHeight / stageCanvasSize.height : DEFAULT_RENDER_SCALE;
  return normalizeRenderScale((widthScale + heightScale) / 2, stageCanvasSize);
};
const deriveRenderResolutionForScale = (renderScale, stageCanvasSize = readStageCanvasSize()) => {
  const safeRenderScale = normalizeRenderScale(renderScale, stageCanvasSize);
  return {
    width: normalizeCanvasDimension(stageCanvasSize.width * safeRenderScale, DEFAULT_CANVAS_SIZE),
    height: normalizeCanvasDimension(stageCanvasSize.height * safeRenderScale, DEFAULT_CANVAS_SIZE)
  };
};
const readInitialRenderConfig = () => {
  if (typeof window === 'undefined' || !window.location || !window.URLSearchParams) {
    return {
      width: DEFAULT_CANVAS_SIZE,
      height: DEFAULT_CANVAS_SIZE,
      renderScale: DEFAULT_RENDER_SCALE
    };
  }
  const urlParameters = new window.URLSearchParams(window.location.search);
  const stageCanvasSize = readStageCanvasSize();
  const requestedRenderScale = normalizeRenderScale(urlParameters.get('renderScale'), stageCanvasSize);
  const hasRenderWidth = urlParameters.has('renderWidth');
  const hasRenderHeight = urlParameters.has('renderHeight');

  if (hasRenderWidth || hasRenderHeight) {
    const scaleResolution = deriveRenderResolutionForScale(requestedRenderScale, stageCanvasSize);
    const width = normalizeCustomCanvasDimension(urlParameters.get('renderWidth'), scaleResolution.width);
    const height = normalizeCustomCanvasDimension(urlParameters.get('renderHeight'), scaleResolution.height);
    return {
      width,
      height,
      renderScale: estimateRenderScaleForResolution(width, height, stageCanvasSize)
    };
  }

  if (urlParameters.has('resolution')) {
    const legacySize = normalizeCanvasSize(urlParameters.get('resolution'));
    return {
      width: legacySize,
      height: legacySize,
      renderScale: estimateRenderScaleForResolution(legacySize, legacySize, stageCanvasSize)
    };
  }

  const derivedResolution = deriveRenderResolutionForScale(
    urlParameters.has('renderScale') ? requestedRenderScale : DEFAULT_RENDER_SCALE,
    stageCanvasSize
  );
  return {
    width: derivedResolution.width,
    height: derivedResolution.height,
    renderScale: urlParameters.has('renderScale') ? requestedRenderScale : DEFAULT_RENDER_SCALE
  };
};
const INITIAL_RENDER_CONFIG = readInitialRenderConfig();
const CANVAS_RENDER_WIDTH = INITIAL_RENDER_CONFIG.width;
const CANVAS_RENDER_HEIGHT = INITIAL_RENDER_CONFIG.height;
const CANVAS_RENDER_SCALE = INITIAL_RENDER_CONFIG.renderScale;
const CANVAS_SIZE = Math.max(CANVAS_RENDER_WIDTH, CANVAS_RENDER_HEIGHT);
const CANVAS_RENDER_RESOLUTION_LABEL = formatRenderResolution(CANVAS_RENDER_WIDTH, CANVAS_RENDER_HEIGHT);
const CANVAS_SIZE_RECIPROCAL_X = 1 / CANVAS_RENDER_WIDTH;
const CANVAS_SIZE_RECIPROCAL_Y = 1 / CANVAS_RENDER_HEIGHT;
const CANVAS_ASPECT_RATIO = CANVAS_RENDER_WIDTH / CANVAS_RENDER_HEIGHT;
const DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES = 55;
const MIN_CAMERA_FIELD_OF_VIEW_DEGREES = 35;
const MAX_CAMERA_FIELD_OF_VIEW_DEGREES = 85;
const CAMERA_NEAR_PLANE = 0.1;
const CAMERA_FAR_PLANE = 100;
const CAMERA_NEAR_FAR_RANGE = 1 / (CAMERA_NEAR_PLANE - CAMERA_FAR_PLANE);
const CAMERA_ROTATION_SPEED = 0.01;
const CAMERA_AUTO_ROTATION_SPEED = 0.12;
const INITIAL_CAMERA_DISTANCE = 2.5;
const CAMERA_MODE_ORBIT = 'orbit';
const CAMERA_MODE_FPS = 'fps';
const CAMERA_PITCH_LIMIT = Math.PI / 2 - 0.01;
const FPS_CAMERA_MOUSE_SPEED = 0.0025;
const FPS_CAMERA_MOVE_SPEED = 1.45;
const FPS_CAMERA_FAST_MOVE_MULTIPLIER = 2.4;
const PHYSICS_FIXED_TIMESTEP_SECONDS = 1 / 60;
const PHYSICS_MAX_FRAME_SECONDS = 1 / 15;
const PHYSICS_SLEEP_CHECK_INTERVAL_SECONDS = 0.25;
const GLOBAL_GRAVITY_DIRECTION = Object.freeze({
  DOWN: 'down',
  UP: 'up',
  ZERO_G: 'zero-g',
  CUSTOM: 'custom'
});
const DEFAULT_GLOBAL_GRAVITY_DIRECTION = GLOBAL_GRAVITY_DIRECTION.DOWN;
const DEFAULT_GLOBAL_GRAVITY_MAGNITUDE = 9.81;
const MIN_GLOBAL_GRAVITY_MAGNITUDE = 0;
const MAX_GLOBAL_GRAVITY_MAGNITUDE = 20;
const DEFAULT_GLOBAL_GRAVITY_SCALE = 1;
const MIN_GLOBAL_GRAVITY_SCALE = -MAX_GLOBAL_GRAVITY_MAGNITUDE / DEFAULT_GLOBAL_GRAVITY_MAGNITUDE;
const MAX_GLOBAL_GRAVITY_SCALE = MAX_GLOBAL_GRAVITY_MAGNITUDE / DEFAULT_GLOBAL_GRAVITY_MAGNITUDE;
const GLOBAL_GRAVITY_DIRECTION_EPSILON = 0.0001;
const PHYSICS_GRAVITY_Y = -DEFAULT_GLOBAL_GRAVITY_MAGNITUDE;
const PHYSICS_ROOM_WALL_THICKNESS = 0.04;
const PHYSICS_SPHERE_RESTITUTION = 0.45;
const PHYSICS_SPHERE_FRICTION = 0.75;
const PHYSICS_CUBE_FRICTION = 0.85;
const PHYSICS_CUBE_RESTITUTION = 0.15;
const DEFAULT_PHYSICS_MASS = 1;
const MIN_PHYSICS_MASS = 0.1;
const MAX_PHYSICS_MASS = 10;
const DEFAULT_PHYSICS_GRAVITY_SCALE = 1;
const MIN_PHYSICS_GRAVITY_SCALE = 0;
const MAX_PHYSICS_GRAVITY_SCALE = 3;
const DEFAULT_PARTICLE_FLUID_PARTICLE_COUNT = 24;
const MIN_PARTICLE_FLUID_PARTICLE_COUNT = 8;
const MAX_PARTICLE_FLUID_PARTICLE_COUNT = 48;
const DEFAULT_PARTICLE_FLUID_RADIUS = 0.06;
const MIN_PARTICLE_FLUID_RADIUS = 0.035;
const MAX_PARTICLE_FLUID_RADIUS = 0.095;
const DEFAULT_PARTICLE_FLUID_SPRING_STIFFNESS = 120;
const MIN_PARTICLE_FLUID_SPRING_STIFFNESS = 40;
const MAX_PARTICLE_FLUID_SPRING_STIFFNESS = 240;
const DEFAULT_PARTICLE_FLUID_SPRING_REST_LENGTH = 0.14;
const PARTICLE_FLUID_NEIGHBOR_COUNT = 5;
const DEFAULT_PHYSICS_SPRING_REST_LENGTH = DEFAULT_PARTICLE_FLUID_SPRING_REST_LENGTH;
const MIN_PHYSICS_SPRING_REST_LENGTH = 0.02;
const MAX_PHYSICS_SPRING_REST_LENGTH = 1;
const DEFAULT_PHYSICS_SPRING_STIFFNESS = DEFAULT_PARTICLE_FLUID_SPRING_STIFFNESS;
const MIN_PHYSICS_SPRING_STIFFNESS = MIN_PARTICLE_FLUID_SPRING_STIFFNESS;
const MAX_PHYSICS_SPRING_STIFFNESS = MAX_PARTICLE_FLUID_SPRING_STIFFNESS;
const DEFAULT_PHYSICS_SPRING_DAMPING = 8;
const MIN_PHYSICS_SPRING_DAMPING = 0;
const MAX_PHYSICS_SPRING_DAMPING = 80;
// Rapier collision group masks: high 16 bits = memberships, low 16 bits = filter
// GROUP_FLOOR=0x0001, GROUP_OBJECTS=0x0002, GROUP_GHOST=0x0004
const PHYSICS_COLLISION_MASK_FLOOR = (0x0001 << 16) | 0xFFFF;    // floor collides with everything
const PHYSICS_COLLISION_MASK_OBJECTS = (0x0002 << 16) | 0x0003;  // normal objects: floor + other objects
const PHYSICS_COLLISION_MASK_GHOST = (0x0004 << 16) | 0x0001;    // ghost objects: floor only
const MIN_PHYSICS_SURFACE_COEFFICIENT = 0;
const MAX_PHYSICS_SURFACE_COEFFICIENT = 1;
const PHYSICS_POSITION_EPSILON = 0.00001;
const PHYSICS_OUT_OF_BOUNDS_Y = -5.0;
const DEFAULT_LIGHT_SIZE = 0.1;
const MIN_LIGHT_SIZE = 0.02;
const MAX_LIGHT_SIZE = 0.5;
const DEFAULT_LIGHT_INTENSITY = 0.5;
const MIN_LIGHT_INTENSITY = 0.1;
const MAX_LIGHT_INTENSITY = 1;
const LIGHT_INTENSITY_CYCLE_SPEED = 0.45;
const DEFAULT_LIGHT_COLOR_HEX = '#ffffff';
const DEFAULT_LIGHT_TEMPERATURE_KELVIN = 6500;
const MIN_LIGHT_TEMPERATURE_KELVIN = 1800;
const MAX_LIGHT_TEMPERATURE_KELVIN = 10000;
const LIGHT_TEMPERATURE_STEP_KELVIN = 100;
const DEFAULT_EMISSIVE_COLOR = Object.freeze([0.64, 0.92, 1.0]);
const DEFAULT_EMISSIVE_INTENSITY = 1.65;
const MIN_EMISSIVE_INTENSITY = 0;
const MAX_EMISSIVE_INTENSITY = 6;
const EMISSIVE_INTENSITY_STEP = 0.05;
const MIN_BLACKBODY_TEMPERATURE_KELVIN = 1200;
const DEFAULT_BLACKBODY_TEMPERATURE_KELVIN = 4200;
const MAX_BLACKBODY_TEMPERATURE_KELVIN = 12000;
const BLACKBODY_EMISSION_STRENGTH = 0.72;
const DEFAULT_FOG_DENSITY = 0;
const MIN_FOG_DENSITY = 0;
const MAX_FOG_DENSITY = 2;
const DEFAULT_SKY_BRIGHTNESS = 1.25;
const MIN_SKY_BRIGHTNESS = 0.1;
const MAX_SKY_BRIGHTNESS = 5;
const DEFAULT_LIGHT_BOUNCE_COUNT = 5;
const MIN_LIGHT_BOUNCE_COUNT = 1;
const MAX_LIGHT_BOUNCE_COUNT = 12;
const DEFAULT_RAYS_PER_PIXEL = 12;
const MIN_RAYS_PER_PIXEL = 1;
const MAX_RAYS_PER_PIXEL = 64;
const INTERACTIVE_QUALITY_RAYS_PER_PIXEL = 1;
const CONVERGED_SAMPLE_COUNT = 2048;
const DEFAULT_TEMPORAL_BLEND_FRAMES = 16;
const MIN_TEMPORAL_BLEND_FRAMES = 1;
const MAX_TEMPORAL_BLEND_FRAMES = 32;
const DEFAULT_COLOR_EXPOSURE = 0;
const MIN_COLOR_EXPOSURE = -4;
const MAX_COLOR_EXPOSURE = 4;
const DEFAULT_COLOR_BRIGHTNESS = 0;
const MIN_COLOR_BRIGHTNESS = -1;
const MAX_COLOR_BRIGHTNESS = 1;
const DEFAULT_COLOR_CONTRAST = 1;
const MIN_COLOR_CONTRAST = 0;
const MAX_COLOR_CONTRAST = 2;
const DEFAULT_COLOR_SATURATION = 1;
const MIN_COLOR_SATURATION = 0;
const MAX_COLOR_SATURATION = 2;
const DEFAULT_COLOR_GAMMA = 1;
const MIN_COLOR_GAMMA = 0.2;
const MAX_COLOR_GAMMA = 3;
const DEFAULT_CAMERA_FOCUS_DISTANCE = 2.5;
const MIN_CAMERA_FOCUS_DISTANCE = 0.5;
const MAX_CAMERA_FOCUS_DISTANCE = 6;
const DEFAULT_CAMERA_APERTURE = 0;
const MIN_CAMERA_APERTURE = 0;
const MAX_CAMERA_APERTURE = 0.2;
const DEFAULT_MOTION_BLUR_STRENGTH = 0;
const MIN_MOTION_BLUR_STRENGTH = 0;
const MAX_MOTION_BLUR_STRENGTH = 0.95;
const DEFAULT_DENOISER_STRENGTH = 0.65;
const MIN_DENOISER_STRENGTH = 0;
const MAX_DENOISER_STRENGTH = 1;
const DEFAULT_BLOOM_STRENGTH = 0.25;
const MIN_BLOOM_STRENGTH = 0;
const MAX_BLOOM_STRENGTH = 2;
const DEFAULT_BLOOM_THRESHOLD = 1;
const MIN_BLOOM_THRESHOLD = 0;
const MAX_BLOOM_THRESHOLD = 4;
const DEFAULT_GLARE_STRENGTH = 0.1;
const MIN_GLARE_STRENGTH = 0;
const MAX_GLARE_STRENGTH = 2;
const TONE_MAPPING = Object.freeze({
  LINEAR: 0,
  REINHARD: 1,
  ACES: 2,
  UNCHARTED2: 3,
  FILMIC: 3
});
const DEFAULT_TONE_MAPPING_MODE = TONE_MAPPING.LINEAR;
const QUALITY_PRESETS = Object.freeze({
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
    lightBounceCount: DEFAULT_LIGHT_BOUNCE_COUNT,
    raysPerPixel: DEFAULT_RAYS_PER_PIXEL,
    temporalBlendFrames: DEFAULT_TEMPORAL_BLEND_FRAMES,
    denoiserStrength: DEFAULT_DENOISER_STRENGTH,
    bloomStrength: DEFAULT_BLOOM_STRENGTH,
    bloomThreshold: DEFAULT_BLOOM_THRESHOLD,
    glareStrength: DEFAULT_GLARE_STRENGTH
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
const QUALITY_PRESET_STATE_KEYS = Object.freeze([
  'lightBounceCount',
  'raysPerPixel',
  'temporalBlendFrames',
  'denoiserStrength',
  'bloomStrength',
  'bloomThreshold',
  'glareStrength'
]);
const ACTIVE_RAYS_PER_SAMPLE = CANVAS_RENDER_WIDTH * CANVAS_RENDER_HEIGHT;
const BENCHMARK_TIMER_QUERY_LIMIT = 4;
const BENCHMARK_TIMER_QUERY_INTERVAL_MILLISECONDS = 250;
const BENCHMARK_TIMER_POLL_INTERVAL_MILLISECONDS = 125;
const BENCHMARK_UPDATE_INTERVAL_MILLISECONDS = 250;
const BENCHMARK_ROLLING_WINDOW_MILLISECONDS = 60000;
const BENCHMARK_ROLLING_INITIAL_SAMPLE_CAPACITY = 4096;
const BENCHMARK_FRAME_BUCKET_MILLISECONDS = 500;
const BENCHMARK_RUNNER_DEFAULT_WARMUP_MILLISECONDS = 3000;
const BENCHMARK_RUNNER_DEFAULT_MEASUREMENT_MILLISECONDS = 10000;
const BENCHMARK_RUNNER_SAMPLE_INTERVAL_MILLISECONDS = BENCHMARK_UPDATE_INTERVAL_MILLISECONDS;
const BENCHMARK_BASELINE_STORAGE_KEY = 'pathtracer-benchmark-baseline-v1';
const BENCHMARK_SHARE_HASH_KEY = 'result';
const BENCHMARK_LEGACY_SHARE_HASH_KEY = 'benchmarkResults';
const SCENE_FILE_SCHEMA = 'pathtracer.scene';
const SCENE_FILE_VERSION = 1;
const BENCHMARK_SCORE_CARD_WIDTH = 800;
const BENCHMARK_SCORE_CARD_HEIGHT = 400;
const MAX_PERCEPTUAL_FRAMES_PER_SECOND = 240;
const PERFORMANCE_SCORE_RAYS_PER_SECOND_UNIT = 100000;
const PERFORMANCE_SCORE_READY_TRACE_SAMPLE_COUNT = 12;
const PERFORMANCE_SCORE_QUANTUM = 5;
const PERFORMANCE_SCORE_REFERENCE_RENDER_PIXELS = DEFAULT_CANVAS_SIZE * DEFAULT_CANVAS_SIZE;
const DEFAULT_BENCHMARK_SCENE_NAME = 'benchmarkSponzaAtrium';
const BENCHMARK_CAMERA_AUTO_ROTATION_SPEED = CAMERA_AUTO_ROTATION_SPEED;
const NANOSECONDS_PER_MILLISECOND = 1000000;
const RANDOM_SAMPLE_SEQUENCE_WRAP = 1048576;
const SKY_TEXTURE_WIDTH = 256;
const SKY_TEXTURE_HEIGHT = 128;
const MATERIAL_ALBEDO_TEXTURE_SIZE = 64;
const BYTES_PER_RGBA_PIXEL = 4;
const BYTES_PER_HALF_FLOAT_RGBA_PIXEL = 8;
const BYTES_PER_FLOAT_RGBA_PIXEL = 16;
const TRACE_ACCUMULATION_TEXTURE_TRANSFERS_PER_SAMPLE = 2;
const PATH_TRACER_RENDER_TEXTURE_COUNT = 4;
const PATH_TRACER_VERTEX_BUFFER_BYTES = 8 * Float32Array.BYTES_PER_ELEMENT;
const BYTES_PER_MEGABYTE = 1000000;
const BYTES_PER_GIGABYTE = 1000000000;
const BYTES_PER_TERABYTE = 1000000000000;
const HALF_FLOAT_TEXTURE_TYPE = 0x8D61;
const UINT32_RECIPROCAL = 1 / 4294967296;
const HALTON_BASE_3_RECIPROCAL = 1 / 3;
const RAY_JITTER_COMPONENT_COUNT = 2;
const SHADER_EPSILON = '0.0001';
const SDF_TRACE_STEP_COUNT = 72;
const SDF_SURFACE_EPSILON = '0.0015';
const SDF_TRACE_MIN_STEP = '0.0015';
const SDF_TRACE_MAX_STEP = '0.08';
const SHADER_INFINITY = '10000.0';
const MAX_INTERSECTION_DISTANCE = Number.MAX_VALUE;
const FLOATS_PER_VEC3 = 3;
const FLOATS_PER_MAT4 = 16;
const WEBGL_POWER_PREFERENCE = 'high-performance';
const HIGH_PERFORMANCE_WEBGL_CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: false,
  antialias: false,
  depth: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: true,
  powerPreference: WEBGL_POWER_PREFERENCE,
  failIfMajorPerformanceCaveat: false,
  stencil: false
});
const PREFERRED_GPU_RENDERER_PATTERNS = Object.freeze([/\bB580\b/i, /\bArc\b/i]);
const TEMPORAL_DISPLAY_SCALAR_UNIFORM_NAMES = Object.freeze([
  'temporalBlendFrames',
  'temporalFrameAge',
  'historyAvailability',
  'motionBlurStrength',
  'denoiserStrength'
]);
const TRACER_FRAME_SCALAR_UNIFORM_NAMES = Object.freeze([
  'glossiness',
  'lightIntensity',
  'lightSize',
  'fogDensity',
  'skyBrightness',
  'cameraFocusDistance',
  'cameraAperture',
  'renderDebugViewMode',
  'activeLightBounceCount'
]);
const RENDER_SCALAR_UNIFORM_NAMES = Object.freeze([
  'colorExposureScale',
  'colorBrightness',
  'colorContrast',
  'colorSaturation',
  'colorGamma',
  'toneMappingMode',
  'bloomStrength',
  'bloomThreshold',
  'glareStrength'
]);

const MATERIAL = Object.freeze({
  DIFFUSE: 0,
  MIRROR: 1,
  GLOSSY: 2,
  GLASS: 3,
  GGX_PBR: 4,
  SPECTRAL_GLASS: 5,
  SUBSURFACE: 6,
  CAUSTICS: 7,
  PROCEDURAL: 8,
  SDF_FRACTAL: 9,
  VOLUMETRIC_SHAFTS: 10,
  BOKEH: 11,
  MOTION_BLUR_STRESS: 12,
  FIRE_PLASMA: 13,
  THIN_FILM: 14,
  RETROREFLECTOR: 15,
  VELVET: 16,
  VORONOI_CRACKS: 17,
  DIFFRACTION_GRATING: 18,
  ANISOTROPIC_GGX: 19,
  BLACKBODY: 20,
  EMISSIVE: 21,
  TOON: 22,
  X_RAY: 23,
  HETEROGENEOUS_FOG: 24,
  BARK_CORK: 25,
  RUBBER: 26,
  MATTE_PLASTIC: 27,
  WOOD_GRAIN: 28,
  MARBLE: 29,
  CERAMIC_GLAZE: 30,
  CLEAR_COAT_AUTOMOTIVE: 31,
  SKIN_WAX: 32,
  LEATHER: 33,
  SAND: 34,
  SNOW: 35,
  AMBER_HONEY: 36,
  SOAP_FOAM: 37,
  WOVEN_FABRIC: 38,
  WATER_LIQUID: 39,
  ICE_FROSTED_GLASS: 40,
  PEARLESCENT_OPAL: 41,
  CARBON_FIBRE: 42,
  FUR_SHORT_HAIR: 43,
  CITRUS_PEEL: 44,
  FRUIT_FLESH: 45,
  LEAF_CUTICLE: 46,
  MOSS_GRASS: 47
});
const MIN_MATERIAL = MATERIAL.DIFFUSE;
const MAX_MATERIAL = MATERIAL.MOSS_GRASS;

const MATERIAL_SELECT_OPTIONS = Object.freeze([
  [MATERIAL.DIFFUSE, 'Diffuse'],
  [MATERIAL.MIRROR, 'Mirror'],
  [MATERIAL.GLOSSY, 'Glossy'],
  [MATERIAL.GLASS, 'Glass'],
  [MATERIAL.GGX_PBR, 'GGX PBR'],
  [MATERIAL.SPECTRAL_GLASS, 'Spectral Glass'],
  [MATERIAL.SUBSURFACE, 'Subsurface'],
  [MATERIAL.CAUSTICS, 'Caustics'],
  [MATERIAL.PROCEDURAL, 'Procedural Pack'],
  [MATERIAL.SDF_FRACTAL, 'SDF Fractal'],
  [MATERIAL.VOLUMETRIC_SHAFTS, 'Volumetric Shafts'],
  [MATERIAL.HETEROGENEOUS_FOG, 'Heterogeneous Fog'],
  [MATERIAL.BOKEH, 'Bokeh'],
  [MATERIAL.MOTION_BLUR_STRESS, 'Motion Blur Stress'],
  [MATERIAL.FIRE_PLASMA, 'Fire Plasma'],
  [MATERIAL.THIN_FILM, 'Thin Film'],
  [MATERIAL.RETROREFLECTOR, 'Retroreflector'],
  [MATERIAL.VELVET, 'Velvet Sheen'],
  [MATERIAL.VORONOI_CRACKS, 'Voronoi Cracks'],
  [MATERIAL.DIFFRACTION_GRATING, 'Diffraction Grating'],
  [MATERIAL.ANISOTROPIC_GGX, 'Anisotropic GGX'],
  [MATERIAL.BLACKBODY, 'Blackbody'],
  [MATERIAL.EMISSIVE, 'Emissive'],
  [MATERIAL.TOON, 'Toon'],
  [MATERIAL.X_RAY, 'X-Ray'],
  [MATERIAL.BARK_CORK, 'Bark / Cork'],
  [MATERIAL.RUBBER, 'Rubber'],
  [MATERIAL.MATTE_PLASTIC, 'Matte Plastic'],
  [MATERIAL.WOOD_GRAIN, 'Wood Grain'],
  [MATERIAL.MARBLE, 'Marble / Veined Stone'],
  [MATERIAL.CERAMIC_GLAZE, 'Ceramic Glaze'],
  [MATERIAL.CLEAR_COAT_AUTOMOTIVE, 'Clear Coat Automotive'],
  [MATERIAL.SKIN_WAX, 'Skin / Wax'],
  [MATERIAL.LEATHER, 'Leather'],
  [MATERIAL.SAND, 'Sand / Soil'],
  [MATERIAL.SNOW, 'Snow / Powder'],
  [MATERIAL.AMBER_HONEY, 'Amber / Honey Resin'],
  [MATERIAL.SOAP_FOAM, 'Soap / Foam'],
  [MATERIAL.WOVEN_FABRIC, 'Woven Fabric'],
  [MATERIAL.WATER_LIQUID, 'Water / Liquid'],
  [MATERIAL.ICE_FROSTED_GLASS, 'Ice / Frosted Glass'],
  [MATERIAL.PEARLESCENT_OPAL, 'Pearlescent / Opal'],
  [MATERIAL.CARBON_FIBRE, 'Carbon Fibre'],
  [MATERIAL.FUR_SHORT_HAIR, 'Fur / Short Hair'],
  [MATERIAL.CITRUS_PEEL, 'Orange / Citrus Peel'],
  [MATERIAL.FRUIT_FLESH, 'Fruit Flesh'],
  [MATERIAL.LEAF_CUTICLE, 'Leaf / Plant Cuticle'],
  [MATERIAL.MOSS_GRASS, 'Moss / Grass']
]);

const formatShaderFloat = (value) => Number(value).toFixed(4);

const formatShaderVec3 = (vector) => (
  `vec3(${formatShaderFloat(vector[0])}, ${formatShaderFloat(vector[1])}, ${formatShaderFloat(vector[2])})`
);

const RENDER_DEBUG_VIEW = Object.freeze({
  BEAUTY: 0,
  ALBEDO: 1,
  NORMALS: 2,
  DEPTH: 3
});

const RENDER_DEBUG_VIEW_MODES = Object.freeze({
  beauty: RENDER_DEBUG_VIEW.BEAUTY,
  albedo: RENDER_DEBUG_VIEW.ALBEDO,
  normals: RENDER_DEBUG_VIEW.NORMALS,
  depth: RENDER_DEBUG_VIEW.DEPTH
});

const ENVIRONMENT = Object.freeze({
  YELLOW_BLUE_CORNELL_BOX: 0,
  RED_GREEN_CORNELL_BOX: 1,
  OPEN_SKY_STUDIO: 2
});

const PHYSICS_BODY_TYPE = Object.freeze({
  STATIC: 'static',
  KINEMATIC: 'kinematic',
  // Legacy saved scenes used "fixed"; normalize it to "static" at read time.
  FIXED: 'fixed',
  DYNAMIC: 'dynamic'
});

const RECURSIVE_SPHERE_DIRECTION = Object.freeze({
  X_NEGATIVE: 0,
  X_POSITIVE: 1,
  Y_NEGATIVE: 2,
  Y_POSITIVE: 3,
  Z_NEGATIVE: 4,
  Z_POSITIVE: 5
});

const renderVertexSource = [
  'attribute vec2 vertex;',
  'varying vec2 texCoord;',
  'void main() {',
  '  texCoord = vertex.xy * 0.5 + 0.5;',
  '  gl_Position = vec4(vertex, 0.0, 1.0);',
  '}'
].join('');

const renderColorManagementSource = [
  'float renderColorLuminance(vec3 color) {',
  '  return dot(color, vec3(0.2126, 0.7152, 0.0722));',
  '}',
  'vec3 applyExposure(vec3 color) {',
  '  return color * colorExposureScale;',
  '}',
  'vec3 applyBrightness(vec3 color) {',
  '  return color + vec3(colorBrightness);',
  '}',
  'vec3 applyContrast(vec3 color) {',
  '  return (color - vec3(0.5)) * colorContrast + vec3(0.5);',
  '}',
  'vec3 applySaturation(vec3 color) {',
  '  return mix(vec3(renderColorLuminance(color)), color, colorSaturation);',
  '}',
  'vec3 applyGamma(vec3 color) {',
  '  return pow(max(color, vec3(0.0)), vec3(1.0 / max(colorGamma, 0.01)));',
  '}',
  'vec3 applyAcesToneMapping(vec3 color) {',
  '  return clamp((color * (2.51 * color + vec3(0.03))) / (color * (2.43 * color + vec3(0.59)) + vec3(0.14)), 0.0, 1.0);',
  '}',
  'vec3 applyUncharted2ToneMapping(vec3 color) {',
  '  const float A = 0.15;',
  '  const float B = 0.50;',
  '  const float C = 0.10;',
  '  const float D = 0.20;',
  '  const float E = 0.02;',
  '  const float F = 0.30;',
  '  const float W = 11.2;',
  '  vec3 mapped = ((color * (A * color + vec3(C * B)) + vec3(D * E)) / (color * (A * color + vec3(B)) + vec3(D * F))) - vec3(E / F);',
  '  float whiteScale = 1.0 / (((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F);',
  '  return clamp(mapped * whiteScale, 0.0, 1.0);',
  '}',
  'vec3 applyToneMapping(vec3 color) {',
  '  if(toneMappingMode < 0.5) return color;',
  '  if(toneMappingMode < 1.5) return color / (vec3(1.0) + max(color, vec3(0.0)));',
  '  if(toneMappingMode < 2.5) return applyAcesToneMapping(color);',
  '  return applyUncharted2ToneMapping(color);',
  '}'
].join('');

const renderBloomSource = [
  `vec2 bloomPixelStep() { return vec2(1.0 / ${CANVAS_RENDER_WIDTH}.0, 1.0 / ${CANVAS_RENDER_HEIGHT}.0); }`,
  'vec3 extractBloomColorFromExposed(vec3 exposedColor) {',
  '  float luminance = renderColorLuminance(exposedColor);',
  '  float knee = max(bloomThreshold * 0.25, 0.001);',
  '  float bloomWeight = smoothstep(bloomThreshold - knee, bloomThreshold + knee, luminance);',
  '  return exposedColor * bloomWeight;',
  '}',
  'vec3 extractBloomColor(vec3 color) {',
  '  return extractBloomColorFromExposed(applyExposure(color));',
  '}',
  'vec3 sampleBloomTap(vec2 texCoord, vec2 offset, float weight) {',
  '  vec2 sampleCoord = texCoord + offset * bloomPixelStep();',
  '  return extractBloomColor(texture2D(texture, sampleCoord).rgb) * weight;',
  '}',
  'vec3 gatherBloom(vec2 texCoord, vec3 centerExposedColor) {',
  '  vec3 bloomColor = vec3(0.0);',
  '  float radius = 1.0 + bloomStrength * 5.0;',
  '  bloomColor += extractBloomColorFromExposed(centerExposedColor) * 0.24;',
  '  bloomColor += sampleBloomTap(texCoord, vec2(radius, 0.0), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(-radius, 0.0), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(0.0, radius), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(0.0, -radius), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(radius, radius), 0.07);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(-radius, radius), 0.07);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(radius, -radius), 0.07);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(-radius, -radius), 0.07);',
  '  return bloomColor;',
  '}',
  'vec3 gatherGlare(vec2 texCoord) {',
  '  vec3 glareColor = vec3(0.0);',
  '  float radius = 2.0 + glareStrength * 8.0;',
  '  glareColor += sampleBloomTap(texCoord, vec2(radius, 0.0), 0.18);',
  '  glareColor += sampleBloomTap(texCoord, vec2(-radius, 0.0), 0.18);',
  '  glareColor += sampleBloomTap(texCoord, vec2(radius * 2.0, 0.0), 0.10);',
  '  glareColor += sampleBloomTap(texCoord, vec2(-radius * 2.0, 0.0), 0.10);',
  '  glareColor += sampleBloomTap(texCoord, vec2(0.0, radius), 0.14);',
  '  glareColor += sampleBloomTap(texCoord, vec2(0.0, -radius), 0.14);',
  '  glareColor += sampleBloomTap(texCoord, vec2(radius, radius), 0.08);',
  '  glareColor += sampleBloomTap(texCoord, vec2(-radius, -radius), 0.08);',
  '  return glareColor;',
  '}'
].join('');

const renderFragmentSource = [
  'precision highp float;',
  'varying vec2 texCoord;',
  'uniform sampler2D texture;',
  'uniform float colorExposureScale;',
  'uniform float colorBrightness;',
  'uniform float colorContrast;',
  'uniform float colorSaturation;',
  'uniform float colorGamma;',
  'uniform float toneMappingMode;',
  'uniform float bloomStrength;',
  'uniform float bloomThreshold;',
  'uniform float glareStrength;',
  renderColorManagementSource,
  renderBloomSource,
  'void main() {',
  '  vec3 sourceColor = texture2D(texture, texCoord).rgb;',
  '  vec3 color = sourceColor;',
  '  if(abs(colorExposureScale - 1.0) > 0.0001) color = applyExposure(color);',
  '  if(bloomStrength > 0.0001) color += gatherBloom(texCoord, color) * bloomStrength;',
  '  if(glareStrength > 0.0001) color += gatherGlare(texCoord) * glareStrength;',
  '  if(abs(colorBrightness) > 0.0001) color = applyBrightness(color);',
  '  if(abs(colorContrast - 1.0) > 0.0001) color = applyContrast(color);',
  '  if(abs(colorSaturation - 1.0) > 0.0001) color = applySaturation(color);',
  '  color = applyToneMapping(color);',
  '  if(abs(colorGamma - 1.0) > 0.0001) color = applyGamma(color);',
  '  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);',
  '}'
].join('');

const lineVertexSource = [
  'precision highp float;',
  'attribute vec3 selectionVertex;',
  'uniform vec3 cubeMin;',
  'uniform vec3 cubeMax;',
  'uniform mat4 modelviewProjection;',
  'void main() {',
  '  vec3 boxPosition = cubeMin + (cubeMax - cubeMin) * selectionVertex;',
  '  gl_Position = modelviewProjection * vec4(boxPosition, 1.0);',
  '}'
].join('\n');

const lineFragmentSource = [
  'precision highp float;',
  'void main() {',
  '  gl_FragColor = vec4(1.0);',
  '}'
].join('\n');

const tracerVertexSource = [
  'precision highp float;',
  'attribute vec2 vertex;',
  'uniform vec3 rayCenter, rayClipX, rayClipY;',
  'uniform vec2 rayJitter;',
  'varying vec3 initialRay;',
  'void main() {',
  '  vec2 jitteredClip = vertex.xy + rayJitter;',
  '  initialRay = rayCenter + rayClipX * jitteredClip.x + rayClipY * jitteredClip.y;',
  '  gl_Position = vec4(vertex, 0.0, 1.0);',
  '}'
].join('');

const tracerFragmentSourceHeader = [
  'precision highp float;',
  'uniform vec3 eye;',
  'varying vec3 initialRay;',
  'uniform float textureWeight;',
  'uniform float sampleSeed;',
  'uniform sampler2D texture;',
  'uniform float glossiness;',
  'uniform float lightIntensity;',
  'uniform float lightSize;',
  'uniform vec3 lightColor;',
  'uniform float fogDensity;',
  'uniform float skyBrightness;',
  'uniform float renderDebugViewMode;',
  'uniform float activeLightBounceCount;',
  'uniform vec3 cameraRight;',
  'uniform vec3 cameraUp;',
  'uniform float cameraFocusDistance;',
  'uniform float cameraAperture;',
  'uniform sampler2D skyTexture;',
  'uniform sampler2D materialAlbedoTexture;',
  'vec3 roomCubeMin = vec3(-1.0, -1.0, -1.0);',
  'vec3 roomCubeMax = vec3(1.0, 1.0, 1.0);'
].join('');

const intersectCubeSource = [
  'vec2 intersectCube(vec3 origin, vec3 inverseRay, vec3 cubeMin, vec3 cubeMax) {',
  '  vec3 tMin = (cubeMin - origin) * inverseRay;',
  '  vec3 tMax = (cubeMax - origin) * inverseRay;',
  '  vec3 t1 = min(tMin, tMax);',
  '  vec3 t2 = max(tMin, tMax);',
  '  float tNear = max(max(t1.x, t1.y), t1.z);',
  '  float tFar = min(min(t2.x, t2.y), t2.z);',
  '  return vec2(tNear, tFar);',
  '}'
].join('');

const intersectCubeDistanceSource = [
  'float intersectCubeDistance(vec2 cubeHit) {',
  `  if(cubeHit.x >= cubeHit.y) return ${SHADER_INFINITY};`,
  `  if(cubeHit.x > ${SHADER_EPSILON}) return cubeHit.x;`,
  `  if(cubeHit.y > ${SHADER_EPSILON}) return cubeHit.y;`,
  `  return ${SHADER_INFINITY};`,
  '}'
].join('');

const normalForCubeSource = [
  'vec3 normalForCube(vec3 hit, vec3 cubeMin, vec3 cubeMax) {',
  `  if(hit.x < cubeMin.x + ${SHADER_EPSILON}) return vec3(-1.0, 0.0, 0.0);`,
  `  else if(hit.x > cubeMax.x - ${SHADER_EPSILON}) return vec3(1.0, 0.0, 0.0);`,
  `  else if(hit.y < cubeMin.y + ${SHADER_EPSILON}) return vec3(0.0, -1.0, 0.0);`,
  `  else if(hit.y > cubeMax.y - ${SHADER_EPSILON}) return vec3(0.0, 1.0, 0.0);`,
  `  else if(hit.z < cubeMin.z + ${SHADER_EPSILON}) return vec3(0.0, 0.0, -1.0);`,
  '  else return vec3(0.0, 0.0, 1.0);',
  '}'
].join('');

const intersectSphereSource = [
  'float intersectSphere(vec3 origin, vec3 ray, float rayLengthSquared, vec3 sphereCenter, float sphereRadius) {',
  '  vec3 toSphere = origin - sphereCenter;',
  '  float halfB = dot(toSphere, ray);',
  '  float c = dot(toSphere, toSphere) - sphereRadius*sphereRadius;',
  '  float discriminant = halfB*halfB - rayLengthSquared*c;',
  '  if(discriminant > 0.0) {',
  '    float root = sqrt(discriminant);',
  '    float tNear = (-halfB - root) / rayLengthSquared;',
  `    if(tNear > ${SHADER_EPSILON}) return tNear;`,
  '    float tFar = (-halfB + root) / rayLengthSquared;',
  `    if(tFar > ${SHADER_EPSILON}) return tFar;`,
  '  }',
  `  return ${SHADER_INFINITY};`,
  '}'
].join('');

const intersectTriangleSource = [
  'float intersectTriangle(vec3 origin, vec3 ray, vec3 a, vec3 b, vec3 c) {',
  '  vec3 edge1 = b - a;',
  '  vec3 edge2 = c - a;',
  '  vec3 pvec = cross(ray, edge2);',
  '  float det = dot(edge1, pvec);',
  `  if(abs(det) < ${SHADER_EPSILON}) return ${SHADER_INFINITY};`,
  '  float invDet = 1.0 / det;',
  '  vec3 tvec = origin - a;',
  '  float u = dot(tvec, pvec) * invDet;',
  `  if(u < 0.0 || u > 1.0) return ${SHADER_INFINITY};`,
  '  vec3 qvec = cross(tvec, edge1);',
  '  float v = dot(ray, qvec) * invDet;',
  `  if(v < 0.0 || u + v > 1.0) return ${SHADER_INFINITY};`,
  '  float t = dot(edge2, qvec) * invDet;',
  `  return t > ${SHADER_EPSILON} ? t : ${SHADER_INFINITY};`,
  '}'
].join('');

const shadowSphereSource = [
  'bool shadowSphere(vec3 origin, vec3 ray, float inverseRayLengthSquared, vec3 sphereCenter, float sphereRadius) {',
  '  vec3 toSphere = origin - sphereCenter;',
  `  float closestRayTime = clamp(-dot(toSphere, ray) * inverseRayLengthSquared, ${SHADER_EPSILON}, 1.0);`,
  '  vec3 closestPoint = toSphere + ray * closestRayTime;',
  '  return dot(closestPoint, closestPoint) <= sphereRadius * sphereRadius;',
  '}'
].join('');

const normalForSphereSource = [
  'vec3 normalForSphere(vec3 hit, vec3 sphereCenter, float sphereRadius) {',
  '  return (hit - sphereCenter) / sphereRadius;',
  '}'
].join('');

const randomSource = [
  'float random(vec3 scale, float seed) {',
  '  vec3 hashInput = vec3(gl_FragCoord.xy, seed) + scale;',
  '  hashInput = fract(hashInput * vec3(0.1031, 0.11369, 0.13787));',
  '  hashInput += dot(hashInput, hashInput.yzx + 33.33);',
  '  return fract((hashInput.x + hashInput.y) * hashInput.z);',
  '}'
].join('');

const cosineWeightedDirectionSource = [
  'vec3 cosineWeightedDirection(float seed, vec3 normal) {',
  '  float u = random(vec3(12.9898, 78.233, 151.7182), seed);',
  '  float v = random(vec3(63.7264, 10.873, 623.6736), seed);',
  '  float r = sqrt(u);',
  '  float angle = 6.283185307179586 * v;',
  '  vec3 sdir, tdir;',
  '  if (abs(normal.x)<.5) {',
  '    sdir = cross(normal, vec3(1,0,0));',
  '  } else {',
  '    sdir = cross(normal, vec3(0,1,0));',
  '  }',
  '  tdir = cross(normal, sdir);',
  '  return r*cos(angle)*sdir + r*sin(angle)*tdir + sqrt(1.-u)*normal;',
  '}'
].join('');

const uniformlyRandomDirectionSource = [
  'vec3 uniformlyRandomDirection(float seed) {',
  '  float u = random(vec3(12.9898, 78.233, 151.7182), seed);',
  '  float v = random(vec3(63.7264, 10.873, 623.6736), seed);',
  '  float z = 1.0 - 2.0 * u;',
  '  float r = sqrt(1.0 - z * z);',
  '  float angle = 6.283185307179586 * v;',
  '  return vec3(r * cos(angle), r * sin(angle), z);',
  '}'
].join('');

const uniformlyRandomVectorSource = [
  'vec3 uniformlyRandomVector(float seed) {',
  '  return uniformlyRandomDirection(seed) * sqrt(random(vec3(36.7539, 50.3658, 306.2759), seed));',
  '}'
].join('');

const randomLightOffsetSource = [
  'vec3 randomLightOffset(float seed) {',
  '  vec3 offset = vec3(',
  '    random(vec3(17.17, 41.41, 73.73), seed),',
  '    random(vec3(29.29, 59.59, 97.97), seed + 11.0),',
  '    random(vec3(43.43, 83.83, 13.13), seed + 23.0)',
  '  ) * 2.0 - 1.0;',
  '  return offset * lightSize;',
  '}'
].join('');

const specularReflectionSource = [
  'vec3 reflectedLight = normalize(reflect(light - hit, normal));',
  'specularHighlight = max(0.0, dot(reflectedLight, normalize(hit - origin)));'
].join('');

const newDiffuseRaySource = 'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);';

const newReflectiveRaySource = [
  'ray = reflect(ray, normal);',
  specularReflectionSource,
  'float specularPower2 = specularHighlight * specularHighlight;',
  'float specularPower4 = specularPower2 * specularPower2;',
  'float specularPower5 = specularPower4 * specularHighlight;',
  'float specularPower10 = specularPower5 * specularPower5;',
  'specularHighlight = 2.0 * specularPower10 * specularPower10;'
].join('');

const newGlossyRaySource = [
  'ray = normalize(reflect(ray, normal)) + uniformlyRandomVector(sampleSeed + float(bounce) * 17.0) * glossiness;',
  specularReflectionSource,
  'specularHighlight = specularHighlight * specularHighlight * specularHighlight;'
].join('');

const newGlassRaySource = [
  'surfaceColor = vec3(0.96, 0.985, 1.0);',
  'surfaceLightResponse = 0.0;',
  'vec3 normalizedRay = normalize(ray);',
  'float isOutsideSurface = dot(normalizedRay, normal) < 0.0 ? 1.0 : 0.0;',
  'vec3 orientedNormal = isOutsideSurface > 0.5 ? normal : -normal;',
  'float etaRatio = isOutsideSurface > 0.5 ? 0.6666667 : 1.5;',
  'float cosTheta = min(dot(-normalizedRay, orientedNormal), 1.0);',
  'float sinThetaSquared = max(0.0, 1.0 - cosTheta * cosTheta);',
  'float fresnelBase = 0.04;',
  'float oneMinusCosTheta = 1.0 - cosTheta;',
  'float fresnelFactor2 = oneMinusCosTheta * oneMinusCosTheta;',
  'float fresnelFactor5 = fresnelFactor2 * fresnelFactor2 * oneMinusCosTheta;',
  'float fresnel = fresnelBase + (1.0 - fresnelBase) * fresnelFactor5;',
  'vec3 refractedRay = refract(normalizedRay, orientedNormal, etaRatio);',
  'float reflectionSample = random(vec3(71.17, 19.31, 53.91), sampleSeed + float(bounce) * 29.0);',
  'if(etaRatio * etaRatio * sinThetaSquared > 1.0 || reflectionSample < fresnel) {',
  '  ray = reflect(normalizedRay, orientedNormal);',
  '} else {',
  '  ray = refractedRay;',
  '}',
  'colorMask *= surfaceColor;',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const surfaceShaderUtilitySource = [
  'float shaderNoise(vec3 point) {',
  '  vec3 hashInput = fract(point * vec3(0.1031, 0.11369, 0.13787));',
  '  hashInput += dot(hashInput, hashInput.yzx + 33.33);',
  '  return fract((hashInput.x + hashInput.y) * hashInput.z);',
  '}',
  'float shaderFbm(vec3 point) {',
  '  float value = 0.0;',
  '  float amplitude = 0.5;',
  '  vec3 samplePoint = point;',
  '  for(int octave = 0; octave < 4; octave++) {',
  '    value += shaderNoise(samplePoint) * amplitude;',
  '    samplePoint = samplePoint * 2.17 + vec3(13.7, 5.1, 9.2);',
  '    amplitude *= 0.5;',
  '  }',
  '  return value;',
  '}',
  'float shaderHeterogeneousFogDensity(vec3 point) {',
  '  float lowFrequency = shaderFbm(point * 0.85 + vec3(4.7, 1.3, 8.1));',
  '  float highFrequency = shaderFbm(point * 3.2 + vec3(13.1, 5.7, 2.9));',
  '  float billow = 1.0 - abs(lowFrequency * 2.0 - 1.0);',
  '  return clamp(smoothstep(0.18, 0.86, billow) * 0.78 + highFrequency * 0.22, 0.0, 1.0);',
  '}',
  'float shaderRing(vec3 point, float scale) {',
  '  return abs(sin(shaderFbm(point * (scale * 0.15)) * 6.28318 + shaderFbm(point * 3.0) * 5.0));',
  '}',
  'vec3 shaderHeatPalette(float value) {',
  '  vec3 ember = vec3(0.35, 0.03, 0.01);',
  '  vec3 orange = vec3(1.0, 0.32, 0.04);',
  '  vec3 yellow = vec3(1.0, 0.86, 0.25);',
  '  return mix(mix(ember, orange, smoothstep(0.0, 0.7, value)), yellow, smoothstep(0.55, 1.0, value));',
  '}',
  'vec3 shaderStableTangent(vec3 normal) {',
  '  vec3 axis = abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);',
  '  return normalize(cross(normal, axis));',
  '}',
  'vec3 shaderSafeNormalize(vec3 value, vec3 fallback) {',
  '  float lengthSquared = dot(value, value);',
  '  return lengthSquared > 0.00000001 ? value * inversesqrt(lengthSquared) : fallback;',
  '}',
  'float shaderSaturate(float value) {',
  '  return clamp(value, 0.0, 1.0);',
  '}',
  'vec3 shaderTriplanarWeights(vec3 normal, float blendSharpness) {',
  '  vec3 axisWeights = pow(max(abs(normal), vec3(0.0001)), vec3(max(blendSharpness, 0.0001)));',
  '  return axisWeights / max(axisWeights.x + axisWeights.y + axisWeights.z, 0.0001);',
  '}',
  'vec3 sampleTriplanarAlbedo(sampler2D textureSampler, vec3 point, vec3 normal, float scale, float blendSharpness) {',
  '  vec3 projectedPoint = point * max(scale, 0.0001);',
  '  vec3 axisWeights = shaderTriplanarWeights(normal, blendSharpness);',
  '  vec3 xProjection = texture2D(textureSampler, projectedPoint.yz).rgb;',
  '  vec3 yProjection = texture2D(textureSampler, projectedPoint.xz).rgb;',
  '  vec3 zProjection = texture2D(textureSampler, projectedPoint.xy).rgb;',
  '  return xProjection * axisWeights.x + yProjection * axisWeights.y + zProjection * axisWeights.z;',
  '}',
  'float shaderVoronoiEdge(vec3 point) {',
  '  vec3 baseCell = floor(point);',
  '  vec3 localPoint = fract(point);',
  '  float nearestDistance = 8.0;',
  '  float secondNearestDistance = 8.0;',
  '  for(int cellZ = 0; cellZ < 3; cellZ++) {',
  '    for(int cellY = 0; cellY < 3; cellY++) {',
  '      for(int cellX = 0; cellX < 3; cellX++) {',
  '        vec3 cellOffset = vec3(float(cellX) - 1.0, float(cellY) - 1.0, float(cellZ) - 1.0);',
  '        vec3 neighborCell = baseCell + cellOffset;',
  '        vec3 jitter = vec3(',
  '          shaderNoise(neighborCell + vec3(7.1, 11.3, 17.7)),',
  '          shaderNoise(neighborCell + vec3(23.5, 5.9, 31.1)),',
  '          shaderNoise(neighborCell + vec3(13.7, 29.3, 3.5))',
  '        );',
  '        vec3 delta = cellOffset + jitter - localPoint;',
  '        float distanceSquared = dot(delta, delta);',
  '        if(distanceSquared < nearestDistance) {',
  '          secondNearestDistance = nearestDistance;',
  '          nearestDistance = distanceSquared;',
  '        } else if(distanceSquared < secondNearestDistance) {',
  '          secondNearestDistance = distanceSquared;',
  '        }',
  '      }',
  '    }',
  '  }',
  '  return sqrt(secondNearestDistance) - sqrt(nearestDistance);',
  '}'
].join('');

const ggxPbrSurfaceShaderSource = [
  'float pbrRoughness = clamp(0.12 + shaderFbm(surfaceObjectPoint * 7.0) * 0.52, 0.08, 0.72);',
  'surfaceColor = mix(vec3(0.95, 0.82, 0.58), vec3(0.55, 0.62, 0.70), pbrRoughness * 0.65);',
  'vec3 pbrReflection = normalize(reflect(ray, normal));',
  'vec3 pbrDiffuseRay = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);',
  'ray = normalize(mix(pbrReflection, pbrDiffuseRay, pbrRoughness));',
  specularReflectionSource,
  'float pbrSpecularPower = max(2.0, 48.0 / max(pbrRoughness * pbrRoughness, 0.04));',
  'specularHighlight = pow(max(specularHighlight, 0.0), pbrSpecularPower) * (1.0 - pbrRoughness) * 2.5;'
].join('');

const anisotropicGgxSurfaceShaderSource = [
  'vec3 anisotropicTangent = shaderStableTangent(normal);',
  'vec3 anisotropicBitangent = normalize(cross(normal, anisotropicTangent));',
  'float anisotropicGrain = shaderFbm(surfaceObjectPoint * vec3(12.0, 2.0, 5.0));',
  'float anisotropicAlphaX = mix(0.10, 0.22, anisotropicGrain);',
  'float anisotropicAlphaY = mix(0.42, 0.72, anisotropicGrain);',
  'float anisotropicJitterX = random(vec3(41.7, 13.9, 67.3), sampleSeed + float(bounce) * 19.0) - 0.5;',
  'float anisotropicJitterY = random(vec3(11.1, 73.5, 29.7), sampleSeed + float(bounce) * 23.0) - 0.5;',
  'vec3 anisotropicMicroNormal = normalize(normal + anisotropicTangent * anisotropicJitterX * anisotropicAlphaY + anisotropicBitangent * anisotropicJitterY * anisotropicAlphaX);',
  'surfaceColor = mix(vec3(0.92, 0.74, 0.48), vec3(0.56, 0.64, 0.72), anisotropicGrain * 0.55);',
  'ray = normalize(mix(reflect(ray, anisotropicMicroNormal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal), 0.14));',
  'vec3 anisotropicLightDirection = normalize(light - hit);',
  'vec3 anisotropicViewDirection = normalize(origin - hit);',
  'vec3 anisotropicHalfVector = normalize(anisotropicLightDirection + anisotropicViewDirection);',
  'float anisotropicHDotN = max(dot(anisotropicHalfVector, normal), 0.001);',
  'float anisotropicHDotT = dot(anisotropicHalfVector, anisotropicTangent);',
  'float anisotropicHDotB = dot(anisotropicHalfVector, anisotropicBitangent);',
  'float anisotropicDTerm = anisotropicHDotT * anisotropicHDotT / (anisotropicAlphaX * anisotropicAlphaX) + anisotropicHDotB * anisotropicHDotB / (anisotropicAlphaY * anisotropicAlphaY) + anisotropicHDotN * anisotropicHDotN;',
  'float anisotropicDistribution = 1.0 / max(3.14159265 * anisotropicAlphaX * anisotropicAlphaY * anisotropicDTerm * anisotropicDTerm, 0.001);',
  'specularHighlight = clamp(anisotropicDistribution * 0.08, 0.0, 2.8);',
  'surfaceLightResponse = 0.52;'
].join('');

const spectralGlassSurfaceShaderSource = [
  'surfaceLightResponse = 0.0;',
  'float spectralSample = random(vec3(19.37, 71.91, 43.11), sampleSeed + float(bounce) * 31.0);',
  'surfaceColor = mix(vec3(0.86, 0.96, 1.0), vec3(1.0, 0.78, 0.58), spectralSample);',
  'vec3 normalizedRay = normalize(ray);',
  'float isOutsideSurface = dot(normalizedRay, normal) < 0.0 ? 1.0 : 0.0;',
  'vec3 orientedNormal = isOutsideSurface > 0.5 ? normal : -normal;',
  'float spectralIor = mix(1.44, 1.72, spectralSample);',
  'float etaRatio = isOutsideSurface > 0.5 ? 1.0 / spectralIor : spectralIor;',
  'float cosTheta = min(dot(-normalizedRay, orientedNormal), 1.0);',
  'float oneMinusCosTheta = 1.0 - cosTheta;',
  'float fresnelFactor2 = oneMinusCosTheta * oneMinusCosTheta;',
  'float fresnel = 0.04 + 0.96 * fresnelFactor2 * fresnelFactor2 * oneMinusCosTheta;',
  'vec3 refractedRay = refract(normalizedRay, orientedNormal, etaRatio);',
  'float reflectionSample = random(vec3(89.11, 37.19, 11.43), sampleSeed + float(bounce) * 43.0);',
  'ray = dot(refractedRay, refractedRay) <= 0.0001 || reflectionSample < fresnel ? reflect(normalizedRay, orientedNormal) : refractedRay;',
  'colorMask *= surfaceColor;',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const subsurfaceSurfaceShaderSource = [
  'float subsurfaceNoise = shaderFbm(surfaceObjectPoint * 5.0);',
  'surfaceColor = mix(vec3(1.0, 0.48, 0.32), vec3(1.0, 0.82, 0.58), subsurfaceNoise);',
  'surfaceLightResponse = 1.25;',
  'accumulatedColor += colorMask * surfaceColor * 0.055;',
  'vec3 softenedNormal = normalize(normal + uniformlyRandomVector(sampleSeed + float(bounce) * 23.0) * 0.28);',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, softenedNormal);'
].join('');

const causticsSurfaceShaderSource = [
  'surfaceColor = vec3(0.82, 1.0, 0.92);',
  'surfaceLightResponse = 0.0;',
  'vec3 normalizedRay = normalize(ray);',
  'float isOutsideSurface = dot(normalizedRay, normal) < 0.0 ? 1.0 : 0.0;',
  'vec3 orientedNormal = isOutsideSurface > 0.5 ? normal : -normal;',
  'vec3 refractedRay = refract(normalizedRay, orientedNormal, isOutsideSurface > 0.5 ? 0.625 : 1.6);',
  'float rimBase = 1.0 - max(dot(-normalizedRay, orientedNormal), 0.0);',
  'float rimLight = rimBase * rimBase * rimBase;',
  'accumulatedColor += colorMask * lightColor * vec3(0.25, 0.95, 0.65) * rimLight * lightIntensity;',
  'ray = dot(refractedRay, refractedRay) <= 0.0001 ? reflect(normalizedRay, orientedNormal) : refractedRay;',
  'colorMask *= surfaceColor;',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const proceduralSurfaceShaderSource = [
  'float checker = mod(floor(surfaceObjectPoint.x * 8.0) + floor(surfaceObjectPoint.y * 8.0) + floor(surfaceObjectPoint.z * 8.0), 2.0);',
  'float marble = shaderRing(surfaceObjectPoint, 18.0);',
  'float grain = shaderFbm(surfaceObjectPoint * 10.0);',
  'vec3 checkerColor = mix(vec3(0.08, 0.10, 0.12), vec3(0.85, 0.78, 0.64), checker);',
  'vec3 marbleColor = mix(vec3(0.24, 0.28, 0.34), vec3(0.92, 0.88, 0.78), marble);',
  'surfaceColor = mix(checkerColor, marbleColor, grain);',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);'
].join('');

const sdfFractalSurfaceShaderSource = [
  'vec3 fractalPoint = surfaceObjectPoint * 2.8;',
  'float fractalValue = 0.0;',
  'for(int fractalStep = 0; fractalStep < 4; fractalStep++) {',
  '  fractalPoint = abs(fractalPoint) / max(dot(fractalPoint, fractalPoint), 0.18) - vec3(0.72);',
  '  fractalValue += exp(-abs(length(fractalPoint) - 1.0));',
  '}',
  'fractalValue = clamp(fractalValue * 0.18, 0.0, 1.0);',
  'surfaceColor = mix(vec3(0.06, 0.09, 0.14), vec3(0.35, 0.85, 1.0), fractalValue);',
  'specularHighlight += fractalValue * fractalValue * 1.7;',
  'ray = normalize(mix(reflect(ray, normal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal), 0.42));'
].join('');

const volumetricShaftsSurfaceShaderSource = [
  'vec3 toLightDirection = normalize(light - hit);',
  'float shaftBase = max(dot(toLightDirection, -normalize(ray)), 0.0);',
  'float shaftPower2 = shaftBase * shaftBase;',
  'float shaftPower4 = shaftPower2 * shaftPower2;',
  'float shaftAmount = shaftPower4 * shaftPower4;',
  'float densityNoise = shaderFbm(surfaceObjectPoint * 6.0 + vec3(0.0, sampleSeed * 0.01, 0.0));',
  'surfaceColor = mix(vec3(0.20, 0.34, 0.55), vec3(0.60, 0.78, 1.0), densityNoise);',
  'accumulatedColor += colorMask * lightColor * surfaceColor * shaftAmount * lightIntensity * 1.8;',
  'surfaceLightResponse = 0.9;',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);'
].join('');

const heterogeneousFogSurfaceShaderSource = [
  'float fogVolumeDensity = shaderHeterogeneousFogDensity(surfaceObjectPoint + vec3(0.0, sampleSeed * 0.012, 0.0));',
  'vec3 fogLightDirection = normalize(light - hit);',
  'float fogForwardScatter = pow(max(dot(fogLightDirection, -normalize(ray)), 0.0), 5.0);',
  'surfaceColor = mix(vec3(0.24, 0.34, 0.46), vec3(0.76, 0.86, 1.0), fogVolumeDensity);',
  'accumulatedColor += colorMask * lightColor * surfaceColor * fogVolumeDensity * (0.12 + fogForwardScatter * 1.85) * lightIntensity;',
  'colorMask *= mix(vec3(1.0), surfaceColor, fogVolumeDensity * 0.20);',
  'colorMask *= exp(-fogVolumeDensity * 0.18);',
  'ray = normalize(mix(ray, cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal), fogVolumeDensity * 0.28));',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const bokehSurfaceShaderSource = [
  'float bokehRing = smoothstep(0.42, 0.55, shaderRing(surfaceObjectPoint, 30.0));',
  'surfaceColor = mix(vec3(0.12, 0.12, 0.16), vec3(0.92, 0.82, 1.0), bokehRing);',
  'ray = normalize(mix(reflect(ray, normal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal), 0.22));',
  specularReflectionSource,
  'float bokehSpecular = max(specularHighlight, 0.0);',
  'float bokehSpecular2 = bokehSpecular * bokehSpecular;',
  'float bokehSpecular4 = bokehSpecular2 * bokehSpecular2;',
  'float bokehSpecular8 = bokehSpecular4 * bokehSpecular4;',
  'specularHighlight = bokehSpecular8 * bokehSpecular2 * (1.0 + bokehRing * 3.0);'
].join('');

const motionBlurStressSurfaceShaderSource = [
  'float band = sin(surfaceObjectPoint.x * 24.0 + surfaceObjectPoint.y * 11.0 + sampleSeed * 0.025);',
  'vec3 tangentDirection = shaderStableTangent(normal);',
  'surfaceColor = mix(vec3(0.05, 0.08, 0.10), vec3(0.95, 0.28, 0.18), band * 0.5 + 0.5);',
  'ray = normalize(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal) + tangentDirection * band * 0.42);',
  'surfaceLightResponse = 1.15;'
].join('');

const firePlasmaSurfaceShaderSource = [
  'float flame = shaderFbm(surfaceObjectPoint * 8.0 + vec3(0.0, sampleSeed * 0.02, 0.0));',
  'surfaceColor = shaderHeatPalette(flame);',
  'accumulatedColor += colorMask * surfaceColor * (0.55 + flame * 2.25);',
  'surfaceLightResponse = 0.45;',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);'
].join('');

const blackbodySurfaceShaderSource = [
  `const float blackbodyMinKelvin = ${formatShaderFloat(MIN_BLACKBODY_TEMPERATURE_KELVIN)};`,
  `const float blackbodyDefaultKelvin = ${formatShaderFloat(DEFAULT_BLACKBODY_TEMPERATURE_KELVIN)};`,
  `const float blackbodyMaxKelvin = ${formatShaderFloat(MAX_BLACKBODY_TEMPERATURE_KELVIN)};`,
  `const float blackbodyEmissionStrength = ${formatShaderFloat(BLACKBODY_EMISSION_STRENGTH)};`,
  'float blackbodyHeat = clamp(0.35 + surfaceObjectPoint.y * 0.42 + shaderFbm(surfaceObjectPoint * 5.0) * 0.38, 0.0, 1.0);',
  'float blackbodyKelvin = mix(blackbodyMinKelvin, blackbodyMaxKelvin, blackbodyHeat);',
  'vec3 blackbodyWarm = shaderHeatPalette(blackbodyHeat);',
  'surfaceColor = mix(blackbodyWarm, vec3(1.0, 0.93, 0.78), smoothstep(blackbodyDefaultKelvin * 0.85, blackbodyMaxKelvin, blackbodyKelvin));',
  'accumulatedColor += colorMask * surfaceColor * blackbodyEmissionStrength * pow(max(blackbodyKelvin / blackbodyDefaultKelvin, 0.1), 1.15);',
  'surfaceLightResponse = 0.25;',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);'
].join('');

const thinFilmSurfaceShaderSource = [
  'vec3 thinFilmViewDirection = normalize(-ray);',
  'float thinFilmGrazing = 1.0 - max(dot(thinFilmViewDirection, normal), 0.0);',
  'float thinFilmPhase = thinFilmGrazing * 8.0 + sin(dot(hit, vec3(19.0, 7.0, 13.0))) * 0.35;',
  'vec3 thinFilmRainbow = 0.5 + 0.5 * cos(vec3(0.0, 2.09439, 4.18879) + thinFilmPhase * 6.28318);',
  'surfaceColor = mix(vec3(0.055, 0.060, 0.070), thinFilmRainbow, 0.86);',
  'ray = normalize(mix(reflect(ray, normal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal), 0.18));',
  specularReflectionSource,
  'specularHighlight = pow(max(specularHighlight, 0.0), 24.0) * (1.0 + thinFilmGrazing * 2.2);',
  'surfaceLightResponse = 0.75 + thinFilmGrazing * 0.65;'
].join('');

const retroreflectorSurfaceShaderSource = [
  'vec3 retroReturnRay = -normalize(ray);',
  'vec3 retroLightDirection = normalize(light - hit);',
  'float retroAim = max(dot(retroReturnRay, retroLightDirection), 0.0);',
  'float retroSparkle = pow(retroAim, 8.0);',
  'surfaceColor = mix(vec3(0.10, 0.08, 0.045), vec3(1.0, 0.88, 0.42), 0.35 + retroSparkle * 0.65);',
  'accumulatedColor += colorMask * lightColor * vec3(1.0, 0.82, 0.38) * retroSparkle * lightIntensity * 1.4;',
  'ray = normalize(retroReturnRay + normal * 0.025 + uniformlyRandomVector(sampleSeed + float(bounce) * 19.0) * 0.012);',
  'surfaceLightResponse = 0.25;',
  'specularHighlight = retroSparkle * 2.5;'
].join('');

const velvetSurfaceShaderSource = [
  'vec3 velvetViewDirection = normalize(-ray);',
  'float velvetGrazing = 1.0 - abs(dot(velvetViewDirection, normal));',
  'float velvetSheen = velvetGrazing * velvetGrazing;',
  'surfaceColor = mix(vec3(0.18, 0.025, 0.075), vec3(0.82, 0.18, 0.36), velvetSheen);',
  'accumulatedColor += colorMask * vec3(0.90, 0.18, 0.34) * velvetSheen * 0.16;',
  'surfaceLightResponse = 0.52 + velvetSheen * 1.8;',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);'
].join('');

const voronoiCracksSurfaceShaderSource = [
  'float crackDistance = shaderVoronoiEdge(surfaceObjectPoint * 7.0);',
  'float crackLine = 1.0 - smoothstep(0.025, 0.095, crackDistance);',
  'float cellDust = shaderFbm(surfaceObjectPoint * 11.0);',
  'vec3 dryMud = mix(vec3(0.22, 0.13, 0.070), vec3(0.68, 0.50, 0.31), cellDust);',
  'surfaceColor = mix(dryMud, vec3(0.018, 0.014, 0.011), crackLine);',
  'vec3 crackTangent = shaderStableTangent(normal);',
  'vec3 crackedNormal = normalize(normal + crackTangent * (crackLine - 0.35) * 0.20);',
  'surfaceLightResponse = mix(1.05, 0.32, crackLine);',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, crackedNormal);'
].join('');

const barkCorkSurfaceShaderSource = [
  'float barkVerticalFiber = sin(surfaceObjectPoint.y * 34.0 + shaderFbm(surfaceObjectPoint * vec3(4.0, 10.0, 4.0)) * 8.0);',
  'float barkRadialFiber = sin(atan(surfaceObjectPoint.z, surfaceObjectPoint.x) * 18.0 + surfaceObjectPoint.y * 3.0);',
  'float barkGroove = smoothstep(0.35, 0.92, abs(barkVerticalFiber * 0.68 + barkRadialFiber * 0.32));',
  'float barkPores = shaderFbm(surfaceObjectPoint * 28.0 + normal * 2.0);',
  'float barkCellEdge = shaderVoronoiEdge(surfaceObjectPoint * vec3(5.0, 12.0, 5.0));',
  'float barkRaisedRidge = smoothstep(0.06, 0.22, barkCellEdge) * (1.0 - barkGroove);',
  'vec3 corkBase = mix(vec3(0.36, 0.22, 0.12), vec3(0.70, 0.52, 0.32), barkPores);',
  'vec3 barkDarkGroove = vec3(0.055, 0.036, 0.022);',
  'surfaceColor = mix(corkBase, barkDarkGroove, barkGroove * 0.82);',
  'surfaceColor = mix(surfaceColor, vec3(0.86, 0.68, 0.42), barkRaisedRidge * 0.28);',
  'vec3 barkTangent = shaderStableTangent(normal);',
  'vec3 barkNormal = normalize(normal + barkTangent * (barkRaisedRidge - barkGroove) * 0.28 + uniformlyRandomVector(sampleSeed + float(bounce) * 31.0) * 0.035);',
  'vec3 barkDiffuseRay = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, barkNormal);',
  'ray = normalize(mix(barkDiffuseRay, reflect(ray, barkNormal), 0.08 + (1.0 - barkGroove) * 0.06));',
  'vec3 barkReflectedLight = normalize(reflect(light - hit, barkNormal));',
  'float barkSpecularBase = max(0.0, dot(barkReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(barkSpecularBase, 5.0) * (0.08 + barkRaisedRidge * 0.20 + barkPores * 0.08);',
  'surfaceLightResponse = 0.74 + barkRaisedRidge * 0.35 - barkGroove * 0.30;'
].join('');

const rubberSurfaceShaderSource = [
  'float rubberPores = shaderFbm(surfaceObjectPoint * 34.0 + normal * 3.0);',
  'float rubberCellEdge = shaderVoronoiEdge(surfaceObjectPoint * 17.0);',
  'float rubberPitted = 1.0 - smoothstep(0.018, 0.085, rubberCellEdge);',
  'surfaceColor = mix(vec3(0.012, 0.012, 0.011), vec3(0.075, 0.070, 0.060), rubberPores);',
  'surfaceColor *= 0.70 + rubberPitted * 0.12;',
  'vec3 rubberTangent = shaderStableTangent(normal);',
  'vec3 rubberNormal = normalize(normal + rubberTangent * (rubberPores - 0.5) * 0.12 + uniformlyRandomVector(sampleSeed + float(bounce) * 29.0) * 0.035);',
  'vec3 rubberDiffuseRay = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, rubberNormal);',
  'ray = normalize(mix(reflect(ray, rubberNormal), rubberDiffuseRay, 0.88));',
  'vec3 rubberReflectedLight = normalize(reflect(light - hit, rubberNormal));',
  'float rubberSpecularBase = max(0.0, dot(rubberReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(rubberSpecularBase, 4.0) * (0.035 + rubberPores * 0.055);',
  'surfaceLightResponse = 0.48 + rubberPores * 0.14;'
].join('');

const mattePlasticSurfaceShaderSource = [
  'float plasticMottle = shaderFbm(surfaceObjectPoint * 16.0);',
  'float plasticSpeckle = shaderFbm(surfaceObjectPoint * 58.0 + normal * 4.0);',
  'float plasticOrangePeel = shaderFbm(surfaceObjectPoint * 28.0 + vec3(2.7, 5.1, 8.3));',
  'surfaceColor = mix(vec3(0.10, 0.13, 0.16), vec3(0.56, 0.64, 0.70), plasticMottle * 0.42 + plasticSpeckle * 0.18);',
  'surfaceColor = mix(surfaceColor, vec3(0.78, 0.80, 0.76), plasticOrangePeel * 0.10);',
  'vec3 plasticTangent = shaderStableTangent(normal);',
  'vec3 plasticNormal = normalize(normal + plasticTangent * (plasticOrangePeel - 0.5) * 0.055 + uniformlyRandomVector(sampleSeed + float(bounce) * 31.0) * 0.018);',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, plasticNormal);',
  'vec3 plasticReflectedLight = normalize(reflect(light - hit, plasticNormal));',
  'float plasticSpecularBase = max(0.0, dot(plasticReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(plasticSpecularBase, 7.0) * (0.12 + plasticSpeckle * 0.08);',
  'surfaceLightResponse = 0.78 + plasticMottle * 0.16;'
].join('');

const woodGrainSurfaceShaderSource = [
  'vec3 woodPoint = surfaceObjectPoint * vec3(3.2, 8.5, 3.2);',
  'float woodWarp = shaderFbm(woodPoint * 0.55) * 6.0 + shaderFbm(woodPoint * 1.8) * 1.5;',
  'float woodRingWave = 0.5 + 0.5 * sin(length(woodPoint.xz) * 18.0 + woodPoint.y * 0.85 + woodWarp);',
  'float woodLatewood = smoothstep(0.58, 0.82, woodRingWave);',
  'float woodFiber = shaderFbm(surfaceObjectPoint * vec3(26.0, 5.0, 26.0) + vec3(1.7, 8.1, 2.3));',
  'vec3 earlyWood = vec3(0.58, 0.34, 0.14);',
  'vec3 lateWood = vec3(0.25, 0.12, 0.045);',
  'surfaceColor = mix(earlyWood, lateWood, woodLatewood);',
  'surfaceColor = mix(surfaceColor, vec3(0.82, 0.56, 0.29), woodFiber * 0.18);',
  'vec3 woodTangent = shaderStableTangent(normal);',
  'vec3 woodNormal = normalize(normal + woodTangent * (woodFiber - 0.5) * 0.16);',
  'vec3 woodDiffuseRay = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, woodNormal);',
  'ray = normalize(mix(woodDiffuseRay, reflect(ray, woodNormal), 0.10 + woodFiber * 0.08));',
  'vec3 woodLightDirection = normalize(light - hit);',
  'vec3 woodViewDirection = normalize(origin - hit);',
  'vec3 woodHalfVector = normalize(woodLightDirection + woodViewDirection);',
  'float woodAnisotropicGrain = abs(dot(woodHalfVector, woodTangent));',
  'float woodSpecularBase = max(0.0, dot(woodHalfVector, woodNormal));',
  'specularHighlight = pow(woodSpecularBase, 7.0) * (0.10 + woodAnisotropicGrain * 0.18 + (1.0 - woodLatewood) * 0.10);',
  'surfaceLightResponse = 0.82 + woodFiber * 0.18;'
].join('');

const marbleSurfaceShaderSource = [
  'float marbleBodyNoise = shaderFbm(surfaceObjectPoint * 2.2);',
  'float marbleWarp = shaderFbm(surfaceObjectPoint * 4.0 + vec3(3.1, 7.2, 1.4)) * 5.5;',
  'float marbleVeinWave = abs(sin(surfaceObjectPoint.x * 7.0 + surfaceObjectPoint.y * 3.2 + surfaceObjectPoint.z * 4.4 + marbleWarp));',
  'float marbleVein = 1.0 - smoothstep(0.035, 0.22, marbleVeinWave);',
  'float marbleGoldVein = smoothstep(0.90, 0.985, shaderFbm(surfaceObjectPoint * 11.0 + vec3(8.0, 1.0, 5.0))) * marbleVein;',
  'float marbleHonedBlend = smoothstep(0.35, 0.74, shaderFbm(surfaceObjectPoint * 3.6 + vec3(2.0, 9.0, 4.0)));',
  'surfaceColor = mix(vec3(0.84, 0.82, 0.76), vec3(0.98, 0.965, 0.90), marbleBodyNoise);',
  'surfaceColor = mix(surfaceColor, vec3(0.16, 0.18, 0.20), marbleVein * 0.76);',
  'surfaceColor = mix(surfaceColor, vec3(0.78, 0.55, 0.22), marbleGoldVein * 0.60);',
  'accumulatedColor += colorMask * surfaceColor * (0.014 + marbleBodyNoise * 0.018) * (1.0 - marbleVein * 0.45);',
  'float marbleRoughness = mix(0.18, 0.54, marbleHonedBlend);',
  'vec3 marbleDiffuseRay = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);',
  'ray = normalize(mix(reflect(ray, normal), marbleDiffuseRay, marbleRoughness));',
  'vec3 marbleReflectedLight = normalize(reflect(light - hit, normal));',
  'float marbleSpecularBase = max(0.0, dot(marbleReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(marbleSpecularBase, mix(34.0, 12.0, marbleHonedBlend)) * (0.42 + (1.0 - marbleHonedBlend) * 0.72);',
  'surfaceLightResponse = 0.92 + marbleBodyNoise * 0.18 - marbleVein * 0.22;'
].join('');

const ceramicGlazeSurfaceShaderSource = [
  'float glazePool = shaderFbm(surfaceObjectPoint * 6.5 + normal * 1.8);',
  'float glazeCellEdge = shaderVoronoiEdge(surfaceObjectPoint * 9.0);',
  'float glazeCrackle = 1.0 - smoothstep(0.020, 0.070, glazeCellEdge);',
  'vec3 porcelainBody = mix(vec3(0.74, 0.67, 0.58), vec3(0.92, 0.90, 0.84), glazePool);',
  'vec3 ceramicGlazeColor = mix(vec3(0.86, 0.92, 0.92), vec3(0.17, 0.46, 0.58), glazePool);',
  'surfaceColor = mix(porcelainBody, ceramicGlazeColor, 0.72 + glazePool * 0.22);',
  'surfaceColor = mix(surfaceColor, vec3(0.17, 0.10, 0.065), glazeCrackle * 0.62);',
  'surfaceColor = mix(surfaceColor, vec3(0.96, 0.98, 0.95), smoothstep(0.74, 1.0, glazePool) * 0.18);',
  'vec3 glazeViewDirection = normalize(origin - hit);',
  'float glazeEdgeDarkening = pow(1.0 - max(dot(glazeViewDirection, normal), 0.0), 2.0);',
  'surfaceColor = mix(surfaceColor, vec3(0.020, 0.030, 0.035), glazeEdgeDarkening * 0.16);',
  'vec3 glazeTangent = shaderStableTangent(normal);',
  'vec3 glazeNormal = normalize(normal + glazeTangent * (glazePool - 0.5) * 0.13);',
  'vec3 glazeDiffuseRay = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, glazeNormal);',
  'ray = normalize(mix(reflect(ray, glazeNormal), glazeDiffuseRay, 0.18 + glazeCrackle * 0.24));',
  'vec3 glazeReflectedLight = normalize(reflect(light - hit, glazeNormal));',
  'float glazeSpecularBase = max(0.0, dot(glazeReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(glazeSpecularBase, 22.0) * (1.15 + glazePool * 0.75) + glazeCrackle * 0.08;',
  'surfaceLightResponse = 0.72 + glazePool * 0.20 - glazeCrackle * 0.15;'
].join('');

const clearCoatAutomotiveSurfaceShaderSource = [
  'float clearCoatBaseNoise = shaderFbm(surfaceObjectPoint * 4.0);',
  'float clearCoatOrangePeel = shaderFbm(surfaceObjectPoint * 22.0 + vec3(4.2, 1.1, 7.8));',
  'float clearCoatFlake = step(0.82, shaderNoise(surfaceObjectPoint * 90.0 + normal * 11.0));',
  'float clearCoatFlakeMask = clearCoatFlake * (0.35 + shaderFbm(surfaceObjectPoint * 13.0) * 0.65);',
  'vec3 clearCoatDeepRed = vec3(0.16, 0.012, 0.016);',
  'vec3 clearCoatCandyRed = vec3(0.72, 0.025, 0.030);',
  'surfaceColor = mix(clearCoatDeepRed, clearCoatCandyRed, clearCoatBaseNoise);',
  'surfaceColor += clearCoatFlakeMask * vec3(0.42, 0.34, 0.24);',
  'vec3 clearCoatTangent = shaderStableTangent(normal);',
  'vec3 clearCoatNormal = normalize(normal + clearCoatTangent * (clearCoatOrangePeel - 0.5) * 0.040);',
  'vec3 clearCoatDiffuseRay = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, clearCoatNormal);',
  'ray = normalize(mix(reflect(ray, clearCoatNormal), clearCoatDiffuseRay, 0.10));',
  'vec3 clearCoatReflectedLight = normalize(reflect(light - hit, clearCoatNormal));',
  'float clearCoatSpecularBase = max(0.0, dot(clearCoatReflectedLight, normalize(hit - origin)));',
  'float clearCoatBroadSpecular = pow(clearCoatSpecularBase, 14.0) * (0.25 + clearCoatBaseNoise * 0.20);',
  'float clearCoatSharpSpecular = pow(clearCoatSpecularBase, 54.0) * (1.45 + clearCoatFlakeMask * 1.20);',
  'specularHighlight = clearCoatBroadSpecular + clearCoatSharpSpecular;',
  'surfaceLightResponse = 0.58 + clearCoatBaseNoise * 0.18;'
].join('');

const skinWaxSurfaceShaderSource = [
  'float skinMottle = shaderFbm(surfaceObjectPoint * 8.0 + normal * 1.7);',
  'float skinPore = shaderFbm(surfaceObjectPoint * 46.0 + vec3(2.1, 5.3, 8.7));',
  'vec3 skinBase = mix(vec3(0.86, 0.46, 0.34), vec3(1.0, 0.74, 0.52), skinMottle);',
  'vec3 waxBloom = mix(vec3(1.0, 0.70, 0.42), vec3(1.0, 0.92, 0.76), skinPore);',
  'surfaceColor = mix(skinBase, waxBloom, 0.22);',
  'vec3 skinViewDirection = normalize(origin - hit);',
  'float skinBackScatter = pow(max(dot(-normalize(ray), normal), 0.0), 2.0);',
  'float skinRim = pow(1.0 - max(dot(skinViewDirection, normal), 0.0), 2.4);',
  'accumulatedColor += colorMask * vec3(1.0, 0.42, 0.25) * (0.035 + skinBackScatter * 0.085 + skinRim * 0.055);',
  'vec3 skinTangent = shaderStableTangent(normal);',
  'vec3 skinNormal = normalize(normal + skinTangent * (skinPore - 0.5) * 0.052);',
  'ray = normalize(mix(reflect(ray, skinNormal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, skinNormal), 0.72));',
  'vec3 skinReflectedLight = normalize(reflect(light - hit, skinNormal));',
  'float skinSpecularBase = max(0.0, dot(skinReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(skinSpecularBase, 11.0) * (0.18 + skinPore * 0.16);',
  'surfaceLightResponse = 0.88 + skinMottle * 0.20;'
].join('');

const leatherSurfaceShaderSource = [
  'float leatherGrain = shaderFbm(surfaceObjectPoint * 34.0 + normal * 2.4);',
  'float leatherCrease = 1.0 - smoothstep(0.025, 0.105, shaderVoronoiEdge(surfaceObjectPoint * vec3(11.0, 17.0, 9.0)));',
  'float leatherWear = smoothstep(0.55, 0.92, shaderFbm(surfaceObjectPoint * 5.5 + vec3(5.0, 1.0, 9.0)));',
  'surfaceColor = mix(vec3(0.12, 0.055, 0.026), vec3(0.44, 0.21, 0.095), leatherGrain);',
  'surfaceColor = mix(surfaceColor, vec3(0.035, 0.018, 0.010), leatherCrease * 0.62);',
  'surfaceColor = mix(surfaceColor, vec3(0.72, 0.45, 0.24), leatherWear * 0.22);',
  'vec3 leatherTangent = shaderStableTangent(normal);',
  'vec3 leatherNormal = normalize(normal + leatherTangent * (leatherGrain - leatherCrease) * 0.18);',
  'ray = normalize(mix(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, leatherNormal), reflect(ray, leatherNormal), 0.16 + leatherWear * 0.10));',
  'vec3 leatherReflectedLight = normalize(reflect(light - hit, leatherNormal));',
  'float leatherSpecularBase = max(0.0, dot(leatherReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(leatherSpecularBase, 8.0) * (0.16 + leatherWear * 0.34);',
  'surfaceLightResponse = 0.66 + leatherWear * 0.20 - leatherCrease * 0.20;'
].join('');

const sandSurfaceShaderSource = [
  'float sandGranule = shaderFbm(surfaceObjectPoint * 72.0 + normal * 5.0);',
  'float sandDamp = smoothstep(0.62, 0.88, shaderFbm(surfaceObjectPoint * 3.0 + vec3(4.0, 8.0, 2.0)));',
  'float sandSpark = step(0.91, shaderNoise(surfaceObjectPoint * 130.0 + normal * 19.0));',
  'surfaceColor = mix(vec3(0.62, 0.49, 0.30), vec3(0.92, 0.78, 0.50), sandGranule);',
  'surfaceColor = mix(surfaceColor, vec3(0.30, 0.25, 0.18), sandDamp * 0.52);',
  'vec3 sandTangent = shaderStableTangent(normal);',
  'vec3 sandNormal = normalize(normal + sandTangent * (sandGranule - 0.5) * 0.24 + uniformlyRandomVector(sampleSeed + float(bounce) * 37.0) * 0.035);',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, sandNormal);',
  'vec3 sandReflectedLight = normalize(reflect(light - hit, sandNormal));',
  'float sandSpecularBase = max(0.0, dot(sandReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(sandSpecularBase, 16.0) * (sandSpark * 0.55 + sandDamp * 0.12);',
  'surfaceLightResponse = 0.82 + sandGranule * 0.16 - sandDamp * 0.20;'
].join('');

const snowSurfaceShaderSource = [
  'float snowPowder = shaderFbm(surfaceObjectPoint * 24.0 + normal * 4.0);',
  'float snowIcy = smoothstep(0.70, 0.96, shaderFbm(surfaceObjectPoint * 7.0 + vec3(8.0, 3.0, 5.0)));',
  'float snowCrystal = step(0.935, shaderNoise(surfaceObjectPoint * 155.0 + normal * 31.0));',
  'surfaceColor = mix(vec3(0.82, 0.90, 0.96), vec3(1.0, 1.0, 0.98), snowPowder);',
  'surfaceColor = mix(surfaceColor, vec3(0.70, 0.88, 1.0), snowIcy * 0.24);',
  'accumulatedColor += colorMask * vec3(0.58, 0.78, 1.0) * (0.025 + snowPowder * 0.022);',
  'vec3 snowTangent = shaderStableTangent(normal);',
  'vec3 snowNormal = normalize(normal + snowTangent * (snowPowder - 0.5) * 0.12);',
  'ray = normalize(mix(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, snowNormal), reflect(ray, snowNormal), 0.06 + snowIcy * 0.18));',
  'vec3 snowReflectedLight = normalize(reflect(light - hit, snowNormal));',
  'float snowSpecularBase = max(0.0, dot(snowReflectedLight, normalize(hit - origin)));',
  'specularHighlight = pow(snowSpecularBase, 28.0) * (snowCrystal * 0.85 + snowIcy * 0.36);',
  'surfaceLightResponse = 1.10 + snowPowder * 0.24;'
].join('');

const amberHoneySurfaceShaderSource = [
  'float resinFleck = step(0.88, shaderNoise(surfaceObjectPoint * 64.0 + vec3(7.0, 1.0, 4.0)));',
  'float resinSwirl = shaderFbm(surfaceObjectPoint * 5.0 + normal * 1.2);',
  'surfaceColor = mix(vec3(0.95, 0.42, 0.055), vec3(1.0, 0.76, 0.22), resinSwirl);',
  'surfaceColor = mix(surfaceColor, vec3(0.24, 0.12, 0.035), resinFleck * 0.38);',
  'accumulatedColor += colorMask * vec3(1.0, 0.48, 0.10) * (0.035 + resinSwirl * 0.050);',
  'float resinFresnel = pow(1.0 - max(dot(-normalize(ray), normal), 0.0), 5.0);',
  'vec3 resinNormal = normalize(normal + shaderStableTangent(normal) * (resinSwirl - 0.5) * 0.045);',
  'vec3 resinRefracted = refract(normalize(ray), resinNormal, 0.67);',
  'ray = dot(resinRefracted, resinRefracted) <= 0.0001 || resinFresnel > 0.42 ? reflect(normalize(ray), resinNormal) : resinRefracted;',
  'specularHighlight = resinFresnel * 1.35 + resinFleck * 0.12;',
  'surfaceLightResponse = 0.18;',
  'colorMask *= mix(vec3(1.0), surfaceColor, 0.62);',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const soapFoamSurfaceShaderSource = [
  'float foamCell = shaderVoronoiEdge(surfaceObjectPoint * 18.0);',
  'float foamBubble = 1.0 - smoothstep(0.020, 0.145, foamCell);',
  'float foamFilm = shaderFbm(surfaceObjectPoint * 9.0 + normal * 3.0);',
  'float foamGrazing = pow(1.0 - max(dot(-normalize(ray), normal), 0.0), 2.0);',
  'vec3 foamIridescence = 0.5 + 0.5 * cos(vec3(0.0, 2.09439, 4.18879) + (foamFilm * 6.0 + foamGrazing * 4.0));',
  'surfaceColor = mix(vec3(0.88, 0.94, 0.92), foamIridescence, foamGrazing * 0.42);',
  'surfaceColor = mix(surfaceColor, vec3(1.0), foamBubble * 0.48);',
  'accumulatedColor += colorMask * foamIridescence * foamGrazing * 0.040;',
  'vec3 foamNormal = normalize(normal + shaderStableTangent(normal) * (foamBubble - 0.35) * 0.18);',
  'ray = normalize(mix(reflect(ray, foamNormal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, foamNormal), 0.48));',
  'specularHighlight = pow(max(dot(reflect(light - hit, foamNormal), normalize(hit - origin)), 0.0), 18.0) * (0.30 + foamGrazing * 0.72);',
  'surfaceLightResponse = 0.86 + foamBubble * 0.30;'
].join('');

const wovenFabricSurfaceShaderSource = [
  'vec3 fabricTangent = shaderStableTangent(normal);',
  'vec3 fabricBitangent = normalize(cross(normal, fabricTangent));',
  'float fabricWarp = abs(sin(dot(surfaceObjectPoint, fabricTangent) * 58.0));',
  'float fabricWeft = abs(sin(dot(surfaceObjectPoint, fabricBitangent) * 52.0));',
  'float fabricThread = smoothstep(0.18, 0.92, max(fabricWarp, fabricWeft));',
  'float fabricDye = shaderFbm(surfaceObjectPoint * 18.0);',
  'surfaceColor = mix(vec3(0.055, 0.10, 0.22), vec3(0.18, 0.34, 0.62), fabricDye);',
  'surfaceColor = mix(surfaceColor, vec3(0.78, 0.70, 0.55), fabricThread * 0.18);',
  'vec3 fabricNormal = normalize(normal + fabricTangent * (fabricWarp - 0.5) * 0.16 + fabricBitangent * (fabricWeft - 0.5) * 0.14);',
  'ray = normalize(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, fabricNormal) + fabricTangent * (fabricWarp - fabricWeft) * 0.18);',
  'float fabricSheen = pow(1.0 - max(dot(normalize(origin - hit), fabricNormal), 0.0), 2.2);',
  'specularHighlight = fabricSheen * (0.16 + fabricThread * 0.18);',
  'surfaceLightResponse = 0.72 + fabricThread * 0.22;'
].join('');

const waterLiquidSurfaceShaderSource = [
  'float waterRippleA = sin(surfaceObjectPoint.x * 22.0 + surfaceObjectPoint.z * 9.0 + sampleSeed * 0.010);',
  'float waterRippleB = sin(surfaceObjectPoint.z * 19.0 - surfaceObjectPoint.x * 7.0 + sampleSeed * 0.013);',
  'float waterRipple = (waterRippleA + waterRippleB) * 0.5;',
  'vec3 waterTangent = shaderStableTangent(normal);',
  'vec3 waterNormal = normalize(normal + waterTangent * waterRipple * 0.045);',
  'surfaceColor = mix(vec3(0.58, 0.86, 0.95), vec3(0.08, 0.36, 0.50), clamp(surfaceObjectPoint.y * 0.35 + 0.45, 0.0, 1.0));',
  'float waterFresnel = pow(1.0 - max(dot(-normalize(ray), waterNormal), 0.0), 5.0);',
  'vec3 waterRefracted = refract(normalize(ray), waterNormal, 0.75);',
  'ray = dot(waterRefracted, waterRefracted) <= 0.0001 || waterFresnel > 0.22 ? reflect(normalize(ray), waterNormal) : waterRefracted;',
  'specularHighlight = waterFresnel * 2.4;',
  'surfaceLightResponse = 0.05;',
  'colorMask *= mix(vec3(1.0), surfaceColor, 0.32);',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const iceFrostedGlassSurfaceShaderSource = [
  'float iceCloud = shaderFbm(surfaceObjectPoint * 10.0 + normal * 2.5);',
  'float iceBubble = 1.0 - smoothstep(0.018, 0.075, shaderVoronoiEdge(surfaceObjectPoint * 14.0));',
  'surfaceColor = mix(vec3(0.72, 0.90, 1.0), vec3(0.96, 1.0, 1.0), iceCloud);',
  'surfaceColor = mix(surfaceColor, vec3(0.52, 0.72, 0.88), iceBubble * 0.28);',
  'vec3 iceNormal = normalize(normal + shaderStableTangent(normal) * (iceCloud - 0.5) * 0.22 + uniformlyRandomVector(sampleSeed + float(bounce) * 41.0) * 0.035);',
  'float iceFresnel = pow(1.0 - max(dot(-normalize(ray), iceNormal), 0.0), 5.0);',
  'vec3 iceRefracted = refract(normalize(ray), iceNormal, 0.66);',
  'ray = dot(iceRefracted, iceRefracted) <= 0.0001 || iceFresnel > 0.30 ? reflect(normalize(ray), iceNormal) : iceRefracted;',
  'accumulatedColor += colorMask * vec3(0.45, 0.72, 1.0) * iceCloud * 0.026;',
  'specularHighlight = iceFresnel * 1.7 + iceBubble * 0.08;',
  'surfaceLightResponse = 0.10;',
  'colorMask *= mix(vec3(1.0), surfaceColor, 0.46);',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const pearlescentOpalSurfaceShaderSource = [
  'float pearlNoise = shaderFbm(surfaceObjectPoint * 7.0 + normal * 1.5);',
  'vec3 pearlViewDirection = shaderSafeNormalize(origin - hit, normal);',
  'float pearlAngle = pow(1.0 - shaderSaturate(dot(pearlViewDirection, normal)), 1.7);',
  'vec3 pearlWarm = vec3(1.0, 0.78, 0.54);',
  'vec3 pearlCool = vec3(0.50, 0.78, 1.0);',
  'vec3 pearlGreen = vec3(0.66, 1.0, 0.82);',
  'surfaceColor = mix(mix(pearlWarm, pearlCool, pearlAngle), pearlGreen, pearlNoise * 0.22);',
  'surfaceColor = mix(vec3(0.92, 0.86, 0.76), surfaceColor, 0.52 + pearlAngle * 0.38);',
  'vec3 pearlNormal = normalize(normal + shaderStableTangent(normal) * (pearlNoise - 0.5) * 0.055);',
  'ray = shaderSafeNormalize(mix(reflect(ray, pearlNormal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, pearlNormal), 0.20), normal);',
  'vec3 pearlLightDirection = shaderSafeNormalize(light - hit, normal);',
  'vec3 pearlReflectedLight = shaderSafeNormalize(reflect(pearlLightDirection, pearlNormal), pearlNormal);',
  'float pearlSpecularBase = shaderSaturate(dot(pearlReflectedLight, -pearlViewDirection));',
  'specularHighlight = pow(pearlSpecularBase, 32.0) * (0.85 + pearlAngle * 0.90);',
  'accumulatedColor += colorMask * surfaceColor * pearlAngle * 0.035;',
  'surfaceLightResponse = 0.72 + pearlAngle * 0.34;'
].join('');

const carbonFibreSurfaceShaderSource = [
  'vec3 carbonTangent = shaderStableTangent(normal);',
  'vec3 carbonBitangent = normalize(cross(normal, carbonTangent));',
  'float carbonWarp = step(0.5, fract(dot(surfaceObjectPoint, carbonTangent) * 22.0));',
  'float carbonWeft = step(0.5, fract(dot(surfaceObjectPoint, carbonBitangent) * 22.0));',
  'float carbonTow = mod(carbonWarp + carbonWeft, 2.0);',
  'float carbonFine = shaderFbm(surfaceObjectPoint * 82.0 + normal * 6.0);',
  'surfaceColor = mix(vec3(0.006, 0.007, 0.008), vec3(0.055, 0.060, 0.065), carbonTow * 0.72 + carbonFine * 0.18);',
  'vec3 carbonNormal = normalize(normal + carbonTangent * (carbonWarp - 0.5) * 0.10 + carbonBitangent * (carbonWeft - 0.5) * 0.10);',
  'ray = normalize(mix(reflect(ray, carbonNormal), cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, carbonNormal), 0.12));',
  'vec3 carbonLightDirection = normalize(light - hit);',
  'vec3 carbonViewDirection = normalize(origin - hit);',
  'vec3 carbonHalfVector = normalize(carbonLightDirection + carbonViewDirection);',
  'float carbonAnisotropy = carbonTow > 0.5 ? abs(dot(carbonHalfVector, carbonTangent)) : abs(dot(carbonHalfVector, carbonBitangent));',
  'float carbonSpecularBase = max(0.0, dot(carbonHalfVector, carbonNormal));',
  'specularHighlight = pow(carbonSpecularBase, 38.0) * (0.74 + carbonAnisotropy * 0.86);',
  'surfaceLightResponse = 0.34 + carbonFine * 0.12;'
].join('');

const furShortHairSurfaceShaderSource = [
  'vec3 furTangent = shaderStableTangent(normal);',
  'vec3 furBitangent = normalize(cross(normal, furTangent));',
  'float furRootNoise = shaderFbm(surfaceObjectPoint * vec3(18.0, 42.0, 18.0) + normal * 4.0);',
  'float furStrandPhase = dot(surfaceObjectPoint, furTangent) * 74.0 + shaderFbm(surfaceObjectPoint * 9.0) * 6.0;',
  'float furStrands = pow(abs(sin(furStrandPhase)), 7.0);',
  'float furNap = smoothstep(0.18, 0.92, shaderFbm(surfaceObjectPoint * vec3(32.0, 7.0, 20.0) + furBitangent * 2.0));',
  'vec3 furUndercoat = vec3(0.09, 0.055, 0.030);',
  'vec3 furTip = vec3(0.74, 0.57, 0.36);',
  'surfaceColor = mix(furUndercoat, furTip, furRootNoise * 0.62 + furNap * 0.28 + furStrands * 0.10);',
  'vec3 furNormal = normalize(normal + furTangent * (furStrands - 0.5) * 0.18 + furBitangent * (furNap - 0.5) * 0.09);',
  'ray = normalize(mix(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, furNormal), reflect(ray, furNormal), 0.16 + furStrands * 0.22));',
  'vec3 furLightDirection = normalize(light - hit);',
  'float furSheen = pow(max(0.0, 1.0 - abs(dot(furLightDirection, furTangent))), 5.0);',
  'specularHighlight = furSheen * (0.18 + furStrands * 0.42);',
  'surfaceLightResponse = 0.54 + furNap * 0.24;'
].join('');

const citrusPeelSurfaceShaderSource = [
  'float citrusPore = shaderFbm(surfaceObjectPoint * 72.0 + normal * 5.0);',
  'float citrusPit = smoothstep(0.58, 0.96, citrusPore);',
  'float citrusOilGland = smoothstep(0.78, 0.98, shaderFbm(surfaceObjectPoint * 34.0 + vec3(6.1, 2.4, 9.3)));',
  'float citrusMottle = shaderFbm(surfaceObjectPoint * 8.0 + vec3(2.2, 8.1, 1.3));',
  'surfaceColor = mix(vec3(0.82, 0.28, 0.025), vec3(1.0, 0.56, 0.08), citrusMottle);',
  'surfaceColor = mix(surfaceColor, vec3(1.0, 0.78, 0.20), citrusOilGland * 0.32);',
  'vec3 citrusTangent = shaderStableTangent(normal);',
  'vec3 citrusNormal = normalize(normal - citrusTangent * citrusPit * 0.13 + normalize(cross(normal, citrusTangent)) * (citrusPore - 0.5) * 0.10);',
  'ray = normalize(mix(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, citrusNormal), reflect(ray, citrusNormal), 0.14 + citrusOilGland * 0.18));',
  'vec3 citrusHalfVector = normalize(normalize(light - hit) + normalize(origin - hit));',
  'specularHighlight = pow(max(0.0, dot(citrusHalfVector, citrusNormal)), 42.0) * (0.18 + citrusOilGland * 0.62);',
  'surfaceLightResponse = 0.72 + citrusMottle * 0.18 - citrusPit * 0.10;'
].join('');

const fruitFleshSurfaceShaderSource = [
  'vec3 fruitTangent = shaderStableTangent(normal);',
  'float fruitFiber = abs(sin(dot(surfaceObjectPoint, fruitTangent) * 42.0 + shaderFbm(surfaceObjectPoint * 6.0) * 4.0));',
  'float fruitJuice = shaderFbm(surfaceObjectPoint * 18.0 + normal * 2.0);',
  'float fruitVein = smoothstep(0.58, 0.94, shaderFbm(surfaceObjectPoint * vec3(8.0, 18.0, 8.0) + vec3(3.0, 9.0, 4.0)));',
  'surfaceColor = mix(vec3(1.0, 0.74, 0.43), vec3(1.0, 0.95, 0.70), fruitFiber * 0.58 + fruitJuice * 0.20);',
  'surfaceColor = mix(surfaceColor, vec3(1.0, 0.48, 0.28), fruitVein * 0.28);',
  'accumulatedColor += colorMask * surfaceColor * (0.035 + fruitJuice * 0.045);',
  'vec3 fruitNormal = normalize(normal + fruitTangent * (fruitFiber - 0.5) * 0.075);',
  'ray = normalize(mix(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, fruitNormal), reflect(ray, fruitNormal), 0.09 + fruitJuice * 0.12));',
  'specularHighlight = pow(max(0.0, dot(reflect(normalize(hit - light), fruitNormal), normalize(origin - hit))), 24.0) * (0.16 + fruitJuice * 0.28);',
  'surfaceLightResponse = 0.66 + fruitJuice * 0.26;'
].join('');

const leafCuticleSurfaceShaderSource = [
  'vec3 leafTangent = shaderStableTangent(normal);',
  'vec3 leafBitangent = normalize(cross(normal, leafTangent));',
  'float leafMidrib = smoothstep(0.035, 0.0, abs(dot(surfaceObjectPoint, leafTangent)));',
  'float leafVeins = pow(abs(sin(dot(surfaceObjectPoint, leafBitangent) * 36.0 + dot(surfaceObjectPoint, leafTangent) * 12.0)), 10.0);',
  'float leafMottle = shaderFbm(surfaceObjectPoint * 12.0 + vec3(1.0, 7.0, 3.0));',
  'surfaceColor = mix(vec3(0.035, 0.24, 0.055), vec3(0.22, 0.52, 0.10), leafMottle);',
  'surfaceColor = mix(surfaceColor, vec3(0.72, 0.88, 0.30), max(leafMidrib, leafVeins * 0.45));',
  'vec3 leafNormal = normalize(normal + leafBitangent * leafVeins * 0.10 + leafTangent * leafMidrib * 0.08);',
  'ray = normalize(mix(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, leafNormal), reflect(ray, leafNormal), 0.22));',
  'float leafFresnel = pow(1.0 - max(0.0, dot(normalize(origin - hit), leafNormal)), 3.0);',
  'specularHighlight = pow(max(0.0, dot(reflect(normalize(hit - light), leafNormal), normalize(origin - hit))), 55.0) * (0.22 + leafFresnel * 0.62);',
  'surfaceLightResponse = 0.58 + leafMottle * 0.28;'
].join('');

const mossGrassSurfaceShaderSource = [
  'vec3 mossTangent = shaderStableTangent(normal);',
  'vec3 mossBitangent = normalize(cross(normal, mossTangent));',
  'float mossClump = shaderFbm(surfaceObjectPoint * 16.0 + normal * 3.0);',
  'float grassBlade = pow(abs(sin(dot(surfaceObjectPoint, mossTangent) * 86.0 + shaderFbm(surfaceObjectPoint * 10.0) * 5.0)), 6.0);',
  'float mossDamp = smoothstep(0.62, 0.95, shaderFbm(surfaceObjectPoint * 7.0 + vec3(8.0, 2.0, 5.0)));',
  'surfaceColor = mix(vec3(0.025, 0.12, 0.025), vec3(0.28, 0.48, 0.11), mossClump);',
  'surfaceColor = mix(surfaceColor, vec3(0.50, 0.64, 0.20), grassBlade * 0.36);',
  'vec3 mossNormal = normalize(normal + mossTangent * (grassBlade - 0.5) * 0.18 + mossBitangent * (mossClump - 0.5) * 0.12);',
  'ray = normalize(mix(cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, mossNormal), reflect(ray, mossNormal), 0.06 + mossDamp * 0.18));',
  'specularHighlight = pow(max(0.0, dot(reflect(normalize(hit - light), mossNormal), normalize(origin - hit))), 18.0) * mossDamp * 0.28;',
  'surfaceLightResponse = 0.46 + mossClump * 0.28 + grassBlade * 0.10;'
].join('');

const diffractionGratingSurfaceShaderSource = [
  'vec3 diffractionViewDirection = normalize(-ray);',
  'vec3 diffractionReflectDirection = normalize(reflect(ray, normal));',
  'float diffractionPhase = dot(diffractionViewDirection, diffractionReflectDirection) * 9.0 + dot(hit, vec3(36.0, 0.0, 12.0));',
  'float diffractionBand = 0.5 + 0.5 * sin(diffractionPhase * 3.0);',
  'vec3 diffractionRainbow = 0.5 + 0.5 * cos(vec3(0.0, 2.09439, 4.18879) + diffractionPhase * 6.28318);',
  'surfaceColor = mix(vec3(0.035, 0.040, 0.050), diffractionRainbow, 0.72 + diffractionBand * 0.22);',
  'ray = normalize(mix(diffractionReflectDirection, cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal), 0.08));',
  specularReflectionSource,
  'specularHighlight = pow(max(specularHighlight, 0.0), 18.0) * (1.0 + diffractionBand * 2.4);',
  'surfaceLightResponse = 0.65 + diffractionBand * 0.35;'
].join('');

const createEmissionModifierShaderSource = (sceneObject) => {
  if (!readSceneObjectEmissionEnabled(sceneObject)) {
    return '';
  }
  const emissionStrength = readSceneObjectEmissiveIntensity(sceneObject);
  if (emissionStrength <= MIN_EMISSIVE_INTENSITY) {
    return '';
  }
  return [
    `const float emissionStrength = ${formatShaderFloat(emissionStrength)};`,
    `const vec3 emissionColor = ${formatShaderVec3(readSceneObjectEmissiveColor(sceneObject))};`,
    'accumulatedColor += colorMask * emissionColor * emissionStrength;'
  ].join('');
};

const createEmissiveSurfaceShaderSource = (sceneObject) => [
  `surfaceColor = ${formatShaderVec3(readSceneObjectEmissiveColor(sceneObject))};`,
  `surfaceLightResponse = ${readSceneObjectEmissionEnabled(sceneObject) ? '0.0' : '1.0'};`,
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);'
].join('');

const toonSurfaceShaderSource = [
  'vec3 toonLightDirection = normalize(light - hit);',
  'vec3 toonViewDirection = normalize(origin - hit);',
  'float toonLambert = max(dot(toonLightDirection, normal), 0.0);',
  'float toonBand = toonLambert < 0.25 ? 0.22 : (toonLambert < 0.58 ? 0.55 : 1.0);',
  'float toonRim = pow(1.0 - max(dot(toonViewDirection, normal), 0.0), 3.0);',
  'surfaceColor = mix(vec3(0.08, 0.16, 0.58), vec3(0.20, 0.55, 1.0), toonBand);',
  'surfaceColor = mix(surfaceColor, vec3(1.0, 0.95, 0.72), step(0.54, toonRim) * 0.35);',
  'float toonSpecular = max(dot(reflect(-toonLightDirection, normal), toonViewDirection), 0.0);',
  'specularHighlight = step(0.94, toonSpecular) * 0.85;',
  'surfaceLightResponse = 0.70 + toonBand * 0.35;',
  'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);'
].join('');

const xRaySurfaceShaderSource = [
  'vec3 xrayViewDirection = normalize(origin - hit);',
  'float xrayRim = pow(1.0 - abs(dot(xrayViewDirection, normal)), 2.0);',
  'surfaceColor = mix(vec3(0.05, 0.32, 0.52), vec3(0.58, 0.95, 1.0), 0.18 + xrayRim * 0.82);',
  'accumulatedColor += colorMask * vec3(0.28, 0.82, 1.0) * (0.08 + xrayRim * 0.58);',
  'surfaceLightResponse = 0.12 + xrayRim * 0.55;',
  'ray = normalize(mix(ray, cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal), 0.28));'
].join('');

const createMaterialTextureShaderSource = (sceneObject) => {
  if (!sceneObjectUsesTriplanarProjection(sceneObject)) {
    return '';
  }
  return [
    `const float materialUvScale = ${formatShaderFloat(readSceneObjectUvScale(sceneObject))};`,
    `const float materialUvBlendSharpness = ${formatShaderFloat(readSceneObjectUvBlendSharpness(sceneObject))};`,
    'vec3 materialTextureColor = sampleTriplanarAlbedo(',
    '  materialAlbedoTexture,',
    '  surfaceObjectPoint,',
    '  normal,',
    '  materialUvScale,',
    '  materialUvBlendSharpness',
    ');'
  ].join('');
};

const applyMaterialTextureShaderSource = 'surfaceColor *= materialTextureColor;';

const composeObjectSurfaceShaderSource = (baseSurfaceShaderSource, materialTextureShaderSource) => {
  if (!materialTextureShaderSource) {
    return baseSurfaceShaderSource;
  }

  let surfaceShaderSource = baseSurfaceShaderSource;
  let didInlineMaterialTexture = false;
  if (surfaceShaderSource.includes('colorMask *= surfaceColor;')) {
    surfaceShaderSource = surfaceShaderSource.replaceAll(
      'colorMask *= surfaceColor;',
      `${applyMaterialTextureShaderSource}colorMask *= surfaceColor;`
    );
    didInlineMaterialTexture = true;
  }
  if (surfaceShaderSource.includes('continue;')) {
    return didInlineMaterialTexture
      ? surfaceShaderSource
      : surfaceShaderSource.replaceAll('continue;', `${applyMaterialTextureShaderSource}continue;`);
  }
  return didInlineMaterialTexture
    ? surfaceShaderSource
    : `${surfaceShaderSource}${applyMaterialTextureShaderSource}`;
};

const createBaseObjectSurfaceShaderSource = (material, sceneObject = null) => {
  const normalizedMaterial = normalizeMaterial(material);
  if (normalizedMaterial === MATERIAL.MIRROR) {
    return newReflectiveRaySource;
  }
  if (normalizedMaterial === MATERIAL.GLOSSY) {
    return newGlossyRaySource;
  }
  if (normalizedMaterial === MATERIAL.GLASS) {
    return newGlassRaySource;
  }
  if (normalizedMaterial === MATERIAL.GGX_PBR) {
    return ggxPbrSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.ANISOTROPIC_GGX) {
    return anisotropicGgxSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.SPECTRAL_GLASS) {
    return spectralGlassSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.SUBSURFACE) {
    return subsurfaceSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.CAUSTICS) {
    return causticsSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.PROCEDURAL) {
    return proceduralSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.SDF_FRACTAL) {
    return sdfFractalSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.VOLUMETRIC_SHAFTS) {
    return volumetricShaftsSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.HETEROGENEOUS_FOG) {
    return heterogeneousFogSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.BOKEH) {
    return bokehSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.MOTION_BLUR_STRESS) {
    return motionBlurStressSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.FIRE_PLASMA) {
    return firePlasmaSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.BLACKBODY) {
    return blackbodySurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.THIN_FILM) {
    return thinFilmSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.RETROREFLECTOR) {
    return retroreflectorSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.VELVET) {
    return velvetSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.VORONOI_CRACKS) {
    return voronoiCracksSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.BARK_CORK) {
    return barkCorkSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.RUBBER) {
    return rubberSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.MATTE_PLASTIC) {
    return mattePlasticSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.WOOD_GRAIN) {
    return woodGrainSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.MARBLE) {
    return marbleSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.CERAMIC_GLAZE) {
    return ceramicGlazeSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.CLEAR_COAT_AUTOMOTIVE) {
    return clearCoatAutomotiveSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.SKIN_WAX) {
    return skinWaxSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.LEATHER) {
    return leatherSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.SAND) {
    return sandSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.SNOW) {
    return snowSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.AMBER_HONEY) {
    return amberHoneySurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.SOAP_FOAM) {
    return soapFoamSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.WOVEN_FABRIC) {
    return wovenFabricSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.WATER_LIQUID) {
    return waterLiquidSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.ICE_FROSTED_GLASS) {
    return iceFrostedGlassSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.PEARLESCENT_OPAL) {
    return pearlescentOpalSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.CARBON_FIBRE) {
    return carbonFibreSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.FUR_SHORT_HAIR) {
    return furShortHairSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.CITRUS_PEEL) {
    return citrusPeelSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.FRUIT_FLESH) {
    return fruitFleshSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.LEAF_CUTICLE) {
    return leafCuticleSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.MOSS_GRASS) {
    return mossGrassSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.DIFFRACTION_GRATING) {
    return diffractionGratingSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.EMISSIVE) {
    return createEmissiveSurfaceShaderSource(sceneObject);
  }
  if (normalizedMaterial === MATERIAL.TOON) {
    return toonSurfaceShaderSource;
  }
  if (normalizedMaterial === MATERIAL.X_RAY) {
    return xRaySurfaceShaderSource;
  }
  return newDiffuseRaySource;
};

const createObjectSurfaceShaderSource = (material, sceneObject = null) => {
  const materialTextureShaderSource = createMaterialTextureShaderSource(sceneObject);
  return [
    materialTextureShaderSource,
    createEmissionModifierShaderSource(sceneObject),
    composeObjectSurfaceShaderSource(
      createBaseObjectSurfaceShaderSource(material, sceneObject),
      materialTextureShaderSource
    )
  ].join('');
};

const yellowBlueCornellBoxSource = [
  'if(hit.x < -0.9999) surfaceColor = vec3(0.1, 0.5, 1.0);',
  'else if(hit.x > 0.9999) surfaceColor = vec3(1.0, 0.9, 0.1);'
].join('');

const redGreenCornellBoxSource = [
  'if(hit.x < -0.9999) surfaceColor = vec3(1.0, 0.3, 0.1);',
  'else if(hit.x > 0.9999) surfaceColor = vec3(0.3, 1.0, 0.1);'
].join('');

const skyShaderSource = [
  'vec3 sampleEnvironmentSky(vec3 ray) {',
  '  vec3 skyDirection = normalize(ray);',
  '  float skyU = atan(skyDirection.z, skyDirection.x) / 6.28318530718 + 0.5;',
  '  float skyV = acos(clamp(skyDirection.y, -1.0, 1.0)) / 3.14159265359;',
  '  return texture2D(skyTexture, vec2(skyU, skyV)).rgb * skyBrightness;',
  '}',
  'float fogTransmittance(float distance) {',
  '  return exp(-max(fogDensity, 0.0) * max(distance, 0.0));',
  '}'
].join('');

const SUCCESS_UNDEFINED_RESULT = Object.freeze([undefined, null]);
const SUCCESS_TRUE_RESULT = Object.freeze([true, null]);
const SUCCESS_FALSE_RESULT = Object.freeze([false, null]);
const SUCCESS_NULL_RESULT = Object.freeze([null, null]);

const returnSuccess = (value) => {
  if (value === undefined) {
    return SUCCESS_UNDEFINED_RESULT;
  }
  if (value === true) {
    return SUCCESS_TRUE_RESULT;
  }
  if (value === false) {
    return SUCCESS_FALSE_RESULT;
  }
  if (value === null) {
    return SUCCESS_NULL_RESULT;
  }
  return [value, null];
};

const returnFailure = (code, message, details = null) => [
  null,
  Object.freeze({ code, message, details })
];

const readErrorMessage = (errorValue) => {
  if (errorValue && typeof errorValue.message === 'string') {
    return errorValue.message;
  }
  return String(errorValue);
};

const readErrorDetails = (errorValue) => {
  if (errorValue && typeof errorValue.stack === 'string' && errorValue.stack.trim()) {
    return errorValue.stack;
  }
  return readErrorMessage(errorValue);
};

const DIAGNOSTIC_DEBUG_STORAGE_PREFIX = 'pathtracer.debug.';
const DIAGNOSTIC_GLOBAL_DEBUG_STORAGE_KEY = `${DIAGNOSTIC_DEBUG_STORAGE_PREFIX}all`;
const DIAGNOSTIC_TRUTHY_STORAGE_VALUES = Object.freeze(new Set([
  '1',
  'true',
  'yes',
  'on',
  'debug',
  'enabled'
]));

const readCurrentMilliseconds = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const roundDiagnosticMilliseconds = (durationMilliseconds) => (
  Math.round(durationMilliseconds * 100) / 100
);

const readDiagnosticStorageFlag = (key) => {
  try {
    const storage = typeof globalThis === 'undefined' ? null : globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function') {
      return false;
    }

    const rawValue = storage.getItem(key);
    return DIAGNOSTIC_TRUTHY_STORAGE_VALUES.has(String(rawValue || '').trim().toLowerCase());
  } catch {
    return false;
  }
};

const isDiagnosticDebugEnabled = (channel) => (
  readDiagnosticStorageFlag(`${DIAGNOSTIC_DEBUG_STORAGE_PREFIX}${channel}`) ||
  readDiagnosticStorageFlag(DIAGNOSTIC_GLOBAL_DEBUG_STORAGE_KEY)
);

const logDiagnostic = (level, channel, message, details = null) => {
  if (typeof console === 'undefined') {
    return returnSuccess(undefined);
  }

  const requestedLevel = typeof level === 'string' ? level : 'info';
  if (requestedLevel === 'debug' && !isDiagnosticDebugEnabled(channel)) {
    return returnSuccess(undefined);
  }

  captureLoggerEntry(Object.freeze({
    channel,
    level: requestedLevel,
    message: String(message),
    details,
    timestamp: new Date().toISOString()
  }));

  const normalizedLevel = typeof console[requestedLevel] === 'function' ? requestedLevel : 'log';
  const logMessage = `[${channel}] ${message}`;
  if (details === null || details === undefined) {
    console[normalizedLevel](logMessage);
  } else {
    console[normalizedLevel](logMessage, details);
  }
  return returnSuccess(undefined);
};

const returnDiagnosticFailure = (level, channel, diagnosticMessage, failureValue, detailsOverride = null) => {
  const failureObject = failureValue && typeof failureValue === 'object'
    ? failureValue
    : Object.freeze({
        code: 'unknown-failure',
        message: String(failureValue),
        details: null
      });
  const failureCode = typeof failureObject.code === 'string' ? failureObject.code : 'unknown-failure';
  const failureMessage = typeof failureObject.message === 'string'
    ? failureObject.message
    : String(failureObject);
  const failureDetails = detailsOverride === null ? failureObject.details : detailsOverride;
  logDiagnostic(level, channel, diagnosticMessage, Object.freeze({
    code: failureCode,
    failureMessage,
    details: failureDetails === undefined ? null : failureDetails
  }));
  return returnFailure(failureCode, failureMessage, failureDetails);
};

const loadRapierModule = () => (
  import('./vendor/rapier/rapier.js').then(
    (rapierModule) => returnSuccess(rapierModule),
    (loadError) => returnFailure('rapier-module-load-failed', 'Rapier module could not be loaded.', readErrorMessage(loadError))
  )
);

const initializeRapierRuntime = (rapierModule) => {
  if (!rapierModule || typeof rapierModule.init !== 'function') {
    return Promise.resolve(returnFailure('rapier-init-missing', 'Rapier module does not expose an init function.'));
  }

  return rapierModule.init().then(
    () => returnSuccess(rapierModule),
    (initError) => returnFailure('rapier-init-failed', 'Rapier runtime could not be initialized.', readErrorMessage(initError))
  );
};

const createRapierRuntime = async () => {
  const initStartMilliseconds = readCurrentMilliseconds();
  const [rapierModule, loadError] = await loadRapierModule();
  if (loadError) {
    return returnFailure(loadError.code, loadError.message, loadError.details);
  }

  const [rapierRuntime, initError] = await initializeRapierRuntime(rapierModule);
  if (initError) {
    return returnFailure(initError.code, initError.message, initError.details);
  }

  logDiagnostic('info', 'physics', 'Rapier runtime initialized.', Object.freeze({
    durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - initStartMilliseconds)
  }));

  return returnSuccess(rapierRuntime);
};

const createVec3 = (x, y, z) => {
  const vector = new Float32Array(FLOATS_PER_VEC3);
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
  return vector;
};

const createMat4 = () => new Float32Array(FLOATS_PER_MAT4);

const cloneVec3 = (vector) => createVec3(vector[0], vector[1], vector[2]);

const writeVec3 = (outputVector, x, y, z) => {
  outputVector[0] = x;
  outputVector[1] = y;
  outputVector[2] = z;
  return outputVector;
};

const writeAddVec3 = (outputVector, leftVector, rightVector) => writeVec3(
  outputVector,
  leftVector[0] + rightVector[0],
  leftVector[1] + rightVector[1],
  leftVector[2] + rightVector[2]
);

const writeSubtractVec3 = (outputVector, leftVector, rightVector) => writeVec3(
  outputVector,
  leftVector[0] - rightVector[0],
  leftVector[1] - rightVector[1],
  leftVector[2] - rightVector[2]
);

const writeScaleVec3 = (outputVector, vector, scalar) => writeVec3(
  outputVector,
  vector[0] * scalar,
  vector[1] * scalar,
  vector[2] * scalar
);

const writeAddScaledVec3 = (outputVector, baseVector, vector, scalar) => writeVec3(
  outputVector,
  baseVector[0] + vector[0] * scalar,
  baseVector[1] + vector[1] * scalar,
  baseVector[2] + vector[2] * scalar
);

const writeCrossVec3 = (outputVector, leftVector, rightVector) => writeVec3(
  outputVector,
  leftVector[1] * rightVector[2] - leftVector[2] * rightVector[1],
  leftVector[2] * rightVector[0] - leftVector[0] * rightVector[2],
  leftVector[0] * rightVector[1] - leftVector[1] * rightVector[0]
);

const writeNormalizeVec3 = (outputVector, vector) => {
  const vectorLength = lengthVec3(vector);
  if (vectorLength === 0) {
    return writeVec3(outputVector, 0, 0, 0);
  }
  return writeScaleVec3(outputVector, vector, 1 / vectorLength);
};

const WORLD_UP_VECTOR = createVec3(0, 1, 0);
const ORIGIN_VECTOR = createVec3(0, 0, 0);

const addVec3 = (leftVector, rightVector) => createVec3(
  leftVector[0] + rightVector[0],
  leftVector[1] + rightVector[1],
  leftVector[2] + rightVector[2]
);

const dotVec3 = (leftVector, rightVector) => (
  leftVector[0] * rightVector[0] +
  leftVector[1] * rightVector[1] +
  leftVector[2] * rightVector[2]
);

const squaredLengthVec3 = (vector) => (
  vector[0] * vector[0] +
  vector[1] * vector[1] +
  vector[2] * vector[2]
);

const lengthVec3 = (vector) => Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);

const clampNumber = (value, minValue, maxValue) => Math.max(minValue, Math.min(maxValue, value));

const clampInteger = (value, minValue, maxValue) => Math.trunc(clampNumber(value, minValue, maxValue));

const normalizeBoundedInteger = (value, fallbackValue, minValue, maxValue) => {
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return clampInteger(value, minValue, maxValue);
};

const parseBoundedInteger = (rawValue, fallbackValue, minValue, maxValue) => {
  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) {
    return returnSuccess(fallbackValue);
  }
  return returnSuccess(normalizeBoundedInteger(parsedValue, fallbackValue, minValue, maxValue));
};

const normalizeMaterial = (material) => normalizeBoundedInteger(
  material,
  MATERIAL.DIFFUSE,
  MIN_MATERIAL,
  MAX_MATERIAL
);

const parseMaterial = (rawValue) => parseBoundedInteger(
  rawValue,
  MATERIAL.DIFFUSE,
  MIN_MATERIAL,
  MAX_MATERIAL
);

const normalizeToneMappingMode = (toneMappingMode) => normalizeBoundedInteger(
  toneMappingMode,
  DEFAULT_TONE_MAPPING_MODE,
  TONE_MAPPING.LINEAR,
  TONE_MAPPING.UNCHARTED2
);

const parseToneMappingMode = (rawValue) => parseBoundedInteger(
  rawValue,
  DEFAULT_TONE_MAPPING_MODE,
  TONE_MAPPING.LINEAR,
  TONE_MAPPING.UNCHARTED2
);

const appendAdditionalMaterialSelectOptions = (materialSelect) => {
  const selectedValue = materialSelect.value;
  const selectableValues = new Set(MATERIAL_SELECT_OPTIONS.map(([materialValue]) => String(materialValue)));

  while (materialSelect.firstChild) {
    materialSelect.removeChild(materialSelect.firstChild);
  }

  for (const [materialValue, materialLabel] of MATERIAL_SELECT_OPTIONS) {
    const optionValue = String(materialValue);
    const optionElement = materialSelect.ownerDocument.createElement('option');
    optionElement.value = optionValue;
    optionElement.textContent = materialLabel;
    materialSelect.appendChild(optionElement);
  }

  materialSelect.value = selectableValues.has(selectedValue) ? selectedValue : String(MATERIAL.DIFFUSE);
  return returnSuccess(undefined);
};

const normalizeRenderDebugViewMode = (debugViewMode) => (
  Number.isFinite(debugViewMode) &&
  debugViewMode >= RENDER_DEBUG_VIEW.BEAUTY &&
  debugViewMode <= RENDER_DEBUG_VIEW.DEPTH
    ? debugViewMode
    : RENDER_DEBUG_VIEW.BEAUTY
);

const parseRenderDebugViewMode = (rawValue) => {
  if (Object.prototype.hasOwnProperty.call(RENDER_DEBUG_VIEW_MODES, rawValue)) {
    return returnSuccess(RENDER_DEBUG_VIEW_MODES[rawValue]);
  }
  return returnFailure('invalid-debug-view', `Render debug view "${rawValue}" is not available.`);
};

const toHexByte = (value) => (
  Math.round(clampNumber(value, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')
);

const formatLightColorValue = (lightColor) => `#${toHexByte(lightColor[0])}${toHexByte(lightColor[1])}${toHexByte(lightColor[2])}`;

const normalizeLightTemperatureKelvin = (temperatureKelvin) => {
  const normalizedTemperature = Number(temperatureKelvin);
  if (!Number.isFinite(normalizedTemperature)) {
    return DEFAULT_LIGHT_TEMPERATURE_KELVIN;
  }
  return clampNumber(
    Math.round(normalizedTemperature / LIGHT_TEMPERATURE_STEP_KELVIN) * LIGHT_TEMPERATURE_STEP_KELVIN,
    MIN_LIGHT_TEMPERATURE_KELVIN,
    MAX_LIGHT_TEMPERATURE_KELVIN
  );
};

const createLightColorFromTemperature = (temperatureKelvin) => {
  const scaledTemperature = normalizeLightTemperatureKelvin(temperatureKelvin) / 100;
  const red = scaledTemperature <= 66
    ? 255
    : clampNumber(329.698727446 * ((scaledTemperature - 60) ** -0.1332047592), 0, 255);
  const green = scaledTemperature <= 66
    ? clampNumber(99.4708025861 * Math.log(scaledTemperature) - 161.1195681661, 0, 255)
    : clampNumber(288.1221695283 * ((scaledTemperature - 60) ** -0.0755148492), 0, 255);
  const blue = scaledTemperature >= 66
    ? 255
    : (scaledTemperature <= 19
        ? 0
        : clampNumber(138.5177312231 * Math.log(scaledTemperature - 10) - 305.0447927307, 0, 255));

  return createVec3(red / 255, green / 255, blue / 255);
};

const calculateLightColorDistance = (firstColor, secondColor) => {
  const redDelta = firstColor[0] - secondColor[0];
  const greenDelta = firstColor[1] - secondColor[1];
  const blueDelta = firstColor[2] - secondColor[2];
  return redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
};

const estimateLightTemperatureKelvin = (lightColor) => {
  let bestTemperature = DEFAULT_LIGHT_TEMPERATURE_KELVIN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (
    let temperatureKelvin = MIN_LIGHT_TEMPERATURE_KELVIN;
    temperatureKelvin <= MAX_LIGHT_TEMPERATURE_KELVIN;
    temperatureKelvin += LIGHT_TEMPERATURE_STEP_KELVIN
  ) {
    const candidateColor = createLightColorFromTemperature(temperatureKelvin);
    const colorDistance = calculateLightColorDistance(lightColor, candidateColor);
    if (colorDistance < bestDistance) {
      bestTemperature = temperatureKelvin;
      bestDistance = colorDistance;
    }
  }
  return bestTemperature;
};

const formatLightTemperatureValue = (temperatureKelvin) => `${Math.round(temperatureKelvin)} K`;

const parseLightColorValue = (rawValue) => {
  const normalizedValue = String(rawValue || '').trim();
  const colorMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalizedValue);
  if (!colorMatch) {
    return returnFailure('invalid-light-color', 'Light color must be a hex color.');
  }

  const colorHex = colorMatch[1].length === 3
    ? colorMatch[1].split('').map((hexDigit) => `${hexDigit}${hexDigit}`).join('')
    : colorMatch[1];
  return returnSuccess(createVec3(
    Number.parseInt(colorHex.slice(0, 2), 16) / 255,
    Number.parseInt(colorHex.slice(2, 4), 16) / 255,
    Number.parseInt(colorHex.slice(4, 6), 16) / 255
  ));
};

const isTransparentMaterial = (material) => (
  material === MATERIAL.GLASS ||
  material === MATERIAL.SPECTRAL_GLASS ||
  material === MATERIAL.CAUSTICS ||
  material === MATERIAL.X_RAY ||
  material === MATERIAL.HETEROGENEOUS_FOG ||
  material === MATERIAL.AMBER_HONEY ||
  material === MATERIAL.WATER_LIQUID ||
  material === MATERIAL.ICE_FROSTED_GLASS
);

const readSceneObjectUvProjectionMode = (sceneObject) => (
  normalizeMaterialUvProjectionMode(sceneObject && sceneObject.uvProjectionMode)
);

const readSceneObjectUvScale = (sceneObject) => (
  normalizeMaterialUvScale(sceneObject && sceneObject.uvScale)
);

const readSceneObjectUvBlendSharpness = (sceneObject) => (
  normalizeMaterialUvBlendSharpness(sceneObject && sceneObject.uvBlendSharpness)
);

const sceneObjectUsesTriplanarProjection = (sceneObject) => (
  readSceneObjectUvProjectionMode(sceneObject) === 'tri-planar'
);

const hasSceneObjectCustomUvProjectionSettings = (sceneObject) => (
  readSceneObjectUvProjectionMode(sceneObject) !== DEFAULT_MATERIAL_UV_PROJECTION_MODE ||
  readSceneObjectUvScale(sceneObject) !== DEFAULT_MATERIAL_UV_SCALE ||
  readSceneObjectUvBlendSharpness(sceneObject) !== DEFAULT_MATERIAL_UV_BLEND_SHARPNESS
);

const materialUsesSurfaceShaderUtilities = (material) => {
  const normalizedMaterial = normalizeMaterial(material);
  return (
    normalizedMaterial === MATERIAL.GGX_PBR ||
    normalizedMaterial === MATERIAL.ANISOTROPIC_GGX ||
    normalizedMaterial === MATERIAL.SUBSURFACE ||
    normalizedMaterial === MATERIAL.PROCEDURAL ||
    normalizedMaterial === MATERIAL.SDF_FRACTAL ||
    normalizedMaterial === MATERIAL.VOLUMETRIC_SHAFTS ||
    normalizedMaterial === MATERIAL.HETEROGENEOUS_FOG ||
    normalizedMaterial === MATERIAL.BOKEH ||
    normalizedMaterial === MATERIAL.MOTION_BLUR_STRESS ||
    normalizedMaterial === MATERIAL.FIRE_PLASMA ||
    normalizedMaterial === MATERIAL.BLACKBODY ||
    normalizedMaterial === MATERIAL.VORONOI_CRACKS ||
    normalizedMaterial === MATERIAL.BARK_CORK ||
    normalizedMaterial === MATERIAL.RUBBER ||
    normalizedMaterial === MATERIAL.MATTE_PLASTIC ||
    normalizedMaterial === MATERIAL.WOOD_GRAIN ||
    normalizedMaterial === MATERIAL.MARBLE ||
    normalizedMaterial === MATERIAL.CERAMIC_GLAZE ||
    normalizedMaterial === MATERIAL.CLEAR_COAT_AUTOMOTIVE ||
    normalizedMaterial === MATERIAL.SKIN_WAX ||
    normalizedMaterial === MATERIAL.LEATHER ||
    normalizedMaterial === MATERIAL.SAND ||
    normalizedMaterial === MATERIAL.SNOW ||
    normalizedMaterial === MATERIAL.AMBER_HONEY ||
    normalizedMaterial === MATERIAL.SOAP_FOAM ||
    normalizedMaterial === MATERIAL.WOVEN_FABRIC ||
    normalizedMaterial === MATERIAL.WATER_LIQUID ||
    normalizedMaterial === MATERIAL.ICE_FROSTED_GLASS ||
    normalizedMaterial === MATERIAL.PEARLESCENT_OPAL ||
    normalizedMaterial === MATERIAL.CARBON_FIBRE ||
    normalizedMaterial === MATERIAL.FUR_SHORT_HAIR ||
    normalizedMaterial === MATERIAL.CITRUS_PEEL ||
    normalizedMaterial === MATERIAL.FRUIT_FLESH ||
    normalizedMaterial === MATERIAL.LEAF_CUTICLE ||
    normalizedMaterial === MATERIAL.MOSS_GRASS
  );
};

const sceneObjectUsesSurfaceShaderUtilities = (sceneObject) => (
  Boolean(sceneObject) &&
  (
    sceneObjectUsesTriplanarProjection(sceneObject) ||
    materialUsesSurfaceShaderUtilities(sceneObject.material)
  )
);

const sceneUsesSurfaceShaderUtilities = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    if (!isRenderableSceneObject(sceneObject) || !Number.isFinite(Number(sceneObject.material))) {
      continue;
    }
    if (sceneObjectUsesSurfaceShaderUtilities(sceneObject)) {
      return true;
    }
  }
  return false;
};

const sceneUsesMaterialTextureProjection = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    if (!isRenderableSceneObject(sceneObject) || !Number.isFinite(Number(sceneObject.material))) {
      continue;
    }
    if (sceneObjectUsesTriplanarProjection(sceneObject)) {
      return true;
    }
  }
  return false;
};

const sceneUsesMaterial = (sceneObjects, material) => {
  const normalizedMaterial = normalizeMaterial(material);
  for (const sceneObject of sceneObjects) {
    if (!isRenderableSceneObject(sceneObject) || !Number.isFinite(Number(sceneObject.material))) {
      continue;
    }
    if (normalizeMaterial(sceneObject.material) === normalizedMaterial) {
      return true;
    }
  }
  return false;
};

const renderSettingsUseSkyTexture = (renderSettings) => (
  renderSettings.environment === ENVIRONMENT.OPEN_SKY_STUDIO ||
  renderSettings.fogDensity > 0.0001
);

const normalizeBoundedNumber = (value, fallbackValue, minValue, maxValue) => {
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return clampNumber(value, minValue, maxValue);
};

const parseBoundedNumber = (rawValue, fallbackValue, minValue, maxValue) => {
  const parsedValue = Number.parseFloat(rawValue);
  if (Number.isNaN(parsedValue)) {
    return returnSuccess(fallbackValue);
  }
  return returnSuccess(normalizeBoundedNumber(parsedValue, fallbackValue, minValue, maxValue));
};

const createDefaultParticleFluidSettings = () => ({
  particleCount: DEFAULT_PARTICLE_FLUID_PARTICLE_COUNT,
  radius: DEFAULT_PARTICLE_FLUID_RADIUS,
  springStiffness: DEFAULT_PARTICLE_FLUID_SPRING_STIFFNESS
});

const normalizeParticleFluidSettings = (settings = {}) => ({
  particleCount: normalizeBoundedInteger(
    Number(settings.particleCount),
    DEFAULT_PARTICLE_FLUID_PARTICLE_COUNT,
    MIN_PARTICLE_FLUID_PARTICLE_COUNT,
    MAX_PARTICLE_FLUID_PARTICLE_COUNT
  ),
  radius: normalizeBoundedNumber(
    Number(settings.radius),
    DEFAULT_PARTICLE_FLUID_RADIUS,
    MIN_PARTICLE_FLUID_RADIUS,
    MAX_PARTICLE_FLUID_RADIUS
  ),
  springStiffness: normalizeBoundedNumber(
    Number(settings.springStiffness),
    DEFAULT_PARTICLE_FLUID_SPRING_STIFFNESS,
    MIN_PARTICLE_FLUID_SPRING_STIFFNESS,
    MAX_PARTICLE_FLUID_SPRING_STIFFNESS
  )
});

const readApplicationStateParticleFluidSettings = (applicationState) => {
  if (!applicationState) {
    return normalizeParticleFluidSettings(createDefaultParticleFluidSettings());
  }
  applicationState.particleFluidSettings = normalizeParticleFluidSettings(
    applicationState.particleFluidSettings || createDefaultParticleFluidSettings()
  );
  return applicationState.particleFluidSettings;
};

const createDefaultGlobalGravityCustomDirection = () => createVec3(0, -1, 0);

const normalizeGlobalGravityDirection = (directionValue) => {
  const normalizedDirection = String(directionValue || '').trim();
  if (
    normalizedDirection === GLOBAL_GRAVITY_DIRECTION.DOWN ||
    normalizedDirection === GLOBAL_GRAVITY_DIRECTION.UP ||
    normalizedDirection === GLOBAL_GRAVITY_DIRECTION.ZERO_G ||
    normalizedDirection === GLOBAL_GRAVITY_DIRECTION.CUSTOM
  ) {
    return normalizedDirection;
  }
  if (normalizedDirection === 'zero' || normalizedDirection === 'zeroG' || normalizedDirection === 'zero-g') {
    return GLOBAL_GRAVITY_DIRECTION.ZERO_G;
  }
  return DEFAULT_GLOBAL_GRAVITY_DIRECTION;
};

const normalizeGlobalGravityMagnitude = (magnitudeValue, fallbackValue = DEFAULT_GLOBAL_GRAVITY_MAGNITUDE) => (
  normalizeBoundedNumber(
    Number(magnitudeValue),
    fallbackValue,
    MIN_GLOBAL_GRAVITY_MAGNITUDE,
    MAX_GLOBAL_GRAVITY_MAGNITUDE
  )
);

const ensureApplicationStateCustomGravityDirection = (applicationState) => {
  if (!applicationState.physicsCustomGravityDirection) {
    applicationState.physicsCustomGravityDirection = createDefaultGlobalGravityCustomDirection();
  }
  return applicationState.physicsCustomGravityDirection;
};

const writeNormalizedGravityDirection = (outputVector, xValue, yValue, zValue) => {
  writeVec3(outputVector, xValue, yValue, zValue);
  if (squaredLengthVec3(outputVector) <= GLOBAL_GRAVITY_DIRECTION_EPSILON * GLOBAL_GRAVITY_DIRECTION_EPSILON) {
    return writeVec3(outputVector, 0, -1, 0);
  }
  return writeNormalizeVec3(outputVector, outputVector);
};

const writeDefaultGlobalGravitySettings = (applicationState) => {
  applicationState.physicsGravityDirection = DEFAULT_GLOBAL_GRAVITY_DIRECTION;
  applicationState.physicsGravityMagnitude = DEFAULT_GLOBAL_GRAVITY_MAGNITUDE;
  writeVec3(ensureApplicationStateCustomGravityDirection(applicationState), 0, -1, 0);
  return returnSuccess(undefined);
};

const writeApplicationStateGravityFromScale = (applicationState, gravityScale) => {
  const normalizedScale = normalizeBoundedNumber(
    Number(gravityScale),
    DEFAULT_GLOBAL_GRAVITY_SCALE,
    MIN_GLOBAL_GRAVITY_SCALE,
    MAX_GLOBAL_GRAVITY_SCALE
  );
  const nextMagnitude = normalizeGlobalGravityMagnitude(
    Math.abs(normalizedScale) * DEFAULT_GLOBAL_GRAVITY_MAGNITUDE
  );
  applicationState.physicsGravityDirection = nextMagnitude <= GLOBAL_GRAVITY_DIRECTION_EPSILON
    ? GLOBAL_GRAVITY_DIRECTION.ZERO_G
    : (normalizedScale < 0 ? GLOBAL_GRAVITY_DIRECTION.UP : GLOBAL_GRAVITY_DIRECTION.DOWN);
  applicationState.physicsGravityMagnitude = nextMagnitude;
  writeVec3(ensureApplicationStateCustomGravityDirection(applicationState), 0, -1, 0);
  return returnSuccess(undefined);
};

const writeApplicationStateGravityFromVector = (applicationState, gravityVector) => {
  if (!gravityVector) {
    return returnSuccess(undefined);
  }
  const vectorX = Number(gravityVector[0]);
  const vectorY = Number(gravityVector[1]);
  const vectorZ = Number(gravityVector[2]);
  if (!Number.isFinite(vectorX) || !Number.isFinite(vectorY) || !Number.isFinite(vectorZ)) {
    return returnSuccess(undefined);
  }

  const gravityMagnitude = normalizeGlobalGravityMagnitude(Math.sqrt(
    vectorX * vectorX +
    vectorY * vectorY +
    vectorZ * vectorZ
  ));
  if (gravityMagnitude <= GLOBAL_GRAVITY_DIRECTION_EPSILON) {
    applicationState.physicsGravityDirection = GLOBAL_GRAVITY_DIRECTION.ZERO_G;
    applicationState.physicsGravityMagnitude = 0;
    return returnSuccess(undefined);
  }

  const customDirection = ensureApplicationStateCustomGravityDirection(applicationState);
  writeNormalizedGravityDirection(customDirection, vectorX, vectorY, vectorZ);
  applicationState.physicsGravityDirection = GLOBAL_GRAVITY_DIRECTION.CUSTOM;
  applicationState.physicsGravityMagnitude = gravityMagnitude;
  return returnSuccess(undefined);
};

const writeApplicationStateGravityVector = (applicationState, outputVector) => {
  const gravityDirection = normalizeGlobalGravityDirection(applicationState && applicationState.physicsGravityDirection);
  const gravityMagnitude = normalizeGlobalGravityMagnitude(
    applicationState && applicationState.physicsGravityMagnitude
  );
  if (gravityDirection === GLOBAL_GRAVITY_DIRECTION.ZERO_G || gravityMagnitude <= GLOBAL_GRAVITY_DIRECTION_EPSILON) {
    return writeVec3(outputVector, 0, 0, 0);
  }
  if (gravityDirection === GLOBAL_GRAVITY_DIRECTION.UP) {
    return writeVec3(outputVector, 0, gravityMagnitude, 0);
  }
  if (gravityDirection === GLOBAL_GRAVITY_DIRECTION.CUSTOM && applicationState) {
    const customDirection = ensureApplicationStateCustomGravityDirection(applicationState);
    if (squaredLengthVec3(customDirection) <= GLOBAL_GRAVITY_DIRECTION_EPSILON * GLOBAL_GRAVITY_DIRECTION_EPSILON) {
      writeVec3(customDirection, 0, -1, 0);
    } else {
      writeNormalizeVec3(customDirection, customDirection);
    }
    return writeScaleVec3(outputVector, customDirection, gravityMagnitude);
  }
  return writeVec3(outputVector, 0, -gravityMagnitude, 0);
};

const readApplicationStateGravityScale = (applicationState) => {
  const gravityDirection = normalizeGlobalGravityDirection(applicationState && applicationState.physicsGravityDirection);
  const gravityMagnitude = normalizeGlobalGravityMagnitude(
    applicationState && applicationState.physicsGravityMagnitude
  );
  if (gravityDirection === GLOBAL_GRAVITY_DIRECTION.ZERO_G || gravityMagnitude <= GLOBAL_GRAVITY_DIRECTION_EPSILON) {
    return 0;
  }
  const gravityScale = gravityMagnitude / DEFAULT_GLOBAL_GRAVITY_MAGNITUDE;
  return gravityDirection === GLOBAL_GRAVITY_DIRECTION.UP ? -gravityScale : gravityScale;
};

const createDefaultEmissiveColor = () => createVec3(
  DEFAULT_EMISSIVE_COLOR[0],
  DEFAULT_EMISSIVE_COLOR[1],
  DEFAULT_EMISSIVE_COLOR[2]
);

const readSceneObjectEmissionEnabled = (sceneObject) => {
  if (!sceneObject) {
    return false;
  }
  if (sceneObject.isEmissionEnabled !== undefined) {
    return Boolean(sceneObject.isEmissionEnabled);
  }
  if (sceneObject.emissionEnabled !== undefined) {
    return Boolean(sceneObject.emissionEnabled);
  }
  return normalizeMaterial(sceneObject.material) === MATERIAL.EMISSIVE;
};

const hasSceneObjectCustomEmissiveSettings = (sceneObject) => {
  const emissiveColor = readSceneObjectEmissiveColor(sceneObject);
  return (
    readSceneObjectEmissiveIntensity(sceneObject) !== DEFAULT_EMISSIVE_INTENSITY ||
    emissiveColor[0] !== DEFAULT_EMISSIVE_COLOR[0] ||
    emissiveColor[1] !== DEFAULT_EMISSIVE_COLOR[1] ||
    emissiveColor[2] !== DEFAULT_EMISSIVE_COLOR[2]
  );
};

const shouldSerializeSceneObjectEmission = (sceneObject) => (
  readSceneObjectEmissionEnabled(sceneObject) ||
  normalizeMaterial(sceneObject && sceneObject.material) === MATERIAL.EMISSIVE ||
  hasSceneObjectCustomEmissiveSettings(sceneObject)
);

const normalizeEmissiveIntensity = (value) => normalizeBoundedNumber(
  Number(value),
  DEFAULT_EMISSIVE_INTENSITY,
  MIN_EMISSIVE_INTENSITY,
  MAX_EMISSIVE_INTENSITY
);

const readSceneObjectEmissiveIntensity = (sceneObject) => (
  normalizeEmissiveIntensity(sceneObject && sceneObject.emissiveIntensity)
);

const readSceneObjectEmissiveColor = (sceneObject) => {
  const emissiveColor = sceneObject && sceneObject.emissiveColor;
  return createVec3(
    normalizeBoundedNumber(Number(emissiveColor && emissiveColor[0]), DEFAULT_EMISSIVE_COLOR[0], 0, 1),
    normalizeBoundedNumber(Number(emissiveColor && emissiveColor[1]), DEFAULT_EMISSIVE_COLOR[1], 0, 1),
    normalizeBoundedNumber(Number(emissiveColor && emissiveColor[2]), DEFAULT_EMISSIVE_COLOR[2], 0, 1)
  );
};

const copySceneObjectEmissiveSettings = (sourceObject, targetObject) => {
  targetObject.emissiveColor = readSceneObjectEmissiveColor(sourceObject);
  targetObject.emissiveIntensity = readSceneObjectEmissiveIntensity(sourceObject);
  targetObject.isEmissionEnabled = readSceneObjectEmissionEnabled(sourceObject);
  return targetObject;
};

const copySceneObjectMaterialProjectionSettings = (sourceObject, targetObject) => {
  targetObject.uvProjectionMode = readSceneObjectUvProjectionMode(sourceObject);
  targetObject.uvScale = readSceneObjectUvScale(sourceObject);
  targetObject.uvBlendSharpness = readSceneObjectUvBlendSharpness(sourceObject);
  return targetObject;
};

const writeSceneObjectMaterialProjectionSettings = (
  sceneObject,
  uvProjectionMode,
  uvScale,
  uvBlendSharpness
) => {
  if (!sceneObject || !Number.isFinite(Number(sceneObject.material))) {
    return returnSuccess(undefined);
  }
  sceneObject.uvProjectionMode = normalizeMaterialUvProjectionMode(uvProjectionMode);
  sceneObject.uvScale = normalizeMaterialUvScale(uvScale);
  sceneObject.uvBlendSharpness = normalizeMaterialUvBlendSharpness(uvBlendSharpness);
  return returnSuccess(undefined);
};

const writeSceneObjectEmissiveSettings = (
  sceneObject,
  emissiveColor,
  emissiveIntensity,
  isEmissionEnabled = readSceneObjectEmissionEnabled(sceneObject)
) => {
  if (!sceneObject.emissiveColor) {
    sceneObject.emissiveColor = createDefaultEmissiveColor();
  }
  writeVec3(
    sceneObject.emissiveColor,
    normalizeBoundedNumber(Number(emissiveColor && emissiveColor[0]), DEFAULT_EMISSIVE_COLOR[0], 0, 1),
    normalizeBoundedNumber(Number(emissiveColor && emissiveColor[1]), DEFAULT_EMISSIVE_COLOR[1], 0, 1),
    normalizeBoundedNumber(Number(emissiveColor && emissiveColor[2]), DEFAULT_EMISSIVE_COLOR[2], 0, 1)
  );
  sceneObject.emissiveIntensity = normalizeEmissiveIntensity(emissiveIntensity);
  sceneObject.isEmissionEnabled = Boolean(isEmissionEnabled);
  return returnSuccess(undefined);
};

const normalizePhysicsBodyTypeValue = (bodyType) => {
  if (typeof bodyType !== 'string') {
    return null;
  }

  const normalizedBodyType = bodyType.trim().toLowerCase();
  if (normalizedBodyType === PHYSICS_BODY_TYPE.DYNAMIC) {
    return PHYSICS_BODY_TYPE.DYNAMIC;
  }
  if (normalizedBodyType === PHYSICS_BODY_TYPE.KINEMATIC) {
    return PHYSICS_BODY_TYPE.KINEMATIC;
  }
  if (
    normalizedBodyType === PHYSICS_BODY_TYPE.STATIC ||
    normalizedBodyType === PHYSICS_BODY_TYPE.FIXED
  ) {
    return PHYSICS_BODY_TYPE.STATIC;
  }
  return null;
};

const normalizePhysicsBodyType = (bodyType, fallbackBodyType = PHYSICS_BODY_TYPE.STATIC) => (
  normalizePhysicsBodyTypeValue(bodyType) ||
  normalizePhysicsBodyTypeValue(fallbackBodyType) ||
  PHYSICS_BODY_TYPE.STATIC
);

const parsePhysicsBodyType = (rawValue, fallbackBodyType) => returnSuccess(
  normalizePhysicsBodyType(rawValue, fallbackBodyType)
);

const normalizeSceneObjectMaterialGlossiness = (glossiness) => normalizeBoundedNumber(
  Number(glossiness),
  DEFAULT_MATERIAL_GLOSSINESS,
  0,
  1
);

const createSceneObjectMaterialComponent = (material = MATERIAL.DIFFUSE, glossiness = DEFAULT_MATERIAL_GLOSSINESS) => (
  new MaterialComponent({
    material: normalizeMaterial(material),
    glossiness: normalizeSceneObjectMaterialGlossiness(glossiness)
  })
);

const createSceneObjectMaterialComponentFromValues = ({
  material = MATERIAL.DIFFUSE,
  glossiness = DEFAULT_MATERIAL_GLOSSINESS,
  uvProjectionMode = DEFAULT_MATERIAL_UV_PROJECTION_MODE,
  uvScale = DEFAULT_MATERIAL_UV_SCALE,
  uvBlendSharpness = DEFAULT_MATERIAL_UV_BLEND_SHARPNESS
} = {}) => (
  new MaterialComponent({
    material: normalizeMaterial(material),
    glossiness: normalizeSceneObjectMaterialGlossiness(glossiness),
    uvProjectionMode: normalizeMaterialUvProjectionMode(uvProjectionMode),
    uvScale: normalizeMaterialUvScale(uvScale),
    uvBlendSharpness: normalizeMaterialUvBlendSharpness(uvBlendSharpness)
  })
);

const createSceneObjectPhysicsComponent = ({
  enabled = true,
  bodyType = PHYSICS_BODY_TYPE.STATIC,
  friction = 0,
  restitution = 0,
  mass = DEFAULT_PHYSICS_MASS,
  gravityScale = DEFAULT_PHYSICS_GRAVITY_SCALE,
  collideWithObjects = true,
  physicsRigidBody = null
} = {}) => (
  new PhysicsComponent({
    enabled,
    bodyType: normalizePhysicsBodyType(bodyType),
    friction: normalizeBoundedNumber(Number(friction), 0, MIN_PHYSICS_SURFACE_COEFFICIENT, MAX_PHYSICS_SURFACE_COEFFICIENT),
    restitution: normalizeBoundedNumber(Number(restitution), 0, MIN_PHYSICS_SURFACE_COEFFICIENT, MAX_PHYSICS_SURFACE_COEFFICIENT),
    mass: normalizeBoundedNumber(Number(mass), DEFAULT_PHYSICS_MASS, MIN_PHYSICS_MASS, MAX_PHYSICS_MASS),
    gravityScale: normalizeBoundedNumber(
      Number(gravityScale),
      DEFAULT_PHYSICS_GRAVITY_SCALE,
      MIN_PHYSICS_GRAVITY_SCALE,
      MAX_PHYSICS_GRAVITY_SCALE
    ),
    collideWithObjects,
    physicsRigidBody
  })
);

const readOwnDataProperty = (targetObject, propertyName) => {
  const propertyDescriptor = targetObject && Object.getOwnPropertyDescriptor(targetObject, propertyName);
  return propertyDescriptor && Object.prototype.hasOwnProperty.call(propertyDescriptor, 'value')
    ? propertyDescriptor.value
    : undefined;
};

const ensureSceneObjectMaterialComponent = (sceneObject) => {
  if (sceneObject.materialComponent instanceof MaterialComponent) {
    return sceneObject.materialComponent;
  }

  const existingComponent = sceneObject.materialComponent && typeof sceneObject.materialComponent === 'object'
    ? sceneObject.materialComponent
    : {};
  sceneObject.materialComponent = createSceneObjectMaterialComponentFromValues({
    material: existingComponent.material ?? readOwnDataProperty(sceneObject, 'material') ?? MATERIAL.DIFFUSE,
    glossiness: existingComponent.glossiness ?? readOwnDataProperty(sceneObject, 'glossiness') ?? DEFAULT_MATERIAL_GLOSSINESS,
    uvProjectionMode: (
      existingComponent.uvProjectionMode ??
      existingComponent.textureProjectionMode ??
      readOwnDataProperty(sceneObject, 'uvProjectionMode') ??
      DEFAULT_MATERIAL_UV_PROJECTION_MODE
    ),
    uvScale: (
      existingComponent.uvScale ??
      existingComponent.textureProjectionScale ??
      readOwnDataProperty(sceneObject, 'uvScale') ??
      DEFAULT_MATERIAL_UV_SCALE
    ),
    uvBlendSharpness: (
      existingComponent.uvBlendSharpness ??
      existingComponent.textureProjectionBlendSharpness ??
      readOwnDataProperty(sceneObject, 'uvBlendSharpness') ??
      DEFAULT_MATERIAL_UV_BLEND_SHARPNESS
    )
  });
  return sceneObject.materialComponent;
};

const ensureSceneObjectPhysicsComponent = (sceneObject) => {
  if (sceneObject.physicsComponent instanceof PhysicsComponent) {
    return sceneObject.physicsComponent;
  }

  const existingComponent = sceneObject.physicsComponent && typeof sceneObject.physicsComponent === 'object'
    ? sceneObject.physicsComponent
    : {};
  sceneObject.physicsComponent = createSceneObjectPhysicsComponent({
    enabled: existingComponent.enabled ?? readOwnDataProperty(sceneObject, 'isPhysicsEnabled') ?? true,
    bodyType: existingComponent.bodyType ?? readOwnDataProperty(sceneObject, 'physicsBodyType') ?? getDefaultPhysicsBodyType(sceneObject),
    friction: existingComponent.friction ?? readOwnDataProperty(sceneObject, 'physicsFriction') ?? getDefaultPhysicsFriction(sceneObject),
    restitution: existingComponent.restitution ?? readOwnDataProperty(sceneObject, 'physicsRestitution') ?? getDefaultPhysicsRestitution(sceneObject),
    mass: existingComponent.mass ?? readOwnDataProperty(sceneObject, 'physicsMass') ?? getDefaultPhysicsMass(sceneObject),
    gravityScale: existingComponent.gravityScale ?? readOwnDataProperty(sceneObject, 'physicsGravityScale') ?? getDefaultPhysicsGravityScale(sceneObject),
    collideWithObjects: existingComponent.collideWithObjects ?? readOwnDataProperty(sceneObject, 'collideWithObjects') ?? true,
    physicsRigidBody: existingComponent.physicsRigidBody ?? readOwnDataProperty(sceneObject, 'physicsRigidBody') ?? null
  });
  return sceneObject.physicsComponent;
};

const createSceneObjectComponentMap = (sceneObject, hasPhysicsComponent = false) => {
  const componentMap = {
    material: sceneObject.materialComponent
  };
  if (hasPhysicsComponent) {
    componentMap.physics = sceneObject.physicsComponent;
  }
  return componentMap;
};

const defineSceneObjectMaterialAccessors = (sceneObject) => {
  Object.defineProperties(sceneObject, {
    material: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectMaterialComponent(this).material;
      },
      set(material) {
        ensureSceneObjectMaterialComponent(this).setMaterial(normalizeMaterial(material));
      }
    },
    glossiness: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectMaterialComponent(this).glossiness;
      },
      set(glossiness) {
        ensureSceneObjectMaterialComponent(this).setGlossiness(normalizeSceneObjectMaterialGlossiness(glossiness));
      }
    },
    uvProjectionMode: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectMaterialComponent(this).uvProjectionMode;
      },
      set(mode) {
        ensureSceneObjectMaterialComponent(this).setUvProjectionMode(normalizeMaterialUvProjectionMode(mode));
      }
    },
    uvScale: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectMaterialComponent(this).uvScale;
      },
      set(scale) {
        ensureSceneObjectMaterialComponent(this).setUvScale(normalizeMaterialUvScale(scale));
      }
    },
    uvBlendSharpness: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectMaterialComponent(this).uvBlendSharpness;
      },
      set(blendSharpness) {
        ensureSceneObjectMaterialComponent(this).setUvBlendSharpness(
          normalizeMaterialUvBlendSharpness(blendSharpness)
        );
      }
    }
  });
  return sceneObject;
};

const defineSceneObjectPhysicsAccessors = (sceneObject) => {
  Object.defineProperties(sceneObject, {
    physicsRigidBody: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).physicsRigidBody;
      },
      set(rigidBody) {
        ensureSceneObjectPhysicsComponent(this).physicsRigidBody = rigidBody ?? null;
      }
    },
    isPhysicsEnabled: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).enabled;
      },
      set(isEnabled) {
        const component = ensureSceneObjectPhysicsComponent(this);
        const nextIsEnabled = Boolean(isEnabled);
        if (component.enabled !== nextIsEnabled) {
          component.enabled = nextIsEnabled;
          markSceneObjectPhysicsRebuildDirty(this);
        }
      }
    },
    physicsBodyType: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).bodyType;
      },
      set(bodyType) {
        const component = ensureSceneObjectPhysicsComponent(this);
        const nextBodyType = normalizePhysicsBodyType(bodyType, getDefaultPhysicsBodyType(this));
        if (component.bodyType !== nextBodyType) {
          component.bodyType = nextBodyType;
          markSceneObjectPhysicsRebuildDirty(this);
        }
      }
    },
    physicsFriction: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).friction;
      },
      set(friction) {
        const component = ensureSceneObjectPhysicsComponent(this);
        const nextFriction = normalizeBoundedNumber(
          Number(friction),
          getDefaultPhysicsFriction(this),
          MIN_PHYSICS_SURFACE_COEFFICIENT,
          MAX_PHYSICS_SURFACE_COEFFICIENT
        );
        if (component.friction !== nextFriction) {
          component.friction = nextFriction;
          markSceneObjectPhysicsRebuildDirty(this);
        }
      }
    },
    physicsRestitution: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).restitution;
      },
      set(restitution) {
        const component = ensureSceneObjectPhysicsComponent(this);
        const nextRestitution = normalizeBoundedNumber(
          Number(restitution),
          getDefaultPhysicsRestitution(this),
          MIN_PHYSICS_SURFACE_COEFFICIENT,
          MAX_PHYSICS_SURFACE_COEFFICIENT
        );
        if (component.restitution !== nextRestitution) {
          component.restitution = nextRestitution;
          markSceneObjectPhysicsRebuildDirty(this);
        }
      }
    },
    physicsMass: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).mass;
      },
      set(mass) {
        const component = ensureSceneObjectPhysicsComponent(this);
        const nextMass = normalizeBoundedNumber(
          Number(mass),
          getDefaultPhysicsMass(this),
          MIN_PHYSICS_MASS,
          MAX_PHYSICS_MASS
        );
        if (component.mass !== nextMass) {
          component.mass = nextMass;
          markSceneObjectPhysicsRebuildDirty(this);
        }
      }
    },
    physicsGravityScale: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).gravityScale;
      },
      set(gravityScale) {
        const component = ensureSceneObjectPhysicsComponent(this);
        const nextGravityScale = normalizeBoundedNumber(
          Number(gravityScale),
          getDefaultPhysicsGravityScale(this),
          MIN_PHYSICS_GRAVITY_SCALE,
          MAX_PHYSICS_GRAVITY_SCALE
        );
        if (component.gravityScale !== nextGravityScale) {
          component.gravityScale = nextGravityScale;
          markSceneObjectPhysicsRebuildDirty(this);
        }
      }
    },
    collideWithObjects: {
      configurable: true,
      enumerable: true,
      get() {
        return ensureSceneObjectPhysicsComponent(this).collideWithObjects;
      },
      set(collideWithObjects) {
        const component = ensureSceneObjectPhysicsComponent(this);
        const nextCollideWithObjects = Boolean(collideWithObjects);
        if (component.collideWithObjects !== nextCollideWithObjects) {
          component.collideWithObjects = nextCollideWithObjects;
          markSceneObjectPhysicsRebuildDirty(this);
        }
      }
    }
  });
  return sceneObject;
};

const readSceneObjectMaterialGlossiness = (sceneObject) => (
  normalizeSceneObjectMaterialGlossiness(sceneObject && sceneObject.glossiness)
);

const formatColorAdjustmentValue = (value) => value.toFixed(2);

const formatSignedColorAdjustmentValue = (value) => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
};

const formatLightIntensityValue = (value) => value.toFixed(2);

const formatCameraEffectValue = (value) => value.toFixed(2);
const formatCameraFieldOfViewValue = (value) => `${Math.round(value)} deg`;

const formatCompactMetricValue = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '...';
  }
  if (value >= 1000000000) {
    return `${(value / 1000000000).toFixed(2)}B`;
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return String(Math.round(value));
};

const formatBenchmarkRateValue = (value) => {
  const compactValue = formatCompactMetricValue(value);
  return compactValue === '...' ? compactValue : `${compactValue}/s`;
};

const formatBandwidthValue = (bytesPerSecond) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '...';
  }
  if (bytesPerSecond >= BYTES_PER_TERABYTE) {
    return `${(bytesPerSecond / BYTES_PER_TERABYTE).toFixed(2)} TB/s`;
  }
  if (bytesPerSecond >= BYTES_PER_GIGABYTE) {
    const gigabytesPerSecond = bytesPerSecond / BYTES_PER_GIGABYTE;
    return `${gigabytesPerSecond >= 100 ? Math.round(gigabytesPerSecond) : gigabytesPerSecond.toFixed(1)} GB/s`;
  }
  if (bytesPerSecond >= BYTES_PER_MEGABYTE) {
    const megabytesPerSecond = bytesPerSecond / BYTES_PER_MEGABYTE;
    return `${megabytesPerSecond >= 100 ? Math.round(megabytesPerSecond) : megabytesPerSecond.toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
};

const formatByteSizeValue = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '...';
  }
  if (bytes >= BYTES_PER_TERABYTE) {
    return `${(bytes / BYTES_PER_TERABYTE).toFixed(2)} TB`;
  }
  if (bytes >= BYTES_PER_GIGABYTE) {
    const gigabytes = bytes / BYTES_PER_GIGABYTE;
    return `${gigabytes >= 100 ? Math.round(gigabytes) : gigabytes.toFixed(1)} GB`;
  }
  if (bytes >= BYTES_PER_MEGABYTE) {
    const megabytes = bytes / BYTES_PER_MEGABYTE;
    return `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
  }
  return `${Math.round(bytes)} B`;
};

const formatFramesPerSecondValue = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '...';
  }
  if (value >= 100) {
    return String(Math.round(value));
  }
  return value.toFixed(1);
};

const formatBenchmarkMilliseconds = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '...';
  }
  return `${value.toFixed(2)} ms`;
};

const isPausedBenchmarkSource = (measurementSource) => (
  measurementSource === 'frame-paused' ||
  measurementSource === 'rays-paused'
);

const formatPausedAwareCompactMetricValue = (value, shouldShowPausedZero) => {
  if (shouldShowPausedZero && Number.isFinite(value) && value === 0) {
    return '0';
  }
  return formatCompactMetricValue(value);
};

const formatPausedAwareBenchmarkRateValue = (value, shouldShowPausedZero) => {
  if (shouldShowPausedZero && Number.isFinite(value) && value === 0) {
    return '0/s';
  }
  return formatBenchmarkRateValue(value);
};

const formatPausedAwareBandwidthValue = (value, shouldShowPausedZero) => {
  if (shouldShowPausedZero && Number.isFinite(value) && value === 0) {
    return '0 B/s';
  }
  return formatBandwidthValue(value);
};

const formatPausedAwareFramesPerSecondValue = (value, shouldShowPausedZero) => {
  if (shouldShowPausedZero && Number.isFinite(value) && value === 0) {
    return '0';
  }
  return formatFramesPerSecondValue(value);
};

const formatPausedAwareBenchmarkMilliseconds = (value, shouldShowPausedZero) => {
  if (shouldShowPausedZero && Number.isFinite(value) && value === 0) {
    return '0.00 ms';
  }
  return formatBenchmarkMilliseconds(value);
};

const formatBenchmarkSampleCountValue = (value) => {
  if (Number.isFinite(value) && value === 0) {
    return '0';
  }
  return formatCompactMetricValue(value);
};

const formatBenchmarkConvergenceValue = (benchmarkSnapshot) => {
  const sampleCount = benchmarkSnapshot.accumulatedSamples;
  const targetSampleCount = benchmarkSnapshot.convergenceSampleCount;
  if (!Number.isFinite(targetSampleCount) || targetSampleCount <= 0) {
    return 'Off';
  }
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    return '0%';
  }
  if (sampleCount >= targetSampleCount) {
    return benchmarkSnapshot.isConvergencePaused ? 'Paused' : 'Ready';
  }
  return `${Math.round(clampNumber(sampleCount / targetSampleCount, 0, 1) * 100)}%`;
};

const formatBenchmarkSceneComplexityValue = (benchmarkSnapshot) => {
  if (!Number.isFinite(benchmarkSnapshot.sceneComplexityScore) || benchmarkSnapshot.sceneComplexityScore <= 0) {
    return '...';
  }
  return `${Math.round(benchmarkSnapshot.sceneComplexityScore)} ${benchmarkSnapshot.sceneComplexityLabel}`;
};

const calculatePerformanceScore = (benchmarkSnapshot) => {
  if (benchmarkSnapshot.scoreSampleCount < PERFORMANCE_SCORE_READY_TRACE_SAMPLE_COUNT) {
    return 0;
  }

  const rayScore = calculatePerformanceScoreRaysPerSecond(benchmarkSnapshot) / PERFORMANCE_SCORE_RAYS_PER_SECOND_UNIT;
  return Math.max(0, Math.round(rayScore / PERFORMANCE_SCORE_QUANTUM) * PERFORMANCE_SCORE_QUANTUM);
};

const shouldNormalizePerformanceScoreForRenderResolution = (measurementSource) => (
  measurementSource === 'frame-estimate' ||
  measurementSource === 'frame-estimate-pending'
);

const calculatePerformanceScoreRaysPerSecond = (benchmarkSnapshot) => {
  const activeRaysPerSecond = Number.isFinite(benchmarkSnapshot.activeRaysPerSecond)
    ? benchmarkSnapshot.activeRaysPerSecond
    : 0;
  if (!shouldNormalizePerformanceScoreForRenderResolution(benchmarkSnapshot.measurementSource)) {
    return activeRaysPerSecond;
  }

  const renderPixelCount = Number.isFinite(benchmarkSnapshot.renderPixelCount) && benchmarkSnapshot.renderPixelCount > 0
    ? benchmarkSnapshot.renderPixelCount
    : ACTIVE_RAYS_PER_SAMPLE;
  return activeRaysPerSecond * PERFORMANCE_SCORE_REFERENCE_RENDER_PIXELS / renderPixelCount;
};

const calculateTraceMemoryBytesPerSample = (webGlContext, textureType) => {
  const bytesPerPixel = textureType === webGlContext.FLOAT
    ? BYTES_PER_FLOAT_RGBA_PIXEL
    : (textureType === HALF_FLOAT_TEXTURE_TYPE ? BYTES_PER_HALF_FLOAT_RGBA_PIXEL : BYTES_PER_RGBA_PIXEL);
  return bytesPerPixel * TRACE_ACCUMULATION_TEXTURE_TRANSFERS_PER_SAMPLE;
};

const calculateRenderTextureBytes = (webGlContext, textureType) => {
  const bytesPerPixel = textureType === webGlContext.FLOAT
    ? BYTES_PER_FLOAT_RGBA_PIXEL
    : (textureType === HALF_FLOAT_TEXTURE_TYPE ? BYTES_PER_HALF_FLOAT_RGBA_PIXEL : BYTES_PER_RGBA_PIXEL);
  return CANVAS_RENDER_WIDTH * CANVAS_RENDER_HEIGHT * bytesPerPixel;
};

const calculateEstimatedGpuBufferMemoryBytes = (webGlContext, textureType) => (
  calculateRenderTextureBytes(webGlContext, textureType) * PATH_TRACER_RENDER_TEXTURE_COUNT +
  SKY_TEXTURE_WIDTH * SKY_TEXTURE_HEIGHT * BYTES_PER_RGBA_PIXEL +
  MATERIAL_ALBEDO_TEXTURE_SIZE * MATERIAL_ALBEDO_TEXTURE_SIZE * BYTES_PER_RGBA_PIXEL +
  PATH_TRACER_VERTEX_BUFFER_BYTES
);

const readRenderTextureTypes = (webGlContext) => {
  const textureTypes = [];
  if (webGlContext.getExtension('OES_texture_float')) {
    textureTypes.push(webGlContext.FLOAT);
  }
  const halfFloatTextureExtension = webGlContext.getExtension('OES_texture_half_float');
  if (
    halfFloatTextureExtension &&
    typeof halfFloatTextureExtension.HALF_FLOAT_OES === 'number'
  ) {
    textureTypes.push(halfFloatTextureExtension.HALF_FLOAT_OES);
  }
  textureTypes.push(webGlContext.UNSIGNED_BYTE);
  return textureTypes;
};

const writeIdentityMat4 = (matrix) => {
  matrix.fill(0);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  return matrix;
};

const createIdentityMat4 = () => writeIdentityMat4(createMat4());

const writeMultiplyMat4 = (outputMatrix, leftMatrix, rightMatrix) => {
  const a00 = leftMatrix[0];
  const a01 = leftMatrix[1];
  const a02 = leftMatrix[2];
  const a03 = leftMatrix[3];
  const a10 = leftMatrix[4];
  const a11 = leftMatrix[5];
  const a12 = leftMatrix[6];
  const a13 = leftMatrix[7];
  const a20 = leftMatrix[8];
  const a21 = leftMatrix[9];
  const a22 = leftMatrix[10];
  const a23 = leftMatrix[11];
  const a30 = leftMatrix[12];
  const a31 = leftMatrix[13];
  const a32 = leftMatrix[14];
  const a33 = leftMatrix[15];

  const b00 = rightMatrix[0];
  const b01 = rightMatrix[1];
  const b02 = rightMatrix[2];
  const b03 = rightMatrix[3];
  const b10 = rightMatrix[4];
  const b11 = rightMatrix[5];
  const b12 = rightMatrix[6];
  const b13 = rightMatrix[7];
  const b20 = rightMatrix[8];
  const b21 = rightMatrix[9];
  const b22 = rightMatrix[10];
  const b23 = rightMatrix[11];
  const b30 = rightMatrix[12];
  const b31 = rightMatrix[13];
  const b32 = rightMatrix[14];
  const b33 = rightMatrix[15];

  outputMatrix[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
  outputMatrix[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
  outputMatrix[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
  outputMatrix[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
  outputMatrix[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
  outputMatrix[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
  outputMatrix[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
  outputMatrix[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
  outputMatrix[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
  outputMatrix[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
  outputMatrix[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
  outputMatrix[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
  outputMatrix[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
  outputMatrix[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
  outputMatrix[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
  outputMatrix[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;

  return outputMatrix;
};

const writeInvertMat4 = (outputMatrix, matrix) => {
  const a00 = matrix[0];
  const a01 = matrix[1];
  const a02 = matrix[2];
  const a03 = matrix[3];
  const a10 = matrix[4];
  const a11 = matrix[5];
  const a12 = matrix[6];
  const a13 = matrix[7];
  const a20 = matrix[8];
  const a21 = matrix[9];
  const a22 = matrix[10];
  const a23 = matrix[11];
  const a30 = matrix[12];
  const a31 = matrix[13];
  const a32 = matrix[14];
  const a33 = matrix[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (determinant === 0) {
    return returnFailure('matrix-not-invertible', 'Camera matrix cannot be inverted.');
  }

  const inverseDeterminant = 1 / determinant;

  outputMatrix[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant;
  outputMatrix[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant;
  outputMatrix[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant;
  outputMatrix[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant;
  outputMatrix[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant;
  outputMatrix[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant;
  outputMatrix[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant;
  outputMatrix[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant;
  outputMatrix[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant;
  outputMatrix[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant;
  outputMatrix[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant;
  outputMatrix[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant;
  outputMatrix[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant;
  outputMatrix[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant;
  outputMatrix[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant;
  outputMatrix[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant;

  return returnSuccess(undefined);
};

const writeEyeRayVector = (outputVector, inverseCameraMatrix, clipX, clipY, eyePosition) => {
  const transformedX = (
    inverseCameraMatrix[0] * clipX +
    inverseCameraMatrix[4] * clipY +
    inverseCameraMatrix[12]
  );
  const transformedY = (
    inverseCameraMatrix[1] * clipX +
    inverseCameraMatrix[5] * clipY +
    inverseCameraMatrix[13]
  );
  const transformedZ = (
    inverseCameraMatrix[2] * clipX +
    inverseCameraMatrix[6] * clipY +
    inverseCameraMatrix[14]
  );
  const transformedW = (
    inverseCameraMatrix[3] * clipX +
    inverseCameraMatrix[7] * clipY +
    inverseCameraMatrix[15]
  );
  const inverseW = 1 / transformedW;
  outputVector[0] = transformedX * inverseW - eyePosition[0];
  outputVector[1] = transformedY * inverseW - eyePosition[1];
  outputVector[2] = transformedZ * inverseW - eyePosition[2];
  return outputVector;
};

const writeCameraRayBasis = (
  centerRay,
  clipXRay,
  clipYRay,
  inverseCameraMatrix,
  eyePosition
) => {
  writeEyeRayVector(centerRay, inverseCameraMatrix, 0, 0, eyePosition);
  writeEyeRayVector(clipXRay, inverseCameraMatrix, 1, 0, eyePosition);
  writeSubtractVec3(clipXRay, clipXRay, centerRay);
  writeEyeRayVector(clipYRay, inverseCameraMatrix, 0, 1, eyePosition);
  writeSubtractVec3(clipYRay, clipYRay, centerRay);
};

const writeLookAtMat4 = (
  outputMatrix,
  eyePosition,
  targetPosition,
  upDirection,
  xAxis,
  yAxis,
  zAxis
) => {
  writeSubtractVec3(zAxis, eyePosition, targetPosition);
  writeNormalizeVec3(zAxis, zAxis);
  writeCrossVec3(xAxis, upDirection, zAxis);
  writeNormalizeVec3(xAxis, xAxis);
  writeCrossVec3(yAxis, zAxis, xAxis);

  if (squaredLengthVec3(xAxis) === 0 || squaredLengthVec3(yAxis) === 0 || squaredLengthVec3(zAxis) === 0) {
    return returnFailure('invalid-camera-basis', 'Camera basis vectors are invalid.');
  }

  outputMatrix[0] = xAxis[0];
  outputMatrix[1] = yAxis[0];
  outputMatrix[2] = zAxis[0];
  outputMatrix[3] = 0;
  outputMatrix[4] = xAxis[1];
  outputMatrix[5] = yAxis[1];
  outputMatrix[6] = zAxis[1];
  outputMatrix[7] = 0;
  outputMatrix[8] = xAxis[2];
  outputMatrix[9] = yAxis[2];
  outputMatrix[10] = zAxis[2];
  outputMatrix[11] = 0;
  outputMatrix[12] = -dotVec3(xAxis, eyePosition);
  outputMatrix[13] = -dotVec3(yAxis, eyePosition);
  outputMatrix[14] = -dotVec3(zAxis, eyePosition);
  outputMatrix[15] = 1;

  return returnSuccess(undefined);
};

const readCameraFieldScale = (fieldOfViewDegrees) => {
  const normalizedFieldOfViewDegrees = normalizeBoundedNumber(
    fieldOfViewDegrees,
    DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES,
    MIN_CAMERA_FIELD_OF_VIEW_DEGREES,
    MAX_CAMERA_FIELD_OF_VIEW_DEGREES
  );
  return 1 / Math.tan((normalizedFieldOfViewDegrees * Math.PI / 180) / 2);
};

const writeCameraProjectionMat4 = (outputMatrix, fieldOfViewDegrees = DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES) => {
  const cameraFieldScale = readCameraFieldScale(fieldOfViewDegrees);
  outputMatrix[0] = cameraFieldScale / CANVAS_ASPECT_RATIO;
  outputMatrix[1] = 0;
  outputMatrix[2] = 0;
  outputMatrix[3] = 0;
  outputMatrix[4] = 0;
  outputMatrix[5] = cameraFieldScale;
  outputMatrix[6] = 0;
  outputMatrix[7] = 0;
  outputMatrix[8] = 0;
  outputMatrix[9] = 0;
  outputMatrix[10] = (CAMERA_FAR_PLANE + CAMERA_NEAR_PLANE) * CAMERA_NEAR_FAR_RANGE;
  outputMatrix[11] = -1;
  outputMatrix[12] = 0;
  outputMatrix[13] = 0;
  outputMatrix[14] = 2 * CAMERA_FAR_PLANE * CAMERA_NEAR_PLANE * CAMERA_NEAR_FAR_RANGE;
  outputMatrix[15] = 0;
};

const normalizeCameraMode = (cameraMode) => (
  cameraMode === CAMERA_MODE_FPS ? CAMERA_MODE_FPS : CAMERA_MODE_ORBIT
);

const writeOrbitEyePosition = (outputVector, cameraAngleX, cameraAngleY, cameraDistance) => {
  const sinCameraAngleX = Math.sin(cameraAngleX);
  const cosCameraAngleX = Math.cos(cameraAngleX);
  const sinCameraAngleY = Math.sin(cameraAngleY);
  const cosCameraAngleY = Math.cos(cameraAngleY);
  return writeVec3(
    outputVector,
    cameraDistance * sinCameraAngleY * cosCameraAngleX,
    cameraDistance * sinCameraAngleX,
    cameraDistance * cosCameraAngleY * cosCameraAngleX
  );
};

const writeFpsCameraForward = (outputVector, cameraAngleX, cameraAngleY) => {
  const sinCameraAngleX = Math.sin(cameraAngleX);
  const cosCameraAngleX = Math.cos(cameraAngleX);
  const sinCameraAngleY = Math.sin(cameraAngleY);
  const cosCameraAngleY = Math.cos(cameraAngleY);
  return writeVec3(
    outputVector,
    -sinCameraAngleY * cosCameraAngleX,
    -sinCameraAngleX,
    -cosCameraAngleY * cosCameraAngleX
  );
};

const writeFpsCameraTarget = (outputVector, eyePosition, cameraAngleX, cameraAngleY) => {
  writeFpsCameraForward(outputVector, cameraAngleX, cameraAngleY);
  outputVector[0] += eyePosition[0];
  outputVector[1] += eyePosition[1];
  outputVector[2] += eyePosition[2];
  return outputVector;
};

const readFpsCameraAnglesFromEyeTarget = (eyePosition, targetPosition) => {
  const deltaX = targetPosition[0] - eyePosition[0];
  const deltaY = targetPosition[1] - eyePosition[1];
  const deltaZ = targetPosition[2] - eyePosition[2];
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  if (distance <= Number.EPSILON) {
    return Object.freeze({
      cameraAngleX: 0,
      cameraAngleY: 0,
      cameraDistance: 0
    });
  }

  const forwardX = deltaX / distance;
  const forwardY = deltaY / distance;
  const forwardZ = deltaZ / distance;
  const cameraAngleX = Math.asin(clampNumber(-forwardY, -1, 1));
  const cosCameraAngleX = Math.cos(cameraAngleX);
  const cameraAngleY = Math.abs(cosCameraAngleX) > Number.EPSILON
    ? Math.atan2(-forwardX / cosCameraAngleX, -forwardZ / cosCameraAngleX)
    : 0;

  return Object.freeze({
    cameraAngleX,
    cameraAngleY,
    cameraDistance: distance
  });
};

const readHaltonBase2 = (sequenceIndex) => {
  let reversedBits = sequenceIndex >>> 0;
  reversedBits = ((reversedBits << 16) | (reversedBits >>> 16)) >>> 0;
  reversedBits = (((reversedBits & 0x00ff00ff) << 8) | ((reversedBits & 0xff00ff00) >>> 8)) >>> 0;
  reversedBits = (((reversedBits & 0x0f0f0f0f) << 4) | ((reversedBits & 0xf0f0f0f0) >>> 4)) >>> 0;
  reversedBits = (((reversedBits & 0x33333333) << 2) | ((reversedBits & 0xcccccccc) >>> 2)) >>> 0;
  reversedBits = (((reversedBits & 0x55555555) << 1) | ((reversedBits & 0xaaaaaaaa) >>> 1)) >>> 0;
  return reversedBits * UINT32_RECIPROCAL;
};

const readHaltonBase3 = (sequenceIndex) => {
  let currentIndex = sequenceIndex;
  let inverseBase = HALTON_BASE_3_RECIPROCAL;
  let haltonValue = 0;

  while (currentIndex > 0) {
    const digit = currentIndex % 3;
    haltonValue += digit * inverseBase;
    currentIndex = (currentIndex / 3) | 0;
    inverseBase *= HALTON_BASE_3_RECIPROCAL;
  }

  return haltonValue;
};

const createRayJitterValues = () => {
  const jitterValues = new Float32Array(RANDOM_SAMPLE_SEQUENCE_WRAP * RAY_JITTER_COMPONENT_COUNT);
  for (let sequenceIndex = 1; sequenceIndex <= RANDOM_SAMPLE_SEQUENCE_WRAP; sequenceIndex += 1) {
    const valueIndex = (sequenceIndex - 1) * RAY_JITTER_COMPONENT_COUNT;
    jitterValues[valueIndex] = (readHaltonBase2(sequenceIndex) * 2 - 1) * CANVAS_SIZE_RECIPROCAL_X;
    jitterValues[valueIndex + 1] = (readHaltonBase3(sequenceIndex) * 2 - 1) * CANVAS_SIZE_RECIPROCAL_Y;
  }
  return jitterValues;
};

const RAY_JITTER_VALUES = createRayJitterValues();

const writeRayJitterUniformValues = (uniformValues, sampleSequence) => {
  const sequenceIndex = sampleSequence + 1;
  const valueIndex = (sequenceIndex - 1) * RAY_JITTER_COMPONENT_COUNT;
  uniformValues.rayJitterX = RAY_JITTER_VALUES[valueIndex];
  uniformValues.rayJitterY = RAY_JITTER_VALUES[valueIndex + 1];
};

const joinObjectShaderCode = (sceneObjects, readShaderCode) => {
  const shaderParts = [];
  for (const sceneObject of sceneObjects) {
    if (!isRenderableSceneObject(sceneObject)) {
      continue;
    }
    shaderParts.push(readShaderCode(sceneObject));
  }
  return shaderParts.join('');
};

const sceneUsesCubeShadowTests = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    if (sceneObject instanceof CubeSceneObject && !isTransparentMaterial(sceneObject.material)) {
      return true;
    }
  }
  return false;
};

const sceneUsesSphereObjects = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    if (sceneObject instanceof SphereSceneObject) {
      return true;
    }
  }
  return false;
};

const sceneUsesSphereShadowTests = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    if (sceneObject instanceof SphereSceneObject && !isTransparentMaterial(sceneObject.material)) {
      return true;
    }
  }
  return false;
};

const sceneUsesSdfShadowTests = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    if (sceneObject instanceof SdfSceneObject && !isTransparentMaterial(sceneObject.material)) {
      return true;
    }
  }
  return false;
};

const createShadowShaderSource = (sceneObjects) => [
  'float shadow(vec3 origin, vec3 ray) {',
  sceneUsesCubeShadowTests(sceneObjects) || sceneUsesSdfShadowTests(sceneObjects) ? '  vec3 inverseRay = 1.0 / ray;' : '',
  sceneUsesSphereShadowTests(sceneObjects) ? '  float inverseRayLengthSquared = 1.0 / dot(ray, ray);' : '',
  joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getShadowTestCode()),
  '  return 1.0;',
  '}'
].join('');

const displayTemporalAntialiasingSource = [
  'vec3 rgbToYCoCg(vec3 color) {',
  '  float chromaOrange = color.r - color.b;',
  '  float temporaryBlue = color.b + chromaOrange * 0.5;',
  '  float chromaGreen = color.g - temporaryBlue;',
  '  float luminance = temporaryBlue + chromaGreen * 0.5;',
  '  return vec3(luminance, chromaOrange, chromaGreen);',
  '}',
  'vec3 ycocgToRgb(vec3 color) {',
  '  float temporaryBlue = color.x - color.z * 0.5;',
  '  float green = color.z + temporaryBlue;',
  '  float blue = temporaryBlue - color.y * 0.5;',
  '  float red = blue + color.y;',
  '  return vec3(red, green, blue);',
  '}',
  'vec3 readCurrentFrameColor(vec2 texCoord) {',
  '  return texture2D(texture, texCoord).rgb;',
  '}',
  'vec3 readDisplayHistoryColor(vec2 texCoord) {',
  '  return texture2D(displayHistoryTexture, texCoord).rgb;',
  '}',
  'float colorMetricYCoCg(vec3 leftYCoCg, vec3 rightYCoCg) {',
  '  float luminanceScale = max(max(leftYCoCg.x, rightYCoCg.x), 0.05);',
  '  vec2 chromaDelta = abs(leftYCoCg.yz - rightYCoCg.yz);',
  '  return abs(leftYCoCg.x - rightYCoCg.x) / luminanceScale + (chromaDelta.x + chromaDelta.y) * 0.25;',
  '}',
  'void includeNeighborhoodSample(vec2 texCoord, float spatialWeight, vec3 centerYCoCg, inout vec3 colorSum, inout float weightSum, inout vec3 minYCoCg, inout vec3 maxYCoCg) {',
  '  vec3 sampleColor = readCurrentFrameColor(texCoord);',
  '  vec3 sampleYCoCg = rgbToYCoCg(sampleColor);',
  '  float sampleDistance = colorMetricYCoCg(centerYCoCg, sampleYCoCg);',
  '  float sampleWeight = spatialWeight / (1.0 + sampleDistance * sampleDistance * 18.0);',
  '  colorSum += sampleColor * sampleWeight;',
  '  weightSum += sampleWeight;',
  '  minYCoCg = min(minYCoCg, sampleYCoCg);',
  '  maxYCoCg = max(maxYCoCg, sampleYCoCg);',
  '}',
  'vec3 resolveTemporalAntialiasing(vec2 texCoord) {',
  '  vec3 currentColor = readCurrentFrameColor(texCoord);',
  '  if(historyAvailability <= 0.5 && denoiserStrength <= 0.0001) return currentColor;',
  '  vec3 currentYCoCg = rgbToYCoCg(currentColor);',
  '  float currentLuminance = max(currentYCoCg.x, 0.0001);',
  '  vec3 minYCoCg = currentYCoCg;',
  '  vec3 maxYCoCg = currentYCoCg;',
  '  vec3 colorSum = currentColor;',
  '  float weightSum = 1.0;',
  `  vec2 pixelStep = vec2(1.0 / ${CANVAS_RENDER_WIDTH}.0, 1.0 / ${CANVAS_RENDER_HEIGHT}.0);`,
  '  includeNeighborhoodSample(texCoord + vec2(-pixelStep.x, 0.0), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(pixelStep.x, 0.0), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(0.0, -pixelStep.y), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(0.0, pixelStep.y), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(-pixelStep.x, -pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(pixelStep.x, -pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(-pixelStep.x, pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(pixelStep.x, pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  vec3 filteredColor = colorSum / max(weightSum, 0.0001);',
  '  float edgeMetric = colorMetricYCoCg(currentYCoCg, rgbToYCoCg(filteredColor));',
  '  float edgeAmount = smoothstep(0.10, 0.45, edgeMetric);',
  '  float temporalDenoiseAmount = smoothstep(1.0, 32.0, temporalBlendFrames) * denoiserStrength;',
  '  float currentStabilizationAmount = clamp(temporalDenoiseAmount * (0.65 - edgeAmount * 0.45), 0.0, 0.75);',
  '  vec3 stabilizedCurrentColor = mix(currentColor, filteredColor, currentStabilizationAmount);',
  '  float stabilizedLuminance = max(rgbToYCoCg(stabilizedCurrentColor).x, 0.0001);',
  '  stabilizedCurrentColor *= clamp(currentLuminance / stabilizedLuminance, 0.5, 2.0);',
  '  vec3 stabilizedCurrentYCoCg = rgbToYCoCg(stabilizedCurrentColor);',
  '  float temporalWindow = clamp((temporalBlendFrames - 1.0) / max(temporalBlendFrames, 1.0), 0.0, 0.96875);',
  '  float motionBlend = clamp(motionBlurStrength, 0.0, 0.95) * historyAvailability;',
  '  if(historyAvailability <= 0.5 || (temporalWindow <= 0.0001 && motionBlend <= 0.0001)) return stabilizedCurrentColor;',
  '  vec3 historyColor = readDisplayHistoryColor(texCoord);',
  '  vec3 historyYCoCg = rgbToYCoCg(historyColor);',
  '  vec3 clipPadding = vec3(0.035, 0.08, 0.08) + vec3(edgeAmount * 0.08);',
  '  vec3 clippedHistoryYCoCg = clamp(historyYCoCg, minYCoCg - clipPadding, maxYCoCg + clipPadding);',
  '  vec3 clippedHistoryColor = ycocgToRgb(clippedHistoryYCoCg);',
  '  float ageRamp = smoothstep(0.0, 1.0, temporalFrameAge);',
  '  float historyDelta = colorMetricYCoCg(clippedHistoryYCoCg, stabilizedCurrentYCoCg);',
  '  float historyRejection = smoothstep(0.12, 0.55, historyDelta);',
  '  float historyWeight = temporalWindow * historyAvailability * ageRamp;',
  '  historyWeight *= mix(1.0, 0.45, edgeAmount);',
  '  historyWeight *= 1.0 - historyRejection * 0.85;',
  '  vec3 antialiasedColor = mix(stabilizedCurrentColor, clippedHistoryColor, historyWeight);',
  '  vec3 temporallyFilteredColor = mix(antialiasedColor, historyColor, motionBlend);',
  '  float targetLuminance = max(stabilizedCurrentYCoCg.x, 0.0001);',
  '  float filteredLuminance = max(rgbToYCoCg(temporallyFilteredColor).x, 0.0001);',
  '  float luminanceCorrection = clamp(targetLuminance / filteredLuminance, 0.5, 2.0);',
  '  float luminancePreservation = clamp(historyWeight + motionBlend, 0.0, 1.0);',
  '  return temporallyFilteredColor * mix(1.0, luminanceCorrection, luminancePreservation);',
  '}'
].join('');

const temporalDisplayFragmentSource = [
  'precision highp float;',
  'varying vec2 texCoord;',
  'uniform sampler2D texture;',
  'uniform sampler2D displayHistoryTexture;',
  'uniform float temporalBlendFrames;',
  'uniform float temporalFrameAge;',
  'uniform float historyAvailability;',
  'uniform float motionBlurStrength;',
  'uniform float denoiserStrength;',
  displayTemporalAntialiasingSource,
  'void main() {',
  '  gl_FragColor = vec4(max(resolveTemporalAntialiasing(texCoord), vec3(0.0)), 1.0);',
  '}'
].join('');

const cameraFocusSource = [
  'vec2 randomApertureDisk(float seed) {',
  '  float angle = 6.283185307179586 * random(vec3(92.271, 41.347, 17.113), seed);',
  '  float radius = sqrt(random(vec3(13.711, 61.173, 83.497), seed + 29.0)) * cameraAperture;',
  '  return vec2(cos(angle), sin(angle)) * radius;',
  '}',
  'void applyCameraFocus(inout vec3 rayOrigin, inout vec3 rayDirection) {',
  '  if(cameraAperture <= 0.00001) return;',
  '  vec3 focusPoint = rayOrigin + normalize(rayDirection) * max(cameraFocusDistance, 0.01);',
  '  vec2 lensOffset = randomApertureDisk(sampleSeed + 211.0);',
  '  rayOrigin += cameraRight * lensOffset.x + cameraUp * lensOffset.y;',
  '  rayDirection = focusPoint - rayOrigin;',
  '}'
].join('');

const createCalculateColorShaderSource = (sceneObjects, renderSettings) => {
  const environmentSource = renderSettings.environment === ENVIRONMENT.RED_GREEN_CORNELL_BOX
    ? redGreenCornellBoxSource
    : yellowBlueCornellBoxSource;
  const isOpenSkyEnvironment = renderSettings.environment === ENVIRONMENT.OPEN_SKY_STUDIO;
  const isFogEnabled = renderSettings.fogDensity > 0.0001;
  const hasHeterogeneousFogMaterial = sceneUsesMaterial(sceneObjects, MATERIAL.HETEROGENEOUS_FOG);
  const hasSphereObjects = sceneUsesSphereObjects(sceneObjects);
  const lightBounceCount = normalizeBoundedInteger(
    renderSettings.lightBounceCount,
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  const roomOpenSource = isOpenSkyEnvironment
    ? '      if(roomNormal.y > 0.5) roomDistance = tRoom.y;'
    : '      roomDistance = tRoom.y;';
  const missSource = isOpenSkyEnvironment
    ? '      accumulatedColor += colorMask * sampleEnvironmentSky(ray);'
    : '';
  const fogSource = isFogEnabled
    ? hasHeterogeneousFogMaterial
      ? [
        '    if(fogDensity > 0.0001) {',
        `      float fogDistance = t == ${SHADER_INFINITY} ? 6.0 : min(t * length(ray), 6.0);`,
        '      float fogStepLength = fogDistance / 8.0;',
        '      float fogOpticalDepth = 0.0;',
        '      float fogLightScatter = 0.0;',
        '      vec3 fogRayDirection = normalize(ray);',
        '      for(int fogStep = 0; fogStep < 8; fogStep++) {',
        '        float fogStepJitter = random(vec3(17.9, 43.3, 71.7), sampleSeed + float(fogStep) * 11.0);',
        '        float fogTravel = (float(fogStep) + fogStepJitter) * fogStepLength;',
        '        vec3 fogSamplePoint = origin + fogRayDirection * fogTravel;',
        '        float fogLocalDensity = shaderHeterogeneousFogDensity(fogSamplePoint + vec3(0.0, sampleSeed * 0.007, 0.0)) * fogDensity;',
        '        fogOpticalDepth += fogLocalDensity * fogStepLength;',
        '        vec3 fogToLight = normalize(light - fogSamplePoint);',
        '        float fogForward = max(dot(fogToLight, -fogRayDirection), 0.0);',
        '        fogLightScatter += fogLocalDensity * (0.15 + fogForward * fogForward * fogForward * fogForward) * fogStepLength;',
        '      }',
        '      float viewTransmittance = exp(-fogOpticalDepth);',
        '      float fogAmount = 1.0 - viewTransmittance;',
        '      accumulatedColor += colorMask * sampleEnvironmentSky(ray) * fogAmount * 0.28;',
        '      accumulatedColor += colorMask * lightColor * fogLightScatter * lightIntensity * 0.52;',
        '      colorMask *= viewTransmittance;',
        '    }'
      ].join('')
      : [
        '    if(fogDensity > 0.0001) {',
        `      float fogDistance = t == ${SHADER_INFINITY} ? 6.0 : min(t * length(ray), 6.0);`,
        '      float viewTransmittance = fogTransmittance(fogDistance);',
        '      float fogAmount = 1.0 - viewTransmittance;',
        '      accumulatedColor += colorMask * sampleEnvironmentSky(ray) * fogAmount * 0.35;',
        '      colorMask *= viewTransmittance;',
        '    }'
      ].join('')
    : '';

  return [
    'vec3 calculateColor(vec3 origin, vec3 ray, vec3 light) {',
    '  vec3 colorMask = vec3(1.0);',
    '  vec3 accumulatedColor = vec3(0.0);',
    `  for(int bounce = 0; bounce < ${lightBounceCount}; bounce++) {`,
    '    if(float(bounce) >= activeLightBounceCount) break;',
    '    vec3 inverseRay = 1.0 / ray;',
    '    vec2 tRoom = intersectCube(origin, inverseRay, roomCubeMin, roomCubeMax);',
    `    float roomDistance = ${SHADER_INFINITY};`,
    '    vec3 roomHit = vec3(0.0);',
    '    vec3 roomNormal = vec3(0.0);',
    '    if(tRoom.x < tRoom.y) {',
    '      roomHit = origin + ray * tRoom.y;',
    '      roomNormal = -normalForCube(roomHit, roomCubeMin, roomCubeMax);',
    roomOpenSource,
    '    }',
    hasSphereObjects ? '    float rayLengthSquared = dot(ray, ray);' : '',
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getIntersectCode()),
    '    float t = roomDistance;',
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getMinimumIntersectCode()),
    fogSource,
    '    vec3 hit = origin + ray * t;',
    '    vec3 surfaceColor = vec3(0.75);',
    '    float specularHighlight = 0.0;',
    '    float surfaceLightResponse = 1.0;',
    sceneUsesSurfaceShaderUtilities(sceneObjects) ? '    vec3 surfaceObjectPoint;' : '',
    '    vec3 normal;',
    '    vec3 debugViewRay = ray;',
    `    if(roomDistance < ${SHADER_INFINITY} && t == roomDistance) {`,
    '      hit = roomHit;',
    '      normal = roomNormal;',
    environmentSource,
    newDiffuseRaySource,
    `    } else if(t == ${SHADER_INFINITY}) {`,
    '      if(renderDebugViewMode > 0.5) break;',
    missSource,
    '      break;',
    '    } else {',
      '      if(false) ;',
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getNormalCalculationCode()),
    '    }',
    '    if(renderDebugViewMode > 0.5) {',
    '      if(renderDebugViewMode < 1.5) return clamp(surfaceColor, 0.0, 1.0);',
    '      if(renderDebugViewMode < 2.5) return normal * 0.5 + 0.5;',
    '      float debugDepth = clamp((t * length(debugViewRay)) / 6.0, 0.0, 1.0);',
    '      return vec3(1.0 - debugDepth);',
    '    }',
    '    colorMask *= surfaceColor;',
    '    vec3 toLight = light - hit;',
    '    float diffuseNumerator = dot(toLight, normal);',
    '    if(surfaceLightResponse > 0.00001 && (diffuseNumerator > 0.0 || specularHighlight > 0.00001)) {',
    '      float inverseLightDistance = inversesqrt(max(dot(toLight, toLight), 0.000001));',
    '      float diffuse = max(0.0, diffuseNumerator * inverseLightDistance);',
    '      float directLightResponse = surfaceLightResponse * (diffuse + specularHighlight);',
    '      if(directLightResponse > 0.00001) {',
    `        float shadowIntensity = shadow(hit + normal * ${SHADER_EPSILON}, toLight);`,
    '        accumulatedColor += colorMask * lightColor * (lightIntensity * shadowIntensity * directLightResponse);',
    '      }',
    '    }',
    `    origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
    '  }',
    '  return accumulatedColor;',
    '}'
  ].join('');
};

const createMainShaderSource = () => [
  'void main() {',
  '  vec3 newLight = light + randomLightOffset(sampleSeed - 53.0);',
  `  vec3 texture = texture2D(texture, gl_FragCoord.xy / vec2(${CANVAS_RENDER_WIDTH}.0, ${CANVAS_RENDER_HEIGHT}.0)).rgb;`,
  '  vec3 rayOrigin = eye;',
  '  vec3 rayDirection = initialRay;',
  '  applyCameraFocus(rayOrigin, rayDirection);',
  '  gl_FragColor = vec4(mix(calculateColor(rayOrigin, rayDirection, newLight), texture, textureWeight), 1.0);',
  '}'
].join('');

const createTracerFragmentSource = (sceneObjects, renderSettings) => {
  const shouldUseSkyShader = renderSettingsUseSkyTexture(renderSettings);
  const shouldUseSurfaceShaderUtilities = sceneUsesSurfaceShaderUtilities(sceneObjects);

  return [
    tracerFragmentSourceHeader,
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getGlobalCode()),
    intersectCubeSource,
    intersectCubeDistanceSource,
    normalForCubeSource,
    intersectSphereSource,
    intersectTriangleSource,
    sceneUsesSphereShadowTests(sceneObjects) ? shadowSphereSource : '',
    normalForSphereSource,
    randomSource,
    cosineWeightedDirectionSource,
    uniformlyRandomDirectionSource,
    uniformlyRandomVectorSource,
    randomLightOffsetSource,
    createShadowShaderSource(sceneObjects),
    cameraFocusSource,
    shouldUseSurfaceShaderUtilities ? surfaceShaderUtilitySource : '',
    shouldUseSkyShader ? skyShaderSource : '',
    createCalculateColorShaderSource(sceneObjects, renderSettings),
    createMainShaderSource()
  ].join('');
};

const compileShaderSource = (webGlContext, source, shaderType, label) => {
  const shader = webGlContext.createShader(shaderType);
  if (!shader) {
    return returnFailure('shader-create-failed', `${label} shader could not be created.`);
  }

  webGlContext.shaderSource(shader, source);
  webGlContext.compileShader(shader);

  if (!webGlContext.getShaderParameter(shader, webGlContext.COMPILE_STATUS)) {
    const shaderInfo = webGlContext.getShaderInfoLog(shader) || 'No shader log was provided.';
    webGlContext.deleteShader(shader);
    return returnFailure('shader-compile-failed', `${label} shader failed to compile.`, shaderInfo);
  }

  return returnSuccess(shader);
};

const createLinkedProgram = (webGlContext, vertexSource, fragmentSource, label) => {
  const [vertexShader, vertexShaderError] = compileShaderSource(webGlContext, vertexSource, webGlContext.VERTEX_SHADER, `${label} vertex`);
  if (vertexShaderError) {
    return returnFailure(vertexShaderError.code, vertexShaderError.message, vertexShaderError.details);
  }

  const [fragmentShader, fragmentShaderError] = compileShaderSource(webGlContext, fragmentSource, webGlContext.FRAGMENT_SHADER, `${label} fragment`);
  if (fragmentShaderError) {
    webGlContext.deleteShader(vertexShader);
    return returnFailure(fragmentShaderError.code, fragmentShaderError.message, fragmentShaderError.details);
  }

  const program = webGlContext.createProgram();
  if (!program) {
    webGlContext.deleteShader(vertexShader);
    webGlContext.deleteShader(fragmentShader);
    return returnFailure('program-create-failed', `${label} program could not be created.`);
  }

  webGlContext.attachShader(program, vertexShader);
  webGlContext.attachShader(program, fragmentShader);
  webGlContext.linkProgram(program);
  webGlContext.detachShader(program, vertexShader);
  webGlContext.detachShader(program, fragmentShader);
  webGlContext.deleteShader(vertexShader);
  webGlContext.deleteShader(fragmentShader);

  if (!webGlContext.getProgramParameter(program, webGlContext.LINK_STATUS)) {
    const programInfo = webGlContext.getProgramInfoLog(program) || 'No program log was provided.';
    webGlContext.deleteProgram(program);
    return returnFailure('program-link-failed', `${label} program failed to link.`, programInfo);
  }

  return returnSuccess(program);
};

const readParallelShaderCompileExtension = (webGlContext) => {
  if (!webGlContext || typeof webGlContext.getExtension !== 'function') {
    return null;
  }
  try {
    return webGlContext.getExtension('KHR_parallel_shader_compile');
  } catch (_error) {
    return null;
  }
};

const queueShaderCompilePoll = (callback, options = Object.freeze({})) => {
  const windowObject = options.windowObject || globalThis;
  if (typeof options.schedulePoll === 'function') {
    options.schedulePoll(callback);
    return;
  }
  if (windowObject && typeof windowObject.requestAnimationFrame === 'function') {
    windowObject.requestAnimationFrame(() => {
      if (typeof windowObject.setTimeout === 'function') {
        windowObject.setTimeout(callback, 0);
        return;
      }
      callback();
    });
    return;
  }
  if (windowObject && typeof windowObject.setTimeout === 'function') {
    windowObject.setTimeout(callback, 16);
    return;
  }
  callback();
};

const compileShaderSourceUnchecked = (webGlContext, source, shaderType, label) => {
  const shader = webGlContext.createShader(shaderType);
  if (!shader) {
    return returnFailure('shader-create-failed', `${label} shader could not be created.`);
  }

  webGlContext.shaderSource(shader, source);
  webGlContext.compileShader(shader);
  return returnSuccess(shader);
};

const createLinkedProgramAsync = (webGlContext, vertexSource, fragmentSource, label, options = Object.freeze({})) => {
  const parallelShaderCompileExtension = readParallelShaderCompileExtension(webGlContext);
  if (!parallelShaderCompileExtension) {
    return Promise.resolve(createLinkedProgram(webGlContext, vertexSource, fragmentSource, label));
  }

  const [vertexShader, vertexShaderError] = compileShaderSourceUnchecked(
    webGlContext,
    vertexSource,
    webGlContext.VERTEX_SHADER,
    `${label} vertex`
  );
  if (vertexShaderError) {
    return Promise.resolve(returnFailure(vertexShaderError.code, vertexShaderError.message, vertexShaderError.details));
  }

  const [fragmentShader, fragmentShaderError] = compileShaderSourceUnchecked(
    webGlContext,
    fragmentSource,
    webGlContext.FRAGMENT_SHADER,
    `${label} fragment`
  );
  if (fragmentShaderError) {
    webGlContext.deleteShader(vertexShader);
    return Promise.resolve(returnFailure(fragmentShaderError.code, fragmentShaderError.message, fragmentShaderError.details));
  }

  const program = webGlContext.createProgram();
  if (!program) {
    webGlContext.deleteShader(vertexShader);
    webGlContext.deleteShader(fragmentShader);
    return Promise.resolve(returnFailure('program-create-failed', `${label} program could not be created.`));
  }

  webGlContext.attachShader(program, vertexShader);
  webGlContext.attachShader(program, fragmentShader);
  webGlContext.linkProgram(program);

  return new Promise((resolve) => {
    const finishIfComplete = () => {
      if (!webGlContext.getProgramParameter(program, parallelShaderCompileExtension.COMPLETION_STATUS_KHR)) {
        queueShaderCompilePoll(finishIfComplete, options);
        return;
      }

      const vertexShaderCompiled = webGlContext.getShaderParameter(vertexShader, webGlContext.COMPILE_STATUS);
      if (!vertexShaderCompiled) {
        const shaderInfo = webGlContext.getShaderInfoLog(vertexShader) || 'No shader log was provided.';
        webGlContext.detachShader(program, vertexShader);
        webGlContext.detachShader(program, fragmentShader);
        webGlContext.deleteShader(vertexShader);
        webGlContext.deleteShader(fragmentShader);
        webGlContext.deleteProgram(program);
        resolve(returnFailure('shader-compile-failed', `${label} vertex shader failed to compile.`, shaderInfo));
        return;
      }

      const fragmentShaderCompiled = webGlContext.getShaderParameter(fragmentShader, webGlContext.COMPILE_STATUS);
      if (!fragmentShaderCompiled) {
        const shaderInfo = webGlContext.getShaderInfoLog(fragmentShader) || 'No shader log was provided.';
        webGlContext.detachShader(program, vertexShader);
        webGlContext.detachShader(program, fragmentShader);
        webGlContext.deleteShader(vertexShader);
        webGlContext.deleteShader(fragmentShader);
        webGlContext.deleteProgram(program);
        resolve(returnFailure('shader-compile-failed', `${label} fragment shader failed to compile.`, shaderInfo));
        return;
      }

      webGlContext.detachShader(program, vertexShader);
      webGlContext.detachShader(program, fragmentShader);
      webGlContext.deleteShader(vertexShader);
      webGlContext.deleteShader(fragmentShader);

      if (!webGlContext.getProgramParameter(program, webGlContext.LINK_STATUS)) {
        const programInfo = webGlContext.getProgramInfoLog(program) || 'No program log was provided.';
        webGlContext.deleteProgram(program);
        resolve(returnFailure('program-link-failed', `${label} program failed to link.`, programInfo));
        return;
      }

      resolve(returnSuccess(program));
    };

    queueShaderCompilePoll(finishIfComplete, options);
  });
};

const createBufferWithData = (webGlContext, target, typedArray, usage, label) => {
  const buffer = webGlContext.createBuffer();
  if (!buffer) {
    return returnFailure('buffer-create-failed', `${label} buffer could not be created.`);
  }

  webGlContext.bindBuffer(target, buffer);
  webGlContext.bufferData(target, typedArray, usage);

  return returnSuccess(buffer);
};

const createRenderTexture = (webGlContext, textureType) => {
  const texture = webGlContext.createTexture();
  if (!texture) {
    return returnFailure('texture-create-failed', 'Render texture could not be created.');
  }

  webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MAG_FILTER, webGlContext.NEAREST);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MIN_FILTER, webGlContext.NEAREST);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_S, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_T, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texImage2D(
    webGlContext.TEXTURE_2D,
    0,
    webGlContext.RGBA,
    CANVAS_RENDER_WIDTH,
    CANVAS_RENDER_HEIGHT,
    0,
    webGlContext.RGBA,
    textureType,
    null
  );

  return returnSuccess(texture);
};

const createFramebufferForTexture = (webGlContext, texture, label) => {
  const framebuffer = webGlContext.createFramebuffer();
  if (!framebuffer) {
    return returnFailure('framebuffer-create-failed', `${label} framebuffer could not be created.`);
  }

  webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, framebuffer);
  webGlContext.framebufferTexture2D(
    webGlContext.FRAMEBUFFER,
    webGlContext.COLOR_ATTACHMENT0,
    webGlContext.TEXTURE_2D,
    texture,
    0
  );

  return returnSuccess(framebuffer);
};

const createProceduralSkyTexture = (webGlContext) => {
  const texture = webGlContext.createTexture();
  if (!texture) {
    return returnFailure('texture-create-failed', 'Sky texture could not be created.');
  }

  const skyPixels = new Uint8Array(SKY_TEXTURE_WIDTH * SKY_TEXTURE_HEIGHT * BYTES_PER_RGBA_PIXEL);
  for (let y = 0; y < SKY_TEXTURE_HEIGHT; y += 1) {
    const verticalPercent = y / (SKY_TEXTURE_HEIGHT - 1);
    const skyBlend = Math.max(0, 1 - verticalPercent * 1.35);
    const horizonBlend = 1 - Math.abs(verticalPercent - 0.55) * 1.7;
    for (let x = 0; x < SKY_TEXTURE_WIDTH; x += 1) {
      const horizontalPercent = x / (SKY_TEXTURE_WIDTH - 1);
      const sunDistance = Math.hypot(horizontalPercent - 0.66, verticalPercent - 0.32);
      const sunGlow = Math.max(0, 1 - sunDistance * 9);
      const pixelOffset = (y * SKY_TEXTURE_WIDTH + x) * BYTES_PER_RGBA_PIXEL;
      const red = 32 + skyBlend * 40 + horizonBlend * 85 + sunGlow * 170;
      const green = 48 + skyBlend * 82 + horizonBlend * 76 + sunGlow * 150;
      const blue = 72 + skyBlend * 150 + horizonBlend * 58 + sunGlow * 92;
      skyPixels[pixelOffset] = clampInteger(red, 0, 255);
      skyPixels[pixelOffset + 1] = clampInteger(green, 0, 255);
      skyPixels[pixelOffset + 2] = clampInteger(blue, 0, 255);
      skyPixels[pixelOffset + 3] = 255;
    }
  }

  webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MAG_FILTER, webGlContext.LINEAR);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MIN_FILTER, webGlContext.LINEAR);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_S, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_T, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texImage2D(
    webGlContext.TEXTURE_2D,
    0,
    webGlContext.RGBA,
    SKY_TEXTURE_WIDTH,
    SKY_TEXTURE_HEIGHT,
    0,
    webGlContext.RGBA,
    webGlContext.UNSIGNED_BYTE,
    skyPixels
  );

  return returnSuccess(texture);
};

const createProceduralMaterialAlbedoTexture = (webGlContext) => {
  const texture = webGlContext.createTexture();
  if (!texture) {
    return returnFailure('texture-create-failed', 'Material albedo texture could not be created.');
  }

  const texturePixels = new Uint8Array(
    MATERIAL_ALBEDO_TEXTURE_SIZE * MATERIAL_ALBEDO_TEXTURE_SIZE * BYTES_PER_RGBA_PIXEL
  );
  for (let y = 0; y < MATERIAL_ALBEDO_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < MATERIAL_ALBEDO_TEXTURE_SIZE; x += 1) {
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      const fineNoise = ((x * 17 + y * 31) % 23) / 22;
      const pixelOffset = (y * MATERIAL_ALBEDO_TEXTURE_SIZE + x) * BYTES_PER_RGBA_PIXEL;
      const warmTile = checker === 0;
      texturePixels[pixelOffset] = clampInteger((warmTile ? 225 : 72) + fineNoise * 18, 0, 255);
      texturePixels[pixelOffset + 1] = clampInteger((warmTile ? 202 : 118) + fineNoise * 14, 0, 255);
      texturePixels[pixelOffset + 2] = clampInteger((warmTile ? 154 : 178) + fineNoise * 20, 0, 255);
      texturePixels[pixelOffset + 3] = 255;
    }
  }

  webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MAG_FILTER, webGlContext.LINEAR);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MIN_FILTER, webGlContext.LINEAR);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_S, webGlContext.REPEAT);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_T, webGlContext.REPEAT);
  webGlContext.texImage2D(
    webGlContext.TEXTURE_2D,
    0,
    webGlContext.RGBA,
    MATERIAL_ALBEDO_TEXTURE_SIZE,
    MATERIAL_ALBEDO_TEXTURE_SIZE,
    0,
    webGlContext.RGBA,
    webGlContext.UNSIGNED_BYTE,
    texturePixels
  );

  return returnSuccess(texture);
};

const createUniformLocationCache = () => new Map();

const readUniformLocation = (webGlContext, program, uniformLocationCache, uniformName) => {
  if (uniformLocationCache.has(uniformName)) {
    return uniformLocationCache.get(uniformName);
  }

  const uniformLocation = webGlContext.getUniformLocation(program, uniformName);
  uniformLocationCache.set(uniformName, uniformLocation);
  return uniformLocation;
};

const setSamplerUniform = (webGlContext, program, uniformLocationCache, uniformName, textureUnitIndex) => {
  const uniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, uniformName);
  if (uniformLocation === null) {
    return returnSuccess(undefined);
  }

  webGlContext.uniform1i(uniformLocation, textureUnitIndex);
  return returnSuccess(undefined);
};

const ACTIVE_WEBGL_PROGRAMS = new WeakMap();

const useWebGlProgramIfNeeded = (webGlContext, program) => {
  if (ACTIVE_WEBGL_PROGRAMS.get(webGlContext) !== program) {
    webGlContext.useProgram(program);
    ACTIVE_WEBGL_PROGRAMS.set(webGlContext, program);
  }
};

const cacheNamedUniformLocations = (webGlContext, program, uniformLocationCache, targetLocations, uniformNames) => {
  for (const uniformName of uniformNames) {
    targetLocations[uniformName] = readUniformLocation(webGlContext, program, uniformLocationCache, uniformName);
  }

  return returnSuccess(undefined);
};

const setChangedCachedScalarUniformValues = (
  webGlContext,
  uniformLocations,
  uniformValues,
  previousUniformValues,
  uniformNames
) => {
  for (const uniformName of uniformNames) {
    const uniformValue = uniformValues[uniformName];
    if (previousUniformValues[uniformName] === uniformValue) {
      continue;
    }

    previousUniformValues[uniformName] = uniformValue;
    const uniformLocation = uniformLocations[uniformName];
    if (uniformLocation !== null && uniformLocation !== undefined) {
      webGlContext.uniform1f(uniformLocation, uniformValue);
    }
  }
};

const haveTracerFrameScalarUniformsChanged = (
  applicationState,
  activeLightBounceCount,
  normalizedRenderDebugViewMode,
  previousUniformValues
) => (
  previousUniformValues.glossiness !== applicationState.glossiness
  || previousUniformValues.lightIntensity !== applicationState.lightIntensity
  || previousUniformValues.lightSize !== applicationState.lightSize
  || previousUniformValues.fogDensity !== applicationState.fogDensity
  || previousUniformValues.skyBrightness !== applicationState.skyBrightness
  || previousUniformValues.cameraFocusDistance !== applicationState.cameraFocusDistance
  || previousUniformValues.cameraAperture !== applicationState.cameraAperture
  || previousUniformValues.renderDebugViewMode !== normalizedRenderDebugViewMode
  || previousUniformValues.activeLightBounceCount !== activeLightBounceCount
);

const setChangedCachedVec3UniformValue = (webGlContext, uniformLocation, uniformValue, previousUniformValue) => {
  if (uniformLocation === null) {
    return;
  }

  if (
    previousUniformValue[0] === uniformValue[0] &&
    previousUniformValue[1] === uniformValue[1] &&
    previousUniformValue[2] === uniformValue[2]
  ) {
    return;
  }

  writeVec3(previousUniformValue, uniformValue[0], uniformValue[1], uniformValue[2]);
  webGlContext.uniform3f(uniformLocation, uniformValue[0], uniformValue[1], uniformValue[2]);
};

const writeInvalidMat4 = (matrix) => {
  for (let matrixIndex = 0; matrixIndex < FLOATS_PER_MAT4; matrixIndex += 1) {
    matrix[matrixIndex] = Number.NaN;
  }
  return matrix;
};

const createInvalidMat4 = () => writeInvalidMat4(createMat4());

const setChangedCachedMat4UniformValue = (webGlContext, uniformLocation, matrixValue, previousMatrixValue) => {
  if (uniformLocation === null) {
    return;
  }

  let didChange = false;
  for (let matrixIndex = 0; matrixIndex < FLOATS_PER_MAT4; matrixIndex += 1) {
    const nextValue = matrixValue[matrixIndex];
    if (previousMatrixValue[matrixIndex] !== nextValue) {
      didChange = true;
    }
    previousMatrixValue[matrixIndex] = nextValue;
  }

  if (didChange) {
    webGlContext.uniformMatrix4fv(uniformLocation, false, matrixValue);
  }
};

class SphereSceneObject {
  constructor(centerPosition, radius, objectId, material = MATERIAL.DIFFUSE) {
    this.objectId = objectId;
    this.entityId = String(objectId);
    this.parentEntityId = null;
    this.displayName = '';
    this.isHidden = false;
    this.isLocked = false;
    this.centerPosition = cloneVec3(centerPosition);
    this.radius = radius;
    this.materialComponent = createSceneObjectMaterialComponent(material);
    defineSceneObjectMaterialAccessors(this);
    this.isEmissionEnabled = this.material === MATERIAL.EMISSIVE;
    this.emissiveColor = createDefaultEmissiveColor();
    this.emissiveIntensity = DEFAULT_EMISSIVE_INTENSITY;
    this.centerUniformName = `sphereCenter${objectId}`;
    this.radiusUniformName = `sphereRadius${objectId}`;
    this.intersectionName = `tSphere${objectId}`;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformCenterPosition = createVec3(0, 0, 0);
    this.previousUniformCenterPosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.translatedCenterPosition = createVec3(0, 0, 0);
    this.radiusVector = createVec3(radius, radius, radius);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.physicsComponent = createSceneObjectPhysicsComponent({
      enabled: true,
      bodyType: PHYSICS_BODY_TYPE.DYNAMIC,
      friction: PHYSICS_SPHERE_FRICTION,
      restitution: PHYSICS_SPHERE_RESTITUTION,
      mass: DEFAULT_PHYSICS_MASS,
      gravityScale: DEFAULT_PHYSICS_GRAVITY_SCALE,
      collideWithObjects: true
    });
    this.components = createSceneObjectComponentMap(this, true);
    defineSceneObjectPhysicsAccessors(this);
    this.centerUniformLocation = null;
    this.radiusUniformLocation = null;
    this.previousUniformRadius = Number.NaN;
    this.isUniformCenterDirty = true;
    this.isUniformRadiusDirty = true;
  }

  getGlobalCode() {
    return `uniform vec3 ${this.centerUniformName};uniform float ${this.radiusUniformName};`;
  }

  getIntersectCode() {
    return `float ${this.intersectionName} = intersectSphere(origin, ray, rayLengthSquared, ${this.centerUniformName}, ${this.radiusUniformName});`;
  }

  getShadowTestCode() {
    if (isTransparentMaterial(this.material)) {
      return '';
    }
    return `if(shadowSphere(origin, ray, inverseRayLengthSquared, ${this.centerUniformName}, ${this.radiusUniformName})) return 0.0;`;
  }

  getMinimumIntersectCode() {
    return `if(${this.intersectionName} < t) t = ${this.intersectionName};`;
  }

  getNormalCalculationCode() {
    return [
      `else if(t == ${this.intersectionName}) {`,
      `normal = normalForSphere(hit, ${this.centerUniformName}, ${this.radiusUniformName});`,
      sceneObjectUsesSurfaceShaderUtilities(this) ? `surfaceObjectPoint = hit - ${this.centerUniformName};` : '',
      createObjectSurfaceShaderSource(this.material, this),
      '}'
    ].join('');
  }

  setMaterial(material) {
    this.material = normalizeMaterial(material);
    if (this.material === MATERIAL.EMISSIVE) {
      this.isEmissionEnabled = true;
    }
    return returnSuccess(undefined);
  }

  cloneForDuplicate(objectId) {
    const duplicateObject = new SphereSceneObject(this.centerPosition, this.radius, objectId, this.material);
    duplicateObject.displayName = this.displayName ? `${this.displayName} Copy` : '';
    duplicateObject.glossiness = this.glossiness;
    copySceneObjectEmissiveSettings(this, duplicateObject);
    copySceneObjectMaterialProjectionSettings(this, duplicateObject);
    duplicateObject.isPhysicsEnabled = this.isPhysicsEnabled;
    duplicateObject.physicsBodyType = this.physicsBodyType;
    duplicateObject.physicsFriction = this.physicsFriction;
    duplicateObject.physicsRestitution = this.physicsRestitution;
    duplicateObject.physicsMass = this.physicsMass;
    duplicateObject.physicsGravityScale = this.physicsGravityScale;
    duplicateObject.collideWithObjects = this.collideWithObjects;
    return duplicateObject;
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.centerUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.centerUniformName);
    this.radiusUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.radiusUniformName);
    writeVec3(this.previousUniformCenterPosition, Number.NaN, Number.NaN, Number.NaN);
    this.previousUniformRadius = Number.NaN;
    this.isUniformCenterDirty = true;
    this.isUniformRadiusDirty = true;
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (this.centerUniformLocation !== null && this.isUniformCenterDirty) {
      writeAddVec3(this.uniformCenterPosition, this.centerPosition, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.centerUniformLocation,
        this.uniformCenterPosition,
        this.previousUniformCenterPosition
      );
      this.isUniformCenterDirty = false;
    }
    if (this.radiusUniformLocation !== null && this.isUniformRadiusDirty) {
      this.previousUniformRadius = this.radius;
      webGlContext.uniform1f(this.radiusUniformLocation, this.radius);
      this.isUniformRadiusDirty = false;
    }
  }

  setTemporaryTranslation(translationVector) {
    writeVec3(this.temporaryTranslation, translationVector[0], translationVector[1], translationVector[2]);
    this.isUniformCenterDirty = true;
    markSceneObjectPhysicsRebuildDirty(this);
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.centerPosition, this.centerPosition, translationVector);
    this.isUniformCenterDirty = true;
    markSceneObjectPhysicsRebuildDirty(this);
    return returnSuccess(undefined);
  }

  setCenterPosition(centerPosition) {
    writeVec3(this.centerPosition, centerPosition[0], centerPosition[1], centerPosition[2]);
    this.isUniformCenterDirty = true;
    markSceneObjectPhysicsRebuildDirty(this);
    return returnSuccess(undefined);
  }

  setCenterPositionComponents(xPosition, yPosition, zPosition) {
    writeVec3(this.centerPosition, xPosition, yPosition, zPosition);
    this.isUniformCenterDirty = true;
    markSceneObjectPhysicsRebuildDirty(this);
    return returnSuccess(undefined);
  }

  attachPhysicsRigidBody(rigidBody) {
    if (!rigidBody || typeof rigidBody.translation !== 'function') {
      return returnFailure('invalid-sphere-physics-body', 'Sphere physics body is invalid.');
    }

    this.physicsRigidBody = rigidBody;
    return returnSuccess(undefined);
  }

  clearPhysicsRigidBody() {
    this.physicsRigidBody = null;
    return returnSuccess(undefined);
  }

  getTranslatedCenter() {
    return writeAddVec3(this.translatedCenterPosition, this.centerPosition, this.temporaryTranslation);
  }

  getMinCorner() {
    return writeSubtractVec3(this.boundsMinCorner, this.getTranslatedCenter(), this.radiusVector);
  }

  getMaxCorner() {
    return writeAddVec3(this.boundsMaxCorner, this.getTranslatedCenter(), this.radiusVector);
  }

  intersectRay(originPosition, rayDirection) {
    const intersectionDistance = intersectSphere(originPosition, rayDirection, this.getTranslatedCenter(), this.radius);
    return returnSuccess(intersectionDistance);
  }
}

class CubeSceneObject {
  constructor(minCorner, maxCorner, objectId, material = MATERIAL.DIFFUSE) {
    this.objectId = objectId;
    this.entityId = String(objectId);
    this.parentEntityId = null;
    this.displayName = '';
    this.isHidden = false;
    this.isLocked = false;
    this.minCorner = cloneVec3(minCorner);
    this.maxCorner = cloneVec3(maxCorner);
    this.materialComponent = createSceneObjectMaterialComponent(material);
    defineSceneObjectMaterialAccessors(this);
    this.isEmissionEnabled = this.material === MATERIAL.EMISSIVE;
    this.emissiveColor = createDefaultEmissiveColor();
    this.emissiveIntensity = DEFAULT_EMISSIVE_INTENSITY;
    this.minUniformName = `cubeMin${objectId}`;
    this.maxUniformName = `cubeMax${objectId}`;
    this.intersectionName = `tCube${objectId}`;
    this.intersectionDistanceName = `dCube${objectId}`;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformMinCorner = createVec3(0, 0, 0);
    this.uniformMaxCorner = createVec3(0, 0, 0);
    this.previousUniformMinCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousUniformMaxCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.centerPosition = createVec3(0, 0, 0);
    this.centerDeltaPosition = createVec3(0, 0, 0);
    this.halfExtents = createVec3(0, 0, 0);
    this.physicsComponent = createSceneObjectPhysicsComponent({
      enabled: true,
      bodyType: PHYSICS_BODY_TYPE.STATIC,
      friction: PHYSICS_CUBE_FRICTION,
      restitution: PHYSICS_CUBE_RESTITUTION,
      mass: DEFAULT_PHYSICS_MASS,
      gravityScale: DEFAULT_PHYSICS_GRAVITY_SCALE,
      collideWithObjects: true
    });
    this.components = createSceneObjectComponentMap(this, true);
    defineSceneObjectPhysicsAccessors(this);
    this.minUniformLocation = null;
    this.maxUniformLocation = null;
    this.areUniformBoundsDirty = true;
  }

  getGlobalCode() {
    return `uniform vec3 ${this.minUniformName};uniform vec3 ${this.maxUniformName};`;
  }

  getIntersectCode() {
    return `vec2 ${this.intersectionName} = intersectCube(origin, inverseRay, ${this.minUniformName}, ${this.maxUniformName});`;
  }

  getShadowTestCode() {
    if (isTransparentMaterial(this.material)) {
      return '';
    }
    return [
      this.getIntersectCode(),
      `float ${this.intersectionDistanceName} = intersectCubeDistance(${this.intersectionName});`,
      `if(${this.intersectionDistanceName} < 1.0) return 0.0;`
    ].join('');
  }

  getMinimumIntersectCode() {
    return `float ${this.intersectionDistanceName} = intersectCubeDistance(${this.intersectionName});if(${this.intersectionDistanceName} < t) t = ${this.intersectionDistanceName};`;
  }

  getNormalCalculationCode() {
    return [
      `else if(t == ${this.intersectionDistanceName}) {`,
      `normal = normalForCube(hit, ${this.minUniformName}, ${this.maxUniformName});`,
      sceneObjectUsesSurfaceShaderUtilities(this)
        ? `surfaceObjectPoint = hit - (${this.minUniformName} + ${this.maxUniformName}) * 0.5;`
        : '',
      createObjectSurfaceShaderSource(this.material, this),
      '}'
    ].join('');
  }

  setMaterial(material) {
    this.material = normalizeMaterial(material);
    if (this.material === MATERIAL.EMISSIVE) {
      this.isEmissionEnabled = true;
    }
    return returnSuccess(undefined);
  }

  cloneForDuplicate(objectId) {
    const duplicateObject = new CubeSceneObject(this.minCorner, this.maxCorner, objectId, this.material);
    duplicateObject.displayName = this.displayName ? `${this.displayName} Copy` : '';
    duplicateObject.glossiness = this.glossiness;
    copySceneObjectEmissiveSettings(this, duplicateObject);
    copySceneObjectMaterialProjectionSettings(this, duplicateObject);
    duplicateObject.isPhysicsEnabled = this.isPhysicsEnabled;
    duplicateObject.physicsBodyType = this.physicsBodyType;
    duplicateObject.physicsFriction = this.physicsFriction;
    duplicateObject.physicsRestitution = this.physicsRestitution;
    duplicateObject.physicsMass = this.physicsMass;
    duplicateObject.physicsGravityScale = this.physicsGravityScale;
    duplicateObject.collideWithObjects = this.collideWithObjects;
    return duplicateObject;
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.minUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.minUniformName);
    this.maxUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.maxUniformName);
    writeVec3(this.previousUniformMinCorner, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousUniformMaxCorner, Number.NaN, Number.NaN, Number.NaN);
    this.areUniformBoundsDirty = true;
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (!this.areUniformBoundsDirty) {
      return;
    }

    if (this.minUniformLocation !== null) {
      writeAddVec3(this.uniformMinCorner, this.minCorner, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.minUniformLocation,
        this.uniformMinCorner,
        this.previousUniformMinCorner
      );
    }
    if (this.maxUniformLocation !== null) {
      writeAddVec3(this.uniformMaxCorner, this.maxCorner, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.maxUniformLocation,
        this.uniformMaxCorner,
        this.previousUniformMaxCorner
      );
    }
    this.areUniformBoundsDirty = false;
  }

  setTemporaryTranslation(translationVector) {
    writeVec3(this.temporaryTranslation, translationVector[0], translationVector[1], translationVector[2]);
    this.areUniformBoundsDirty = true;
    markSceneObjectPhysicsRebuildDirty(this);
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.minCorner, this.minCorner, translationVector);
    writeAddVec3(this.maxCorner, this.maxCorner, translationVector);
    this.areUniformBoundsDirty = true;
    markSceneObjectPhysicsRebuildDirty(this);
    return returnSuccess(undefined);
  }

  setCenterPositionComponents(xPosition, yPosition, zPosition) {
    const centerPosition = this.getCenterPosition();
    const deltaPosition = writeVec3(
      this.centerDeltaPosition,
      xPosition - centerPosition[0],
      yPosition - centerPosition[1],
      zPosition - centerPosition[2]
    );
    writeAddVec3(this.minCorner, this.minCorner, deltaPosition);
    writeAddVec3(this.maxCorner, this.maxCorner, deltaPosition);
    this.areUniformBoundsDirty = true;
    markSceneObjectPhysicsRebuildDirty(this);
    return returnSuccess(undefined);
  }

  attachPhysicsRigidBody(rigidBody) {
    if (!rigidBody || typeof rigidBody.translation !== 'function') {
      return returnFailure('invalid-cube-physics-body', 'Cube physics body is invalid.');
    }

    this.physicsRigidBody = rigidBody;
    return returnSuccess(undefined);
  }

  clearPhysicsRigidBody() {
    this.physicsRigidBody = null;
    return returnSuccess(undefined);
  }

  getMinCorner() {
    return writeAddVec3(this.boundsMinCorner, this.minCorner, this.temporaryTranslation);
  }

  getMaxCorner() {
    return writeAddVec3(this.boundsMaxCorner, this.maxCorner, this.temporaryTranslation);
  }

  getCenterPosition() {
    const minCorner = this.getMinCorner();
    const maxCorner = this.getMaxCorner();
    return writeVec3(
      this.centerPosition,
      (minCorner[0] + maxCorner[0]) * 0.5,
      (minCorner[1] + maxCorner[1]) * 0.5,
      (minCorner[2] + maxCorner[2]) * 0.5
    );
  }

  getHalfExtents() {
    const minCorner = this.getMinCorner();
    const maxCorner = this.getMaxCorner();
    return writeVec3(
      this.halfExtents,
      (maxCorner[0] - minCorner[0]) * 0.5,
      (maxCorner[1] - minCorner[1]) * 0.5,
      (maxCorner[2] - minCorner[2]) * 0.5
    );
  }

  intersectRay(originPosition, rayDirection) {
    const intersectionDistance = intersectCube(originPosition, rayDirection, this.getMinCorner(), this.getMaxCorner());
    return returnSuccess(intersectionDistance);
  }
}

const DEFAULT_REFERENCE_MESH_MODEL_KEY = 'suzanneLow';
const REFERENCE_MESH_MODELS = Object.freeze({
  [DEFAULT_REFERENCE_MESH_MODEL_KEY]: SUZANNE_LOW_REFERENCE_MODEL
});

const readReferenceMeshModelKey = (modelKey) => (
  Object.prototype.hasOwnProperty.call(REFERENCE_MESH_MODELS, modelKey)
    ? modelKey
    : DEFAULT_REFERENCE_MESH_MODEL_KEY
);

const readReferenceMeshModel = (modelKey) => REFERENCE_MESH_MODELS[readReferenceMeshModelKey(modelKey)];

const formatReferenceShaderFloat = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '0.0';
  }
  const normalizedValue = Math.abs(numericValue) < 1e-8 ? 0 : numericValue;
  const text = Number(normalizedValue.toFixed(8)).toString();
  return /[.e]/iu.test(text) ? text : `${text}.0`;
};

const formatReferenceShaderVec3 = (x, y, z) => (
  `vec3(${formatReferenceShaderFloat(x)}, ${formatReferenceShaderFloat(y)}, ${formatReferenceShaderFloat(z)})`
);

const createReferenceMeshIntersectionSource = (sceneObject) => {
  const positions = sceneObject.referenceModel.positions;
  const normals = sceneObject.referenceModel.normals;
  const localOriginName = `meshOrigin${sceneObject.objectId}`;
  const candidateName = `meshCandidate${sceneObject.objectId}`;
  const lines = [
    `float ${sceneObject.intersectionName} = ${SHADER_INFINITY};`,
    `vec3 ${sceneObject.normalName} = vec3(0.0, 1.0, 0.0);`,
    `vec3 ${localOriginName} = origin - ${sceneObject.offsetUniformName};`,
    `float ${candidateName};`
  ];

  for (let triangleIndex = 0; triangleIndex < sceneObject.triangleCount; triangleIndex += 1) {
    const positionOffset = triangleIndex * 9;
    const normalOffset = triangleIndex * 3;
    lines.push(
      `${candidateName} = intersectTriangle(${localOriginName}, ray, ` +
      `${formatReferenceShaderVec3(positions[positionOffset], positions[positionOffset + 1], positions[positionOffset + 2])}, ` +
      `${formatReferenceShaderVec3(positions[positionOffset + 3], positions[positionOffset + 4], positions[positionOffset + 5])}, ` +
      `${formatReferenceShaderVec3(positions[positionOffset + 6], positions[positionOffset + 7], positions[positionOffset + 8])});` +
      `if(${candidateName} < ${sceneObject.intersectionName}) {` +
      `${sceneObject.intersectionName} = ${candidateName};` +
      `${sceneObject.normalName} = ${formatReferenceShaderVec3(normals[normalOffset], normals[normalOffset + 1], normals[normalOffset + 2])};` +
      '}'
    );
  }

  return lines.join('');
};

const createReferenceMeshShadowSource = (sceneObject) => {
  if (isTransparentMaterial(sceneObject.material)) {
    return '';
  }
  const positions = sceneObject.referenceModel.positions;
  const localOriginName = `meshShadowOrigin${sceneObject.objectId}`;
  const candidateName = `meshShadowCandidate${sceneObject.objectId}`;
  const lines = [
    `vec3 ${localOriginName} = origin - ${sceneObject.offsetUniformName};`,
    `float ${candidateName};`
  ];

  for (let triangleIndex = 0; triangleIndex < sceneObject.triangleCount; triangleIndex += 1) {
    const positionOffset = triangleIndex * 9;
    lines.push(
      `${candidateName} = intersectTriangle(${localOriginName}, ray, ` +
      `${formatReferenceShaderVec3(positions[positionOffset], positions[positionOffset + 1], positions[positionOffset + 2])}, ` +
      `${formatReferenceShaderVec3(positions[positionOffset + 3], positions[positionOffset + 4], positions[positionOffset + 5])}, ` +
      `${formatReferenceShaderVec3(positions[positionOffset + 6], positions[positionOffset + 7], positions[positionOffset + 8])});` +
      `if(${candidateName} < 1.0) return 0.0;`
    );
  }

  return lines.join('');
};

const intersectTriangleRay = (originPosition, rayDirection, a, b, c) => {
  const edge1 = createVec3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const edge2 = createVec3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const pvec = createVec3(0, 0, 0);
  writeCrossVec3(pvec, rayDirection, edge2);
  const det = dotVec3(edge1, pvec);
  if (Math.abs(det) < 1e-8) {
    return MAX_INTERSECTION_DISTANCE;
  }

  const invDet = 1 / det;
  const tvec = createVec3(originPosition[0] - a[0], originPosition[1] - a[1], originPosition[2] - a[2]);
  const u = dotVec3(tvec, pvec) * invDet;
  if (u < 0 || u > 1) {
    return MAX_INTERSECTION_DISTANCE;
  }

  const qvec = createVec3(0, 0, 0);
  writeCrossVec3(qvec, tvec, edge1);
  const v = dotVec3(rayDirection, qvec) * invDet;
  if (v < 0 || u + v > 1) {
    return MAX_INTERSECTION_DISTANCE;
  }

  const t = dotVec3(edge2, qvec) * invDet;
  return t > 1e-6 ? t : MAX_INTERSECTION_DISTANCE;
};

class ReferenceMeshSceneObject {
  constructor(referenceModel, centerPosition, objectId, material = MATERIAL.DIFFUSE, modelKey = DEFAULT_REFERENCE_MESH_MODEL_KEY) {
    this.objectId = objectId;
    this.entityId = String(objectId);
    this.parentEntityId = null;
    this.displayName = '';
    this.sceneItemKind = 'referenceMesh';
    this.kind = 'referenceMesh';
    this.type = 'referenceMesh';
    this.isHidden = false;
    this.isLocked = false;
    this.modelKey = readReferenceMeshModelKey(modelKey);
    this.referenceModel = referenceModel || readReferenceMeshModel(this.modelKey);
    this.assetPath = this.referenceModel.assetPath || '';
    this.triangleCount = Math.floor(Number(this.referenceModel.triangleCount) || 0);
    this.centerPosition = cloneVec3(centerPosition);
    this.materialComponent = createSceneObjectMaterialComponent(material);
    defineSceneObjectMaterialAccessors(this);
    this.isEmissionEnabled = this.material === MATERIAL.EMISSIVE;
    this.emissiveColor = createDefaultEmissiveColor();
    this.emissiveIntensity = DEFAULT_EMISSIVE_INTENSITY;
    this.offsetUniformName = `meshOffset${objectId}`;
    this.intersectionName = `tMesh${objectId}`;
    this.normalName = `nMesh${objectId}`;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformOffset = createVec3(0, 0, 0);
    this.previousUniformOffset = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.translatedOffset = createVec3(0, 0, 0);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.baseMinCorner = createVec3(
      this.referenceModel.bounds.min[0],
      this.referenceModel.bounds.min[1],
      this.referenceModel.bounds.min[2]
    );
    this.baseMaxCorner = createVec3(
      this.referenceModel.bounds.max[0],
      this.referenceModel.bounds.max[1],
      this.referenceModel.bounds.max[2]
    );
    this.components = createSceneObjectComponentMap(this);
    this.offsetUniformLocation = null;
    this.isUniformOffsetDirty = true;
  }

  getGlobalCode() {
    return `uniform vec3 ${this.offsetUniformName};`;
  }

  getIntersectCode() {
    return createReferenceMeshIntersectionSource(this);
  }

  getShadowTestCode() {
    return '';
  }

  getMinimumIntersectCode() {
    return `if(${this.intersectionName} < t) t = ${this.intersectionName};`;
  }

  getNormalCalculationCode() {
    const surfaceNormalName = `meshSurfaceNormal${this.objectId}`;
    return [
      `else if(t == ${this.intersectionName}) {`,
      `vec3 ${surfaceNormalName} = normalize(${this.normalName});`,
      `normal = dot(${surfaceNormalName}, ray) > 0.0 ? -${surfaceNormalName} : ${surfaceNormalName};`,
      sceneObjectUsesSurfaceShaderUtilities(this) ? `surfaceObjectPoint = hit - ${this.offsetUniformName};` : '',
      createObjectSurfaceShaderSource(this.material, this),
      '}'
    ].join('');
  }

  setMaterial(material) {
    this.material = normalizeMaterial(material);
    if (this.material === MATERIAL.EMISSIVE) {
      this.isEmissionEnabled = true;
    }
    return returnSuccess(undefined);
  }

  cloneForDuplicate(objectId) {
    const duplicateObject = new ReferenceMeshSceneObject(
      this.referenceModel,
      this.centerPosition,
      objectId,
      this.material,
      this.modelKey
    );
    duplicateObject.displayName = this.displayName ? `${this.displayName} Copy` : '';
    duplicateObject.glossiness = this.glossiness;
    copySceneObjectEmissiveSettings(this, duplicateObject);
    copySceneObjectMaterialProjectionSettings(this, duplicateObject);
    return duplicateObject;
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.offsetUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.offsetUniformName);
    writeVec3(this.previousUniformOffset, Number.NaN, Number.NaN, Number.NaN);
    this.isUniformOffsetDirty = true;
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (this.offsetUniformLocation !== null && this.isUniformOffsetDirty) {
      writeAddVec3(this.uniformOffset, this.centerPosition, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.offsetUniformLocation,
        this.uniformOffset,
        this.previousUniformOffset
      );
      this.isUniformOffsetDirty = false;
    }
  }

  setTemporaryTranslation(translationVector) {
    writeVec3(this.temporaryTranslation, translationVector[0], translationVector[1], translationVector[2]);
    this.isUniformOffsetDirty = true;
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.centerPosition, this.centerPosition, translationVector);
    this.isUniformOffsetDirty = true;
    return returnSuccess(undefined);
  }

  setCenterPosition(centerPosition) {
    writeVec3(this.centerPosition, centerPosition[0], centerPosition[1], centerPosition[2]);
    this.isUniformOffsetDirty = true;
    return returnSuccess(undefined);
  }

  setCenterPositionComponents(xPosition, yPosition, zPosition) {
    writeVec3(this.centerPosition, xPosition, yPosition, zPosition);
    this.isUniformOffsetDirty = true;
    return returnSuccess(undefined);
  }

  getTranslatedOffset() {
    return writeAddVec3(this.translatedOffset, this.centerPosition, this.temporaryTranslation);
  }

  getMinCorner() {
    const translatedOffset = this.getTranslatedOffset();
    return writeVec3(
      this.boundsMinCorner,
      this.baseMinCorner[0] + translatedOffset[0],
      this.baseMinCorner[1] + translatedOffset[1],
      this.baseMinCorner[2] + translatedOffset[2]
    );
  }

  getMaxCorner() {
    const translatedOffset = this.getTranslatedOffset();
    return writeVec3(
      this.boundsMaxCorner,
      this.baseMaxCorner[0] + translatedOffset[0],
      this.baseMaxCorner[1] + translatedOffset[1],
      this.baseMaxCorner[2] + translatedOffset[2]
    );
  }

  intersectRay(originPosition, rayDirection) {
    const positions = this.referenceModel.positions;
    const translatedOffset = this.getTranslatedOffset();
    let closestDistance = MAX_INTERSECTION_DISTANCE;

    for (let triangleIndex = 0; triangleIndex < this.triangleCount; triangleIndex += 1) {
      const positionOffset = triangleIndex * 9;
      const a = createVec3(
        positions[positionOffset] + translatedOffset[0],
        positions[positionOffset + 1] + translatedOffset[1],
        positions[positionOffset + 2] + translatedOffset[2]
      );
      const b = createVec3(
        positions[positionOffset + 3] + translatedOffset[0],
        positions[positionOffset + 4] + translatedOffset[1],
        positions[positionOffset + 5] + translatedOffset[2]
      );
      const c = createVec3(
        positions[positionOffset + 6] + translatedOffset[0],
        positions[positionOffset + 7] + translatedOffset[1],
        positions[positionOffset + 8] + translatedOffset[2]
      );
      closestDistance = Math.min(closestDistance, intersectTriangleRay(originPosition, rayDirection, a, b, c));
    }

    return returnSuccess(closestDistance);
  }
}

class SdfSceneObject {
  constructor(centerPosition, boundsHalfExtents, parameterA, parameterB, objectId, material = MATERIAL.DIFFUSE) {
    this.objectId = objectId;
    this.entityId = String(objectId);
    this.parentEntityId = null;
    this.displayName = '';
    this.isHidden = false;
    this.isLocked = false;
    this.centerPosition = cloneVec3(centerPosition);
    this.boundsHalfExtents = cloneVec3(boundsHalfExtents);
    this.parameterA = cloneVec3(parameterA);
    this.parameterB = cloneVec3(parameterB);
    this.materialComponent = createSceneObjectMaterialComponent(material);
    defineSceneObjectMaterialAccessors(this);
    this.isEmissionEnabled = this.material === MATERIAL.EMISSIVE;
    this.emissiveColor = createDefaultEmissiveColor();
    this.emissiveIntensity = DEFAULT_EMISSIVE_INTENSITY;
    this.centerUniformName = `sdfCenter${objectId}`;
    this.boundsHalfExtentsUniformName = `sdfBounds${objectId}`;
    this.parameterAUniformName = `sdfParamA${objectId}`;
    this.parameterBUniformName = `sdfParamB${objectId}`;
    this.distanceFunctionName = `sdfDistance${objectId}`;
    this.intersectFunctionName = `intersectSdf${objectId}`;
    this.normalFunctionName = `normalForSdf${objectId}`;
    this.intersectionName = `tSdf${objectId}`;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformCenterPosition = createVec3(0, 0, 0);
    this.previousUniformCenterPosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousUniformBoundsHalfExtents = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousUniformParameterA = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousUniformParameterB = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.components = createSceneObjectComponentMap(this);
    this.centerUniformLocation = null;
    this.boundsHalfExtentsUniformLocation = null;
    this.parameterAUniformLocation = null;
    this.parameterBUniformLocation = null;
    this.isUniformCenterDirty = true;
    this.areParameterUniformsDirty = true;
  }

  getDistanceFunctionBody() {
    return `  return length(sdfPoint) - ${this.parameterAUniformName}.x;`;
  }

  getGlobalCode() {
    return [
      `uniform vec3 ${this.centerUniformName};`,
      `uniform vec3 ${this.boundsHalfExtentsUniformName};`,
      `uniform vec3 ${this.parameterAUniformName};`,
      `uniform vec3 ${this.parameterBUniformName};`,
      `float ${this.distanceFunctionName}(vec3 point) {`,
      `  vec3 sdfPoint = point - ${this.centerUniformName};`,
      this.getDistanceFunctionBody(),
      '}',
      `float ${this.intersectFunctionName}(vec3 origin, vec3 ray, vec3 inverseRay) {`,
      `  vec3 sdfMin = ${this.centerUniformName} - ${this.boundsHalfExtentsUniformName};`,
      `  vec3 sdfMax = ${this.centerUniformName} + ${this.boundsHalfExtentsUniformName};`,
      '  vec3 sdfTMin = (sdfMin - origin) * inverseRay;',
      '  vec3 sdfTMax = (sdfMax - origin) * inverseRay;',
      '  vec3 sdfT1 = min(sdfTMin, sdfTMax);',
      '  vec3 sdfT2 = max(sdfTMin, sdfTMax);',
      '  float sdfNear = max(max(sdfT1.x, sdfT1.y), sdfT1.z);',
      '  float sdfFar = min(min(sdfT2.x, sdfT2.y), sdfT2.z);',
      `  if(sdfNear >= sdfFar || sdfFar <= ${SHADER_EPSILON}) return ${SHADER_INFINITY};`,
      `  float sdfRayLength = max(length(ray), ${SHADER_EPSILON});`,
      '  vec3 sdfRayDirection = ray / sdfRayLength;',
      `  float sdfTraceDistance = max(sdfNear, ${SHADER_EPSILON}) * sdfRayLength;`,
      '  float sdfTraceEndDistance = sdfFar * sdfRayLength;',
      `  for(int sdfStep = 0; sdfStep < ${SDF_TRACE_STEP_COUNT}; sdfStep++) {`,
      `    if(sdfTraceDistance > sdfTraceEndDistance) return ${SHADER_INFINITY};`,
      '    vec3 sdfTracePoint = origin + sdfRayDirection * sdfTraceDistance;',
      `    float sdfSignedDistance = ${this.distanceFunctionName}(sdfTracePoint);`,
      `    if(abs(sdfSignedDistance) < ${SDF_SURFACE_EPSILON}) return sdfTraceDistance / sdfRayLength;`,
      `    sdfTraceDistance += clamp(abs(sdfSignedDistance) * 0.82, ${SDF_TRACE_MIN_STEP}, ${SDF_TRACE_MAX_STEP});`,
      '  }',
      `  return ${SHADER_INFINITY};`,
      '}',
      `vec3 ${this.normalFunctionName}(vec3 point) {`,
      '  vec2 sdfEpsilon = vec2(0.002, 0.0);',
      '  return normalize(vec3(',
      `    ${this.distanceFunctionName}(point + sdfEpsilon.xyy) - ${this.distanceFunctionName}(point - sdfEpsilon.xyy),`,
      `    ${this.distanceFunctionName}(point + sdfEpsilon.yxy) - ${this.distanceFunctionName}(point - sdfEpsilon.yxy),`,
      `    ${this.distanceFunctionName}(point + sdfEpsilon.yyx) - ${this.distanceFunctionName}(point - sdfEpsilon.yyx)`,
      '  ));',
      '}'
    ].join('');
  }

  getIntersectCode() {
    return `float ${this.intersectionName} = ${this.intersectFunctionName}(origin, ray, inverseRay);`;
  }

  getShadowTestCode() {
    if (isTransparentMaterial(this.material)) {
      return '';
    }
    return `if(${this.intersectFunctionName}(origin, ray, inverseRay) < 1.0) return 0.0;`;
  }

  getMinimumIntersectCode() {
    return `if(${this.intersectionName} < t) t = ${this.intersectionName};`;
  }

  getNormalCalculationCode() {
    return [
      `else if(t == ${this.intersectionName}) {`,
      `normal = ${this.normalFunctionName}(hit);`,
      sceneObjectUsesSurfaceShaderUtilities(this) ? `surfaceObjectPoint = hit - ${this.centerUniformName};` : '',
      createObjectSurfaceShaderSource(this.material, this),
      '}'
    ].join('');
  }

  setMaterial(material) {
    this.material = normalizeMaterial(material);
    if (this.material === MATERIAL.EMISSIVE) {
      this.isEmissionEnabled = true;
    }
    return returnSuccess(undefined);
  }

  cloneForDuplicate(objectId) {
    const duplicateObject = new SdfSceneObject(
      this.centerPosition,
      this.boundsHalfExtents,
      this.parameterA,
      this.parameterB,
      objectId,
      this.material
    );
    Object.setPrototypeOf(duplicateObject, Object.getPrototypeOf(this));
    duplicateObject.displayName = this.displayName ? `${this.displayName} Copy` : '';
    duplicateObject.glossiness = this.glossiness;
    copySceneObjectEmissiveSettings(this, duplicateObject);
    copySceneObjectMaterialProjectionSettings(this, duplicateObject);
    return duplicateObject;
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.centerUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.centerUniformName);
    this.boundsHalfExtentsUniformLocation = readUniformLocation(
      webGlContext,
      program,
      uniformLocationCache,
      this.boundsHalfExtentsUniformName
    );
    this.parameterAUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.parameterAUniformName);
    this.parameterBUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.parameterBUniformName);
    writeVec3(this.previousUniformCenterPosition, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousUniformBoundsHalfExtents, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousUniformParameterA, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousUniformParameterB, Number.NaN, Number.NaN, Number.NaN);
    this.isUniformCenterDirty = true;
    this.areParameterUniformsDirty = true;
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (this.centerUniformLocation !== null && this.isUniformCenterDirty) {
      writeAddVec3(this.uniformCenterPosition, this.centerPosition, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.centerUniformLocation,
        this.uniformCenterPosition,
        this.previousUniformCenterPosition
      );
      this.isUniformCenterDirty = false;
    }

    if (!this.areParameterUniformsDirty) {
      return;
    }

    setChangedCachedVec3UniformValue(
      webGlContext,
      this.boundsHalfExtentsUniformLocation,
      this.boundsHalfExtents,
      this.previousUniformBoundsHalfExtents
    );
    setChangedCachedVec3UniformValue(
      webGlContext,
      this.parameterAUniformLocation,
      this.parameterA,
      this.previousUniformParameterA
    );
    setChangedCachedVec3UniformValue(
      webGlContext,
      this.parameterBUniformLocation,
      this.parameterB,
      this.previousUniformParameterB
    );
    this.areParameterUniformsDirty = false;
  }

  setTemporaryTranslation(translationVector) {
    writeVec3(this.temporaryTranslation, translationVector[0], translationVector[1], translationVector[2]);
    this.isUniformCenterDirty = true;
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.centerPosition, this.centerPosition, translationVector);
    this.isUniformCenterDirty = true;
    return returnSuccess(undefined);
  }

  setCenterPositionComponents(xPosition, yPosition, zPosition) {
    writeVec3(this.centerPosition, xPosition, yPosition, zPosition);
    this.isUniformCenterDirty = true;
    return returnSuccess(undefined);
  }

  getTranslatedCenter() {
    return writeAddVec3(this.uniformCenterPosition, this.centerPosition, this.temporaryTranslation);
  }

  getMinCorner() {
    return writeSubtractVec3(this.boundsMinCorner, this.getTranslatedCenter(), this.boundsHalfExtents);
  }

  getMaxCorner() {
    return writeAddVec3(this.boundsMaxCorner, this.getTranslatedCenter(), this.boundsHalfExtents);
  }

  intersectRay(originPosition, rayDirection) {
    const intersectionDistance = intersectCube(originPosition, rayDirection, this.getMinCorner(), this.getMaxCorner());
    return returnSuccess(intersectionDistance);
  }
}

class CylinderSceneObject extends SdfSceneObject {
  constructor(centerPosition, radius, halfHeight, objectId, material = MATERIAL.DIFFUSE) {
    super(
      centerPosition,
      createVec3(radius, halfHeight, radius),
      createVec3(radius, halfHeight, 0),
      ORIGIN_VECTOR,
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      `  vec2 cylinderDistance = abs(vec2(length(sdfPoint.xz), sdfPoint.y)) - vec2(${this.parameterAUniformName}.x, ${this.parameterAUniformName}.y);`,
      '  return min(max(cylinderDistance.x, cylinderDistance.y), 0.0) + length(max(cylinderDistance, 0.0));'
    ].join('');
  }
}

class ConeSceneObject extends SdfSceneObject {
  constructor(centerPosition, bottomRadius, topRadius, halfHeight, objectId, material = MATERIAL.DIFFUSE) {
    const boundsRadius = Math.max(bottomRadius, topRadius);
    super(
      centerPosition,
      createVec3(boundsRadius, halfHeight, boundsRadius),
      createVec3(bottomRadius, topRadius, halfHeight),
      ORIGIN_VECTOR,
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      `  float coneHalfHeight = ${this.parameterAUniformName}.z;`,
      `  float coneHeightMix = clamp((sdfPoint.y + coneHalfHeight) / max(coneHalfHeight * 2.0, ${SHADER_EPSILON}), 0.0, 1.0);`,
      `  float coneRadius = mix(${this.parameterAUniformName}.x, ${this.parameterAUniformName}.y, coneHeightMix);`,
      '  vec2 coneDistance = vec2(length(sdfPoint.xz) - coneRadius, abs(sdfPoint.y) - coneHalfHeight);',
      '  return min(max(coneDistance.x, coneDistance.y), 0.0) + length(max(coneDistance, 0.0));'
    ].join('');
  }
}

class CapsuleSceneObject extends SdfSceneObject {
  constructor(centerPosition, radius, halfSegmentHeight, objectId, material = MATERIAL.DIFFUSE) {
    super(
      centerPosition,
      createVec3(radius, halfSegmentHeight + radius, radius),
      createVec3(radius, halfSegmentHeight, 0),
      ORIGIN_VECTOR,
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      '  vec3 capsulePoint = sdfPoint;',
      `  capsulePoint.y -= clamp(capsulePoint.y, -${this.parameterAUniformName}.y, ${this.parameterAUniformName}.y);`,
      `  return length(capsulePoint) - ${this.parameterAUniformName}.x;`
    ].join('');
  }
}

class EllipsoidSceneObject extends SdfSceneObject {
  constructor(centerPosition, radii, objectId, material = MATERIAL.DIFFUSE) {
    super(centerPosition, radii, radii, ORIGIN_VECTOR, objectId, material);
  }

  getDistanceFunctionBody() {
    return [
      `  vec3 ellipsoidRadii = max(${this.parameterAUniformName}, vec3(${SHADER_EPSILON}));`,
      '  float ellipsoidScale = min(min(ellipsoidRadii.x, ellipsoidRadii.y), ellipsoidRadii.z);',
      '  return (length(sdfPoint / ellipsoidRadii) - 1.0) * ellipsoidScale;'
    ].join('');
  }
}

class TorusSceneObject extends SdfSceneObject {
  constructor(centerPosition, majorRadius, minorRadius, objectId, material = MATERIAL.DIFFUSE) {
    super(
      centerPosition,
      createVec3(majorRadius + minorRadius, minorRadius, majorRadius + minorRadius),
      createVec3(majorRadius, minorRadius, 0),
      ORIGIN_VECTOR,
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      `  vec2 torusDistance = vec2(length(sdfPoint.xz) - ${this.parameterAUniformName}.x, sdfPoint.y);`,
      `  return length(torusDistance) - ${this.parameterAUniformName}.y;`
    ].join('');
  }
}

class RoundedBoxSceneObject extends SdfSceneObject {
  constructor(centerPosition, halfExtents, radius, objectId, material = MATERIAL.DIFFUSE) {
    super(
      centerPosition,
      addVec3(halfExtents, createVec3(radius, radius, radius)),
      halfExtents,
      createVec3(radius, 0, 0),
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      `  vec3 roundedBoxDistance = abs(sdfPoint) - ${this.parameterAUniformName};`,
      '  float roundedBoxOutside = length(max(roundedBoxDistance, 0.0));',
      '  float roundedBoxInside = min(max(roundedBoxDistance.x, max(roundedBoxDistance.y, roundedBoxDistance.z)), 0.0);',
      `  return roundedBoxOutside + roundedBoxInside - ${this.parameterBUniformName}.x;`
    ].join('');
  }
}

class DiskSceneObject extends CylinderSceneObject {
  constructor(centerPosition, radius, halfThickness, objectId, material = MATERIAL.DIFFUSE) {
    super(centerPosition, radius, halfThickness, objectId, material);
  }
}

class WedgeSceneObject extends SdfSceneObject {
  constructor(centerPosition, halfWidth, halfHeight, halfDepth, objectId, material = MATERIAL.DIFFUSE) {
    super(
      centerPosition,
      createVec3(halfWidth, halfHeight, halfDepth),
      createVec3(halfWidth, halfHeight, halfDepth),
      ORIGIN_VECTOR,
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      `  float wedgeRamp = clamp((sdfPoint.y + ${this.parameterAUniformName}.y) / max(${this.parameterAUniformName}.y * 2.0, ${SHADER_EPSILON}), 0.0, 1.0);`,
      `  float wedgeWidth = mix(${this.parameterAUniformName}.x, 0.0, wedgeRamp);`,
      `  vec3 wedgeDistance = vec3(abs(sdfPoint.x) - wedgeWidth, abs(sdfPoint.y) - ${this.parameterAUniformName}.y, abs(sdfPoint.z) - ${this.parameterAUniformName}.z);`,
      '  return min(max(wedgeDistance.x, max(wedgeDistance.y, wedgeDistance.z)), 0.0) + length(max(wedgeDistance, 0.0));'
    ].join('');
  }
}

class TriangularPrismSceneObject extends WedgeSceneObject {
  constructor(centerPosition, halfWidth, halfHeight, halfDepth, objectId, material = MATERIAL.DIFFUSE) {
    super(centerPosition, halfWidth, halfHeight, halfDepth, objectId, material);
  }
}

class MetaballsSceneObject extends SdfSceneObject {
  constructor(centerPosition, radius, objectId, material = MATERIAL.DIFFUSE) {
    super(
      centerPosition,
      createVec3(radius * 2.2, radius * 1.55, radius * 1.35),
      createVec3(radius, radius * 0.64, 0.18),
      ORIGIN_VECTOR,
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      `  float metaballRadius = ${this.parameterAUniformName}.x;`,
      `  float metaballBlend = ${this.parameterAUniformName}.z;`,
      `  float metaballOne = length(sdfPoint - vec3(-${this.parameterAUniformName}.y, 0.0, 0.0)) - metaballRadius;`,
      `  float metaballTwo = length(sdfPoint - vec3(${this.parameterAUniformName}.y, 0.0, 0.0)) - metaballRadius;`,
      `  float metaballThree = length(sdfPoint - vec3(0.0, ${this.parameterAUniformName}.y * 0.72, ${this.parameterAUniformName}.y * 0.45)) - metaballRadius * 0.82;`,
      '  float metaballMixA = clamp(0.5 + 0.5 * (metaballTwo - metaballOne) / metaballBlend, 0.0, 1.0);',
      '  float metaballDistance = mix(metaballTwo, metaballOne, metaballMixA) - metaballBlend * metaballMixA * (1.0 - metaballMixA);',
      '  float metaballMixB = clamp(0.5 + 0.5 * (metaballThree - metaballDistance) / metaballBlend, 0.0, 1.0);',
      '  return mix(metaballThree, metaballDistance, metaballMixB) - metaballBlend * metaballMixB * (1.0 - metaballMixB);'
    ].join('');
  }
}

class CsgSceneObject extends SdfSceneObject {
  constructor(centerPosition, size, objectId, material = MATERIAL.DIFFUSE) {
    super(
      centerPosition,
      createVec3(size, size, size),
      createVec3(size * 0.58, size * 0.18, size * 0.52),
      ORIGIN_VECTOR,
      objectId,
      material
    );
  }

  getDistanceFunctionBody() {
    return [
      `  vec3 csgBoxDistance = abs(sdfPoint) - vec3(${this.parameterAUniformName}.x);`,
      '  float csgBox = length(max(csgBoxDistance, 0.0)) + min(max(csgBoxDistance.x, max(csgBoxDistance.y, csgBoxDistance.z)), 0.0);',
      `  float csgSphere = length(sdfPoint - vec3(${this.parameterAUniformName}.y)) - ${this.parameterAUniformName}.z;`,
      '  return max(csgBox, -csgSphere);'
    ].join('');
  }
}

class MandelbulbSceneObject extends SdfSceneObject {
  constructor(centerPosition, radius, objectId, material = MATERIAL.DIFFUSE) {
    super(centerPosition, createVec3(radius, radius, radius), createVec3(radius, 8, 0), ORIGIN_VECTOR, objectId, material);
  }

  getDistanceFunctionBody() {
    return [
      `  vec3 mandelPoint = sdfPoint / max(${this.parameterAUniformName}.x, ${SHADER_EPSILON});`,
      '  vec3 mandelZ = mandelPoint;',
      '  float mandelDerivative = 1.0;',
      '  float mandelRadius = 0.0;',
      '  for(int mandelStep = 0; mandelStep < 6; mandelStep++) {',
      '    mandelRadius = max(length(mandelZ), 0.0001);',
      '    if(mandelRadius > 2.0) break;',
      '    float mandelTheta = acos(clamp(mandelZ.z / mandelRadius, -1.0, 1.0));',
      '    float mandelPhi = atan(mandelZ.y, mandelZ.x);',
      `    float mandelPower = ${this.parameterAUniformName}.y;`,
      '    mandelDerivative = pow(mandelRadius, mandelPower - 1.0) * mandelPower * mandelDerivative + 1.0;',
      '    float mandelScale = pow(mandelRadius, mandelPower);',
      '    mandelTheta *= mandelPower;',
      '    mandelPhi *= mandelPower;',
      '    mandelZ = mandelScale * vec3(sin(mandelTheta) * cos(mandelPhi), sin(mandelPhi) * sin(mandelTheta), cos(mandelTheta)) + mandelPoint;',
      '  }',
      `  return 0.5 * log(max(mandelRadius, 0.0001)) * mandelRadius / mandelDerivative * ${this.parameterAUniformName}.x;`
    ].join('');
  }
}

class SdfFractalSceneObject extends SdfSceneObject {
  constructor(centerPosition, radius, objectId, material = MATERIAL.DIFFUSE) {
    super(centerPosition, createVec3(radius, radius, radius), createVec3(radius, 0.34, 0.16), ORIGIN_VECTOR, objectId, material);
  }

  getDistanceFunctionBody() {
    return [
      `  vec3 fractalPoint = sdfPoint / max(${this.parameterAUniformName}.x, ${SHADER_EPSILON});`,
      '  float fractalScale = 1.0;',
      '  for(int fractalStep = 0; fractalStep < 5; fractalStep++) {',
      '    fractalPoint = abs(fractalPoint);',
      `    fractalPoint = fractalPoint * 2.05 - vec3(${this.parameterAUniformName}.y);`,
      '    fractalScale *= 2.05;',
      '  }',
      `  vec3 fractalBoxDistance = abs(fractalPoint) - vec3(${this.parameterAUniformName}.z);`,
      '  float fractalBox = length(max(fractalBoxDistance, 0.0)) + min(max(fractalBoxDistance.x, max(fractalBoxDistance.y, fractalBoxDistance.z)), 0.0);',
      `  return fractalBox / fractalScale * ${this.parameterAUniformName}.x;`
    ].join('');
  }
}

class AreaLightSceneObject extends RoundedBoxSceneObject {
  constructor(centerPosition, halfExtents, radius, objectId) {
    super(centerPosition, halfExtents, radius, objectId, MATERIAL.DIFFUSE);
  }

  getShadowTestCode() {
    return '';
  }

  getNormalCalculationCode() {
    return [
      `else if(t == ${this.intersectionName}) {`,
      `normal = ${this.normalFunctionName}(hit);`,
      'surfaceColor = lightColor;',
      'surfaceLightResponse = 0.0;',
      'accumulatedColor += colorMask * lightColor * lightIntensity * 3.2;',
      newDiffuseRaySource,
      '}'
    ].join('');
  }
}

class LightSceneObject {
  constructor(applicationState) {
    this.objectId = 'light';
    this.entityId = 'light';
    this.parentEntityId = null;
    this.displayName = 'Light';
    this.isHidden = false;
    this.isLocked = false;
    this.applicationState = applicationState;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformLightPosition = createVec3(0, 0, 0);
    this.previousUniformLightPosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.temporaryLightPosition = createVec3(0, 0, 0);
    this.clampedLightPosition = createVec3(0, 0, 0);
    this.translatedLightPosition = createVec3(0, 0, 0);
    this.selectionHalfExtentVector = createVec3(0, 0, 0);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.components = Object.freeze({
      light: Object.freeze({
        label: 'Light',
        summary: 'Scene light'
      })
    });
    this.lightUniformLocation = null;
  }

  getGlobalCode() {
    return 'uniform vec3 light;';
  }

  getIntersectCode() {
    return '';
  }

  getShadowTestCode() {
    return '';
  }

  getMinimumIntersectCode() {
    return '';
  }

  getNormalCalculationCode() {
    return '';
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.lightUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, 'light');
    writeVec3(this.previousUniformLightPosition, Number.NaN, Number.NaN, Number.NaN);
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (this.lightUniformLocation !== null) {
      writeAddVec3(this.uniformLightPosition, this.applicationState.lightPosition, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.lightUniformLocation,
        this.uniformLightPosition,
        this.previousUniformLightPosition
      );
    }
  }

  setTemporaryTranslation(translationVector) {
    writeAddVec3(this.temporaryLightPosition, this.applicationState.lightPosition, translationVector);
    writeClampLightPosition(this.clampedLightPosition, this.temporaryLightPosition, this.applicationState.lightSize);
    writeSubtractVec3(this.temporaryTranslation, this.clampedLightPosition, this.applicationState.lightPosition);
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.temporaryLightPosition, this.applicationState.lightPosition, translationVector);
    writeClampLightPosition(this.applicationState.lightPosition, this.temporaryLightPosition, this.applicationState.lightSize);
    return returnSuccess(undefined);
  }

  getMinCorner() {
    const selectionHalfExtent = Math.max(this.applicationState.lightSize, MIN_LIGHT_SIZE);
    writeVec3(this.selectionHalfExtentVector, selectionHalfExtent, selectionHalfExtent, selectionHalfExtent);
    writeAddVec3(this.translatedLightPosition, this.applicationState.lightPosition, this.temporaryTranslation);
    return writeSubtractVec3(this.boundsMinCorner, this.translatedLightPosition, this.selectionHalfExtentVector);
  }

  getMaxCorner() {
    const selectionHalfExtent = Math.max(this.applicationState.lightSize, MIN_LIGHT_SIZE);
    writeVec3(this.selectionHalfExtentVector, selectionHalfExtent, selectionHalfExtent, selectionHalfExtent);
    writeAddVec3(this.translatedLightPosition, this.applicationState.lightPosition, this.temporaryTranslation);
    return writeAddVec3(this.boundsMaxCorner, this.translatedLightPosition, this.selectionHalfExtentVector);
  }

  intersectRay() {
    return returnSuccess(MAX_INTERSECTION_DISTANCE);
  }
}

const normalizeGroupEntityId = (entityId) => {
  if (entityId === null || entityId === undefined || entityId === '') {
    return null;
  }
  return String(entityId);
};

const normalizeGroupEntityIdList = (entityIds) => {
  const normalizedEntityIds = [];
  const seenEntityIds = new Set();
  for (const entityId of Array.isArray(entityIds) ? entityIds : []) {
    const normalizedEntityId = normalizeGroupEntityId(entityId);
    if (normalizedEntityId !== null && !seenEntityIds.has(normalizedEntityId)) {
      seenEntityIds.add(normalizedEntityId);
      normalizedEntityIds.push(normalizedEntityId);
    }
  }
  return Object.freeze(normalizedEntityIds);
};

const createGroupEntityComponentMap = (childEntityIds) => {
  const childCount = childEntityIds.length;
  return Object.freeze({
    group: Object.freeze({
      label: 'Group',
      summary: `${childCount} ${childCount === 1 ? 'child' : 'children'}`
    })
  });
};

const readGroupEntityVector = (vector, fallbackVector) => {
  const sourceVector = Array.isArray(vector) || ArrayBuffer.isView(vector) ? vector : [];
  return createVec3(
    Number.isFinite(Number(sourceVector[0])) ? Number(sourceVector[0]) : fallbackVector[0],
    Number.isFinite(Number(sourceVector[1])) ? Number(sourceVector[1]) : fallbackVector[1],
    Number.isFinite(Number(sourceVector[2])) ? Number(sourceVector[2]) : fallbackVector[2]
  );
};

class GroupEntity {
  constructor(options = {}) {
    const entityId = normalizeGroupEntityId(options.entityId ?? options.id ?? options.objectId) ?? 'group';
    const childEntityIds = normalizeGroupEntityIdList(options.childEntityIds);
    this.objectId = entityId;
    this.entityId = entityId;
    this.parentEntityId = normalizeGroupEntityId(options.parentEntityId);
    this.displayName = typeof options.name === 'string'
      ? options.name.trim().slice(0, 96)
      : (typeof options.displayName === 'string' ? options.displayName.trim().slice(0, 96) : 'Group');
    this.sceneItemKind = 'group';
    this.kind = 'group';
    this.type = 'group';
    this.isGroup = true;
    this.childEntityIds = childEntityIds;
    this.centerPosition = readGroupEntityVector(
      options.centerPosition ?? options.position ?? options.translation,
      ORIGIN_VECTOR
    );
    this.rotation = readGroupEntityVector(options.rotation, ORIGIN_VECTOR);
    this.scale = readGroupEntityVector(options.scale, createVec3(1, 1, 1));
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.emptyBoundsHalfExtents = createVec3(0.05, 0.05, 0.05);
    this.sceneObjects = Object.freeze([]);
    this.components = createGroupEntityComponentMap(this.childEntityIds);
    this._isHidden = Boolean(options.isHidden ?? options.hidden);
    this._isLocked = Boolean(options.isLocked ?? options.locked);
  }

  get isHidden() {
    return this._isHidden;
  }

  set isHidden(isHidden) {
    this._isHidden = Boolean(isHidden);
    for (const childObject of this.resolveChildObjects()) {
      childObject.isHidden = this._isHidden;
    }
  }

  get isLocked() {
    return this._isLocked;
  }

  set isLocked(isLocked) {
    this._isLocked = Boolean(isLocked);
    for (const childObject of this.resolveChildObjects()) {
      childObject.isLocked = this._isLocked;
    }
  }

  syncChildEntityIds(childEntityIds) {
    this.childEntityIds = normalizeGroupEntityIdList(childEntityIds);
    this.components = createGroupEntityComponentMap(this.childEntityIds);
    return returnSuccess(undefined);
  }

  setSceneObjects(sceneObjects) {
    this.sceneObjects = Object.freeze(Array.isArray(sceneObjects) ? sceneObjects.slice() : []);
    return returnSuccess(undefined);
  }

  resolveChildObjects() {
    const childEntityIdSet = new Set(this.childEntityIds);
    return this.sceneObjects.filter((sceneObject) => (
      sceneObject !== this &&
      childEntityIdSet.has(readSceneObjectEntityId(sceneObject))
    ));
  }

  addChild(sceneObject) {
    const childEntityId = readSceneObjectEntityId(sceneObject);
    if (childEntityId === null || childEntityId === this.entityId) {
      return returnSuccess(false);
    }
    sceneObject.parentEntityId = this.entityId;
    return this.syncChildEntityIds([...this.childEntityIds, childEntityId]);
  }

  removeChild(sceneObject) {
    const childEntityId = readSceneObjectEntityId(sceneObject);
    if (childEntityId === null) {
      return returnSuccess(false);
    }
    if (sceneObject.parentEntityId === this.entityId) {
      sceneObject.parentEntityId = null;
    }
    return this.syncChildEntityIds(this.childEntityIds.filter((entityId) => entityId !== childEntityId));
  }

  getGlobalCode() {
    return '';
  }

  getIntersectCode() {
    return '';
  }

  getShadowTestCode() {
    return '';
  }

  getMinimumIntersectCode() {
    return '';
  }

  getNormalCalculationCode() {
    return '';
  }

  cacheUniformLocations() {
    return returnSuccess(undefined);
  }

  setUniforms() {}

  setTemporaryTranslation(translationVector) {
    writeVec3(this.temporaryTranslation, translationVector[0], translationVector[1], translationVector[2]);
    for (const childObject of this.resolveChildObjects()) {
      if (typeof childObject.setTemporaryTranslation === 'function') {
        const [, childError] = childObject.setTemporaryTranslation(translationVector);
        if (childError) {
          return returnFailure(childError.code, childError.message, childError.details);
        }
      }
    }
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.centerPosition, this.centerPosition, translationVector);
    writeVec3(this.temporaryTranslation, 0, 0, 0);
    for (const childObject of this.resolveChildObjects()) {
      if (typeof childObject.commitTranslation === 'function') {
        const [, childError] = childObject.commitTranslation(translationVector);
        if (childError) {
          return returnFailure(childError.code, childError.message, childError.details);
        }
      }
    }
    return returnSuccess(undefined);
  }

  setCenterPositionComponents(xPosition, yPosition, zPosition) {
    const translationVector = createVec3(
      xPosition - this.centerPosition[0],
      yPosition - this.centerPosition[1],
      zPosition - this.centerPosition[2]
    );
    return this.commitTranslation(translationVector);
  }

  getMinCorner() {
    const childObjects = this.resolveChildObjects().filter((childObject) => typeof childObject.getMinCorner === 'function');
    if (childObjects.length === 0) {
      const translatedCenter = writeAddVec3(this.boundsMinCorner, this.centerPosition, this.temporaryTranslation);
      return writeSubtractVec3(this.boundsMinCorner, translatedCenter, this.emptyBoundsHalfExtents);
    }

    writeVec3(this.boundsMinCorner, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    for (const childObject of childObjects) {
      const childMinCorner = childObject.getMinCorner();
      this.boundsMinCorner[0] = Math.min(this.boundsMinCorner[0], childMinCorner[0]);
      this.boundsMinCorner[1] = Math.min(this.boundsMinCorner[1], childMinCorner[1]);
      this.boundsMinCorner[2] = Math.min(this.boundsMinCorner[2], childMinCorner[2]);
    }
    return this.boundsMinCorner;
  }

  getMaxCorner() {
    const childObjects = this.resolveChildObjects().filter((childObject) => typeof childObject.getMaxCorner === 'function');
    if (childObjects.length === 0) {
      const translatedCenter = writeAddVec3(this.boundsMaxCorner, this.centerPosition, this.temporaryTranslation);
      return writeAddVec3(this.boundsMaxCorner, translatedCenter, this.emptyBoundsHalfExtents);
    }

    writeVec3(this.boundsMaxCorner, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const childObject of childObjects) {
      const childMaxCorner = childObject.getMaxCorner();
      this.boundsMaxCorner[0] = Math.max(this.boundsMaxCorner[0], childMaxCorner[0]);
      this.boundsMaxCorner[1] = Math.max(this.boundsMaxCorner[1], childMaxCorner[1]);
      this.boundsMaxCorner[2] = Math.max(this.boundsMaxCorner[2], childMaxCorner[2]);
    }
    return this.boundsMaxCorner;
  }

  intersectRay() {
    return returnSuccess(MAX_INTERSECTION_DISTANCE);
  }
}

const calculateMaterialComplexityWeight = (material) => {
  switch (normalizeMaterial(material)) {
    case MATERIAL.SPECTRAL_GLASS:
    case MATERIAL.CAUSTICS:
    case MATERIAL.FIRE_PLASMA:
    case MATERIAL.DIFFRACTION_GRATING:
    case MATERIAL.BLACKBODY:
    case MATERIAL.HETEROGENEOUS_FOG:
      return 3.5;
    case MATERIAL.GGX_PBR:
    case MATERIAL.ANISOTROPIC_GGX:
    case MATERIAL.SUBSURFACE:
    case MATERIAL.PROCEDURAL:
    case MATERIAL.SDF_FRACTAL:
    case MATERIAL.VOLUMETRIC_SHAFTS:
    case MATERIAL.MOTION_BLUR_STRESS:
    case MATERIAL.THIN_FILM:
    case MATERIAL.VORONOI_CRACKS:
    case MATERIAL.BARK_CORK:
    case MATERIAL.MARBLE:
    case MATERIAL.CERAMIC_GLAZE:
    case MATERIAL.CLEAR_COAT_AUTOMOTIVE:
    case MATERIAL.SKIN_WAX:
    case MATERIAL.SNOW:
    case MATERIAL.AMBER_HONEY:
    case MATERIAL.SOAP_FOAM:
    case MATERIAL.WATER_LIQUID:
    case MATERIAL.ICE_FROSTED_GLASS:
    case MATERIAL.PEARLESCENT_OPAL:
    case MATERIAL.CARBON_FIBRE:
    case MATERIAL.FUR_SHORT_HAIR:
    case MATERIAL.CITRUS_PEEL:
    case MATERIAL.FRUIT_FLESH:
    case MATERIAL.LEAF_CUTICLE:
    case MATERIAL.MOSS_GRASS:
    case MATERIAL.EMISSIVE:
    case MATERIAL.X_RAY:
      return 2.6;
    case MATERIAL.GLASS:
    case MATERIAL.BOKEH:
    case MATERIAL.RETROREFLECTOR:
    case MATERIAL.VELVET:
    case MATERIAL.TOON:
    case MATERIAL.RUBBER:
    case MATERIAL.MATTE_PLASTIC:
    case MATERIAL.WOOD_GRAIN:
    case MATERIAL.LEATHER:
    case MATERIAL.SAND:
    case MATERIAL.WOVEN_FABRIC:
      return 2.0;
    case MATERIAL.MIRROR:
    case MATERIAL.GLOSSY:
      return 1.4;
    default:
      return 1.0;
  }
};

const calculateGeometryComplexityWeight = (sceneObject) => {
  if (sceneObject instanceof MandelbulbSceneObject) {
    return 8.0;
  }
  if (sceneObject instanceof SdfFractalSceneObject) {
    return 7.0;
  }
  if (sceneObject instanceof MetaballsSceneObject) {
    return 5.0;
  }
  if (sceneObject instanceof CsgSceneObject) {
    return 4.5;
  }
  if (sceneObject instanceof TorusSceneObject || sceneObject instanceof RoundedBoxSceneObject) {
    return 3.2;
  }
  if (sceneObject instanceof SdfSceneObject) {
    return 2.6;
  }
  if (sceneObject instanceof SphereSceneObject) {
    return 1.2;
  }
  if (sceneObject instanceof CubeSceneObject) {
    return 1.0;
  }
  if (sceneObject instanceof ReferenceMeshSceneObject) {
    return Math.min(6.0, 1.2 + sceneObject.triangleCount / 80);
  }
  return 0.8;
};

const formatSceneComplexityLabel = (score) => {
  if (score >= 90) {
    return 'Extreme';
  }
  if (score >= 55) {
    return 'High';
  }
  if (score >= 24) {
    return 'Medium';
  }
  return 'Low';
};

const calculateSceneComplexity = (sceneObjects) => {
  let objectCount = 0;
  let sdfObjectCount = 0;
  let transparentObjectCount = 0;
  let complexityScore = 0;

  for (const sceneObject of sceneObjects) {
    if (sceneObject instanceof LightSceneObject || isGroupEntitySceneObject(sceneObject)) {
      continue;
    }

    objectCount += 1;
    if (sceneObject instanceof SdfSceneObject) {
      sdfObjectCount += 1;
    }
    if (isTransparentMaterial(sceneObject.material)) {
      transparentObjectCount += 1;
    }

    const geometryWeight = calculateGeometryComplexityWeight(sceneObject);
    const materialWeight = calculateMaterialComplexityWeight(sceneObject.material);
    complexityScore += geometryWeight * materialWeight;
  }

  const roundedScore = Math.round(complexityScore);
  return Object.freeze({
    score: roundedScore,
    label: objectCount > 0 ? formatSceneComplexityLabel(roundedScore) : 'None',
    objectCount,
    sdfObjectCount,
    transparentObjectCount
  });
};

const writeClampLightPosition = (outputVector, lightPosition, lightSize) => writeVec3(
  outputVector,
  clampNumber(lightPosition[0], lightSize - 1, 1 - lightSize),
  clampNumber(lightPosition[1], lightSize - 1, 1 - lightSize),
  clampNumber(lightPosition[2], lightSize - 1, 1 - lightSize)
);

const clampLightPosition = (lightPosition, lightSize) => writeClampLightPosition(createVec3(0, 0, 0), lightPosition, lightSize);

const intersectSphere = (originPosition, rayDirection, centerPosition, radius) => {
  const toSphereX = originPosition[0] - centerPosition[0];
  const toSphereY = originPosition[1] - centerPosition[1];
  const toSphereZ = originPosition[2] - centerPosition[2];
  const a = dotVec3(rayDirection, rayDirection);
  const b = 2 * (
    toSphereX * rayDirection[0] +
    toSphereY * rayDirection[1] +
    toSphereZ * rayDirection[2]
  );
  const c = toSphereX * toSphereX + toSphereY * toSphereY + toSphereZ * toSphereZ - radius * radius;
  const discriminant = b * b - 4 * a * c;

  if (discriminant > 0) {
    const intersectionDistance = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (intersectionDistance > 0) {
      return intersectionDistance;
    }
  }

  return MAX_INTERSECTION_DISTANCE;
};

const intersectCube = (originPosition, rayDirection, cubeMinCorner, cubeMaxCorner) => {
  const nearX = (cubeMinCorner[0] - originPosition[0]) / rayDirection[0];
  const nearY = (cubeMinCorner[1] - originPosition[1]) / rayDirection[1];
  const nearZ = (cubeMinCorner[2] - originPosition[2]) / rayDirection[2];
  const farX = (cubeMaxCorner[0] - originPosition[0]) / rayDirection[0];
  const farY = (cubeMaxCorner[1] - originPosition[1]) / rayDirection[1];
  const farZ = (cubeMaxCorner[2] - originPosition[2]) / rayDirection[2];
  const tNear = Math.max(
    Math.min(nearX, farX),
    Math.min(nearY, farY),
    Math.min(nearZ, farZ)
  );
  const tFar = Math.min(
    Math.max(nearX, farX),
    Math.max(nearY, farY),
    Math.max(nearZ, farZ)
  );

  if (tNear > 0 && tNear < tFar) {
    return tNear;
  }

  return MAX_INTERSECTION_DISTANCE;
};

const validateRapierRuntime = (rapierRuntime) => {
  const requiredRuntimeKeys = ['World', 'RigidBodyDesc', 'ColliderDesc'];
  for (const runtimeKey of requiredRuntimeKeys) {
    if (!rapierRuntime || !rapierRuntime[runtimeKey]) {
      return returnFailure('rapier-api-missing', `Rapier runtime is missing "${runtimeKey}".`);
    }
  }
  return returnSuccess(undefined);
};

const createRapierWorld = (rapierRuntime) => {
  const world = new rapierRuntime.World({ x: 0, y: PHYSICS_GRAVITY_Y, z: 0 });
  world.timestep = PHYSICS_FIXED_TIMESTEP_SECONDS;
  return world;
};

const createRapierPhysicsWorld = (rapierRuntime) => {
  const [, runtimeError] = validateRapierRuntime(rapierRuntime);
  if (runtimeError) {
    return returnFailure(runtimeError.code, runtimeError.message, runtimeError.details);
  }

  const physicsWorld = new RapierPhysicsWorld(rapierRuntime, createRapierWorld(rapierRuntime));
  logDiagnostic('info', 'physics', 'Rapier physics world created.', Object.freeze({
    gravity: Object.freeze({ x: 0, y: PHYSICS_GRAVITY_Y, z: 0 })
  }));
  return returnSuccess(physicsWorld);
};

const isPhysicsSupportedSceneObject = (sceneObject) => (
  sceneObject instanceof SphereSceneObject ||
  sceneObject instanceof CubeSceneObject
);

const getDefaultPhysicsBodyType = (sceneObject) => (
  sceneObject instanceof SphereSceneObject ? PHYSICS_BODY_TYPE.DYNAMIC : PHYSICS_BODY_TYPE.STATIC
);

const getDefaultPhysicsFriction = (sceneObject) => (
  sceneObject instanceof SphereSceneObject ? PHYSICS_SPHERE_FRICTION : PHYSICS_CUBE_FRICTION
);

const getDefaultPhysicsRestitution = (sceneObject) => (
  sceneObject instanceof SphereSceneObject ? PHYSICS_SPHERE_RESTITUTION : PHYSICS_CUBE_RESTITUTION
);

const getDefaultPhysicsMass = () => DEFAULT_PHYSICS_MASS;

const getDefaultPhysicsGravityScale = () => DEFAULT_PHYSICS_GRAVITY_SCALE;

const readSceneObjectPhysicsBodyType = (sceneObject) => normalizePhysicsBodyType(
  sceneObject.physicsBodyType,
  getDefaultPhysicsBodyType(sceneObject)
);

const readSceneObjectPhysicsFriction = (sceneObject) => normalizeBoundedNumber(
  sceneObject.physicsFriction,
  getDefaultPhysicsFriction(sceneObject),
  MIN_PHYSICS_SURFACE_COEFFICIENT,
  MAX_PHYSICS_SURFACE_COEFFICIENT
);

const readSceneObjectPhysicsRestitution = (sceneObject) => normalizeBoundedNumber(
  sceneObject.physicsRestitution,
  getDefaultPhysicsRestitution(sceneObject),
  MIN_PHYSICS_SURFACE_COEFFICIENT,
  MAX_PHYSICS_SURFACE_COEFFICIENT
);

const readSceneObjectPhysicsMass = (sceneObject) => normalizeBoundedNumber(
  sceneObject.physicsMass,
  getDefaultPhysicsMass(sceneObject),
  MIN_PHYSICS_MASS,
  MAX_PHYSICS_MASS
);

const readSceneObjectPhysicsGravityScale = (sceneObject) => normalizeBoundedNumber(
  sceneObject.physicsGravityScale,
  getDefaultPhysicsGravityScale(sceneObject),
  MIN_PHYSICS_GRAVITY_SCALE,
  MAX_PHYSICS_GRAVITY_SCALE
);

const isPhysicsSpringJointSelectableSceneObject = (sceneObject) => (
  isPhysicsSupportedSceneObject(sceneObject) &&
  sceneObject.isPhysicsEnabled !== false &&
  !sceneObject.isHidden
);

const normalizePhysicsSpringRestLength = (restLength) => normalizeBoundedNumber(
  Number(restLength),
  DEFAULT_PHYSICS_SPRING_REST_LENGTH,
  MIN_PHYSICS_SPRING_REST_LENGTH,
  MAX_PHYSICS_SPRING_REST_LENGTH
);

const normalizePhysicsSpringStiffness = (stiffness) => normalizeBoundedNumber(
  Number(stiffness),
  DEFAULT_PHYSICS_SPRING_STIFFNESS,
  MIN_PHYSICS_SPRING_STIFFNESS,
  MAX_PHYSICS_SPRING_STIFFNESS
);

const normalizePhysicsSpringDamping = (damping) => normalizeBoundedNumber(
  Number(damping),
  DEFAULT_PHYSICS_SPRING_DAMPING,
  MIN_PHYSICS_SPRING_DAMPING,
  MAX_PHYSICS_SPRING_DAMPING
);

const readSceneObjectPhysicsJointId = (sceneObject) => (
  sceneObject && sceneObject.entityId !== undefined
    ? String(sceneObject.entityId)
    : String(sceneObject && sceneObject.objectId)
);

const createPhysicsSpringJointPairKey = (firstObject, secondObject) => {
  const firstId = readSceneObjectPhysicsJointId(firstObject);
  const secondId = readSceneObjectPhysicsJointId(secondObject);
  return firstId < secondId ? `${firstId}:${secondId}` : `${secondId}:${firstId}`;
};

const allocatePhysicsSpringJointId = (applicationState, firstObject, secondObject) => {
  const nextJointId = Number.isInteger(applicationState.nextPhysicsJointId)
    ? applicationState.nextPhysicsJointId
    : 0;
  applicationState.nextPhysicsJointId = nextJointId + 1;
  return `spring-${createPhysicsSpringJointPairKey(firstObject, secondObject)}-${nextJointId}`;
};

const readPhysicsSpringJointRecords = (sceneObject) => (
  Array.isArray(sceneObject && sceneObject.physicsSpringJoints)
    ? sceneObject.physicsSpringJoints
    : []
);

const ensurePhysicsSpringJointRecords = (sceneObject) => {
  if (!Array.isArray(sceneObject.physicsSpringJoints)) {
    sceneObject.physicsSpringJoints = [];
  }
  return sceneObject.physicsSpringJoints;
};

const readPhysicsSpringJointRecordId = (jointRecord, sourceObject, targetObject) => {
  const rawJointId = jointRecord && typeof jointRecord.id === 'string'
    ? jointRecord.id.trim()
    : '';
  return rawJointId || createPhysicsSpringJointPairKey(sourceObject, targetObject);
};

const readRapierImpulseJointHandle = (impulseJoint) => (
  impulseJoint && Number.isFinite(Number(impulseJoint.handle))
    ? Number(impulseJoint.handle)
    : null
);

const createPhysicsSpringJointRecord = (
  jointId,
  targetObject,
  restLength,
  stiffness,
  damping
) => ({
  type: 'spring',
  id: jointId,
  targetObject,
  restLength: normalizePhysicsSpringRestLength(restLength),
  stiffness: normalizePhysicsSpringStiffness(stiffness),
  damping: normalizePhysicsSpringDamping(damping),
  jointHandle: null,
  impulseJoint: null,
  isUserJoint: true
});

const hasPhysicsSpringJointBetweenObjects = (firstObject, secondObject) => (
  readPhysicsSpringJointRecords(firstObject).some((jointRecord) => (
    jointRecord && jointRecord.targetObject === secondObject
  )) ||
  readPhysicsSpringJointRecords(secondObject).some((jointRecord) => (
    jointRecord && jointRecord.targetObject === firstObject
  ))
);

const writePhysicsSpringJointHandleToObjectRecord = (
  ownerObject,
  partnerObject,
  jointId,
  jointRecord,
  impulseJoint
) => {
  const records = ensurePhysicsSpringJointRecords(ownerObject);
  let recordIndex = records.findIndex((candidateRecord) => (
    candidateRecord &&
    (
      (typeof candidateRecord.id === 'string' && candidateRecord.id === jointId) ||
      (!candidateRecord.id && candidateRecord.targetObject === partnerObject)
    )
  ));
  if (recordIndex < 0) {
    if (!jointRecord || jointRecord.isUserJoint !== true) {
      return null;
    }
    records.push(createPhysicsSpringJointRecord(
      jointId,
      partnerObject,
      jointRecord.restLength,
      jointRecord.stiffness,
      jointRecord.damping
    ));
    recordIndex = records.length - 1;
  }

  const existingRecord = records[recordIndex];
  const nextRecord = Object.isFrozen(existingRecord)
    ? { ...existingRecord }
    : existingRecord;
  nextRecord.id = jointId;
  nextRecord.targetObject = partnerObject;
  nextRecord.jointHandle = readRapierImpulseJointHandle(impulseJoint);
  nextRecord.impulseJoint = impulseJoint || null;
  records[recordIndex] = nextRecord;
  return nextRecord;
};

const clearScenePhysicsSpringJointHandles = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    const records = readPhysicsSpringJointRecords(sceneObject);
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const jointRecord = records[recordIndex];
      if (!jointRecord) {
        continue;
      }
      const nextRecord = Object.isFrozen(jointRecord)
        ? { ...jointRecord }
        : jointRecord;
      nextRecord.jointHandle = null;
      nextRecord.impulseJoint = null;
      records[recordIndex] = nextRecord;
    }
  }
};

const removePhysicsSpringJointRecordsById = (sceneObjects, jointId) => {
  let removedRecordCount = 0;
  for (const sceneObject of sceneObjects) {
    const records = readPhysicsSpringJointRecords(sceneObject);
    if (records.length === 0) {
      continue;
    }

    for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
      const jointRecord = records[recordIndex];
      if (
        jointRecord &&
        readPhysicsSpringJointRecordId(jointRecord, sceneObject, jointRecord.targetObject) === jointId
      ) {
        records.splice(recordIndex, 1);
        removedRecordCount += 1;
      }
    }
  }
  return removedRecordCount;
};

const removePhysicsSpringJointRecordsForObject = (sceneObjects, removedObject) => {
  const jointIdsToRemove = new Set();
  for (const sceneObject of sceneObjects) {
    for (const jointRecord of readPhysicsSpringJointRecords(sceneObject)) {
      if (!jointRecord) {
        continue;
      }
      if (sceneObject === removedObject || jointRecord.targetObject === removedObject) {
        jointIdsToRemove.add(readPhysicsSpringJointRecordId(jointRecord, sceneObject, jointRecord.targetObject));
      }
    }
  }

  let removedRecordCount = 0;
  for (const jointId of jointIdsToRemove) {
    removedRecordCount += removePhysicsSpringJointRecordsById(sceneObjects, jointId);
  }
  return removedRecordCount;
};

const findScenePhysicsSpringJointRecordById = (sceneObjects, jointId) => {
  for (const sceneObject of sceneObjects) {
    for (const jointRecord of readPhysicsSpringJointRecords(sceneObject)) {
      if (jointRecord && jointRecord.id === jointId) {
        return Object.freeze({ ownerObject: sceneObject, jointRecord });
      }
    }
  }
  return null;
};

const readUniquePhysicsSpringJointRecords = (sceneObject) => {
  const uniqueJointRecords = [];
  const seenJointIds = new Set();
  for (const jointRecord of readPhysicsSpringJointRecords(sceneObject)) {
    if (!jointRecord || !jointRecord.targetObject) {
      continue;
    }
    const jointId = readPhysicsSpringJointRecordId(jointRecord, sceneObject, jointRecord.targetObject);
    if (seenJointIds.has(jointId)) {
      continue;
    }
    seenJointIds.add(jointId);
    uniqueJointRecords.push(jointRecord);
  }
  return uniqueJointRecords;
};

const readSceneObjectPhysicsJointCenter = (sceneObject) => {
  if (sceneObject instanceof CubeSceneObject) {
    return sceneObject.getCenterPosition();
  }
  if (sceneObject instanceof SphereSceneObject) {
    return sceneObject.getTranslatedCenter();
  }
  return ORIGIN_VECTOR;
};

const measurePhysicsSpringRestLengthBetweenObjects = (firstObject, secondObject) => {
  const firstCenter = readSceneObjectPhysicsJointCenter(firstObject);
  const secondCenter = readSceneObjectPhysicsJointCenter(secondObject);
  const deltaX = secondCenter[0] - firstCenter[0];
  const deltaY = secondCenter[1] - firstCenter[1];
  const deltaZ = secondCenter[2] - firstCenter[2];
  return normalizePhysicsSpringRestLength(Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ));
};

const writeSceneObjectAuthoredTransform = (sceneObject, shouldOverwrite = false) => {
  if (sceneObject instanceof SphereSceneObject) {
    if (shouldOverwrite || !sceneObject.authoredCenterPosition) {
      sceneObject.authoredCenterPosition = cloneVec3(sceneObject.centerPosition);
    }
    return returnSuccess(undefined);
  }
  if (sceneObject instanceof CubeSceneObject) {
    if (shouldOverwrite || !sceneObject.authoredMinCorner || !sceneObject.authoredMaxCorner) {
      sceneObject.authoredMinCorner = cloneVec3(sceneObject.minCorner);
      sceneObject.authoredMaxCorner = cloneVec3(sceneObject.maxCorner);
    }
    return returnSuccess(undefined);
  }
  return returnSuccess(undefined);
};

const restoreSceneObjectAuthoredTransform = (sceneObject) => {
  if (sceneObject instanceof SphereSceneObject && sceneObject.authoredCenterPosition) {
    writeVec3(
      sceneObject.centerPosition,
      sceneObject.authoredCenterPosition[0],
      sceneObject.authoredCenterPosition[1],
      sceneObject.authoredCenterPosition[2]
    );
    sceneObject.setTemporaryTranslation(ORIGIN_VECTOR);
    sceneObject.isUniformCenterDirty = true;
    return returnSuccess(true);
  }
  if (sceneObject instanceof CubeSceneObject && sceneObject.authoredMinCorner && sceneObject.authoredMaxCorner) {
    writeVec3(
      sceneObject.minCorner,
      sceneObject.authoredMinCorner[0],
      sceneObject.authoredMinCorner[1],
      sceneObject.authoredMinCorner[2]
    );
    writeVec3(
      sceneObject.maxCorner,
      sceneObject.authoredMaxCorner[0],
      sceneObject.authoredMaxCorner[1],
      sceneObject.authoredMaxCorner[2]
    );
    sceneObject.setTemporaryTranslation(ORIGIN_VECTOR);
    sceneObject.areUniformBoundsDirty = true;
    return returnSuccess(true);
  }
  return returnSuccess(false);
};

const isFinitePhysicsBodyPosition = (bodyPosition) => (
  Number.isFinite(bodyPosition[0]) &&
  Number.isFinite(bodyPosition[1]) &&
  Number.isFinite(bodyPosition[2])
);

const createRapierCuboidCollider = (rapierRuntime, centerPosition, halfExtents, friction, restitution) => (
  rapierRuntime.ColliderDesc
    .cuboid(halfExtents[0], halfExtents[1], halfExtents[2])
    .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2])
    .setFriction(friction)
    .setRestitution(restitution)
);

const createRapierCuboidBodyCollider = (rapierRuntime, halfExtents, friction, restitution, mass) => (
  rapierRuntime.ColliderDesc
    .cuboid(halfExtents[0], halfExtents[1], halfExtents[2])
    .setFriction(friction)
    .setRestitution(restitution)
    .setMass(mass)
);

const SCENE_OBJECT_PHYSICS_REBUILD_DIRTY_FLAG = '__pathTracerPhysicsRebuildDirty';
const PHYSICS_WORKER_STEP_STATE_INDEX = 0;
const PHYSICS_WORKER_SHARED_STATE_SLOT_COUNT = 8;
const PHYSICS_WORKER_SHARED_MEMORY_REQUIREMENTS = Object.freeze({
  crossOriginOpenerPolicyHeader: 'Cross-Origin-Opener-Policy: same-origin',
  crossOriginEmbedderPolicyHeader: 'Cross-Origin-Embedder-Policy: require-corp',
  reason: 'SharedArrayBuffer physics workers require a cross-origin isolated page.'
});

const markSceneObjectPhysicsRebuildDirty = (sceneObject) => {
  if (sceneObject && typeof sceneObject === 'object') {
    sceneObject[SCENE_OBJECT_PHYSICS_REBUILD_DIRTY_FLAG] = true;
  }
  return returnSuccess(undefined);
};

const clearSceneObjectPhysicsRebuildDirty = (sceneObject) => {
  if (sceneObject && typeof sceneObject === 'object') {
    sceneObject[SCENE_OBJECT_PHYSICS_REBUILD_DIRTY_FLAG] = false;
  }
  return returnSuccess(undefined);
};

const isSceneObjectPhysicsRebuildDirty = (sceneObject) => (
  Boolean(sceneObject && sceneObject[SCENE_OBJECT_PHYSICS_REBUILD_DIRTY_FLAG] === true)
);

const readPhysicsSignatureNumber = (numberValue) => (
  Number.isFinite(Number(numberValue)) ? Number(numberValue).toFixed(6) : 'nan'
);

const appendPhysicsSignatureVector = (signatureParts, vectorValue) => {
  signatureParts.push(
    readPhysicsSignatureNumber(vectorValue && vectorValue[0]),
    readPhysicsSignatureNumber(vectorValue && vectorValue[1]),
    readPhysicsSignatureNumber(vectorValue && vectorValue[2])
  );
};

const readPhysicsSceneRoomSignature = (applicationState) => (
  applicationState && applicationState.environment === ENVIRONMENT.OPEN_SKY_STUDIO
    ? 'open-sky-studio'
    : 'bounded-room'
);

const hasConfiguredPhysicsSpringJoints = (sceneObjects) => (
  sceneObjects.some((sceneObject) => (
    Array.isArray(sceneObject.physicsSpringJoints) && sceneObject.physicsSpringJoints.length > 0
  ))
);

const readSceneObjectPhysicsRebuildSignature = (sceneObject) => {
  const signatureParts = [
    sceneObject && sceneObject.constructor ? sceneObject.constructor.name : 'unknown',
    sceneObject && sceneObject.entityId !== undefined ? String(sceneObject.entityId) : '',
    sceneObject && sceneObject.objectId !== undefined ? String(sceneObject.objectId) : '',
    sceneObject && sceneObject.isHidden ? 'hidden' : 'visible'
  ];

  if (isPhysicsSupportedSceneObject(sceneObject)) {
    signatureParts.push(
      sceneObject.isPhysicsEnabled === false ? 'physics-off' : 'physics-on',
      readSceneObjectPhysicsBodyType(sceneObject),
      readPhysicsSignatureNumber(readSceneObjectPhysicsFriction(sceneObject)),
      readPhysicsSignatureNumber(readSceneObjectPhysicsRestitution(sceneObject)),
      readPhysicsSignatureNumber(readSceneObjectPhysicsMass(sceneObject)),
      readPhysicsSignatureNumber(readSceneObjectPhysicsGravityScale(sceneObject)),
      sceneObject.collideWithObjects !== false ? 'collide' : 'ghost'
    );
    if (sceneObject instanceof SphereSceneObject) {
      appendPhysicsSignatureVector(signatureParts, sceneObject.getTranslatedCenter());
      signatureParts.push(readPhysicsSignatureNumber(sceneObject.radius));
    } else if (sceneObject instanceof CubeSceneObject) {
      appendPhysicsSignatureVector(signatureParts, sceneObject.getMinCorner());
      appendPhysicsSignatureVector(signatureParts, sceneObject.getMaxCorner());
    }
    return signatureParts.join('|');
  }

  if (sceneObject instanceof RoundedBoxSceneObject && sceneObject.isPhysicsEnabled === true) {
    signatureParts.push('rounded-box-physics-on');
    appendPhysicsSignatureVector(signatureParts, sceneObject.getTranslatedCenter());
    appendPhysicsSignatureVector(signatureParts, sceneObject.boundsHalfExtents);
    signatureParts.push(
      readPhysicsSignatureNumber(readSceneObjectPhysicsFriction(sceneObject)),
      readPhysicsSignatureNumber(readSceneObjectPhysicsRestitution(sceneObject))
    );
  }

  return signatureParts.join('|');
};

const createRapierPhysicsWorkerCapability = (
  hostGlobal = (typeof globalThis !== 'undefined' ? globalThis : null)
) => {
  const hasWorker = Boolean(hostGlobal && typeof hostGlobal.Worker === 'function');
  const hasSharedArrayBuffer = Boolean(hostGlobal && typeof hostGlobal.SharedArrayBuffer === 'function');
  const hasAtomics = Boolean(hostGlobal && hostGlobal.Atomics && typeof hostGlobal.Atomics.wait === 'function');
  const isCrossOriginIsolated = Boolean(hostGlobal && hostGlobal.crossOriginIsolated === true);
  const isSupported = hasWorker && hasSharedArrayBuffer && hasAtomics && isCrossOriginIsolated;
  return Object.freeze({
    isSupported,
    hasWorker,
    hasSharedArrayBuffer,
    hasAtomics,
    isCrossOriginIsolated,
    sharedMemoryRequirements: PHYSICS_WORKER_SHARED_MEMORY_REQUIREMENTS
  });
};

const createRapierPhysicsWorkerSharedStepState = (
  workerCapability,
  hostGlobal = (typeof globalThis !== 'undefined' ? globalThis : null)
) => {
  if (!workerCapability || workerCapability.isSupported !== true) {
    return returnFailure(
      'rapier-physics-worker-shared-memory-unavailable',
      'Rapier physics worker shared memory is unavailable.',
      workerCapability ? workerCapability.sharedMemoryRequirements : PHYSICS_WORKER_SHARED_MEMORY_REQUIREMENTS
    );
  }
  const sharedBuffer = new hostGlobal.SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * PHYSICS_WORKER_SHARED_STATE_SLOT_COUNT
  );
  const stepState = new Int32Array(sharedBuffer);
  hostGlobal.Atomics.store(stepState, PHYSICS_WORKER_STEP_STATE_INDEX, 0);
  return returnSuccess(Object.freeze({
    sharedBuffer,
    stepState,
    stepStateIndex: PHYSICS_WORKER_STEP_STATE_INDEX
  }));
};

class RapierPhysicsWorld {
  constructor(rapierRuntime, world) {
    this.rapierRuntime = rapierRuntime;
    this.world = world;
    this.physicsBodies = new Map();
    this.dynamicPhysicsBodies = new Map();
    this.dynamicPhysicsObjects = [];
    this.dynamicPhysicsRigidBodies = [];
    this.physicsAccumulatorSeconds = 0;
    this.sleepCheckCooldownSeconds = 0;
    this.shouldCheckDynamicPhysicsSleep = true;
    this.canReadRawRigidBodyTranslation = true;
    this.bodyTranslationBuffer = createVec3(0, 0, 0);
    this.gravityVectorBuffer = createVec3(0, PHYSICS_GRAVITY_Y, 0);
    this.appliedGravityVector = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.rebuildSceneCallCount = 0;
    this.fullRebuildSceneCallCount = 0;
    this.incrementalRebuildSceneCallCount = 0;
    this.noopRebuildSceneCallCount = 0;
    this.hasCompletedPhysicsSceneRebuild = false;
    this.previousPhysicsSceneObjects = new Set();
    this.scenePhysicsMetadata = new WeakMap();
    this.previousPhysicsSceneObjectCount = 0;
    this.previousPhysicsRoomSignature = '';
    this.collisionEventQueue = this.createCollisionEventQueue();
    this.didDrainCollisionEventsLastStep = false;
    this.hasKnownAwakeDynamicPhysicsObjects = false;
    this.isDynamicPhysicsAwakeCacheDirty = true;
    this.awakeDynamicPhysicsSleepScanCount = 0;
    this.workerCapability = createRapierPhysicsWorkerCapability();
  }

  rebuildScene(sceneObjects, applicationState) {
    this.rebuildSceneCallCount += 1;
    const rebuildPlan = this.createIncrementalRebuildPlan(sceneObjects, applicationState);
    if (rebuildPlan.canSkipRebuild) {
      return this.skipUnchangedSceneRebuild(sceneObjects, applicationState, rebuildPlan);
    }
    if (rebuildPlan.canRebuildIncrementally) {
      return this.rebuildSceneIncrementally(sceneObjects, applicationState, rebuildPlan);
    }
    return this.rebuildSceneFully(sceneObjects, applicationState);
  }

  rebuildSceneFully(sceneObjects, applicationState) {
    const rebuildStartMilliseconds = readCurrentMilliseconds();
    const previousDynamicBodyCount = this.dynamicPhysicsObjects.length;
    this.fullRebuildSceneCallCount += 1;
    this.world = createRapierWorld(this.rapierRuntime);
    this.collisionEventQueue = this.createCollisionEventQueue();
    this.physicsBodies = new Map();
    this.dynamicPhysicsBodies = new Map();
    this.dynamicPhysicsObjects = [];
    this.dynamicPhysicsRigidBodies = [];
    this.physicsAccumulatorSeconds = 0;
    this.sleepCheckCooldownSeconds = 0;
    this.shouldCheckDynamicPhysicsSleep = true;
    this.resetDynamicPhysicsAwakeTracking(false);
    clearScenePhysicsSpringJointHandles(sceneObjects);
    const [, gravityError] = this.applyGlobalGravity(applicationState);
    if (gravityError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier physics world gravity could not be applied during scene rebuild.',
        gravityError
      );
    }
    logDiagnostic('debug', 'physics', 'Rapier physics world reset for scene rebuild.', Object.freeze({
      rebuildSceneCallCount: this.rebuildSceneCallCount,
      previousDynamicBodyCount,
      sceneObjectCount: sceneObjects.length
    }));

    const [, clearError] = this.clearPhysicsBodies(sceneObjects);
    if (clearError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier physics body teardown failed during scene rebuild.',
        clearError
      );
    }

    const [, roomError] = this.addRoomBoundaryColliders(applicationState);
    if (roomError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier room boundary collider rebuild failed.',
        roomError
      );
    }

    for (const sceneObject of sceneObjects) {
      if (sceneObject.isHidden || sceneObject.isPhysicsEnabled === false) {
        continue;
      }

      if (sceneObject instanceof RoundedBoxSceneObject && sceneObject.isPhysicsEnabled === true) {
        const [, roundedBoxError] = this.addFixedRoundedBox(sceneObject);
        if (roundedBoxError) {
          return returnDiagnosticFailure(
            'error',
            'physics',
            'Rapier rounded-box collider rebuild failed.',
            roundedBoxError,
            Object.freeze({
              objectId: sceneObject.objectId,
              entityId: sceneObject.entityId,
              displayName: sceneObject.displayName || '',
              details: roundedBoxError.details === undefined ? null : roundedBoxError.details
            })
          );
        }
        continue;
      }

      if (!isPhysicsSupportedSceneObject(sceneObject)) {
        continue;
      }

      const bodyType = readSceneObjectPhysicsBodyType(sceneObject);
      if (sceneObject instanceof SphereSceneObject) {
        const [, sphereError] = bodyType === PHYSICS_BODY_TYPE.DYNAMIC
          ? this.addDynamicSphere(sceneObject)
          : (bodyType === PHYSICS_BODY_TYPE.KINEMATIC
              ? this.addKinematicSphere(sceneObject)
              : this.addFixedSphere(sceneObject));
        if (sphereError) {
          return returnDiagnosticFailure(
            'error',
            'physics',
            'Rapier sphere body/collider rebuild failed.',
            sphereError,
            Object.freeze({
              objectId: sceneObject.objectId,
              entityId: sceneObject.entityId,
              displayName: sceneObject.displayName || '',
              bodyType,
              details: sphereError.details === undefined ? null : sphereError.details
            })
          );
        }
      } else if (sceneObject instanceof CubeSceneObject) {
        const [, cubeError] = bodyType === PHYSICS_BODY_TYPE.DYNAMIC
          ? this.addDynamicCube(sceneObject)
          : (bodyType === PHYSICS_BODY_TYPE.KINEMATIC
              ? this.addKinematicCube(sceneObject)
              : this.addFixedCube(sceneObject));
        if (cubeError) {
          return returnDiagnosticFailure(
            'error',
            'physics',
            'Rapier cube body/collider rebuild failed.',
            cubeError,
            Object.freeze({
              objectId: sceneObject.objectId,
              entityId: sceneObject.entityId,
              displayName: sceneObject.displayName || '',
              bodyType,
              details: cubeError.details === undefined ? null : cubeError.details
            })
          );
        }
      }
    }

    const [, validationError] = this.validateDynamicPhysicsObjectsHaveBodies(sceneObjects);
    if (validationError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier physics body validation failed after scene rebuild.',
        validationError
      );
    }

    const [, springJointError] = this.addConfiguredSpringJoints(sceneObjects);
    if (springJointError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier scene spring joint rebuild failed.',
        springJointError
      );
    }

    logDiagnostic('debug', 'physics', 'Rapier physics scene rebuilt.', Object.freeze({
      rebuildSceneCallCount: this.rebuildSceneCallCount,
      fullRebuildSceneCallCount: this.fullRebuildSceneCallCount,
      sceneObjectCount: sceneObjects.length,
      dynamicBodyCount: this.dynamicPhysicsObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - rebuildStartMilliseconds)
    }));

    this.rememberPhysicsSceneRebuild(sceneObjects, applicationState);
    return returnSuccess(undefined);
  }

  createCollisionEventQueue() {
    if (!this.rapierRuntime || typeof this.rapierRuntime.EventQueue !== 'function') {
      return null;
    }
    try {
      return new this.rapierRuntime.EventQueue(true);
    } catch (errorValue) {
      logDiagnostic('debug', 'physics', 'Rapier collision EventQueue could not be created.', Object.freeze({
        details: readErrorDetails(errorValue)
      }));
      return null;
    }
  }

  resetDynamicPhysicsAwakeTracking(hasKnownAwakeDynamicPhysicsObjects) {
    this.hasKnownAwakeDynamicPhysicsObjects = Boolean(hasKnownAwakeDynamicPhysicsObjects);
    this.isDynamicPhysicsAwakeCacheDirty = false;
    return returnSuccess(undefined);
  }

  markDynamicPhysicsAwake() {
    this.hasKnownAwakeDynamicPhysicsObjects = true;
    this.isDynamicPhysicsAwakeCacheDirty = false;
    this.shouldCheckDynamicPhysicsSleep = false;
    this.sleepCheckCooldownSeconds = 0;
    return returnSuccess(undefined);
  }

  markDynamicPhysicsAwakeCacheDirty() {
    this.isDynamicPhysicsAwakeCacheDirty = true;
    return returnSuccess(undefined);
  }

  rememberPhysicsSceneRebuild(sceneObjects, applicationState) {
    this.previousPhysicsSceneObjects = new Set(sceneObjects);
    this.previousPhysicsSceneObjectCount = sceneObjects.length;
    this.previousPhysicsRoomSignature = readPhysicsSceneRoomSignature(applicationState);
    for (const sceneObject of sceneObjects) {
      this.scenePhysicsMetadata.set(sceneObject, Object.freeze({
        signature: readSceneObjectPhysicsRebuildSignature(sceneObject),
        isSupported: isPhysicsSupportedSceneObject(sceneObject),
        isActive: this.isSceneObjectActiveInPhysics(sceneObject),
        bodyType: isPhysicsSupportedSceneObject(sceneObject)
          ? readSceneObjectPhysicsBodyType(sceneObject)
          : null
      }));
      clearSceneObjectPhysicsRebuildDirty(sceneObject);
    }
    this.hasCompletedPhysicsSceneRebuild = true;
    return returnSuccess(undefined);
  }

  isSceneObjectActiveInPhysics(sceneObject) {
    return Boolean(
      sceneObject &&
      !sceneObject.isHidden &&
      sceneObject.isPhysicsEnabled !== false &&
      (
        isPhysicsSupportedSceneObject(sceneObject) ||
        sceneObject instanceof RoundedBoxSceneObject
      )
    );
  }

  createIncrementalRebuildPlan(sceneObjects, applicationState) {
    if (!this.hasCompletedPhysicsSceneRebuild) {
      return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'initial-rebuild' });
    }

    if (hasConfiguredPhysicsSpringJoints(sceneObjects)) {
      return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'spring-joints-configured' });
    }

    if (this.previousPhysicsSceneObjectCount !== sceneObjects.length) {
      return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'scene-object-count-changed' });
    }

    const currentSceneObjects = new Set(sceneObjects);
    for (const previousSceneObject of this.previousPhysicsSceneObjects) {
      if (!currentSceneObjects.has(previousSceneObject)) {
        return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'scene-object-membership-changed' });
      }
    }

    const roomSignature = readPhysicsSceneRoomSignature(applicationState);
    if (roomSignature !== this.previousPhysicsRoomSignature) {
      return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'room-boundary-changed' });
    }

    const changedSceneObjects = [];
    for (const sceneObject of sceneObjects) {
      const previousMetadata = this.scenePhysicsMetadata.get(sceneObject);
      if (!previousMetadata) {
        return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'missing-object-metadata' });
      }
      const nextSignature = readSceneObjectPhysicsRebuildSignature(sceneObject);
      if (isSceneObjectPhysicsRebuildDirty(sceneObject) || previousMetadata.signature !== nextSignature) {
        changedSceneObjects.push(sceneObject);
      }
    }

    if (changedSceneObjects.length === 0) {
      return Object.freeze({
        canRebuildIncrementally: false,
        canSkipRebuild: true,
        changedSceneObjects: Object.freeze([]),
        reason: 'unchanged'
      });
    }

    for (const sceneObject of changedSceneObjects) {
      const previousMetadata = this.scenePhysicsMetadata.get(sceneObject);
      if (!isPhysicsSupportedSceneObject(sceneObject)) {
        return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'unsupported-object-changed' });
      }
      if (previousMetadata.isActive && !this.physicsBodies.has(sceneObject)) {
        return Object.freeze({ canRebuildIncrementally: false, canSkipRebuild: false, reason: 'previous-body-not-removable' });
      }
    }

    return Object.freeze({
      canRebuildIncrementally: true,
      canSkipRebuild: false,
      changedSceneObjects: Object.freeze(changedSceneObjects),
      reason: 'dirty-supported-objects'
    });
  }

  skipUnchangedSceneRebuild(sceneObjects, applicationState, rebuildPlan) {
    this.noopRebuildSceneCallCount += 1;
    const [, gravityError] = this.applyGlobalGravity(applicationState);
    if (gravityError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier physics world gravity could not be applied during unchanged scene rebuild.',
        gravityError
      );
    }
    logDiagnostic('debug', 'physics', 'Rapier physics scene rebuild skipped.', Object.freeze({
      rebuildSceneCallCount: this.rebuildSceneCallCount,
      noopRebuildSceneCallCount: this.noopRebuildSceneCallCount,
      sceneObjectCount: sceneObjects.length,
      reason: rebuildPlan.reason
    }));
    return returnSuccess(undefined);
  }

  rebuildSceneIncrementally(sceneObjects, applicationState, rebuildPlan) {
    const rebuildStartMilliseconds = readCurrentMilliseconds();
    this.incrementalRebuildSceneCallCount += 1;
    const [, gravityError] = this.applyGlobalGravity(applicationState);
    if (gravityError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier physics world gravity could not be applied during incremental scene rebuild.',
        gravityError
      );
    }

    for (const sceneObject of rebuildPlan.changedSceneObjects) {
      const [, removeError] = this.removePhysicsBodyForSceneObject(sceneObject);
      if (removeError) {
        return returnDiagnosticFailure(
          'error',
          'physics',
          'Rapier physics body removal failed during incremental scene rebuild.',
          removeError,
          Object.freeze({
            objectId: sceneObject.objectId,
            entityId: sceneObject.entityId,
            displayName: sceneObject.displayName || '',
            details: removeError.details === undefined ? null : removeError.details
          })
        );
      }

      if (sceneObject.isHidden || sceneObject.isPhysicsEnabled === false) {
        const [, clearError] = sceneObject.clearPhysicsRigidBody();
        if (clearError) {
          return returnFailure(clearError.code, clearError.message, clearError.details);
        }
        this.recordSceneObjectPhysicsMetadata(sceneObject);
        continue;
      }

      const [, addError] = this.addSupportedSceneObjectPhysics(sceneObject);
      if (addError) {
        return returnDiagnosticFailure(
          'error',
          'physics',
          'Rapier physics body create failed during incremental scene rebuild.',
          addError,
          Object.freeze({
            objectId: sceneObject.objectId,
            entityId: sceneObject.entityId,
            displayName: sceneObject.displayName || '',
            details: addError.details === undefined ? null : addError.details
          })
        );
      }
      this.recordSceneObjectPhysicsMetadata(sceneObject);
    }

    const [, validationError] = this.validateDynamicPhysicsObjectsHaveBodies(sceneObjects);
    if (validationError) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier physics body validation failed after incremental scene rebuild.',
        validationError
      );
    }

    logDiagnostic('debug', 'physics', 'Rapier physics scene incrementally rebuilt.', Object.freeze({
      rebuildSceneCallCount: this.rebuildSceneCallCount,
      incrementalRebuildSceneCallCount: this.incrementalRebuildSceneCallCount,
      changedObjectCount: rebuildPlan.changedSceneObjects.length,
      dynamicBodyCount: this.dynamicPhysicsObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - rebuildStartMilliseconds)
    }));

    return returnSuccess(undefined);
  }

  recordSceneObjectPhysicsMetadata(sceneObject) {
    this.scenePhysicsMetadata.set(sceneObject, Object.freeze({
      signature: readSceneObjectPhysicsRebuildSignature(sceneObject),
      isSupported: isPhysicsSupportedSceneObject(sceneObject),
      isActive: this.isSceneObjectActiveInPhysics(sceneObject),
      bodyType: isPhysicsSupportedSceneObject(sceneObject)
        ? readSceneObjectPhysicsBodyType(sceneObject)
        : null
    }));
    clearSceneObjectPhysicsRebuildDirty(sceneObject);
    return returnSuccess(undefined);
  }

  addSupportedSceneObjectPhysics(sceneObject) {
    const bodyType = readSceneObjectPhysicsBodyType(sceneObject);
    if (sceneObject instanceof SphereSceneObject) {
      return bodyType === PHYSICS_BODY_TYPE.DYNAMIC
        ? this.addDynamicSphere(sceneObject)
        : (bodyType === PHYSICS_BODY_TYPE.KINEMATIC
            ? this.addKinematicSphere(sceneObject)
            : this.addFixedSphere(sceneObject));
    }
    if (sceneObject instanceof CubeSceneObject) {
      return bodyType === PHYSICS_BODY_TYPE.DYNAMIC
        ? this.addDynamicCube(sceneObject)
        : (bodyType === PHYSICS_BODY_TYPE.KINEMATIC
            ? this.addKinematicCube(sceneObject)
            : this.addFixedCube(sceneObject));
    }
    return returnFailure('unsupported-incremental-physics-object', 'Scene item cannot be rebuilt incrementally by the physics world.');
  }

  removePhysicsBodyForSceneObject(sceneObject) {
    const rigidBody = this.physicsBodies.get(sceneObject);
    if (rigidBody) {
      if (!this.world || typeof this.world.removeRigidBody !== 'function') {
        return returnFailure('rapier-body-removal-unavailable', 'Rapier world cannot remove rigid bodies incrementally.');
      }
      try {
        this.world.removeRigidBody(rigidBody);
      } catch (errorValue) {
        return returnFailure(
          'rapier-body-remove-failed',
          'Rigid body could not be removed from the Rapier world.',
          readErrorDetails(errorValue)
        );
      }
    }

    this.physicsBodies.delete(sceneObject);
    this.dynamicPhysicsBodies.delete(sceneObject);
    const dynamicBodyIndex = this.dynamicPhysicsObjects.indexOf(sceneObject);
    if (dynamicBodyIndex >= 0) {
      this.dynamicPhysicsObjects.splice(dynamicBodyIndex, 1);
      this.dynamicPhysicsRigidBodies.splice(dynamicBodyIndex, 1);
      this.markDynamicPhysicsAwakeCacheDirty();
    }

    const [, clearError] = sceneObject.clearPhysicsRigidBody();
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }
    return returnSuccess(undefined);
  }

  writeWorldGravity(gravityVector) {
    if (!this.world) {
      return returnFailure('rapier-world-missing', 'Rapier world is not available.');
    }

    const nextGravity = {
      x: gravityVector[0],
      y: gravityVector[1],
      z: gravityVector[2]
    };
    try {
      this.world.gravity = nextGravity;
    } catch (errorValue) {
      return returnFailure(
        'rapier-world-gravity-update-failed',
        'Rapier world gravity could not be updated.',
        readErrorDetails(errorValue)
      );
    }
    return returnSuccess(undefined);
  }

  wakeDynamicPhysicsBodies() {
    for (const rigidBody of this.dynamicPhysicsRigidBodies) {
      if (rigidBody && typeof rigidBody.wakeUp === 'function') {
        rigidBody.wakeUp();
      }
    }
    this.shouldCheckDynamicPhysicsSleep = false;
    this.sleepCheckCooldownSeconds = 0;
    return returnSuccess(undefined);
  }

  applyGlobalGravity(applicationState) {
    const gravityVector = writeApplicationStateGravityVector(applicationState, this.gravityVectorBuffer);
    const didChangeGravity = (
      this.appliedGravityVector[0] !== gravityVector[0] ||
      this.appliedGravityVector[1] !== gravityVector[1] ||
      this.appliedGravityVector[2] !== gravityVector[2]
    );

    const [, writeError] = this.writeWorldGravity(gravityVector);
    if (writeError) {
      return returnFailure(writeError.code, writeError.message, writeError.details);
    }

    if (didChangeGravity) {
      writeVec3(
        this.appliedGravityVector,
        gravityVector[0],
        gravityVector[1],
        gravityVector[2]
      );
      const [, wakeError] = this.wakeDynamicPhysicsBodies();
      if (wakeError) {
        return returnFailure(wakeError.code, wakeError.message, wakeError.details);
      }
      logDiagnostic('debug', 'physics', 'Rapier world gravity updated.', Object.freeze({
        gravity: Object.freeze({
          x: gravityVector[0],
          y: gravityVector[1],
          z: gravityVector[2]
        })
      }));
    }

    return returnSuccess(didChangeGravity);
  }

  clearPhysicsBodies(sceneObjects) {
    for (const sceneObject of sceneObjects) {
      if (!isPhysicsSupportedSceneObject(sceneObject)) {
        continue;
      }

      const [, clearError] = sceneObject.clearPhysicsRigidBody();
      if (clearError) {
        return returnFailure(clearError.code, clearError.message, clearError.details);
      }
    }

    return returnSuccess(undefined);
  }

  validateDynamicPhysicsObjectsHaveBodies(sceneObjects) {
    for (const sceneObject of sceneObjects) {
      if (
        !isPhysicsSupportedSceneObject(sceneObject) ||
        sceneObject.isHidden ||
        sceneObject.isPhysicsEnabled === false ||
        readSceneObjectPhysicsBodyType(sceneObject) !== PHYSICS_BODY_TYPE.DYNAMIC
      ) {
        continue;
      }

      if (!sceneObject.physicsRigidBody) {
        return returnFailure('scene-object-missing-rapier-body', 'A dynamic scene item was not attached to a Rapier rigid body.');
      }

      if (this.dynamicPhysicsBodies.get(sceneObject) !== sceneObject.physicsRigidBody) {
        return returnFailure(
          'scene-object-physics-body-mismatch',
          'A dynamic scene item has a Rapier body that is not registered with the physics world.'
        );
      }
    }

    return returnSuccess(undefined);
  }

  addRoomBoundaryColliders(applicationState) {
    const wallThickness = PHYSICS_ROOM_WALL_THICKNESS;
    const wallOffset = 1 + wallThickness;
    const boundarySpecs = [
      [0, -wallOffset, 0, 1, wallThickness, 1]
    ];

    if (applicationState.environment !== ENVIRONMENT.OPEN_SKY_STUDIO) {
      boundarySpecs.push(
        [0, wallOffset, 0, 1, wallThickness, 1],
        [-wallOffset, 0, 0, wallThickness, 1, 1],
        [wallOffset, 0, 0, wallThickness, 1, 1],
        [0, 0, -wallOffset, 1, 1, wallThickness],
        [0, 0, wallOffset, 1, 1, wallThickness]
      );
    }

    for (const boundarySpec of boundarySpecs) {
      const [, boundaryError] = this.addRoomBoundaryCollider(...boundarySpec);
      if (boundaryError) {
        return returnDiagnosticFailure(
          'error',
          'physics',
          'Rapier room boundary collider creation failed.',
          boundaryError,
          Object.freeze({
            boundarySpec: Object.freeze(boundarySpec.slice()),
            details: boundaryError.details === undefined ? null : boundaryError.details
          })
        );
      }
    }

    return returnSuccess(undefined);
  }

  addRoomBoundaryCollider(centerX, centerY, centerZ, halfExtentX, halfExtentY, halfExtentZ) {
    const colliderDescription = this.rapierRuntime.ColliderDesc
      .cuboid(halfExtentX, halfExtentY, halfExtentZ)
      .setTranslation(centerX, centerY, centerZ)
      .setFriction(PHYSICS_CUBE_FRICTION)
      .setRestitution(PHYSICS_CUBE_RESTITUTION)
      .setCollisionGroups(PHYSICS_COLLISION_MASK_FLOOR);
    try {
      this.world.createCollider(colliderDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier room boundary collider create call failed.',
        Object.freeze({
          code: 'rapier-room-boundary-collider-create-failed',
          message: 'Room boundary collider could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          center: Object.freeze({ x: centerX, y: centerY, z: centerZ }),
          halfExtents: Object.freeze({ x: halfExtentX, y: halfExtentY, z: halfExtentZ }),
          details: readErrorDetails(errorValue)
        })
      );
    }
    return returnSuccess(undefined);
  }

  addFixedRoundedBox(roundedBoxObject) {
    const centerPosition = roundedBoxObject.getTranslatedCenter();
    const halfExtents = roundedBoxObject.boundsHalfExtents;
    const colliderDescription = createRapierCuboidCollider(
      this.rapierRuntime,
      centerPosition,
      halfExtents,
      readSceneObjectPhysicsFriction(roundedBoxObject),
      readSceneObjectPhysicsRestitution(roundedBoxObject)
    ).setCollisionGroups(PHYSICS_COLLISION_MASK_OBJECTS);
    try {
      this.world.createCollider(colliderDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier fixed rounded-box collider create call failed.',
        Object.freeze({
          code: 'rapier-fixed-rounded-box-collider-create-failed',
          message: 'Fixed rounded-box collider could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: roundedBoxObject.objectId,
          entityId: roundedBoxObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    return returnSuccess(undefined);
  }

  addConfiguredSpringJoints(sceneObjects) {
    const hasSpringJointSpecs = sceneObjects.some((sceneObject) => (
      Array.isArray(sceneObject.physicsSpringJoints) && sceneObject.physicsSpringJoints.length > 0
    ));
    if (!hasSpringJointSpecs) {
      return returnSuccess(0);
    }

    if (!this.world || !this.rapierRuntime.JointData || typeof this.world.createImpulseJoint !== 'function') {
      return returnFailure('rapier-spring-joints-unavailable', 'Rapier spring joints are not available.');
    }

    const createdJointKeys = new Set();
    let createdJointCount = 0;
    for (const sourceObject of sceneObjects) {
      const springJointSpecs = Array.isArray(sourceObject.physicsSpringJoints)
        ? sourceObject.physicsSpringJoints
        : [];
      if (springJointSpecs.length === 0) {
        continue;
      }

      const sourceBody = this.physicsBodies.get(sourceObject);
      if (!sourceBody) {
        continue;
      }

      for (const springJointSpec of springJointSpecs) {
        const targetObject = springJointSpec && springJointSpec.targetObject;
        const targetBody = this.physicsBodies.get(targetObject);
        if (!targetBody) {
          continue;
        }

        const jointKey = readPhysicsSpringJointRecordId(springJointSpec, sourceObject, targetObject);
        if (createdJointKeys.has(jointKey)) {
          continue;
        }

        const jointData = this.rapierRuntime.JointData.spring(
          normalizePhysicsSpringRestLength(springJointSpec.restLength),
          normalizePhysicsSpringStiffness(springJointSpec.stiffness),
          normalizePhysicsSpringDamping(springJointSpec.damping),
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 }
        );
        let impulseJoint = null;
        try {
          impulseJoint = this.world.createImpulseJoint(jointData, sourceBody, targetBody, true);
        } catch (errorValue) {
          return returnFailure(
            'rapier-spring-joint-create-failed',
            'Spring joint could not be created.',
            readErrorDetails(errorValue)
          );
        }
        writePhysicsSpringJointHandleToObjectRecord(
          sourceObject,
          targetObject,
          jointKey,
          springJointSpec,
          impulseJoint
        );
        writePhysicsSpringJointHandleToObjectRecord(
          targetObject,
          sourceObject,
          jointKey,
          springJointSpec,
          impulseJoint
        );
        createdJointKeys.add(jointKey);
        createdJointCount += 1;
      }
    }

    if (createdJointCount > 0) {
      logDiagnostic('debug', 'physics', 'Rapier spring joints created.', Object.freeze({ createdJointCount }));
    }
    return returnSuccess(createdJointCount);
  }

  removeSpringJoint(jointRecord) {
    if (!jointRecord) {
      return returnSuccess(false);
    }
    if (!this.world || typeof this.world.removeImpulseJoint !== 'function') {
      return returnFailure('rapier-spring-joint-removal-unavailable', 'Rapier spring joint removal is not available.');
    }

    const jointRemovalTarget = jointRecord.impulseJoint || (
      Number.isFinite(Number(jointRecord.jointHandle))
        ? Number(jointRecord.jointHandle)
        : null
    );
    if (jointRemovalTarget === null) {
      return returnSuccess(false);
    }

    try {
      this.world.removeImpulseJoint(jointRemovalTarget, true);
    } catch (errorValue) {
      return returnFailure(
        'rapier-spring-joint-remove-failed',
        'Spring joint could not be removed from the Rapier world.',
        readErrorDetails(errorValue)
      );
    }
    return returnSuccess(true);
  }

  createKinematicBodyDescription(centerPosition) {
    const rigidBodyDescriptionFactory = this.rapierRuntime.RigidBodyDesc;
    if (
      !rigidBodyDescriptionFactory ||
      typeof rigidBodyDescriptionFactory.kinematicPositionBased !== 'function'
    ) {
      return null;
    }

    const bodyDescription = rigidBodyDescriptionFactory
      .kinematicPositionBased()
      .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2]);
    if (typeof bodyDescription.setCanSleep === 'function') {
      bodyDescription.setCanSleep(true);
    }
    return bodyDescription;
  }

  createFixedBodyDescription(centerPosition) {
    const rigidBodyDescriptionFactory = this.rapierRuntime.RigidBodyDesc;
    if (
      !rigidBodyDescriptionFactory ||
      typeof rigidBodyDescriptionFactory.fixed !== 'function'
    ) {
      return null;
    }

    return rigidBodyDescriptionFactory
      .fixed()
      .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2]);
  }

  addFixedCube(cubeObject) {
    const centerPosition = cubeObject.getCenterPosition();
    const bodyDescription = this.createFixedBodyDescription(centerPosition);
    if (bodyDescription) {
      let rigidBody = null;
      try {
        rigidBody = this.world.createRigidBody(bodyDescription);
      } catch (errorValue) {
        return returnDiagnosticFailure(
          'error',
          'physics',
          'Rapier fixed cube body create call failed.',
          Object.freeze({
            code: 'rapier-fixed-cube-body-create-failed',
            message: 'Fixed cube body could not be created.',
            details: readErrorDetails(errorValue)
          }),
          Object.freeze({
            objectId: cubeObject.objectId,
            entityId: cubeObject.entityId,
            details: readErrorDetails(errorValue)
          })
        );
      }

      const bodyColliderDescription = this.rapierRuntime.ColliderDesc
        .cuboid(cubeObject.getHalfExtents()[0], cubeObject.getHalfExtents()[1], cubeObject.getHalfExtents()[2])
        .setFriction(readSceneObjectPhysicsFriction(cubeObject))
        .setRestitution(readSceneObjectPhysicsRestitution(cubeObject))
        .setCollisionGroups(cubeObject.collideWithObjects !== false
          ? PHYSICS_COLLISION_MASK_OBJECTS
          : PHYSICS_COLLISION_MASK_GHOST);
      return this.attachFixedPhysicsBody(cubeObject, rigidBody, bodyColliderDescription);
    }

    const colliderDescription = createRapierCuboidCollider(
      this.rapierRuntime,
      centerPosition,
      cubeObject.getHalfExtents(),
      readSceneObjectPhysicsFriction(cubeObject),
      readSceneObjectPhysicsRestitution(cubeObject)
    ).setCollisionGroups(cubeObject.collideWithObjects !== false
      ? PHYSICS_COLLISION_MASK_OBJECTS
      : PHYSICS_COLLISION_MASK_GHOST);
    try {
      this.world.createCollider(colliderDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier fixed cube collider create call failed.',
        Object.freeze({
          code: 'rapier-fixed-cube-collider-create-failed',
          message: 'Fixed cube collider could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: cubeObject.objectId,
          entityId: cubeObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    return returnSuccess(undefined);
  }

  addDynamicCube(cubeObject) {
    const centerPosition = cubeObject.getCenterPosition();
    const bodyDescription = this.rapierRuntime.RigidBodyDesc
      .dynamic()
      .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2])
      .setGravityScale(readSceneObjectPhysicsGravityScale(cubeObject))
      .setCanSleep(true);

    let rigidBody = null;
    try {
      rigidBody = this.world.createRigidBody(bodyDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier dynamic cube body create call failed.',
        Object.freeze({
          code: 'rapier-dynamic-cube-body-create-failed',
          message: 'Dynamic cube body could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: cubeObject.objectId,
          entityId: cubeObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    const colliderDescription = createRapierCuboidBodyCollider(
      this.rapierRuntime,
      cubeObject.getHalfExtents(),
      readSceneObjectPhysicsFriction(cubeObject),
      readSceneObjectPhysicsRestitution(cubeObject),
      readSceneObjectPhysicsMass(cubeObject)
    ).setCollisionGroups(cubeObject.collideWithObjects !== false
      ? PHYSICS_COLLISION_MASK_OBJECTS
      : PHYSICS_COLLISION_MASK_GHOST);

    return this.attachDynamicPhysicsBody(cubeObject, rigidBody, colliderDescription);
  }

  addKinematicCube(cubeObject) {
    const centerPosition = cubeObject.getCenterPosition();
    const bodyDescription = this.createKinematicBodyDescription(centerPosition);
    if (!bodyDescription) {
      return this.addFixedCube(cubeObject);
    }

    let rigidBody = null;
    try {
      rigidBody = this.world.createRigidBody(bodyDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier kinematic cube body create call failed.',
        Object.freeze({
          code: 'rapier-kinematic-cube-body-create-failed',
          message: 'Kinematic cube body could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: cubeObject.objectId,
          entityId: cubeObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    const colliderDescription = createRapierCuboidBodyCollider(
      this.rapierRuntime,
      cubeObject.getHalfExtents(),
      readSceneObjectPhysicsFriction(cubeObject),
      readSceneObjectPhysicsRestitution(cubeObject),
      readSceneObjectPhysicsMass(cubeObject)
    ).setCollisionGroups(cubeObject.collideWithObjects !== false
      ? PHYSICS_COLLISION_MASK_OBJECTS
      : PHYSICS_COLLISION_MASK_GHOST);

    return this.attachKinematicPhysicsBody(cubeObject, rigidBody, colliderDescription);
  }

  addFixedSphere(sphereObject) {
    const centerPosition = sphereObject.getTranslatedCenter();
    const bodyDescription = this.createFixedBodyDescription(centerPosition);
    if (bodyDescription) {
      let rigidBody = null;
      try {
        rigidBody = this.world.createRigidBody(bodyDescription);
      } catch (errorValue) {
        return returnDiagnosticFailure(
          'error',
          'physics',
          'Rapier fixed sphere body create call failed.',
          Object.freeze({
            code: 'rapier-fixed-sphere-body-create-failed',
            message: 'Fixed sphere body could not be created.',
            details: readErrorDetails(errorValue)
          }),
          Object.freeze({
            objectId: sphereObject.objectId,
            entityId: sphereObject.entityId,
            details: readErrorDetails(errorValue)
          })
        );
      }

      const bodyColliderDescription = this.rapierRuntime.ColliderDesc
        .ball(sphereObject.radius)
        .setFriction(readSceneObjectPhysicsFriction(sphereObject))
        .setRestitution(readSceneObjectPhysicsRestitution(sphereObject))
        .setCollisionGroups(sphereObject.collideWithObjects !== false
          ? PHYSICS_COLLISION_MASK_OBJECTS
          : PHYSICS_COLLISION_MASK_GHOST);
      return this.attachFixedPhysicsBody(sphereObject, rigidBody, bodyColliderDescription);
    }

    const colliderDescription = this.rapierRuntime.ColliderDesc
      .ball(sphereObject.radius)
      .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2])
      .setFriction(readSceneObjectPhysicsFriction(sphereObject))
      .setRestitution(readSceneObjectPhysicsRestitution(sphereObject))
      .setCollisionGroups(sphereObject.collideWithObjects !== false
        ? PHYSICS_COLLISION_MASK_OBJECTS
        : PHYSICS_COLLISION_MASK_GHOST);

    try {
      this.world.createCollider(colliderDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier fixed sphere collider create call failed.',
        Object.freeze({
          code: 'rapier-fixed-sphere-collider-create-failed',
          message: 'Fixed sphere collider could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: sphereObject.objectId,
          entityId: sphereObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    return returnSuccess(undefined);
  }

  addDynamicSphere(sphereObject) {
    const centerPosition = sphereObject.getTranslatedCenter();
    const bodyDescription = this.rapierRuntime.RigidBodyDesc
      .dynamic()
      .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2])
      .setGravityScale(readSceneObjectPhysicsGravityScale(sphereObject))
      .setCanSleep(true);

    let rigidBody = null;
    try {
      rigidBody = this.world.createRigidBody(bodyDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier dynamic sphere body create call failed.',
        Object.freeze({
          code: 'rapier-dynamic-sphere-body-create-failed',
          message: 'Dynamic sphere body could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: sphereObject.objectId,
          entityId: sphereObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    const colliderDescription = this.rapierRuntime.ColliderDesc
      .ball(sphereObject.radius)
      .setFriction(readSceneObjectPhysicsFriction(sphereObject))
      .setRestitution(readSceneObjectPhysicsRestitution(sphereObject))
      .setMass(readSceneObjectPhysicsMass(sphereObject))
      .setCollisionGroups(sphereObject.collideWithObjects !== false
        ? PHYSICS_COLLISION_MASK_OBJECTS
        : PHYSICS_COLLISION_MASK_GHOST);

    return this.attachDynamicPhysicsBody(sphereObject, rigidBody, colliderDescription);
  }

  addKinematicSphere(sphereObject) {
    const centerPosition = sphereObject.getTranslatedCenter();
    const bodyDescription = this.createKinematicBodyDescription(centerPosition);
    if (!bodyDescription) {
      return this.addFixedSphere(sphereObject);
    }

    let rigidBody = null;
    try {
      rigidBody = this.world.createRigidBody(bodyDescription);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier kinematic sphere body create call failed.',
        Object.freeze({
          code: 'rapier-kinematic-sphere-body-create-failed',
          message: 'Kinematic sphere body could not be created.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: sphereObject.objectId,
          entityId: sphereObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    const colliderDescription = this.rapierRuntime.ColliderDesc
      .ball(sphereObject.radius)
      .setFriction(readSceneObjectPhysicsFriction(sphereObject))
      .setRestitution(readSceneObjectPhysicsRestitution(sphereObject))
      .setMass(readSceneObjectPhysicsMass(sphereObject))
      .setCollisionGroups(sphereObject.collideWithObjects !== false
        ? PHYSICS_COLLISION_MASK_OBJECTS
        : PHYSICS_COLLISION_MASK_GHOST);

    return this.attachKinematicPhysicsBody(sphereObject, rigidBody, colliderDescription);
  }

  enableColliderCollisionEvents(colliderDescription) {
    if (
      colliderDescription &&
      typeof colliderDescription.setActiveEvents === 'function' &&
      this.rapierRuntime &&
      this.rapierRuntime.ActiveEvents &&
      this.rapierRuntime.ActiveEvents.COLLISION_EVENTS !== undefined
    ) {
      return colliderDescription.setActiveEvents(this.rapierRuntime.ActiveEvents.COLLISION_EVENTS);
    }
    return colliderDescription;
  }

  attachDynamicPhysicsBody(sceneObject, rigidBody, colliderDescription) {
    try {
      this.world.createCollider(this.enableColliderCollisionEvents(colliderDescription), rigidBody);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier dynamic body collider attach failed.',
        Object.freeze({
          code: 'rapier-dynamic-body-collider-attach-failed',
          message: 'Dynamic body collider could not be attached.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: sceneObject.objectId,
          entityId: sceneObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    const [, attachError] = sceneObject.attachPhysicsRigidBody(rigidBody);
    if (attachError) {
      return returnFailure(attachError.code, attachError.message, attachError.details);
    }

    this.dynamicPhysicsBodies.set(sceneObject, rigidBody);
    this.physicsBodies.set(sceneObject, rigidBody);
    this.dynamicPhysicsObjects.push(sceneObject);
    this.dynamicPhysicsRigidBodies.push(rigidBody);
    this.markDynamicPhysicsAwake();
    return returnSuccess(undefined);
  }

  attachKinematicPhysicsBody(sceneObject, rigidBody, colliderDescription) {
    try {
      this.world.createCollider(this.enableColliderCollisionEvents(colliderDescription), rigidBody);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier kinematic body collider attach failed.',
        Object.freeze({
          code: 'rapier-kinematic-body-collider-attach-failed',
          message: 'Kinematic body collider could not be attached.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: sceneObject.objectId,
          entityId: sceneObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    const [, attachError] = sceneObject.attachPhysicsRigidBody(rigidBody);
    if (attachError) {
      return returnFailure(attachError.code, attachError.message, attachError.details);
    }

    this.physicsBodies.set(sceneObject, rigidBody);
    return returnSuccess(undefined);
  }

  attachFixedPhysicsBody(sceneObject, rigidBody, colliderDescription) {
    try {
      this.world.createCollider(this.enableColliderCollisionEvents(colliderDescription), rigidBody);
    } catch (errorValue) {
      return returnDiagnosticFailure(
        'error',
        'physics',
        'Rapier fixed body collider attach failed.',
        Object.freeze({
          code: 'rapier-fixed-body-collider-attach-failed',
          message: 'Fixed body collider could not be attached.',
          details: readErrorDetails(errorValue)
        }),
        Object.freeze({
          objectId: sceneObject.objectId,
          entityId: sceneObject.entityId,
          details: readErrorDetails(errorValue)
        })
      );
    }
    const [, attachError] = sceneObject.attachPhysicsRigidBody(rigidBody);
    if (attachError) {
      return returnFailure(attachError.code, attachError.message, attachError.details);
    }

    this.physicsBodies.set(sceneObject, rigidBody);
    return returnSuccess(undefined);
  }

  removeDynamicPhysicsBodyAtIndex(bodyIndex) {
    const sceneObject = this.dynamicPhysicsObjects[bodyIndex];
    const rigidBody = this.dynamicPhysicsRigidBodies[bodyIndex];
    if (!sceneObject || !rigidBody) {
      return returnFailure('invalid-physics-body-removal', 'Dynamic physics body removal target is invalid.');
    }

    if (typeof this.world.removeRigidBody !== 'function') {
      return returnFailure('rapier-body-removal-unavailable', 'Rapier world cannot remove dynamic rigid bodies.');
    }

    try {
      this.world.removeRigidBody(rigidBody);
    } catch (errorValue) {
      return returnFailure(
        'rapier-body-removal-failed',
        'Dynamic physics body could not be removed from the Rapier world.',
        readErrorMessage(errorValue)
      );
    }

    const [, clearError] = sceneObject.clearPhysicsRigidBody();
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }

    sceneObject.isPhysicsEnabled = false;
    this.physicsBodies.delete(sceneObject);
    this.dynamicPhysicsBodies.delete(sceneObject);
    this.dynamicPhysicsObjects.splice(bodyIndex, 1);
    this.dynamicPhysicsRigidBodies.splice(bodyIndex, 1);
    this.shouldCheckDynamicPhysicsSleep = true;
    this.markDynamicPhysicsAwakeCacheDirty();
    return returnSuccess(undefined);
  }

  step(elapsedSeconds, shouldStepPhysics, applicationState) {
    if (!shouldStepPhysics || this.dynamicPhysicsObjects.length === 0) {
      return returnSuccess(false);
    }

    const [, gravityError] = this.applyGlobalGravity(applicationState);
    if (gravityError) {
      return returnFailure(gravityError.code, gravityError.message, gravityError.details);
    }

    if (this.sleepCheckCooldownSeconds > 0) {
      this.sleepCheckCooldownSeconds = Math.max(0, this.sleepCheckCooldownSeconds - elapsedSeconds);
      return returnSuccess(false);
    }

    this.physicsAccumulatorSeconds += Math.min(elapsedSeconds, PHYSICS_MAX_FRAME_SECONDS);
    if (this.physicsAccumulatorSeconds < PHYSICS_FIXED_TIMESTEP_SECONDS) {
      return returnSuccess(false);
    }

    if (this.shouldCheckDynamicPhysicsSleep && !this.hasAwakeDynamicPhysicsObjects()) {
      this.physicsAccumulatorSeconds = 0;
      this.sleepCheckCooldownSeconds = PHYSICS_SLEEP_CHECK_INTERVAL_SECONDS;
      return returnSuccess(false);
    }

    this.shouldCheckDynamicPhysicsSleep = false;
    this.sleepCheckCooldownSeconds = 0;
    let didStepWorld = false;

    while (this.physicsAccumulatorSeconds >= PHYSICS_FIXED_TIMESTEP_SECONDS) {
      const [, stepGravityError] = this.applyGlobalGravity(applicationState);
      if (stepGravityError) {
        return returnFailure(stepGravityError.code, stepGravityError.message, stepGravityError.details);
      }
      if (this.collisionEventQueue) {
        this.world.step(this.collisionEventQueue);
      } else {
        this.world.step();
      }
      const [, eventQueueError] = this.drainCollisionEvents();
      if (eventQueueError) {
        return returnFailure(eventQueueError.code, eventQueueError.message, eventQueueError.details);
      }
      this.physicsAccumulatorSeconds -= PHYSICS_FIXED_TIMESTEP_SECONDS;
      didStepWorld = true;
    }

    if (!didStepWorld) {
      return returnSuccess(false);
    }

    const [didMovePhysicsObject, syncError] = this.syncPhysicsObjectsFromBodies();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    if (!didMovePhysicsObject) {
      this.shouldCheckDynamicPhysicsSleep = true;
      const hasAwakeDynamicPhysicsObjects = this.hasAwakeDynamicPhysicsObjects();
      if (!hasAwakeDynamicPhysicsObjects) {
        this.physicsAccumulatorSeconds = 0;
        this.sleepCheckCooldownSeconds = PHYSICS_SLEEP_CHECK_INTERVAL_SECONDS;
      } else {
        this.shouldCheckDynamicPhysicsSleep = false;
      }
    } else {
      this.markDynamicPhysicsAwake();
    }

    return returnSuccess(didMovePhysicsObject);
  }

  drainCollisionEvents() {
    this.didDrainCollisionEventsLastStep = false;
    if (!this.collisionEventQueue || typeof this.collisionEventQueue.drainCollisionEvents !== 'function') {
      return returnSuccess(false);
    }

    try {
      this.collisionEventQueue.drainCollisionEvents(() => {
        this.didDrainCollisionEventsLastStep = true;
      });
    } catch (errorValue) {
      return returnFailure(
        'rapier-collision-event-drain-failed',
        'Rapier collision events could not be drained.',
        readErrorDetails(errorValue)
      );
    }

    if (this.didDrainCollisionEventsLastStep) {
      this.markDynamicPhysicsAwake();
    }
    return returnSuccess(this.didDrainCollisionEventsLastStep);
  }

  hasAwakeDynamicPhysicsObjects() {
    if (!this.isDynamicPhysicsAwakeCacheDirty) {
      return this.hasKnownAwakeDynamicPhysicsObjects;
    }

    this.awakeDynamicPhysicsSleepScanCount += 1;
    const rigidBodies = this.dynamicPhysicsRigidBodies;
    for (let bodyIndex = 0; bodyIndex < rigidBodies.length; bodyIndex += 1) {
      const rigidBody = rigidBodies[bodyIndex];
      if (typeof rigidBody.isSleeping !== 'function' || !rigidBody.isSleeping()) {
        this.resetDynamicPhysicsAwakeTracking(true);
        return true;
      }
    }

    this.resetDynamicPhysicsAwakeTracking(false);
    return false;
  }

  readRigidBodyTranslationInto(rigidBody, outputPosition) {
    if (
      this.canReadRawRigidBodyTranslation &&
      rigidBody &&
      rigidBody.rawSet &&
      typeof rigidBody.rawSet.rbTranslation === 'function' &&
      typeof rigidBody.handle === 'number'
    ) {
      const rawTranslation = rigidBody.rawSet.rbTranslation(rigidBody.handle);
      if (rawTranslation) {
        writeVec3(outputPosition, rawTranslation.x, rawTranslation.y, rawTranslation.z);
        if (typeof rawTranslation.free === 'function') {
          rawTranslation.free();
        }
        return true;
      }
    } else {
      this.canReadRawRigidBodyTranslation = false;
    }

    if (!rigidBody || typeof rigidBody.translation !== 'function') {
      return false;
    }

    const bodyPosition = rigidBody.translation();
    if (!bodyPosition) {
      return false;
    }

    writeVec3(outputPosition, bodyPosition.x, bodyPosition.y, bodyPosition.z);
    return true;
  }

  syncPhysicsObjectsFromBodies() {
    let didMoveAnyObject = false;
    const physicsObjects = this.dynamicPhysicsObjects;
    const rigidBodies = this.dynamicPhysicsRigidBodies;
    const bodyPosition = this.bodyTranslationBuffer;

    for (let bodyIndex = 0; bodyIndex < physicsObjects.length;) {
      const sceneObject = physicsObjects[bodyIndex];
      const rigidBody = rigidBodies[bodyIndex];
      if (!this.readRigidBodyTranslationInto(rigidBody, bodyPosition)) {
        return returnFailure('scene-object-physics-position-unreadable', 'A dynamic scene item has an unreadable Rapier body position.');
      }

      const isFiniteBodyPosition = isFinitePhysicsBodyPosition(bodyPosition);
      if (!isFiniteBodyPosition) {
        const [, removalError] = this.removeDynamicPhysicsBodyAtIndex(bodyIndex);
        if (removalError) {
          return returnFailure(removalError.code, removalError.message, removalError.details);
        }
        didMoveAnyObject = true;
        continue;
      }

      if (bodyPosition[1] < PHYSICS_OUT_OF_BOUNDS_Y) {
        logDiagnostic(
          'warn',
          'physics',
          `Dynamic body "${sceneObject.displayName || sceneObject.entityId || sceneObject.objectId}" fell below PHYSICS_OUT_OF_BOUNDS_Y and was removed.`,
          Object.freeze({
            objectId: sceneObject.objectId,
            y: bodyPosition[1],
            threshold: PHYSICS_OUT_OF_BOUNDS_Y
          })
        );
        const [, removalError] = this.removeDynamicPhysicsBodyAtIndex(bodyIndex);
        if (removalError) {
          return returnFailure(removalError.code, removalError.message, removalError.details);
        }
        didMoveAnyObject = true;
        continue;
      }

      const currentCenterPosition = sceneObject instanceof CubeSceneObject
        ? sceneObject.getCenterPosition()
        : sceneObject.centerPosition;
      const deltaX = Math.abs(bodyPosition[0] - currentCenterPosition[0]);
      const deltaY = Math.abs(bodyPosition[1] - currentCenterPosition[1]);
      const deltaZ = Math.abs(bodyPosition[2] - currentCenterPosition[2]);

      if (
        deltaX > PHYSICS_POSITION_EPSILON ||
        deltaY > PHYSICS_POSITION_EPSILON ||
        deltaZ > PHYSICS_POSITION_EPSILON
      ) {
        const [, centerError] = sceneObject.setCenterPositionComponents(bodyPosition[0], bodyPosition[1], bodyPosition[2]);
        if (centerError) {
          return returnFailure(centerError.code, centerError.message, centerError.details);
        }
        didMoveAnyObject = true;
      }

      bodyIndex += 1;
    }

    return returnSuccess(didMoveAnyObject);
  }
}

class GpuBenchmarkTimer {
  constructor(webGlContext, timerExtension) {
    this.webGlContext = webGlContext;
    this.timerExtension = timerExtension;
    this.pendingQueries = [];
    this.queryPool = [];
    this.activeQuery = null;
    this.previousQueryStartMilliseconds = 0;
    this.previousPollMilliseconds = 0;
  }

  acquireQuery() {
    const pooledQuery = this.queryPool.pop();
    if (pooledQuery) {
      return returnSuccess(pooledQuery);
    }

    const query = this.timerExtension.createQueryEXT();
    if (!query) {
      return returnSuccess(null);
    }

    return returnSuccess(query);
  }

  releaseQuery(query) {
    if (!query) {
      return returnSuccess(undefined);
    }

    if (this.queryPool.length < BENCHMARK_TIMER_QUERY_LIMIT) {
      this.queryPool.push(query);
      return returnSuccess(undefined);
    }

    this.timerExtension.deleteQueryEXT(query);
    return returnSuccess(undefined);
  }

  beginTiming() {
    if (this.activeQuery || this.pendingQueries.length >= BENCHMARK_TIMER_QUERY_LIMIT) {
      return returnSuccess(false);
    }

    const currentMilliseconds = performance.now();
    if (
      this.previousQueryStartMilliseconds > 0 &&
      currentMilliseconds - this.previousQueryStartMilliseconds < BENCHMARK_TIMER_QUERY_INTERVAL_MILLISECONDS
    ) {
      return returnSuccess(false);
    }

    const [query, queryError] = this.acquireQuery();
    if (queryError) {
      return returnFailure(queryError.code, queryError.message, queryError.details);
    }
    if (!query) {
      return returnSuccess(false);
    }

    this.timerExtension.beginQueryEXT(this.timerExtension.TIME_ELAPSED_EXT, query);
    this.activeQuery = query;
    this.previousQueryStartMilliseconds = currentMilliseconds;
    return returnSuccess(true);
  }

  endTiming(renderedSampleCount, lightBounceCount) {
    if (!this.activeQuery) {
      return returnSuccess(false);
    }

    const query = this.activeQuery;
    this.timerExtension.endQueryEXT(this.timerExtension.TIME_ELAPSED_EXT);
    this.pendingQueries.push({
      query,
      renderedSampleCount,
      lightBounceCount
    });
    this.activeQuery = null;
    return returnSuccess(true);
  }

  deletePendingQueries() {
    const timerExtension = this.timerExtension;
    while (this.pendingQueries.length > 0) {
      timerExtension.deleteQueryEXT(this.pendingQueries.pop().query);
    }
    while (this.queryPool.length > 0) {
      timerExtension.deleteQueryEXT(this.queryPool.pop());
    }
    return returnSuccess(undefined);
  }

  readLatestCompletedTiming() {
    const webGlContext = this.webGlContext;
    const timerExtension = this.timerExtension;
    if (this.pendingQueries.length === 0) {
      return returnSuccess(null);
    }

    const currentMilliseconds = performance.now();
    if (
      this.previousPollMilliseconds > 0 &&
      currentMilliseconds - this.previousPollMilliseconds < BENCHMARK_TIMER_POLL_INTERVAL_MILLISECONDS
    ) {
      return returnSuccess(null);
    }
    this.previousPollMilliseconds = currentMilliseconds;

    if (webGlContext.getParameter(timerExtension.GPU_DISJOINT_EXT)) {
      const [, deleteError] = this.deletePendingQueries();
      if (deleteError) {
        return returnFailure(deleteError.code, deleteError.message, deleteError.details);
      }
      return returnSuccess(null);
    }

    let latestTiming = null;
    while (this.pendingQueries.length > 0) {
      const pendingQuery = this.pendingQueries[0];
      const isAvailable = timerExtension.getQueryObjectEXT(
        pendingQuery.query,
        timerExtension.QUERY_RESULT_AVAILABLE_EXT
      );
      if (!isAvailable) {
        return returnSuccess(latestTiming);
      }

      const elapsedNanoseconds = timerExtension.getQueryObjectEXT(
        pendingQuery.query,
        timerExtension.QUERY_RESULT_EXT
      );
      this.pendingQueries.shift();
      const [, releaseError] = this.releaseQuery(pendingQuery.query);
      if (releaseError) {
        return returnFailure(releaseError.code, releaseError.message, releaseError.details);
      }

      if (Number.isFinite(elapsedNanoseconds) && elapsedNanoseconds > 0) {
        latestTiming = {
          durationMilliseconds: elapsedNanoseconds / NANOSECONDS_PER_MILLISECOND,
          renderedSampleCount: pendingQuery.renderedSampleCount,
          lightBounceCount: pendingQuery.lightBounceCount
        };
      }
    }

    return returnSuccess(latestTiming);
  }
}

const createGpuBenchmarkTimer = (webGlContext) => {
  const timerExtension = webGlContext.getExtension('EXT_disjoint_timer_query');
  if (
    !timerExtension ||
    typeof timerExtension.createQueryEXT !== 'function' ||
    typeof timerExtension.beginQueryEXT !== 'function' ||
    typeof timerExtension.endQueryEXT !== 'function' ||
    typeof timerExtension.getQueryObjectEXT !== 'function' ||
    typeof timerExtension.deleteQueryEXT !== 'function' ||
    typeof timerExtension.TIME_ELAPSED_EXT !== 'number' ||
    typeof timerExtension.QUERY_RESULT_AVAILABLE_EXT !== 'number' ||
    typeof timerExtension.QUERY_RESULT_EXT !== 'number' ||
    typeof timerExtension.GPU_DISJOINT_EXT !== 'number'
  ) {
    return returnSuccess(null);
  }

  return returnSuccess(new GpuBenchmarkTimer(webGlContext, timerExtension));
};

const createBenchmarkSnapshot = () => ({
  rendererBackend: 'webgl',
  activeRaysPerSecond: 0,
  estimatedRayBandwidthBytesPerSecond: 0,
  activeRaysPerFrame: 0,
  pathRayBudgetPerFrame: 0,
  samplesPerFrame: 0,
  traceMilliseconds: 0,
  rollingSamplesPerFrame: 0,
  rollingTraceMilliseconds: 0,
  perceptualFramesPerSecond: 0,
  perceptualFrameMilliseconds: 0,
  scoreSampleCount: 0,
  performanceScore: 0,
  renderPixelCount: ACTIVE_RAYS_PER_SAMPLE,
  measurementSource: 'warming-up',
  accumulatedSamples: 0,
  convergenceSampleCount: CONVERGED_SAMPLE_COUNT,
  convergenceProgress: 0,
  isConverged: false,
  isConvergencePaused: false,
  estimatedGpuBufferMemoryBytes: 0,
  sceneComplexityScore: 0,
  sceneComplexityLabel: 'None',
  sceneObjectCount: 0,
  sceneSdfObjectCount: 0,
  sceneTransparentObjectCount: 0
});

const writePausedBenchmarkSnapshot = (benchmarkSnapshot, measurementSource, shouldPauseFrames) => {
  benchmarkSnapshot.activeRaysPerSecond = 0;
  benchmarkSnapshot.estimatedRayBandwidthBytesPerSecond = 0;
  benchmarkSnapshot.activeRaysPerFrame = 0;
  benchmarkSnapshot.pathRayBudgetPerFrame = 0;
  benchmarkSnapshot.samplesPerFrame = 0;
  benchmarkSnapshot.traceMilliseconds = 0;
  benchmarkSnapshot.rollingSamplesPerFrame = 0;
  benchmarkSnapshot.rollingTraceMilliseconds = 0;
  benchmarkSnapshot.scoreSampleCount = 0;
  benchmarkSnapshot.performanceScore = 0;
  benchmarkSnapshot.measurementSource = measurementSource;
  if (shouldPauseFrames) {
    benchmarkSnapshot.perceptualFramesPerSecond = 0;
    benchmarkSnapshot.perceptualFrameMilliseconds = 0;
  }
  return returnSuccess(undefined);
};

class RollingBenchmarkWindow {
  constructor(traceSampleBytes) {
    this.samples = RollingBenchmarkWindow.createSampleBuffer(BENCHMARK_ROLLING_INITIAL_SAMPLE_CAPACITY);
    this.sampleStartIndex = 0;
    this.sampleCount = 0;
    this.traceSampleBytes = traceSampleBytes;
    this.traceSampleCount = 0;
    this.frameSampleCount = 0;
    this.totalActiveRays = 0;
    this.totalPathRayBudget = 0;
    this.totalRenderedSamples = 0;
    this.totalTraceMilliseconds = 0;
    this.totalFrameMilliseconds = 0;
    this.activeFrameSample = null;
    this.measurementSource = 'warming-up';
    this.previousFrameSnapshotMilliseconds = 0;
  }

  static createReusableSample() {
    return {
      kind: 'empty',
      timestampMilliseconds: 0,
      activeRaysPerFrame: 0,
      pathRayBudgetPerFrame: 0,
      renderedSampleCount: 0,
      traceMilliseconds: 0,
      frameMilliseconds: 0,
      frameCount: 0
    };
  }

  static createSampleBuffer(sampleCapacity) {
    const samples = new Array(sampleCapacity);
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      samples[sampleIndex] = RollingBenchmarkWindow.createReusableSample();
    }
    return samples;
  }

  static copySample(targetSample, sourceSample) {
    targetSample.kind = sourceSample.kind;
    targetSample.timestampMilliseconds = sourceSample.timestampMilliseconds;
    targetSample.activeRaysPerFrame = sourceSample.activeRaysPerFrame;
    targetSample.pathRayBudgetPerFrame = sourceSample.pathRayBudgetPerFrame;
    targetSample.renderedSampleCount = sourceSample.renderedSampleCount;
    targetSample.traceMilliseconds = sourceSample.traceMilliseconds;
    targetSample.frameMilliseconds = sourceSample.frameMilliseconds;
    targetSample.frameCount = sourceSample.frameCount;
    return targetSample;
  }

  setTraceSampleBytes(traceSampleBytes) {
    this.traceSampleBytes = traceSampleBytes;
    return returnSuccess(undefined);
  }

  getSampleAtOffset(sampleOffset) {
    return this.samples[(this.sampleStartIndex + sampleOffset) % this.samples.length];
  }

  getOldestSample() {
    return this.sampleCount > 0 ? this.samples[this.sampleStartIndex] : null;
  }

  shouldPruneOldEntries(currentTimeMilliseconds) {
    const oldestSample = this.getOldestSample();
    return Boolean(
      oldestSample &&
      oldestSample.timestampMilliseconds < currentTimeMilliseconds - BENCHMARK_ROLLING_WINDOW_MILLISECONDS
    );
  }

  growSampleBuffer() {
    const oldSamples = this.samples;
    const newSamples = RollingBenchmarkWindow.createSampleBuffer(oldSamples.length * 2);
    let remappedActiveFrameSample = null;
    for (let sampleOffset = 0; sampleOffset < this.sampleCount; sampleOffset += 1) {
      const oldSample = this.getSampleAtOffset(sampleOffset);
      const newSample = RollingBenchmarkWindow.copySample(newSamples[sampleOffset], oldSample);
      if (oldSample === this.activeFrameSample) {
        remappedActiveFrameSample = newSample;
      }
    }

    this.samples = newSamples;
    this.sampleStartIndex = 0;
    this.activeFrameSample = remappedActiveFrameSample;
    return returnSuccess(undefined);
  }

  subtractSample(sample) {
    if (sample.kind === 'trace') {
      this.traceSampleCount -= 1;
      this.totalActiveRays -= sample.activeRaysPerFrame;
      this.totalPathRayBudget -= sample.pathRayBudgetPerFrame;
      this.totalRenderedSamples -= sample.renderedSampleCount;
      this.totalTraceMilliseconds -= sample.traceMilliseconds;
      return returnSuccess(undefined);
    }

    this.frameSampleCount -= sample.frameCount || 1;
    this.totalFrameMilliseconds -= sample.frameMilliseconds;
    if (sample === this.activeFrameSample) {
      this.activeFrameSample = null;
    }
    return returnSuccess(undefined);
  }

  pruneOldEntries(currentTimeMilliseconds) {
    const cutoffMilliseconds = currentTimeMilliseconds - BENCHMARK_ROLLING_WINDOW_MILLISECONDS;
    while (
      this.sampleCount > 0 &&
      this.samples[this.sampleStartIndex].timestampMilliseconds < cutoffMilliseconds
    ) {
      const [, subtractError] = this.subtractSample(this.samples[this.sampleStartIndex]);
      if (subtractError) {
        return returnFailure(subtractError.code, subtractError.message, subtractError.details);
      }
      this.sampleStartIndex = (this.sampleStartIndex + 1) % this.samples.length;
      this.sampleCount -= 1;
    }

    return returnSuccess(undefined);
  }

  pruneOldEntriesIfNeeded(currentTimeMilliseconds) {
    if (!this.shouldPruneOldEntries(currentTimeMilliseconds)) {
      return returnSuccess(undefined);
    }

    return this.pruneOldEntries(currentTimeMilliseconds);
  }

  acquireSampleSlot(timestampMilliseconds) {
    const [, pruneError] = this.pruneOldEntriesIfNeeded(timestampMilliseconds);
    if (pruneError) {
      return returnFailure(pruneError.code, pruneError.message, pruneError.details);
    }

    if (this.sampleCount >= this.samples.length) {
      const [, growError] = this.growSampleBuffer();
      if (growError) {
        return returnFailure(growError.code, growError.message, growError.details);
      }
    }

    const sample = this.samples[(this.sampleStartIndex + this.sampleCount) % this.samples.length];
    this.sampleCount += 1;
    return returnSuccess(sample);
  }

  writeSnapshot(benchmarkSnapshot) {
    const traceSampleCount = Math.max(this.traceSampleCount, 1);
    const frameSampleCount = Math.max(this.frameSampleCount, 1);
    benchmarkSnapshot.activeRaysPerSecond = this.totalTraceMilliseconds > 0
      ? this.totalActiveRays / (this.totalTraceMilliseconds * 0.001)
      : 0;
    benchmarkSnapshot.estimatedRayBandwidthBytesPerSecond =
      benchmarkSnapshot.activeRaysPerSecond * this.traceSampleBytes;
    benchmarkSnapshot.rollingSamplesPerFrame = this.totalRenderedSamples / traceSampleCount;
    benchmarkSnapshot.rollingTraceMilliseconds = this.totalTraceMilliseconds / traceSampleCount;
    benchmarkSnapshot.scoreSampleCount = this.traceSampleCount;
    benchmarkSnapshot.perceptualFramesPerSecond = this.totalFrameMilliseconds > 0
      ? clampNumber(1000 * this.frameSampleCount / this.totalFrameMilliseconds, 0, MAX_PERCEPTUAL_FRAMES_PER_SECOND)
      : 0;
    benchmarkSnapshot.perceptualFrameMilliseconds = this.totalFrameMilliseconds / frameSampleCount;
    benchmarkSnapshot.measurementSource = this.measurementSource;
    benchmarkSnapshot.renderPixelCount = ACTIVE_RAYS_PER_SAMPLE;
    benchmarkSnapshot.performanceScore = calculatePerformanceScore(benchmarkSnapshot);
    return returnSuccess(undefined);
  }

  recordTraceSample(
    benchmarkSnapshot,
    timestampMilliseconds,
    renderedSampleCount,
    lightBounceCount,
    traceMilliseconds,
    measurementSource
  ) {
    if (!Number.isFinite(traceMilliseconds) || traceMilliseconds <= 0 || renderedSampleCount <= 0) {
      return returnSuccess(undefined);
    }

    const activeRaysPerFrame = ACTIVE_RAYS_PER_SAMPLE * renderedSampleCount;
    const pathRayBudgetPerFrame = activeRaysPerFrame * lightBounceCount;
    const [sample, acquireError] = this.acquireSampleSlot(timestampMilliseconds);
    if (acquireError) {
      return returnFailure(acquireError.code, acquireError.message, acquireError.details);
    }

    sample.kind = 'trace';
    sample.timestampMilliseconds = timestampMilliseconds;
    sample.activeRaysPerFrame = activeRaysPerFrame;
    sample.pathRayBudgetPerFrame = pathRayBudgetPerFrame;
    sample.renderedSampleCount = renderedSampleCount;
    sample.traceMilliseconds = traceMilliseconds;
    sample.frameMilliseconds = 0;
    sample.frameCount = 0;
    this.traceSampleCount += 1;
    this.totalActiveRays += activeRaysPerFrame;
    this.totalPathRayBudget += pathRayBudgetPerFrame;
    this.totalRenderedSamples += renderedSampleCount;
    this.totalTraceMilliseconds += traceMilliseconds;
    benchmarkSnapshot.activeRaysPerFrame = activeRaysPerFrame;
    benchmarkSnapshot.pathRayBudgetPerFrame = pathRayBudgetPerFrame;
    benchmarkSnapshot.samplesPerFrame = renderedSampleCount;
    benchmarkSnapshot.traceMilliseconds = traceMilliseconds;
    this.measurementSource = measurementSource;
    return this.writeSnapshot(benchmarkSnapshot);
  }

  recordFramePacing(benchmarkSnapshot, timestampMilliseconds, elapsedSeconds) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return returnSuccess(undefined);
    }

    const frameMilliseconds = elapsedSeconds * 1000;
    if (
      this.activeFrameSample &&
      timestampMilliseconds - this.activeFrameSample.timestampMilliseconds < BENCHMARK_FRAME_BUCKET_MILLISECONDS
    ) {
      this.activeFrameSample.frameCount += 1;
      this.activeFrameSample.frameMilliseconds += frameMilliseconds;
      this.frameSampleCount += 1;
      this.totalFrameMilliseconds += frameMilliseconds;
    } else {
      const [sample, acquireError] = this.acquireSampleSlot(timestampMilliseconds);
      if (acquireError) {
        return returnFailure(acquireError.code, acquireError.message, acquireError.details);
      }

      sample.kind = 'frame';
      sample.timestampMilliseconds = timestampMilliseconds;
      sample.activeRaysPerFrame = 0;
      sample.pathRayBudgetPerFrame = 0;
      sample.renderedSampleCount = 0;
      sample.traceMilliseconds = 0;
      sample.frameMilliseconds = frameMilliseconds;
      sample.frameCount = 1;
      this.activeFrameSample = sample;
      this.frameSampleCount += 1;
      this.totalFrameMilliseconds += frameMilliseconds;
    }

    if (
      this.previousFrameSnapshotMilliseconds > 0 &&
      timestampMilliseconds - this.previousFrameSnapshotMilliseconds < BENCHMARK_UPDATE_INTERVAL_MILLISECONDS
    ) {
      return returnSuccess(undefined);
    }

    this.previousFrameSnapshotMilliseconds = timestampMilliseconds;
    const [, pruneError] = this.pruneOldEntriesIfNeeded(timestampMilliseconds);
    if (pruneError) {
      return returnFailure(pruneError.code, pruneError.message, pruneError.details);
    }

    return this.writeSnapshot(benchmarkSnapshot);
  }
}

const readEffectiveRenderQuality = (applicationState) => {
  const configuredRaysPerPixel = normalizeBoundedInteger(
    applicationState.raysPerPixel,
    DEFAULT_RAYS_PER_PIXEL,
    MIN_RAYS_PER_PIXEL,
    MAX_RAYS_PER_PIXEL
  );
  const configuredLightBounceCount = normalizeBoundedInteger(
    applicationState.lightBounceCount,
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  const isInteractiveQualityThrottleActive = Boolean(applicationState.isRotatingCamera);
  return Object.freeze({
    isInteractiveQualityThrottleActive,
    raysPerPixel: isInteractiveQualityThrottleActive
      ? Math.min(configuredRaysPerPixel, INTERACTIVE_QUALITY_RAYS_PER_PIXEL)
      : configuredRaysPerPixel,
    lightBounceCount: configuredLightBounceCount
  });
};

const isDraftQualityPresetState = (applicationState) => (
  QUALITY_PRESET_STATE_KEYS.every((stateKey) => applicationState[stateKey] === QUALITY_PRESETS.draft[stateKey])
);

const shouldUseDraftPostProcessBypass = (applicationState) => (
  isDraftQualityPresetState(applicationState)
);

class PathTracer {
  constructor(
    webGlContext,
    vertexBuffer,
    framebuffers,
    displayFramebuffers,
    textures,
    displayTextures,
    skyTexture,
    materialAlbedoTexture,
    textureType,
    renderTextureTypes,
    renderProgram,
    renderVertexAttribute,
    temporalDisplayProgram,
    temporalDisplayVertexAttribute,
    gpuBenchmarkTimer
  ) {
    this.webGlContext = webGlContext;
    this.vertexBuffer = vertexBuffer;
    this.framebuffers = framebuffers;
    this.displayFramebuffers = displayFramebuffers;
    this.textures = textures;
    this.displayTextures = displayTextures;
    this.textureSuccessResults = Object.freeze([returnSuccess(textures[0]), returnSuccess(textures[1])]);
    this.displayTextureSuccessResults = Object.freeze([
      returnSuccess(displayTextures[0]),
      returnSuccess(displayTextures[1])
    ]);
    this.skyTexture = skyTexture;
    this.materialAlbedoTexture = materialAlbedoTexture;
    this.textureType = textureType;
    this.renderTextureTypes = renderTextureTypes;
    this.textureTypeIndex = 0;
    this.renderProgram = renderProgram;
    this.renderVertexAttribute = renderVertexAttribute;
    this.temporalDisplayProgram = temporalDisplayProgram;
    this.temporalDisplayVertexAttribute = temporalDisplayVertexAttribute;
    this.gpuBenchmarkTimer = gpuBenchmarkTimer;
    this.renderUniformLocations = createUniformLocationCache();
    this.temporalDisplayUniformLocations = createUniformLocationCache();
    this.tracerUniformLocations = createUniformLocationCache();
    this.temporalDisplayScalarUniformLocations = Object.create(null);
    this.renderScalarUniformLocations = Object.create(null);
    this.tracerFrameScalarUniformValues = Object.create(null);
    this.temporalDisplayScalarUniformValues = Object.create(null);
    this.renderScalarUniformValues = Object.create(null);
    this.previousTracerFrameScalarUniformValues = Object.create(null);
    this.previousTemporalDisplayScalarUniformValues = Object.create(null);
    this.previousRenderScalarUniformValues = Object.create(null);
    this.previousRenderColorExposure = Number.NaN;
    this.renderColorExposureScale = 1;
    this.sceneObjects = [];
    this.sampleCount = 0;
    this.randomSampleSequence = 0;
    this.currentRaysPerPixel = DEFAULT_RAYS_PER_PIXEL;
    this.lastRenderedSampleCount = 0;
    this.wasInteractiveQualityThrottleActive = false;
    this.hasInteractiveCameraMotionDisplayHistory = false;
    this.hasContinuousMotionDisplayHistory = false;
    this.usesMaterialAlbedoTexture = false;
    this.hasLoggedAccumulationPhase = false;
    this.hasLoggedTemporalDisplayPhase = false;
    this.hasLoggedDisplayCompositePhase = false;
    this.tracerProgram = null;
    this.tracerVertexAttribute = -1;
    this.currentTextureIndex = 0;
    this.currentDisplayTextureIndex = 0;
    this.hasDisplayHistory = false;
    this.lastTemporalDisplayInputSampleCount = -1;
    this.lastTemporalDisplayInputTextureIndex = -1;
    this.lastTemporalDisplayBlendFrames = Number.NaN;
    this.lastTemporalDisplayMotionBlurStrength = Number.NaN;
    this.lastTemporalDisplayDenoiserStrength = Number.NaN;
    this.hasValidatedRenderFramebuffer = false;
    this.hasValidatedDisplayFramebuffer = false;
    this.hasSetTracerSamplerUniforms = false;
    this.hasSetTemporalSamplerUniforms = false;
    this.hasSetRenderSamplerUniform = false;
    this.hasCompleteTracerSampleUniforms = false;
    this.hasPendingSceneUniformUpdate = true;
    this.usesSkyTexture = false;
    this.cameraRight = createVec3(1, 0, 0);
    this.cameraUp = createVec3(0, 1, 0);
    this.cameraRayCenter = createVec3(0, 0, 0);
    this.cameraRayClipX = createVec3(0, 0, 0);
    this.cameraRayClipY = createVec3(0, 0, 0);
    this.previousEyePosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRight = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraUp = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRayCenter = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRayClipX = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRayClipY = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousLightColor = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.sampleUniformValues = Object.create(null);
    this.sampleUniformValues.rayJitterX = 0;
    this.sampleUniformValues.rayJitterY = 0;
    this.traceSampleBytes = calculateTraceMemoryBytesPerSample(webGlContext, textureType);
    this.estimatedGpuBufferMemoryBytes = calculateEstimatedGpuBufferMemoryBytes(webGlContext, textureType);
    this.sceneComplexity = calculateSceneComplexity([]);
    this.benchmarkSnapshot = createBenchmarkSnapshot();
    this.benchmarkWindow = new RollingBenchmarkWindow(this.traceSampleBytes);
    this.syncBenchmarkStaticSnapshotFields();
    this.tracerFrameUniformLocations = Object.create(null);
    this.tracerSampleUniformLocations = Object.create(null);
    cacheNamedUniformLocations(
      webGlContext,
      temporalDisplayProgram,
      this.temporalDisplayUniformLocations,
      this.temporalDisplayScalarUniformLocations,
      TEMPORAL_DISPLAY_SCALAR_UNIFORM_NAMES
    );
    cacheNamedUniformLocations(
      webGlContext,
      renderProgram,
      this.renderUniformLocations,
      this.renderScalarUniformLocations,
      RENDER_SCALAR_UNIFORM_NAMES
    );
  }

  syncBenchmarkStaticSnapshotFields() {
    const benchmarkSnapshot = this.benchmarkSnapshot;
    const sceneComplexity = this.sceneComplexity;
    benchmarkSnapshot.estimatedGpuBufferMemoryBytes = this.estimatedGpuBufferMemoryBytes;
    benchmarkSnapshot.sceneComplexityScore = sceneComplexity.score;
    benchmarkSnapshot.sceneComplexityLabel = sceneComplexity.label;
    benchmarkSnapshot.sceneObjectCount = sceneComplexity.objectCount;
    benchmarkSnapshot.sceneSdfObjectCount = sceneComplexity.sdfObjectCount;
    benchmarkSnapshot.sceneTransparentObjectCount = sceneComplexity.transparentObjectCount;
    return returnSuccess(undefined);
  }

  writeBenchmarkRenderState(applicationState) {
    const sampleCount = Math.max(0, this.sampleCount);
    const convergenceSampleCount = normalizeBoundedInteger(
      applicationState.convergenceSampleCount,
      CONVERGED_SAMPLE_COUNT,
      1,
      CONVERGED_SAMPLE_COUNT
    );
    const benchmarkSnapshot = this.benchmarkSnapshot;
    benchmarkSnapshot.accumulatedSamples = sampleCount;
    benchmarkSnapshot.convergenceSampleCount = convergenceSampleCount;
    benchmarkSnapshot.convergenceProgress = clampNumber(sampleCount / convergenceSampleCount, 0, 1);
    benchmarkSnapshot.isConverged = sampleCount >= convergenceSampleCount;
    benchmarkSnapshot.isConvergencePaused = Boolean(applicationState.isConvergencePaused);
    return this.syncBenchmarkStaticSnapshotFields();
  }

  static create(webGlContext) {
    const [vertexBuffer, vertexBufferError] = createBufferWithData(
      webGlContext,
      webGlContext.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]),
      webGlContext.STATIC_DRAW,
      'Path tracer vertex'
    );
    if (vertexBufferError) {
      return returnFailure(vertexBufferError.code, vertexBufferError.message, vertexBufferError.details);
    }

    const renderTextureTypes = readRenderTextureTypes(webGlContext);
    const textureType = renderTextureTypes[0];
    const [firstTexture, firstTextureError] = createRenderTexture(webGlContext, textureType);
    if (firstTextureError) {
      return returnFailure(firstTextureError.code, firstTextureError.message, firstTextureError.details);
    }

    const [secondTexture, secondTextureError] = createRenderTexture(webGlContext, textureType);
    if (secondTextureError) {
      return returnFailure(secondTextureError.code, secondTextureError.message, secondTextureError.details);
    }

    const [firstDisplayTexture, firstDisplayTextureError] = createRenderTexture(webGlContext, textureType);
    if (firstDisplayTextureError) {
      return returnFailure(firstDisplayTextureError.code, firstDisplayTextureError.message, firstDisplayTextureError.details);
    }

    const [secondDisplayTexture, secondDisplayTextureError] = createRenderTexture(webGlContext, textureType);
    if (secondDisplayTextureError) {
      return returnFailure(secondDisplayTextureError.code, secondDisplayTextureError.message, secondDisplayTextureError.details);
    }

    const [firstFramebuffer, firstFramebufferError] = createFramebufferForTexture(webGlContext, firstTexture, 'First path tracer');
    if (firstFramebufferError) {
      return returnFailure(firstFramebufferError.code, firstFramebufferError.message, firstFramebufferError.details);
    }

    const [secondFramebuffer, secondFramebufferError] = createFramebufferForTexture(webGlContext, secondTexture, 'Second path tracer');
    if (secondFramebufferError) {
      return returnFailure(secondFramebufferError.code, secondFramebufferError.message, secondFramebufferError.details);
    }

    const [firstDisplayFramebuffer, firstDisplayFramebufferError] = createFramebufferForTexture(
      webGlContext,
      firstDisplayTexture,
      'First temporal display'
    );
    if (firstDisplayFramebufferError) {
      return returnFailure(firstDisplayFramebufferError.code, firstDisplayFramebufferError.message, firstDisplayFramebufferError.details);
    }

    const [secondDisplayFramebuffer, secondDisplayFramebufferError] = createFramebufferForTexture(
      webGlContext,
      secondDisplayTexture,
      'Second temporal display'
    );
    if (secondDisplayFramebufferError) {
      return returnFailure(secondDisplayFramebufferError.code, secondDisplayFramebufferError.message, secondDisplayFramebufferError.details);
    }

    const [skyTexture, skyTextureError] = createProceduralSkyTexture(webGlContext);
    if (skyTextureError) {
      return returnFailure(skyTextureError.code, skyTextureError.message, skyTextureError.details);
    }

    const [materialAlbedoTexture, materialAlbedoTextureError] = createProceduralMaterialAlbedoTexture(webGlContext);
    if (materialAlbedoTextureError) {
      return returnFailure(
        materialAlbedoTextureError.code,
        materialAlbedoTextureError.message,
        materialAlbedoTextureError.details
      );
    }

    webGlContext.bindTexture(webGlContext.TEXTURE_2D, null);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);

    const [renderProgram, renderProgramError] = createLinkedProgram(webGlContext, renderVertexSource, renderFragmentSource, 'render');
    if (renderProgramError) {
      return returnFailure(renderProgramError.code, renderProgramError.message, renderProgramError.details);
    }

    const renderVertexAttribute = webGlContext.getAttribLocation(renderProgram, 'vertex');
    if (renderVertexAttribute < 0) {
      return returnFailure('attribute-missing', 'Render vertex attribute was not found.');
    }

    const [temporalDisplayProgram, temporalDisplayProgramError] = createLinkedProgram(
      webGlContext,
      renderVertexSource,
      temporalDisplayFragmentSource,
      'temporal display'
    );
    if (temporalDisplayProgramError) {
      return returnFailure(
        temporalDisplayProgramError.code,
        temporalDisplayProgramError.message,
        temporalDisplayProgramError.details
      );
    }

    const temporalDisplayVertexAttribute = webGlContext.getAttribLocation(temporalDisplayProgram, 'vertex');
    if (temporalDisplayVertexAttribute < 0) {
      return returnFailure('attribute-missing', 'Temporal display vertex attribute was not found.');
    }

    const [gpuBenchmarkTimer, gpuBenchmarkTimerError] = createGpuBenchmarkTimer(webGlContext);
    if (gpuBenchmarkTimerError) {
      return returnFailure(gpuBenchmarkTimerError.code, gpuBenchmarkTimerError.message, gpuBenchmarkTimerError.details);
    }

    webGlContext.enableVertexAttribArray(renderVertexAttribute);
    webGlContext.enableVertexAttribArray(temporalDisplayVertexAttribute);
    return returnSuccess(new PathTracer(
      webGlContext,
      vertexBuffer,
      [firstFramebuffer, secondFramebuffer],
      [firstDisplayFramebuffer, secondDisplayFramebuffer],
      [firstTexture, secondTexture],
      [firstDisplayTexture, secondDisplayTexture],
      skyTexture,
      materialAlbedoTexture,
      textureType,
      renderTextureTypes,
      renderProgram,
      renderVertexAttribute,
      temporalDisplayProgram,
      temporalDisplayVertexAttribute,
      gpuBenchmarkTimer
    ));
  }

  commitSceneProgram(sceneObjects, renderSettings, nextTracerProgram, compileStartMilliseconds, compileMode = 'sync') {

    const nextTracerVertexAttribute = this.webGlContext.getAttribLocation(nextTracerProgram, 'vertex');
    if (nextTracerVertexAttribute < 0) {
      this.webGlContext.deleteProgram(nextTracerProgram);
      return returnFailure('attribute-missing', 'Path tracer vertex attribute was not found.');
    }

    if (this.tracerProgram) {
      this.webGlContext.deleteProgram(this.tracerProgram);
    }

    this.sceneObjects = sceneObjects.slice();
    this.sceneComplexity = calculateSceneComplexity(this.sceneObjects);
    const [, staticBenchmarkError] = this.syncBenchmarkStaticSnapshotFields();
    if (staticBenchmarkError) {
      return returnFailure(staticBenchmarkError.code, staticBenchmarkError.message, staticBenchmarkError.details);
    }
    this.usesSkyTexture = renderSettingsUseSkyTexture(renderSettings);
    this.usesMaterialAlbedoTexture = sceneUsesMaterialTextureProjection(this.sceneObjects);
    this.tracerProgram = nextTracerProgram;
    this.tracerVertexAttribute = nextTracerVertexAttribute;
    this.tracerUniformLocations = createUniformLocationCache();
    this.tracerFrameUniformLocations = Object.create(null);
    this.tracerSampleUniformLocations = Object.create(null);
    this.hasCompleteTracerSampleUniforms = false;
    this.hasPendingSceneUniformUpdate = true;
    this.previousTracerFrameScalarUniformValues = Object.create(null);
    this.wasInteractiveQualityThrottleActive = false;
    this.hasInteractiveCameraMotionDisplayHistory = false;
    this.hasContinuousMotionDisplayHistory = false;
    writeVec3(this.previousEyePosition, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRight, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraUp, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayCenter, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayClipX, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayClipY, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousLightColor, Number.NaN, Number.NaN, Number.NaN);
    this.sampleCount = 0;
    this.hasDisplayHistory = false;
    this.resetTemporalDisplayCache();
    this.hasSetTracerSamplerUniforms = false;
    this.hasLoggedAccumulationPhase = false;
    this.hasLoggedTemporalDisplayPhase = false;
    this.hasLoggedDisplayCompositePhase = false;
    this.webGlContext.enableVertexAttribArray(this.tracerVertexAttribute);

    const [, frameUniformCacheError] = this.cacheTracerFrameUniformLocations();
    if (frameUniformCacheError) {
      return returnFailure(frameUniformCacheError.code, frameUniformCacheError.message, frameUniformCacheError.details);
    }

    const [, sampleUniformCacheError] = this.cacheTracerSampleUniformLocations();
    if (sampleUniformCacheError) {
      return returnFailure(sampleUniformCacheError.code, sampleUniformCacheError.message, sampleUniformCacheError.details);
    }

    for (const sceneObject of this.sceneObjects) {
      const [, objectUniformCacheError] = sceneObject.cacheUniformLocations(
        this.webGlContext,
        this.tracerProgram,
        this.tracerUniformLocations
      );
      if (objectUniformCacheError) {
        return returnFailure(
          objectUniformCacheError.code,
          objectUniformCacheError.message,
          objectUniformCacheError.details
        );
      }
    }

    logDiagnostic('info', 'renderer', 'Path tracer shader compiled.', Object.freeze({
      objectCount: this.sceneObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - compileStartMilliseconds),
      compileMode
    }));

    return returnSuccess(undefined);
  }

  setObjects(sceneObjects, renderSettings) {
    const nextFragmentSource = createTracerFragmentSource(sceneObjects, renderSettings);
    const compileStartMilliseconds = readCurrentMilliseconds();
    const [nextTracerProgram, tracerProgramError] = createLinkedProgram(this.webGlContext, tracerVertexSource, nextFragmentSource, 'path tracer');
    if (tracerProgramError) {
      return returnFailure(tracerProgramError.code, tracerProgramError.message, tracerProgramError.details);
    }

    return this.commitSceneProgram(sceneObjects, renderSettings, nextTracerProgram, compileStartMilliseconds, 'sync');
  }

  async setObjectsAsync(sceneObjects, renderSettings, options = Object.freeze({})) {
    const nextFragmentSource = createTracerFragmentSource(sceneObjects, renderSettings);
    const compileStartMilliseconds = readCurrentMilliseconds();
    const [nextTracerProgram, tracerProgramError] = await createLinkedProgramAsync(
      this.webGlContext,
      tracerVertexSource,
      nextFragmentSource,
      'path tracer',
      options
    );
    if (tracerProgramError) {
      return returnFailure(tracerProgramError.code, tracerProgramError.message, tracerProgramError.details);
    }

    return this.commitSceneProgram(sceneObjects, renderSettings, nextTracerProgram, compileStartMilliseconds, 'parallel');
  }

  releaseSceneProgram() {
    const webGlContext = this.webGlContext;
    if (this.tracerProgram) {
      if (typeof webGlContext.flush === 'function') {
        webGlContext.flush();
      }
      webGlContext.deleteProgram(this.tracerProgram);
    }

    this.tracerProgram = null;
    this.tracerVertexAttribute = -1;
    this.tracerUniformLocations = createUniformLocationCache();
    this.tracerFrameUniformLocations = Object.create(null);
    this.tracerSampleUniformLocations = Object.create(null);
    this.tracerFrameScalarUniformValues = Object.create(null);
    this.previousTracerFrameScalarUniformValues = Object.create(null);
    this.sceneObjects = [];
    this.sceneComplexity = calculateSceneComplexity(this.sceneObjects);
    this.sampleCount = 0;
    this.lastRenderedSampleCount = 0;
    this.currentRaysPerPixel = DEFAULT_RAYS_PER_PIXEL;
    this.wasInteractiveQualityThrottleActive = false;
    this.hasInteractiveCameraMotionDisplayHistory = false;
    this.hasContinuousMotionDisplayHistory = false;
    this.usesMaterialAlbedoTexture = false;
    this.usesSkyTexture = false;
    this.hasDisplayHistory = false;
    this.resetTemporalDisplayCache();
    this.hasSetTracerSamplerUniforms = false;
    this.hasCompleteTracerSampleUniforms = false;
    this.hasPendingSceneUniformUpdate = true;
    this.hasLoggedAccumulationPhase = false;
    this.hasLoggedTemporalDisplayPhase = false;
    this.hasLoggedDisplayCompositePhase = false;
    writeVec3(this.previousEyePosition, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRight, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraUp, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayCenter, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayClipX, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayClipY, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousLightColor, Number.NaN, Number.NaN, Number.NaN);
    useWebGlProgramIfNeeded(webGlContext, null);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, null);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);
    if (typeof webGlContext.flush === 'function') {
      webGlContext.flush();
    }

    return this.syncBenchmarkStaticSnapshotFields();
  }

  markSceneUniformsDirty() {
    this.hasPendingSceneUniformUpdate = true;
    return returnSuccess(undefined);
  }

  cacheTracerFrameUniformLocations() {
    this.tracerFrameUniformLocations.eye = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'eye'
    );
    this.tracerFrameUniformLocations.glossiness = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'glossiness'
    );
    this.tracerFrameUniformLocations.lightIntensity = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'lightIntensity'
    );
    this.tracerFrameUniformLocations.lightSize = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'lightSize'
    );
    this.tracerFrameUniformLocations.lightColor = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'lightColor'
    );
    this.tracerFrameUniformLocations.fogDensity = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'fogDensity'
    );
    this.tracerFrameUniformLocations.skyBrightness = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'skyBrightness'
    );
    this.tracerFrameUniformLocations.cameraRight = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraRight'
    );
    this.tracerFrameUniformLocations.cameraUp = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraUp'
    );
    this.tracerFrameUniformLocations.rayCenter = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayCenter'
    );
    this.tracerFrameUniformLocations.rayClipX = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayClipX'
    );
    this.tracerFrameUniformLocations.rayClipY = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayClipY'
    );
    this.tracerFrameUniformLocations.cameraFocusDistance = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraFocusDistance'
    );
    this.tracerFrameUniformLocations.cameraAperture = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraAperture'
    );
    this.tracerFrameUniformLocations.renderDebugViewMode = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'renderDebugViewMode'
    );
    this.tracerFrameUniformLocations.activeLightBounceCount = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'activeLightBounceCount'
    );
    return returnSuccess(undefined);
  }

  setTracerFrameUniforms(applicationState, activeLightBounceCount) {
    const webGlContext = this.webGlContext;
    const locations = this.tracerFrameUniformLocations;

    setChangedCachedVec3UniformValue(webGlContext, locations.eye, applicationState.eyePosition, this.previousEyePosition);
    setChangedCachedVec3UniformValue(webGlContext, locations.cameraRight, this.cameraRight, this.previousCameraRight);
    setChangedCachedVec3UniformValue(webGlContext, locations.cameraUp, this.cameraUp, this.previousCameraUp);
    setChangedCachedVec3UniformValue(webGlContext, locations.rayCenter, this.cameraRayCenter, this.previousCameraRayCenter);
    setChangedCachedVec3UniformValue(webGlContext, locations.rayClipX, this.cameraRayClipX, this.previousCameraRayClipX);
    setChangedCachedVec3UniformValue(webGlContext, locations.rayClipY, this.cameraRayClipY, this.previousCameraRayClipY);
    setChangedCachedVec3UniformValue(webGlContext, locations.lightColor, applicationState.lightColor, this.previousLightColor);

    const normalizedRenderDebugViewMode = normalizeRenderDebugViewMode(applicationState.renderDebugViewMode);
    if (!haveTracerFrameScalarUniformsChanged(
      applicationState,
      activeLightBounceCount,
      normalizedRenderDebugViewMode,
      this.previousTracerFrameScalarUniformValues
    )) {
      return;
    }

    const frameUniformValues = this.tracerFrameScalarUniformValues;
    frameUniformValues.glossiness = applicationState.glossiness;
    frameUniformValues.lightIntensity = applicationState.lightIntensity;
    frameUniformValues.lightSize = applicationState.lightSize;
    frameUniformValues.fogDensity = applicationState.fogDensity;
    frameUniformValues.skyBrightness = applicationState.skyBrightness;
    frameUniformValues.cameraFocusDistance = applicationState.cameraFocusDistance;
    frameUniformValues.cameraAperture = applicationState.cameraAperture;
    frameUniformValues.renderDebugViewMode = normalizedRenderDebugViewMode;
    frameUniformValues.activeLightBounceCount = activeLightBounceCount;
    setChangedCachedScalarUniformValues(
      webGlContext,
      locations,
      frameUniformValues,
      this.previousTracerFrameScalarUniformValues,
      TRACER_FRAME_SCALAR_UNIFORM_NAMES
    );
  }

  cacheTracerSampleUniformLocations() {
    this.tracerSampleUniformLocations.rayJitter = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayJitter'
    );
    this.tracerSampleUniformLocations.textureWeight = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'textureWeight'
    );
    this.tracerSampleUniformLocations.sampleSeed = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'sampleSeed'
    );
    this.hasCompleteTracerSampleUniforms = (
      this.tracerSampleUniformLocations.rayJitter !== null &&
      this.tracerSampleUniformLocations.textureWeight !== null &&
      this.tracerSampleUniformLocations.sampleSeed !== null
    );
    return returnSuccess(undefined);
  }

  setTracerSampleUniforms(sampleUniformValues) {
    const webGlContext = this.webGlContext;
    const locations = this.tracerSampleUniformLocations;

    if (locations.rayJitter !== null) {
      webGlContext.uniform2f(locations.rayJitter, sampleUniformValues.rayJitterX, sampleUniformValues.rayJitterY);
    }
    if (locations.textureWeight !== null) {
      webGlContext.uniform1f(locations.textureWeight, sampleUniformValues.textureWeight);
    }
    if (locations.sampleSeed !== null) {
      webGlContext.uniform1f(locations.sampleSeed, sampleUniformValues.sampleSeed);
    }
  }

  renderCompleteAccumulationSamples(sampleCountToRender) {
    const webGlContext = this.webGlContext;
    const locations = this.tracerSampleUniformLocations;
    const textures = this.textures;
    const framebuffers = this.framebuffers;
    let currentTextureIndex = this.currentTextureIndex;
    let sampleCount = this.sampleCount;
    let randomSampleSequence = this.randomSampleSequence;

    for (let sampleIndex = 0; sampleIndex < sampleCountToRender; sampleIndex += 1) {
      const writeTextureIndex = 1 - currentTextureIndex;
      const nextSampleCount = sampleCount + 1;
      const sampleSeed = randomSampleSequence + 1;
      const jitterValueIndex = (sampleSeed - 1) * RAY_JITTER_COMPONENT_COUNT;
      webGlContext.uniform2f(
        locations.rayJitter,
        RAY_JITTER_VALUES[jitterValueIndex],
        RAY_JITTER_VALUES[jitterValueIndex + 1]
      );
      webGlContext.uniform1f(locations.textureWeight, sampleCount / nextSampleCount);
      webGlContext.uniform1f(locations.sampleSeed, sampleSeed);

      webGlContext.bindTexture(webGlContext.TEXTURE_2D, textures[currentTextureIndex]);
      webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, framebuffers[writeTextureIndex]);
      webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);

      currentTextureIndex = writeTextureIndex;
      sampleCount = nextSampleCount;
      randomSampleSequence = sampleSeed === RANDOM_SAMPLE_SEQUENCE_WRAP ? 0 : sampleSeed;
    }

    this.currentTextureIndex = currentTextureIndex;
    this.sampleCount = sampleCount;
    this.randomSampleSequence = randomSampleSequence;
  }

  readLatestBenchmarkTiming() {
    if (!this.gpuBenchmarkTimer) {
      return returnSuccess(null);
    }

    return this.gpuBenchmarkTimer.readLatestCompletedTiming();
  }

  beginBenchmarkTiming() {
    if (!this.gpuBenchmarkTimer) {
      return returnSuccess(false);
    }

    return this.gpuBenchmarkTimer.beginTiming();
  }

  endBenchmarkTiming(renderedSampleCount, lightBounceCount) {
    if (!this.gpuBenchmarkTimer) {
      return returnSuccess(false);
    }

    return this.gpuBenchmarkTimer.endTiming(renderedSampleCount, lightBounceCount);
  }

  writeBenchmarkSnapshot(
    timestampMilliseconds,
    renderedSampleCount,
    lightBounceCount,
    durationMilliseconds,
    measurementSource
  ) {
    return this.benchmarkWindow.recordTraceSample(
      this.benchmarkSnapshot,
      timestampMilliseconds,
      renderedSampleCount,
      lightBounceCount,
      durationMilliseconds,
      measurementSource
    );
  }

  writeBenchmarkFramePacing(timestampMilliseconds, elapsedSeconds) {
    return this.benchmarkWindow.recordFramePacing(this.benchmarkSnapshot, timestampMilliseconds, elapsedSeconds);
  }

  writePausedBenchmarkSnapshot(measurementSource, shouldPauseFrames, applicationState = null) {
    const [, pausedError] = writePausedBenchmarkSnapshot(this.benchmarkSnapshot, measurementSource, shouldPauseFrames);
    if (pausedError) {
      return returnFailure(pausedError.code, pausedError.message, pausedError.details);
    }
    if (applicationState) {
      return this.writeBenchmarkRenderState(applicationState);
    }
    this.benchmarkSnapshot.accumulatedSamples = Math.max(0, this.sampleCount);
    return this.syncBenchmarkStaticSnapshotFields();
  }

  update(inverseCameraMatrix, applicationState, didCameraChange, cameraRight, cameraUp) {
    if (!this.tracerProgram) {
      return returnFailure('missing-tracer-program', 'Path tracer program has not been created.');
    }

    const webGlContext = this.webGlContext;
    const effectiveRenderQuality = readEffectiveRenderQuality(applicationState);
    const raysPerPixel = effectiveRenderQuality.raysPerPixel;
    const activeLightBounceCount = effectiveRenderQuality.lightBounceCount;
    const sampleUniformValues = this.sampleUniformValues;
    const wasInteractiveQualityThrottleActive = this.wasInteractiveQualityThrottleActive;
    const isInteractiveQualityThrottleActive = effectiveRenderQuality.isInteractiveQualityThrottleActive;
    this.currentRaysPerPixel = raysPerPixel;
    this.lastRenderedSampleCount = 0;

    if (
      wasInteractiveQualityThrottleActive &&
      !isInteractiveQualityThrottleActive &&
      this.hasInteractiveCameraMotionDisplayHistory
    ) {
      const [, clearInteractiveCameraSamplesError] = this.clearSamples();
      if (clearInteractiveCameraSamplesError) {
        return returnFailure(
          clearInteractiveCameraSamplesError.code,
          clearInteractiveCameraSamplesError.message,
          clearInteractiveCameraSamplesError.details
        );
      }
    }
    this.wasInteractiveQualityThrottleActive = isInteractiveQualityThrottleActive;

    if (
      applicationState.isConvergencePauseEnabled &&
      this.sampleCount >= applicationState.convergenceSampleCount
    ) {
      const [latestGpuTiming, latestGpuTimingError] = this.readLatestBenchmarkTiming();
      if (latestGpuTimingError) {
        return returnFailure(latestGpuTimingError.code, latestGpuTimingError.message, latestGpuTimingError.details);
      }
      if (latestGpuTiming) {
        const [, benchmarkSnapshotError] = this.writeBenchmarkSnapshot(
          performance.now(),
          latestGpuTiming.renderedSampleCount,
          latestGpuTiming.lightBounceCount,
          latestGpuTiming.durationMilliseconds,
          'gpu-timer'
        );
        if (benchmarkSnapshotError) {
          return returnFailure(benchmarkSnapshotError.code, benchmarkSnapshotError.message, benchmarkSnapshotError.details);
        }
      }
      applicationState.isConvergencePaused = true;
      return this.writeBenchmarkRenderState(applicationState);
    }
    applicationState.isConvergencePaused = false;

    if (didCameraChange) {
      const [, clearCameraSamplesError] = this.clearSamples();
      if (clearCameraSamplesError) {
        return returnFailure(
          clearCameraSamplesError.code,
          clearCameraSamplesError.message,
          clearCameraSamplesError.details
        );
      }
      if (isInteractiveQualityThrottleActive) {
        this.hasInteractiveCameraMotionDisplayHistory = true;
      }

      writeVec3(this.cameraRight, cameraRight[0], cameraRight[1], cameraRight[2]);
      writeVec3(this.cameraUp, cameraUp[0], cameraUp[1], cameraUp[2]);
      writeCameraRayBasis(
        this.cameraRayCenter,
        this.cameraRayClipX,
        this.cameraRayClipY,
        inverseCameraMatrix,
        applicationState.eyePosition
      );
    }

    useWebGlProgramIfNeeded(webGlContext, this.tracerProgram);
    if (!this.hasSetTracerSamplerUniforms) {
      const [, accumulationSamplerError] = setSamplerUniform(
        webGlContext,
        this.tracerProgram,
        this.tracerUniformLocations,
        'texture',
        0
      );
      if (accumulationSamplerError) {
        return returnFailure(accumulationSamplerError.code, accumulationSamplerError.message, accumulationSamplerError.details);
      }

      if (this.usesSkyTexture) {
        const [, skySamplerError] = setSamplerUniform(
          webGlContext,
          this.tracerProgram,
          this.tracerUniformLocations,
          'skyTexture',
          1
        );
        if (skySamplerError) {
          return returnFailure(skySamplerError.code, skySamplerError.message, skySamplerError.details);
        }
      }

      if (this.usesMaterialAlbedoTexture) {
        const [, materialSamplerError] = setSamplerUniform(
          webGlContext,
          this.tracerProgram,
          this.tracerUniformLocations,
          'materialAlbedoTexture',
          2
        );
        if (materialSamplerError) {
          return returnFailure(materialSamplerError.code, materialSamplerError.message, materialSamplerError.details);
        }
      }

      this.hasSetTracerSamplerUniforms = true;
    }

    if (this.usesSkyTexture) {
      webGlContext.activeTexture(webGlContext.TEXTURE1);
      webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.skyTexture);
    }
    if (this.usesMaterialAlbedoTexture) {
      webGlContext.activeTexture(webGlContext.TEXTURE2);
      webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.materialAlbedoTexture);
    }
    webGlContext.activeTexture(webGlContext.TEXTURE0);
    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.vertexAttribPointer(this.tracerVertexAttribute, 2, webGlContext.FLOAT, false, 0, 0);

    this.setTracerFrameUniforms(applicationState, activeLightBounceCount);

    if (this.hasPendingSceneUniformUpdate) {
      const sceneObjects = this.sceneObjects;
      for (let objectIndex = 0; objectIndex < sceneObjects.length; objectIndex += 1) {
        sceneObjects[objectIndex].setUniforms(webGlContext);
      }
      this.hasPendingSceneUniformUpdate = false;
    }

    if (!this.hasValidatedRenderFramebuffer) {
      const [, framebufferError] = this.prepareFramebufferForRendering();
      if (framebufferError) {
        webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);
        return returnFailure(framebufferError.code, framebufferError.message, framebufferError.details);
      }
    }

    const [latestGpuTiming, latestGpuTimingError] = this.readLatestBenchmarkTiming();
    if (latestGpuTimingError) {
      return returnFailure(latestGpuTimingError.code, latestGpuTimingError.message, latestGpuTimingError.details);
    }

    const [didStartGpuTiming, benchmarkStartError] = this.beginBenchmarkTiming();
    if (benchmarkStartError) {
      return returnFailure(benchmarkStartError.code, benchmarkStartError.message, benchmarkStartError.details);
    }

    const accumulationStartMilliseconds = readCurrentMilliseconds();
    if (this.hasCompleteTracerSampleUniforms) {
      this.renderCompleteAccumulationSamples(raysPerPixel);
    } else {
      for (let sampleIndex = 0; sampleIndex < raysPerPixel; sampleIndex += 1) {
        writeRayJitterUniformValues(
          sampleUniformValues,
          this.randomSampleSequence
        );

        this.renderAccumulationSample(sampleUniformValues);
      }
    }
    if (!this.hasLoggedAccumulationPhase) {
      this.hasLoggedAccumulationPhase = true;
      logDiagnostic('debug', 'renderer', 'Accumulation pass completed.', Object.freeze({
        raysPerPixel,
        durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - accumulationStartMilliseconds)
      }));
    }

    if (didStartGpuTiming) {
      const [, benchmarkEndError] = this.endBenchmarkTiming(raysPerPixel, activeLightBounceCount);
      if (benchmarkEndError) {
        return returnFailure(benchmarkEndError.code, benchmarkEndError.message, benchmarkEndError.details);
      }
    }

    this.lastRenderedSampleCount = raysPerPixel;

    if (latestGpuTiming) {
      const [, benchmarkSnapshotError] = this.writeBenchmarkSnapshot(
        performance.now(),
        latestGpuTiming.renderedSampleCount,
        latestGpuTiming.lightBounceCount,
        latestGpuTiming.durationMilliseconds,
        'gpu-timer'
      );
      if (benchmarkSnapshotError) {
        return returnFailure(benchmarkSnapshotError.code, benchmarkSnapshotError.message, benchmarkSnapshotError.details);
      }
    }

    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);

    return this.writeBenchmarkRenderState(applicationState);
  }

  renderAccumulationSample(sampleUniformValues) {
    const webGlContext = this.webGlContext;
    const writeTextureIndex = 1 - this.currentTextureIndex;
    const nextSampleCount = this.sampleCount + 1;
    const sampleSeed = this.randomSampleSequence + 1;
    sampleUniformValues.textureWeight = this.sampleCount / nextSampleCount;
    sampleUniformValues.sampleSeed = sampleSeed;

    this.setTracerSampleUniforms(sampleUniformValues);

    webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.textures[this.currentTextureIndex]);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, this.framebuffers[writeTextureIndex]);

    webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);

    this.currentTextureIndex = writeTextureIndex;
    this.sampleCount = nextSampleCount;
    this.randomSampleSequence = sampleSeed === RANDOM_SAMPLE_SEQUENCE_WRAP ? 0 : sampleSeed;
  }

  prepareFramebufferForRendering() {
    if (this.hasValidatedRenderFramebuffer) {
      return returnSuccess(undefined);
    }

    const webGlContext = this.webGlContext;
    const firstFramebuffer = this.framebuffers[0];
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, firstFramebuffer);
    let framebufferStatus = webGlContext.checkFramebufferStatus(webGlContext.FRAMEBUFFER);

    while (
      framebufferStatus !== webGlContext.FRAMEBUFFER_COMPLETE &&
      this.textureTypeIndex + 1 < this.renderTextureTypes.length
    ) {
      this.textureTypeIndex += 1;
      this.textureType = this.renderTextureTypes[this.textureTypeIndex];
      this.traceSampleBytes = calculateTraceMemoryBytesPerSample(webGlContext, this.textureType);
      this.estimatedGpuBufferMemoryBytes = calculateEstimatedGpuBufferMemoryBytes(webGlContext, this.textureType);
      const [, benchmarkBytesError] = this.benchmarkWindow.setTraceSampleBytes(this.traceSampleBytes);
      if (benchmarkBytesError) {
        return returnFailure(benchmarkBytesError.code, benchmarkBytesError.message, benchmarkBytesError.details);
      }
      const [, benchmarkStaticError] = this.syncBenchmarkStaticSnapshotFields();
      if (benchmarkStaticError) {
        return returnFailure(benchmarkStaticError.code, benchmarkStaticError.message, benchmarkStaticError.details);
      }
      this.sampleCount = 0;
      this.hasDisplayHistory = false;
      this.resetTemporalDisplayCache();
      this.hasValidatedRenderFramebuffer = false;
      this.hasValidatedDisplayFramebuffer = false;

      for (const texture of this.textures) {
        webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
        webGlContext.texImage2D(
          webGlContext.TEXTURE_2D,
          0,
          webGlContext.RGBA,
          CANVAS_RENDER_WIDTH,
          CANVAS_RENDER_HEIGHT,
          0,
          webGlContext.RGBA,
          this.textureType,
          null
        );
      }

      for (const texture of this.displayTextures) {
        webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
        webGlContext.texImage2D(
          webGlContext.TEXTURE_2D,
          0,
          webGlContext.RGBA,
          CANVAS_RENDER_WIDTH,
          CANVAS_RENDER_HEIGHT,
          0,
          webGlContext.RGBA,
          this.textureType,
          null
        );
      }

      webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, firstFramebuffer);
      framebufferStatus = webGlContext.checkFramebufferStatus(webGlContext.FRAMEBUFFER);
    }

    for (const framebuffer of this.framebuffers) {
      webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, framebuffer);
      const currentFramebufferStatus = webGlContext.checkFramebufferStatus(webGlContext.FRAMEBUFFER);
      if (currentFramebufferStatus !== webGlContext.FRAMEBUFFER_COMPLETE) {
        return returnFailure('framebuffer-incomplete', 'Path tracer framebuffer is incomplete.', currentFramebufferStatus);
      }
    }

    this.hasValidatedRenderFramebuffer = true;
    return returnSuccess(undefined);
  }

  shouldUseTemporalDisplayPass(temporalBlendFrames, motionBlurStrength, denoiserStrength) {
    return (
      temporalBlendFrames > MIN_TEMPORAL_BLEND_FRAMES ||
      motionBlurStrength > MIN_MOTION_BLUR_STRENGTH ||
      denoiserStrength > MIN_DENOISER_STRENGTH
    );
  }

  readTemporalFrameAge(temporalBlendFrames) {
    const samplesPerDisplayFrame = Math.max(this.currentRaysPerPixel, 1);
    const temporalRampSamples = Math.max(samplesPerDisplayFrame, temporalBlendFrames * samplesPerDisplayFrame);
    return clampNumber(this.sampleCount / temporalRampSamples, 0, 1);
  }

  readTemporalHistoryAvailability(temporalBlendFrames, motionBlurStrength) {
    if (!this.hasDisplayHistory) {
      return 0;
    }
    if (motionBlurStrength > MIN_MOTION_BLUR_STRENGTH) {
      return 1;
    }
    const samplesPerDisplayFrame = Math.max(this.currentRaysPerPixel, 1);
    const temporalHistorySamples = Math.max(samplesPerDisplayFrame, temporalBlendFrames * samplesPerDisplayFrame);
    return this.sampleCount <= temporalHistorySamples ? 1 : 0;
  }

  resetTemporalDisplayCache() {
    this.lastTemporalDisplayInputSampleCount = -1;
    this.lastTemporalDisplayInputTextureIndex = -1;
    this.lastTemporalDisplayBlendFrames = Number.NaN;
    this.lastTemporalDisplayMotionBlurStrength = Number.NaN;
    this.lastTemporalDisplayDenoiserStrength = Number.NaN;
  }

  hasCurrentTemporalDisplayTexture(temporalBlendFrames, motionBlurStrength, denoiserStrength) {
    return (
      this.hasDisplayHistory &&
      this.lastTemporalDisplayInputSampleCount === this.sampleCount &&
      this.lastTemporalDisplayInputTextureIndex === this.currentTextureIndex &&
      this.lastTemporalDisplayBlendFrames === temporalBlendFrames &&
      this.lastTemporalDisplayMotionBlurStrength === motionBlurStrength &&
      this.lastTemporalDisplayDenoiserStrength === denoiserStrength
    );
  }

  readRenderTexture(applicationState) {
    if (shouldUseDraftPostProcessBypass(applicationState)) {
      this.hasDisplayHistory = false;
      this.resetTemporalDisplayCache();
      return this.textureSuccessResults[this.currentTextureIndex];
    }

    const temporalBlendFrames = normalizeBoundedInteger(
      applicationState.temporalBlendFrames,
      DEFAULT_TEMPORAL_BLEND_FRAMES,
      MIN_TEMPORAL_BLEND_FRAMES,
      MAX_TEMPORAL_BLEND_FRAMES
    );
    const motionBlurStrength = clampNumber(
      applicationState.motionBlurStrength,
      MIN_MOTION_BLUR_STRENGTH,
      MAX_MOTION_BLUR_STRENGTH
    );
    const denoiserStrength = clampNumber(
      applicationState.denoiserStrength,
      MIN_DENOISER_STRENGTH,
      MAX_DENOISER_STRENGTH
    );
    if (!this.shouldUseTemporalDisplayPass(temporalBlendFrames, motionBlurStrength, denoiserStrength)) {
      this.hasDisplayHistory = false;
      this.resetTemporalDisplayCache();
      return this.textureSuccessResults[this.currentTextureIndex];
    }

    if (this.hasCurrentTemporalDisplayTexture(
      temporalBlendFrames,
      motionBlurStrength,
      denoiserStrength
    )) {
      return this.displayTextureSuccessResults[this.currentDisplayTextureIndex];
    }

    const [, temporalDisplayError] = this.renderTemporalDisplayTexture(
      temporalBlendFrames,
      motionBlurStrength,
      denoiserStrength
    );
    if (temporalDisplayError) {
      return returnFailure(temporalDisplayError.code, temporalDisplayError.message, temporalDisplayError.details);
    }

    return this.displayTextureSuccessResults[this.currentDisplayTextureIndex];
  }

  renderTemporalDisplayTexture(temporalBlendFrames, motionBlurStrength, denoiserStrength) {
    const webGlContext = this.webGlContext;
    const writeDisplayTextureIndex = 1 - this.currentDisplayTextureIndex;
    const phaseStartMilliseconds = readCurrentMilliseconds();

    useWebGlProgramIfNeeded(webGlContext, this.temporalDisplayProgram);
    webGlContext.activeTexture(webGlContext.TEXTURE0);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.textures[this.currentTextureIndex]);

    webGlContext.activeTexture(webGlContext.TEXTURE1);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.displayTextures[this.currentDisplayTextureIndex]);
    if (!this.hasSetTemporalSamplerUniforms) {
      const [, currentTextureError] = setSamplerUniform(
        webGlContext,
        this.temporalDisplayProgram,
        this.temporalDisplayUniformLocations,
        'texture',
        0
      );
      if (currentTextureError) {
        return returnFailure(currentTextureError.code, currentTextureError.message, currentTextureError.details);
      }

      const [, historyTextureError] = setSamplerUniform(
        webGlContext,
        this.temporalDisplayProgram,
        this.temporalDisplayUniformLocations,
        'displayHistoryTexture',
        1
      );
      if (historyTextureError) {
        return returnFailure(historyTextureError.code, historyTextureError.message, historyTextureError.details);
      }

      this.hasSetTemporalSamplerUniforms = true;
    }

    const temporalUniformValues = this.temporalDisplayScalarUniformValues;
    temporalUniformValues.temporalBlendFrames = temporalBlendFrames;
    temporalUniformValues.temporalFrameAge = this.readTemporalFrameAge(temporalBlendFrames);
    temporalUniformValues.historyAvailability = this.readTemporalHistoryAvailability(
      temporalBlendFrames,
      motionBlurStrength
    );
    temporalUniformValues.motionBlurStrength = motionBlurStrength;
    temporalUniformValues.denoiserStrength = denoiserStrength;

    setChangedCachedScalarUniformValues(
      webGlContext,
      this.temporalDisplayScalarUniformLocations,
      temporalUniformValues,
      this.previousTemporalDisplayScalarUniformValues,
      TEMPORAL_DISPLAY_SCALAR_UNIFORM_NAMES
    );

    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, this.displayFramebuffers[writeDisplayTextureIndex]);

    if (!this.hasValidatedDisplayFramebuffer) {
      for (const displayFramebuffer of this.displayFramebuffers) {
        webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, displayFramebuffer);
        const displayFramebufferStatus = webGlContext.checkFramebufferStatus(webGlContext.FRAMEBUFFER);
        if (displayFramebufferStatus !== webGlContext.FRAMEBUFFER_COMPLETE) {
          webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);
          webGlContext.activeTexture(webGlContext.TEXTURE0);
          return returnFailure('display-framebuffer-incomplete', 'Temporal display framebuffer is incomplete.', displayFramebufferStatus);
        }
      }
      this.hasValidatedDisplayFramebuffer = true;
      webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, this.displayFramebuffers[writeDisplayTextureIndex]);
    }

    webGlContext.vertexAttribPointer(this.temporalDisplayVertexAttribute, 2, webGlContext.FLOAT, false, 0, 0);
    webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);
    webGlContext.activeTexture(webGlContext.TEXTURE0);

    this.currentDisplayTextureIndex = writeDisplayTextureIndex;
    this.hasDisplayHistory = true;
    this.lastTemporalDisplayInputSampleCount = this.sampleCount;
    this.lastTemporalDisplayInputTextureIndex = this.currentTextureIndex;
    this.lastTemporalDisplayBlendFrames = temporalBlendFrames;
    this.lastTemporalDisplayMotionBlurStrength = motionBlurStrength;
    this.lastTemporalDisplayDenoiserStrength = denoiserStrength;
    if (!this.hasLoggedTemporalDisplayPhase) {
      this.hasLoggedTemporalDisplayPhase = true;
      logDiagnostic('debug', 'renderer', 'Temporal denoise/display pass completed.', Object.freeze({
        temporalBlendFrames,
        motionBlurStrength,
        denoiserStrength,
        durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - phaseStartMilliseconds)
      }));
    }
    return returnSuccess(undefined);
  }

  render(applicationState) {
    const phaseStartMilliseconds = readCurrentMilliseconds();
    const [renderTexture, renderTextureError] = this.readRenderTexture(applicationState);
    if (renderTextureError) {
      return returnFailure(renderTextureError.code, renderTextureError.message, renderTextureError.details);
    }

    const webGlContext = this.webGlContext;
    const shouldBypassDraftPostProcess = shouldUseDraftPostProcessBypass(applicationState);
    const effectiveBloomStrength = shouldBypassDraftPostProcess ? 0 : applicationState.bloomStrength;
    const effectiveGlareStrength = shouldBypassDraftPostProcess ? 0 : applicationState.glareStrength;
    useWebGlProgramIfNeeded(webGlContext, this.renderProgram);
    webGlContext.activeTexture(webGlContext.TEXTURE0);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, renderTexture);
    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.vertexAttribPointer(this.renderVertexAttribute, 2, webGlContext.FLOAT, false, 0, 0);

    if (!this.hasSetRenderSamplerUniform) {
      const [, renderSamplerError] = setSamplerUniform(
        webGlContext,
        this.renderProgram,
        this.renderUniformLocations,
        'texture',
        0
      );
      if (renderSamplerError) {
        return returnFailure(renderSamplerError.code, renderSamplerError.message, renderSamplerError.details);
      }
      this.hasSetRenderSamplerUniform = true;
    }

    const renderUniformValues = this.renderScalarUniformValues;
    if (this.previousRenderColorExposure !== applicationState.colorExposure) {
      this.previousRenderColorExposure = applicationState.colorExposure;
      this.renderColorExposureScale = 2 ** applicationState.colorExposure;
    }
    renderUniformValues.colorExposureScale = this.renderColorExposureScale;
    renderUniformValues.colorBrightness = applicationState.colorBrightness;
    renderUniformValues.colorContrast = applicationState.colorContrast;
    renderUniformValues.colorSaturation = applicationState.colorSaturation;
    renderUniformValues.colorGamma = applicationState.colorGamma;
    renderUniformValues.toneMappingMode = applicationState.toneMappingMode;
    renderUniformValues.bloomStrength = effectiveBloomStrength;
    renderUniformValues.bloomThreshold = applicationState.bloomThreshold;
    renderUniformValues.glareStrength = effectiveGlareStrength;

    setChangedCachedScalarUniformValues(
      webGlContext,
      this.renderScalarUniformLocations,
      renderUniformValues,
      this.previousRenderScalarUniformValues,
      RENDER_SCALAR_UNIFORM_NAMES
    );

    webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);
    if (!this.hasLoggedDisplayCompositePhase) {
      this.hasLoggedDisplayCompositePhase = true;
      logDiagnostic('debug', 'renderer', 'Display composite pass completed.', Object.freeze({
        postProcessMode: shouldBypassDraftPostProcess ? 'draft-bypass' : 'full',
        bloomStrength: effectiveBloomStrength,
        bloomThreshold: applicationState.bloomThreshold,
        glareStrength: effectiveGlareStrength,
        durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - phaseStartMilliseconds)
      }));
    }
    return returnSuccess(undefined);
  }

  clearSamples(shouldClearDisplayHistory = true) {
    this.sampleCount = 0;
    if (shouldClearDisplayHistory) {
      this.hasDisplayHistory = false;
      this.hasInteractiveCameraMotionDisplayHistory = false;
      this.hasContinuousMotionDisplayHistory = false;
      this.resetTemporalDisplayCache();
    }
    return returnSuccess(undefined);
  }

  clearDisplayHistory() {
    this.hasDisplayHistory = false;
    this.hasInteractiveCameraMotionDisplayHistory = false;
    this.hasContinuousMotionDisplayHistory = false;
    this.resetTemporalDisplayCache();
    return returnSuccess(undefined);
  }

  settleContinuousMotionDisplayHistory(didRenderMotionThisFrame) {
    if (didRenderMotionThisFrame) {
      this.hasContinuousMotionDisplayHistory = true;
      return returnSuccess(false);
    }
    if (!this.hasContinuousMotionDisplayHistory) {
      return returnSuccess(false);
    }
    const [, clearError] = this.clearSamples();
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }
    return returnSuccess(true);
  }

  resetBenchmark() {
    this.benchmarkSnapshot = createBenchmarkSnapshot();
    this.benchmarkWindow = new RollingBenchmarkWindow(this.traceSampleBytes);
    return this.syncBenchmarkStaticSnapshotFields();
  }
}

const normalizeSceneEntityId = (entityId) => {
  if (entityId === null || entityId === undefined) {
    return null;
  }
  const normalizedEntityId = String(entityId);
  return normalizedEntityId.length > 0 ? normalizedEntityId : null;
};

const normalizeSceneEntityIdList = (entityIds) => {
  if (!Array.isArray(entityIds)) {
    return Object.freeze([]);
  }
  const seenEntityIds = new Set();
  const normalizedEntityIds = [];
  for (const entityId of entityIds) {
    const normalizedEntityId = normalizeSceneEntityId(entityId);
    if (normalizedEntityId === null || seenEntityIds.has(normalizedEntityId)) {
      continue;
    }
    seenEntityIds.add(normalizedEntityId);
    normalizedEntityIds.push(normalizedEntityId);
  }
  return Object.freeze(normalizedEntityIds);
};

const areSceneEntityIdListsEqual = (leftEntityIds, rightEntityIds) => (
  leftEntityIds.length === rightEntityIds.length &&
  leftEntityIds.every((entityId, entityIndex) => entityId === rightEntityIds[entityIndex])
);

const mergeSceneEntityIdLists = (...entityIdLists) => (
  normalizeSceneEntityIdList(entityIdLists.flat())
);

const readSceneObjectEntityId = (sceneObject) => {
  if (!sceneObject || typeof sceneObject !== 'object') {
    return null;
  }
  return normalizeSceneEntityId(sceneObject.entityId ?? sceneObject.objectId ?? sceneObject.id);
};

const readSceneObjectParentEntityId = (sceneObject) => (
  normalizeSceneEntityId(sceneObject && sceneObject.parentEntityId)
);

const isGroupEntitySceneObject = (sceneObject) => (
  Boolean(sceneObject) &&
  typeof sceneObject === 'object' &&
  (
    sceneObject instanceof GroupEntity ||
    sceneObject.isGroup === true ||
    sceneObject.sceneItemKind === 'group' ||
    sceneObject.kind === 'group' ||
    sceneObject.type === 'group' ||
    Array.isArray(sceneObject.childEntityIds)
  )
);

const isRenderableSceneObject = (sceneObject) => (
  Boolean(sceneObject) &&
  typeof sceneObject === 'object' &&
  !isGroupEntitySceneObject(sceneObject) &&
  typeof sceneObject.getGlobalCode === 'function' &&
  typeof sceneObject.getIntersectCode === 'function' &&
  typeof sceneObject.getShadowTestCode === 'function' &&
  typeof sceneObject.getMinimumIntersectCode === 'function' &&
  typeof sceneObject.getNormalCalculationCode === 'function' &&
  typeof sceneObject.cacheUniformLocations === 'function' &&
  typeof sceneObject.setUniforms === 'function'
);

const syncSceneGroupEntityChildren = (sceneObjects) => {
  const objectByEntityId = new Map();
  for (const sceneObject of sceneObjects) {
    const entityId = readSceneObjectEntityId(sceneObject);
    if (entityId !== null && !objectByEntityId.has(entityId)) {
      objectByEntityId.set(entityId, sceneObject);
    }
  }

  const groupObjects = sceneObjects.filter(isGroupEntitySceneObject);
  for (const sceneObject of sceneObjects) {
    const entityId = readSceneObjectEntityId(sceneObject);
    const parentEntityId = readSceneObjectParentEntityId(sceneObject);
    if (parentEntityId === null) {
      continue;
    }
    const parentObject = objectByEntityId.get(parentEntityId);
    if (parentEntityId === entityId || !isGroupEntitySceneObject(parentObject)) {
      sceneObject.parentEntityId = null;
    }
  }

  for (const groupObject of groupObjects) {
    const groupEntityId = readSceneObjectEntityId(groupObject);
    if (groupEntityId === null) {
      continue;
    }
    for (const childEntityId of normalizeSceneEntityIdList(groupObject.childEntityIds)) {
      const childObject = objectByEntityId.get(childEntityId);
      if (childObject && childObject !== groupObject) {
        childObject.parentEntityId = groupEntityId;
      }
    }
  }

  for (const sceneObject of sceneObjects) {
    const entityId = readSceneObjectEntityId(sceneObject);
    let parentEntityId = readSceneObjectParentEntityId(sceneObject);
    const visitedParentIds = new Set([entityId]);
    while (parentEntityId !== null) {
      if (visitedParentIds.has(parentEntityId)) {
        sceneObject.parentEntityId = null;
        break;
      }
      visitedParentIds.add(parentEntityId);
      parentEntityId = readSceneObjectParentEntityId(objectByEntityId.get(parentEntityId));
    }
  }

  for (const groupObject of groupObjects) {
    const groupEntityId = readSceneObjectEntityId(groupObject);
    if (groupEntityId === null) {
      continue;
    }
    const childEntityIds = sceneObjects
      .filter((sceneObject) => sceneObject !== groupObject && readSceneObjectParentEntityId(sceneObject) === groupEntityId)
      .map(readSceneObjectEntityId)
      .filter((entityId) => entityId !== null);
    if (typeof groupObject.syncChildEntityIds === 'function') {
      const [, syncError] = groupObject.syncChildEntityIds(childEntityIds);
      if (syncError) {
        return returnFailure(syncError.code, syncError.message, syncError.details);
      }
    } else {
      groupObject.childEntityIds = normalizeSceneEntityIdList(childEntityIds);
    }
    if (typeof groupObject.setSceneObjects === 'function') {
      const [, sceneObjectsError] = groupObject.setSceneObjects(sceneObjects);
      if (sceneObjectsError) {
        return returnFailure(sceneObjectsError.code, sceneObjectsError.message, sceneObjectsError.details);
      }
    }
    if (groupObject.isHidden) {
      for (const childEntityId of groupObject.childEntityIds) {
        const childObject = objectByEntityId.get(childEntityId);
        if (childObject) {
          childObject.isHidden = true;
        }
      }
    }
    if (groupObject.isLocked) {
      for (const childEntityId of groupObject.childEntityIds) {
        const childObject = objectByEntityId.get(childEntityId);
        if (childObject) {
          childObject.isLocked = true;
        }
      }
    }
  }

  return returnSuccess(undefined);
};

const findSceneObjectByEntityId = (sceneObjects, entityId) => {
  const normalizedEntityId = normalizeSceneEntityId(entityId);
  if (normalizedEntityId === null) {
    return null;
  }
  return sceneObjects.find((sceneObject) => readSceneObjectEntityId(sceneObject) === normalizedEntityId) || null;
};

const createSceneObjectSourceIndexMap = (sceneObjects) => {
  const sourceIndexByEntityId = new Map();
  sceneObjects.forEach((sceneObject, sceneObjectIndex) => {
    const entityId = readSceneObjectEntityId(sceneObject);
    if (entityId !== null && !sourceIndexByEntityId.has(entityId)) {
      sourceIndexByEntityId.set(entityId, sceneObjectIndex);
    }
  });
  return sourceIndexByEntityId;
};

const createSceneTreeDisplayEntries = (sceneObjects) => {
  const objectByEntityId = new Map();
  const sourceIndexByEntityId = createSceneObjectSourceIndexMap(sceneObjects);
  for (const sceneObject of sceneObjects) {
    const entityId = readSceneObjectEntityId(sceneObject);
    if (entityId !== null && !objectByEntityId.has(entityId)) {
      objectByEntityId.set(entityId, sceneObject);
    }
  }

  const childrenByParentEntityId = new Map();
  const rootObjects = [];
  for (const sceneObject of sceneObjects) {
    const entityId = readSceneObjectEntityId(sceneObject);
    const parentEntityId = readSceneObjectParentEntityId(sceneObject);
    if (
      entityId === null ||
      parentEntityId === null ||
      parentEntityId === entityId ||
      !objectByEntityId.has(parentEntityId)
    ) {
      rootObjects.push(sceneObject);
      continue;
    }

    const childObjects = childrenByParentEntityId.get(parentEntityId) || [];
    childObjects.push(sceneObject);
    childrenByParentEntityId.set(parentEntityId, childObjects);
  }

  const sortSceneObjectsForParent = (parentObject, childObjects) => {
    const childEntityIds = Array.isArray(parentObject && parentObject.childEntityIds)
      ? parentObject.childEntityIds.map(normalizeSceneEntityId)
      : [];
    const childOrderByEntityId = new Map();
    childEntityIds.forEach((childEntityId, childIndex) => {
      if (childEntityId !== null && !childOrderByEntityId.has(childEntityId)) {
        childOrderByEntityId.set(childEntityId, childIndex);
      }
    });
    return childObjects.slice().sort((leftObject, rightObject) => {
      const leftEntityId = readSceneObjectEntityId(leftObject);
      const rightEntityId = readSceneObjectEntityId(rightObject);
      const leftChildOrder = childOrderByEntityId.has(leftEntityId)
        ? childOrderByEntityId.get(leftEntityId)
        : Number.POSITIVE_INFINITY;
      const rightChildOrder = childOrderByEntityId.has(rightEntityId)
        ? childOrderByEntityId.get(rightEntityId)
        : Number.POSITIVE_INFINITY;
      if (leftChildOrder !== rightChildOrder) {
        return leftChildOrder - rightChildOrder;
      }
      return (sourceIndexByEntityId.get(leftEntityId) ?? 0) - (sourceIndexByEntityId.get(rightEntityId) ?? 0);
    });
  };

  const displayEntries = [];
  const visitedEntityIds = new Set();
  const appendSceneObjectSubtree = (sceneObject, depth) => {
    const entityId = readSceneObjectEntityId(sceneObject);
    if (entityId === null || visitedEntityIds.has(entityId)) {
      return;
    }
    visitedEntityIds.add(entityId);
    displayEntries.push(Object.freeze({ sceneObject, depth }));
    const childObjects = sortSceneObjectsForParent(sceneObject, childrenByParentEntityId.get(entityId) || []);
    for (const childObject of childObjects) {
      appendSceneObjectSubtree(childObject, depth + 1);
    }
  };

  const sortedRootObjects = rootObjects.slice().sort((leftObject, rightObject) => {
    const leftEntityId = readSceneObjectEntityId(leftObject);
    const rightEntityId = readSceneObjectEntityId(rightObject);
    return (sourceIndexByEntityId.get(leftEntityId) ?? 0) - (sourceIndexByEntityId.get(rightEntityId) ?? 0);
  });
  for (const rootObject of sortedRootObjects) {
    appendSceneObjectSubtree(rootObject, 0);
  }
  for (const sceneObject of sceneObjects) {
    appendSceneObjectSubtree(sceneObject, 0);
  }
  return Object.freeze(displayEntries);
};

const readSceneTreeSelectionRangeIds = (displayEntries, anchorEntityId, targetEntityId) => {
  const normalizedAnchorEntityId = normalizeSceneEntityId(anchorEntityId);
  const normalizedTargetEntityId = normalizeSceneEntityId(targetEntityId);
  if (normalizedTargetEntityId === null) {
    return Object.freeze([]);
  }
  const displayEntityIds = displayEntries
    .map((displayEntry) => readSceneObjectEntityId(displayEntry.sceneObject))
    .filter((entityId) => entityId !== null);
  const targetIndex = displayEntityIds.indexOf(normalizedTargetEntityId);
  const anchorIndex = displayEntityIds.indexOf(normalizedAnchorEntityId);
  if (targetIndex < 0 || anchorIndex < 0) {
    return Object.freeze([normalizedTargetEntityId]);
  }
  const rangeStartIndex = Math.min(anchorIndex, targetIndex);
  const rangeEndIndex = Math.max(anchorIndex, targetIndex);
  return Object.freeze(displayEntityIds.slice(rangeStartIndex, rangeEndIndex + 1));
};

class SelectionRenderer {
  constructor(webGlContext, vertexBuffer, indexBuffer, lineProgram, vertexAttribute, pathTracer) {
    this.webGlContext = webGlContext;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.lineProgram = lineProgram;
    this.vertexAttribute = vertexAttribute;
    this.pathTracer = pathTracer;
    this.lineUniformLocations = createUniformLocationCache();
    this.lineCubeMinUniformLocation = lineProgram
      ? readUniformLocation(webGlContext, lineProgram, this.lineUniformLocations, 'cubeMin')
      : null;
    this.lineCubeMaxUniformLocation = lineProgram
      ? readUniformLocation(webGlContext, lineProgram, this.lineUniformLocations, 'cubeMax')
      : null;
    this.lineModelviewProjectionUniformLocation = lineProgram
      ? readUniformLocation(webGlContext, lineProgram, this.lineUniformLocations, 'modelviewProjection')
      : null;
    this.sceneObjects = [];
    this.selectedEntityId = null;
    this.selectedEntityIds = Object.freeze([]);
    this.modelviewProjectionMatrix = createIdentityMat4();
    this.previousLineMinCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousLineMaxCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousLineModelviewProjectionMatrix = createInvalidMat4();
  }

  static create(webGlContext) {
    const [vertexBuffer, vertexBufferError] = createBufferWithData(
      webGlContext,
      webGlContext.ARRAY_BUFFER,
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 1, 0,
        0, 0, 1,
        1, 0, 1,
        0, 1, 1,
        1, 1, 1
      ]),
      webGlContext.STATIC_DRAW,
      'Selection vertex'
    );
    if (vertexBufferError) {
      return returnFailure(vertexBufferError.code, vertexBufferError.message, vertexBufferError.details);
    }

    const [indexBuffer, indexBufferError] = createBufferWithData(
      webGlContext,
      webGlContext.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([
        0, 1, 1, 3, 3, 2, 2, 0,
        4, 5, 5, 7, 7, 6, 6, 4,
        0, 4, 1, 5, 2, 6, 3, 7
      ]),
      webGlContext.STATIC_DRAW,
      'Selection index'
    );
    if (indexBufferError) {
      return returnFailure(indexBufferError.code, indexBufferError.message, indexBufferError.details);
    }

    const [compiledLineProgram, lineProgramError] = createLinkedProgram(
      webGlContext,
      lineVertexSource,
      lineFragmentSource,
      'selection line'
    );
    let lineProgram = compiledLineProgram;
    let vertexAttribute = -1;
    if (!lineProgramError) {
      vertexAttribute = webGlContext.getAttribLocation(lineProgram, 'selectionVertex');
      if (vertexAttribute < 0) {
        webGlContext.deleteProgram(lineProgram);
        lineProgram = null;
      }
    }

    const [pathTracer, pathTracerError] = PathTracer.create(webGlContext);
    if (pathTracerError) {
      return returnFailure(pathTracerError.code, pathTracerError.message, pathTracerError.details);
    }

    if (lineProgram && vertexAttribute >= 0) {
      webGlContext.enableVertexAttribArray(vertexAttribute);
    }
    return returnSuccess(new SelectionRenderer(webGlContext, vertexBuffer, indexBuffer, lineProgram, vertexAttribute, pathTracer));
  }

  setObjects(sceneObjects, renderSettings) {
    const visibleSceneObjects = sceneObjects.filter((sceneObject) => (
      !sceneObject.isHidden &&
      isRenderableSceneObject(sceneObject)
    ));
    const [, tracerError] = this.pathTracer.setObjects(visibleSceneObjects, renderSettings);
    if (tracerError) {
      return returnFailure(tracerError.code, tracerError.message, tracerError.details);
    }

    this.sceneObjects = sceneObjects.slice();
    this.pruneSelectionToSceneObjects();

    return returnSuccess(undefined);
  }

  async setObjectsAsync(sceneObjects, renderSettings, options = Object.freeze({})) {
    const visibleSceneObjects = sceneObjects.filter((sceneObject) => (
      !sceneObject.isHidden &&
      isRenderableSceneObject(sceneObject)
    ));
    const [, tracerError] = await this.pathTracer.setObjectsAsync(visibleSceneObjects, renderSettings, options);
    if (tracerError) {
      return returnFailure(tracerError.code, tracerError.message, tracerError.details);
    }

    this.sceneObjects = sceneObjects.slice();
    this.pruneSelectionToSceneObjects();

    return returnSuccess(undefined);
  }

  releaseSceneProgram() {
    this.sceneObjects = [];
    return this.pathTracer.releaseSceneProgram();
  }

  resolveSelectedObject(sceneObjects = this.sceneObjects) {
    return findSceneObjectByEntityId(sceneObjects, this.selectedEntityId);
  }

  resolveSelectedObjects(sceneObjects = this.sceneObjects) {
    if (this.selectedEntityIds.length === 0) {
      return Object.freeze([]);
    }
    const selectedObjects = this.selectedEntityIds
      .map((entityId) => findSceneObjectByEntityId(sceneObjects, entityId))
      .filter(Boolean);
    return Object.freeze(selectedObjects);
  }

  setSelectedEntityIds(entityIds, primaryEntityId = null, options = {}) {
    const normalizedEntityIds = [...normalizeSceneEntityIdList(entityIds)];
    let normalizedPrimaryEntityId = normalizeSceneEntityId(primaryEntityId);
    if (normalizedPrimaryEntityId !== null && !normalizedEntityIds.includes(normalizedPrimaryEntityId)) {
      normalizedEntityIds.unshift(normalizedPrimaryEntityId);
    }
    if (normalizedPrimaryEntityId === null && normalizedEntityIds.length > 0) {
      normalizedPrimaryEntityId = normalizedEntityIds[0];
    }
    const nextEntityIds = Object.freeze(normalizedEntityIds);
    const didSelectionChange = (
      this.selectedEntityId !== normalizedPrimaryEntityId ||
      !areSceneEntityIdListsEqual(this.selectedEntityIds, nextEntityIds)
    );

    this.selectedEntityId = normalizedPrimaryEntityId;
    this.selectedEntityIds = nextEntityIds;
    if (didSelectionChange && !options.skipSceneStoreSync) {
      setSceneStoreSelectedItemIds(this.selectedEntityIds, this.selectedEntityId);
    }
    return this.resolveSelectedObject();
  }

  selectObject(sceneObject, options = {}) {
    const entityId = readSceneObjectEntityId(sceneObject);
    return this.setSelectedEntityIds(entityId === null ? [] : [entityId], entityId, options);
  }

  clearSelection(options = {}) {
    return this.setSelectedEntityIds([], null, options);
  }

  syncSelectionFromSceneStore() {
    const sceneStorePrimaryEntityId = normalizeSceneEntityId(sceneStoreSelectedItemId.value);
    const sceneStoreEntityIds = normalizeSceneEntityIdList(sceneStoreSelectedItemIds.value);
    const nextEntityIds = sceneStoreEntityIds.length > 0
      ? sceneStoreEntityIds
      : (sceneStorePrimaryEntityId === null ? Object.freeze([]) : Object.freeze([sceneStorePrimaryEntityId]));
    if (
      this.selectedEntityId === sceneStorePrimaryEntityId &&
      areSceneEntityIdListsEqual(this.selectedEntityIds, nextEntityIds)
    ) {
      return this.resolveSelectedObject();
    }
    return this.setSelectedEntityIds(nextEntityIds, sceneStorePrimaryEntityId, { skipSceneStoreSync: true });
  }

  pruneSelectionToSceneObjects() {
    const liveEntityIds = new Set(
      this.sceneObjects
        .map(readSceneObjectEntityId)
        .filter((entityId) => entityId !== null)
    );
    const nextEntityIds = this.selectedEntityIds.filter((entityId) => liveEntityIds.has(entityId));
    const nextPrimaryEntityId = liveEntityIds.has(this.selectedEntityId)
      ? this.selectedEntityId
      : nextEntityIds[0] ?? null;
    if (
      this.selectedEntityId === nextPrimaryEntityId &&
      areSceneEntityIdListsEqual(this.selectedEntityIds, nextEntityIds)
    ) {
      return this.resolveSelectedObject();
    }
    return this.setSelectedEntityIds(nextEntityIds, nextPrimaryEntityId);
  }

  update(modelviewProjectionMatrix, inverseCameraMatrix, applicationState, didCameraChange, cameraRight, cameraUp) {
    this.modelviewProjectionMatrix = modelviewProjectionMatrix;
    const [, tracerError] = this.pathTracer.update(
      inverseCameraMatrix,
      applicationState,
      didCameraChange,
      cameraRight,
      cameraUp
    );
    if (tracerError) {
      return returnFailure(tracerError.code, tracerError.message, tracerError.details);
    }
    return returnSuccess(undefined);
  }

  render(applicationState, shouldDrawSelectionOutline = true) {
    this.syncSelectionFromSceneStore();
    const selectedObject = this.resolveSelectedObject();
    const [, pathTracerError] = invokeWebGlRenderer(this.pathTracer, applicationState);
    if (pathTracerError) {
      return returnFailure(pathTracerError.code, pathTracerError.message, pathTracerError.details);
    }

    if (
      !shouldDrawSelectionOutline ||
      !selectedObject ||
      selectedObject.isHidden ||
      !this.lineProgram ||
      this.vertexAttribute < 0
    ) {
      return returnSuccess(undefined);
    }

    const webGlContext = this.webGlContext;
    useWebGlProgramIfNeeded(webGlContext, this.lineProgram);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, null);
    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.bindBuffer(webGlContext.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    webGlContext.vertexAttribPointer(this.vertexAttribute, 3, webGlContext.FLOAT, false, 0, 0);

    if (this.lineCubeMinUniformLocation !== null) {
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.lineCubeMinUniformLocation,
        selectedObject.getMinCorner(),
        this.previousLineMinCorner
      );
    }
    if (this.lineCubeMaxUniformLocation !== null) {
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.lineCubeMaxUniformLocation,
        selectedObject.getMaxCorner(),
        this.previousLineMaxCorner
      );
    }
    if (this.lineModelviewProjectionUniformLocation !== null) {
      setChangedCachedMat4UniformValue(
        webGlContext,
        this.lineModelviewProjectionUniformLocation,
        this.modelviewProjectionMatrix,
        this.previousLineModelviewProjectionMatrix
      );
    }

    webGlContext.drawElements(webGlContext.LINES, 24, webGlContext.UNSIGNED_SHORT, 0);
    return returnSuccess(undefined);
  }
}

const ELEMENT_TEXT_CACHE = new WeakMap();

const writeElementTextIfChanged = (element, nextText) => {
  if (ELEMENT_TEXT_CACHE.has(element) && ELEMENT_TEXT_CACHE.get(element) === nextText) {
    return returnSuccess(undefined);
  }

  if (element.textContent !== nextText) {
    element.textContent = nextText;
  }
  ELEMENT_TEXT_CACHE.set(element, nextText);
  return returnSuccess(undefined);
};

const writeMetricTitleIfChanged = (metricValueElement, nextTitle) => {
  const metricElement = metricValueElement.parentElement;
  if (metricElement && metricElement.title !== nextTitle) {
    metricElement.title = nextTitle;
  }
  return returnSuccess(undefined);
};

const formatRendererBackendLabel = (rendererBackend) => (
  rendererBackend === 'webgpu' ? 'WebGPU' : 'WebGL'
);

const formatBenchmarkSourceLabel = (measurementSource, rendererBackend = 'webgl') => {
  const backendLabel = formatRendererBackendLabel(rendererBackend);
  if (measurementSource === 'gpu-timer') {
    return `${backendLabel} GPU timer`;
  }
  if (measurementSource === 'frame-paused') {
    return `${backendLabel} frames paused`;
  }
  if (measurementSource === 'rays-paused') {
    return `${backendLabel} rays paused`;
  }
  if (measurementSource === 'frame-estimate-pending') {
    return `${backendLabel} frame estimate`;
  }
  if (measurementSource === 'frame-estimate') {
    return `${backendLabel} frame estimate`;
  }
  return 'Warming up';
};

const SCENE_OBJECT_DISPLAY_NAMES = new Map();

const readSceneObjectDisplayName = (sceneObject) => {
  const constructorFunction = sceneObject.constructor;
  if (SCENE_OBJECT_DISPLAY_NAMES.has(constructorFunction)) {
    return SCENE_OBJECT_DISPLAY_NAMES.get(constructorFunction);
  }
  const constructorName = constructorFunction && constructorFunction.name
    ? constructorFunction.name
    : 'Scene item';
  const displayName = constructorName
    .replace(/SceneObject$/, '')
    .replace(/Sdf/g, 'SDF')
    .replace(/Csg/g, 'CSG')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  SCENE_OBJECT_DISPLAY_NAMES.set(constructorFunction, displayName);
  return displayName;
};

const LEGACY_BENCHMARK_SIGNAL_BINDINGS = Object.freeze([
  Object.freeze({ elementId: 'benchmark-performance-score', valueSignal: formattedPerformanceScore }),
  Object.freeze({ elementId: 'benchmark-rays-per-second', valueSignal: formattedRaysPerSecond }),
  Object.freeze({ elementId: 'benchmark-ray-bandwidth', valueSignal: formattedRayBandwidth }),
  Object.freeze({ elementId: 'benchmark-perceptual-fps', valueSignal: formattedPerceptualFramesPerSecond }),
  Object.freeze({ elementId: 'benchmark-resolution', valueSignal: formattedResolution }),
  Object.freeze({ elementId: 'benchmark-bounces', valueSignal: formattedBounces }),
  Object.freeze({
    elementId: 'benchmark-samples',
    valueSignal: formattedSamples,
    titleSignal: formattedSamplesTitle
  }),
  Object.freeze({
    elementId: 'benchmark-convergence',
    valueSignal: formattedConvergence,
    titleSignal: formattedConvergenceTitle
  }),
  Object.freeze({
    elementId: 'benchmark-gpu-memory',
    valueSignal: formattedGpuMemory,
    titleSignal: formattedGpuMemoryTitle
  }),
  Object.freeze({
    elementId: 'benchmark-scene-complexity',
    valueSignal: formattedSceneComplexity,
    titleSignal: formattedSceneComplexityTitle
  }),
  Object.freeze({ elementId: 'benchmark-gpu-renderer', valueSignal: formattedGpuRenderer }),
  Object.freeze({ elementId: 'benchmark-source', valueSignal: formattedMeasurementSource })
]);

const writeLegacyBenchmarkSignalElement = (documentObject, binding) => {
  const element = readOptionalElement(documentObject, binding.elementId);
  if (!element) {
    return;
  }
  const nextText = String(binding.valueSignal.value ?? '');
  if (element.textContent !== nextText) {
    element.textContent = nextText;
  }
  if (binding.titleSignal && element.parentElement) {
    const nextTitle = String(binding.titleSignal.value ?? '');
    if (element.parentElement.title !== nextTitle) {
      element.parentElement.title = nextTitle;
    }
  }
};

const attachLegacyBenchmarkSignalBindings = (documentObject) => (
  LEGACY_BENCHMARK_SIGNAL_BINDINGS.map((binding) => effect(() => {
    writeLegacyBenchmarkSignalElement(documentObject, binding);
  }))
);

class BenchmarkSignalBridge {
  constructor(applicationState, gpuRendererLabel) {
    this.applicationState = applicationState;
    this.gpuRendererLabel = gpuRendererLabel;
    this.previousUpdateMilliseconds = 0;
  }

  update(currentTimeMilliseconds, benchmarkSnapshot, shouldForceUpdate = false) {
    if (
      !shouldForceUpdate &&
      this.previousUpdateMilliseconds > 0 &&
      currentTimeMilliseconds - this.previousUpdateMilliseconds < BENCHMARK_UPDATE_INTERVAL_MILLISECONDS
    ) {
      return returnSuccess(undefined);
    }

    this.previousUpdateMilliseconds = currentTimeMilliseconds;
    const benchmarkScene = this.applicationState.isBenchmarkModeActive
      ? benchmarkScenes[this.applicationState.activeBenchmarkSceneName]
      : null;
    updateBenchmarkSignals(benchmarkSnapshot, {
      resolution: CANVAS_RENDER_RESOLUTION_LABEL,
      bounces: this.applicationState.lightBounceCount,
      gpuRenderer: this.gpuRendererLabel,
      benchmarkSceneLabel: benchmarkScene ? benchmarkScene.metadata.displayName : ''
    });
    return returnSuccess(undefined);
  }
}

const formatBenchmarkRunnerSeconds = (milliseconds) => `${(milliseconds / 1000).toFixed(1)}s`;

const formatBenchmarkRunnerScore = (value) => (
  Number.isFinite(value) ? formatCompactMetricValue(value) : '...'
);

const readBenchmarkRunnerDurationMilliseconds = (inputElement, fallbackMilliseconds, minSeconds, maxSeconds) => {
  const fallbackSeconds = fallbackMilliseconds / 1000;
  const parsedSeconds = Number.parseFloat(inputElement.value);
  const normalizedSeconds = Number.isFinite(parsedSeconds)
    ? clampNumber(parsedSeconds, minSeconds, maxSeconds)
    : fallbackSeconds;
  inputElement.value = normalizedSeconds.toFixed(normalizedSeconds % 1 === 0 ? 0 : 1);
  return Math.round(normalizedSeconds * 1000);
};

const calculateBenchmarkRunnerPercentile = (sortedScores, percentile) => {
  if (sortedScores.length === 0) {
    return Number.NaN;
  }
  if (sortedScores.length === 1) {
    return sortedScores[0];
  }
  const percentileIndex = clampNumber(percentile, 0, 1) * (sortedScores.length - 1);
  const lowerIndex = Math.floor(percentileIndex);
  const upperIndex = Math.ceil(percentileIndex);
  const upperWeight = percentileIndex - lowerIndex;
  return sortedScores[lowerIndex] * (1 - upperWeight) + sortedScores[upperIndex] * upperWeight;
};

const calculateBenchmarkRunnerStats = (scoreSamples) => {
  const finiteSamples = scoreSamples.filter((score) => Number.isFinite(score));
  if (finiteSamples.length === 0) {
    return Object.freeze({
      sampleCount: 0,
      minScore: Number.NaN,
      maxScore: Number.NaN,
      medianScore: Number.NaN,
      p5Score: Number.NaN,
      p95Score: Number.NaN
    });
  }

  const sortedScores = finiteSamples.slice().sort((a, b) => a - b);
  return Object.freeze({
    sampleCount: sortedScores.length,
    minScore: sortedScores[0],
    maxScore: sortedScores[sortedScores.length - 1],
    medianScore: calculateBenchmarkRunnerPercentile(sortedScores, 0.5),
    p5Score: calculateBenchmarkRunnerPercentile(sortedScores, 0.05),
    p95Score: calculateBenchmarkRunnerPercentile(sortedScores, 0.95)
  });
};

const createBenchmarkRunnerResult = (sceneName, scoreSamples, durationMilliseconds) => {
  const benchmarkScene = benchmarkScenes[sceneName];
  const stats = calculateBenchmarkRunnerStats(scoreSamples);
  return {
    sceneKey: sceneName,
    displayName: benchmarkScene.metadata.displayName,
    targetBounces: benchmarkScene.metadata.targetBounces,
    targetRaysPerPixel: benchmarkScene.metadata.targetRaysPerPixel,
    durationMilliseconds,
    sampleCount: stats.sampleCount,
    minScore: Number.isFinite(stats.minScore) ? Math.round(stats.minScore) : null,
    maxScore: Number.isFinite(stats.maxScore) ? Math.round(stats.maxScore) : null,
    medianScore: Number.isFinite(stats.medianScore) ? Math.round(stats.medianScore) : null,
    p5Score: Number.isFinite(stats.p5Score) ? Math.round(stats.p5Score) : null,
    p95Score: Number.isFinite(stats.p95Score) ? Math.round(stats.p95Score) : null
  };
};

const createBenchmarkRunnerResultFromPayloadScene = (sceneResult, measurementMilliseconds) => ({
  sceneKey: sceneResult.sceneKey,
  displayName: sceneResult.displayName,
  targetBounces: sceneResult.targetBounces,
  targetRaysPerPixel: sceneResult.targetRaysPerPixel,
  durationMilliseconds: normalizeBenchmarkDurationMilliseconds(
    sceneResult.durationMilliseconds,
    measurementMilliseconds
  ),
  sampleCount: normalizeBenchmarkInteger(sceneResult.sampleCount, 0),
  minScore: normalizeBenchmarkInteger(sceneResult.minScore, sceneResult.medianScore),
  maxScore: normalizeBenchmarkInteger(sceneResult.maxScore, sceneResult.medianScore),
  medianScore: normalizeBenchmarkInteger(sceneResult.medianScore, null),
  p5Score: normalizeBenchmarkInteger(sceneResult.p5Score, sceneResult.medianScore),
  p95Score: normalizeBenchmarkInteger(sceneResult.p95Score, sceneResult.medianScore),
  baselineComparison: normalizeBenchmarkBaselineComparison(sceneResult.baselineComparison)
});

const createBenchmarkPayloadSceneResult = (result) => {
  const payloadScene = {
    sceneKey: result.sceneKey,
    displayName: result.displayName,
    targetBounces: result.targetBounces,
    targetRaysPerPixel: result.targetRaysPerPixel,
    sampleCount: result.sampleCount,
    minScore: result.minScore,
    maxScore: result.maxScore,
    medianScore: result.medianScore,
    p5Score: result.p5Score,
    p95Score: result.p95Score
  };
  if (result.baselineComparison) {
    payloadScene.baselineComparison = {
      baselineMedianScore: result.baselineComparison.baselineMedianScore,
      changePercent: result.baselineComparison.changePercent,
      isRegression: result.baselineComparison.isRegression
    };
  }
  return payloadScene;
};

const createBenchmarkRunnerTableCell = (documentObject, textValue) => {
  const tableCell = documentObject.createElement('td');
  tableCell.textContent = textValue;
  return tableCell;
};

const createBenchmarkRunnerTableHeader = (documentObject, textValue) => {
  const tableHeader = documentObject.createElement('th');
  tableHeader.textContent = textValue;
  return tableHeader;
};

const calculateBenchmarkPayloadOverallScore = (payload) => {
  if (!payload || !Array.isArray(payload.scenes)) {
    return Number.NaN;
  }

  const scores = payload.scenes
    .map((sceneResult) => sceneResult.medianScore)
    .filter((score) => Number.isFinite(score));
  if (scores.length === 0) {
    return Number.NaN;
  }
  return Math.round(scores.reduce((totalScore, score) => totalScore + score, 0) / scores.length);
};

const readFirstBenchmarkValue = (...values) => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
};

const normalizeBenchmarkNumber = (value, fallbackValue = Number.NaN) => {
  if (value === null || value === undefined || value === '') {
    return fallbackValue;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
};

const normalizeBenchmarkInteger = (value, fallbackValue = null) => {
  const numberValue = normalizeBenchmarkNumber(value, Number.NaN);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : fallbackValue;
};

const normalizeBenchmarkString = (...values) => {
  const value = readFirstBenchmarkValue(...values);
  return value === null ? '' : String(value).trim();
};

const normalizeBenchmarkDate = (dateValue) => {
  const parsedDate = dateValue ? new Date(dateValue) : new Date();
  return Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString();
};

const normalizeBenchmarkDurationMilliseconds = (durationValue, fallbackValue) => {
  const normalizedDuration = normalizeBenchmarkNumber(durationValue, Number.NaN);
  return Number.isFinite(normalizedDuration) && normalizedDuration >= 0
    ? Math.round(normalizedDuration)
    : fallbackValue;
};

const normalizeBenchmarkCanvasResolution = (payload) => {
  const rawResolution = readFirstBenchmarkValue(
    payload.canvasResolution,
    payload.resolution,
    payload.renderResolution
  );
  if (rawResolution && typeof rawResolution === 'object') {
    return {
      width: normalizeBenchmarkInteger(
        readFirstBenchmarkValue(rawResolution.width, rawResolution.w),
        CANVAS_RENDER_WIDTH
      ),
      height: normalizeBenchmarkInteger(
        readFirstBenchmarkValue(rawResolution.height, rawResolution.h),
        CANVAS_RENDER_HEIGHT
      )
    };
  }

  if (typeof rawResolution === 'number') {
    const squareResolution = normalizeBenchmarkInteger(rawResolution, CANVAS_RENDER_WIDTH);
    return {
      width: squareResolution,
      height: squareResolution
    };
  }

  if (typeof rawResolution === 'string') {
    const resolutionMatch = /(\d+)\s*[xX]\s*(\d+)/.exec(rawResolution);
    if (resolutionMatch) {
      return {
        width: normalizeBenchmarkInteger(resolutionMatch[1], CANVAS_RENDER_WIDTH),
        height: normalizeBenchmarkInteger(resolutionMatch[2], CANVAS_RENDER_HEIGHT)
      };
    }
  }

  return {
    width: normalizeBenchmarkInteger(payload.width, CANVAS_RENDER_WIDTH),
    height: normalizeBenchmarkInteger(payload.height, CANVAS_RENDER_HEIGHT)
  };
};

const normalizeBenchmarkBaselineComparison = (baselineComparison) => {
  if (!baselineComparison || typeof baselineComparison !== 'object') {
    return null;
  }

  const changePercent = normalizeBenchmarkNumber(
    readFirstBenchmarkValue(
      baselineComparison.changePercent,
      baselineComparison.deltaPercent,
      baselineComparison.delta
    ),
    Number.NaN
  );
  if (!Number.isFinite(changePercent)) {
    return null;
  }

  return {
    baselineMedianScore: normalizeBenchmarkInteger(
      readFirstBenchmarkValue(
        baselineComparison.baselineMedianScore,
        baselineComparison.baselineScore,
        baselineComparison.medianScore
      ),
      null
    ),
    changePercent,
    isRegression: baselineComparison.isRegression === true || changePercent <= -10
  };
};

const normalizeBenchmarkSceneKey = (sceneKeyValue) => {
  const sceneKey = String(sceneKeyValue || '').trim();
  if (!sceneKey) {
    return '';
  }
  const resolvedSceneKey = resolveBenchmarkSceneName(sceneKey);
  if (benchmarkScenes[resolvedSceneKey]) {
    return resolvedSceneKey;
  }
  const normalizedDisplayName = sceneKey.toLowerCase();
  for (const candidateSceneKey of Object.keys(benchmarkScenes)) {
    if (benchmarkScenes[candidateSceneKey].metadata.displayName.toLowerCase() === normalizedDisplayName) {
      return candidateSceneKey;
    }
  }
  return sceneKey;
};

const normalizeBenchmarkSceneResult = (sceneResult, sceneIndex, payload) => {
  if (!sceneResult || typeof sceneResult !== 'object') {
    return returnFailure('invalid-benchmark-result', 'Benchmark scene result is invalid.');
  }

  const sceneKey = normalizeBenchmarkSceneKey(readFirstBenchmarkValue(
    sceneResult.sceneKey,
    sceneResult.sceneName,
    sceneResult.key,
    sceneResult.id
  ));
  const benchmarkScene = benchmarkScenes[sceneKey] || null;
  const displayName = normalizeBenchmarkString(
    sceneResult.displayName,
    sceneResult.name,
    sceneResult.scene,
    sceneResult.sceneName,
    benchmarkScene ? benchmarkScene.metadata.displayName : '',
    `Result ${sceneIndex + 1}`
  );
  const medianScore = normalizeBenchmarkInteger(
    readFirstBenchmarkValue(sceneResult.medianScore, sceneResult.score, sceneResult.currentScore),
    null
  );

  return returnSuccess({
    sceneKey: sceneKey || `shared-result-${sceneIndex + 1}`,
    displayName,
    targetBounces: normalizeBenchmarkInteger(
      readFirstBenchmarkValue(
        sceneResult.targetBounces,
        sceneResult.bounceCount,
        sceneResult.bounces,
        payload.bounceCount,
        benchmarkScene ? benchmarkScene.metadata.targetBounces : null
      ),
      null
    ),
    targetRaysPerPixel: normalizeBenchmarkInteger(
      readFirstBenchmarkValue(
        sceneResult.targetRaysPerPixel,
        sceneResult.raysPerPixel,
        benchmarkScene ? benchmarkScene.metadata.targetRaysPerPixel : null
      ),
      null
    ),
    durationMilliseconds: normalizeBenchmarkDurationMilliseconds(
      readFirstBenchmarkValue(sceneResult.durationMilliseconds, payload.measurementMilliseconds),
      BENCHMARK_RUNNER_DEFAULT_MEASUREMENT_MILLISECONDS
    ),
    sampleCount: normalizeBenchmarkInteger(sceneResult.sampleCount, 0),
    minScore: normalizeBenchmarkInteger(sceneResult.minScore, medianScore),
    maxScore: normalizeBenchmarkInteger(sceneResult.maxScore, medianScore),
    medianScore,
    p5Score: normalizeBenchmarkInteger(
      readFirstBenchmarkValue(sceneResult.p5Score, sceneResult.p05Score, sceneResult.p5),
      medianScore
    ),
    p95Score: normalizeBenchmarkInteger(
      readFirstBenchmarkValue(sceneResult.p95Score, sceneResult.p95),
      medianScore
    ),
    baselineComparison: normalizeBenchmarkBaselineComparison(readFirstBenchmarkValue(
      sceneResult.baselineComparison,
      sceneResult.baseline
    ))
  });
};

const normalizeBenchmarkPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return returnFailure('invalid-benchmark-result', 'Benchmark result payload is invalid.');
  }

  const rawScenes = Array.isArray(payload.scenes)
    ? payload.scenes
    : (Array.isArray(payload.results) ? payload.results : null);
  const singleScore = normalizeBenchmarkNumber(
    readFirstBenchmarkValue(payload.medianScore, payload.score, payload.currentScore),
    Number.NaN
  );
  const sceneSource = rawScenes || (Number.isFinite(singleScore) ? [payload] : []);
  const scenes = [];
  for (let sceneIndex = 0; sceneIndex < sceneSource.length; sceneIndex += 1) {
    const [scene, sceneError] = normalizeBenchmarkSceneResult(sceneSource[sceneIndex], sceneIndex, payload);
    if (!sceneError && scene.medianScore !== null) {
      scenes.push(scene);
    }
  }

  if (scenes.length === 0) {
    return returnFailure('invalid-benchmark-result', 'Benchmark result payload does not include scene scores.');
  }

  const canvasResolution = normalizeBenchmarkCanvasResolution(payload);
  const normalizedPayload = {
    version: normalizeBenchmarkInteger(payload.version, 1),
    date: normalizeBenchmarkDate(readFirstBenchmarkValue(payload.date, payload.isoDate, payload.timestamp)),
    gpu: normalizeBenchmarkString(payload.gpu, payload.gpuRenderer, payload.gpuRendererString, payload.renderer),
    rendererBackend: normalizeBenchmarkString(payload.rendererBackend, 'webgl') || 'webgl',
    userAgent: normalizeBenchmarkString(payload.userAgent, payload.browser),
    platform: normalizeBenchmarkString(payload.platform, payload.os),
    browser: normalizeBenchmarkString(payload.browser),
    os: normalizeBenchmarkString(payload.os, payload.platform),
    canvasResolution,
    estimatedGpuBufferMemoryBytes: normalizeBenchmarkInteger(payload.estimatedGpuBufferMemoryBytes, null),
    sceneComplexity: payload.sceneComplexity && typeof payload.sceneComplexity === 'object'
      ? payload.sceneComplexity
      : null,
    warmupMilliseconds: normalizeBenchmarkDurationMilliseconds(
      payload.warmupMilliseconds,
      BENCHMARK_RUNNER_DEFAULT_WARMUP_MILLISECONDS
    ),
    measurementMilliseconds: normalizeBenchmarkDurationMilliseconds(
      payload.measurementMilliseconds,
      BENCHMARK_RUNNER_DEFAULT_MEASUREMENT_MILLISECONDS
    ),
    scenes
  };
  normalizedPayload.overallScore = normalizeBenchmarkInteger(
    payload.overallScore,
    calculateBenchmarkPayloadOverallScore(normalizedPayload)
  );
  normalizedPayload.sceneName = scenes.length === 1 ? scenes[0].displayName : 'Benchmark sequence';
  normalizedPayload.bounceCount = scenes.length === 1 ? scenes[0].targetBounces : null;
  return returnSuccess(normalizedPayload);
};

const encodeBenchmarkPayloadBase64Url = (windowObject, payload) => {
  if (!windowObject || typeof windowObject.btoa !== 'function') {
    return returnFailure('share-url-unavailable', 'Benchmark share URLs are not available in this browser.');
  }

  const jsonValue = JSON.stringify(payload);
  const textEncoder = typeof windowObject.TextEncoder === 'function'
    ? new windowObject.TextEncoder()
    : null;
  if (!textEncoder) {
    return returnFailure('share-url-unavailable', 'Text encoding is not available in this browser.');
  }

  const encodedBytes = textEncoder.encode(jsonValue);
  const chunkSize = 8192;
  let binaryValue = '';
  for (let byteIndex = 0; byteIndex < encodedBytes.length; byteIndex += chunkSize) {
    const chunk = encodedBytes.subarray(byteIndex, byteIndex + chunkSize);
    binaryValue += String.fromCharCode.apply(null, chunk);
  }

  return returnSuccess(
    windowObject.btoa(binaryValue)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
  );
};

const decodeBenchmarkPayloadBase64Url = (windowObject, encodedPayload) => {
  if (!windowObject || typeof windowObject.atob !== 'function') {
    return returnFailure('share-url-unavailable', 'Benchmark share URLs are not available in this browser.');
  }

  try {
    const normalizedPayload = String(encodedPayload || '')
      .trim()
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const paddingLength = (4 - (normalizedPayload.length % 4)) % 4;
    const binaryValue = windowObject.atob(`${normalizedPayload}${'='.repeat(paddingLength)}`);
    const decodedBytes = new Uint8Array(binaryValue.length);
    for (let byteIndex = 0; byteIndex < binaryValue.length; byteIndex += 1) {
      decodedBytes[byteIndex] = binaryValue.charCodeAt(byteIndex);
    }

    let jsonValue = '';
    if (typeof windowObject.TextDecoder === 'function') {
      jsonValue = new windowObject.TextDecoder().decode(decodedBytes);
    } else {
      let escapedValue = '';
      for (let byteIndex = 0; byteIndex < decodedBytes.length; byteIndex += 1) {
        escapedValue += `%${decodedBytes[byteIndex].toString(16).padStart(2, '0')}`;
      }
      jsonValue = decodeURIComponent(escapedValue);
    }

    return returnSuccess(JSON.parse(jsonValue));
  } catch (errorValue) {
    return returnFailure(
      'invalid-benchmark-result-url',
      'Benchmark result URL could not be parsed.',
      readErrorMessage(errorValue)
    );
  }
};

const readBenchmarkShareHashValue = (windowObject) => {
  if (!windowObject || !windowObject.location) {
    return '';
  }

  const rawHashValue = String(windowObject.location.hash || '').replace(/^#/, '');
  if (!rawHashValue) {
    return '';
  }

  if (typeof windowObject.URLSearchParams === 'function') {
    const hashParameters = new windowObject.URLSearchParams(rawHashValue);
    return hashParameters.get(BENCHMARK_SHARE_HASH_KEY) ||
      hashParameters.get(BENCHMARK_LEGACY_SHARE_HASH_KEY) ||
      '';
  }

  const resultPrefix = `${BENCHMARK_SHARE_HASH_KEY}=`;
  const legacyPrefix = `${BENCHMARK_LEGACY_SHARE_HASH_KEY}=`;
  if (rawHashValue.startsWith(resultPrefix)) {
    const encodedValue = rawHashValue.slice(resultPrefix.length);
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return encodedValue;
    }
  }
  if (rawHashValue.startsWith(legacyPrefix)) {
    const encodedValue = rawHashValue.slice(legacyPrefix.length);
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return encodedValue;
    }
  }
  return '';
};

const readBenchmarkPayloadFromHash = (windowObject) => {
  const encodedPayload = readBenchmarkShareHashValue(windowObject);
  if (!encodedPayload) {
    return returnSuccess(null);
  }

  const [decodedPayload, decodeError] = decodeBenchmarkPayloadBase64Url(windowObject, encodedPayload);
  if (decodeError) {
    return returnFailure(decodeError.code, decodeError.message, decodeError.details);
  }

  const [normalizedPayload, normalizeError] = normalizeBenchmarkPayload(decodedPayload);
  if (normalizeError) {
    return returnFailure(normalizeError.code, normalizeError.message, normalizeError.details);
  }
  return returnSuccess(normalizedPayload);
};

const createBenchmarkResultsShareUrl = (windowObject, payload) => {
  if (!windowObject || !windowObject.location || typeof windowObject.URL !== 'function') {
    return returnFailure('share-url-unavailable', 'Benchmark share URLs are not available in this browser.');
  }

  const [encodedPayload, encodeError] = encodeBenchmarkPayloadBase64Url(windowObject, payload);
  if (encodeError) {
    return returnFailure(encodeError.code, encodeError.message, encodeError.details);
  }

  const resultUrl = new windowObject.URL(windowObject.location.href);
  resultUrl.hash = `${BENCHMARK_SHARE_HASH_KEY}=${encodedPayload}`;
  return returnSuccess(resultUrl.toString());
};

const formatBenchmarkBaselineDelta = (baselineComparison) => {
  if (!baselineComparison || !Number.isFinite(baselineComparison.changePercent)) {
    return 'No baseline';
  }
  const deltaPrefix = baselineComparison.changePercent > 0 ? '+' : '';
  return `${deltaPrefix}${baselineComparison.changePercent.toFixed(1)}%`;
};

const formatBenchmarkBrowserLabel = (payload) => {
  if (payload && payload.browser) {
    return payload.browser;
  }

  const userAgent = payload && payload.userAgent ? payload.userAgent : '';
  const browserMatch = (
    /Edg\/([\d.]+)/.exec(userAgent) ||
    /Firefox\/([\d.]+)/.exec(userAgent) ||
    /Chrome\/([\d.]+)/.exec(userAgent) ||
    /Version\/([\d.]+).*Safari/.exec(userAgent)
  );
  if (!browserMatch) {
    return 'Browser unavailable';
  }
  if (userAgent.includes('Edg/')) {
    return `Edge ${browserMatch[1]}`;
  }
  if (userAgent.includes('Firefox/')) {
    return `Firefox ${browserMatch[1]}`;
  }
  if (userAgent.includes('Chrome/')) {
    return `Chrome ${browserMatch[1]}`;
  }
  return `Safari ${browserMatch[1]}`;
};

const formatBenchmarkPlatformLabel = (payload) => (
  payload && (payload.os || payload.platform) ? (payload.os || payload.platform) : 'OS unavailable'
);

const drawBenchmarkScoreCardText = (canvasContext, textValue, xPosition, yPosition, maxWidth) => {
  canvasContext.fillText(textValue, xPosition, yPosition, maxWidth);
};

const drawBenchmarkScoreCard = (canvasContext, payload) => {
  const width = BENCHMARK_SCORE_CARD_WIDTH;
  const height = BENCHMARK_SCORE_CARD_HEIGHT;
  const overallScore = Number.isFinite(payload.overallScore)
    ? payload.overallScore
    : calculateBenchmarkPayloadOverallScore(payload);
  const timestamp = payload && payload.date ? new Date(payload.date) : null;
  const dateLabel = timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toLocaleDateString()
    : 'Benchmark run';
  const resolutionLabel = payload && payload.canvasResolution
    ? `${payload.canvasResolution.width} x ${payload.canvasResolution.height}`
    : CANVAS_RENDER_RESOLUTION_LABEL;

  canvasContext.fillStyle = '#101418';
  canvasContext.fillRect(0, 0, width, height);
  canvasContext.fillStyle = '#1b2229';
  canvasContext.fillRect(0, 0, width, 92);
  canvasContext.fillStyle = '#2f6f87';
  canvasContext.fillRect(0, 89, width, 3);

  canvasContext.fillStyle = '#edf1f4';
  canvasContext.font = '700 26px Segoe UI, Arial, sans-serif';
  drawBenchmarkScoreCardText(canvasContext, 'Pathtracer benchmark', 28, 38, 480);
  canvasContext.font = '700 30px Segoe UI, Arial, sans-serif';
  drawBenchmarkScoreCardText(canvasContext, `Overall ${formatBenchmarkRunnerScore(overallScore)}`, 620, 38, 150);

  canvasContext.fillStyle = '#aeb7c2';
  canvasContext.font = '600 13px Segoe UI, Arial, sans-serif';
  drawBenchmarkScoreCardText(canvasContext, payload.gpu || 'GPU renderer unavailable', 28, 62, 520);
  drawBenchmarkScoreCardText(
    canvasContext,
    `${formatBenchmarkBrowserLabel(payload)} - ${formatBenchmarkPlatformLabel(payload)} - ${formatRendererBackendLabel(payload.rendererBackend)} - ${dateLabel}`,
    28,
    82,
    690
  );

  const columns = [
    { label: 'Scene', x: 28, width: 235 },
    { label: 'Median', x: 292, width: 74 },
    { label: 'P5 / P95', x: 382, width: 108 },
    { label: 'Delta', x: 520, width: 88 },
    { label: 'Samples', x: 622, width: 68 },
    { label: 'Bounces', x: 704, width: 64 }
  ];
  const tableTop = 122;
  const rowHeight = 27;

  canvasContext.fillStyle = '#aeb7c2';
  canvasContext.font = '700 11px Segoe UI, Arial, sans-serif';
  for (const column of columns) {
    drawBenchmarkScoreCardText(canvasContext, column.label.toUpperCase(), column.x, tableTop, column.width);
  }

  const scenes = Array.isArray(payload.scenes) ? payload.scenes.slice(0, 7) : [];
  canvasContext.font = '600 13px Segoe UI, Arial, sans-serif';
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
    const sceneResult = scenes[sceneIndex];
    const rowTop = tableTop + 22 + sceneIndex * rowHeight;
    canvasContext.fillStyle = sceneIndex % 2 === 0 ? '#1a2026' : '#151b21';
    canvasContext.fillRect(20, rowTop - 17, width - 40, rowHeight - 4);
    canvasContext.fillStyle = '#edf1f4';
    drawBenchmarkScoreCardText(canvasContext, sceneResult.displayName, columns[0].x, rowTop, columns[0].width);
    drawBenchmarkScoreCardText(canvasContext, formatBenchmarkRunnerScore(sceneResult.medianScore), columns[1].x, rowTop, columns[1].width);
    drawBenchmarkScoreCardText(
      canvasContext,
      `${formatBenchmarkRunnerScore(sceneResult.p5Score)} / ${formatBenchmarkRunnerScore(sceneResult.p95Score)}`,
      columns[2].x,
      rowTop,
      columns[2].width
    );
    drawBenchmarkScoreCardText(
      canvasContext,
      formatBenchmarkBaselineDelta(sceneResult.baselineComparison),
      columns[3].x,
      rowTop,
      columns[3].width
    );
    drawBenchmarkScoreCardText(canvasContext, String(sceneResult.sampleCount), columns[4].x, rowTop, columns[4].width);
    drawBenchmarkScoreCardText(
      canvasContext,
      sceneResult.targetBounces === null ? '...' : String(sceneResult.targetBounces),
      columns[5].x,
      rowTop,
      columns[5].width
    );
  }

  canvasContext.fillStyle = '#8b949e';
  canvasContext.font = '600 12px Segoe UI, Arial, sans-serif';
  drawBenchmarkScoreCardText(
    canvasContext,
    `${resolutionLabel} render target - ${formatBenchmarkRunnerSeconds(payload.measurementMilliseconds)} measurement windows`,
    28,
    height - 22,
    width - 56
  );
};

const createBenchmarkScoreCardFileName = (payload) => {
  const timestamp = payload && payload.date ? new Date(payload.date) : new Date();
  const datePart = Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString().slice(0, 19).replace(/[-:T]/g, '')
    : 'latest';
  return `pathtracer-benchmark-score-card-${datePart}.png`;
};

class BenchmarkRunner {
  constructor(
    uiController,
    documentObject,
    statusElement,
    summaryElement,
    warmupInput,
    measurementInput
  ) {
    this.uiController = uiController;
    this.documentObject = documentObject;
    this.statusElement = statusElement;
    this.summaryElement = summaryElement;
    this.warmupInput = warmupInput;
    this.measurementInput = measurementInput;
    this.sceneOrder = Object.freeze(Object.keys(benchmarkScenes));
    this.isActive = false;
    this.currentSceneIndex = -1;
    this.currentScene = null;
    this.results = [];
    this.latestPayload = null;
    this.warmupMilliseconds = BENCHMARK_RUNNER_DEFAULT_WARMUP_MILLISECONDS;
    this.measurementMilliseconds = BENCHMARK_RUNNER_DEFAULT_MEASUREMENT_MILLISECONDS;
    this.toastTimeoutId = 0;
  }

  writeStatus(statusText) {
    return writeElementTextIfChanged(this.statusElement, statusText);
  }

  showToast(messageText) {
    const windowObject = this.documentObject.defaultView;
    if (!windowObject || !this.documentObject.body) {
      return returnSuccess(undefined);
    }

    let toastElement = this.documentObject.getElementById('benchmark-result-toast');
    if (!(toastElement instanceof HTMLElement)) {
      toastElement = this.documentObject.createElement('div');
      toastElement.id = 'benchmark-result-toast';
      toastElement.setAttribute('role', 'status');
      toastElement.setAttribute('aria-live', 'polite');
      toastElement.style.position = 'fixed';
      toastElement.style.right = '24px';
      toastElement.style.bottom = '24px';
      toastElement.style.zIndex = '20';
      toastElement.style.padding = '10px 14px';
      toastElement.style.borderRadius = '6px';
      toastElement.style.background = '#edf1f4';
      toastElement.style.color = '#101418';
      toastElement.style.font = '600 14px Segoe UI, Arial, sans-serif';
      toastElement.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.35)';
      toastElement.style.transition = 'opacity 160ms ease';
      this.documentObject.body.appendChild(toastElement);
    }

    if (this.toastTimeoutId) {
      windowObject.clearTimeout(this.toastTimeoutId);
    }
    toastElement.textContent = messageText;
    toastElement.hidden = false;
    toastElement.style.opacity = '1';
    this.toastTimeoutId = windowObject.setTimeout(() => {
      toastElement.style.opacity = '0';
      this.toastTimeoutId = windowObject.setTimeout(() => {
        toastElement.hidden = true;
        this.toastTimeoutId = 0;
      }, 180);
    }, 1300);
    return returnSuccess(undefined);
  }

  readWindowDurations() {
    this.warmupMilliseconds = readBenchmarkRunnerDurationMilliseconds(
      this.warmupInput,
      BENCHMARK_RUNNER_DEFAULT_WARMUP_MILLISECONDS,
      0,
      60
    );
    this.measurementMilliseconds = readBenchmarkRunnerDurationMilliseconds(
      this.measurementInput,
      BENCHMARK_RUNNER_DEFAULT_MEASUREMENT_MILLISECONDS,
      1,
      120
    );
    return returnSuccess(undefined);
  }

  start(currentTimeMilliseconds) {
    const [, durationError] = this.readWindowDurations();
    if (durationError) {
      return returnFailure(durationError.code, durationError.message, durationError.details);
    }

    this.isActive = true;
    this.currentSceneIndex = -1;
    this.currentScene = null;
    this.results = [];
    this.latestPayload = null;
    const [, statusError] = this.writeStatus(
      `Running ${this.sceneOrder.length} scenes: ${formatBenchmarkRunnerSeconds(this.warmupMilliseconds)} warm-up, ${formatBenchmarkRunnerSeconds(this.measurementMilliseconds)} measurement.`
    );
    if (statusError) {
      return returnFailure(statusError.code, statusError.message, statusError.details);
    }
    return this.startNextScene(currentTimeMilliseconds);
  }

  stop(statusText = 'Benchmark sequence stopped.') {
    if (!this.isActive) {
      return returnSuccess(undefined);
    }
    this.isActive = false;
    this.currentScene = null;
    return this.writeStatus(statusText);
  }

  startNextScene(currentTimeMilliseconds) {
    this.currentSceneIndex += 1;
    if (this.currentSceneIndex >= this.sceneOrder.length) {
      return this.completeRun();
    }

    const sceneName = this.sceneOrder[this.currentSceneIndex];
    const benchmarkScene = benchmarkScenes[sceneName];
    const [, sceneError] = this.uiController.loadBenchmarkScene(sceneName);
    if (sceneError) {
      this.isActive = false;
      return returnFailure(sceneError.code, sceneError.message, sceneError.details);
    }

    this.currentScene = {
      sceneName,
      displayName: benchmarkScene.metadata.displayName,
      phase: 'warmup',
      phaseStartMilliseconds: currentTimeMilliseconds,
      lastSampleMilliseconds: 0,
      scoreSamples: []
    };

    const [, statusError] = this.writeStatus(
      `Scene ${this.currentSceneIndex + 1}/${this.sceneOrder.length}: ${benchmarkScene.metadata.displayName} warm-up.`
    );
    if (statusError) {
      return returnFailure(statusError.code, statusError.message, statusError.details);
    }
    return this.renderSummary(currentTimeMilliseconds);
  }

  beginMeasurement(currentTimeMilliseconds) {
    if (!this.currentScene) {
      return returnSuccess(undefined);
    }

    const pathTracer = this.uiController.selectionRenderer.pathTracer;
    const [, resetError] = pathTracer.resetBenchmark();
    if (resetError) {
      this.isActive = false;
      return returnFailure(resetError.code, resetError.message, resetError.details);
    }

    this.currentScene.phase = 'measure';
    this.currentScene.phaseStartMilliseconds = currentTimeMilliseconds;
    this.currentScene.lastSampleMilliseconds = 0;
    this.currentScene.scoreSamples = [];
    return this.writeStatus(
      `Scene ${this.currentSceneIndex + 1}/${this.sceneOrder.length}: ${this.currentScene.displayName} measuring.`
    );
  }

  recordSnapshot(currentTimeMilliseconds, benchmarkSnapshot) {
    if (
      !this.currentScene ||
      this.currentScene.phase !== 'measure' ||
      currentTimeMilliseconds - this.currentScene.lastSampleMilliseconds < BENCHMARK_RUNNER_SAMPLE_INTERVAL_MILLISECONDS ||
      benchmarkSnapshot.scoreSampleCount < PERFORMANCE_SCORE_READY_TRACE_SAMPLE_COUNT ||
      isPausedBenchmarkSource(benchmarkSnapshot.measurementSource)
    ) {
      return returnSuccess(undefined);
    }

    const score = benchmarkSnapshot.performanceScore;
    if (!Number.isFinite(score)) {
      return returnSuccess(undefined);
    }

    this.currentScene.scoreSamples.push(score);
    this.currentScene.lastSampleMilliseconds = currentTimeMilliseconds;
    return returnSuccess(undefined);
  }

  finishCurrentScene(currentTimeMilliseconds) {
    if (!this.currentScene) {
      return this.startNextScene(currentTimeMilliseconds);
    }

    this.results.push(createBenchmarkRunnerResult(
      this.currentScene.sceneName,
      this.currentScene.scoreSamples,
      this.measurementMilliseconds
    ));
    this.currentScene = null;
    return this.startNextScene(currentTimeMilliseconds);
  }

  advance(currentTimeMilliseconds, benchmarkSnapshot) {
    if (!this.isActive || !this.currentScene) {
      return returnSuccess(undefined);
    }

    const phaseElapsedMilliseconds = currentTimeMilliseconds - this.currentScene.phaseStartMilliseconds;
    if (this.currentScene.phase === 'warmup' && phaseElapsedMilliseconds >= this.warmupMilliseconds) {
      const [, measurementError] = this.beginMeasurement(currentTimeMilliseconds);
      if (measurementError) {
        return returnFailure(measurementError.code, measurementError.message, measurementError.details);
      }
      return this.renderSummary(currentTimeMilliseconds);
    }

    if (this.currentScene.phase === 'measure') {
      const [, sampleError] = this.recordSnapshot(currentTimeMilliseconds, benchmarkSnapshot);
      if (sampleError) {
        return returnFailure(sampleError.code, sampleError.message, sampleError.details);
      }

      if (phaseElapsedMilliseconds >= this.measurementMilliseconds) {
        return this.finishCurrentScene(currentTimeMilliseconds);
      }
    }

    return this.renderSummary(currentTimeMilliseconds);
  }

  readBaseline() {
    const windowObject = this.documentObject.defaultView;
    if (!windowObject || !windowObject.localStorage) {
      return null;
    }
    try {
      const rawValue = windowObject.localStorage.getItem(BENCHMARK_BASELINE_STORAGE_KEY);
      const parsedValue = rawValue ? JSON.parse(rawValue) : null;
      const [normalizedValue, normalizeError] = normalizeBenchmarkPayload(parsedValue);
      return normalizeError ? null : normalizedValue;
    } catch (errorValue) {
      return null;
    }
  }

  writeBaselinePayload(payload) {
    const windowObject = this.documentObject.defaultView;
    if (!windowObject || !windowObject.localStorage) {
      return returnFailure('local-storage-unavailable', 'Baseline storage is not available in this browser.');
    }

    try {
      windowObject.localStorage.setItem(BENCHMARK_BASELINE_STORAGE_KEY, JSON.stringify(payload));
    } catch (errorValue) {
      return returnFailure('baseline-save-failed', 'Unable to save benchmark baseline.', readErrorMessage(errorValue));
    }

    return returnSuccess(undefined);
  }

  applyBaselineComparison(baselinePayload = null) {
    const baseline = baselinePayload || this.readBaseline();
    if (!baseline) {
      for (const result of this.results) {
        result.baselineComparison = normalizeBenchmarkBaselineComparison(result.baselineComparison);
      }
      return returnSuccess(undefined);
    }

    for (const result of this.results) {
      const baselineScene = baseline.scenes.find((sceneResult) => sceneResult.sceneKey === result.sceneKey);
      if (!baselineScene || !Number.isFinite(baselineScene.medianScore) || !Number.isFinite(result.medianScore)) {
        result.baselineComparison = null;
        continue;
      }

      const changePercent = baselineScene.medianScore > 0
        ? ((result.medianScore - baselineScene.medianScore) / baselineScene.medianScore) * 100
        : 0;
      result.baselineComparison = {
        baselineMedianScore: baselineScene.medianScore,
        changePercent,
        isRegression: changePercent <= -10
      };
    }

    return returnSuccess(undefined);
  }

  createResultsPayload() {
    const windowObject = this.documentObject.defaultView;
    const navigatorObject = windowObject ? windowObject.navigator : null;
    const benchmarkSnapshot = this.uiController.selectionRenderer.pathTracer.benchmarkSnapshot;
    const payload = {
      version: 1,
      date: new Date().toISOString(),
      gpu: this.uiController.benchmarkDisplay.gpuRendererLabel,
      rendererBackend: benchmarkSnapshot.rendererBackend,
      userAgent: navigatorObject ? navigatorObject.userAgent : '',
      platform: navigatorObject ? navigatorObject.platform : '',
      browser: '',
      os: navigatorObject ? navigatorObject.platform : '',
      canvasResolution: {
        width: CANVAS_RENDER_WIDTH,
        height: CANVAS_RENDER_HEIGHT
      },
      estimatedGpuBufferMemoryBytes: benchmarkSnapshot.estimatedGpuBufferMemoryBytes,
      sceneComplexity: {
        score: benchmarkSnapshot.sceneComplexityScore,
        label: benchmarkSnapshot.sceneComplexityLabel,
        objectCount: benchmarkSnapshot.sceneObjectCount,
        sdfObjectCount: benchmarkSnapshot.sceneSdfObjectCount,
        transparentObjectCount: benchmarkSnapshot.sceneTransparentObjectCount
      },
      warmupMilliseconds: this.warmupMilliseconds,
      measurementMilliseconds: this.measurementMilliseconds,
      scenes: this.results.map(createBenchmarkPayloadSceneResult)
    };
    payload.overallScore = calculateBenchmarkPayloadOverallScore(payload);
    payload.sceneName = payload.scenes.length === 1 ? payload.scenes[0].displayName : 'Benchmark sequence';
    payload.bounceCount = payload.scenes.length === 1 ? payload.scenes[0].targetBounces : null;
    return payload;
  }

  createCurrentSceneResult() {
    const benchmarkSnapshot = this.uiController.selectionRenderer.pathTracer.benchmarkSnapshot;
    const applicationState = this.uiController.applicationState;
    const activeBenchmarkSceneName = applicationState.activeBenchmarkSceneName;
    const benchmarkScene = activeBenchmarkSceneName ? benchmarkScenes[activeBenchmarkSceneName] : null;
    const currentScore = normalizeBenchmarkInteger(benchmarkSnapshot.performanceScore, 0);
    return {
      sceneKey: activeBenchmarkSceneName || 'current-scene',
      displayName: benchmarkScene ? benchmarkScene.metadata.displayName : 'Current scene',
      targetBounces: applicationState.lightBounceCount,
      targetRaysPerPixel: applicationState.raysPerPixel,
      durationMilliseconds: 0,
      sampleCount: normalizeBenchmarkInteger(benchmarkSnapshot.accumulatedSamples, 0),
      minScore: currentScore,
      maxScore: currentScore,
      medianScore: currentScore,
      p5Score: currentScore,
      p95Score: currentScore,
      baselineComparison: null
    };
  }

  createCurrentResultsPayload() {
    const payload = this.createResultsPayload();
    const currentSceneResult = this.createCurrentSceneResult();
    payload.scenes = [currentSceneResult];
    payload.overallScore = currentSceneResult.medianScore;
    payload.sceneName = currentSceneResult.displayName;
    payload.bounceCount = currentSceneResult.targetBounces;
    return payload;
  }

  readShareablePayload() {
    if (this.latestPayload && Array.isArray(this.latestPayload.scenes) && this.latestPayload.scenes.length > 0) {
      return this.latestPayload;
    }
    return this.createCurrentResultsPayload();
  }

  syncLatestPayloadFromResults(basePayload = null) {
    if (!basePayload) {
      this.latestPayload = this.createResultsPayload();
      return returnSuccess(undefined);
    }

    this.latestPayload = Object.assign({}, basePayload, {
      warmupMilliseconds: this.warmupMilliseconds,
      measurementMilliseconds: this.measurementMilliseconds,
      scenes: this.results.map(createBenchmarkPayloadSceneResult)
    });
    this.latestPayload.overallScore = calculateBenchmarkPayloadOverallScore(this.latestPayload);
    this.latestPayload.sceneName = this.latestPayload.scenes.length === 1
      ? this.latestPayload.scenes[0].displayName
      : 'Benchmark sequence';
    this.latestPayload.bounceCount = this.latestPayload.scenes.length === 1
      ? this.latestPayload.scenes[0].targetBounces
      : null;
    return returnSuccess(undefined);
  }

  completeRun() {
    this.isActive = false;
    this.currentScene = null;
    const [, baselineError] = this.applyBaselineComparison();
    if (baselineError) {
      return returnFailure(baselineError.code, baselineError.message, baselineError.details);
    }
    const [, payloadError] = this.syncLatestPayloadFromResults();
    if (payloadError) {
      return returnFailure(payloadError.code, payloadError.message, payloadError.details);
    }
    const [, statusError] = this.writeStatus('Benchmark sequence complete.');
    if (statusError) {
      return returnFailure(statusError.code, statusError.message, statusError.details);
    }
    return this.renderSummary(performance.now());
  }

  copyResults() {
    if (!this.latestPayload) {
      return returnFailure('missing-benchmark-results', 'Run the benchmark sequence before copying results.');
    }

    const jsonValue = `${JSON.stringify(this.latestPayload, null, 2)}\n`;
    const windowObject = this.documentObject.defaultView;
    if (windowObject && windowObject.navigator && windowObject.navigator.clipboard) {
      windowObject.navigator.clipboard.writeText(jsonValue)
        .then(() => this.writeStatus('Benchmark JSON copied.'))
        .catch(() => this.writeStatus('Clipboard copy failed.'));
      return returnSuccess(undefined);
    }

    const textArea = this.documentObject.createElement('textarea');
    textArea.value = jsonValue;
    textArea.setAttribute('readonly', 'readonly');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    this.documentObject.body.appendChild(textArea);
    textArea.select();
    const didCopy = this.documentObject.execCommand && this.documentObject.execCommand('copy');
    this.documentObject.body.removeChild(textArea);
    if (!didCopy) {
      return returnFailure('clipboard-unavailable', 'Clipboard copy is not available in this browser.');
    }
    return this.writeStatus('Benchmark JSON copied.');
  }

  shareResultsUrl() {
    const shareablePayload = this.readShareablePayload();

    const windowObject = this.documentObject.defaultView;
    const [shareUrl, shareUrlError] = createBenchmarkResultsShareUrl(windowObject, shareablePayload);
    if (shareUrlError) {
      return returnFailure(shareUrlError.code, shareUrlError.message, shareUrlError.details);
    }

    if (windowObject.history && typeof windowObject.history.replaceState === 'function') {
      windowObject.history.replaceState(null, '', shareUrl);
    } else {
      windowObject.location.hash = shareUrl.split('#')[1] || '';
    }

    if (windowObject.navigator && windowObject.navigator.clipboard) {
      windowObject.navigator.clipboard.writeText(shareUrl)
        .then(() => {
          this.writeStatus('Benchmark share URL copied.');
          this.showToast('Copied!');
        })
        .catch(() => this.writeStatus('Share URL added to address bar; clipboard copy failed.'));
      return returnSuccess(undefined);
    }

    const textArea = this.documentObject.createElement('textarea');
    textArea.value = shareUrl;
    textArea.setAttribute('readonly', 'readonly');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    this.documentObject.body.appendChild(textArea);
    textArea.select();
    const didCopy = this.documentObject.execCommand && this.documentObject.execCommand('copy');
    this.documentObject.body.removeChild(textArea);
    if (!didCopy) {
      return this.writeStatus('Benchmark share URL added to address bar.');
    }
    const [, toastError] = this.showToast('Copied!');
    if (toastError) {
      return returnFailure(toastError.code, toastError.message, toastError.details);
    }
    return this.writeStatus('Benchmark share URL copied.');
  }

  saveScoreCardPng() {
    const shareablePayload = this.readShareablePayload();

    const windowObject = this.documentObject.defaultView;
    if (!windowObject) {
      return returnFailure('score-card-export-unavailable', 'Score-card export is not available in this browser.');
    }

    const canvasElement = this.documentObject.createElement('canvas');
    canvasElement.width = BENCHMARK_SCORE_CARD_WIDTH;
    canvasElement.height = BENCHMARK_SCORE_CARD_HEIGHT;
    const canvasContext = canvasElement.getContext('2d');
    if (!canvasContext) {
      return returnFailure('score-card-export-unavailable', 'Score-card export is not available in this browser.');
    }

    drawBenchmarkScoreCard(canvasContext, shareablePayload);
    const downloadFileName = createBenchmarkScoreCardFileName(shareablePayload);
    const downloadDataUrl = () => {
      const downloadLink = this.documentObject.createElement('a');
      downloadLink.href = canvasElement.toDataURL('image/png');
      downloadLink.download = downloadFileName;
      this.documentObject.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      return this.writeStatus('Benchmark score-card PNG saved.');
    };

    if (typeof canvasElement.toBlob !== 'function' || !windowObject.URL) {
      return downloadDataUrl();
    }

    canvasElement.toBlob((blob) => {
      if (!blob) {
        this.writeStatus('Score-card PNG export failed.');
        return;
      }
      const downloadLink = this.documentObject.createElement('a');
      const objectUrl = windowObject.URL.createObjectURL(blob);
      downloadLink.href = objectUrl;
      downloadLink.download = downloadFileName;
      this.documentObject.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      windowObject.URL.revokeObjectURL(objectUrl);
      this.writeStatus('Benchmark score-card PNG saved.');
    }, 'image/png');

    return this.writeStatus('Saving benchmark score-card PNG...');
  }

  saveBaseline() {
    if (!this.latestPayload) {
      return returnFailure('missing-benchmark-results', 'Run the benchmark sequence before saving a baseline.');
    }

    const [, saveError] = this.writeBaselinePayload(this.latestPayload);
    if (saveError) {
      return returnFailure(saveError.code, saveError.message, saveError.details);
    }

    const [, comparisonError] = this.applyBaselineComparison();
    if (comparisonError) {
      return returnFailure(comparisonError.code, comparisonError.message, comparisonError.details);
    }
    const [, payloadError] = this.syncLatestPayloadFromResults(this.latestPayload);
    if (payloadError) {
      return returnFailure(payloadError.code, payloadError.message, payloadError.details);
    }
    const [, summaryError] = this.renderSummary(performance.now());
    if (summaryError) {
      return returnFailure(summaryError.code, summaryError.message, summaryError.details);
    }
    return this.writeStatus('Benchmark baseline saved.');
  }

  loadSharedResultsFromHash() {
    const windowObject = this.documentObject.defaultView;
    const [sharedPayload, sharedPayloadError] = readBenchmarkPayloadFromHash(windowObject);
    if (sharedPayloadError) {
      return this.writeStatus(sharedPayloadError.message);
    }
    if (!sharedPayload) {
      return returnSuccess(undefined);
    }

    this.isActive = false;
    this.currentSceneIndex = -1;
    this.currentScene = null;
    this.warmupMilliseconds = sharedPayload.warmupMilliseconds;
    this.measurementMilliseconds = sharedPayload.measurementMilliseconds;
    this.warmupInput.value = String(Math.round(this.warmupMilliseconds / 1000));
    this.measurementInput.value = String(Math.round(this.measurementMilliseconds / 1000));
    this.results = sharedPayload.scenes.map((sceneResult) => (
      createBenchmarkRunnerResultFromPayloadScene(sceneResult, this.measurementMilliseconds)
    ));

    let statusText = 'Loaded benchmark result from URL.';
    const storedBaseline = this.readBaseline();
    if (storedBaseline) {
      const [, comparisonError] = this.applyBaselineComparison(storedBaseline);
      if (comparisonError) {
        return returnFailure(comparisonError.code, comparisonError.message, comparisonError.details);
      }
      statusText = 'Loaded benchmark result from URL and compared it with the saved baseline.';
    } else {
      const hasSharedComparison = this.results.some((result) => result.baselineComparison);
      const [, saveError] = this.writeBaselinePayload(sharedPayload);
      if (!saveError) {
        if (!hasSharedComparison) {
          const [, comparisonError] = this.applyBaselineComparison(sharedPayload);
          if (comparisonError) {
            return returnFailure(comparisonError.code, comparisonError.message, comparisonError.details);
          }
        }
        statusText = 'Loaded benchmark result from URL and saved it as the baseline.';
      }
    }

    const [, payloadError] = this.syncLatestPayloadFromResults(sharedPayload);
    if (payloadError) {
      return returnFailure(payloadError.code, payloadError.message, payloadError.details);
    }
    const [, summaryError] = this.renderSummary(performance.now());
    if (summaryError) {
      return returnFailure(summaryError.code, summaryError.message, summaryError.details);
    }
    return this.writeStatus(statusText);
  }

  renderCurrentSceneCard(currentTimeMilliseconds) {
    if (!this.currentScene) {
      return returnSuccess(undefined);
    }

    const elapsedMilliseconds = currentTimeMilliseconds - this.currentScene.phaseStartMilliseconds;
    const targetMilliseconds = this.currentScene.phase === 'warmup'
      ? this.warmupMilliseconds
      : this.measurementMilliseconds;
    const currentStats = calculateBenchmarkRunnerStats(this.currentScene.scoreSamples);
    const currentCard = this.documentObject.createElement('div');
    currentCard.className = 'benchmark-runner-card';
    currentCard.textContent = [
      `${this.currentScene.displayName}: ${this.currentScene.phase === 'warmup' ? 'warming up' : 'measuring'}`,
      `${formatBenchmarkRunnerSeconds(Math.min(elapsedMilliseconds, targetMilliseconds))} / ${formatBenchmarkRunnerSeconds(targetMilliseconds)}`,
      `median ${formatBenchmarkRunnerScore(currentStats.medianScore)}`,
      `P5/P95 ${formatBenchmarkRunnerScore(currentStats.p5Score)} / ${formatBenchmarkRunnerScore(currentStats.p95Score)}`,
      `min/max ${formatBenchmarkRunnerScore(currentStats.minScore)} / ${formatBenchmarkRunnerScore(currentStats.maxScore)}`
    ].join(' - ');
    this.summaryElement.appendChild(currentCard);
    return returnSuccess(undefined);
  }

  renderResultsTable() {
    if (this.results.length === 0) {
      return returnSuccess(undefined);
    }

    const tableElement = this.documentObject.createElement('table');
    tableElement.className = 'benchmark-runner-table';
    const tableHead = this.documentObject.createElement('thead');
    const headerRow = this.documentObject.createElement('tr');
    for (const headerText of ['Scene', 'Median', 'P5/P95', 'Min/Max', 'Samples', 'Baseline']) {
      headerRow.appendChild(createBenchmarkRunnerTableHeader(this.documentObject, headerText));
    }
    tableHead.appendChild(headerRow);
    tableElement.appendChild(tableHead);

    const tableBody = this.documentObject.createElement('tbody');
    for (const result of this.results) {
      const rowElement = this.documentObject.createElement('tr');
      const baselineComparison = result.baselineComparison;
      const baselineLabel = baselineComparison
        ? `${baselineComparison.isRegression ? 'Warning ' : ''}${formatBenchmarkBaselineDelta(baselineComparison)}`
        : 'No baseline';
      rowElement.appendChild(createBenchmarkRunnerTableCell(this.documentObject, result.displayName));
      rowElement.appendChild(createBenchmarkRunnerTableCell(this.documentObject, formatBenchmarkRunnerScore(result.medianScore)));
      rowElement.appendChild(createBenchmarkRunnerTableCell(
        this.documentObject,
        `${formatBenchmarkRunnerScore(result.p5Score)} / ${formatBenchmarkRunnerScore(result.p95Score)}`
      ));
      rowElement.appendChild(createBenchmarkRunnerTableCell(
        this.documentObject,
        `${formatBenchmarkRunnerScore(result.minScore)} / ${formatBenchmarkRunnerScore(result.maxScore)}`
      ));
      rowElement.appendChild(createBenchmarkRunnerTableCell(this.documentObject, String(result.sampleCount)));
      rowElement.appendChild(createBenchmarkRunnerTableCell(this.documentObject, baselineLabel));
      tableBody.appendChild(rowElement);
    }
    tableElement.appendChild(tableBody);
    this.summaryElement.appendChild(tableElement);
    return returnSuccess(undefined);
  }

  renderSummary(currentTimeMilliseconds) {
    while (this.summaryElement.firstChild) {
      this.summaryElement.removeChild(this.summaryElement.firstChild);
    }

    const [, cardError] = this.renderCurrentSceneCard(currentTimeMilliseconds);
    if (cardError) {
      return returnFailure(cardError.code, cardError.message, cardError.details);
    }

    return this.renderResultsTable();
  }
}

const formatSceneObjectDisplayName = (sceneObject, lightObject) => {
  if (!sceneObject) {
    return 'No selection';
  }
  if (sceneObject === lightObject) {
    return 'Light';
  }
  if (sceneObject.displayName) {
    return sceneObject.displayName;
  }
  return readSceneObjectDisplayName(sceneObject);
};

const formatSceneObjectSpringJointSceneTreeAnnotation = (sceneObject, lightObject) => {
  const connectedJointRecords = readUniquePhysicsSpringJointRecords(sceneObject)
    .filter((jointRecord) => jointRecord.targetObject);
  if (connectedJointRecords.length === 0) {
    return '';
  }

  const partnerLabels = connectedJointRecords
    .slice(0, 2)
    .map((jointRecord) => formatSceneObjectDisplayName(jointRecord.targetObject, lightObject));
  const remainingCount = connectedJointRecords.length - partnerLabels.length;
  const suffix = remainingCount > 0 ? ` +${remainingCount}` : '';
  return ` -- spring: ${partnerLabels.join(', ')}${suffix}`;
};

const isSceneLightInspectorObject = (sceneObject, lightObject) => (
  sceneObject === lightObject ||
  sceneObject instanceof AreaLightSceneObject
);

const isSceneObjectEmissionConfigurable = (sceneObject, lightObject) => (
  Boolean(sceneObject) &&
  !isSceneLightInspectorObject(sceneObject, lightObject) &&
  Number.isFinite(Number(sceneObject.material))
);

class UserInterfaceController {
  constructor(
    selectionRenderer,
    physicsWorld,
    applicationState,
    canvasElement,
    appShellElement,
    cameraPlaybackButton,
    framePauseButton,
    convergencePauseButton,
    lightCycleButton,
    focusPickButton,
    glossinessContainer,
    materialSelect,
    environmentSelect,
    glossinessInput,
    lightBounceInput,
    lightBounceValueElement,
    lightIntensityInput,
    lightIntensityValueElement,
    lightSizeInput,
    lightSizeValueElement,
    lightColorInput,
    fogDensityInput,
    fogDensityValueElement,
    skyBrightnessInput,
    skyBrightnessValueElement,
    raysPerPixelInput,
    raysPerPixelValueElement,
    temporalBlendFramesInput,
    temporalBlendFramesValueElement,
    denoiserStrengthInput,
    denoiserStrengthValueElement,
    colorExposureInput,
    colorExposureValueElement,
    colorBrightnessInput,
    colorBrightnessValueElement,
    colorContrastInput,
    colorContrastValueElement,
    colorSaturationInput,
    colorSaturationValueElement,
    colorGammaInput,
    colorGammaValueElement,
    toneMappingSelect,
    cameraFieldOfViewInput,
    cameraFieldOfViewValueElement,
    cameraFocusDistanceInput,
    cameraFocusDistanceValueElement,
    cameraApertureInput,
    cameraApertureValueElement,
    motionBlurInput,
    motionBlurValueElement,
    bloomStrengthInput,
    bloomStrengthValueElement,
    bloomThresholdInput,
    bloomThresholdValueElement,
    glareStrengthInput,
    glareStrengthValueElement,
    selectedItemNameElement,
    sceneTreeListElement,
    sceneTreeCountElement,
    resolutionPresetSelect,
    renderScaleModeSelect,
    renderScaleInput,
    renderScaleValueElement,
    renderScaleResolutionElement,
    customRenderWidthInput,
    customRenderHeightInput,
    uiCanvasResolutionElement,
    exportStatusElement,
    fullscreenCanvasButton,
    fullscreenPanelsButton,
    benchmarkDisplay,
    benchmarkRunnerStatusElement,
    benchmarkRunnerSummaryElement,
    benchmarkRunnerWarmupInput,
    benchmarkRunnerMeasurementInput
  ) {
    this.selectionRenderer = selectionRenderer;
    this.physicsWorld = physicsWorld;
    this.applicationState = applicationState;
    this.canvasElement = canvasElement;
    this.appShellElement = appShellElement;
    this.cameraPlaybackButton = cameraPlaybackButton;
    this.framePauseButton = framePauseButton;
    this.convergencePauseButton = convergencePauseButton;
    this.lightCycleButton = lightCycleButton;
    this.focusPickButton = focusPickButton;
    this.glossinessContainer = glossinessContainer;
    this.materialSelect = materialSelect;
    this.materialUvProjectionModeSelect = readOptionalElement(
      canvasElement.ownerDocument,
      'material-uv-projection-mode'
    );
    this.materialUvScaleInput = readOptionalElement(canvasElement.ownerDocument, 'material-uv-scale');
    this.materialUvScaleValueElement = readOptionalElement(canvasElement.ownerDocument, 'material-uv-scale-value');
    this.materialUvBlendSharpnessInput = readOptionalElement(
      canvasElement.ownerDocument,
      'material-uv-blend-sharpness'
    );
    this.materialUvBlendSharpnessValueElement = readOptionalElement(
      canvasElement.ownerDocument,
      'material-uv-blend-sharpness-value'
    );
    this.environmentSelect = environmentSelect;
    this.glossinessInput = glossinessInput;
    this.lightBounceInput = lightBounceInput;
    this.lightBounceValueElement = lightBounceValueElement;
    this.lightIntensityInput = lightIntensityInput;
    this.lightIntensityValueElement = lightIntensityValueElement;
    this.lightSizeInput = lightSizeInput;
    this.lightSizeValueElement = lightSizeValueElement;
    this.lightColorInput = lightColorInput;
    this.fogDensityInput = fogDensityInput;
    this.fogDensityValueElement = fogDensityValueElement;
    this.skyBrightnessInput = skyBrightnessInput;
    this.skyBrightnessValueElement = skyBrightnessValueElement;
    this.raysPerPixelInput = raysPerPixelInput;
    this.raysPerPixelValueElement = raysPerPixelValueElement;
    this.temporalBlendFramesInput = temporalBlendFramesInput;
    this.temporalBlendFramesValueElement = temporalBlendFramesValueElement;
    this.denoiserStrengthInput = denoiserStrengthInput;
    this.denoiserStrengthValueElement = denoiserStrengthValueElement;
    this.colorExposureInput = colorExposureInput;
    this.colorExposureValueElement = colorExposureValueElement;
    this.colorBrightnessInput = colorBrightnessInput;
    this.colorBrightnessValueElement = colorBrightnessValueElement;
    this.colorContrastInput = colorContrastInput;
    this.colorContrastValueElement = colorContrastValueElement;
    this.colorSaturationInput = colorSaturationInput;
    this.colorSaturationValueElement = colorSaturationValueElement;
    this.colorGammaInput = colorGammaInput;
    this.colorGammaValueElement = colorGammaValueElement;
    this.toneMappingSelect = toneMappingSelect;
    this.cameraFieldOfViewInput = cameraFieldOfViewInput;
    this.cameraFieldOfViewValueElement = cameraFieldOfViewValueElement;
    this.cameraFocusDistanceInput = cameraFocusDistanceInput;
    this.cameraFocusDistanceValueElement = cameraFocusDistanceValueElement;
    this.cameraApertureInput = cameraApertureInput;
    this.cameraApertureValueElement = cameraApertureValueElement;
    this.motionBlurInput = motionBlurInput;
    this.motionBlurValueElement = motionBlurValueElement;
    this.bloomStrengthInput = bloomStrengthInput;
    this.bloomStrengthValueElement = bloomStrengthValueElement;
    this.bloomThresholdInput = bloomThresholdInput;
    this.bloomThresholdValueElement = bloomThresholdValueElement;
    this.glareStrengthInput = glareStrengthInput;
    this.glareStrengthValueElement = glareStrengthValueElement;
    this.selectedItemNameElement = selectedItemNameElement;
    this.sceneTreeListElement = sceneTreeListElement;
    this.sceneTreeCountElement = sceneTreeCountElement;
    this.resolutionPresetSelect = resolutionPresetSelect;
    this.renderScaleModeSelect = renderScaleModeSelect;
    this.renderScaleInput = renderScaleInput;
    this.renderScaleValueElement = renderScaleValueElement;
    this.renderScaleResolutionElement = renderScaleResolutionElement;
    this.customRenderWidthInput = customRenderWidthInput;
    this.customRenderHeightInput = customRenderHeightInput;
    this.uiCanvasResolutionElement = uiCanvasResolutionElement;
    this.exportStatusElement = exportStatusElement;
    this.fullscreenCanvasButton = fullscreenCanvasButton;
    this.fullscreenPanelsButton = fullscreenPanelsButton;
    this.benchmarkDisplay = benchmarkDisplay;
    this.benchmarkRunner = new BenchmarkRunner(
      this,
      canvasElement.ownerDocument,
      benchmarkRunnerStatusElement,
      benchmarkRunnerSummaryElement,
      benchmarkRunnerWarmupInput,
      benchmarkRunnerMeasurementInput
    );
    this.shouldShowPanelsInFullscreen = false;
    this.actionToggleButtonCache = new Map();
    this.sceneObjects = [];
    this.sceneTreeButtons = new Map();
    this.selectionAnchorEntityId = null;
    this.lightObject = new LightSceneObject(applicationState);
    this.shaderRebuildInputTimerId = 0;
    this.isMovingSelection = false;
    this.isGlossinessVisible = null;
    this.movementNormal = createVec3(0, 0, 0);
    this.movementDistance = 0;
    this.originalHitPosition = createVec3(0, 0, 0);
    this.pointerRayDirection = createVec3(0, 0, 0);
    this.pointerHitPosition = createVec3(0, 0, 0);
    this.pointerTranslation = createVec3(0, 0, 0);
    this.modelviewMatrix = createIdentityMat4();
    this.projectionMatrix = createIdentityMat4();
    writeCameraProjectionMat4(this.projectionMatrix, applicationState.cameraFieldOfViewDegrees);
    this.modelviewProjectionMatrix = createIdentityMat4();
    this.inverseModelviewProjectionMatrix = createIdentityMat4();
    this.cameraXAxis = createVec3(1, 0, 0);
    this.cameraYAxis = createVec3(0, 1, 0);
    this.cameraZAxis = createVec3(0, 0, 1);
    this.fpsCameraTarget = createVec3(0, 0, 0);
    this.previousCameraMode = null;
    this.previousCameraAngleX = Number.NaN;
    this.previousCameraAngleY = Number.NaN;
    this.previousCameraDistance = Number.NaN;
    this.previousCameraFieldOfViewDegrees = Number.NaN;
    this.previousFpsEyePosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
  }

  readSelectedObject() {
    this.selectionRenderer.syncSelectionFromSceneStore();
    return this.selectionRenderer.resolveSelectedObject(this.sceneObjects);
  }

  readSelectedObjects() {
    this.selectionRenderer.syncSelectionFromSceneStore();
    return this.selectionRenderer.resolveSelectedObjects(this.sceneObjects);
  }

  clearSceneSelection() {
    this.selectionAnchorEntityId = null;
    this.selectionRenderer.clearSelection();
    return returnSuccess(undefined);
  }

  selectSingleSceneObject(sceneObject) {
    const entityId = readSceneObjectEntityId(sceneObject);
    this.selectionAnchorEntityId = entityId;
    this.selectionRenderer.setSelectedEntityIds(entityId === null ? [] : [entityId], entityId);
    return this.readSelectedObject();
  }

  selectSceneObjectWithModifiers(sceneObject, selectionOptions = {}) {
    this.selectionRenderer.syncSelectionFromSceneStore();
    const targetEntityId = readSceneObjectEntityId(sceneObject);
    if (targetEntityId === null) {
      if (!selectionOptions.isRangeSelection && !selectionOptions.isToggleSelection) {
        this.clearSceneSelection();
      }
      return null;
    }

    const displayEntries = createSceneTreeDisplayEntries(this.sceneObjects);
    const currentEntityIds = this.selectionRenderer.selectedEntityIds;
    const currentPrimaryEntityId = this.selectionRenderer.selectedEntityId;
    const isRangeSelection = Boolean(selectionOptions.isRangeSelection);
    const isToggleSelection = Boolean(selectionOptions.isToggleSelection);
    let nextEntityIds = Object.freeze([targetEntityId]);
    let nextPrimaryEntityId = targetEntityId;
    let nextAnchorEntityId = targetEntityId;

    if (isRangeSelection) {
      const anchorEntityId = normalizeSceneEntityId(this.selectionAnchorEntityId) ||
        normalizeSceneEntityId(currentPrimaryEntityId) ||
        targetEntityId;
      const rangeEntityIds = readSceneTreeSelectionRangeIds(displayEntries, anchorEntityId, targetEntityId);
      nextEntityIds = isToggleSelection
        ? mergeSceneEntityIdLists(currentEntityIds, rangeEntityIds)
        : rangeEntityIds;
      nextAnchorEntityId = anchorEntityId;
    } else if (isToggleSelection) {
      if (currentEntityIds.includes(targetEntityId)) {
        nextEntityIds = Object.freeze(currentEntityIds.filter((entityId) => entityId !== targetEntityId));
        nextPrimaryEntityId = currentPrimaryEntityId === targetEntityId
          ? nextEntityIds[nextEntityIds.length - 1] ?? null
          : currentPrimaryEntityId;
      } else {
        nextEntityIds = mergeSceneEntityIdLists(currentEntityIds, [targetEntityId]);
      }
    }

    this.selectionAnchorEntityId = nextAnchorEntityId;
    this.selectionRenderer.setSelectedEntityIds(nextEntityIds, nextPrimaryEntityId);
    return this.readSelectedObject();
  }

  prepareSceneObjectsForRenderer(sceneObjects) {
    this.cancelScheduledShaderRebuildFromInput();
    this.lightObject.isLocked = this.applicationState.isBenchmarkModeActive;
    this.sceneObjects = [this.lightObject, ...sceneObjects];
    const [, hierarchyError] = syncSceneGroupEntityChildren(this.sceneObjects);
    if (hierarchyError) {
      return returnFailure(hierarchyError.code, hierarchyError.message, hierarchyError.details);
    }
    setSceneStoreSceneItems(this.sceneObjects);
    for (const sceneObject of this.sceneObjects) {
      const [, authoredTransformError] = writeSceneObjectAuthoredTransform(sceneObject);
      if (authoredTransformError) {
        return returnFailure(
          authoredTransformError.code,
          authoredTransformError.message,
          authoredTransformError.details
        );
      }
    }
    this.selectionRenderer.pruneSelectionToSceneObjects();
    if (this.selectionRenderer.selectedEntityId === null) {
      this.selectionAnchorEntityId = null;
    }

    const [, syncError] = this.syncSelectedItemReadout();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    return returnSuccess(undefined);
  }

  setSceneObjects(sceneObjects) {
    const [, prepareError] = this.prepareSceneObjectsForRenderer(sceneObjects);
    if (prepareError) {
      return returnFailure(prepareError.code, prepareError.message, prepareError.details);
    }

    return this.syncSceneObjectsToRendererAndPhysics();
  }

  async setSceneObjectsAsync(sceneObjects, options = Object.freeze({})) {
    const [, prepareError] = this.prepareSceneObjectsForRenderer(sceneObjects);
    if (prepareError) {
      return returnFailure(prepareError.code, prepareError.message, prepareError.details);
    }

    return this.syncSceneObjectsToRendererAndPhysicsAsync(options);
  }

  releaseSceneRendererResources() {
    const [, cancelShaderError] = this.cancelScheduledShaderRebuildFromInput();
    if (cancelShaderError) {
      return returnFailure(cancelShaderError.code, cancelShaderError.message, cancelShaderError.details);
    }

    const [, cancelFrameError] = cancelScheduledAnimationFrame(this.applicationState);
    if (cancelFrameError) {
      return returnFailure(cancelFrameError.code, cancelFrameError.message, cancelFrameError.details);
    }

    const [, releaseError] = this.selectionRenderer.releaseSceneProgram();
    if (releaseError) {
      return returnFailure(releaseError.code, releaseError.message, releaseError.details);
    }

    logDiagnostic('debug', 'sceneLoad', 'Released renderer scene program before deferred scene load.');
    return returnSuccess(undefined);
  }

  cancelScheduledShaderRebuildFromInput() {
    if (!this.shaderRebuildInputTimerId) {
      return returnSuccess(undefined);
    }

    const windowObject = this.canvasElement.ownerDocument.defaultView;
    if (windowObject && typeof windowObject.clearTimeout === 'function') {
      windowObject.clearTimeout(this.shaderRebuildInputTimerId);
    }
    this.shaderRebuildInputTimerId = 0;
    return returnSuccess(undefined);
  }

  scheduleShaderRebuildFromInput(statusText = 'Compiling shaders...') {
    const documentObject = this.canvasElement.ownerDocument;
    const windowObject = documentObject.defaultView;
    if (!windowObject || typeof windowObject.setTimeout !== 'function') {
      const [, syncError] = this.syncSceneObjectsToRendererAndPhysics();
      if (syncError) {
        return returnFailure(syncError.code, syncError.message, syncError.details);
      }
      return this.selectionRenderer.pathTracer.clearSamples();
    }

    const [, loadingError] = updateLoadingStatus(documentObject, statusText);
    if (loadingError) {
      return returnFailure(loadingError.code, loadingError.message, loadingError.details);
    }

    const [, clearPendingSamplesError] = this.selectionRenderer.pathTracer.clearSamples();
    if (clearPendingSamplesError) {
      return returnFailure(
        clearPendingSamplesError.code,
        clearPendingSamplesError.message,
        clearPendingSamplesError.details
      );
    }

    if (this.shaderRebuildInputTimerId) {
      windowObject.clearTimeout(this.shaderRebuildInputTimerId);
    }

    this.shaderRebuildInputTimerId = windowObject.setTimeout(() => {
      this.shaderRebuildInputTimerId = 0;
      const errorElement = documentObject.getElementById('error');
      const [, syncError] = this.syncSceneObjectsToRendererAndPhysics();
      if (syncError) {
        logDiagnostic('error', 'renderer', 'Debounced shader rebuild failed.', syncError);
        if (errorElement instanceof HTMLElement) {
          displayError(errorElement, syncError);
        }
        return;
      }

      const [, clearError] = this.selectionRenderer.pathTracer.clearSamples();
      if (clearError) {
        logDiagnostic('error', 'renderer', 'Debounced shader rebuild could not clear samples.', clearError);
        if (errorElement instanceof HTMLElement) {
          displayError(errorElement, clearError);
        }
        return;
      }

      const [, dismissError] = queueLoadingOverlayDismiss(documentObject);
      if (dismissError) {
        logDiagnostic('error', 'ui', 'Debounced shader rebuild could not dismiss loading overlay.', dismissError);
        return;
      }
      const [, scheduleError] = scheduleAnimationFrame(this.applicationState);
      if (scheduleError) {
        logDiagnostic('error', 'renderer', 'Debounced shader rebuild could not schedule a frame.', scheduleError);
      }
    }, SHADER_REBUILD_INPUT_DEBOUNCE_MS);

    return returnSuccess(undefined);
  }

  syncSceneObjectsToRendererAndPhysics() {
    const syncStartMilliseconds = readCurrentMilliseconds();
    const [, hierarchyError] = syncSceneGroupEntityChildren(this.sceneObjects);
    if (hierarchyError) {
      return returnFailure(hierarchyError.code, hierarchyError.message, hierarchyError.details);
    }
    setSceneStoreSceneItems(this.sceneObjects);

    const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }

    const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
    if (physicsError) {
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }

    logDiagnostic('debug', 'sceneLoad', 'Scene objects synced to renderer and physics.', Object.freeze({
      objectCount: this.sceneObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - syncStartMilliseconds)
    }));

    return returnSuccess(undefined);
  }

  async syncSceneObjectsToRendererAndPhysicsAsync(options = Object.freeze({})) {
    const syncStartMilliseconds = readCurrentMilliseconds();
    const [, hierarchyError] = syncSceneGroupEntityChildren(this.sceneObjects);
    if (hierarchyError) {
      return returnFailure(hierarchyError.code, hierarchyError.message, hierarchyError.details);
    }
    setSceneStoreSceneItems(this.sceneObjects);

    const [, rendererError] = await this.selectionRenderer.setObjectsAsync(
      this.sceneObjects,
      this.applicationState,
      options
    );
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }

    const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
    if (physicsError) {
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }

    logDiagnostic('debug', 'sceneLoad', 'Scene objects synced to renderer and physics.', Object.freeze({
      objectCount: this.sceneObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - syncStartMilliseconds),
      compileMode: 'parallel'
    }));

    return returnSuccess(undefined);
  }

  resetPhysicsInteractions() {
    let didRestoreAnyObject = false;
    for (const sceneObject of this.sceneObjects) {
      if (!isPhysicsSupportedSceneObject(sceneObject) || sceneObject.isPhysicsEnabled === false) {
        continue;
      }

      const [, authoredTransformError] = writeSceneObjectAuthoredTransform(sceneObject);
      if (authoredTransformError) {
        return returnFailure(
          authoredTransformError.code,
          authoredTransformError.message,
          authoredTransformError.details
        );
      }
      const [didRestoreObject, restoreError] = restoreSceneObjectAuthoredTransform(sceneObject);
      if (restoreError) {
        return returnFailure(restoreError.code, restoreError.message, restoreError.details);
      }
      didRestoreAnyObject = didRestoreAnyObject || didRestoreObject;
      const [, clearBodyError] = sceneObject.clearPhysicsRigidBody();
      if (clearBodyError) {
        return returnFailure(clearBodyError.code, clearBodyError.message, clearBodyError.details);
      }
    }

    const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
    if (physicsError) {
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }
    const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
    if (uniformDirtyError) {
      return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
    }
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    const [, clearSamplesError] = this.selectionRenderer.pathTracer.clearSamples(false);
    if (clearSamplesError) {
      return returnFailure(clearSamplesError.code, clearSamplesError.message, clearSamplesError.details);
    }
    return writeElementTextIfChanged(
      this.exportStatusElement,
      didRestoreAnyObject ? 'Physics interactions reset.' : 'No physics-enabled items to reset.'
    );
  }

  stepPhysics(elapsedSeconds) {
    if (this.isMovingSelection && !this.applicationState.isPointerDown) {
      const [, cancelError] = this.cancelActivePointerInteraction();
      if (cancelError) {
        return returnFailure(cancelError.code, cancelError.message, cancelError.details);
      }
    }

    const shouldStepPhysics = !this.isMovingSelection;
    const [didMovePhysicsObject, physicsError] = this.physicsWorld.step(
      elapsedSeconds,
      shouldStepPhysics,
      this.applicationState
    );
    if (physicsError) {
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }

    if (!didMovePhysicsObject) {
      return returnSuccess(false);
    }

    const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
    if (uniformDirtyError) {
      return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
    }

    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  update() {
    const eyePosition = this.applicationState.eyePosition;
    const cameraMode = normalizeCameraMode(this.applicationState.cameraMode);
    this.applicationState.cameraMode = cameraMode;
    const cameraAngleX = this.applicationState.cameraAngleX;
    const cameraAngleY = this.applicationState.cameraAngleY;
    const cameraDistance = this.applicationState.cameraDistance;
    const cameraFieldOfViewDegrees = this.applicationState.cameraFieldOfViewDegrees;
    const fpsEyePosition = this.applicationState.fpsEyePosition;
    const didCameraChange = (
      this.previousCameraMode !== cameraMode ||
      this.previousCameraAngleX !== cameraAngleX ||
      this.previousCameraAngleY !== cameraAngleY ||
      this.previousCameraDistance !== cameraDistance ||
      this.previousCameraFieldOfViewDegrees !== cameraFieldOfViewDegrees ||
      (
        cameraMode === CAMERA_MODE_FPS &&
        (
          this.previousFpsEyePosition[0] !== fpsEyePosition[0] ||
          this.previousFpsEyePosition[1] !== fpsEyePosition[1] ||
          this.previousFpsEyePosition[2] !== fpsEyePosition[2]
        )
      )
    );

    if (didCameraChange) {
      this.previousCameraMode = cameraMode;
      this.previousCameraAngleX = cameraAngleX;
      this.previousCameraAngleY = cameraAngleY;
      this.previousCameraDistance = cameraDistance;
      this.previousCameraFieldOfViewDegrees = cameraFieldOfViewDegrees;
      writeVec3(this.previousFpsEyePosition, fpsEyePosition[0], fpsEyePosition[1], fpsEyePosition[2]);
      writeCameraProjectionMat4(this.projectionMatrix, cameraFieldOfViewDegrees);

      if (cameraMode === CAMERA_MODE_FPS) {
        writeVec3(eyePosition, fpsEyePosition[0], fpsEyePosition[1], fpsEyePosition[2]);
        writeFpsCameraTarget(this.fpsCameraTarget, eyePosition, cameraAngleX, cameraAngleY);
      } else {
        writeOrbitEyePosition(eyePosition, cameraAngleX, cameraAngleY, cameraDistance);
      }
    }

    const isGlossinessVisible = this.applicationState.material === MATERIAL.GLOSSY;
    if (this.isGlossinessVisible !== isGlossinessVisible) {
      this.isGlossinessVisible = isGlossinessVisible;
      this.glossinessContainer.style.display = isGlossinessVisible ? 'inline' : 'none';
    }

    if (didCameraChange) {
      const [, modelviewError] = writeLookAtMat4(
        this.modelviewMatrix,
        eyePosition,
        cameraMode === CAMERA_MODE_FPS ? this.fpsCameraTarget : ORIGIN_VECTOR,
        WORLD_UP_VECTOR,
        this.cameraXAxis,
        this.cameraYAxis,
        this.cameraZAxis
      );
      if (modelviewError) {
        return returnFailure(modelviewError.code, modelviewError.message, modelviewError.details);
      }

      writeMultiplyMat4(this.modelviewProjectionMatrix, this.projectionMatrix, this.modelviewMatrix);
      const [, inverseError] = writeInvertMat4(this.inverseModelviewProjectionMatrix, this.modelviewProjectionMatrix);
      if (inverseError) {
        return returnFailure(inverseError.code, inverseError.message, inverseError.details);
      }
    }

    const [, rendererError] = this.selectionRenderer.update(
      this.modelviewProjectionMatrix,
      this.inverseModelviewProjectionMatrix,
      this.applicationState,
      didCameraChange,
      this.cameraXAxis,
      this.cameraYAxis
    );
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }

    const [, convergencePauseButtonError] = updateConvergencePauseButton(
      this.convergencePauseButton,
      this.applicationState.isConvergencePauseEnabled,
      this.applicationState.isConvergencePaused,
      this.applicationState.convergenceSampleCount
    );
    if (convergencePauseButtonError) {
      return returnFailure(
        convergencePauseButtonError.code,
        convergencePauseButtonError.message,
        convergencePauseButtonError.details
      );
    }

    return returnSuccess(undefined);
  }

  syncSelectedItemReadout() {
    const selectedObject = this.readSelectedObject();
    const displayName = formatSceneObjectDisplayName(selectedObject, this.lightObject);
    const [, readoutError] = writeElementTextIfChanged(
      this.selectedItemNameElement,
      displayName
    );
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }

    const [, sectionError] = syncObjectInspectorSection(
      this.canvasElement.ownerDocument,
      selectedObject,
      displayName
    );
    if (sectionError) {
      return returnFailure(sectionError.code, sectionError.message, sectionError.details);
    }

    this.syncOptionalSelectionControls(selectedObject);
    return this.syncSceneTree();
  }

  syncSelectionControlVisibility(selectedObject) {
    const documentObject = this.canvasElement.ownerDocument;
    const isLightSelection = isSceneLightInspectorObject(selectedObject, this.lightObject);
    const hasGeometrySelection = Boolean(selectedObject && !isLightSelection);
    for (const geometryControl of documentObject.querySelectorAll('[data-selection-control="geometry"]')) {
      geometryControl.hidden = !hasGeometrySelection;
    }
    for (const lightControl of documentObject.querySelectorAll('[data-selection-control="light"]')) {
      lightControl.hidden = !isLightSelection;
    }
  }

  setSelectedLightControlDisabledState(isDisabled) {
    const documentObject = this.canvasElement.ownerDocument;
    for (const controlId of [
      'selected-light-intensity',
      'selected-light-size',
      'selected-light-temperature',
      'selected-light-color'
    ]) {
      const controlElement = readOptionalElement(documentObject, controlId);
      if (controlElement instanceof HTMLInputElement) {
        controlElement.disabled = isDisabled;
      }
    }
  }

  syncSelectedLightControls(selectedObject = undefined) {
    if (selectedObject === undefined) {
      selectedObject = this.readSelectedObject();
    }
    const documentObject = this.canvasElement.ownerDocument;
    const isLightSelection = isSceneLightInspectorObject(selectedObject, this.lightObject);
    const lightControlsElement = readOptionalElement(documentObject, 'selected-light-controls');
    if (lightControlsElement instanceof HTMLElement) {
      lightControlsElement.hidden = !isLightSelection;
    }
    if (!isLightSelection) {
      this.setSelectedLightControlDisabledState(true);
      return returnSuccess(undefined);
    }

    const isDisabled = this.applicationState.isBenchmarkModeActive || Boolean(selectedObject && selectedObject.isLocked);
    this.setSelectedLightControlDisabledState(isDisabled);

    const intensityInput = readOptionalElement(documentObject, 'selected-light-intensity');
    if (intensityInput instanceof HTMLInputElement) {
      intensityInput.value = this.applicationState.lightIntensity.toFixed(2);
    }
    const intensityValueElement = readOptionalElement(documentObject, 'selected-light-intensity-value');
    if (intensityValueElement instanceof HTMLElement) {
      const [, intensityTextError] = writeElementTextIfChanged(
        intensityValueElement,
        formatLightIntensityValue(this.applicationState.lightIntensity)
      );
      if (intensityTextError) {
        return returnFailure(intensityTextError.code, intensityTextError.message, intensityTextError.details);
      }
    }

    const sizeInput = readOptionalElement(documentObject, 'selected-light-size');
    if (sizeInput instanceof HTMLInputElement) {
      sizeInput.value = this.applicationState.lightSize.toFixed(2);
    }
    const sizeValueElement = readOptionalElement(documentObject, 'selected-light-size-value');
    if (sizeValueElement instanceof HTMLElement) {
      const [, sizeTextError] = writeElementTextIfChanged(
        sizeValueElement,
        formatColorAdjustmentValue(this.applicationState.lightSize)
      );
      if (sizeTextError) {
        return returnFailure(sizeTextError.code, sizeTextError.message, sizeTextError.details);
      }
    }

    const lightTemperature = estimateLightTemperatureKelvin(this.applicationState.lightColor);
    const temperatureInput = readOptionalElement(documentObject, 'selected-light-temperature');
    if (temperatureInput instanceof HTMLInputElement) {
      temperatureInput.value = String(lightTemperature);
    }
    const temperatureValueElement = readOptionalElement(documentObject, 'selected-light-temperature-value');
    if (temperatureValueElement instanceof HTMLElement) {
      const [, temperatureTextError] = writeElementTextIfChanged(
        temperatureValueElement,
        formatLightTemperatureValue(lightTemperature)
      );
      if (temperatureTextError) {
        return returnFailure(temperatureTextError.code, temperatureTextError.message, temperatureTextError.details);
      }
    }

    const colorInput = readOptionalElement(documentObject, 'selected-light-color');
    if (colorInput instanceof HTMLInputElement) {
      colorInput.value = formatLightColorValue(this.applicationState.lightColor);
    }

    return returnSuccess(undefined);
  }

  syncOptionalSelectionControls(selectedObject) {
    this.syncSelectionControlVisibility(selectedObject);
    const documentObject = this.canvasElement.ownerDocument;
    const nameInput = readOptionalElement(documentObject, 'selected-item-name-input');
    if (nameInput instanceof HTMLInputElement) {
      nameInput.value = selectedObject && selectedObject !== this.lightObject
        ? formatSceneObjectDisplayName(selectedObject, this.lightObject)
        : '';
      nameInput.disabled = !selectedObject || selectedObject === this.lightObject;
    }

    const position = this.readSelectedObjectPosition(selectedObject);
    for (const axisName of ['x', 'y', 'z']) {
      const positionInput = readOptionalElement(documentObject, `selected-position-${axisName}`);
      if (!(positionInput instanceof HTMLInputElement)) {
        continue;
      }
      const axisIndex = axisName === 'x' ? 0 : (axisName === 'y' ? 1 : 2);
      positionInput.value = position ? position[axisIndex].toFixed(2) : '';
      positionInput.disabled = !position || Boolean(selectedObject && selectedObject.isLocked);
    }

    const hideButton = readOptionalElement(documentObject, 'selection-hidden-toggle');
    if (hideButton instanceof HTMLButtonElement) {
      hideButton.textContent = selectedObject && selectedObject.isHidden ? 'Show' : 'Hide';
      hideButton.setAttribute('aria-pressed', selectedObject && selectedObject.isHidden ? 'true' : 'false');
      hideButton.disabled = !selectedObject || selectedObject === this.lightObject || selectedObject.isLocked;
    }

    const lockButton = readOptionalElement(documentObject, 'selection-lock-toggle');
    if (lockButton instanceof HTMLButtonElement) {
      lockButton.textContent = selectedObject && selectedObject.isLocked ? 'Unlock' : 'Lock';
      lockButton.setAttribute('aria-pressed', selectedObject && selectedObject.isLocked ? 'true' : 'false');
      lockButton.disabled = !selectedObject || selectedObject === this.lightObject || this.applicationState.isBenchmarkModeActive;
    }

    for (const deleteButton of documentObject.querySelectorAll('button[data-action="delete-selection"]')) {
      deleteButton.disabled = !selectedObject || selectedObject === this.lightObject || selectedObject.isLocked;
    }
    for (const duplicateButton of documentObject.querySelectorAll('button[data-action="duplicate-selection"]')) {
      duplicateButton.disabled = (
        !selectedObject ||
        selectedObject === this.lightObject ||
        selectedObject.isLocked ||
        typeof selectedObject.cloneForDuplicate !== 'function'
      );
    }

    this.syncSelectedPhysicsControls(selectedObject);
    this.syncSelectedLightControls(selectedObject);
    this.syncSelectedEmissiveControls(selectedObject);
    this.syncSelectedMaterialProjectionControls(selectedObject);
  }

  syncSelectedPhysicsControls(selectedObject) {
    const documentObject = this.canvasElement.ownerDocument;
    const isSupported = isPhysicsSupportedSceneObject(selectedObject);
    const isLocked = Boolean(selectedObject && selectedObject.isLocked);
    const isEnabled = isSupported ? selectedObject.isPhysicsEnabled !== false : false;
    const bodyType = isSupported ? readSceneObjectPhysicsBodyType(selectedObject) : PHYSICS_BODY_TYPE.STATIC;
    const areDetailsDisabled = !isSupported || isLocked || !isEnabled;
    const areDynamicDetailsDisabled = areDetailsDisabled || bodyType !== PHYSICS_BODY_TYPE.DYNAMIC;

    const physicsEnabledInput = readOptionalElement(documentObject, 'selected-physics-enabled');
    if (physicsEnabledInput instanceof HTMLInputElement) {
      physicsEnabledInput.checked = isEnabled;
      physicsEnabledInput.disabled = !isSupported || isLocked;
    }

    const physicsBodyTypeSelect = readOptionalElement(documentObject, 'selected-physics-body-type');
    if (physicsBodyTypeSelect instanceof HTMLSelectElement) {
      physicsBodyTypeSelect.value = bodyType;
      physicsBodyTypeSelect.disabled = areDetailsDisabled;
    }

    const physicsMass = isSupported ? readSceneObjectPhysicsMass(selectedObject) : DEFAULT_PHYSICS_MASS;
    const physicsMassInput = readOptionalElement(documentObject, 'selected-physics-mass');
    if (physicsMassInput instanceof HTMLInputElement) {
      physicsMassInput.value = physicsMass.toFixed(2);
      physicsMassInput.disabled = areDynamicDetailsDisabled;
    }
    const physicsMassValueElement = readOptionalElement(documentObject, 'selected-physics-mass-value');
    if (physicsMassValueElement instanceof HTMLElement) {
      physicsMassValueElement.textContent = physicsMass.toFixed(2);
    }

    const physicsGravityScale = isSupported
      ? readSceneObjectPhysicsGravityScale(selectedObject)
      : DEFAULT_PHYSICS_GRAVITY_SCALE;
    const physicsGravityScaleInput = readOptionalElement(documentObject, 'selected-physics-gravity-scale');
    if (physicsGravityScaleInput instanceof HTMLInputElement) {
      physicsGravityScaleInput.value = physicsGravityScale.toFixed(2);
      physicsGravityScaleInput.disabled = areDynamicDetailsDisabled;
    }
    const physicsGravityScaleValueElement = readOptionalElement(documentObject, 'selected-physics-gravity-scale-value');
    if (physicsGravityScaleValueElement instanceof HTMLElement) {
      physicsGravityScaleValueElement.textContent = physicsGravityScale.toFixed(2);
    }

    const physicsFriction = isSupported ? readSceneObjectPhysicsFriction(selectedObject) : 0;
    const physicsFrictionInput = readOptionalElement(documentObject, 'selected-physics-friction');
    if (physicsFrictionInput instanceof HTMLInputElement) {
      physicsFrictionInput.value = physicsFriction.toFixed(2);
      physicsFrictionInput.disabled = areDetailsDisabled;
    }
    const physicsFrictionValueElement = readOptionalElement(documentObject, 'selected-physics-friction-value');
    if (physicsFrictionValueElement instanceof HTMLElement) {
      physicsFrictionValueElement.textContent = physicsFriction.toFixed(2);
    }

    const physicsRestitution = isSupported ? readSceneObjectPhysicsRestitution(selectedObject) : 0;
    const physicsRestitutionInput = readOptionalElement(documentObject, 'selected-physics-restitution');
    if (physicsRestitutionInput instanceof HTMLInputElement) {
      physicsRestitutionInput.value = physicsRestitution.toFixed(2);
      physicsRestitutionInput.disabled = areDetailsDisabled;
    }
    const physicsRestitutionValueElement = readOptionalElement(documentObject, 'selected-physics-restitution-value');
    if (physicsRestitutionValueElement instanceof HTMLElement) {
      physicsRestitutionValueElement.textContent = physicsRestitution.toFixed(2);
    }

    const physicsCollideWithObjectsInput = readOptionalElement(documentObject, 'selected-physics-collide-with-objects');
    if (physicsCollideWithObjectsInput instanceof HTMLInputElement) {
      physicsCollideWithObjectsInput.checked = isSupported ? selectedObject.collideWithObjects !== false : true;
      physicsCollideWithObjectsInput.disabled = areDetailsDisabled;
    }

    const physicsHelpElement = readOptionalElement(documentObject, 'selected-physics-help');
    if (physicsHelpElement instanceof HTMLElement) {
      if (!selectedObject) {
        physicsHelpElement.textContent = 'Select a supported sphere or cube to edit physics.';
      } else if (!isSupported) {
        physicsHelpElement.textContent = 'Physics is currently available for spheres and cubes only.';
      } else if (isLocked) {
        physicsHelpElement.textContent = 'Unlock this item to edit physics.';
      } else if (!isEnabled) {
        physicsHelpElement.textContent = 'Enable physics to edit body behavior.';
      } else if (bodyType === PHYSICS_BODY_TYPE.DYNAMIC) {
        physicsHelpElement.textContent = 'Dynamic bodies use mass, gravity, friction, and restitution on rebuild.';
      } else {
        physicsHelpElement.textContent = 'Kinematic and static bodies ignore mass and gravity; collision material settings still apply.';
      }
    }

    this.syncSelectedSpringJointControls();
    this.syncSelectedPhysicsJointList(selectedObject);
  }

  readSelectedPhysicsJointObjects() {
    const selectedObjects = this.readSelectedObjects();
    if (selectedObjects.length !== 2) {
      return Object.freeze([]);
    }
    if (!selectedObjects.every(isPhysicsSpringJointSelectableSceneObject)) {
      return Object.freeze([]);
    }
    return selectedObjects;
  }

  syncSelectedSpringJointInputLabels() {
    const documentObject = this.canvasElement.ownerDocument;
    const restLengthInput = readOptionalElement(documentObject, 'selected-physics-spring-rest-length');
    const stiffnessInput = readOptionalElement(documentObject, 'selected-physics-spring-stiffness');
    const dampingInput = readOptionalElement(documentObject, 'selected-physics-spring-damping');

    const restLengthValueElement = readOptionalElement(documentObject, 'selected-physics-spring-rest-length-value');
    if (restLengthInput instanceof HTMLInputElement && restLengthValueElement instanceof HTMLElement) {
      restLengthValueElement.textContent = normalizePhysicsSpringRestLength(restLengthInput.value).toFixed(2);
    }

    const stiffnessValueElement = readOptionalElement(documentObject, 'selected-physics-spring-stiffness-value');
    if (stiffnessInput instanceof HTMLInputElement && stiffnessValueElement instanceof HTMLElement) {
      stiffnessValueElement.textContent = String(Math.round(normalizePhysicsSpringStiffness(stiffnessInput.value)));
    }

    const dampingValueElement = readOptionalElement(documentObject, 'selected-physics-spring-damping-value');
    if (dampingInput instanceof HTMLInputElement && dampingValueElement instanceof HTMLElement) {
      dampingValueElement.textContent = normalizePhysicsSpringDamping(dampingInput.value).toFixed(1);
    }

    return returnSuccess(undefined);
  }

  syncSelectedSpringJointControls() {
    const documentObject = this.canvasElement.ownerDocument;
    const selectedPhysicsObjects = this.readSelectedPhysicsJointObjects();
    const hasExactlyTwoPhysicsObjects = selectedPhysicsObjects.length === 2;
    const connectControlsElement = readOptionalElement(documentObject, 'selected-physics-spring-connect-controls');
    if (connectControlsElement instanceof HTMLElement) {
      connectControlsElement.hidden = !hasExactlyTwoPhysicsObjects;
    }

    const restLengthInput = readOptionalElement(documentObject, 'selected-physics-spring-rest-length');
    const stiffnessInput = readOptionalElement(documentObject, 'selected-physics-spring-stiffness');
    const dampingInput = readOptionalElement(documentObject, 'selected-physics-spring-damping');
    const connectButton = readOptionalElement(documentObject, 'selected-physics-connect-spring');
    const hasExistingJoint = hasExactlyTwoPhysicsObjects && hasPhysicsSpringJointBetweenObjects(
      selectedPhysicsObjects[0],
      selectedPhysicsObjects[1]
    );
    const isDisabled = (
      !hasExactlyTwoPhysicsObjects ||
      hasExistingJoint ||
      this.applicationState.isBenchmarkModeActive ||
      selectedPhysicsObjects.some((sceneObject) => sceneObject.isLocked)
    );

    if (hasExactlyTwoPhysicsObjects && restLengthInput instanceof HTMLInputElement) {
      restLengthInput.value = measurePhysicsSpringRestLengthBetweenObjects(
        selectedPhysicsObjects[0],
        selectedPhysicsObjects[1]
      ).toFixed(2);
    }
    if (stiffnessInput instanceof HTMLInputElement && !Number.isFinite(Number(stiffnessInput.value))) {
      stiffnessInput.value = String(DEFAULT_PHYSICS_SPRING_STIFFNESS);
    }
    if (dampingInput instanceof HTMLInputElement && !Number.isFinite(Number(dampingInput.value))) {
      dampingInput.value = DEFAULT_PHYSICS_SPRING_DAMPING.toFixed(1);
    }

    for (const springInput of [restLengthInput, stiffnessInput, dampingInput]) {
      if (springInput instanceof HTMLInputElement) {
        springInput.disabled = !hasExactlyTwoPhysicsObjects || this.applicationState.isBenchmarkModeActive;
      }
    }

    if (connectButton instanceof HTMLButtonElement) {
      connectButton.disabled = isDisabled;
      connectButton.textContent = hasExistingJoint ? 'Spring Connected' : 'Connect Spring';
    }

    return this.syncSelectedSpringJointInputLabels();
  }

  syncSelectedPhysicsJointList(selectedObject) {
    const documentObject = this.canvasElement.ownerDocument;
    const jointSectionElement = readOptionalElement(documentObject, 'selected-physics-joints-section');
    const jointListElement = readOptionalElement(documentObject, 'selected-physics-joint-list');
    const shouldShowJointList = isPhysicsSpringJointSelectableSceneObject(selectedObject);
    if (jointSectionElement instanceof HTMLElement) {
      jointSectionElement.hidden = !shouldShowJointList;
    }
    if (!(jointListElement instanceof HTMLElement)) {
      return returnSuccess(undefined);
    }

    while (jointListElement.firstChild) {
      jointListElement.removeChild(jointListElement.firstChild);
    }

    if (!shouldShowJointList) {
      jointListElement.textContent = 'No connected joints';
      return returnSuccess(undefined);
    }

    const jointRecords = readUniquePhysicsSpringJointRecords(selectedObject);
    if (jointRecords.length === 0) {
      jointListElement.textContent = 'No connected joints';
      return returnSuccess(undefined);
    }

    for (const jointRecord of jointRecords) {
      const partnerObject = jointRecord.targetObject;
      if (!partnerObject) {
        continue;
      }
      const rowElement = documentObject.createElement('div');
      rowElement.className = 'physics-joint-row';

      const labelElement = documentObject.createElement('span');
      labelElement.textContent = [
        formatSceneObjectDisplayName(partnerObject, this.lightObject),
        `rest ${normalizePhysicsSpringRestLength(jointRecord.restLength).toFixed(2)}`,
        `stiff ${Math.round(normalizePhysicsSpringStiffness(jointRecord.stiffness))}`,
        `damp ${normalizePhysicsSpringDamping(jointRecord.damping).toFixed(1)}`
      ].join(' - ');
      rowElement.appendChild(labelElement);

      const removeButton = documentObject.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.dataset.physicsJointRemove = readPhysicsSpringJointRecordId(
        jointRecord,
        selectedObject,
        partnerObject
      );
      removeButton.disabled = selectedObject.isLocked || this.applicationState.isBenchmarkModeActive;
      rowElement.appendChild(removeButton);
      jointListElement.appendChild(rowElement);
    }

    return returnSuccess(undefined);
  }

  connectSelectedPhysicsSpringJointFromControls() {
    const selectedPhysicsObjects = this.readSelectedPhysicsJointObjects();
    if (selectedPhysicsObjects.length !== 2) {
      this.syncSelectedSpringJointControls();
      return returnSuccess(undefined);
    }
    const [firstObject, secondObject] = selectedPhysicsObjects;
    if (
      this.applicationState.isBenchmarkModeActive ||
      firstObject.isLocked ||
      secondObject.isLocked ||
      hasPhysicsSpringJointBetweenObjects(firstObject, secondObject)
    ) {
      this.syncSelectedSpringJointControls();
      return returnSuccess(undefined);
    }

    const documentObject = this.canvasElement.ownerDocument;
    const restLengthInput = readOptionalElement(documentObject, 'selected-physics-spring-rest-length');
    const stiffnessInput = readOptionalElement(documentObject, 'selected-physics-spring-stiffness');
    const dampingInput = readOptionalElement(documentObject, 'selected-physics-spring-damping');
    if (
      !(restLengthInput instanceof HTMLInputElement) ||
      !(stiffnessInput instanceof HTMLInputElement) ||
      !(dampingInput instanceof HTMLInputElement)
    ) {
      return returnFailure('missing-spring-joint-controls', 'Spring joint controls are not available.');
    }

    const [restLength, restLengthError] = parseBoundedNumber(
      restLengthInput.value,
      DEFAULT_PHYSICS_SPRING_REST_LENGTH,
      MIN_PHYSICS_SPRING_REST_LENGTH,
      MAX_PHYSICS_SPRING_REST_LENGTH
    );
    if (restLengthError) {
      return returnFailure(restLengthError.code, restLengthError.message, restLengthError.details);
    }
    const [stiffness, stiffnessError] = parseBoundedNumber(
      stiffnessInput.value,
      DEFAULT_PHYSICS_SPRING_STIFFNESS,
      MIN_PHYSICS_SPRING_STIFFNESS,
      MAX_PHYSICS_SPRING_STIFFNESS
    );
    if (stiffnessError) {
      return returnFailure(stiffnessError.code, stiffnessError.message, stiffnessError.details);
    }
    const [damping, dampingError] = parseBoundedNumber(
      dampingInput.value,
      DEFAULT_PHYSICS_SPRING_DAMPING,
      MIN_PHYSICS_SPRING_DAMPING,
      MAX_PHYSICS_SPRING_DAMPING
    );
    if (dampingError) {
      return returnFailure(dampingError.code, dampingError.message, dampingError.details);
    }

    const jointId = allocatePhysicsSpringJointId(this.applicationState, firstObject, secondObject);
    ensurePhysicsSpringJointRecords(firstObject).push(createPhysicsSpringJointRecord(
      jointId,
      secondObject,
      restLength,
      stiffness,
      damping
    ));
    ensurePhysicsSpringJointRecords(secondObject).push(createPhysicsSpringJointRecord(
      jointId,
      firstObject,
      restLength,
      stiffness,
      damping
    ));

    const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
    if (physicsError) {
      removePhysicsSpringJointRecordsById(this.sceneObjects, jointId);
      this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
      return returnDiagnosticFailure(
        'error',
        'ui',
        'Spring joint creation could not rebuild the physics world.',
        physicsError
      );
    }

    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    const [, clearSamplesError] = this.selectionRenderer.pathTracer.clearSamples(false);
    if (clearSamplesError) {
      return returnFailure(clearSamplesError.code, clearSamplesError.message, clearSamplesError.details);
    }
    return returnSuccess(true);
  }

  removeSelectedPhysicsJoint(jointIdValue) {
    const jointId = String(jointIdValue || '').trim();
    if (!jointId) {
      return returnSuccess(undefined);
    }
    const jointRecordMatch = findScenePhysicsSpringJointRecordById(this.sceneObjects, jointId);
    if (!jointRecordMatch) {
      const [, syncError] = this.syncSelectedItemReadout();
      if (syncError) {
        return returnFailure(syncError.code, syncError.message, syncError.details);
      }
      return returnSuccess(undefined);
    }

    const [, removeError] = this.physicsWorld.removeSpringJoint(jointRecordMatch.jointRecord);
    if (removeError) {
      return returnDiagnosticFailure(
        'error',
        'ui',
        'Spring joint removal failed.',
        removeError
      );
    }

    removePhysicsSpringJointRecordsById(this.sceneObjects, jointId);
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  syncSelectedEmissiveControls(selectedObject = undefined) {
    if (selectedObject === undefined) {
      selectedObject = this.readSelectedObject();
    }
    const documentObject = this.canvasElement.ownerDocument;
    const isEmissionConfigurable = isSceneObjectEmissionConfigurable(selectedObject, this.lightObject);
    const isEmissionEnabled = isEmissionConfigurable && readSceneObjectEmissionEnabled(selectedObject);
    const controlsElement = readOptionalElement(documentObject, 'emissive-controls');
    if (controlsElement instanceof HTMLElement) {
      controlsElement.hidden = !isEmissionConfigurable;
    }

    const isDisabled = (
      !isEmissionConfigurable ||
      this.applicationState.isBenchmarkModeActive ||
      Boolean(selectedObject && selectedObject.isLocked)
    );
    const enabledInput = readOptionalElement(documentObject, 'emission-enabled');
    if (enabledInput instanceof HTMLInputElement) {
      enabledInput.checked = isEmissionEnabled;
      enabledInput.disabled = isDisabled;
    }

    const areEmissionSettingsDisabled = isDisabled || !isEmissionEnabled;
    const emissiveIntensity = readSceneObjectEmissiveIntensity(selectedObject);
    const intensityInput = readOptionalElement(documentObject, 'emissive-intensity');
    if (intensityInput instanceof HTMLInputElement) {
      intensityInput.value = emissiveIntensity.toFixed(2);
      intensityInput.disabled = areEmissionSettingsDisabled;
    }

    const intensityValueElement = readOptionalElement(documentObject, 'emissive-intensity-value');
    if (intensityValueElement instanceof HTMLElement) {
      intensityValueElement.textContent = emissiveIntensity.toFixed(2);
    }

    const colorInput = readOptionalElement(documentObject, 'emissive-color');
    if (colorInput instanceof HTMLInputElement) {
      colorInput.value = formatLightColorValue(readSceneObjectEmissiveColor(selectedObject));
      colorInput.disabled = areEmissionSettingsDisabled;
    }

    return returnSuccess(undefined);
  }

  syncSelectedMaterialProjectionControls(selectedObject = undefined) {
    if (selectedObject === undefined) {
      selectedObject = this.readSelectedObject();
    }

    const isProjectionConfigurable = (
      selectedObject &&
      selectedObject !== this.lightObject &&
      Number.isFinite(Number(selectedObject.material))
    );
    const isDisabled = (
      !isProjectionConfigurable ||
      this.applicationState.isBenchmarkModeActive ||
      Boolean(selectedObject && selectedObject.isLocked)
    );
    const projectionMode = isProjectionConfigurable
      ? readSceneObjectUvProjectionMode(selectedObject)
      : normalizeMaterialUvProjectionMode(this.applicationState.materialUvProjectionMode);
    const uvScale = isProjectionConfigurable
      ? readSceneObjectUvScale(selectedObject)
      : normalizeMaterialUvScale(this.applicationState.materialUvScale);
    const uvBlendSharpness = isProjectionConfigurable
      ? readSceneObjectUvBlendSharpness(selectedObject)
      : normalizeMaterialUvBlendSharpness(this.applicationState.materialUvBlendSharpness);

    this.applicationState.materialUvProjectionMode = projectionMode;
    this.applicationState.materialUvScale = uvScale;
    this.applicationState.materialUvBlendSharpness = uvBlendSharpness;

    if (this.materialUvProjectionModeSelect instanceof HTMLSelectElement) {
      this.materialUvProjectionModeSelect.value = projectionMode;
      this.materialUvProjectionModeSelect.disabled = isDisabled;
    }
    if (this.materialUvScaleInput instanceof HTMLInputElement) {
      this.materialUvScaleInput.value = uvScale.toFixed(2);
      this.materialUvScaleInput.disabled = isDisabled;
    }
    if (this.materialUvScaleValueElement instanceof HTMLElement) {
      this.materialUvScaleValueElement.textContent = uvScale.toFixed(2);
    }
    if (this.materialUvBlendSharpnessInput instanceof HTMLInputElement) {
      this.materialUvBlendSharpnessInput.value = uvBlendSharpness.toFixed(2);
      this.materialUvBlendSharpnessInput.disabled = isDisabled || projectionMode !== 'tri-planar';
    }
    if (this.materialUvBlendSharpnessValueElement instanceof HTMLElement) {
      this.materialUvBlendSharpnessValueElement.textContent = uvBlendSharpness.toFixed(2);
    }

    return returnSuccess(undefined);
  }

  readSelectedObjectPosition(selectedObject) {
    if (!selectedObject) {
      return null;
    }
    if (selectedObject === this.lightObject) {
      return this.applicationState.lightPosition;
    }
    if (selectedObject instanceof CubeSceneObject) {
      return selectedObject.getCenterPosition();
    }
    if (selectedObject.centerPosition) {
      return selectedObject.centerPosition;
    }
    return null;
  }

  syncSceneTree() {
    const documentObject = this.sceneTreeListElement.ownerDocument;
    const selectedEntityId = this.selectionRenderer.selectedEntityId;
    const selectedEntityIdSet = new Set(this.selectionRenderer.selectedEntityIds);
    const displayEntries = createSceneTreeDisplayEntries(this.sceneObjects);
    const activeEntityIds = new Set();
    for (let displayIndex = 0; displayIndex < displayEntries.length; displayIndex += 1) {
      const { sceneObject, depth } = displayEntries[displayIndex];
      const entityId = readSceneObjectEntityId(sceneObject);
      if (entityId === null) {
        continue;
      }
      activeEntityIds.add(entityId);
      let itemButton = this.sceneTreeButtons.get(entityId);
      if (!(itemButton instanceof HTMLButtonElement)) {
        itemButton = documentObject.createElement('button');
        itemButton.type = 'button';
        itemButton.setAttribute('role', 'option');
        this.sceneTreeButtons.set(entityId, itemButton);
      }
      this.sceneTreeListElement.appendChild(itemButton);
      delete itemButton.dataset.sceneObjectIndex;
      itemButton.dataset.sceneEntityId = entityId;
      itemButton.style.paddingLeft = `${10 + depth * 16}px`;
      const isPrimarySelected = entityId === selectedEntityId;
      const isSecondarySelected = !isPrimarySelected && selectedEntityIdSet.has(entityId);
      itemButton.setAttribute('aria-selected', isPrimarySelected || isSecondarySelected ? 'true' : 'false');
      itemButton.setAttribute('aria-pressed', isPrimarySelected || isSecondarySelected ? 'true' : 'false');
      if (isPrimarySelected) {
        itemButton.dataset.selectionState = 'primary';
      } else if (isSecondarySelected) {
        itemButton.dataset.selectionState = 'secondary';
      } else {
        delete itemButton.dataset.selectionState;
      }
      const sceneItemName = formatSceneObjectDisplayName(sceneObject, this.lightObject);
      const sceneItemStatus = [
        sceneObject.isHidden ? 'hidden' : '',
        sceneObject.isLocked ? 'locked' : ''
      ].filter(Boolean).join(', ');
      const jointSelectionLabel = (
        selectedEntityIdSet.has(entityId) &&
        isPhysicsSpringJointSelectableSceneObject(sceneObject)
      )
        ? ' [spring selection]'
        : '';
      const jointAnnotation = formatSceneObjectSpringJointSceneTreeAnnotation(sceneObject, this.lightObject);
      const sceneItemLabel = sceneObject === this.lightObject
        ? `${sceneItemName}${jointSelectionLabel}${jointAnnotation}`
        : `${sceneItemName} #${displayIndex}${jointSelectionLabel}${jointAnnotation}`;
      const nextItemText = sceneItemStatus ? `${sceneItemLabel} (${sceneItemStatus})` : sceneItemLabel;
      if (itemButton.textContent !== nextItemText) {
        itemButton.textContent = nextItemText;
      }
    }

    for (const [entityId, staleButton] of this.sceneTreeButtons.entries()) {
      if (activeEntityIds.has(entityId)) {
        continue;
      }
      if (staleButton && staleButton.parentNode === this.sceneTreeListElement) {
        this.sceneTreeListElement.removeChild(staleButton);
      }
      this.sceneTreeButtons.delete(entityId);
    }

    return writeElementTextIfChanged(
      this.sceneTreeCountElement,
      `${this.sceneObjects.length} scene ${this.sceneObjects.length === 1 ? 'item' : 'items'}`
    );
  }

  selectSceneObjectByEntityId(sceneEntityIdValue, selectionOptions = {}) {
    const selectedObject = findSceneObjectByEntityId(this.sceneObjects, sceneEntityIdValue);
    if (!selectedObject) {
      return returnFailure('invalid-scene-tree-selection', 'Scene tree item is not available.');
    }

    const nextSelectedObject = this.selectSceneObjectWithModifiers(selectedObject, selectionOptions);
    const [, materialSyncError] = this.syncMaterialSelectToObject(nextSelectedObject);
    if (materialSyncError) {
      return returnFailure(materialSyncError.code, materialSyncError.message, materialSyncError.details);
    }
    return this.syncSelectedItemReadout();
  }

  selectSceneObjectByIndex(sceneObjectIndexValue, selectionOptions = {}) {
    const sceneObjectIndex = Number.parseInt(sceneObjectIndexValue, 10);
    const displayEntries = createSceneTreeDisplayEntries(this.sceneObjects);
    if (!Number.isInteger(sceneObjectIndex) || sceneObjectIndex < 0 || sceneObjectIndex >= displayEntries.length) {
      return returnFailure('invalid-scene-tree-selection', 'Scene tree item is not available.');
    }

    const selectedObject = displayEntries[sceneObjectIndex].sceneObject;
    return this.selectSceneObjectByEntityId(readSceneObjectEntityId(selectedObject), selectionOptions);
  }

  render() {
    return this.selectionRenderer.render(this.applicationState);
  }

  selectLight() {
    this.selectSingleSceneObject(this.lightObject);
    return this.syncSelectedItemReadout();
  }

  readLightPositionInputs() {
    const documentObject = this.canvasElement.ownerDocument;
    const xInput = readOptionalElement(documentObject, 'light-position-x');
    const yInput = readOptionalElement(documentObject, 'light-position-y');
    const zInput = readOptionalElement(documentObject, 'light-position-z');
    if (!(xInput instanceof HTMLInputElement) || !(yInput instanceof HTMLInputElement) || !(zInput instanceof HTMLInputElement)) {
      return returnFailure('missing-light-position-inputs', 'Light position inputs are not available.');
    }

    return returnSuccess(Object.freeze({
      xInput,
      yInput,
      zInput
    }));
  }

  syncLightPositionControlsFromState() {
    const [positionInputs, positionInputsError] = this.readLightPositionInputs();
    if (positionInputsError) {
      return returnFailure(positionInputsError.code, positionInputsError.message, positionInputsError.details);
    }

    positionInputs.xInput.value = this.applicationState.lightPosition[0].toFixed(2);
    positionInputs.yInput.value = this.applicationState.lightPosition[1].toFixed(2);
    positionInputs.zInput.value = this.applicationState.lightPosition[2].toFixed(2);
    return returnSuccess(undefined);
  }

  updateLightPositionFromInputs() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncLightPositionControlsFromState();
    }

    const [positionInputs, positionInputsError] = this.readLightPositionInputs();
    if (positionInputsError) {
      return returnFailure(positionInputsError.code, positionInputsError.message, positionInputsError.details);
    }

    const [xPosition, xError] = parseBoundedNumber(positionInputs.xInput.value, 0, -1, 1);
    if (xError) {
      return returnFailure(xError.code, xError.message, xError.details);
    }
    const [yPosition, yError] = parseBoundedNumber(positionInputs.yInput.value, 0, -1, 1);
    if (yError) {
      return returnFailure(yError.code, yError.message, yError.details);
    }
    const [zPosition, zError] = parseBoundedNumber(positionInputs.zInput.value, 0, -1, 1);
    if (zError) {
      return returnFailure(zError.code, zError.message, zError.details);
    }

    const nextLightPosition = clampLightPosition(createVec3(xPosition, yPosition, zPosition), this.applicationState.lightSize);
    if (
      this.applicationState.lightPosition[0] === nextLightPosition[0] &&
      this.applicationState.lightPosition[1] === nextLightPosition[1] &&
      this.applicationState.lightPosition[2] === nextLightPosition[2]
    ) {
      return this.syncLightPositionControlsFromState();
    }

    writeVec3(
      this.applicationState.lightPosition,
      nextLightPosition[0],
      nextLightPosition[1],
      nextLightPosition[2]
    );

    const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
    if (uniformDirtyError) {
      return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
    }

    const [, lightPositionSyncError] = this.syncLightPositionControlsFromState();
    if (lightPositionSyncError) {
      return returnFailure(lightPositionSyncError.code, lightPositionSyncError.message, lightPositionSyncError.details);
    }
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  readGlobalGravityControls() {
    const documentObject = this.canvasElement.ownerDocument;
    const directionSelect = readOptionalElement(documentObject, 'global-gravity-direction');
    const magnitudeInput = readOptionalElement(documentObject, 'global-gravity-magnitude');
    const magnitudeValueElement = readOptionalElement(documentObject, 'global-gravity-magnitude-value');
    const customXInput = readOptionalElement(documentObject, 'global-gravity-custom-x');
    const customYInput = readOptionalElement(documentObject, 'global-gravity-custom-y');
    const customZInput = readOptionalElement(documentObject, 'global-gravity-custom-z');
    if (
      !(directionSelect instanceof HTMLSelectElement) ||
      !(magnitudeInput instanceof HTMLInputElement) ||
      !(magnitudeValueElement instanceof HTMLElement) ||
      !(customXInput instanceof HTMLInputElement) ||
      !(customYInput instanceof HTMLInputElement) ||
      !(customZInput instanceof HTMLInputElement)
    ) {
      return returnFailure('missing-global-gravity-controls', 'Global gravity controls are not available.');
    }

    return returnSuccess(Object.freeze({
      directionSelect,
      magnitudeInput,
      magnitudeValueElement,
      customXInput,
      customYInput,
      customZInput
    }));
  }

  syncGlobalGravityControlsFromState() {
    const [gravityControls, gravityControlsError] = this.readGlobalGravityControls();
    if (gravityControlsError) {
      return returnFailure(gravityControlsError.code, gravityControlsError.message, gravityControlsError.details);
    }

    const gravityDirection = normalizeGlobalGravityDirection(this.applicationState.physicsGravityDirection);
    const gravityMagnitude = normalizeGlobalGravityMagnitude(this.applicationState.physicsGravityMagnitude);
    const customDirection = ensureApplicationStateCustomGravityDirection(this.applicationState);
    const areCustomInputsEnabled = gravityDirection === GLOBAL_GRAVITY_DIRECTION.CUSTOM;

    gravityControls.directionSelect.value = gravityDirection;
    gravityControls.magnitudeInput.value = gravityMagnitude.toFixed(2);
    gravityControls.customXInput.value = customDirection[0].toFixed(2);
    gravityControls.customYInput.value = customDirection[1].toFixed(2);
    gravityControls.customZInput.value = customDirection[2].toFixed(2);
    gravityControls.customXInput.disabled = !areCustomInputsEnabled;
    gravityControls.customYInput.disabled = !areCustomInputsEnabled;
    gravityControls.customZInput.disabled = !areCustomInputsEnabled;

    return writeElementTextIfChanged(
      gravityControls.magnitudeValueElement,
      gravityMagnitude.toFixed(2)
    );
  }

  updateGlobalGravityFromControls() {
    const [gravityControls, gravityControlsError] = this.readGlobalGravityControls();
    if (gravityControlsError) {
      return returnFailure(gravityControlsError.code, gravityControlsError.message, gravityControlsError.details);
    }

    const nextGravityDirection = normalizeGlobalGravityDirection(gravityControls.directionSelect.value);
    const [parsedMagnitude, magnitudeError] = parseBoundedNumber(
      gravityControls.magnitudeInput.value,
      DEFAULT_GLOBAL_GRAVITY_MAGNITUDE,
      MIN_GLOBAL_GRAVITY_MAGNITUDE,
      MAX_GLOBAL_GRAVITY_MAGNITUDE
    );
    if (magnitudeError) {
      return returnFailure(magnitudeError.code, magnitudeError.message, magnitudeError.details);
    }

    const previousCustomDirection = ensureApplicationStateCustomGravityDirection(this.applicationState);
    const [customX, customXError] = parseBoundedNumber(gravityControls.customXInput.value, previousCustomDirection[0], -1, 1);
    if (customXError) {
      return returnFailure(customXError.code, customXError.message, customXError.details);
    }
    const [customY, customYError] = parseBoundedNumber(gravityControls.customYInput.value, previousCustomDirection[1], -1, 1);
    if (customYError) {
      return returnFailure(customYError.code, customYError.message, customYError.details);
    }
    const [customZ, customZError] = parseBoundedNumber(gravityControls.customZInput.value, previousCustomDirection[2], -1, 1);
    if (customZError) {
      return returnFailure(customZError.code, customZError.message, customZError.details);
    }

    this.applicationState.physicsGravityDirection = nextGravityDirection;
    this.applicationState.physicsGravityMagnitude = nextGravityDirection === GLOBAL_GRAVITY_DIRECTION.ZERO_G
      ? 0
      : parsedMagnitude;
    writeNormalizedGravityDirection(previousCustomDirection, customX, customY, customZ);

    const [didUpdateGravity, gravityUpdateError] = this.physicsWorld.applyGlobalGravity(this.applicationState);
    if (gravityUpdateError) {
      return returnFailure(gravityUpdateError.code, gravityUpdateError.message, gravityUpdateError.details);
    }
    const [, syncError] = this.syncGlobalGravityControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }
    const [, scheduleError] = scheduleAnimationFrame(this.applicationState);
    if (scheduleError) {
      return returnFailure(scheduleError.code, scheduleError.message, scheduleError.details);
    }

    return didUpdateGravity
      ? this.selectionRenderer.pathTracer.clearSamples(false)
      : returnSuccess(undefined);
  }

  syncLightColorControlFromState() {
    this.lightColorInput.value = formatLightColorValue(this.applicationState.lightColor);
    return returnSuccess(undefined);
  }

  updateLightColorFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncLightColorControlFromState();
    }

    const [nextLightColor, lightColorError] = parseLightColorValue(this.lightColorInput.value);
    if (lightColorError) {
      return returnFailure(lightColorError.code, lightColorError.message, lightColorError.details);
    }

    if (
      this.applicationState.lightColor[0] === nextLightColor[0] &&
      this.applicationState.lightColor[1] === nextLightColor[1] &&
      this.applicationState.lightColor[2] === nextLightColor[2]
    ) {
      return this.syncLightColorControlFromState();
    }

    writeVec3(this.applicationState.lightColor, nextLightColor[0], nextLightColor[1], nextLightColor[2]);
    const [, colorSyncError] = this.syncLightColorControlFromState();
    if (colorSyncError) {
      return returnFailure(colorSyncError.code, colorSyncError.message, colorSyncError.details);
    }
    const [, selectedLightSyncError] = this.syncSelectedLightControls();
    if (selectedLightSyncError) {
      return returnFailure(selectedLightSyncError.code, selectedLightSyncError.message, selectedLightSyncError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  updateSelectedLightIntensityFromInput() {
    const selectedLightIntensityInput = readOptionalElement(
      this.canvasElement.ownerDocument,
      'selected-light-intensity'
    );
    if (!(selectedLightIntensityInput instanceof HTMLInputElement)) {
      return returnSuccess(undefined);
    }
    this.lightIntensityInput.value = selectedLightIntensityInput.value;
    const [, intensityError] = this.updateLightIntensityFromInput();
    if (intensityError) {
      return returnFailure(intensityError.code, intensityError.message, intensityError.details);
    }
    return this.syncSelectedLightControls();
  }

  updateSelectedLightSizeFromInput() {
    const selectedLightSizeInput = readOptionalElement(
      this.canvasElement.ownerDocument,
      'selected-light-size'
    );
    if (!(selectedLightSizeInput instanceof HTMLInputElement)) {
      return returnSuccess(undefined);
    }
    this.lightSizeInput.value = selectedLightSizeInput.value;
    const [, sizeError] = this.updateLightSizeFromInput();
    if (sizeError) {
      return returnFailure(sizeError.code, sizeError.message, sizeError.details);
    }
    return this.syncSelectedLightControls();
  }

  updateSelectedLightColorFromInput() {
    const selectedLightColorInput = readOptionalElement(
      this.canvasElement.ownerDocument,
      'selected-light-color'
    );
    if (!(selectedLightColorInput instanceof HTMLInputElement)) {
      return returnSuccess(undefined);
    }
    this.lightColorInput.value = selectedLightColorInput.value;
    const [, colorError] = this.updateLightColorFromInput();
    if (colorError) {
      return returnFailure(colorError.code, colorError.message, colorError.details);
    }
    return this.syncSelectedLightControls();
  }

  updateSelectedLightTemperatureFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncSelectedLightControls();
    }

    const selectedLightTemperatureInput = readOptionalElement(
      this.canvasElement.ownerDocument,
      'selected-light-temperature'
    );
    if (!(selectedLightTemperatureInput instanceof HTMLInputElement)) {
      return returnSuccess(undefined);
    }

    const [lightTemperature, temperatureError] = parseBoundedNumber(
      selectedLightTemperatureInput.value,
      DEFAULT_LIGHT_TEMPERATURE_KELVIN,
      MIN_LIGHT_TEMPERATURE_KELVIN,
      MAX_LIGHT_TEMPERATURE_KELVIN
    );
    if (temperatureError) {
      return returnFailure(temperatureError.code, temperatureError.message, temperatureError.details);
    }

    const nextLightColor = createLightColorFromTemperature(lightTemperature);
    writeVec3(this.applicationState.lightColor, nextLightColor[0], nextLightColor[1], nextLightColor[2]);
    const [, colorSyncError] = this.syncLightColorControlFromState();
    if (colorSyncError) {
      return returnFailure(colorSyncError.code, colorSyncError.message, colorSyncError.details);
    }
    const [, selectedLightSyncError] = this.syncSelectedLightControls();
    if (selectedLightSyncError) {
      return returnFailure(selectedLightSyncError.code, selectedLightSyncError.message, selectedLightSyncError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  commitSceneEdit(statusText) {
    const documentObject = this.canvasElement.ownerDocument;
    const [, loadingError] = updateLoadingStatus(documentObject, statusText);
    if (loadingError) {
      return returnFailure(loadingError.code, loadingError.message, loadingError.details);
    }

    const [, syncError] = this.syncSceneObjectsToRendererAndPhysics();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    return queueLoadingOverlayDismiss(documentObject);
  }

  addSphere() {
    if (this.applicationState.isBenchmarkModeActive) {
      return returnSuccess(undefined);
    }

    const sphereObject = new SphereSceneObject(
      createVec3(0, 0, 0),
      0.25,
      allocateSceneObjectId(this.applicationState),
      this.applicationState.material
    );
    writeSceneObjectMaterialProjectionSettings(
      sphereObject,
      this.applicationState.materialUvProjectionMode,
      this.applicationState.materialUvScale,
      this.applicationState.materialUvBlendSharpness
    );
    this.sceneObjects.push(sphereObject);
    this.selectSingleSceneObject(sphereObject);
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.commitSceneEdit('Adding sphere and compiling shaders...');
  }

  addCube() {
    if (this.applicationState.isBenchmarkModeActive) {
      return returnSuccess(undefined);
    }

    const cubeObject = new CubeSceneObject(
      createVec3(-0.25, -0.25, -0.25),
      createVec3(0.25, 0.25, 0.25),
      allocateSceneObjectId(this.applicationState),
      this.applicationState.material
    );
    writeSceneObjectMaterialProjectionSettings(
      cubeObject,
      this.applicationState.materialUvProjectionMode,
      this.applicationState.materialUvScale,
      this.applicationState.materialUvBlendSharpness
    );
    this.sceneObjects.push(cubeObject);
    this.selectSingleSceneObject(cubeObject);
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.commitSceneEdit('Adding cube and compiling shaders...');
  }

  addPrimitive(primitiveFactory) {
    if (this.applicationState.isBenchmarkModeActive) {
      return returnSuccess(undefined);
    }

    const sceneObject = primitiveFactory(this.applicationState);
    writeSceneObjectMaterialProjectionSettings(
      sceneObject,
      this.applicationState.materialUvProjectionMode,
      this.applicationState.materialUvScale,
      this.applicationState.materialUvBlendSharpness
    );
    this.sceneObjects.push(sceneObject);
    this.selectSingleSceneObject(sceneObject);
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.commitSceneEdit('Adding item and compiling shaders...');
  }

  deleteSelection() {
    const selectedObject = this.readSelectedObject();
    if (!selectedObject || selectedObject === this.lightObject || selectedObject.isLocked) {
      return returnSuccess(undefined);
    }

    const selectedObjectIndex = this.sceneObjects.indexOf(selectedObject);
    if (selectedObjectIndex >= 0) {
      removePhysicsSpringJointRecordsForObject(this.sceneObjects, selectedObject);
      if (isGroupEntitySceneObject(selectedObject)) {
        for (const childEntityId of normalizeSceneEntityIdList(selectedObject.childEntityIds)) {
          const childObject = findSceneObjectByEntityId(this.sceneObjects, childEntityId);
          if (childObject && childObject.parentEntityId === selectedObject.entityId) {
            childObject.parentEntityId = null;
          }
        }
      }
      this.sceneObjects.splice(selectedObjectIndex, 1);
    }

    this.clearSceneSelection();
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.commitSceneEdit('Building scene...');
  }

  duplicateSelection() {
    const selectedObject = this.readSelectedObject();
    if (
      !selectedObject ||
      selectedObject === this.lightObject ||
      selectedObject.isLocked ||
      typeof selectedObject.cloneForDuplicate !== 'function'
    ) {
      return returnSuccess(undefined);
    }

    const duplicateObject = selectedObject.cloneForDuplicate(allocateSceneObjectId(this.applicationState));
    const [, offsetError] = duplicateObject.commitTranslation(createVec3(0.16, 0.08, 0.16));
    if (offsetError) {
      return returnFailure(offsetError.code, offsetError.message, offsetError.details);
    }
    this.sceneObjects.push(duplicateObject);
    this.selectSingleSceneObject(duplicateObject);
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.commitSceneEdit('Duplicating item and compiling shaders...');
  }

  renameSelection() {
    const selectedObject = this.readSelectedObject();
    if (!selectedObject || selectedObject === this.lightObject || selectedObject.isLocked) {
      return returnSuccess(undefined);
    }

    const nameInput = readOptionalElement(this.canvasElement.ownerDocument, 'selected-item-name-input');
    if (!(nameInput instanceof HTMLInputElement)) {
      return returnFailure('missing-name-input', 'Selected item name input is not available.');
    }

    selectedObject.displayName = nameInput.value.trim();
    return this.syncSelectedItemReadout();
  }

  toggleSelectionHidden() {
    const selectedObject = this.readSelectedObject();
    if (!selectedObject || selectedObject === this.lightObject || selectedObject.isLocked) {
      return returnSuccess(undefined);
    }

    selectedObject.isHidden = !selectedObject.isHidden;
    return this.commitSceneEdit(selectedObject.isHidden ? 'Hiding item...' : 'Showing item...');
  }

  toggleSelectionLocked() {
    if (this.applicationState.isBenchmarkModeActive) {
      return returnSuccess(undefined);
    }

    const selectedObject = this.readSelectedObject();
    if (!selectedObject || selectedObject === this.lightObject) {
      return returnSuccess(undefined);
    }

    selectedObject.isLocked = !selectedObject.isLocked;
    return this.syncSelectedItemReadout();
  }

  updateSelectionTransformFromInputs() {
    const selectedObject = this.readSelectedObject();
    if (!selectedObject || selectedObject.isLocked) {
      return returnSuccess(undefined);
    }

    const documentObject = this.canvasElement.ownerDocument;
    const xInput = readOptionalElement(documentObject, 'selected-position-x');
    const yInput = readOptionalElement(documentObject, 'selected-position-y');
    const zInput = readOptionalElement(documentObject, 'selected-position-z');
    if (!(xInput instanceof HTMLInputElement) || !(yInput instanceof HTMLInputElement) || !(zInput instanceof HTMLInputElement)) {
      return returnFailure('missing-transform-inputs', 'Selected item transform inputs are not available.');
    }

    const [xPosition, xError] = parseBoundedNumber(xInput.value, 0, -2, 2);
    if (xError) {
      return returnFailure(xError.code, xError.message, xError.details);
    }
    const [yPosition, yError] = parseBoundedNumber(yInput.value, 0, -2, 2);
    if (yError) {
      return returnFailure(yError.code, yError.message, yError.details);
    }
    const [zPosition, zError] = parseBoundedNumber(zInput.value, 0, -2, 2);
    if (zError) {
      return returnFailure(zError.code, zError.message, zError.details);
    }

    const shouldMoveSceneLight = selectedObject === this.lightObject || selectedObject instanceof AreaLightSceneObject;
    const nextLightPosition = shouldMoveSceneLight
      ? clampLightPosition(createVec3(xPosition, yPosition, zPosition), this.applicationState.lightSize)
      : null;
    if (selectedObject === this.lightObject) {
      writeVec3(this.applicationState.lightPosition, nextLightPosition[0], nextLightPosition[1], nextLightPosition[2]);
    } else if (typeof selectedObject.setCenterPositionComponents === 'function') {
      const nextObjectX = nextLightPosition ? nextLightPosition[0] : xPosition;
      const nextObjectY = nextLightPosition ? nextLightPosition[1] : yPosition;
      const nextObjectZ = nextLightPosition ? nextLightPosition[2] : zPosition;
      const [, positionError] = selectedObject.setCenterPositionComponents(nextObjectX, nextObjectY, nextObjectZ);
      if (positionError) {
        return returnFailure(positionError.code, positionError.message, positionError.details);
      }
      if (selectedObject instanceof AreaLightSceneObject) {
        writeVec3(this.applicationState.lightPosition, nextObjectX, nextObjectY, nextObjectZ);
      }
      const [, authoredTransformError] = writeSceneObjectAuthoredTransform(selectedObject, true);
      if (authoredTransformError) {
        return returnFailure(
          authoredTransformError.code,
          authoredTransformError.message,
          authoredTransformError.details
        );
      }
    }

    const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
    if (physicsError) {
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }
    const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
    if (uniformDirtyError) {
      return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
    }
    const [, lightPositionSyncError] = this.syncLightPositionControlsFromState();
    if (lightPositionSyncError) {
      return returnFailure(lightPositionSyncError.code, lightPositionSyncError.message, lightPositionSyncError.details);
    }
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  updateSelectedPhysicsFromControls() {
    const selectedObject = this.readSelectedObject();
    if (!isPhysicsSupportedSceneObject(selectedObject) || selectedObject.isLocked) {
      return returnSuccess(undefined);
    }

    const documentObject = this.canvasElement.ownerDocument;
    const physicsEnabledInput = readOptionalElement(documentObject, 'selected-physics-enabled');
    const physicsBodyTypeSelect = readOptionalElement(documentObject, 'selected-physics-body-type');
    const physicsMassInput = readOptionalElement(documentObject, 'selected-physics-mass');
    const physicsGravityScaleInput = readOptionalElement(documentObject, 'selected-physics-gravity-scale');
    const physicsFrictionInput = readOptionalElement(documentObject, 'selected-physics-friction');
    const physicsRestitutionInput = readOptionalElement(documentObject, 'selected-physics-restitution');
    if (
      !(physicsEnabledInput instanceof HTMLInputElement) ||
      !(physicsBodyTypeSelect instanceof HTMLSelectElement) ||
      !(physicsFrictionInput instanceof HTMLInputElement) ||
      !(physicsRestitutionInput instanceof HTMLInputElement)
    ) {
      return returnDiagnosticFailure(
        'error',
        'ui',
        'Selected physics controls were not available for update.',
        Object.freeze({
          code: 'missing-physics-controls',
          message: 'Selected item physics controls are not available.',
          details: null
        })
      );
    }

    const [nextBodyType, bodyTypeError] = parsePhysicsBodyType(
      physicsBodyTypeSelect.value,
      getDefaultPhysicsBodyType(selectedObject)
    );
    if (bodyTypeError) {
      return returnDiagnosticFailure('error', 'ui', 'Selected physics body type update failed.', bodyTypeError);
    }
    let nextMass = readSceneObjectPhysicsMass(selectedObject);
    if (physicsMassInput instanceof HTMLInputElement) {
      const [parsedMass, massError] = parseBoundedNumber(
        physicsMassInput.value,
        getDefaultPhysicsMass(selectedObject),
        MIN_PHYSICS_MASS,
        MAX_PHYSICS_MASS
      );
      if (massError) {
        return returnDiagnosticFailure('error', 'ui', 'Selected physics mass update failed.', massError);
      }
      nextMass = parsedMass;
    }
    let nextGravityScale = readSceneObjectPhysicsGravityScale(selectedObject);
    if (physicsGravityScaleInput instanceof HTMLInputElement) {
      const [parsedGravityScale, gravityScaleError] = parseBoundedNumber(
        physicsGravityScaleInput.value,
        getDefaultPhysicsGravityScale(selectedObject),
        MIN_PHYSICS_GRAVITY_SCALE,
        MAX_PHYSICS_GRAVITY_SCALE
      );
      if (gravityScaleError) {
        return returnDiagnosticFailure('error', 'ui', 'Selected physics gravity-scale update failed.', gravityScaleError);
      }
      nextGravityScale = parsedGravityScale;
    }
    const [nextFriction, frictionError] = parseBoundedNumber(
      physicsFrictionInput.value,
      getDefaultPhysicsFriction(selectedObject),
      MIN_PHYSICS_SURFACE_COEFFICIENT,
      MAX_PHYSICS_SURFACE_COEFFICIENT
    );
    if (frictionError) {
      return returnDiagnosticFailure('error', 'ui', 'Selected physics friction update failed.', frictionError);
    }
    const [nextRestitution, restitutionError] = parseBoundedNumber(
      physicsRestitutionInput.value,
      getDefaultPhysicsRestitution(selectedObject),
      MIN_PHYSICS_SURFACE_COEFFICIENT,
      MAX_PHYSICS_SURFACE_COEFFICIENT
    );
    if (restitutionError) {
      return returnDiagnosticFailure('error', 'ui', 'Selected physics restitution update failed.', restitutionError);
    }

    const nextIsEnabled = physicsEnabledInput.checked;
    const previousIsEnabled = selectedObject.isPhysicsEnabled !== false;
    const previousBodyType = readSceneObjectPhysicsBodyType(selectedObject);
    const previousMass = readSceneObjectPhysicsMass(selectedObject);
    const previousGravityScale = readSceneObjectPhysicsGravityScale(selectedObject);
    const previousFriction = readSceneObjectPhysicsFriction(selectedObject);
    const previousRestitution = readSceneObjectPhysicsRestitution(selectedObject);
    const physicsCollideWithObjectsInput = readOptionalElement(documentObject, 'selected-physics-collide-with-objects');
    const nextCollideWithObjects = physicsCollideWithObjectsInput instanceof HTMLInputElement
      ? physicsCollideWithObjectsInput.checked
      : selectedObject.collideWithObjects !== false;
    const previousCollideWithObjects = selectedObject.collideWithObjects !== false;
    selectedObject.isPhysicsEnabled = nextIsEnabled;
    selectedObject.physicsBodyType = nextBodyType;
    selectedObject.physicsMass = nextMass;
    selectedObject.physicsGravityScale = nextGravityScale;
    selectedObject.physicsFriction = nextFriction;
    selectedObject.physicsRestitution = nextRestitution;
    selectedObject.collideWithObjects = nextCollideWithObjects;

    this.syncSelectedPhysicsControls(selectedObject);

    if (
      previousIsEnabled === nextIsEnabled &&
      previousBodyType === nextBodyType &&
      previousMass === nextMass &&
      previousGravityScale === nextGravityScale &&
      previousFriction === nextFriction &&
      previousRestitution === nextRestitution &&
      previousCollideWithObjects === nextCollideWithObjects
    ) {
      return returnSuccess(undefined);
    }

    const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
    if (physicsError) {
      selectedObject.isPhysicsEnabled = previousIsEnabled;
      selectedObject.physicsBodyType = previousBodyType;
      selectedObject.physicsMass = previousMass;
      selectedObject.physicsGravityScale = previousGravityScale;
      selectedObject.physicsFriction = previousFriction;
      selectedObject.physicsRestitution = previousRestitution;
      selectedObject.collideWithObjects = previousCollideWithObjects;
      this.syncSelectedPhysicsControls(selectedObject);
      this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
      return returnDiagnosticFailure(
        'error',
        'ui',
        'Selected physics update could not rebuild the physics world.',
        physicsError
      );
    }

    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnDiagnosticFailure('error', 'ui', 'Selected physics update could not sync the inspector.', readoutError);
    }
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  updateSelectedEmissiveFromControls() {
    const selectedObject = this.readSelectedObject();
    if (!isSceneObjectEmissionConfigurable(selectedObject, this.lightObject)) {
      return this.syncSelectedEmissiveControls(selectedObject);
    }
    if (this.applicationState.isBenchmarkModeActive || selectedObject.isLocked) {
      return this.syncSelectedEmissiveControls(selectedObject);
    }

    const documentObject = this.canvasElement.ownerDocument;
    const enabledInput = readOptionalElement(documentObject, 'emission-enabled');
    const intensityInput = readOptionalElement(documentObject, 'emissive-intensity');
    const colorInput = readOptionalElement(documentObject, 'emissive-color');
    if (!(intensityInput instanceof HTMLInputElement) || !(colorInput instanceof HTMLInputElement)) {
      return returnFailure('missing-emissive-controls', 'Selected item emissive controls are not available.');
    }
    const nextEmissionEnabled = enabledInput instanceof HTMLInputElement
      ? enabledInput.checked
      : readSceneObjectEmissionEnabled(selectedObject);

    const [nextIntensity, intensityError] = parseBoundedNumber(
      intensityInput.value,
      DEFAULT_EMISSIVE_INTENSITY,
      MIN_EMISSIVE_INTENSITY,
      MAX_EMISSIVE_INTENSITY
    );
    if (intensityError) {
      return returnFailure(intensityError.code, intensityError.message, intensityError.details);
    }

    const [nextColor, colorError] = parseLightColorValue(colorInput.value);
    if (colorError) {
      return returnFailure(colorError.code, colorError.message, colorError.details);
    }

    const previousIntensity = readSceneObjectEmissiveIntensity(selectedObject);
    const previousColor = readSceneObjectEmissiveColor(selectedObject);
    const previousEmissionEnabled = readSceneObjectEmissionEnabled(selectedObject);
    const [, writeError] = writeSceneObjectEmissiveSettings(
      selectedObject,
      nextColor,
      nextIntensity,
      nextEmissionEnabled
    );
    if (writeError) {
      return returnFailure(writeError.code, writeError.message, writeError.details);
    }

    const [, syncError] = this.syncSelectedEmissiveControls(selectedObject);
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    if (
      previousEmissionEnabled === nextEmissionEnabled &&
      previousIntensity === nextIntensity &&
      previousColor[0] === nextColor[0] &&
      previousColor[1] === nextColor[1] &&
      previousColor[2] === nextColor[2]
    ) {
      return returnSuccess(undefined);
    }

    const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }
    return returnSuccess(undefined);
  }

  updateMaterialFromSelect() {
    const [nextMaterial, materialError] = parseMaterial(this.materialSelect.value);
    if (materialError) {
      return returnDiagnosticFailure('error', 'ui', 'Material select update failed.', materialError);
    }

    if (this.applicationState.material === nextMaterial) {
      return returnSuccess(undefined);
    }

    this.applicationState.material = nextMaterial;
    return returnSuccess(undefined);
  }

  updateMaterialProjectionFromControls() {
    const nextProjectionMode = this.materialUvProjectionModeSelect instanceof HTMLSelectElement
      ? normalizeMaterialUvProjectionMode(this.materialUvProjectionModeSelect.value)
      : normalizeMaterialUvProjectionMode(this.applicationState.materialUvProjectionMode);
    const nextUvScale = this.materialUvScaleInput instanceof HTMLInputElement
      ? normalizeMaterialUvScale(Number.parseFloat(this.materialUvScaleInput.value))
      : normalizeMaterialUvScale(this.applicationState.materialUvScale);
    const nextUvBlendSharpness = this.materialUvBlendSharpnessInput instanceof HTMLInputElement
      ? normalizeMaterialUvBlendSharpness(Number.parseFloat(this.materialUvBlendSharpnessInput.value))
      : normalizeMaterialUvBlendSharpness(this.applicationState.materialUvBlendSharpness);

    this.applicationState.materialUvProjectionMode = nextProjectionMode;
    this.applicationState.materialUvScale = nextUvScale;
    this.applicationState.materialUvBlendSharpness = nextUvBlendSharpness;

    const selectedObject = this.readSelectedObject();
    if (
      !selectedObject ||
      selectedObject === this.lightObject ||
      selectedObject.isLocked ||
      !Number.isFinite(Number(selectedObject.material))
    ) {
      return this.syncSelectedMaterialProjectionControls(selectedObject);
    }

    const previousProjectionMode = readSceneObjectUvProjectionMode(selectedObject);
    const previousUvScale = readSceneObjectUvScale(selectedObject);
    const previousUvBlendSharpness = readSceneObjectUvBlendSharpness(selectedObject);
    selectedObject.uvProjectionMode = nextProjectionMode;
    selectedObject.uvScale = nextUvScale;
    selectedObject.uvBlendSharpness = nextUvBlendSharpness;

    const [, syncError] = this.syncSelectedMaterialProjectionControls(selectedObject);
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    if (
      previousProjectionMode === nextProjectionMode &&
      previousUvScale === nextUvScale &&
      previousUvBlendSharpness === nextUvBlendSharpness
    ) {
      return returnSuccess(undefined);
    }

    return this.scheduleShaderRebuildFromInput('Updating material projection and compiling shaders...');
  }

  applyMaterialToSelection() {
    const [nextMaterial, materialError] = parseMaterial(this.materialSelect.value);
    if (materialError) {
      return returnDiagnosticFailure('error', 'ui', 'Apply material action failed to parse the selected material.', materialError);
    }

    this.applicationState.material = nextMaterial;
    const selectedObject = this.readSelectedObject();
    if (
      !selectedObject ||
      selectedObject === this.lightObject ||
      selectedObject.isLocked ||
      typeof selectedObject.setMaterial !== 'function'
    ) {
      return returnSuccess(undefined);
    }

    const nextProjectionMode = normalizeMaterialUvProjectionMode(this.applicationState.materialUvProjectionMode);
    const nextUvScale = normalizeMaterialUvScale(this.applicationState.materialUvScale);
    const nextUvBlendSharpness = normalizeMaterialUvBlendSharpness(this.applicationState.materialUvBlendSharpness);
    const previousProjectionMode = readSceneObjectUvProjectionMode(selectedObject);
    const previousUvScale = readSceneObjectUvScale(selectedObject);
    const previousUvBlendSharpness = readSceneObjectUvBlendSharpness(selectedObject);
    const didMaterialChange = selectedObject.material !== nextMaterial;
    const didProjectionChange = (
      previousProjectionMode !== nextProjectionMode ||
      previousUvScale !== nextUvScale ||
      previousUvBlendSharpness !== nextUvBlendSharpness
    );

    if (didMaterialChange) {
      const [, materialSetError] = selectedObject.setMaterial(nextMaterial);
      if (materialSetError) {
        return returnDiagnosticFailure('error', 'ui', 'Apply material action could not update the selected item.', materialSetError);
      }
    }
    selectedObject.uvProjectionMode = nextProjectionMode;
    selectedObject.uvScale = nextUvScale;
    selectedObject.uvBlendSharpness = nextUvBlendSharpness;

    if (!didMaterialChange && !didProjectionChange) {
      return this.syncSelectedEmissiveControls(selectedObject);
    }

    const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
    if (rendererError) {
      return returnDiagnosticFailure('error', 'ui', 'Apply material action could not rebuild renderer objects.', rendererError);
    }
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnDiagnosticFailure('error', 'ui', 'Apply material action could not sync the inspector.', readoutError);
    }
    return returnSuccess(undefined);
  }

  syncMaterialSelectToObject(sceneObject) {
    if (!sceneObject || sceneObject === this.lightObject || !Number.isFinite(sceneObject.material)) {
      return returnSuccess(undefined);
    }

    this.applicationState.material = normalizeMaterial(sceneObject.material);
    this.materialSelect.value = String(this.applicationState.material);
    return this.syncSelectedMaterialProjectionControls(sceneObject);
  }

  updateEnvironmentFromSelect() {
    if (this.applicationState.isBenchmarkModeActive) {
      this.environmentSelect.value = String(this.applicationState.environment);
      return returnSuccess(undefined);
    }

    const nextEnvironment = Number.parseInt(this.environmentSelect.value, 10);
    if (Number.isNaN(nextEnvironment)) {
      return returnFailure('invalid-environment', 'Selected environment is invalid.');
    }

    this.applicationState.environment = nextEnvironment;
    return this.syncSceneObjectsToRendererAndPhysics();
  }

  updateGlossinessFromInput() {
    const parsedGlossiness = Number.parseFloat(this.glossinessInput.value);
    const nextGlossiness = clampNumber(Number.isNaN(parsedGlossiness) ? 0 : parsedGlossiness, 0, 1);

    if (this.applicationState.material === MATERIAL.GLOSSY && this.applicationState.glossiness !== nextGlossiness) {
      const [, clearError] = this.selectionRenderer.pathTracer.clearSamples();
      if (clearError) {
        return returnFailure(clearError.code, clearError.message, clearError.details);
      }
    }

    this.applicationState.glossiness = nextGlossiness;
    return returnSuccess(undefined);
  }

  updateLightBounceCountFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncIntegerControlFromState(
        this.lightBounceInput,
        this.lightBounceValueElement,
        this.applicationState.lightBounceCount
      );
    }

    const [nextLightBounceCount, parseError] = parseBoundedInteger(
      this.lightBounceInput.value,
      DEFAULT_LIGHT_BOUNCE_COUNT,
      MIN_LIGHT_BOUNCE_COUNT,
      MAX_LIGHT_BOUNCE_COUNT
    );
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    this.lightBounceInput.value = String(nextLightBounceCount);
    this.lightBounceValueElement.textContent = String(nextLightBounceCount);

    if (this.applicationState.lightBounceCount === nextLightBounceCount) {
      return returnSuccess(undefined);
    }

    this.applicationState.lightBounceCount = nextLightBounceCount;
    return this.scheduleShaderRebuildFromInput('Updating bounce count and compiling shaders...');
  }

  syncLightIntensityValue() {
    this.lightIntensityInput.value = this.applicationState.lightIntensity.toFixed(2);
    this.lightIntensityValueElement.textContent = formatLightIntensityValue(this.applicationState.lightIntensity);
    return returnSuccess(undefined);
  }

  updateLightIntensityFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncLightIntensityValue();
    }

    const [nextLightIntensity, parseError] = parseBoundedNumber(
      this.lightIntensityInput.value,
      DEFAULT_LIGHT_INTENSITY,
      MIN_LIGHT_INTENSITY,
      MAX_LIGHT_INTENSITY
    );
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    this.applicationState.isLightIntensityCycling = false;
    const [, cycleButtonError] = updateLightIntensityCycleButton(
      this.lightCycleButton,
      this.applicationState.isLightIntensityCycling
    );
    if (cycleButtonError) {
      return returnFailure(cycleButtonError.code, cycleButtonError.message, cycleButtonError.details);
    }

    this.lightIntensityInput.value = nextLightIntensity.toFixed(2);
    this.lightIntensityValueElement.textContent = formatLightIntensityValue(nextLightIntensity);

    const previousLightIntensity = this.applicationState.lightIntensity;
    if (previousLightIntensity !== nextLightIntensity) {
      this.applicationState.lightIntensity = nextLightIntensity;
    }

    const [, selectedLightSyncError] = this.syncSelectedLightControls();
    if (selectedLightSyncError) {
      return returnFailure(selectedLightSyncError.code, selectedLightSyncError.message, selectedLightSyncError.details);
    }

    if (previousLightIntensity === nextLightIntensity) {
      return returnSuccess(undefined);
    }
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  updatePathTracingNumberControlFromInput(inputElement, valueElement, stateKey, fallbackValue, minValue, maxValue) {
    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatColorAdjustmentValue(nextValue);

    const previousValue = this.applicationState[stateKey];
    if (previousValue === nextValue) {
      return returnSuccess(undefined);
    }

    const wasFogEnabled = stateKey === 'fogDensity' && previousValue > 0.0001;
    this.applicationState[stateKey] = nextValue;
    if (stateKey === 'lightSize') {
      this.applicationState.lightPosition = clampLightPosition(this.applicationState.lightPosition, nextValue);
      const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
      if (uniformDirtyError) {
        return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
      }
      const [, lightPositionSyncError] = this.syncLightPositionControlsFromState();
      if (lightPositionSyncError) {
        return returnFailure(lightPositionSyncError.code, lightPositionSyncError.message, lightPositionSyncError.details);
      }
      const [, readoutError] = this.syncSelectedItemReadout();
      if (readoutError) {
        return returnFailure(readoutError.code, readoutError.message, readoutError.details);
      }
    }

    const isFogEnabled = stateKey === 'fogDensity' && nextValue > 0.0001;
    if (wasFogEnabled !== isFogEnabled) {
      return this.scheduleShaderRebuildFromInput('Updating fog and compiling shaders...');
    }

    return this.selectionRenderer.pathTracer.clearSamples();
  }

  updateDisplayNumberControlFromInput(inputElement, valueElement, stateKey, fallbackValue, minValue, maxValue) {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncNumberControlFromState(
        inputElement,
        valueElement,
        this.applicationState[stateKey],
        formatColorAdjustmentValue
      );
    }

    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatColorAdjustmentValue(nextValue);

    if (this.applicationState[stateKey] === nextValue) {
      return returnSuccess(undefined);
    }

    this.applicationState[stateKey] = nextValue;
    if (stateKey === 'denoiserStrength') {
      return this.selectionRenderer.pathTracer.clearDisplayHistory();
    }

    return returnSuccess(undefined);
  }

  updateLightSizeFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncNumberControlFromState(
        this.lightSizeInput,
        this.lightSizeValueElement,
        this.applicationState.lightSize,
        formatColorAdjustmentValue
      );
    }

    return this.updatePathTracingNumberControlFromInput(
      this.lightSizeInput,
      this.lightSizeValueElement,
      'lightSize',
      DEFAULT_LIGHT_SIZE,
      MIN_LIGHT_SIZE,
      MAX_LIGHT_SIZE
    );
  }

  updateFogDensityFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncNumberControlFromState(
        this.fogDensityInput,
        this.fogDensityValueElement,
        this.applicationState.fogDensity,
        formatColorAdjustmentValue
      );
    }

    return this.updatePathTracingNumberControlFromInput(
      this.fogDensityInput,
      this.fogDensityValueElement,
      'fogDensity',
      DEFAULT_FOG_DENSITY,
      MIN_FOG_DENSITY,
      MAX_FOG_DENSITY
    );
  }

  updateSkyBrightnessFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncNumberControlFromState(
        this.skyBrightnessInput,
        this.skyBrightnessValueElement,
        this.applicationState.skyBrightness,
        formatColorAdjustmentValue
      );
    }

    return this.updatePathTracingNumberControlFromInput(
      this.skyBrightnessInput,
      this.skyBrightnessValueElement,
      'skyBrightness',
      DEFAULT_SKY_BRIGHTNESS,
      MIN_SKY_BRIGHTNESS,
      MAX_SKY_BRIGHTNESS
    );
  }

  updateDenoiserStrengthFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncNumberControlFromState(
        this.denoiserStrengthInput,
        this.denoiserStrengthValueElement,
        this.applicationState.denoiserStrength,
        formatColorAdjustmentValue
      );
    }

    return this.updateDisplayNumberControlFromInput(
      this.denoiserStrengthInput,
      this.denoiserStrengthValueElement,
      'denoiserStrength',
      DEFAULT_DENOISER_STRENGTH,
      MIN_DENOISER_STRENGTH,
      MAX_DENOISER_STRENGTH
    );
  }

  updateBloomStrengthFromInput() {
    return this.updateDisplayNumberControlFromInput(
      this.bloomStrengthInput,
      this.bloomStrengthValueElement,
      'bloomStrength',
      DEFAULT_BLOOM_STRENGTH,
      MIN_BLOOM_STRENGTH,
      MAX_BLOOM_STRENGTH
    );
  }

  updateBloomThresholdFromInput() {
    return this.updateDisplayNumberControlFromInput(
      this.bloomThresholdInput,
      this.bloomThresholdValueElement,
      'bloomThreshold',
      DEFAULT_BLOOM_THRESHOLD,
      MIN_BLOOM_THRESHOLD,
      MAX_BLOOM_THRESHOLD
    );
  }

  updateGlareStrengthFromInput() {
    return this.updateDisplayNumberControlFromInput(
      this.glareStrengthInput,
      this.glareStrengthValueElement,
      'glareStrength',
      DEFAULT_GLARE_STRENGTH,
      MIN_GLARE_STRENGTH,
      MAX_GLARE_STRENGTH
    );
  }

  toggleLightIntensityCycle(toggleButton) {
    if (this.applicationState.isBenchmarkModeActive) {
      this.applicationState.isLightIntensityCycling = false;
      const [, benchmarkButtonError] = updateLightIntensityCycleButton(toggleButton, false);
      if (benchmarkButtonError) {
        return returnFailure(benchmarkButtonError.code, benchmarkButtonError.message, benchmarkButtonError.details);
      }
      return this.syncLightIntensityValue();
    }

    this.applicationState.isLightIntensityCycling = !this.applicationState.isLightIntensityCycling;
    const [, buttonError] = updateLightIntensityCycleButton(
      toggleButton,
      this.applicationState.isLightIntensityCycling
    );
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }

    return this.syncLightIntensityValue();
  }

  advanceLightIntensityCycle(elapsedSeconds) {
    if (!this.applicationState.isLightIntensityCycling) {
      return returnSuccess(false);
    }

    const span = MAX_LIGHT_INTENSITY - MIN_LIGHT_INTENSITY;
    if (span <= 0) {
      return returnSuccess(false);
    }

    const cycleDistance = span * 2;
    const currentCyclePosition = this.applicationState.lightIntensityCycleDirection >= 0
      ? this.applicationState.lightIntensity - MIN_LIGHT_INTENSITY
      : span + (MAX_LIGHT_INTENSITY - this.applicationState.lightIntensity);
    const nextCyclePosition = (currentCyclePosition + LIGHT_INTENSITY_CYCLE_SPEED * elapsedSeconds) % cycleDistance;
    const isRising = nextCyclePosition <= span;
    const nextIntensity = clampNumber(
      isRising
        ? MIN_LIGHT_INTENSITY + nextCyclePosition
        : MAX_LIGHT_INTENSITY - (nextCyclePosition - span),
      MIN_LIGHT_INTENSITY,
      MAX_LIGHT_INTENSITY
    );
    const nextDirection = isRising ? 1 : -1;

    if (Math.abs(this.applicationState.lightIntensity - nextIntensity) < 0.000001) {
      return returnSuccess(false);
    }

    this.applicationState.lightIntensity = nextIntensity;
    this.applicationState.lightIntensityCycleDirection = nextDirection;
    const [, intensitySyncError] = this.syncLightIntensityValue();
    if (intensitySyncError) {
      return returnFailure(intensitySyncError.code, intensitySyncError.message, intensitySyncError.details);
    }
    const [, selectedLightSyncError] = this.syncSelectedLightControls();
    if (selectedLightSyncError) {
      return returnFailure(selectedLightSyncError.code, selectedLightSyncError.message, selectedLightSyncError.details);
    }
    const [, clearSamplesError] = this.selectionRenderer.pathTracer.clearSamples(false);
    if (clearSamplesError) {
      return returnFailure(clearSamplesError.code, clearSamplesError.message, clearSamplesError.details);
    }
    return returnSuccess(true);
  }

  updateRaysPerPixelFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncIntegerControlFromState(
        this.raysPerPixelInput,
        this.raysPerPixelValueElement,
        this.applicationState.raysPerPixel
      );
    }

    const [nextRaysPerPixel, parseError] = parseBoundedInteger(
      this.raysPerPixelInput.value,
      DEFAULT_RAYS_PER_PIXEL,
      MIN_RAYS_PER_PIXEL,
      MAX_RAYS_PER_PIXEL
    );
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    this.raysPerPixelInput.value = String(nextRaysPerPixel);
    this.raysPerPixelValueElement.textContent = String(nextRaysPerPixel);

    if (this.applicationState.raysPerPixel === nextRaysPerPixel) {
      return returnSuccess(undefined);
    }

    this.applicationState.raysPerPixel = nextRaysPerPixel;
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  updateTemporalBlendFramesFromInput() {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncIntegerControlFromState(
        this.temporalBlendFramesInput,
        this.temporalBlendFramesValueElement,
        this.applicationState.temporalBlendFrames
      );
    }

    const [nextTemporalBlendFrames, parseError] = parseBoundedInteger(
      this.temporalBlendFramesInput.value,
      DEFAULT_TEMPORAL_BLEND_FRAMES,
      MIN_TEMPORAL_BLEND_FRAMES,
      MAX_TEMPORAL_BLEND_FRAMES
    );
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    this.temporalBlendFramesInput.value = String(nextTemporalBlendFrames);
    this.temporalBlendFramesValueElement.textContent = String(nextTemporalBlendFrames);

    if (this.applicationState.temporalBlendFrames === nextTemporalBlendFrames) {
      return returnSuccess(undefined);
    }

    this.applicationState.temporalBlendFrames = nextTemporalBlendFrames;
    return this.selectionRenderer.pathTracer.clearDisplayHistory();
  }

  updateCameraEffectControlFromInput(
    inputElement,
    valueElement,
    stateKey,
    fallbackValue,
    minValue,
    maxValue,
    formatValue = formatCameraEffectValue
  ) {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncNumberControlFromState(
        inputElement,
        valueElement,
        this.applicationState[stateKey],
        formatValue
      );
    }

    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatValue(nextValue);

    if (this.applicationState[stateKey] === nextValue) {
      return returnSuccess(undefined);
    }

    this.applicationState[stateKey] = nextValue;
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  updateCameraFieldOfViewFromInput() {
    return this.updateCameraEffectControlFromInput(
      this.cameraFieldOfViewInput,
      this.cameraFieldOfViewValueElement,
      'cameraFieldOfViewDegrees',
      DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES,
      MIN_CAMERA_FIELD_OF_VIEW_DEGREES,
      MAX_CAMERA_FIELD_OF_VIEW_DEGREES,
      formatCameraFieldOfViewValue
    );
  }

  updateCameraFocusDistanceFromInput() {
    return this.updateCameraEffectControlFromInput(
      this.cameraFocusDistanceInput,
      this.cameraFocusDistanceValueElement,
      'cameraFocusDistance',
      DEFAULT_CAMERA_FOCUS_DISTANCE,
      MIN_CAMERA_FOCUS_DISTANCE,
      MAX_CAMERA_FOCUS_DISTANCE
    );
  }

  updateCameraApertureFromInput() {
    return this.updateCameraEffectControlFromInput(
      this.cameraApertureInput,
      this.cameraApertureValueElement,
      'cameraAperture',
      DEFAULT_CAMERA_APERTURE,
      MIN_CAMERA_APERTURE,
      MAX_CAMERA_APERTURE
    );
  }

  updateMotionBlurFromInput() {
    return this.updateCameraEffectControlFromInput(
      this.motionBlurInput,
      this.motionBlurValueElement,
      'motionBlurStrength',
      DEFAULT_MOTION_BLUR_STRENGTH,
      MIN_MOTION_BLUR_STRENGTH,
      MAX_MOTION_BLUR_STRENGTH
    );
  }

  updateCameraEffectsFromInputs() {
    const updateActions = [
      () => this.updateCameraFieldOfViewFromInput(),
      () => this.updateCameraFocusDistanceFromInput(),
      () => this.updateCameraApertureFromInput(),
      () => this.updateMotionBlurFromInput()
    ];

    for (const updateAction of updateActions) {
      const [, updateError] = updateAction();
      if (updateError) {
        return returnFailure(updateError.code, updateError.message, updateError.details);
      }
    }

    return returnSuccess(undefined);
  }

  saveCameraShot(slotIndex) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= this.applicationState.cameraShots.length) {
      return returnFailure('invalid-camera-shot', 'Camera shot slot is not available.');
    }

    this.applicationState.cameraShots[slotIndex] = Object.freeze({
      cameraMode: normalizeCameraMode(this.applicationState.cameraMode),
      cameraAngleX: this.applicationState.cameraAngleX,
      cameraAngleY: this.applicationState.cameraAngleY,
      cameraDistance: this.applicationState.cameraDistance,
      fpsEyePosition: [
        this.applicationState.fpsEyePosition[0],
        this.applicationState.fpsEyePosition[1],
        this.applicationState.fpsEyePosition[2]
      ],
      cameraFieldOfViewDegrees: this.applicationState.cameraFieldOfViewDegrees,
      cameraFocusDistance: this.applicationState.cameraFocusDistance,
      cameraAperture: this.applicationState.cameraAperture,
      motionBlurStrength: this.applicationState.motionBlurStrength
    });
    return returnSuccess(undefined);
  }

  loadCameraShot(slotIndex) {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncAllControlsFromState();
    }

    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= this.applicationState.cameraShots.length) {
      return returnFailure('invalid-camera-shot', 'Camera shot slot is not available.');
    }

    const cameraShot = this.applicationState.cameraShots[slotIndex];
    if (!cameraShot) {
      return returnSuccess(undefined);
    }

    this.applicationState.cameraAngleX = cameraShot.cameraAngleX;
    this.applicationState.cameraAngleY = cameraShot.cameraAngleY;
    this.applicationState.cameraDistance = cameraShot.cameraDistance;
    this.applicationState.cameraMode = normalizeCameraMode(cameraShot.cameraMode);
    if (
      cameraShot.fpsEyePosition &&
      Number.isFinite(cameraShot.fpsEyePosition[0]) &&
      Number.isFinite(cameraShot.fpsEyePosition[1]) &&
      Number.isFinite(cameraShot.fpsEyePosition[2])
    ) {
      writeVec3(
        this.applicationState.fpsEyePosition,
        cameraShot.fpsEyePosition[0],
        cameraShot.fpsEyePosition[1],
        cameraShot.fpsEyePosition[2]
      );
    } else {
      writeOrbitEyePosition(
        this.applicationState.fpsEyePosition,
        this.applicationState.cameraAngleX,
        this.applicationState.cameraAngleY,
        this.applicationState.cameraDistance
      );
    }
    this.applicationState.cameraFieldOfViewDegrees = cameraShot.cameraFieldOfViewDegrees;
    this.applicationState.cameraFocusDistance = cameraShot.cameraFocusDistance;
    this.applicationState.cameraAperture = cameraShot.cameraAperture;
    this.applicationState.motionBlurStrength = cameraShot.motionBlurStrength;
    clearFpsMovementState(this.applicationState);
    if (this.applicationState.cameraMode === CAMERA_MODE_FPS) {
      this.applicationState.isCameraAutoRotating = false;
    } else {
      const [, pointerLockError] = this.exitPointerLock();
      if (pointerLockError) {
        return returnFailure(pointerLockError.code, pointerLockError.message, pointerLockError.details);
      }
    }
    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  applyQualityPreset(presetName) {
    const qualityPreset = QUALITY_PRESETS[presetName];
    if (!qualityPreset) {
      return returnFailure('invalid-quality-preset', 'Quality preset is not available.');
    }

    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncAllControlsFromState();
    }

    for (const stateKey of QUALITY_PRESET_STATE_KEYS) {
      this.applicationState[stateKey] = qualityPreset[stateKey];
    }
    this.applicationState.renderDebugViewMode = RENDER_DEBUG_VIEW.BEAUTY;
    this.applicationState.isConvergencePauseEnabled = false;
    this.applicationState.isConvergencePaused = false;

    const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }

    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    const [, scheduleError] = scheduleAnimationFrame(this.applicationState);
    if (scheduleError) {
      return returnFailure(scheduleError.code, scheduleError.message, scheduleError.details);
    }

    return returnSuccess(undefined);
  }

  loadPresetScene(presetName) {
    const sceneLoadStartMilliseconds = readCurrentMilliseconds();
    const presetFactory = scenePresetFactories[presetName];
    if (!presetFactory) {
      return returnFailure('unknown-preset', `Preset "${presetName}" is not available.`);
    }

    const [, cancelError] = this.cancelActivePointerInteraction();
    if (cancelError) {
      return returnFailure(cancelError.code, cancelError.message, cancelError.details);
    }

    const [, stopRunnerError] = this.stopBenchmarkRunner();
    if (stopRunnerError) {
      return returnFailure(stopRunnerError.code, stopRunnerError.message, stopRunnerError.details);
    }

    this.applicationState.isBenchmarkModeActive = false;
    this.applicationState.activeBenchmarkSceneName = null;
    const [, animationClearError] = clearSceneAnimation(this.applicationState);
    if (animationClearError) {
      return returnFailure(animationClearError.code, animationClearError.message, animationClearError.details);
    }
    const [, presetMetadataError] = applySceneMetadataGravityToState(
      this.applicationState,
      readScenePresetMetadata(presetName)
    );
    if (presetMetadataError) {
      return returnFailure(presetMetadataError.code, presetMetadataError.message, presetMetadataError.details);
    }

    const [sceneObjects, presetError] = createSceneObjectsFromFactory(
      presetName,
      presetFactory,
      this.applicationState,
      'Scene preset'
    );
    let nextSceneObjects = sceneObjects;
    if (presetError) {
      logSceneFactoryFailure('preset', 'Scene preset', presetName, presetError, ' Loading a blank scene instead.');
      const [emptySceneObjects, emptySceneError] = createEmptyScene(this.applicationState);
      if (emptySceneError) {
        return returnFailure(emptySceneError.code, emptySceneError.message, emptySceneError.details);
      }
      nextSceneObjects = emptySceneObjects;
    }

    const [, sceneSetError] = this.setSceneObjects(nextSceneObjects);
    if (sceneSetError) {
      return returnFailure(sceneSetError.code, sceneSetError.message, sceneSetError.details);
    }
    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }
    const [, frameScheduleError] = scheduleAnimationFrame(this.applicationState);
    if (frameScheduleError) {
      return returnFailure(frameScheduleError.code, frameScheduleError.message, frameScheduleError.details);
    }

    logDiagnostic('info', 'sceneLoad', 'Scene preset loaded.', Object.freeze({
      sceneKey: presetName,
      objectCount: nextSceneObjects.length,
      didRecoverToEmptyScene: Boolean(presetError),
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - sceneLoadStartMilliseconds)
    }));

    if (presetError) {
      return returnFailure(presetError.code, presetError.message, presetError.details);
    }
    return returnSuccess(undefined);
  }

  async loadPresetSceneAsync(presetName, options = Object.freeze({})) {
    const sceneLoadStartMilliseconds = readCurrentMilliseconds();
    const presetFactory = scenePresetFactories[presetName];
    if (!presetFactory) {
      return returnFailure('unknown-preset', `Preset "${presetName}" is not available.`);
    }

    const [, cancelError] = this.cancelActivePointerInteraction();
    if (cancelError) {
      return returnFailure(cancelError.code, cancelError.message, cancelError.details);
    }

    const [, stopRunnerError] = this.stopBenchmarkRunner();
    if (stopRunnerError) {
      return returnFailure(stopRunnerError.code, stopRunnerError.message, stopRunnerError.details);
    }

    this.applicationState.isBenchmarkModeActive = false;
    this.applicationState.activeBenchmarkSceneName = null;
    const [, animationClearError] = clearSceneAnimation(this.applicationState);
    if (animationClearError) {
      return returnFailure(animationClearError.code, animationClearError.message, animationClearError.details);
    }
    const [, presetMetadataError] = applySceneMetadataGravityToState(
      this.applicationState,
      readScenePresetMetadata(presetName)
    );
    if (presetMetadataError) {
      return returnFailure(presetMetadataError.code, presetMetadataError.message, presetMetadataError.details);
    }

    const [sceneObjects, presetError] = createSceneObjectsFromFactory(
      presetName,
      presetFactory,
      this.applicationState,
      'Scene preset'
    );
    let nextSceneObjects = sceneObjects;
    if (presetError) {
      logSceneFactoryFailure('preset', 'Scene preset', presetName, presetError, ' Loading a blank scene instead.');
      const [emptySceneObjects, emptySceneError] = createEmptyScene(this.applicationState);
      if (emptySceneError) {
        return returnFailure(emptySceneError.code, emptySceneError.message, emptySceneError.details);
      }
      nextSceneObjects = emptySceneObjects;
    }

    const [, sceneSetError] = await this.setSceneObjectsAsync(nextSceneObjects, options);
    if (sceneSetError) {
      return returnFailure(sceneSetError.code, sceneSetError.message, sceneSetError.details);
    }
    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }
    const [, frameScheduleError] = scheduleAnimationFrame(this.applicationState);
    if (frameScheduleError) {
      return returnFailure(frameScheduleError.code, frameScheduleError.message, frameScheduleError.details);
    }

    logDiagnostic('info', 'sceneLoad', 'Scene preset loaded.', Object.freeze({
      sceneKey: presetName,
      objectCount: nextSceneObjects.length,
      didRecoverToEmptyScene: Boolean(presetError),
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - sceneLoadStartMilliseconds),
      compileMode: 'parallel'
    }));

    if (presetError) {
      return returnFailure(presetError.code, presetError.message, presetError.details);
    }
    return returnSuccess(undefined);
  }

  loadBenchmarkScene(benchmarkSceneName) {
    const sceneLoadStartMilliseconds = readCurrentMilliseconds();
    const benchmarkScene = benchmarkScenes[benchmarkSceneName];
    if (!benchmarkScene) {
      return returnFailure('invalid-benchmark-scene', 'Benchmark scene is not available.');
    }

    const [, cancelError] = this.cancelActivePointerInteraction();
    if (cancelError) {
      return returnFailure(cancelError.code, cancelError.message, cancelError.details);
    }

    const [, settingsError] = applyBenchmarkSceneSettingsToState(
      this.applicationState,
      benchmarkScene.metadata,
      benchmarkSceneName
    );
    if (settingsError) {
      return returnFailure(settingsError.code, settingsError.message, settingsError.details);
    }

    const [sceneObjects, sceneError] = createSceneObjectsFromFactory(
      benchmarkSceneName,
      benchmarkScene.factory,
      this.applicationState,
      'Benchmark scene',
      true
    );
    if (sceneError) {
      return returnFailure(sceneError.code, sceneError.message, sceneError.details);
    }

    const [, sceneSetError] = this.setSceneObjects(lockBenchmarkSceneObjects(sceneObjects));
    if (sceneSetError) {
      return returnFailure(sceneSetError.code, sceneSetError.message, sceneSetError.details);
    }

    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    const [, benchmarkError] = this.selectionRenderer.pathTracer.resetBenchmark();
    if (benchmarkError) {
      return returnFailure(benchmarkError.code, benchmarkError.message, benchmarkError.details);
    }

    const [, frameScheduleError] = scheduleAnimationFrame(this.applicationState);
    if (frameScheduleError) {
      return returnFailure(frameScheduleError.code, frameScheduleError.message, frameScheduleError.details);
    }

    logDiagnostic('info', 'sceneLoad', 'Benchmark scene loaded.', Object.freeze({
      sceneKey: benchmarkSceneName,
      objectCount: sceneObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - sceneLoadStartMilliseconds)
    }));

    return this.selectionRenderer.pathTracer.clearSamples();
  }

  async loadBenchmarkSceneAsync(benchmarkSceneName, options = Object.freeze({})) {
    const sceneLoadStartMilliseconds = readCurrentMilliseconds();
    const benchmarkScene = benchmarkScenes[benchmarkSceneName];
    if (!benchmarkScene) {
      return returnFailure('invalid-benchmark-scene', 'Benchmark scene is not available.');
    }

    const [, cancelError] = this.cancelActivePointerInteraction();
    if (cancelError) {
      return returnFailure(cancelError.code, cancelError.message, cancelError.details);
    }

    const [, settingsError] = applyBenchmarkSceneSettingsToState(
      this.applicationState,
      benchmarkScene.metadata,
      benchmarkSceneName
    );
    if (settingsError) {
      return returnFailure(settingsError.code, settingsError.message, settingsError.details);
    }

    const [sceneObjects, sceneError] = createSceneObjectsFromFactory(
      benchmarkSceneName,
      benchmarkScene.factory,
      this.applicationState,
      'Benchmark scene',
      true
    );
    if (sceneError) {
      return returnFailure(sceneError.code, sceneError.message, sceneError.details);
    }

    const [, sceneSetError] = await this.setSceneObjectsAsync(lockBenchmarkSceneObjects(sceneObjects), options);
    if (sceneSetError) {
      return returnFailure(sceneSetError.code, sceneSetError.message, sceneSetError.details);
    }

    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    const [, benchmarkError] = this.selectionRenderer.pathTracer.resetBenchmark();
    if (benchmarkError) {
      return returnFailure(benchmarkError.code, benchmarkError.message, benchmarkError.details);
    }

    const [, frameScheduleError] = scheduleAnimationFrame(this.applicationState);
    if (frameScheduleError) {
      return returnFailure(frameScheduleError.code, frameScheduleError.message, frameScheduleError.details);
    }

    logDiagnostic('info', 'sceneLoad', 'Benchmark scene loaded.', Object.freeze({
      sceneKey: benchmarkSceneName,
      objectCount: sceneObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - sceneLoadStartMilliseconds),
      compileMode: 'parallel'
    }));

    return this.selectionRenderer.pathTracer.clearSamples();
  }

  readParticleFluidSettingsFromControls() {
    const documentObject = this.canvasElement.ownerDocument;
    const particleCountInput = readOptionalElement(documentObject, 'particle-fluid-count');
    const particleRadiusInput = readOptionalElement(documentObject, 'particle-fluid-radius');
    const particleStiffnessInput = readOptionalElement(documentObject, 'particle-fluid-stiffness');
    if (
      !(particleCountInput instanceof HTMLInputElement) ||
      !(particleRadiusInput instanceof HTMLInputElement) ||
      !(particleStiffnessInput instanceof HTMLInputElement)
    ) {
      return returnFailure('missing-particle-fluid-controls', 'Particle fluid controls are not available.');
    }

    const [particleCount, countError] = parseBoundedInteger(
      particleCountInput.value,
      DEFAULT_PARTICLE_FLUID_PARTICLE_COUNT,
      MIN_PARTICLE_FLUID_PARTICLE_COUNT,
      MAX_PARTICLE_FLUID_PARTICLE_COUNT
    );
    if (countError) {
      return returnFailure(countError.code, countError.message, countError.details);
    }

    const [radius, radiusError] = parseBoundedNumber(
      particleRadiusInput.value,
      DEFAULT_PARTICLE_FLUID_RADIUS,
      MIN_PARTICLE_FLUID_RADIUS,
      MAX_PARTICLE_FLUID_RADIUS
    );
    if (radiusError) {
      return returnFailure(radiusError.code, radiusError.message, radiusError.details);
    }

    const [springStiffness, stiffnessError] = parseBoundedNumber(
      particleStiffnessInput.value,
      DEFAULT_PARTICLE_FLUID_SPRING_STIFFNESS,
      MIN_PARTICLE_FLUID_SPRING_STIFFNESS,
      MAX_PARTICLE_FLUID_SPRING_STIFFNESS
    );
    if (stiffnessError) {
      return returnFailure(stiffnessError.code, stiffnessError.message, stiffnessError.details);
    }

    const particleFluidSettings = normalizeParticleFluidSettings({ particleCount, radius, springStiffness });
    this.applicationState.particleFluidSettings = particleFluidSettings;
    particleCountInput.value = String(particleFluidSettings.particleCount);
    particleRadiusInput.value = particleFluidSettings.radius.toFixed(3);
    particleStiffnessInput.value = String(Math.round(particleFluidSettings.springStiffness));
    return returnSuccess(particleFluidSettings);
  }

  syncParticleFluidBenchmarkControls() {
    const documentObject = this.canvasElement.ownerDocument;
    const controlsElement = readOptionalElement(documentObject, 'particle-fluid-controls');
    const particleCountInput = readOptionalElement(documentObject, 'particle-fluid-count');
    const particleRadiusInput = readOptionalElement(documentObject, 'particle-fluid-radius');
    const particleStiffnessInput = readOptionalElement(documentObject, 'particle-fluid-stiffness');
    if (
      !(controlsElement instanceof HTMLElement) ||
      !(particleCountInput instanceof HTMLInputElement) ||
      !(particleRadiusInput instanceof HTMLInputElement) ||
      !(particleStiffnessInput instanceof HTMLInputElement)
    ) {
      return returnSuccess(undefined);
    }

    controlsElement.hidden = this.applicationState.activeBenchmarkSceneName !== 'benchmarkParticleFluid';
    const particleFluidSettings = readApplicationStateParticleFluidSettings(this.applicationState);
    particleCountInput.value = String(particleFluidSettings.particleCount);
    particleRadiusInput.value = particleFluidSettings.radius.toFixed(3);
    particleStiffnessInput.value = String(Math.round(particleFluidSettings.springStiffness));
    return returnSuccess(undefined);
  }

  applyParticleFluidSettingsFromControls() {
    const documentObject = this.canvasElement.ownerDocument;
    const [particleFluidSettings, settingsError] = this.readParticleFluidSettingsFromControls();
    if (settingsError) {
      return returnFailure(settingsError.code, settingsError.message, settingsError.details);
    }

    const [, loadingError] = updateLoadingStatus(
      documentObject,
      `Reloading particle fluid: ${particleFluidSettings.particleCount} particles...`
    );
    if (loadingError) {
      return returnFailure(loadingError.code, loadingError.message, loadingError.details);
    }

    const [, stopRunnerError] = this.stopBenchmarkRunner();
    if (stopRunnerError) {
      return returnFailure(stopRunnerError.code, stopRunnerError.message, stopRunnerError.details);
    }

    const [, sceneError] = this.loadBenchmarkScene('benchmarkParticleFluid');
    if (sceneError) {
      return returnFailure(sceneError.code, sceneError.message, sceneError.details);
    }
    return queueLoadingOverlayDismiss(documentObject);
  }

  startBenchmarkRunner() {
    return this.benchmarkRunner.start(performance.now());
  }

  stopBenchmarkRunner() {
    return this.benchmarkRunner.stop();
  }

  advanceBenchmarkRunner(currentTimeMilliseconds, benchmarkSnapshot) {
    return this.benchmarkRunner.advance(currentTimeMilliseconds, benchmarkSnapshot);
  }

  copyBenchmarkResults() {
    return this.benchmarkRunner.copyResults();
  }

  saveBenchmarkBaseline() {
    return this.benchmarkRunner.saveBaseline();
  }

  shareBenchmarkResults() {
    return this.benchmarkRunner.shareResultsUrl();
  }

  saveBenchmarkScoreCard() {
    return this.benchmarkRunner.saveScoreCardPng();
  }

  loadSharedBenchmarkResults() {
    return this.benchmarkRunner.loadSharedResultsFromHash();
  }

  syncFocusPickMode() {
    this.canvasElement.classList.toggle('focus-pick-mode', this.applicationState.isPickingFocus);
    const [, buttonError] = updateFocusPickButton(this.focusPickButton, this.applicationState.isPickingFocus);
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }
    return returnSuccess(undefined);
  }

  toggleFocusPickMode() {
    this.applicationState.isPickingFocus = !this.applicationState.isPickingFocus;
    this.applicationState.isRotatingCamera = false;
    this.isMovingSelection = false;
    return this.syncFocusPickMode();
  }

  updateFocusDistanceFromSceneHit(focusDistance) {
    const nextFocusDistance = normalizeBoundedNumber(
      focusDistance,
      DEFAULT_CAMERA_FOCUS_DISTANCE,
      MIN_CAMERA_FOCUS_DISTANCE,
      MAX_CAMERA_FOCUS_DISTANCE
    );

    this.applicationState.cameraFocusDistance = nextFocusDistance;
    this.cameraFocusDistanceInput.value = nextFocusDistance.toFixed(2);
    this.cameraFocusDistanceValueElement.textContent = formatCameraEffectValue(nextFocusDistance);
    const [, clearError] = this.selectionRenderer.pathTracer.clearSamples();
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }
    return returnSuccess(undefined);
  }

  handleFocusPick(xPosition, yPosition) {
    const originPosition = this.applicationState.eyePosition;
    const rayDirection = this.pointerRayDirection;
    writeEyeRayVector(
      rayDirection,
      this.inverseModelviewProjectionMatrix,
      (xPosition / CANVAS_RENDER_WIDTH) * 2 - 1,
      1 - (yPosition / CANVAS_RENDER_HEIGHT) * 2,
      originPosition
    );
    let closestDistance = MAX_INTERSECTION_DISTANCE;

    for (const sceneObject of this.sceneObjects) {
      const [objectDistance, objectDistanceError] = sceneObject.intersectRay(originPosition, rayDirection);
      if (objectDistanceError) {
        return returnFailure(objectDistanceError.code, objectDistanceError.message, objectDistanceError.details);
      }

      if (objectDistance < closestDistance) {
        closestDistance = objectDistance;
      }
    }

    if (closestDistance >= MAX_INTERSECTION_DISTANCE) {
      return returnSuccess(false);
    }

    const focusDistance = lengthVec3(rayDirection) * closestDistance;
    const [, focusError] = this.updateFocusDistanceFromSceneHit(focusDistance);
    if (focusError) {
      return returnFailure(focusError.code, focusError.message, focusError.details);
    }

    this.applicationState.isPickingFocus = false;
    const [, syncError] = this.syncFocusPickMode();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    return returnSuccess(true);
  }

  updateColorCorrectionControlFromInput(
    inputElement,
    valueElement,
    stateKey,
    fallbackValue,
    minValue,
    maxValue,
    formatValue
  ) {
    if (this.applicationState.isBenchmarkModeActive) {
      return this.syncColorCorrectionControlFromState(
        inputElement,
        valueElement,
        this.applicationState[stateKey],
        formatValue
      );
    }

    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatValue(nextValue);
    this.applicationState[stateKey] = nextValue;
    return returnSuccess(undefined);
  }

  syncColorCorrectionControlFromState(inputElement, valueElement, value, formatValue) {
    const nextInputValue = value.toFixed(2);
    if (inputElement.value !== nextInputValue) {
      inputElement.value = nextInputValue;
    }
    const [, textError] = writeElementTextIfChanged(valueElement, formatValue(value));
    if (textError) {
      return returnFailure(textError.code, textError.message, textError.details);
    }
    return returnSuccess(undefined);
  }

  syncToneMappingSelectFromState() {
    const nextValue = String(normalizeToneMappingMode(this.applicationState.toneMappingMode));
    if (this.toneMappingSelect.value !== nextValue) {
      this.toneMappingSelect.value = nextValue;
    }
    return returnSuccess(undefined);
  }

  updateColorExposureFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorExposureInput,
      this.colorExposureValueElement,
      'colorExposure',
      DEFAULT_COLOR_EXPOSURE,
      MIN_COLOR_EXPOSURE,
      MAX_COLOR_EXPOSURE,
      formatSignedColorAdjustmentValue
    );
  }

  updateColorBrightnessFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorBrightnessInput,
      this.colorBrightnessValueElement,
      'colorBrightness',
      DEFAULT_COLOR_BRIGHTNESS,
      MIN_COLOR_BRIGHTNESS,
      MAX_COLOR_BRIGHTNESS,
      formatSignedColorAdjustmentValue
    );
  }

  updateColorContrastFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorContrastInput,
      this.colorContrastValueElement,
      'colorContrast',
      DEFAULT_COLOR_CONTRAST,
      MIN_COLOR_CONTRAST,
      MAX_COLOR_CONTRAST,
      formatColorAdjustmentValue
    );
  }

  updateColorSaturationFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorSaturationInput,
      this.colorSaturationValueElement,
      'colorSaturation',
      DEFAULT_COLOR_SATURATION,
      MIN_COLOR_SATURATION,
      MAX_COLOR_SATURATION,
      formatColorAdjustmentValue
    );
  }

  updateColorGammaFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorGammaInput,
      this.colorGammaValueElement,
      'colorGamma',
      DEFAULT_COLOR_GAMMA,
      MIN_COLOR_GAMMA,
      MAX_COLOR_GAMMA,
      formatColorAdjustmentValue
    );
  }

  updateToneMappingFromSelect() {
    const [toneMappingMode, parseError] = parseToneMappingMode(this.toneMappingSelect.value);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }
    this.toneMappingSelect.value = String(toneMappingMode);
    this.applicationState.toneMappingMode = toneMappingMode;
    return returnSuccess(undefined);
  }

  updateColorCorrectionFromInputs() {
    const updateActions = [
      () => this.updateColorExposureFromInput(),
      () => this.updateColorBrightnessFromInput(),
      () => this.updateColorContrastFromInput(),
      () => this.updateColorSaturationFromInput(),
      () => this.updateColorGammaFromInput(),
      () => this.updateToneMappingFromSelect()
    ];

    for (const updateAction of updateActions) {
      const [, updateError] = updateAction();
      if (updateError) {
        return returnFailure(updateError.code, updateError.message, updateError.details);
      }
    }

    return returnSuccess(undefined);
  }

  resetColorCorrection() {
    this.applicationState.colorExposure = DEFAULT_COLOR_EXPOSURE;
    this.applicationState.colorBrightness = DEFAULT_COLOR_BRIGHTNESS;
    this.applicationState.colorContrast = DEFAULT_COLOR_CONTRAST;
    this.applicationState.colorSaturation = DEFAULT_COLOR_SATURATION;
    this.applicationState.colorGamma = DEFAULT_COLOR_GAMMA;
    this.applicationState.toneMappingMode = DEFAULT_TONE_MAPPING_MODE;

    const syncActions = [
      () => this.syncColorCorrectionControlFromState(
        this.colorExposureInput,
        this.colorExposureValueElement,
        this.applicationState.colorExposure,
        formatSignedColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorBrightnessInput,
        this.colorBrightnessValueElement,
        this.applicationState.colorBrightness,
        formatSignedColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorContrastInput,
        this.colorContrastValueElement,
        this.applicationState.colorContrast,
        formatColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorSaturationInput,
        this.colorSaturationValueElement,
        this.applicationState.colorSaturation,
        formatColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorGammaInput,
        this.colorGammaValueElement,
        this.applicationState.colorGamma,
        formatColorAdjustmentValue
      ),
      () => this.syncToneMappingSelectFromState()
    ];

    for (const syncAction of syncActions) {
      const [, syncError] = syncAction();
      if (syncError) {
        return returnFailure(syncError.code, syncError.message, syncError.details);
      }
    }

    return returnSuccess(undefined);
  }

  applyResolutionFromControls() {
    const [nextRenderResolution, renderResolutionError] = this.readRenderResolutionFromControls();
    if (renderResolutionError) {
      return returnFailure(renderResolutionError.code, renderResolutionError.message, renderResolutionError.details);
    }

    const nextRenderScale = this.readRenderScaleFromInput();
    const [, syncError] = this.syncResolutionControlValues(
      nextRenderResolution.width,
      nextRenderResolution.height,
      nextRenderScale
    );
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    if (nextRenderResolution.width === CANVAS_RENDER_WIDTH && nextRenderResolution.height === CANVAS_RENDER_HEIGHT) {
      return writeElementTextIfChanged(this.exportStatusElement, `${CANVAS_RENDER_RESOLUTION_LABEL} render target`);
    }

    const windowObject = this.canvasElement.ownerDocument.defaultView;
    if (!windowObject || !windowObject.location || !windowObject.URL || !windowObject.URLSearchParams) {
      return returnFailure('resolution-reload-unavailable', 'Resolution changes require browser URL support.');
    }

    const nextUrl = new windowObject.URL(windowObject.location.href);
    nextUrl.searchParams.delete('resolution');
    nextUrl.searchParams.set('renderWidth', String(nextRenderResolution.width));
    nextUrl.searchParams.set('renderHeight', String(nextRenderResolution.height));
    nextUrl.searchParams.set('renderScale', formatRenderScaleNumber(nextRenderScale));
    writeElementTextIfChanged(
      this.exportStatusElement,
      `Reloading at ${formatRenderResolution(nextRenderResolution.width, nextRenderResolution.height)}...`
    );
    windowObject.location.href = nextUrl.href;
    return returnSuccess(undefined);
  }

  readCanvasDisplaySize() {
    const stageElement = this.canvasElement.parentElement;
    const stageBounds = stageElement && typeof stageElement.getBoundingClientRect === 'function'
      ? stageElement.getBoundingClientRect()
      : null;
    const displayWidth = stageBounds && stageBounds.width > 0 ? stageBounds.width : this.canvasElement.clientWidth;
    const displayHeight = stageBounds && stageBounds.height > 0 ? stageBounds.height : this.canvasElement.clientHeight;
    return {
      width: displayWidth > 0 ? displayWidth : CANVAS_RENDER_WIDTH,
      height: displayHeight > 0 ? displayHeight : CANVAS_RENDER_HEIGHT
    };
  }

  readRenderScaleModeFromInput() {
    return normalizeRenderScaleMode(this.renderScaleModeSelect.value);
  }

  readRenderScaleModeForScale(renderScale) {
    const selectedRenderScaleMode = this.readRenderScaleModeFromInput();
    const selectedScaleOptions = readRenderScaleOptionsForMode(selectedRenderScaleMode);
    const parsedScale = Number.parseFloat(renderScale);
    const fitsSelectedMode = selectedScaleOptions.some((scaleOption) => (
      Math.abs(scaleOption - parsedScale) <= Number.EPSILON
    ));
    if (fitsSelectedMode) {
      return selectedRenderScaleMode;
    }
    const maximumFractionalScale = RENDER_SCALE_FRACTIONAL_OPTIONS[RENDER_SCALE_FRACTIONAL_OPTIONS.length - 1];
    return Number.isFinite(parsedScale) && parsedScale > maximumFractionalScale
      ? RENDER_SCALE_MODE_PIXEL_PERFECT
      : RENDER_SCALE_MODE_FRACTIONAL;
  }

  syncRenderScaleSliderControl(renderScaleMode, displaySize, renderScale) {
    const nextRenderScaleMode = normalizeRenderScaleMode(renderScaleMode);
    const maximumRenderScale = readMaximumRenderScaleForCanvas(displaySize);
    const safeScaleOptions = readRenderScaleOptionsForMode(nextRenderScaleMode).filter((scale) => (
      scale >= MIN_RENDER_SCALE &&
      scale <= maximumRenderScale + Number.EPSILON
    ));
    const fallbackScaleOptions = safeScaleOptions.length > 0 ? safeScaleOptions : [MIN_RENDER_SCALE];
    const minimumScale = fallbackScaleOptions[0];
    const maximumScale = fallbackScaleOptions[fallbackScaleOptions.length - 1];

    this.renderScaleModeSelect.value = nextRenderScaleMode;
    this.renderScaleInput.min = formatRenderScaleNumber(minimumScale);
    this.renderScaleInput.max = formatRenderScaleNumber(maximumScale);
    this.renderScaleInput.step = nextRenderScaleMode === RENDER_SCALE_MODE_PIXEL_PERFECT ? '1' : '0.25';
    this.renderScaleInput.setAttribute(
      'list',
      nextRenderScaleMode === RENDER_SCALE_MODE_PIXEL_PERFECT
        ? 'render-scale-pixel-perfect-ticks'
        : 'render-scale-fractional-ticks'
    );
    this.renderScaleInput.setAttribute('aria-valuetext', formatRenderScaleValue(renderScale));
  }

  readRenderScaleFromInput() {
    return normalizeRenderScale(
      this.renderScaleInput.value,
      this.readCanvasDisplaySize(),
      this.readRenderScaleModeFromInput()
    );
  }

  readRenderResolutionFromControls() {
    if (this.resolutionPresetSelect.value !== 'custom') {
      const presetSize = normalizeCanvasSize(this.resolutionPresetSelect.value);
      return returnSuccess({ width: presetSize, height: presetSize });
    }

    return returnSuccess({
      width: normalizeCustomCanvasDimension(this.customRenderWidthInput.value, CANVAS_RENDER_WIDTH),
      height: normalizeCustomCanvasDimension(this.customRenderHeightInput.value, CANVAS_RENDER_HEIGHT)
    });
  }

  readScaledRenderResolution(renderScale) {
    return deriveRenderResolutionForScale(renderScale, this.readCanvasDisplaySize());
  }

  syncResolutionControlValues(renderWidth, renderHeight, renderScale) {
    const displaySize = this.readCanvasDisplaySize();
    const nextRenderScaleMode = this.readRenderScaleModeForScale(renderScale);
    const nextRenderScale = normalizeRenderScale(renderScale, displaySize, nextRenderScaleMode);
    const nextRenderScaleValue = formatRenderScaleNumber(nextRenderScale);
    this.syncRenderScaleSliderControl(nextRenderScaleMode, displaySize, nextRenderScale);
    if (this.renderScaleInput.value !== nextRenderScaleValue) {
      this.renderScaleInput.value = nextRenderScaleValue;
    }
    this.customRenderWidthInput.value = String(renderWidth);
    this.customRenderHeightInput.value = String(renderHeight);
    this.resolutionPresetSelect.value = renderWidth === renderHeight && CANVAS_SIZE_PRESETS.includes(renderWidth)
      ? String(renderWidth)
      : 'custom';

    const renderResolutionLabel = formatRenderResolution(renderWidth, renderHeight);
    const canvasResolutionLabel = formatRenderResolution(Math.round(displaySize.width), Math.round(displaySize.height));
    const uiCanvasSize = deriveContainedUiCanvasSize(renderWidth, renderHeight, displaySize);
    const uiResolutionLabel = formatRenderResolution(uiCanvasSize.width, uiCanvasSize.height);

    const [, scaleValueError] = writeElementTextIfChanged(
      this.renderScaleValueElement,
      formatRenderScaleValue(nextRenderScale)
    );
    if (scaleValueError) {
      return returnFailure(scaleValueError.code, scaleValueError.message, scaleValueError.details);
    }

    const [, scaleResolutionError] = writeElementTextIfChanged(
      this.renderScaleResolutionElement,
      `${renderResolutionLabel} render target`
    );
    if (scaleResolutionError) {
      return returnFailure(scaleResolutionError.code, scaleResolutionError.message, scaleResolutionError.details);
    }

    const [, canvasResolutionError] = writeElementTextIfChanged(
      this.uiCanvasResolutionElement,
      `Canvas: ${canvasResolutionLabel} CSS px - UI: ${uiResolutionLabel} CSS px`
    );
    if (canvasResolutionError) {
      return returnFailure(canvasResolutionError.code, canvasResolutionError.message, canvasResolutionError.details);
    }

    return writeElementTextIfChanged(this.exportStatusElement, `${renderResolutionLabel} render target`);
  }

  updateRenderScalePreviewFromInput() {
    const renderScale = this.readRenderScaleFromInput();
    const renderResolution = this.readScaledRenderResolution(renderScale);
    this.resolutionPresetSelect.value = 'custom';
    return this.syncResolutionControlValues(renderResolution.width, renderResolution.height, renderScale);
  }

  updateCustomRenderResolutionPreview() {
    const renderWidth = normalizeCustomCanvasDimension(this.customRenderWidthInput.value, CANVAS_RENDER_WIDTH);
    const renderHeight = normalizeCustomCanvasDimension(this.customRenderHeightInput.value, CANVAS_RENDER_HEIGHT);
    const renderScale = estimateRenderScaleForResolution(renderWidth, renderHeight, this.readCanvasDisplaySize());
    return this.syncResolutionControlValues(renderWidth, renderHeight, renderScale);
  }

  applyResolutionPreset(renderSize) {
    const nextCanvasSize = normalizeCanvasSize(renderSize);
    const renderScale = estimateRenderScaleForResolution(nextCanvasSize, nextCanvasSize, this.readCanvasDisplaySize());
    return this.syncResolutionControlValues(nextCanvasSize, nextCanvasSize, renderScale);
  }

  saveCanvasBitmap() {
    const documentObject = this.canvasElement.ownerDocument;
    const windowObject = documentObject.defaultView;
    if (!windowObject || typeof this.canvasElement.toBlob !== 'function') {
      return returnFailure('bitmap-export-unavailable', 'Canvas bitmap export is not available in this browser.');
    }

    writeElementTextIfChanged(this.exportStatusElement, 'Saving PNG...');
    const [, cleanRenderError] = this.selectionRenderer.render(this.applicationState, false);
    if (cleanRenderError) {
      return returnFailure(cleanRenderError.code, cleanRenderError.message, cleanRenderError.details);
    }

    this.canvasElement.toBlob((blob) => {
      if (!blob) {
        writeElementTextIfChanged(this.exportStatusElement, 'PNG export failed.');
        return;
      }
      const downloadLink = documentObject.createElement('a');
      const objectUrl = windowObject.URL.createObjectURL(blob);
      downloadLink.href = objectUrl;
      downloadLink.download = `pathtracer-${CANVAS_RENDER_WIDTH}x${CANVAS_RENDER_HEIGHT}.png`;
      documentObject.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      windowObject.URL.revokeObjectURL(objectUrl);
      const [, outlineRestoreError] = this.selectionRenderer.render(this.applicationState, true);
      if (outlineRestoreError) {
        writeElementTextIfChanged(this.exportStatusElement, 'Saved PNG; selection redraw failed.');
        return;
      }
      writeElementTextIfChanged(this.exportStatusElement, `Saved ${CANVAS_RENDER_RESOLUTION_LABEL} PNG`);
    }, 'image/png');

    return returnSuccess(undefined);
  }

  saveSceneJson() {
    const documentObject = this.canvasElement.ownerDocument;
    const windowObject = documentObject.defaultView;
    if (
      !windowObject ||
      typeof windowObject.Blob !== 'function' ||
      !windowObject.URL ||
      typeof windowObject.URL.createObjectURL !== 'function'
    ) {
      return returnFailure('scene-export-unavailable', 'Scene JSON export is not available in this browser.');
    }

    const sceneSnapshot = createSceneSnapshot(this.applicationState, this.sceneObjects);
    const serializedScene = JSON.stringify(sceneSnapshot, null, 2);
    const blob = new windowObject.Blob([serializedScene], { type: 'application/json' });
    const objectUrl = windowObject.URL.createObjectURL(blob);
    const downloadLink = documentObject.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = createSceneSnapshotFileName();
    documentObject.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    windowObject.URL.revokeObjectURL(objectUrl);
    return writeElementTextIfChanged(
      this.exportStatusElement,
      `Saved scene JSON (${sceneSnapshot.objects.length} items)`
    );
  }

  loadSceneSnapshot(sceneSnapshot) {
    const sceneLoadStartMilliseconds = readCurrentMilliseconds();
    const documentObject = this.canvasElement.ownerDocument;
    const [, loadingError] = updateLoadingStatus(documentObject, 'Loading scene JSON and compiling shaders...');
    if (loadingError) {
      return returnFailure(loadingError.code, loadingError.message, loadingError.details);
    }

    const [, defaultedFieldLogError] = logSceneSnapshotDefaultedFields(sceneSnapshot);
    if (defaultedFieldLogError) {
      return returnFailure(
        defaultedFieldLogError.code,
        defaultedFieldLogError.message,
        defaultedFieldLogError.details
      );
    }

    const [, cancelError] = this.cancelActivePointerInteraction();
    if (cancelError) {
      return returnFailure(cancelError.code, cancelError.message, cancelError.details);
    }

    const [, stopRunnerError] = this.stopBenchmarkRunner();
    if (stopRunnerError) {
      return returnFailure(stopRunnerError.code, stopRunnerError.message, stopRunnerError.details);
    }

    const [, stateError] = this.resetApplicationStateToDefaults();
    if (stateError) {
      return returnFailure(stateError.code, stateError.message, stateError.details);
    }

    const [, settingsError] = applySceneSnapshotSettingsToState(this.applicationState, sceneSnapshot);
    if (settingsError) {
      return returnFailure(settingsError.code, settingsError.message, settingsError.details);
    }

    const [, lightTranslationError] = this.lightObject.setTemporaryTranslation(ORIGIN_VECTOR);
    if (lightTranslationError) {
      return returnFailure(lightTranslationError.code, lightTranslationError.message, lightTranslationError.details);
    }

    this.clearSceneSelection();
    this.isMovingSelection = false;
    this.previousCameraAngleX = Number.NaN;
    this.previousCameraAngleY = Number.NaN;
    this.previousCameraDistance = Number.NaN;
    this.previousCameraFieldOfViewDegrees = Number.NaN;

    const sceneObjects = createSceneObjectsFromSnapshot(this.applicationState, sceneSnapshot.objects);
    const [, sceneSetError] = this.setSceneObjects(sceneObjects);
    if (sceneSetError) {
      return returnFailure(sceneSetError.code, sceneSetError.message, sceneSetError.details);
    }

    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    const [, benchmarkError] = this.selectionRenderer.pathTracer.resetBenchmark();
    if (benchmarkError) {
      return returnFailure(benchmarkError.code, benchmarkError.message, benchmarkError.details);
    }

    const [, clearError] = this.selectionRenderer.pathTracer.clearSamples();
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }

    const [, statusError] = writeElementTextIfChanged(
      this.exportStatusElement,
      `Loaded scene JSON (${sceneObjects.length} items)`
    );
    if (statusError) {
      return returnFailure(statusError.code, statusError.message, statusError.details);
    }

    const [, dismissError] = queueLoadingOverlayDismiss(documentObject);
    if (dismissError) {
      return returnFailure(dismissError.code, dismissError.message, dismissError.details);
    }

    logDiagnostic('info', 'sceneLoad', 'Scene JSON loaded.', Object.freeze({
      objectCount: sceneObjects.length,
      durationMilliseconds: roundDiagnosticMilliseconds(readCurrentMilliseconds() - sceneLoadStartMilliseconds)
    }));

    return scheduleAnimationFrame(this.applicationState);
  }

  loadSceneJsonText(jsonText) {
    const [sceneSnapshot, parseError] = parseSceneSnapshotJson(jsonText);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }
    return this.loadSceneSnapshot(sceneSnapshot);
  }

  loadSceneJsonFromPicker() {
    const documentObject = this.canvasElement.ownerDocument;
    const windowObject = documentObject.defaultView;
    if (!windowObject || typeof windowObject.FileReader !== 'function') {
      return returnFailure('scene-import-unavailable', 'Scene JSON import is not available in this browser.');
    }

    const fileInput = documentObject.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    const removeFileInput = () => {
      if (fileInput.parentNode) {
        fileInput.parentNode.removeChild(fileInput);
      }
    };

    fileInput.addEventListener('change', () => {
      const selectedFile = fileInput.files && fileInput.files[0];
      if (!selectedFile) {
        removeFileInput();
        return;
      }

      writeElementTextIfChanged(this.exportStatusElement, 'Loading scene JSON...');
      const fileReader = new windowObject.FileReader();
      fileReader.onload = () => {
        removeFileInput();
        const [, loadError] = this.loadSceneJsonText(String(fileReader.result || ''));
        if (loadError) {
          writeElementTextIfChanged(this.exportStatusElement, `Scene JSON load failed: ${loadError.message}`);
        }
      };
      fileReader.onerror = () => {
        removeFileInput();
        writeElementTextIfChanged(this.exportStatusElement, 'Scene JSON load failed.');
      };
      fileReader.readAsText(selectedFile);
    });

    documentObject.body.appendChild(fileInput);
    fileInput.click();
    return returnSuccess(undefined);
  }

  getActionToggleButtons(actionName) {
    const cachedToggleButtons = this.actionToggleButtonCache.get(actionName);
    if (cachedToggleButtons) {
      return cachedToggleButtons;
    }

    const toggleButtons = [];
    const documentObject = this.canvasElement.ownerDocument;
    for (const toggleButton of documentObject.querySelectorAll(`button[data-action="${actionName}"]`)) {
      if (toggleButton instanceof HTMLButtonElement) {
        toggleButtons.push(toggleButton);
      }
    }
    this.actionToggleButtonCache.set(actionName, toggleButtons);
    return toggleButtons;
  }

  syncFullscreenCanvasButton() {
    const documentObject = this.canvasElement.ownerDocument;
    const fullscreenElement = documentObject.fullscreenElement;
    const isManagedFullscreen = fullscreenElement === this.canvasElement || fullscreenElement === this.appShellElement;
    const buttonLabel = isManagedFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
    const ariaLabel = isManagedFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    const fullscreenButtons = this.getActionToggleButtons('toggle-canvas-fullscreen');

    for (const fullscreenButton of fullscreenButtons) {
      fullscreenButton.setAttribute('aria-pressed', isManagedFullscreen ? 'true' : 'false');
      fullscreenButton.setAttribute('aria-label', ariaLabel);
      fullscreenButton.title = buttonLabel;
      if (fullscreenButton.classList.contains('menu-quick-action')) {
        fullscreenButton.dataset.tooltip = buttonLabel;
        continue;
      }

      const labelElement = fullscreenButton.querySelector('[data-fullscreen-label]');
      if (labelElement) {
        labelElement.textContent = buttonLabel;
      } else {
        fullscreenButton.textContent = buttonLabel;
      }
    }

    return returnSuccess(undefined);
  }

  syncFullscreenPanelsButton() {
    const stateLabel = this.shouldShowPanelsInFullscreen ? 'On' : 'Off';
    const tooltipLabel = this.shouldShowPanelsInFullscreen
      ? 'Panels show in fullscreen'
      : 'Canvas-only fullscreen';
    const fullscreenPanelButtons = this.getActionToggleButtons('toggle-fullscreen-panels');

    for (const fullscreenPanelButton of fullscreenPanelButtons) {
      fullscreenPanelButton.setAttribute('aria-pressed', this.shouldShowPanelsInFullscreen ? 'true' : 'false');
      fullscreenPanelButton.setAttribute('aria-label', tooltipLabel);
      fullscreenPanelButton.title = tooltipLabel;
      if (fullscreenPanelButton.classList.contains('menu-quick-action')) {
        fullscreenPanelButton.dataset.tooltip = tooltipLabel;
        continue;
      }

      const shortcutElement = fullscreenPanelButton.querySelector('.menu-shortcut');
      if (shortcutElement) {
        shortcutElement.textContent = stateLabel;
      }
    }

    return returnSuccess(undefined);
  }

  showBenchmarkForPanelFullscreen() {
    const benchmarkElement = this.canvasElement.ownerDocument.getElementById('benchmark');
    if (benchmarkElement instanceof HTMLElement) {
      benchmarkElement.hidden = false;
      benchmarkElement.classList.remove('is-collapsed');
    }
    return returnSuccess(undefined);
  }

  toggleFullscreenPanels() {
    this.shouldShowPanelsInFullscreen = !this.shouldShowPanelsInFullscreen;
    const [, syncError] = this.syncFullscreenPanelsButton();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    const documentObject = this.canvasElement.ownerDocument;
    if (documentObject.fullscreenElement === this.canvasElement || documentObject.fullscreenElement === this.appShellElement) {
      return writeElementTextIfChanged(
        this.exportStatusElement,
        'Exit and re-enter fullscreen to apply panel mode.'
      );
    }

    return writeElementTextIfChanged(
      this.exportStatusElement,
      this.shouldShowPanelsInFullscreen ? 'Fullscreen panels on.' : 'Canvas-only fullscreen.'
    );
  }

  toggleCanvasFullscreen() {
    const documentObject = this.canvasElement.ownerDocument;
    if (documentObject.fullscreenElement === this.canvasElement || documentObject.fullscreenElement === this.appShellElement) {
      if (typeof documentObject.exitFullscreen !== 'function') {
        return returnFailure('fullscreen-unavailable', 'Fullscreen exit is not available in this browser.');
      }

      const fullscreenExit = documentObject.exitFullscreen();
      if (fullscreenExit && typeof fullscreenExit.catch === 'function') {
        fullscreenExit.catch(() => {
          writeElementTextIfChanged(this.exportStatusElement, 'Fullscreen exit failed.');
        });
      }
      return returnSuccess(undefined);
    }

    if (documentObject.fullscreenElement) {
      return returnFailure('fullscreen-active', 'Another element is already fullscreen.');
    }
    const fullscreenTargetElement = this.shouldShowPanelsInFullscreen ? this.appShellElement : this.canvasElement;
    if (typeof fullscreenTargetElement.requestFullscreen !== 'function') {
      return returnFailure('fullscreen-unavailable', 'Fullscreen is not available in this browser.');
    }

    if (this.shouldShowPanelsInFullscreen) {
      const [, benchmarkError] = this.showBenchmarkForPanelFullscreen();
      if (benchmarkError) {
        return returnFailure(benchmarkError.code, benchmarkError.message, benchmarkError.details);
      }
    }

    const fullscreenRequest = fullscreenTargetElement.requestFullscreen();
    if (fullscreenRequest && typeof fullscreenRequest.catch === 'function') {
      fullscreenRequest.catch(() => {
        writeElementTextIfChanged(this.exportStatusElement, 'Fullscreen failed.');
      });
    }
    return returnSuccess(undefined);
  }

  syncIntegerControlFromState(inputElement, valueElement, value) {
    const nextValue = String(value);
    if (inputElement.value !== nextValue) {
      inputElement.value = nextValue;
    }
    const [, textError] = writeElementTextIfChanged(valueElement, nextValue);
    if (textError) {
      return returnFailure(textError.code, textError.message, textError.details);
    }
    return returnSuccess(undefined);
  }

  syncNumberControlFromState(inputElement, valueElement, value, formatValue) {
    const nextInputValue = value.toFixed(2);
    if (inputElement.value !== nextInputValue) {
      inputElement.value = nextInputValue;
    }
    const [, textError] = writeElementTextIfChanged(valueElement, formatValue(value));
    if (textError) {
      return returnFailure(textError.code, textError.message, textError.details);
    }
    return returnSuccess(undefined);
  }

  syncResolutionControlsFromState() {
    return this.syncResolutionControlValues(CANVAS_RENDER_WIDTH, CANVAS_RENDER_HEIGHT, CANVAS_RENDER_SCALE);
  }

  syncAllControlsFromState() {
    const state = this.applicationState;
    this.materialSelect.value = String(state.material);
    this.environmentSelect.value = String(state.environment);
    this.glossinessInput.value = state.glossiness.toFixed(2);
    if (this.materialUvProjectionModeSelect instanceof HTMLSelectElement) {
      this.materialUvProjectionModeSelect.value = normalizeMaterialUvProjectionMode(state.materialUvProjectionMode);
    }
    if (this.materialUvScaleInput instanceof HTMLInputElement) {
      this.materialUvScaleInput.value = normalizeMaterialUvScale(state.materialUvScale).toFixed(2);
    }
    if (this.materialUvScaleValueElement instanceof HTMLElement) {
      this.materialUvScaleValueElement.textContent = normalizeMaterialUvScale(state.materialUvScale).toFixed(2);
    }
    if (this.materialUvBlendSharpnessInput instanceof HTMLInputElement) {
      this.materialUvBlendSharpnessInput.value = normalizeMaterialUvBlendSharpness(state.materialUvBlendSharpness).toFixed(2);
    }
    if (this.materialUvBlendSharpnessValueElement instanceof HTMLElement) {
      this.materialUvBlendSharpnessValueElement.textContent = normalizeMaterialUvBlendSharpness(
        state.materialUvBlendSharpness
      ).toFixed(2);
    }
    this.glossinessContainer.style.display = state.material === MATERIAL.GLOSSY ? 'inline' : 'none';
    this.isGlossinessVisible = state.material === MATERIAL.GLOSSY;

    const syncActions = [
      () => this.syncIntegerControlFromState(this.lightBounceInput, this.lightBounceValueElement, state.lightBounceCount),
      () => this.syncNumberControlFromState(
        this.lightSizeInput,
        this.lightSizeValueElement,
        state.lightSize,
        formatColorAdjustmentValue
      ),
      () => this.syncLightPositionControlsFromState(),
      () => this.syncGlobalGravityControlsFromState(),
      () => this.syncLightColorControlFromState(),
      () => this.syncNumberControlFromState(
        this.fogDensityInput,
        this.fogDensityValueElement,
        state.fogDensity,
        formatColorAdjustmentValue
      ),
      () => this.syncNumberControlFromState(
        this.skyBrightnessInput,
        this.skyBrightnessValueElement,
        state.skyBrightness,
        formatColorAdjustmentValue
      ),
      () => this.syncIntegerControlFromState(this.raysPerPixelInput, this.raysPerPixelValueElement, state.raysPerPixel),
      () => this.syncIntegerControlFromState(
        this.temporalBlendFramesInput,
        this.temporalBlendFramesValueElement,
        state.temporalBlendFrames
      ),
      () => this.syncNumberControlFromState(
        this.denoiserStrengthInput,
        this.denoiserStrengthValueElement,
        state.denoiserStrength,
        formatColorAdjustmentValue
      ),
      () => this.syncNumberControlFromState(
        this.cameraFieldOfViewInput,
        this.cameraFieldOfViewValueElement,
        state.cameraFieldOfViewDegrees,
        formatCameraFieldOfViewValue
      ),
      () => this.syncNumberControlFromState(
        this.cameraFocusDistanceInput,
        this.cameraFocusDistanceValueElement,
        state.cameraFocusDistance,
        formatCameraEffectValue
      ),
      () => this.syncNumberControlFromState(
        this.cameraApertureInput,
        this.cameraApertureValueElement,
        state.cameraAperture,
        formatCameraEffectValue
      ),
      () => this.syncNumberControlFromState(
        this.motionBlurInput,
        this.motionBlurValueElement,
        state.motionBlurStrength,
        formatCameraEffectValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorExposureInput,
        this.colorExposureValueElement,
        state.colorExposure,
        formatSignedColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorBrightnessInput,
        this.colorBrightnessValueElement,
        state.colorBrightness,
        formatSignedColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorContrastInput,
        this.colorContrastValueElement,
        state.colorContrast,
        formatColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorSaturationInput,
        this.colorSaturationValueElement,
        state.colorSaturation,
        formatColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorGammaInput,
        this.colorGammaValueElement,
        state.colorGamma,
        formatColorAdjustmentValue
      ),
      () => this.syncToneMappingSelectFromState(),
      () => this.syncNumberControlFromState(
        this.bloomStrengthInput,
        this.bloomStrengthValueElement,
        state.bloomStrength,
        formatColorAdjustmentValue
      ),
      () => this.syncNumberControlFromState(
        this.bloomThresholdInput,
        this.bloomThresholdValueElement,
        state.bloomThreshold,
        formatColorAdjustmentValue
      ),
      () => this.syncNumberControlFromState(
        this.glareStrengthInput,
        this.glareStrengthValueElement,
        state.glareStrength,
        formatColorAdjustmentValue
      ),
      () => this.syncLightIntensityValue(),
      () => this.syncCameraModeButtons(),
      () => updateCameraAutoRotationButton(this.cameraPlaybackButton, state.isCameraAutoRotating),
      () => this.syncActionToggleButtons('toggle-camera-playback', state.isCameraAutoRotating),
      () => updateFramePauseButton(this.framePauseButton, state.isFramePaused),
      () => this.syncActionToggleButtons('toggle-frame-pause', state.isFramePaused),
      () => updateConvergencePauseButton(
        this.convergencePauseButton,
        state.isConvergencePauseEnabled,
        state.isConvergencePaused,
        state.convergenceSampleCount
      ),
      () => this.syncActionToggleButtons('toggle-convergence-pause', state.isConvergencePauseEnabled),
      () => updateLightIntensityCycleButton(this.lightCycleButton, state.isLightIntensityCycling),
      () => this.syncFocusPickMode(),
      () => this.syncRenderDebugViewButtons(),
      () => this.syncSelectedItemReadout(),
      () => this.syncResolutionControlsFromState(),
      () => this.syncParticleFluidBenchmarkControls(),
      () => this.syncFullscreenCanvasButton(),
      () => this.syncFullscreenPanelsButton()
    ];

    for (const syncAction of syncActions) {
      const [, syncError] = syncAction();
      if (syncError) {
        return returnFailure(syncError.code, syncError.message, syncError.details);
      }
    }

    return returnSuccess(undefined);
  }

  resetApplicationStateToDefaults() {
    const state = this.applicationState;
    state.cameraMode = CAMERA_MODE_ORBIT;
    state.cameraAngleX = 0;
    state.cameraAngleY = 0;
    state.cameraDistance = INITIAL_CAMERA_DISTANCE;
    writeVec3(state.eyePosition, 0, 0, 0);
    writeVec3(state.fpsEyePosition, 0, 0, INITIAL_CAMERA_DISTANCE);
    writeVec3(state.lightPosition, 0.4, 0.5, -0.6);
    writeVec3(state.lightColor, 1, 1, 1);
    state.nextObjectId = 0;
    state.nextPhysicsJointId = 0;
    state.material = MATERIAL.DIFFUSE;
    state.glossiness = 0.6;
    state.materialUvProjectionMode = DEFAULT_MATERIAL_UV_PROJECTION_MODE;
    state.materialUvScale = DEFAULT_MATERIAL_UV_SCALE;
    state.materialUvBlendSharpness = DEFAULT_MATERIAL_UV_BLEND_SHARPNESS;
    state.environment = ENVIRONMENT.YELLOW_BLUE_CORNELL_BOX;
    state.lightIntensity = DEFAULT_LIGHT_INTENSITY;
    state.lightSize = DEFAULT_LIGHT_SIZE;
    const [, gravityDefaultsError] = writeDefaultGlobalGravitySettings(state);
    if (gravityDefaultsError) {
      return returnFailure(gravityDefaultsError.code, gravityDefaultsError.message, gravityDefaultsError.details);
    }
    state.particleFluidSettings = createDefaultParticleFluidSettings();
    state.fogDensity = DEFAULT_FOG_DENSITY;
    state.skyBrightness = DEFAULT_SKY_BRIGHTNESS;
    state.isLightIntensityCycling = false;
    state.lightIntensityCycleDirection = 1;
    state.lightBounceCount = DEFAULT_LIGHT_BOUNCE_COUNT;
    state.raysPerPixel = DEFAULT_RAYS_PER_PIXEL;
    state.temporalBlendFrames = DEFAULT_TEMPORAL_BLEND_FRAMES;
    state.colorExposure = DEFAULT_COLOR_EXPOSURE;
    state.colorBrightness = DEFAULT_COLOR_BRIGHTNESS;
    state.colorContrast = DEFAULT_COLOR_CONTRAST;
    state.colorSaturation = DEFAULT_COLOR_SATURATION;
    state.colorGamma = DEFAULT_COLOR_GAMMA;
    state.toneMappingMode = DEFAULT_TONE_MAPPING_MODE;
    state.cameraFieldOfViewDegrees = DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES;
    state.cameraFocusDistance = DEFAULT_CAMERA_FOCUS_DISTANCE;
    state.cameraAperture = DEFAULT_CAMERA_APERTURE;
    state.motionBlurStrength = DEFAULT_MOTION_BLUR_STRENGTH;
    state.denoiserStrength = DEFAULT_DENOISER_STRENGTH;
    state.bloomStrength = DEFAULT_BLOOM_STRENGTH;
    state.bloomThreshold = DEFAULT_BLOOM_THRESHOLD;
    state.glareStrength = DEFAULT_GLARE_STRENGTH;
    state.renderDebugViewMode = RENDER_DEBUG_VIEW.BEAUTY;
    state.isRotatingCamera = false;
    state.isPickingFocus = false;
    state.isPointerDown = false;
    state.isFramePaused = false;
    state.didResumeFromFramePause = true;
    state.isConvergencePauseEnabled = false;
    state.isConvergencePaused = false;
    state.convergenceSampleCount = CONVERGED_SAMPLE_COUNT;
    state.isCameraAutoRotating = true;
    state.cameraAutoRotationSpeed = CAMERA_AUTO_ROTATION_SPEED;
    state.isPointerLocked = false;
    clearFpsMovementState(state);
    state.cameraShots = [null, null, null];
    state.isBenchmarkModeActive = false;
    state.activeBenchmarkSceneName = null;
    state.sceneAnimationElapsedSeconds = 0;
    state.sceneAnimationUpdate = null;
    state.previousPointerX = 0;
    state.previousPointerY = 0;
    return returnSuccess(undefined);
  }

  resetAllToDefaults() {
    const [, runnerStopError] = this.stopBenchmarkRunner();
    if (runnerStopError) {
      return returnFailure(runnerStopError.code, runnerStopError.message, runnerStopError.details);
    }

    const [, cancelError] = this.cancelActivePointerInteraction();
    if (cancelError) {
      return returnFailure(cancelError.code, cancelError.message, cancelError.details);
    }

    const [, stateError] = this.resetApplicationStateToDefaults();
    if (stateError) {
      return returnFailure(stateError.code, stateError.message, stateError.details);
    }

    const [, lightTranslationError] = this.lightObject.setTemporaryTranslation(ORIGIN_VECTOR);
    if (lightTranslationError) {
      return returnFailure(lightTranslationError.code, lightTranslationError.message, lightTranslationError.details);
    }

    this.clearSceneSelection();
    this.isMovingSelection = false;
    this.shouldShowPanelsInFullscreen = false;
    this.previousCameraMode = null;
    this.previousCameraAngleX = Number.NaN;
    this.previousCameraAngleY = Number.NaN;
    this.previousCameraDistance = Number.NaN;
    this.previousCameraFieldOfViewDegrees = Number.NaN;
    writeVec3(this.previousFpsEyePosition, Number.NaN, Number.NaN, Number.NaN);

    const [, syncError] = this.syncAllControlsFromState();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    const [sceneObjects, sceneError] = createSphereColumnSceneObjects(this.applicationState);
    if (sceneError) {
      return returnFailure(sceneError.code, sceneError.message, sceneError.details);
    }

    const [, sceneSetError] = this.setSceneObjects(sceneObjects);
    if (sceneSetError) {
      return returnFailure(sceneSetError.code, sceneSetError.message, sceneSetError.details);
    }

    const [, benchmarkError] = this.selectionRenderer.pathTracer.resetBenchmark();
    if (benchmarkError) {
      return returnFailure(benchmarkError.code, benchmarkError.message, benchmarkError.details);
    }

    const [, clearError] = this.selectionRenderer.pathTracer.clearSamples();
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }

    const [, benchmarkPanelError] = this.showBenchmarkForPanelFullscreen();
    if (benchmarkPanelError) {
      return returnFailure(benchmarkPanelError.code, benchmarkPanelError.message, benchmarkPanelError.details);
    }

    return scheduleAnimationFrame(this.applicationState);
  }

  exitPointerLock() {
    const documentObject = this.canvasElement.ownerDocument;
    if (
      documentObject.pointerLockElement === this.canvasElement &&
      typeof documentObject.exitPointerLock === 'function'
    ) {
      documentObject.exitPointerLock();
    }
    this.applicationState.isPointerLocked = false;
    return returnSuccess(undefined);
  }

  syncCameraModeButtons() {
    const cameraModeButtons = this.getActionToggleButtons('toggle-camera-mode');
    for (const cameraModeButton of cameraModeButtons) {
      const [, buttonError] = updateCameraModeButton(cameraModeButton, this.applicationState.cameraMode);
      if (buttonError) {
        return returnFailure(buttonError.code, buttonError.message, buttonError.details);
      }
    }
    return returnSuccess(undefined);
  }

  setCameraMode(cameraMode) {
    const nextCameraMode = this.applicationState.isBenchmarkModeActive
      ? CAMERA_MODE_ORBIT
      : normalizeCameraMode(cameraMode);
    const previousCameraMode = normalizeCameraMode(this.applicationState.cameraMode);

    const [, cancelError] = this.cancelActivePointerInteraction();
    if (cancelError) {
      return returnFailure(cancelError.code, cancelError.message, cancelError.details);
    }

    if (previousCameraMode === nextCameraMode) {
      this.applicationState.cameraMode = nextCameraMode;
      return this.syncCameraModeButtons();
    }

    if (nextCameraMode === CAMERA_MODE_FPS) {
      writeOrbitEyePosition(
        this.applicationState.fpsEyePosition,
        this.applicationState.cameraAngleX,
        this.applicationState.cameraAngleY,
        this.applicationState.cameraDistance
      );
      this.applicationState.isCameraAutoRotating = false;
      const [, playbackButtonError] = updateCameraAutoRotationButton(this.cameraPlaybackButton, false);
      if (playbackButtonError) {
        return returnFailure(playbackButtonError.code, playbackButtonError.message, playbackButtonError.details);
      }
      const [, playbackToggleError] = this.syncActionToggleButtons('toggle-camera-playback', false);
      if (playbackToggleError) {
        return returnFailure(playbackToggleError.code, playbackToggleError.message, playbackToggleError.details);
      }
    } else {
      const [, pointerLockError] = this.exitPointerLock();
      if (pointerLockError) {
        return returnFailure(pointerLockError.code, pointerLockError.message, pointerLockError.details);
      }
    }

    this.applicationState.cameraMode = nextCameraMode;
    const [, modeSyncError] = this.syncCameraModeButtons();
    if (modeSyncError) {
      return returnFailure(modeSyncError.code, modeSyncError.message, modeSyncError.details);
    }

    return this.selectionRenderer.pathTracer.clearSamples();
  }

  toggleCameraMode() {
    const nextCameraMode = normalizeCameraMode(this.applicationState.cameraMode) === CAMERA_MODE_FPS
      ? CAMERA_MODE_ORBIT
      : CAMERA_MODE_FPS;
    return this.setCameraMode(nextCameraMode);
  }

  toggleCameraAutoRotation(toggleButton) {
    if (normalizeCameraMode(this.applicationState.cameraMode) === CAMERA_MODE_FPS) {
      this.applicationState.isCameraAutoRotating = false;
      const [, fpsButtonError] = updateCameraAutoRotationButton(toggleButton, false);
      if (fpsButtonError) {
        return returnFailure(fpsButtonError.code, fpsButtonError.message, fpsButtonError.details);
      }
      const [, fpsToggleError] = this.syncActionToggleButtons('toggle-camera-playback', false);
      if (fpsToggleError) {
        return returnFailure(fpsToggleError.code, fpsToggleError.message, fpsToggleError.details);
      }
      return returnSuccess(undefined);
    }

    if (this.applicationState.isBenchmarkModeActive) {
      this.applicationState.isCameraAutoRotating = true;
      this.applicationState.cameraAutoRotationSpeed = BENCHMARK_CAMERA_AUTO_ROTATION_SPEED;
      const [, benchmarkButtonError] = updateCameraAutoRotationButton(toggleButton, true);
      if (benchmarkButtonError) {
        return returnFailure(benchmarkButtonError.code, benchmarkButtonError.message, benchmarkButtonError.details);
      }
      const [, benchmarkToggleError] = this.syncActionToggleButtons('toggle-camera-playback', true);
      if (benchmarkToggleError) {
        return returnFailure(benchmarkToggleError.code, benchmarkToggleError.message, benchmarkToggleError.details);
      }
      return returnSuccess(undefined);
    }

    this.applicationState.isCameraAutoRotating = !this.applicationState.isCameraAutoRotating;
    const [, buttonError] = updateCameraAutoRotationButton(toggleButton, this.applicationState.isCameraAutoRotating);
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }
    const [, toggleError] = this.syncActionToggleButtons('toggle-camera-playback', this.applicationState.isCameraAutoRotating);
    if (toggleError) {
      return returnFailure(toggleError.code, toggleError.message, toggleError.details);
    }
    return returnSuccess(undefined);
  }

  refreshPausedBenchmarkDisplay(measurementSource, shouldPauseFrames) {
    const pathTracer = this.selectionRenderer.pathTracer;
    const [, snapshotError] = pathTracer.writePausedBenchmarkSnapshot(
      measurementSource,
      shouldPauseFrames,
      this.applicationState
    );
    if (snapshotError) {
      return returnFailure(snapshotError.code, snapshotError.message, snapshotError.details);
    }
    return this.benchmarkDisplay.update(performance.now(), pathTracer.benchmarkSnapshot, true);
  }

  syncActionToggleButtons(actionName, isPressed) {
    const toggleButtons = this.getActionToggleButtons(actionName);
    const ariaPressedValue = isPressed ? 'true' : 'false';
    for (const toggleButton of toggleButtons) {
      if (toggleButton.getAttribute('aria-pressed') !== ariaPressedValue) {
        toggleButton.setAttribute('aria-pressed', ariaPressedValue);
      }
    }
    return returnSuccess(undefined);
  }

  syncRenderDebugViewButtons() {
    const documentObject = this.canvasElement.ownerDocument;
    for (const debugViewButton of documentObject.querySelectorAll('button[data-debug-view]')) {
      const [debugViewMode, debugViewError] = parseRenderDebugViewMode(debugViewButton.dataset.debugView);
      if (debugViewError) {
        continue;
      }
      debugViewButton.setAttribute(
        'aria-pressed',
        debugViewMode === normalizeRenderDebugViewMode(this.applicationState.renderDebugViewMode) ? 'true' : 'false'
      );
    }
    return returnSuccess(undefined);
  }

  setRenderDebugView(rawDebugViewMode) {
    const [debugViewMode, debugViewError] = parseRenderDebugViewMode(rawDebugViewMode);
    if (debugViewError) {
      return returnFailure(debugViewError.code, debugViewError.message, debugViewError.details);
    }

    if (this.applicationState.renderDebugViewMode === debugViewMode) {
      return this.syncRenderDebugViewButtons();
    }

    this.applicationState.renderDebugViewMode = debugViewMode;
    const [, syncError] = this.syncRenderDebugViewButtons();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  toggleFramePause(toggleButton) {
    this.applicationState.isFramePaused = !this.applicationState.isFramePaused;
    const [, buttonError] = updateFramePauseButton(toggleButton, this.applicationState.isFramePaused);
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }
    const [, syncToggleError] = this.syncActionToggleButtons('toggle-frame-pause', this.applicationState.isFramePaused);
    if (syncToggleError) {
      return returnFailure(syncToggleError.code, syncToggleError.message, syncToggleError.details);
    }

    if (this.applicationState.isFramePaused) {
      const [, benchmarkError] = this.refreshPausedBenchmarkDisplay('frame-paused', true);
      if (benchmarkError) {
        return returnFailure(benchmarkError.code, benchmarkError.message, benchmarkError.details);
      }
      return cancelScheduledAnimationFrame(this.applicationState);
    }
    this.applicationState.didResumeFromFramePause = true;
    return scheduleAnimationFrame(this.applicationState);
  }

  toggleConvergencePause(toggleButton) {
    this.applicationState.isConvergencePauseEnabled = !this.applicationState.isConvergencePauseEnabled;
    if (!this.applicationState.isConvergencePauseEnabled) {
      this.applicationState.isConvergencePaused = false;
    } else if (this.selectionRenderer.pathTracer.sampleCount >= this.applicationState.convergenceSampleCount) {
      this.applicationState.isConvergencePaused = true;
    }

    const [, buttonError] = updateConvergencePauseButton(
      toggleButton,
      this.applicationState.isConvergencePauseEnabled,
      this.applicationState.isConvergencePaused,
      this.applicationState.convergenceSampleCount
    );
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }
    const [, syncToggleError] = this.syncActionToggleButtons(
      'toggle-convergence-pause',
      this.applicationState.isConvergencePauseEnabled
    );
    if (syncToggleError) {
      return returnFailure(syncToggleError.code, syncToggleError.message, syncToggleError.details);
    }
    if (this.applicationState.isFramePaused) {
      return this.refreshPausedBenchmarkDisplay('frame-paused', true);
    }
    if (this.applicationState.isConvergencePaused) {
      return this.refreshPausedBenchmarkDisplay('rays-paused', false);
    }
    return returnSuccess(undefined);
  }

  cancelActivePointerInteraction() {
    this.applicationState.isPointerDown = false;
    this.applicationState.isRotatingCamera = false;
    this.applicationState.isPointerLocked = false;
    clearFpsMovementState(this.applicationState);
    const documentObject = this.canvasElement.ownerDocument;
    if (
      documentObject.pointerLockElement === this.canvasElement &&
      typeof documentObject.exitPointerLock === 'function'
    ) {
      documentObject.exitPointerLock();
    }

    if (!this.isMovingSelection) {
      return returnSuccess(undefined);
    }

    const selectedObject = this.readSelectedObject();
    if (selectedObject && !selectedObject.isHidden && !selectedObject.isLocked) {
      const [, resetError] = selectedObject.setTemporaryTranslation(ORIGIN_VECTOR);
      if (resetError) {
        this.isMovingSelection = false;
        return returnFailure(resetError.code, resetError.message, resetError.details);
      }
    }

    this.isMovingSelection = false;
    const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
    if (uniformDirtyError) {
      return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  handleCanvasPress(xPosition, yPosition, selectionOptions = {}) {
    const originPosition = this.applicationState.eyePosition;
    const rayDirection = this.pointerRayDirection;
    writeEyeRayVector(
      rayDirection,
      this.inverseModelviewProjectionMatrix,
      (xPosition / CANVAS_RENDER_WIDTH) * 2 - 1,
      1 - (yPosition / CANVAS_RENDER_HEIGHT) * 2,
      originPosition
    );

    const hasSelectionModifier = Boolean(selectionOptions.isRangeSelection || selectionOptions.isToggleSelection);
    const selectedObject = this.readSelectedObject();
    if (selectedObject && !hasSelectionModifier && !selectedObject.isLocked) {
      const minBounds = selectedObject.getMinCorner();
      const maxBounds = selectedObject.getMaxCorner();
      const selectionBoxDistance = intersectCube(originPosition, rayDirection, minBounds, maxBounds);

      if (selectionBoxDistance < MAX_INTERSECTION_DISTANCE) {
        const hitPosition = writeAddScaledVec3(this.pointerHitPosition, originPosition, rayDirection, selectionBoxDistance);
        writeMovementNormalFromHit(this.movementNormal, hitPosition, minBounds, maxBounds);
        this.movementDistance = dotVec3(this.movementNormal, hitPosition);
        writeVec3(this.originalHitPosition, hitPosition[0], hitPosition[1], hitPosition[2]);
        this.isMovingSelection = true;
        return returnSuccess(true);
      }
    }

    let closestDistance = MAX_INTERSECTION_DISTANCE;
    let closestObject = null;

    for (const sceneObject of this.sceneObjects) {
      if (sceneObject.isHidden || sceneObject.isLocked) {
        continue;
      }
      const [objectDistance, objectDistanceError] = sceneObject.intersectRay(originPosition, rayDirection);
      if (objectDistanceError) {
        return returnFailure(objectDistanceError.code, objectDistanceError.message, objectDistanceError.details);
      }

      if (objectDistance < closestDistance) {
        closestDistance = objectDistance;
        closestObject = sceneObject;
      }
    }

    let nextSelectedObject = null;
    if (closestObject) {
      nextSelectedObject = this.selectSceneObjectWithModifiers(closestObject, selectionOptions);
    } else if (hasSelectionModifier) {
      nextSelectedObject = this.readSelectedObject();
    } else {
      this.clearSceneSelection();
    }
    const [, materialSyncError] = this.syncMaterialSelectToObject(nextSelectedObject);
    if (materialSyncError) {
      return returnFailure(materialSyncError.code, materialSyncError.message, materialSyncError.details);
    }
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    if (closestDistance < MAX_INTERSECTION_DISTANCE) {
      const [, scrollError] = scrollInspectorToObjectDetails(this.canvasElement.ownerDocument);
      if (scrollError) {
        return returnFailure(scrollError.code, scrollError.message, scrollError.details);
      }
    }
    return returnSuccess(closestDistance < MAX_INTERSECTION_DISTANCE);
  }

  handleCanvasMove(xPosition, yPosition) {
    const selectedObject = this.readSelectedObject();
    if (!this.isMovingSelection || !selectedObject || selectedObject.isLocked) {
      return returnSuccess(undefined);
    }

    const [hitPosition, hitError] = this.readMovementPlaneHit(xPosition, yPosition);
    if (hitError) {
      return returnFailure(hitError.code, hitError.message, hitError.details);
    }

    if (!hitPosition) {
      return returnSuccess(undefined);
    }

    writeSubtractVec3(this.pointerTranslation, hitPosition, this.originalHitPosition);
    const [, translateError] = selectedObject.setTemporaryTranslation(this.pointerTranslation);
    if (translateError) {
      return returnFailure(translateError.code, translateError.message, translateError.details);
    }

    const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
    if (uniformDirtyError) {
      return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
    }

    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  handleCanvasRelease(xPosition, yPosition) {
    const selectedObject = this.readSelectedObject();
    if (!this.isMovingSelection || !selectedObject || selectedObject.isLocked) {
      this.isMovingSelection = false;
      return returnSuccess(undefined);
    }

    const [hitPosition, hitError] = this.readMovementPlaneHit(xPosition, yPosition);
    if (hitError) {
      this.isMovingSelection = false;
      return returnFailure(hitError.code, hitError.message, hitError.details);
    }

    const [, resetError] = selectedObject.setTemporaryTranslation(ORIGIN_VECTOR);
    if (resetError) {
      this.isMovingSelection = false;
      return returnFailure(resetError.code, resetError.message, resetError.details);
    }

    const [, uniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
    if (uniformDirtyError) {
      this.isMovingSelection = false;
      return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
    }

    if (hitPosition) {
      writeSubtractVec3(this.pointerTranslation, hitPosition, this.originalHitPosition);
      const [, commitError] = selectedObject.commitTranslation(this.pointerTranslation);
      if (commitError) {
        this.isMovingSelection = false;
        return returnFailure(commitError.code, commitError.message, commitError.details);
      }

      const [, commitUniformDirtyError] = this.selectionRenderer.pathTracer.markSceneUniformsDirty();
      if (commitUniformDirtyError) {
        this.isMovingSelection = false;
        return returnFailure(
          commitUniformDirtyError.code,
          commitUniformDirtyError.message,
          commitUniformDirtyError.details
        );
      }

      const [, authoredTransformError] = writeSceneObjectAuthoredTransform(selectedObject, true);
      if (authoredTransformError) {
        this.isMovingSelection = false;
        return returnFailure(
          authoredTransformError.code,
          authoredTransformError.message,
          authoredTransformError.details
        );
      }

      const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
      if (physicsError) {
        this.isMovingSelection = false;
        return returnFailure(physicsError.code, physicsError.message, physicsError.details);
      }
    }

    this.isMovingSelection = false;
    const [, readoutError] = this.syncSelectedItemReadout();
    if (readoutError) {
      return returnFailure(readoutError.code, readoutError.message, readoutError.details);
    }
    return returnSuccess(undefined);
  }

  readMovementPlaneHit(xPosition, yPosition) {
    const originPosition = this.applicationState.eyePosition;
    const rayDirection = this.pointerRayDirection;
    writeEyeRayVector(
      rayDirection,
      this.inverseModelviewProjectionMatrix,
      (xPosition / CANVAS_RENDER_WIDTH) * 2 - 1,
      1 - (yPosition / CANVAS_RENDER_HEIGHT) * 2,
      originPosition
    );
    const denominator = dotVec3(this.movementNormal, rayDirection);

    if (Math.abs(denominator) < 0.000001) {
      return returnSuccess(null);
    }

    const hitDistance = (this.movementDistance - dotVec3(this.movementNormal, originPosition)) / denominator;
    return returnSuccess(writeAddScaledVec3(this.pointerHitPosition, originPosition, rayDirection, hitDistance));
  }
}

const writeMovementNormalFromHit = (outputVector, hitPosition, minBounds, maxBounds) => {
  if (Math.abs(hitPosition[0] - minBounds[0]) < 0.001) {
    return writeVec3(outputVector, -1, 0, 0);
  }
  if (Math.abs(hitPosition[0] - maxBounds[0]) < 0.001) {
    return writeVec3(outputVector, 1, 0, 0);
  }
  if (Math.abs(hitPosition[1] - minBounds[1]) < 0.001) {
    return writeVec3(outputVector, 0, -1, 0);
  }
  if (Math.abs(hitPosition[1] - maxBounds[1]) < 0.001) {
    return writeVec3(outputVector, 0, 1, 0);
  }
  if (Math.abs(hitPosition[2] - minBounds[2]) < 0.001) {
    return writeVec3(outputVector, 0, 0, -1);
  }
  return writeVec3(outputVector, 0, 0, 1);
};

const allocateSceneObjectId = (applicationState) => {
  const objectId = applicationState.nextObjectId;
  applicationState.nextObjectId += 1;
  return objectId;
};

const createApplicationState = () => bindLegacyApplicationStateObject({
  cameraMode: CAMERA_MODE_ORBIT,
  cameraAngleX: 0,
  cameraAngleY: 0,
  cameraDistance: INITIAL_CAMERA_DISTANCE,
  eyePosition: createVec3(0, 0, 0),
  fpsEyePosition: createVec3(0, 0, INITIAL_CAMERA_DISTANCE),
  lightPosition: createVec3(0.4, 0.5, -0.6),
  lightColor: createVec3(1, 1, 1),
  nextObjectId: 0,
  nextPhysicsJointId: 0,
  material: MATERIAL.DIFFUSE,
  glossiness: 0.6,
  materialUvProjectionMode: DEFAULT_MATERIAL_UV_PROJECTION_MODE,
  materialUvScale: DEFAULT_MATERIAL_UV_SCALE,
  materialUvBlendSharpness: DEFAULT_MATERIAL_UV_BLEND_SHARPNESS,
  environment: ENVIRONMENT.YELLOW_BLUE_CORNELL_BOX,
  lightIntensity: DEFAULT_LIGHT_INTENSITY,
  lightSize: DEFAULT_LIGHT_SIZE,
  physicsGravityDirection: DEFAULT_GLOBAL_GRAVITY_DIRECTION,
  physicsGravityMagnitude: DEFAULT_GLOBAL_GRAVITY_MAGNITUDE,
  physicsCustomGravityDirection: createDefaultGlobalGravityCustomDirection(),
  particleFluidSettings: createDefaultParticleFluidSettings(),
  fogDensity: DEFAULT_FOG_DENSITY,
  skyBrightness: DEFAULT_SKY_BRIGHTNESS,
  isLightIntensityCycling: false,
  lightIntensityCycleDirection: 1,
  lightBounceCount: DEFAULT_LIGHT_BOUNCE_COUNT,
  raysPerPixel: DEFAULT_RAYS_PER_PIXEL,
  temporalBlendFrames: DEFAULT_TEMPORAL_BLEND_FRAMES,
  colorExposure: DEFAULT_COLOR_EXPOSURE,
  colorBrightness: DEFAULT_COLOR_BRIGHTNESS,
  colorContrast: DEFAULT_COLOR_CONTRAST,
  colorSaturation: DEFAULT_COLOR_SATURATION,
  colorGamma: DEFAULT_COLOR_GAMMA,
  toneMappingMode: DEFAULT_TONE_MAPPING_MODE,
  cameraFieldOfViewDegrees: DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES,
  cameraFocusDistance: DEFAULT_CAMERA_FOCUS_DISTANCE,
  cameraAperture: DEFAULT_CAMERA_APERTURE,
  motionBlurStrength: DEFAULT_MOTION_BLUR_STRENGTH,
  denoiserStrength: DEFAULT_DENOISER_STRENGTH,
  bloomStrength: DEFAULT_BLOOM_STRENGTH,
  bloomThreshold: DEFAULT_BLOOM_THRESHOLD,
  glareStrength: DEFAULT_GLARE_STRENGTH,
  renderDebugViewMode: RENDER_DEBUG_VIEW.BEAUTY,
  isRotatingCamera: false,
  isPickingFocus: false,
  isPointerDown: false,
  isFramePaused: false,
  didResumeFromFramePause: false,
  isConvergencePauseEnabled: false,
  isConvergencePaused: false,
  convergenceSampleCount: CONVERGED_SAMPLE_COUNT,
  isCameraAutoRotating: true,
  cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED,
  isPointerLocked: false,
  isFpsMovingForward: false,
  isFpsMovingBackward: false,
  isFpsMovingLeft: false,
  isFpsMovingRight: false,
  isFpsMovingUp: false,
  isFpsMovingDown: false,
  isFpsMovingFast: false,
  cameraShots: [null, null, null],
  isBenchmarkModeActive: false,
  activeBenchmarkSceneName: null,
  startupSceneLoadError: null,
  sceneAnimationElapsedSeconds: 0,
  sceneAnimationUpdate: null,
  previousPointerX: 0,
  previousPointerY: 0,
  isInitialFrameReady: false,
  isWebGlContextLost: false,
  animationFrameId: 0
});

const clearFpsMovementState = (applicationState) => {
  applicationState.isFpsMovingForward = false;
  applicationState.isFpsMovingBackward = false;
  applicationState.isFpsMovingLeft = false;
  applicationState.isFpsMovingRight = false;
  applicationState.isFpsMovingUp = false;
  applicationState.isFpsMovingDown = false;
  applicationState.isFpsMovingFast = false;
  return returnSuccess(undefined);
};

const readFpsMovementStateKey = (keyCode) => {
  switch (keyCode) {
    case 'KeyW':
      return 'isFpsMovingForward';
    case 'KeyS':
      return 'isFpsMovingBackward';
    case 'KeyA':
      return 'isFpsMovingLeft';
    case 'KeyD':
      return 'isFpsMovingRight';
    case 'KeyE':
    case 'Space':
      return 'isFpsMovingUp';
    case 'KeyQ':
      return 'isFpsMovingDown';
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'isFpsMovingFast';
    default:
      return null;
  }
};

const setFpsMovementKeyState = (applicationState, keyCode, isPressed) => {
  const stateKey = readFpsMovementStateKey(keyCode);
  if (!stateKey) {
    return returnSuccess(false);
  }

  applicationState[stateKey] = isPressed;
  return returnSuccess(true);
};

const updateCameraAutoRotationButton = (toggleButton, isCameraAutoRotating) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Camera playback control is not a button.');
  }

  toggleButton.textContent = isCameraAutoRotating ? 'Pause Camera' : 'Play Camera';
  toggleButton.setAttribute('aria-pressed', isCameraAutoRotating ? 'true' : 'false');
  return returnSuccess(undefined);
};

const updateCameraModeButton = (toggleButton, cameraMode) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Camera mode control is not a button.');
  }

  const normalizedCameraMode = normalizeCameraMode(cameraMode);
  const isFpsMode = normalizedCameraMode === CAMERA_MODE_FPS;
  const label = isFpsMode ? 'Camera: FPS' : 'Camera: Orbit';
  const labelElement = toggleButton.querySelector('[data-camera-mode-label]');
  if (labelElement) {
    labelElement.textContent = label;
  } else {
    toggleButton.textContent = label;
  }
  toggleButton.setAttribute('aria-pressed', isFpsMode ? 'true' : 'false');
  return returnSuccess(undefined);
};

const updateFramePauseButton = (toggleButton, isFramePaused) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Frame pause control is not a button.');
  }

  toggleButton.textContent = isFramePaused ? 'Resume Frames' : 'Pause Frames';
  toggleButton.setAttribute('aria-pressed', isFramePaused ? 'true' : 'false');
  return returnSuccess(undefined);
};

const updateConvergencePauseButton = (
  toggleButton,
  isConvergencePauseEnabled,
  isConvergencePaused,
  convergenceSampleCount
) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Convergence pause control is not a button.');
  }

  if (isConvergencePaused) {
    toggleButton.textContent = 'Resume Rays';
  } else if (isConvergencePauseEnabled) {
    toggleButton.textContent = `Pause at ${convergenceSampleCount} Samples`;
  } else {
    toggleButton.textContent = 'Pause Rays at Converged';
  }
  toggleButton.setAttribute('aria-pressed', isConvergencePauseEnabled ? 'true' : 'false');
  return returnSuccess(undefined);
};

const updateLightIntensityCycleButton = (toggleButton, isLightIntensityCycling) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Light cycle control is not a button.');
  }

  toggleButton.textContent = isLightIntensityCycling ? 'Stop Light Cycle' : 'Cycle Light';
  toggleButton.setAttribute('aria-pressed', isLightIntensityCycling ? 'true' : 'false');
  return returnSuccess(undefined);
};

const updateFocusPickButton = (toggleButton, isPickingFocus) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Focus pick control is not a button.');
  }

  toggleButton.textContent = isPickingFocus ? 'Click Focus Target' : 'Pick Focus';
  toggleButton.setAttribute('aria-pressed', isPickingFocus ? 'true' : 'false');
  return returnSuccess(undefined);
};

const advanceCameraAutoRotation = (applicationState, elapsedSeconds, pathTracer) => {
  const cameraMode = normalizeCameraMode(applicationState.cameraMode);
  if (
    !applicationState.isCameraAutoRotating ||
    applicationState.isRotatingCamera
  ) {
    return returnSuccess(false);
  }

  if (cameraMode !== CAMERA_MODE_ORBIT && cameraMode !== CAMERA_MODE_FPS) {
    return returnSuccess(false);
  }

  applicationState.cameraAngleY -= applicationState.cameraAutoRotationSpeed * elapsedSeconds;
  const [, clearError] = pathTracer.clearSamples(false);
  if (clearError) {
    return returnFailure(clearError.code, clearError.message, clearError.details);
  }
  return returnSuccess(true);
};

const advanceFpsCameraMovement = (applicationState, elapsedSeconds, pathTracer) => {
  if (normalizeCameraMode(applicationState.cameraMode) !== CAMERA_MODE_FPS) {
    return returnSuccess(false);
  }

  const forwardSign = (
    (applicationState.isFpsMovingForward ? 1 : 0) -
    (applicationState.isFpsMovingBackward ? 1 : 0)
  );
  const strafeSign = (
    (applicationState.isFpsMovingRight ? 1 : 0) -
    (applicationState.isFpsMovingLeft ? 1 : 0)
  );
  const verticalSign = (
    (applicationState.isFpsMovingUp ? 1 : 0) -
    (applicationState.isFpsMovingDown ? 1 : 0)
  );

  if (forwardSign === 0 && strafeSign === 0 && verticalSign === 0) {
    return returnSuccess(false);
  }

  const sinCameraAngleX = Math.sin(applicationState.cameraAngleX);
  const cosCameraAngleX = Math.cos(applicationState.cameraAngleX);
  const sinCameraAngleY = Math.sin(applicationState.cameraAngleY);
  const cosCameraAngleY = Math.cos(applicationState.cameraAngleY);
  let moveX = (-sinCameraAngleY * cosCameraAngleX * forwardSign) + (cosCameraAngleY * strafeSign);
  let moveY = (-sinCameraAngleX * forwardSign) + verticalSign;
  let moveZ = (-cosCameraAngleY * cosCameraAngleX * forwardSign) - (sinCameraAngleY * strafeSign);
  const movementLength = Math.hypot(moveX, moveY, moveZ);

  if (movementLength === 0) {
    return returnSuccess(false);
  }

  const speedMultiplier = applicationState.isFpsMovingFast ? FPS_CAMERA_FAST_MOVE_MULTIPLIER : 1;
  const movementScale = FPS_CAMERA_MOVE_SPEED * speedMultiplier * Math.max(0, elapsedSeconds) / movementLength;
  moveX *= movementScale;
  moveY *= movementScale;
  moveZ *= movementScale;
  applicationState.fpsEyePosition[0] += moveX;
  applicationState.fpsEyePosition[1] += moveY;
  applicationState.fpsEyePosition[2] += moveZ;
  const [, clearError] = pathTracer.clearSamples(false);
  if (clearError) {
    return returnFailure(clearError.code, clearError.message, clearError.details);
  }
  return returnSuccess(true);
};

const advanceSceneAnimation = (applicationState, elapsedSeconds, pathTracer) => {
  if (typeof applicationState.sceneAnimationUpdate !== 'function') {
    return returnSuccess(false);
  }

  applicationState.sceneAnimationElapsedSeconds += Math.max(0, elapsedSeconds);
  const [didUpdateScene, animationError] = applicationState.sceneAnimationUpdate(
    applicationState.sceneAnimationElapsedSeconds,
    elapsedSeconds
  );
  if (animationError) {
    return returnFailure(animationError.code, animationError.message, animationError.details);
  }
  if (!didUpdateScene) {
    return returnSuccess(false);
  }

  const [, uniformDirtyError] = pathTracer.markSceneUniformsDirty();
  if (uniformDirtyError) {
    return returnFailure(uniformDirtyError.code, uniformDirtyError.message, uniformDirtyError.details);
  }

  const [, clearError] = pathTracer.clearSamples(false);
  if (clearError) {
    return returnFailure(clearError.code, clearError.message, clearError.details);
  }
  return returnSuccess(true);
};

const scheduleAnimationFrame = (applicationState) => {
  if (applicationState.isWebGlContextLost || applicationState.isFramePaused || applicationState.animationFrameId) {
    return returnSuccess(undefined);
  }
  return scheduleRenderFrame(applicationState);
};

const cancelScheduledAnimationFrame = (applicationState) => {
  return cancelScheduledRenderFrame(applicationState);
};

const createSphereObject = (applicationState, x, y, z, radius, material = MATERIAL.DIFFUSE) => new SphereSceneObject(
  createVec3(x, y, z),
  radius,
  allocateSceneObjectId(applicationState),
  material
);

const createCubeObject = (
  applicationState,
  minX,
  minY,
  minZ,
  maxX,
  maxY,
  maxZ,
  material = MATERIAL.DIFFUSE
) => new CubeSceneObject(
  createVec3(minX, minY, minZ),
  createVec3(maxX, maxY, maxZ),
  allocateSceneObjectId(applicationState),
  material
);

const createReferenceMeshObject = (
  applicationState,
  modelKey,
  x,
  y,
  z,
  material = MATERIAL.DIFFUSE
) => new ReferenceMeshSceneObject(
  readReferenceMeshModel(modelKey),
  createVec3(x, y, z),
  allocateSceneObjectId(applicationState),
  material,
  readReferenceMeshModelKey(modelKey)
);

const createCylinderObject = (
  applicationState,
  x,
  y,
  z,
  radius,
  halfHeight,
  material = MATERIAL.DIFFUSE
) => new CylinderSceneObject(
  createVec3(x, y, z),
  radius,
  halfHeight,
  allocateSceneObjectId(applicationState),
  material
);

const createConeObject = (
  applicationState,
  x,
  y,
  z,
  radius,
  halfHeight,
  material = MATERIAL.DIFFUSE
) => new ConeSceneObject(
  createVec3(x, y, z),
  radius,
  0.01,
  halfHeight,
  allocateSceneObjectId(applicationState),
  material
);

const createFrustumObject = (
  applicationState,
  x,
  y,
  z,
  bottomRadius,
  topRadius,
  halfHeight,
  material = MATERIAL.DIFFUSE
) => new ConeSceneObject(
  createVec3(x, y, z),
  bottomRadius,
  topRadius,
  halfHeight,
  allocateSceneObjectId(applicationState),
  material
);

const createCapsuleObject = (
  applicationState,
  x,
  y,
  z,
  radius,
  halfSegmentHeight,
  material = MATERIAL.DIFFUSE
) => new CapsuleSceneObject(
  createVec3(x, y, z),
  radius,
  halfSegmentHeight,
  allocateSceneObjectId(applicationState),
  material
);

const createEllipsoidObject = (
  applicationState,
  x,
  y,
  z,
  radiusX,
  radiusY,
  radiusZ,
  material = MATERIAL.DIFFUSE
) => new EllipsoidSceneObject(
  createVec3(x, y, z),
  createVec3(radiusX, radiusY, radiusZ),
  allocateSceneObjectId(applicationState),
  material
);

const createTorusObject = (
  applicationState,
  x,
  y,
  z,
  majorRadius,
  minorRadius,
  material = MATERIAL.DIFFUSE
) => new TorusSceneObject(
  createVec3(x, y, z),
  majorRadius,
  minorRadius,
  allocateSceneObjectId(applicationState),
  material
);

const createRoundedBoxObject = (
  applicationState,
  x,
  y,
  z,
  halfExtentX,
  halfExtentY,
  halfExtentZ,
  radius,
  material = MATERIAL.DIFFUSE
) => new RoundedBoxSceneObject(
  createVec3(x, y, z),
  createVec3(halfExtentX, halfExtentY, halfExtentZ),
  radius,
  allocateSceneObjectId(applicationState),
  material
);

const createPlaneObject = (
  applicationState,
  x,
  y,
  z,
  halfExtentX,
  halfExtentZ,
  material = MATERIAL.DIFFUSE
) => createRoundedBoxObject(applicationState, x, y, z, halfExtentX, 0.012, halfExtentZ, 0.006, material);

const createDiskObject = (
  applicationState,
  x,
  y,
  z,
  radius,
  material = MATERIAL.DIFFUSE
) => new DiskSceneObject(
  createVec3(x, y, z),
  radius,
  0.012,
  allocateSceneObjectId(applicationState),
  material
);

const createTriangleObject = (
  applicationState,
  x,
  y,
  z,
  halfWidth,
  halfHeight,
  halfDepth,
  material = MATERIAL.DIFFUSE
) => new TriangularPrismSceneObject(
  createVec3(x, y, z),
  halfWidth,
  halfHeight,
  halfDepth,
  allocateSceneObjectId(applicationState),
  material
);

const createWedgeObject = (
  applicationState,
  x,
  y,
  z,
  halfWidth,
  halfHeight,
  halfDepth,
  material = MATERIAL.DIFFUSE
) => new WedgeSceneObject(
  createVec3(x, y, z),
  halfWidth,
  halfHeight,
  halfDepth,
  allocateSceneObjectId(applicationState),
  material
);

const createPrismObject = (
  applicationState,
  x,
  y,
  z,
  halfWidth,
  halfHeight,
  halfDepth,
  material = MATERIAL.DIFFUSE
) => new TriangularPrismSceneObject(
  createVec3(x, y, z),
  halfWidth,
  halfHeight,
  halfDepth,
  allocateSceneObjectId(applicationState),
  material
);

const createMetaballsObject = (
  applicationState,
  x,
  y,
  z,
  radius,
  material = MATERIAL.DIFFUSE
) => new MetaballsSceneObject(
  createVec3(x, y, z),
  radius,
  allocateSceneObjectId(applicationState),
  material
);

const createCsgObject = (
  applicationState,
  x,
  y,
  z,
  size,
  material = MATERIAL.DIFFUSE
) => new CsgSceneObject(
  createVec3(x, y, z),
  size,
  allocateSceneObjectId(applicationState),
  material
);

const createMandelbulbObject = (
  applicationState,
  x,
  y,
  z,
  radius,
  material = MATERIAL.DIFFUSE
) => new MandelbulbSceneObject(
  createVec3(x, y, z),
  radius,
  allocateSceneObjectId(applicationState),
  material
);

const createSdfFractalObject = (
  applicationState,
  x,
  y,
  z,
  radius,
  material = MATERIAL.DIFFUSE
) => new SdfFractalSceneObject(
  createVec3(x, y, z),
  radius,
  allocateSceneObjectId(applicationState),
  material
);

const createAreaLightObject = (
  applicationState,
  x,
  y,
  z,
  halfExtentX,
  halfExtentY,
  halfExtentZ
) => new AreaLightSceneObject(
  createVec3(x, y, z),
  createVec3(halfExtentX, halfExtentY, halfExtentZ),
  0.02,
  allocateSceneObjectId(applicationState)
);

const primitiveActionFactories = Object.freeze({
  'add-cylinder': (applicationState) => createCylinderObject(applicationState, 0, -0.45, 0, 0.18, 0.42, applicationState.material),
  'add-cone': (applicationState) => createConeObject(applicationState, 0, -0.48, 0, 0.24, 0.38, applicationState.material),
  'add-frustum': (applicationState) => createFrustumObject(applicationState, 0, -0.48, 0, 0.24, 0.11, 0.38, applicationState.material),
  'add-capsule': (applicationState) => createCapsuleObject(applicationState, 0, -0.45, 0, 0.14, 0.32, applicationState.material),
  'add-ellipsoid': (applicationState) => createEllipsoidObject(applicationState, 0, -0.45, 0, 0.30, 0.18, 0.22, applicationState.material),
  'add-torus': (applicationState) => createTorusObject(applicationState, 0, -0.45, 0, 0.22, 0.065, applicationState.material),
  'add-rounded-box': (applicationState) => createRoundedBoxObject(applicationState, 0, -0.45, 0, 0.22, 0.18, 0.22, 0.055, applicationState.material),
  'add-plane': (applicationState) => createPlaneObject(applicationState, 0, -0.78, 0, 0.38, 0.26, applicationState.material),
  'add-disk': (applicationState) => createDiskObject(applicationState, 0, -0.78, 0, 0.30, applicationState.material),
  'add-triangle': (applicationState) => createTriangleObject(applicationState, 0, -0.55, 0, 0.28, 0.26, 0.05, applicationState.material),
  'add-wedge': (applicationState) => createWedgeObject(applicationState, 0, -0.55, 0, 0.30, 0.25, 0.16, applicationState.material),
  'add-prism': (applicationState) => createPrismObject(applicationState, 0, -0.50, 0, 0.24, 0.32, 0.20, applicationState.material),
  'add-metaballs': (applicationState) => createMetaballsObject(applicationState, 0, -0.48, 0, 0.18, applicationState.material),
  'add-csg-shape': (applicationState) => createCsgObject(applicationState, 0, -0.45, 0, 0.32, applicationState.material),
  'add-mandelbulb': (applicationState) => createMandelbulbObject(applicationState, 0, -0.45, 0, 0.32, applicationState.material),
  'add-sdf-fractal': (applicationState) => createSdfFractalObject(applicationState, 0, -0.45, 0, 0.34, applicationState.material),
  'add-area-light': (applicationState) => createAreaLightObject(
    applicationState,
    applicationState.lightPosition[0],
    applicationState.lightPosition[1],
    applicationState.lightPosition[2],
    0.28,
    0.018,
    0.18
  )
});

const SCENE_OBJECT_SDF_PROTOTYPES = Object.freeze({
  sdf: SdfSceneObject.prototype,
  cylinder: CylinderSceneObject.prototype,
  cone: ConeSceneObject.prototype,
  capsule: CapsuleSceneObject.prototype,
  ellipsoid: EllipsoidSceneObject.prototype,
  torus: TorusSceneObject.prototype,
  roundedBox: RoundedBoxSceneObject.prototype,
  disk: DiskSceneObject.prototype,
  wedge: WedgeSceneObject.prototype,
  triangularPrism: TriangularPrismSceneObject.prototype,
  metaballs: MetaballsSceneObject.prototype,
  csg: CsgSceneObject.prototype,
  mandelbulb: MandelbulbSceneObject.prototype,
  sdfFractal: SdfFractalSceneObject.prototype,
  areaLight: AreaLightSceneObject.prototype
});

const SCENE_OBJECT_TYPE_ALIASES = Object.freeze({
  GroupEntity: 'group',
  SphereSceneObject: 'sphere',
  CubeSceneObject: 'cube',
  ReferenceMeshSceneObject: 'referenceMesh',
  SdfSceneObject: 'sdf',
  CylinderSceneObject: 'cylinder',
  ConeSceneObject: 'cone',
  CapsuleSceneObject: 'capsule',
  EllipsoidSceneObject: 'ellipsoid',
  TorusSceneObject: 'torus',
  RoundedBoxSceneObject: 'roundedBox',
  DiskSceneObject: 'disk',
  WedgeSceneObject: 'wedge',
  TriangularPrismSceneObject: 'triangularPrism',
  MetaballsSceneObject: 'metaballs',
  CsgSceneObject: 'csg',
  MandelbulbSceneObject: 'mandelbulb',
  SdfFractalSceneObject: 'sdfFractal',
  AreaLightSceneObject: 'areaLight',
  'reference-mesh': 'referenceMesh',
  'rounded-box': 'roundedBox',
  'triangular-prism': 'triangularPrism',
  'sdf-fractal': 'sdfFractal',
  'area-light': 'areaLight'
});

const isSceneSnapshotPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value)
);

const readSceneSnapshotPlainObject = (value) => (
  isSceneSnapshotPlainObject(value) ? value : {}
);

const readSceneSnapshotFirstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const readSceneSnapshotNumber = (value, fallbackValue) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
};

const readSceneSnapshotBoolean = (value, fallbackValue) => {
  if (value === true || value === false) {
    return value;
  }
  return fallbackValue;
};

const serializeSceneVec3 = (vector) => [
  Number.isFinite(vector[0]) ? vector[0] : 0,
  Number.isFinite(vector[1]) ? vector[1] : 0,
  Number.isFinite(vector[2]) ? vector[2] : 0
];

const readSceneSnapshotVec3 = (
  value,
  fallbackVector,
  minValue = -16,
  maxValue = 16
) => {
  const vector = Array.isArray(value) || ArrayBuffer.isView(value) ? value : [];
  return createVec3(
    normalizeBoundedNumber(readSceneSnapshotNumber(vector[0], fallbackVector[0]), fallbackVector[0], minValue, maxValue),
    normalizeBoundedNumber(readSceneSnapshotNumber(vector[1], fallbackVector[1]), fallbackVector[1], minValue, maxValue),
    normalizeBoundedNumber(readSceneSnapshotNumber(vector[2], fallbackVector[2]), fallbackVector[2], minValue, maxValue)
  );
};

const readSceneSnapshotPositiveVec3 = (value, fallbackVector) => (
  readSceneSnapshotVec3(value, fallbackVector, 0.0001, 16)
);

const createSceneSnapshotFileName = () => (
  `pathtracer-scene-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

const readSceneObjectSnapshotType = (sceneObject) => {
  if (isGroupEntitySceneObject(sceneObject)) {
    return 'group';
  }
  if (sceneObject instanceof LightSceneObject) {
    return 'light';
  }
  if (sceneObject instanceof SphereSceneObject) {
    return 'sphere';
  }
  if (sceneObject instanceof CubeSceneObject) {
    return 'cube';
  }
  if (sceneObject instanceof AreaLightSceneObject) {
    return 'areaLight';
  }
  if (sceneObject instanceof ReferenceMeshSceneObject) {
    return 'referenceMesh';
  }
  if (sceneObject instanceof DiskSceneObject) {
    return 'disk';
  }
  if (sceneObject instanceof TriangularPrismSceneObject) {
    return 'triangularPrism';
  }
  if (sceneObject instanceof CylinderSceneObject) {
    return 'cylinder';
  }
  if (sceneObject instanceof ConeSceneObject) {
    return 'cone';
  }
  if (sceneObject instanceof CapsuleSceneObject) {
    return 'capsule';
  }
  if (sceneObject instanceof EllipsoidSceneObject) {
    return 'ellipsoid';
  }
  if (sceneObject instanceof TorusSceneObject) {
    return 'torus';
  }
  if (sceneObject instanceof RoundedBoxSceneObject) {
    return 'roundedBox';
  }
  if (sceneObject instanceof MetaballsSceneObject) {
    return 'metaballs';
  }
  if (sceneObject instanceof CsgSceneObject) {
    return 'csg';
  }
  if (sceneObject instanceof MandelbulbSceneObject) {
    return 'mandelbulb';
  }
  if (sceneObject instanceof SdfFractalSceneObject) {
    return 'sdfFractal';
  }
  if (sceneObject instanceof WedgeSceneObject) {
    return 'wedge';
  }
  if (sceneObject instanceof SdfSceneObject) {
    return 'sdf';
  }
  return '';
};

const createSceneObjectSnapshotBase = (sceneObject, type) => {
  const objectSnapshot = {
    type,
    name: sceneObject.displayName || '',
    material: Number.isFinite(sceneObject.material) ? normalizeMaterial(sceneObject.material) : MATERIAL.DIFFUSE,
    glossiness: readSceneObjectMaterialGlossiness(sceneObject),
    hidden: Boolean(sceneObject.isHidden),
    locked: Boolean(sceneObject.isLocked)
  };
  const entityId = readSceneObjectEntityId(sceneObject);
  if (entityId !== null) {
    objectSnapshot.entityId = entityId;
  }
  const parentEntityId = readSceneObjectParentEntityId(sceneObject);
  if (parentEntityId !== null) {
    objectSnapshot.parentEntityId = parentEntityId;
  }

  if (isPhysicsSupportedSceneObject(sceneObject)) {
    objectSnapshot.physics = {
      enabled: sceneObject.isPhysicsEnabled !== false,
      bodyType: readSceneObjectPhysicsBodyType(sceneObject),
      mass: readSceneObjectPhysicsMass(sceneObject),
      gravityScale: readSceneObjectPhysicsGravityScale(sceneObject),
      friction: readSceneObjectPhysicsFriction(sceneObject),
      restitution: readSceneObjectPhysicsRestitution(sceneObject),
      collideWithObjects: sceneObject.collideWithObjects !== false
    };
  }

  if (shouldSerializeSceneObjectEmission(sceneObject)) {
    objectSnapshot.emission = {
      enabled: readSceneObjectEmissionEnabled(sceneObject),
      color: serializeSceneVec3(readSceneObjectEmissiveColor(sceneObject)),
      intensity: readSceneObjectEmissiveIntensity(sceneObject)
    };
  }

  if (hasSceneObjectCustomUvProjectionSettings(sceneObject)) {
    objectSnapshot.textureProjection = {
      mode: readSceneObjectUvProjectionMode(sceneObject),
      scale: readSceneObjectUvScale(sceneObject),
      blendSharpness: readSceneObjectUvBlendSharpness(sceneObject)
    };
  }

  return objectSnapshot;
};

const createSceneObjectSnapshot = (sceneObject) => {
  const type = readSceneObjectSnapshotType(sceneObject);
  if (!type || type === 'light') {
    return null;
  }

  if (type === 'group') {
    const objectSnapshot = {
      type,
      name: sceneObject.displayName || 'Group',
      entityId: readSceneObjectEntityId(sceneObject),
      childEntityIds: normalizeSceneEntityIdList(sceneObject.childEntityIds),
      centerPosition: serializeSceneVec3(sceneObject.centerPosition || ORIGIN_VECTOR),
      rotation: serializeSceneVec3(sceneObject.rotation || ORIGIN_VECTOR),
      scale: serializeSceneVec3(sceneObject.scale || createVec3(1, 1, 1)),
      hidden: Boolean(sceneObject.isHidden),
      locked: Boolean(sceneObject.isLocked)
    };
    const parentEntityId = readSceneObjectParentEntityId(sceneObject);
    if (parentEntityId !== null) {
      objectSnapshot.parentEntityId = parentEntityId;
    }
    return objectSnapshot;
  }

  const objectSnapshot = createSceneObjectSnapshotBase(sceneObject, type);
  if (sceneObject instanceof SphereSceneObject) {
    objectSnapshot.centerPosition = serializeSceneVec3(sceneObject.centerPosition);
    objectSnapshot.radius = sceneObject.radius;
    return objectSnapshot;
  }

  if (sceneObject instanceof CubeSceneObject) {
    objectSnapshot.minCorner = serializeSceneVec3(sceneObject.minCorner);
    objectSnapshot.maxCorner = serializeSceneVec3(sceneObject.maxCorner);
    return objectSnapshot;
  }

  if (sceneObject instanceof ReferenceMeshSceneObject) {
    objectSnapshot.modelKey = sceneObject.modelKey;
    objectSnapshot.assetPath = sceneObject.assetPath;
    objectSnapshot.centerPosition = serializeSceneVec3(sceneObject.centerPosition);
    return objectSnapshot;
  }

  if (sceneObject instanceof SdfSceneObject) {
    objectSnapshot.centerPosition = serializeSceneVec3(sceneObject.centerPosition);
    objectSnapshot.boundsHalfExtents = serializeSceneVec3(sceneObject.boundsHalfExtents);
    objectSnapshot.parameterA = serializeSceneVec3(sceneObject.parameterA);
    objectSnapshot.parameterB = serializeSceneVec3(sceneObject.parameterB);
    return objectSnapshot;
  }

  return null;
};

const createSceneSnapshot = (applicationState, sceneObjects) => ({
  schema: SCENE_FILE_SCHEMA,
  version: SCENE_FILE_VERSION,
  savedAt: new Date().toISOString(),
  settings: {
    scene: {
      material: applicationState.material,
      glossiness: applicationState.glossiness,
      environment: applicationState.environment
    },
    render: {
      lightBounceCount: applicationState.lightBounceCount,
      raysPerPixel: applicationState.raysPerPixel,
      temporalBlendFrames: applicationState.temporalBlendFrames,
      denoiserStrength: applicationState.denoiserStrength,
      renderDebugViewMode: normalizeRenderDebugViewMode(applicationState.renderDebugViewMode),
      convergenceSampleCount: applicationState.convergenceSampleCount,
      isConvergencePauseEnabled: applicationState.isConvergencePauseEnabled
    },
    camera: {
      angleX: applicationState.cameraAngleX,
      angleY: applicationState.cameraAngleY,
      distance: applicationState.cameraDistance,
      fieldOfViewDegrees: applicationState.cameraFieldOfViewDegrees,
      focusDistance: applicationState.cameraFocusDistance,
      aperture: applicationState.cameraAperture,
      motionBlurStrength: applicationState.motionBlurStrength,
      isAutoRotating: applicationState.isCameraAutoRotating,
      autoRotationSpeed: applicationState.cameraAutoRotationSpeed
    },
    light: {
      position: serializeSceneVec3(applicationState.lightPosition),
      color: serializeSceneVec3(applicationState.lightColor),
      intensity: applicationState.lightIntensity,
      size: applicationState.lightSize,
      isIntensityCycling: applicationState.isLightIntensityCycling
    },
    physics: {
      gravityDirection: normalizeGlobalGravityDirection(applicationState.physicsGravityDirection),
      gravityMagnitude: normalizeGlobalGravityMagnitude(applicationState.physicsGravityMagnitude),
      customGravityDirection: serializeSceneVec3(ensureApplicationStateCustomGravityDirection(applicationState)),
      gravityScale: readApplicationStateGravityScale(applicationState)
    },
    color: {
      exposure: applicationState.colorExposure,
      brightness: applicationState.colorBrightness,
      contrast: applicationState.colorContrast,
      saturation: applicationState.colorSaturation,
      gamma: applicationState.colorGamma,
      toneMappingMode: applicationState.toneMappingMode,
      bloomStrength: applicationState.bloomStrength,
      bloomThreshold: applicationState.bloomThreshold,
      glareStrength: applicationState.glareStrength
    },
    output: {
      renderWidth: CANVAS_RENDER_WIDTH,
      renderHeight: CANVAS_RENDER_HEIGHT,
      renderScale: CANVAS_RENDER_SCALE
    }
  },
  objects: sceneObjects
    .map(createSceneObjectSnapshot)
    .filter((objectSnapshot) => objectSnapshot !== null)
});

const normalizeSceneObjectSnapshotType = (typeValue) => {
  const rawType = String(typeValue || '').trim();
  return SCENE_OBJECT_TYPE_ALIASES[rawType] || rawType;
};

const readSceneObjectSnapshotEntityId = (objectSnapshot) => (
  normalizeSceneEntityId(readSceneSnapshotFirstDefined(
    objectSnapshot.entityId,
    objectSnapshot.id,
    objectSnapshot.sceneObjectId,
    objectSnapshot.objectId
  ))
);

const allocateSceneObjectIdFromSnapshot = (applicationState, objectSnapshot) => {
  const entityId = readSceneObjectSnapshotEntityId(objectSnapshot);
  const numericEntityId = Number(entityId);
  if (Number.isInteger(numericEntityId) && numericEntityId > 0) {
    applicationState.nextObjectId = Math.max(applicationState.nextObjectId, numericEntityId + 1);
    return numericEntityId;
  }
  return allocateSceneObjectId(applicationState);
};

const applySceneObjectSnapshotIdentityFields = (sceneObject, objectSnapshot) => {
  const entityId = readSceneObjectSnapshotEntityId(objectSnapshot);
  if (entityId !== null) {
    sceneObject.entityId = entityId;
  }
  sceneObject.parentEntityId = normalizeSceneEntityId(readSceneSnapshotFirstDefined(
    objectSnapshot.parentEntityId,
    objectSnapshot.parentId
  ));
  return sceneObject;
};

const applySceneObjectSnapshotCommonFields = (sceneObject, objectSnapshot) => {
  applySceneObjectSnapshotIdentityFields(sceneObject, objectSnapshot);
  const objectName = readSceneSnapshotFirstDefined(objectSnapshot.name, objectSnapshot.displayName);
  sceneObject.displayName = typeof objectName === 'string' ? objectName.trim().slice(0, 96) : '';
  sceneObject.isHidden = readSceneSnapshotBoolean(
    readSceneSnapshotFirstDefined(objectSnapshot.hidden, objectSnapshot.isHidden),
    false
  );
  sceneObject.isLocked = readSceneSnapshotBoolean(
    readSceneSnapshotFirstDefined(objectSnapshot.locked, objectSnapshot.isLocked),
    false
  );
  sceneObject.glossiness = normalizeSceneObjectMaterialGlossiness(readSceneSnapshotNumber(
    readSceneSnapshotFirstDefined(objectSnapshot.glossiness, objectSnapshot.materialGlossiness),
    sceneObject.glossiness
  ));
  const textureProjectionSnapshot = readSceneSnapshotPlainObject(readSceneSnapshotFirstDefined(
    objectSnapshot.textureProjection,
    objectSnapshot.uvProjection
  ));
  sceneObject.uvProjectionMode = normalizeMaterialUvProjectionMode(readSceneSnapshotFirstDefined(
    textureProjectionSnapshot.mode,
    textureProjectionSnapshot.uvProjectionMode,
    objectSnapshot.uvProjectionMode,
    objectSnapshot.textureProjectionMode
  ));
  sceneObject.uvScale = normalizeMaterialUvScale(readSceneSnapshotNumber(
    readSceneSnapshotFirstDefined(
      textureProjectionSnapshot.scale,
      textureProjectionSnapshot.uvScale,
      objectSnapshot.uvScale,
      objectSnapshot.textureProjectionScale
    ),
    sceneObject.uvScale
  ));
  sceneObject.uvBlendSharpness = normalizeMaterialUvBlendSharpness(readSceneSnapshotNumber(
    readSceneSnapshotFirstDefined(
      textureProjectionSnapshot.blendSharpness,
      textureProjectionSnapshot.uvBlendSharpness,
      objectSnapshot.uvBlendSharpness,
      objectSnapshot.textureProjectionBlendSharpness
    ),
    sceneObject.uvBlendSharpness
  ));

  const emissiveSnapshot = readSceneSnapshotPlainObject(
    readSceneSnapshotFirstDefined(objectSnapshot.emissive, objectSnapshot.emission)
  );
  const hasEmissionSnapshot = (
    Object.prototype.hasOwnProperty.call(objectSnapshot, 'emissive') ||
    Object.prototype.hasOwnProperty.call(objectSnapshot, 'emission') ||
    Object.prototype.hasOwnProperty.call(objectSnapshot, 'emissiveColor') ||
    Object.prototype.hasOwnProperty.call(objectSnapshot, 'emissiveIntensity') ||
    Object.prototype.hasOwnProperty.call(objectSnapshot, 'emissionEnabled') ||
    Object.prototype.hasOwnProperty.call(objectSnapshot, 'isEmissionEnabled')
  );
  const emissiveColor = readSceneSnapshotVec3(
    readSceneSnapshotFirstDefined(
      emissiveSnapshot.color,
      emissiveSnapshot.emissiveColor,
      objectSnapshot.emissiveColor
    ),
    readSceneObjectEmissiveColor(sceneObject),
    0,
    1
  );
  const emissiveIntensity = normalizeEmissiveIntensity(readSceneSnapshotNumber(
    readSceneSnapshotFirstDefined(
      emissiveSnapshot.intensity,
      emissiveSnapshot.strength,
      emissiveSnapshot.emissiveIntensity,
      objectSnapshot.emissiveIntensity
    ),
    readSceneObjectEmissiveIntensity(sceneObject)
  ));
  const isEmissionEnabled = readSceneSnapshotBoolean(
    readSceneSnapshotFirstDefined(
      emissiveSnapshot.enabled,
      emissiveSnapshot.isEnabled,
      emissiveSnapshot.emissionEnabled,
      objectSnapshot.emissionEnabled,
      objectSnapshot.isEmissionEnabled
    ),
    hasEmissionSnapshot ? true : readSceneObjectEmissionEnabled(sceneObject)
  );
  writeSceneObjectEmissiveSettings(sceneObject, emissiveColor, emissiveIntensity, isEmissionEnabled);

  if (!isPhysicsSupportedSceneObject(sceneObject)) {
    return sceneObject;
  }

  const physicsSnapshot = readSceneSnapshotPlainObject(objectSnapshot.physics);
  sceneObject.isPhysicsEnabled = readSceneSnapshotBoolean(
    readSceneSnapshotFirstDefined(physicsSnapshot.enabled, physicsSnapshot.isEnabled),
    sceneObject.isPhysicsEnabled !== false
  );
  sceneObject.physicsBodyType = normalizePhysicsBodyType(
    physicsSnapshot.bodyType,
    getDefaultPhysicsBodyType(sceneObject)
  );
  sceneObject.physicsMass = normalizeBoundedNumber(
    readSceneSnapshotNumber(
      readSceneSnapshotFirstDefined(physicsSnapshot.mass, physicsSnapshot.physicsMass),
      sceneObject.physicsMass
    ),
    getDefaultPhysicsMass(sceneObject),
    MIN_PHYSICS_MASS,
    MAX_PHYSICS_MASS
  );
  sceneObject.physicsGravityScale = normalizeBoundedNumber(
    readSceneSnapshotNumber(
      readSceneSnapshotFirstDefined(physicsSnapshot.gravityScale, physicsSnapshot.gravity),
      sceneObject.physicsGravityScale
    ),
    getDefaultPhysicsGravityScale(sceneObject),
    MIN_PHYSICS_GRAVITY_SCALE,
    MAX_PHYSICS_GRAVITY_SCALE
  );
  sceneObject.physicsFriction = normalizeBoundedNumber(
    readSceneSnapshotNumber(physicsSnapshot.friction, sceneObject.physicsFriction),
    getDefaultPhysicsFriction(sceneObject),
    MIN_PHYSICS_SURFACE_COEFFICIENT,
    MAX_PHYSICS_SURFACE_COEFFICIENT
  );
  sceneObject.physicsRestitution = normalizeBoundedNumber(
    readSceneSnapshotNumber(physicsSnapshot.restitution, sceneObject.physicsRestitution),
    getDefaultPhysicsRestitution(sceneObject),
    MIN_PHYSICS_SURFACE_COEFFICIENT,
    MAX_PHYSICS_SURFACE_COEFFICIENT
  );
  sceneObject.collideWithObjects = readSceneSnapshotBoolean(
    physicsSnapshot.collideWithObjects,
    sceneObject.collideWithObjects !== false
  );
  return sceneObject;
};

const sanitizeSceneCubeCorners = (minCorner, maxCorner) => {
  for (let componentIndex = 0; componentIndex < FLOATS_PER_VEC3; componentIndex += 1) {
    if (maxCorner[componentIndex] <= minCorner[componentIndex]) {
      const centerValue = (minCorner[componentIndex] + maxCorner[componentIndex]) * 0.5;
      minCorner[componentIndex] = centerValue - 0.01;
      maxCorner[componentIndex] = centerValue + 0.01;
    }
  }
  return returnSuccess(undefined);
};

const createSceneObjectFromSnapshot = (applicationState, objectSnapshotValue) => {
  const objectSnapshot = readSceneSnapshotPlainObject(objectSnapshotValue);
  const objectType = normalizeSceneObjectSnapshotType(
    readSceneSnapshotFirstDefined(objectSnapshot.type, objectSnapshot.kind)
  );
  if (!objectType || objectType === 'light') {
    return null;
  }

  const material = normalizeMaterial(readSceneSnapshotNumber(objectSnapshot.material, MATERIAL.DIFFUSE));
  if (objectType === 'sphere') {
    return applySceneObjectSnapshotCommonFields(
      new SphereSceneObject(
        readSceneSnapshotVec3(objectSnapshot.centerPosition, ORIGIN_VECTOR, -8, 8),
        normalizeBoundedNumber(readSceneSnapshotNumber(objectSnapshot.radius, 0.25), 0.25, 0.001, 8),
        allocateSceneObjectIdFromSnapshot(applicationState, objectSnapshot),
        material
      ),
      objectSnapshot
    );
  }

  if (objectType === 'cube') {
    const minCorner = readSceneSnapshotVec3(objectSnapshot.minCorner, createVec3(-0.25, -0.25, -0.25), -8, 8);
    const maxCorner = readSceneSnapshotVec3(objectSnapshot.maxCorner, createVec3(0.25, 0.25, 0.25), -8, 8);
    sanitizeSceneCubeCorners(minCorner, maxCorner);
    return applySceneObjectSnapshotCommonFields(
      new CubeSceneObject(minCorner, maxCorner, allocateSceneObjectIdFromSnapshot(applicationState, objectSnapshot), material),
      objectSnapshot
    );
  }

  if (objectType === 'referenceMesh') {
    const modelKey = readReferenceMeshModelKey(readSceneSnapshotFirstDefined(
      objectSnapshot.modelKey,
      objectSnapshot.referenceModel,
      objectSnapshot.assetKey
    ));
    return applySceneObjectSnapshotCommonFields(
      new ReferenceMeshSceneObject(
        readReferenceMeshModel(modelKey),
        readSceneSnapshotVec3(objectSnapshot.centerPosition, createVec3(0, -0.54, 0), -8, 8),
        allocateSceneObjectIdFromSnapshot(applicationState, objectSnapshot),
        material,
        modelKey
      ),
      objectSnapshot
    );
  }

  if (objectType === 'group') {
    const groupEntityId = readSceneObjectSnapshotEntityId(objectSnapshot);
    const numericGroupEntityId = Number(groupEntityId);
    if (Number.isInteger(numericGroupEntityId) && numericGroupEntityId > 0) {
      applicationState.nextObjectId = Math.max(applicationState.nextObjectId, numericGroupEntityId + 1);
    }
    const groupEntity = new GroupEntity({
      entityId: groupEntityId ?? `group-${allocateSceneObjectId(applicationState)}`,
      parentEntityId: readSceneSnapshotFirstDefined(objectSnapshot.parentEntityId, objectSnapshot.parentId),
      name: readSceneSnapshotFirstDefined(objectSnapshot.name, objectSnapshot.displayName),
      childEntityIds: objectSnapshot.childEntityIds,
      centerPosition: readSceneSnapshotVec3(objectSnapshot.centerPosition, ORIGIN_VECTOR, -8, 8),
      rotation: readSceneSnapshotVec3(objectSnapshot.rotation, ORIGIN_VECTOR, -360, 360),
      scale: readSceneSnapshotPositiveVec3(objectSnapshot.scale, createVec3(1, 1, 1)),
      hidden: readSceneSnapshotBoolean(
        readSceneSnapshotFirstDefined(objectSnapshot.hidden, objectSnapshot.isHidden),
        false
      ),
      locked: readSceneSnapshotBoolean(
        readSceneSnapshotFirstDefined(objectSnapshot.locked, objectSnapshot.isLocked),
        false
      )
    });
    return applySceneObjectSnapshotIdentityFields(groupEntity, objectSnapshot);
  }

  const sdfPrototype = SCENE_OBJECT_SDF_PROTOTYPES[objectType];
  if (!sdfPrototype) {
    return null;
  }

  const sceneObject = new SdfSceneObject(
    readSceneSnapshotVec3(objectSnapshot.centerPosition, ORIGIN_VECTOR, -8, 8),
    readSceneSnapshotPositiveVec3(objectSnapshot.boundsHalfExtents, createVec3(0.25, 0.25, 0.25)),
    readSceneSnapshotVec3(objectSnapshot.parameterA, createVec3(0.25, 0.25, 0.25), -16, 16),
    readSceneSnapshotVec3(objectSnapshot.parameterB, ORIGIN_VECTOR, -16, 16),
    allocateSceneObjectIdFromSnapshot(applicationState, objectSnapshot),
    objectType === 'areaLight' ? MATERIAL.DIFFUSE : material
  );
  Object.setPrototypeOf(sceneObject, sdfPrototype);
  return applySceneObjectSnapshotCommonFields(sceneObject, objectSnapshot);
};

const createSceneObjectsFromSnapshot = (applicationState, objectsSnapshot) => {
  if (!Array.isArray(objectsSnapshot)) {
    return [];
  }

  const sceneObjects = [];
  for (const objectSnapshot of objectsSnapshot) {
    const sceneObject = createSceneObjectFromSnapshot(applicationState, objectSnapshot);
    if (sceneObject) {
      sceneObjects.push(sceneObject);
    }
  }
  syncSceneGroupEntityChildren(sceneObjects);
  return sceneObjects;
};

const hasSceneSnapshotOwnField = (sourceObject, fieldName) => (
  isSceneSnapshotPlainObject(sourceObject) &&
  Object.prototype.hasOwnProperty.call(sourceObject, fieldName)
);

const hasAnySceneSnapshotOwnField = (sourceObject, fieldNames) => (
  fieldNames.some((fieldName) => hasSceneSnapshotOwnField(sourceObject, fieldName))
);

const applySceneMetadataGravityToState = (applicationState, metadataValue) => {
  const metadata = readSceneSnapshotPlainObject(metadataValue);
  const gravityVector = readSceneSnapshotFirstDefined(metadata.gravityVector, metadata.gravity);
  if (Array.isArray(gravityVector) || ArrayBuffer.isView(gravityVector)) {
    return writeApplicationStateGravityFromVector(applicationState, gravityVector);
  }

  const hasExplicitGravitySettings = hasAnySceneSnapshotOwnField(metadata, [
    'gravityDirection',
    'gravityMagnitude',
    'customGravityDirection'
  ]);
  if (hasExplicitGravitySettings) {
    const customDirection = ensureApplicationStateCustomGravityDirection(applicationState);
    const customDirectionSnapshot = readSceneSnapshotFirstDefined(
      metadata.customGravityDirection,
      metadata.gravityCustomDirection
    );
    if (Array.isArray(customDirectionSnapshot) || ArrayBuffer.isView(customDirectionSnapshot)) {
      writeNormalizedGravityDirection(
        customDirection,
        readSceneSnapshotNumber(customDirectionSnapshot[0], customDirection[0]),
        readSceneSnapshotNumber(customDirectionSnapshot[1], customDirection[1]),
        readSceneSnapshotNumber(customDirectionSnapshot[2], customDirection[2])
      );
    }
    applicationState.physicsGravityDirection = normalizeGlobalGravityDirection(
      readSceneSnapshotFirstDefined(metadata.gravityDirection, metadata.direction)
    );
    applicationState.physicsGravityMagnitude = normalizeGlobalGravityMagnitude(
      readSceneSnapshotNumber(metadata.gravityMagnitude, applicationState.physicsGravityMagnitude),
      applicationState.physicsGravityMagnitude
    );
    if (applicationState.physicsGravityDirection === GLOBAL_GRAVITY_DIRECTION.ZERO_G) {
      applicationState.physicsGravityMagnitude = 0;
    }
    return returnSuccess(undefined);
  }

  if (hasSceneSnapshotOwnField(metadata, 'gravityScale')) {
    return writeApplicationStateGravityFromScale(applicationState, metadata.gravityScale);
  }

  return returnSuccess(undefined);
};

const addMissingSceneSnapshotSettingField = (
  missingFields,
  settingsSnapshot,
  sectionName,
  fieldNames,
  fallbackFieldNames = fieldNames
) => {
  const sectionSnapshot = readSceneSnapshotPlainObject(settingsSnapshot[sectionName]);
  if (
    hasAnySceneSnapshotOwnField(sectionSnapshot, fieldNames) ||
    hasAnySceneSnapshotOwnField(settingsSnapshot, fallbackFieldNames)
  ) {
    return returnSuccess(undefined);
  }

  missingFields.push(`settings.${sectionName}.${fieldNames[0]}`);
  return returnSuccess(undefined);
};

const readSceneSnapshotObjectRequiredFieldGroups = (objectType) => {
  if (objectType === 'sphere') {
    return Object.freeze([Object.freeze(['centerPosition']), Object.freeze(['radius'])]);
  }
  if (objectType === 'cube') {
    return Object.freeze([Object.freeze(['minCorner']), Object.freeze(['maxCorner'])]);
  }
  if (objectType === 'referenceMesh') {
    return Object.freeze([Object.freeze(['centerPosition'])]);
  }
  if (SCENE_OBJECT_SDF_PROTOTYPES[objectType]) {
    return Object.freeze([
      Object.freeze(['centerPosition']),
      Object.freeze(['boundsHalfExtents']),
      Object.freeze(['parameterA']),
      Object.freeze(['parameterB'])
    ]);
  }
  return Object.freeze([]);
};

const logSceneSnapshotDefaultedFields = (snapshotValue) => {
  const snapshot = readSceneSnapshotPlainObject(snapshotValue);
  const settingsSnapshot = readSceneSnapshotPlainObject(snapshot.settings);
  const missingFields = [];
  const unsupportedObjectTypes = [];

  if (!isSceneSnapshotPlainObject(snapshot.settings)) {
    missingFields.push('settings');
  }

  addMissingSceneSnapshotSettingField(missingFields, settingsSnapshot, 'scene', ['material']);
  addMissingSceneSnapshotSettingField(missingFields, settingsSnapshot, 'scene', ['glossiness']);
  addMissingSceneSnapshotSettingField(missingFields, settingsSnapshot, 'scene', ['environment']);
  for (const renderFieldName of [
    'lightBounceCount',
    'raysPerPixel',
    'temporalBlendFrames',
    'denoiserStrength',
    'renderDebugViewMode',
    'convergenceSampleCount',
    'isConvergencePauseEnabled'
  ]) {
    addMissingSceneSnapshotSettingField(missingFields, settingsSnapshot, 'render', [renderFieldName]);
  }
  for (const cameraFieldName of [
    'angleX',
    'angleY',
    'distance',
    'fieldOfViewDegrees',
    'focusDistance',
    'aperture',
    'motionBlurStrength',
    'isAutoRotating',
    'autoRotationSpeed'
  ]) {
    addMissingSceneSnapshotSettingField(missingFields, settingsSnapshot, 'camera', [cameraFieldName]);
  }
  for (const lightFieldName of ['position', 'color', 'intensity', 'size', 'isIntensityCycling']) {
    addMissingSceneSnapshotSettingField(missingFields, settingsSnapshot, 'light', [lightFieldName]);
  }
  for (const colorFieldName of [
    'exposure',
    'brightness',
    'contrast',
    'saturation',
    'gamma',
    'bloomStrength',
    'bloomThreshold',
    'glareStrength'
  ]) {
    addMissingSceneSnapshotSettingField(missingFields, settingsSnapshot, 'color', [colorFieldName]);
  }

  if (!Array.isArray(snapshot.objects)) {
    missingFields.push('objects');
  } else {
    for (let objectIndex = 0; objectIndex < snapshot.objects.length; objectIndex += 1) {
      const objectSnapshot = readSceneSnapshotPlainObject(snapshot.objects[objectIndex]);
      if (!isSceneSnapshotPlainObject(snapshot.objects[objectIndex])) {
        missingFields.push(`objects[${objectIndex}]`);
        continue;
      }

      if (!hasAnySceneSnapshotOwnField(objectSnapshot, ['type', 'kind'])) {
        missingFields.push(`objects[${objectIndex}].type`);
      }

      const objectType = normalizeSceneObjectSnapshotType(
        readSceneSnapshotFirstDefined(objectSnapshot.type, objectSnapshot.kind)
      );
      if (!objectType || objectType === 'light') {
        continue;
      }
      if (
        objectType !== 'sphere' &&
        objectType !== 'cube' &&
        objectType !== 'referenceMesh' &&
        !SCENE_OBJECT_SDF_PROTOTYPES[objectType]
      ) {
        unsupportedObjectTypes.push(String(objectType));
        continue;
      }

      if (!hasSceneSnapshotOwnField(objectSnapshot, 'material')) {
        missingFields.push(`objects[${objectIndex}].material`);
      }
      for (const fieldGroup of readSceneSnapshotObjectRequiredFieldGroups(objectType)) {
        if (!hasAnySceneSnapshotOwnField(objectSnapshot, fieldGroup)) {
          missingFields.push(`objects[${objectIndex}].${fieldGroup[0]}`);
        }
      }
    }
  }

  if (missingFields.length === 0 && unsupportedObjectTypes.length === 0) {
    return returnSuccess(undefined);
  }

  logDiagnostic('warn', 'sceneLoad', 'Scene JSON contained missing/defaulted fields.', Object.freeze({
    missingFieldExamples: Object.freeze(missingFields.slice(0, 64)),
    totalMissingFieldCount: missingFields.length,
    unsupportedObjectTypes: Object.freeze(unsupportedObjectTypes.slice(0, 16))
  }));
  return returnSuccess(undefined);
};

const applySceneSnapshotSettingsToState = (applicationState, snapshotValue) => {
  const snapshot = readSceneSnapshotPlainObject(snapshotValue);
  const settings = readSceneSnapshotPlainObject(snapshot.settings);
  const sceneSettings = readSceneSnapshotPlainObject(settings.scene);
  const renderSettings = readSceneSnapshotPlainObject(settings.render);
  const cameraSettings = readSceneSnapshotPlainObject(settings.camera);
  const lightSettings = readSceneSnapshotPlainObject(settings.light);
  const physicsSettings = readSceneSnapshotPlainObject(settings.physics);
  const colorSettings = readSceneSnapshotPlainObject(settings.color);

  applicationState.material = normalizeMaterial(
    readSceneSnapshotNumber(readSceneSnapshotFirstDefined(sceneSettings.material, settings.material), applicationState.material)
  );
  applicationState.glossiness = normalizeBoundedNumber(
    readSceneSnapshotNumber(readSceneSnapshotFirstDefined(sceneSettings.glossiness, settings.glossiness), applicationState.glossiness),
    applicationState.glossiness,
    0,
    1
  );
  applicationState.environment = normalizeBoundedInteger(
    readSceneSnapshotNumber(readSceneSnapshotFirstDefined(sceneSettings.environment, settings.environment), applicationState.environment),
    applicationState.environment,
    ENVIRONMENT.YELLOW_BLUE_CORNELL_BOX,
    ENVIRONMENT.OPEN_SKY_STUDIO
  );
  const [, gravitySettingsError] = applySceneMetadataGravityToState(
    applicationState,
    isSceneSnapshotPlainObject(settings.physics) ? physicsSettings : settings
  );
  if (gravitySettingsError) {
    return returnFailure(gravitySettingsError.code, gravitySettingsError.message, gravitySettingsError.details);
  }

  applicationState.lightBounceCount = normalizeBoundedInteger(
    readSceneSnapshotNumber(renderSettings.lightBounceCount, applicationState.lightBounceCount),
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  applicationState.raysPerPixel = normalizeBoundedInteger(
    readSceneSnapshotNumber(renderSettings.raysPerPixel, applicationState.raysPerPixel),
    DEFAULT_RAYS_PER_PIXEL,
    MIN_RAYS_PER_PIXEL,
    MAX_RAYS_PER_PIXEL
  );
  applicationState.temporalBlendFrames = normalizeBoundedInteger(
    readSceneSnapshotNumber(renderSettings.temporalBlendFrames, applicationState.temporalBlendFrames),
    DEFAULT_TEMPORAL_BLEND_FRAMES,
    MIN_TEMPORAL_BLEND_FRAMES,
    MAX_TEMPORAL_BLEND_FRAMES
  );
  applicationState.denoiserStrength = normalizeBoundedNumber(
    readSceneSnapshotNumber(renderSettings.denoiserStrength, applicationState.denoiserStrength),
    DEFAULT_DENOISER_STRENGTH,
    MIN_DENOISER_STRENGTH,
    MAX_DENOISER_STRENGTH
  );
  applicationState.renderDebugViewMode = normalizeRenderDebugViewMode(
    readSceneSnapshotNumber(renderSettings.renderDebugViewMode, applicationState.renderDebugViewMode)
  );
  applicationState.convergenceSampleCount = normalizeBoundedInteger(
    readSceneSnapshotNumber(renderSettings.convergenceSampleCount, applicationState.convergenceSampleCount),
    CONVERGED_SAMPLE_COUNT,
    1,
    1000000
  );
  applicationState.isConvergencePauseEnabled = readSceneSnapshotBoolean(
    renderSettings.isConvergencePauseEnabled,
    false
  );

  applicationState.cameraAngleX = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.angleX, applicationState.cameraAngleX),
    applicationState.cameraAngleX,
    -CAMERA_PITCH_LIMIT,
    CAMERA_PITCH_LIMIT
  );
  applicationState.cameraAngleY = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.angleY, applicationState.cameraAngleY),
    applicationState.cameraAngleY,
    -Math.PI,
    Math.PI
  );
  applicationState.cameraDistance = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.distance, applicationState.cameraDistance),
    INITIAL_CAMERA_DISTANCE,
    0.5,
    10
  );
  applicationState.cameraFieldOfViewDegrees = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.fieldOfViewDegrees, applicationState.cameraFieldOfViewDegrees),
    DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES,
    MIN_CAMERA_FIELD_OF_VIEW_DEGREES,
    MAX_CAMERA_FIELD_OF_VIEW_DEGREES
  );
  applicationState.cameraFocusDistance = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.focusDistance, applicationState.cameraFocusDistance),
    DEFAULT_CAMERA_FOCUS_DISTANCE,
    MIN_CAMERA_FOCUS_DISTANCE,
    MAX_CAMERA_FOCUS_DISTANCE
  );
  applicationState.cameraAperture = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.aperture, applicationState.cameraAperture),
    DEFAULT_CAMERA_APERTURE,
    MIN_CAMERA_APERTURE,
    MAX_CAMERA_APERTURE
  );
  applicationState.motionBlurStrength = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.motionBlurStrength, applicationState.motionBlurStrength),
    DEFAULT_MOTION_BLUR_STRENGTH,
    MIN_MOTION_BLUR_STRENGTH,
    MAX_MOTION_BLUR_STRENGTH
  );
  applicationState.isCameraAutoRotating = readSceneSnapshotBoolean(
    cameraSettings.isAutoRotating,
    applicationState.isCameraAutoRotating
  );
  applicationState.cameraAutoRotationSpeed = normalizeBoundedNumber(
    readSceneSnapshotNumber(cameraSettings.autoRotationSpeed, applicationState.cameraAutoRotationSpeed),
    CAMERA_AUTO_ROTATION_SPEED,
    0,
    CAMERA_AUTO_ROTATION_SPEED
  );
  applicationState.cameraMode = CAMERA_MODE_ORBIT;
  writeOrbitEyePosition(
    applicationState.fpsEyePosition,
    applicationState.cameraAngleX,
    applicationState.cameraAngleY,
    applicationState.cameraDistance
  );
  applicationState.isPointerLocked = false;
  clearFpsMovementState(applicationState);

  applicationState.lightIntensity = normalizeBoundedNumber(
    readSceneSnapshotNumber(lightSettings.intensity, applicationState.lightIntensity),
    DEFAULT_LIGHT_INTENSITY,
    MIN_LIGHT_INTENSITY,
    MAX_LIGHT_INTENSITY
  );
  applicationState.lightSize = normalizeBoundedNumber(
    readSceneSnapshotNumber(lightSettings.size, applicationState.lightSize),
    DEFAULT_LIGHT_SIZE,
    MIN_LIGHT_SIZE,
    MAX_LIGHT_SIZE
  );
  const lightPosition = readSceneSnapshotVec3(lightSettings.position, applicationState.lightPosition, -1, 1);
  const clampedLightPosition = clampLightPosition(lightPosition, applicationState.lightSize);
  writeVec3(applicationState.lightPosition, clampedLightPosition[0], clampedLightPosition[1], clampedLightPosition[2]);
  const lightColor = readSceneSnapshotVec3(lightSettings.color, applicationState.lightColor, 0, 1);
  writeVec3(applicationState.lightColor, lightColor[0], lightColor[1], lightColor[2]);
  applicationState.isLightIntensityCycling = readSceneSnapshotBoolean(
    lightSettings.isIntensityCycling,
    false
  );
  applicationState.lightIntensityCycleDirection = 1;

  applicationState.colorExposure = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.exposure, applicationState.colorExposure),
    DEFAULT_COLOR_EXPOSURE,
    MIN_COLOR_EXPOSURE,
    MAX_COLOR_EXPOSURE
  );
  applicationState.colorBrightness = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.brightness, applicationState.colorBrightness),
    DEFAULT_COLOR_BRIGHTNESS,
    MIN_COLOR_BRIGHTNESS,
    MAX_COLOR_BRIGHTNESS
  );
  applicationState.colorContrast = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.contrast, applicationState.colorContrast),
    DEFAULT_COLOR_CONTRAST,
    MIN_COLOR_CONTRAST,
    MAX_COLOR_CONTRAST
  );
  applicationState.colorSaturation = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.saturation, applicationState.colorSaturation),
    DEFAULT_COLOR_SATURATION,
    MIN_COLOR_SATURATION,
    MAX_COLOR_SATURATION
  );
  applicationState.colorGamma = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.gamma, applicationState.colorGamma),
    DEFAULT_COLOR_GAMMA,
    MIN_COLOR_GAMMA,
    MAX_COLOR_GAMMA
  );
  applicationState.toneMappingMode = normalizeToneMappingMode(
    readSceneSnapshotNumber(colorSettings.toneMappingMode, applicationState.toneMappingMode)
  );
  applicationState.bloomStrength = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.bloomStrength, applicationState.bloomStrength),
    DEFAULT_BLOOM_STRENGTH,
    MIN_BLOOM_STRENGTH,
    MAX_BLOOM_STRENGTH
  );
  applicationState.bloomThreshold = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.bloomThreshold, applicationState.bloomThreshold),
    DEFAULT_BLOOM_THRESHOLD,
    MIN_BLOOM_THRESHOLD,
    MAX_BLOOM_THRESHOLD
  );
  applicationState.glareStrength = normalizeBoundedNumber(
    readSceneSnapshotNumber(colorSettings.glareStrength, applicationState.glareStrength),
    DEFAULT_GLARE_STRENGTH,
    MIN_GLARE_STRENGTH,
    MAX_GLARE_STRENGTH
  );

  applicationState.isFramePaused = false;
  applicationState.didResumeFromFramePause = true;
  applicationState.isConvergencePaused = false;
  applicationState.isPickingFocus = false;
  applicationState.isRotatingCamera = false;
  applicationState.isPointerDown = false;
  applicationState.isBenchmarkModeActive = false;
  applicationState.activeBenchmarkSceneName = null;
  return clearSceneAnimation(applicationState);
};

const parseSceneSnapshotJson = (jsonText) => {
  let snapshot = null;
  try {
    snapshot = JSON.parse(jsonText);
  } catch (parseError) {
    return returnFailure('invalid-scene-json', 'Scene JSON could not be parsed.', readErrorMessage(parseError));
  }

  if (!isSceneSnapshotPlainObject(snapshot)) {
    return returnFailure('invalid-scene-json', 'Scene JSON root must be an object.');
  }
  if (!Array.isArray(snapshot.objects) && !isSceneSnapshotPlainObject(snapshot.settings)) {
    return returnFailure('invalid-scene-json', 'Scene JSON must include settings or objects.');
  }
  return returnSuccess(snapshot);
};

const createStacksSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.5, -0.75, -0.5, 0.5, -0.7, 0.5),
  createCubeObject(applicationState, -0.45, -1, -0.45, -0.4, -0.45, -0.4),
  createCubeObject(applicationState, 0.4, -1, -0.45, 0.45, -0.45, -0.4),
  createCubeObject(applicationState, -0.45, -1, 0.4, -0.4, -0.45, 0.45),
  createCubeObject(applicationState, 0.4, -1, 0.4, 0.45, -0.45, 0.45),
  createCubeObject(applicationState, -0.3, -0.5, -0.3, 0.3, -0.45, 0.3),
  createCubeObject(applicationState, -0.25, -0.7, -0.25, -0.2, -0.25, -0.2),
  createCubeObject(applicationState, 0.2, -0.7, -0.25, 0.25, -0.25, -0.2),
  createCubeObject(applicationState, -0.25, -0.7, 0.2, -0.2, -0.25, 0.25),
  createCubeObject(applicationState, 0.2, -0.7, 0.2, 0.25, -0.25, 0.25),
  createCubeObject(applicationState, -0.25, -0.25, -0.25, 0.25, -0.2, 0.25)
]);

const createTableAndChairSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.5, -0.35, -0.5, 0.3, -0.3, 0.5),
  createCubeObject(applicationState, -0.45, -1, -0.45, -0.4, -0.35, -0.4),
  createCubeObject(applicationState, 0.2, -1, -0.45, 0.25, -0.35, -0.4),
  createCubeObject(applicationState, -0.45, -1, 0.4, -0.4, -0.35, 0.45),
  createCubeObject(applicationState, 0.2, -1, 0.4, 0.25, -0.35, 0.45),
  createCubeObject(applicationState, 0.3, -0.6, -0.2, 0.7, -0.55, 0.2),
  createCubeObject(applicationState, 0.3, -1, -0.2, 0.35, -0.6, -0.15),
  createCubeObject(applicationState, 0.3, -1, 0.15, 0.35, -0.6, 0.2),
  createCubeObject(applicationState, 0.65, -1, -0.2, 0.7, 0.1, -0.15),
  createCubeObject(applicationState, 0.65, -1, 0.15, 0.7, 0.1, 0.2),
  createCubeObject(applicationState, 0.65, 0.05, -0.15, 0.7, 0.1, 0.15),
  createCubeObject(applicationState, 0.65, -0.55, -0.09, 0.7, 0.1, -0.03),
  createCubeObject(applicationState, 0.65, -0.55, 0.03, 0.7, 0.1, 0.09),
  createSphereObject(applicationState, -0.1, -0.05, 0, 0.25)
]);

const createSphereAndCubeSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.25, -1, -0.25, 0.25, -0.75, 0.25),
  createSphereObject(applicationState, 0, -0.75, 0, 0.25)
]);

const createSphereColumnSceneObjects = (applicationState) => returnSuccess([
  createSphereObject(applicationState, 0, 0.75, 0, 0.25),
  createSphereObject(applicationState, 0, 0.25, 0, 0.25),
  createSphereObject(applicationState, 0, -0.25, 0, 0.25),
  createSphereObject(applicationState, 0, -0.75, 0, 0.25)
]);

const createCubeAndSpheresSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.25, -0.25, -0.25, 0.25, 0.25, 0.25),
  createSphereObject(applicationState, -0.25, 0, 0, 0.25),
  createSphereObject(applicationState, 0.25, 0, 0, 0.25),
  createSphereObject(applicationState, 0, -0.25, 0, 0.25),
  createSphereObject(applicationState, 0, 0.25, 0, 0.25),
  createSphereObject(applicationState, 0, 0, -0.25, 0.25),
  createSphereObject(applicationState, 0, 0, 0.25, 0.25)
]);

const createSpherePyramidSceneObjects = (applicationState) => {
  const root3Over4 = 0.433012701892219;
  const root3Over6 = 0.288675134594813;
  const root6Over6 = 0.408248290463863;

  return returnSuccess([
    createSphereObject(applicationState, -0.5, -0.75, -root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75, -root3Over6, 0.25),
    createSphereObject(applicationState, 0.5, -0.75, -root3Over6, 0.25),
    createSphereObject(applicationState, -0.25, -0.75, root3Over4 - root3Over6, 0.25),
    createSphereObject(applicationState, 0.25, -0.75, root3Over4 - root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75, 2 * root3Over4 - root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75 + root6Over6, root3Over6, 0.25),
    createSphereObject(applicationState, -0.25, -0.75 + root6Over6, -0.5 * root3Over6, 0.25),
    createSphereObject(applicationState, 0.25, -0.75 + root6Over6, -0.5 * root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75 + 2 * root6Over6, 0, 0.25)
  ]);
};

const addRecursiveSpheresBranch = (sceneObjects, applicationState, centerPosition, radius, depth, direction) => {
  sceneObjects.push(new SphereSceneObject(centerPosition, radius, allocateSceneObjectId(applicationState)));

  if (depth <= 0) {
    return returnSuccess(undefined);
  }

  const nextDepth = depth - 1;
  const offset = radius * 1.5;
  const branchSpecs = [
    [RECURSIVE_SPHERE_DIRECTION.X_NEGATIVE, RECURSIVE_SPHERE_DIRECTION.X_POSITIVE, createVec3(-offset, 0, 0)],
    [RECURSIVE_SPHERE_DIRECTION.X_POSITIVE, RECURSIVE_SPHERE_DIRECTION.X_NEGATIVE, createVec3(offset, 0, 0)],
    [RECURSIVE_SPHERE_DIRECTION.Y_NEGATIVE, RECURSIVE_SPHERE_DIRECTION.Y_POSITIVE, createVec3(0, -offset, 0)],
    [RECURSIVE_SPHERE_DIRECTION.Y_POSITIVE, RECURSIVE_SPHERE_DIRECTION.Y_NEGATIVE, createVec3(0, offset, 0)],
    [RECURSIVE_SPHERE_DIRECTION.Z_NEGATIVE, RECURSIVE_SPHERE_DIRECTION.Z_POSITIVE, createVec3(0, 0, -offset)],
    [RECURSIVE_SPHERE_DIRECTION.Z_POSITIVE, RECURSIVE_SPHERE_DIRECTION.Z_NEGATIVE, createVec3(0, 0, offset)]
  ];

  for (const [blockedDirection, nextDirection, translationVector] of branchSpecs) {
    if (direction === blockedDirection) {
      continue;
    }

    const [, branchError] = addRecursiveSpheresBranch(
      sceneObjects,
      applicationState,
      addVec3(centerPosition, translationVector),
      radius / 2,
      nextDepth,
      nextDirection
    );
    if (branchError) {
      return returnFailure(branchError.code, branchError.message, branchError.details);
    }
  }

  return returnSuccess(undefined);
};

const createRecursiveSpheresSceneObjects = (applicationState) => {
  const sceneObjects = [];
  const [, branchError] = addRecursiveSpheresBranch(sceneObjects, applicationState, createVec3(0, 0, 0), 0.3, 2, -1);
  if (branchError) {
    return returnFailure(branchError.code, branchError.message, branchError.details);
  }
  return returnSuccess(sceneObjects);
};

const createShaderShowcaseSceneObjects = (applicationState) => returnSuccess([
  createSphereObject(applicationState, -0.72, -0.72, -0.42, 0.15, MATERIAL.GGX_PBR),
  createSphereObject(applicationState, -0.36, -0.72, -0.42, 0.15, MATERIAL.SPECTRAL_GLASS),
  createSphereObject(applicationState, 0.0, -0.72, -0.42, 0.15, MATERIAL.SUBSURFACE),
  createSphereObject(applicationState, 0.36, -0.72, -0.42, 0.15, MATERIAL.CAUSTICS),
  createCubeObject(applicationState, 0.58, -0.87, -0.57, 0.86, -0.59, -0.29, MATERIAL.PROCEDURAL),
  createCubeObject(applicationState, -0.86, -0.37, 0.20, -0.58, -0.09, 0.48, MATERIAL.SDF_FRACTAL),
  createSphereObject(applicationState, -0.36, -0.22, 0.34, 0.15, MATERIAL.VOLUMETRIC_SHAFTS),
  createSphereObject(applicationState, 0.0, -0.22, 0.34, 0.15, MATERIAL.BOKEH),
  createCubeObject(applicationState, 0.22, -0.37, 0.20, 0.50, -0.09, 0.48, MATERIAL.MOTION_BLUR_STRESS),
  createSphereObject(applicationState, 0.72, -0.22, 0.34, 0.15, MATERIAL.FIRE_PLASMA)
]);

const createPrimitiveShowcaseSceneObjects = (applicationState) => returnSuccess([
  createCylinderObject(applicationState, -0.72, -0.62, -0.34, 0.10, 0.30, MATERIAL.DIFFUSE),
  createConeObject(applicationState, -0.46, -0.65, -0.34, 0.14, 0.27, MATERIAL.DIFFUSE),
  createFrustumObject(applicationState, -0.18, -0.65, -0.34, 0.15, 0.07, 0.27, MATERIAL.DIFFUSE),
  createCapsuleObject(applicationState, 0.12, -0.62, -0.34, 0.09, 0.28, MATERIAL.DIFFUSE),
  createEllipsoidObject(applicationState, 0.44, -0.62, -0.34, 0.15, 0.24, 0.11, MATERIAL.DIFFUSE),
  createTorusObject(applicationState, 0.74, -0.61, -0.34, 0.13, 0.04, MATERIAL.DIFFUSE),
  createRoundedBoxObject(applicationState, -0.52, -0.74, 0.24, 0.13, 0.13, 0.13, 0.04, MATERIAL.DIFFUSE),
  createDiskObject(applicationState, -0.16, -0.86, 0.24, 0.18, MATERIAL.DIFFUSE),
  createTriangleObject(applicationState, 0.20, -0.76, 0.24, 0.15, 0.18, 0.05, MATERIAL.DIFFUSE),
  createMetaballsObject(applicationState, 0.58, -0.72, 0.24, 0.12, MATERIAL.DIFFUSE)
]);

const createCurvedPrimitiveShowcaseSceneObjects = (applicationState) => returnSuccess([
  createCylinderObject(applicationState, -0.64, -0.58, -0.22, 0.14, 0.38, MATERIAL.DIFFUSE),
  createConeObject(applicationState, -0.30, -0.62, -0.22, 0.20, 0.34, MATERIAL.DIFFUSE),
  createFrustumObject(applicationState, 0.06, -0.62, -0.22, 0.20, 0.08, 0.34, MATERIAL.DIFFUSE),
  createCapsuleObject(applicationState, 0.42, -0.58, -0.22, 0.12, 0.36, MATERIAL.DIFFUSE),
  createEllipsoidObject(applicationState, -0.32, -0.72, 0.30, 0.22, 0.13, 0.16, MATERIAL.DIFFUSE),
  createTorusObject(applicationState, 0.30, -0.70, 0.30, 0.18, 0.055, MATERIAL.DIFFUSE),
  createRoundedBoxObject(applicationState, 0.70, -0.72, 0.30, 0.14, 0.14, 0.14, 0.05, MATERIAL.DIFFUSE)
]);

const createFlatPrimitiveShowcaseSceneObjects = (applicationState) => returnSuccess([
  createPlaneObject(applicationState, -0.55, -0.96, -0.24, 0.28, 0.20, MATERIAL.DIFFUSE),
  createDiskObject(applicationState, -0.12, -0.86, -0.24, 0.18, MATERIAL.DIFFUSE),
  createTriangleObject(applicationState, 0.30, -0.72, -0.24, 0.20, 0.24, 0.05, MATERIAL.DIFFUSE),
  createWedgeObject(applicationState, -0.42, -0.74, 0.28, 0.20, 0.24, 0.15, MATERIAL.DIFFUSE),
  createPrismObject(applicationState, 0.04, -0.72, 0.28, 0.18, 0.28, 0.18, MATERIAL.DIFFUSE),
  createRoundedBoxObject(applicationState, 0.52, -0.78, 0.28, 0.16, 0.08, 0.18, 0.035, MATERIAL.DIFFUSE)
]);

const createImplicitPrimitiveShowcaseSceneObjects = (applicationState) => returnSuccess([
  createMetaballsObject(applicationState, -0.56, -0.66, -0.20, 0.18, MATERIAL.DIFFUSE),
  createCsgObject(applicationState, -0.10, -0.66, -0.20, 0.27, MATERIAL.DIFFUSE),
  createMandelbulbObject(applicationState, 0.38, -0.64, -0.20, 0.28, MATERIAL.DIFFUSE),
  createSdfFractalObject(applicationState, -0.32, -0.68, 0.34, 0.27, MATERIAL.DIFFUSE),
  createTorusObject(applicationState, 0.26, -0.70, 0.34, 0.16, 0.045, MATERIAL.DIFFUSE),
  createEllipsoidObject(applicationState, 0.68, -0.74, 0.34, 0.15, 0.10, 0.19, MATERIAL.DIFFUSE)
]);

const createAreaLightShowcaseSceneObjects = (applicationState) => returnSuccess([
  createAreaLightObject(
    applicationState,
    applicationState.lightPosition[0],
    applicationState.lightPosition[1],
    applicationState.lightPosition[2],
    0.30,
    0.018,
    0.18
  ),
  createRoundedBoxObject(applicationState, -0.48, -0.82, -0.18, 0.20, 0.12, 0.20, 0.05, MATERIAL.MIRROR),
  createSphereObject(applicationState, 0.02, -0.74, -0.18, 0.22, MATERIAL.GLASS),
  createTorusObject(applicationState, 0.50, -0.76, -0.18, 0.16, 0.045, MATERIAL.GGX_PBR),
  createPlaneObject(applicationState, 0.00, -0.98, 0.35, 0.60, 0.24, MATERIAL.PROCEDURAL)
]);

const createSuzanneReferenceSceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    environment: ENVIRONMENT.OPEN_SKY_STUDIO,
    cameraDistance: 2.35,
    cameraAngleX: -0.10,
    cameraAngleY: 0.30,
    cameraFieldOfViewDegrees: 48,
    lightBounceCount: 6,
    raysPerPixel: 12,
    temporalBlendFrames: 18,
    denoiserStrength: 0.48,
    skyBrightness: 1.30,
    lightIntensity: 0.56,
    lightSize: 0.14,
    lightPosition: Object.freeze([0.34, 0.74, -0.46]),
    lightColor: Object.freeze([1.0, 0.93, 0.82]),
    colorContrast: 1.05,
    colorSaturation: 1.08,
    bloomStrength: 0.08,
    glareStrength: 0.04,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.24
  }),
  () => [
    setFixedSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0.06, 0.92, 0.82, MATERIAL.MATTE_PLASTIC),
      'Suzanne Matte Ground Receiver'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.72, -0.98, -0.62, 0.72, 0.18, -0.58, MATERIAL.SNOW),
      'Suzanne Rear Bounce Wall'
    ),
    setFixedSceneObjectDisplayName(
      createReferenceMeshObject(
        applicationState,
        DEFAULT_REFERENCE_MESH_MODEL_KEY,
        0,
        -0.54,
        0.0,
        MATERIAL.GGX_PBR
      ),
      'Suzanne Low Reference Mesh'
    )
  ]
);

const setSceneObjectDisplayName = (sceneObject, displayName) => {
  sceneObject.displayName = displayName;
  return sceneObject;
};

const setSceneObjectFixed = (sceneObject) => {
  if (isPhysicsSupportedSceneObject(sceneObject)) {
    sceneObject.physicsBodyType = PHYSICS_BODY_TYPE.STATIC;
  }
  return sceneObject;
};

const setFixedSceneObjectDisplayName = (sceneObject, displayName) => setSceneObjectFixed(
  setSceneObjectDisplayName(sceneObject, displayName)
);

const setSceneObjectEmissiveSettings = (sceneObject, emissiveColor, emissiveIntensity) => {
  writeSceneObjectEmissiveSettings(sceneObject, emissiveColor, emissiveIntensity);
  return sceneObject;
};

const clearSceneAnimation = (applicationState) => {
  applicationState.sceneAnimationElapsedSeconds = 0;
  applicationState.sceneAnimationUpdate = null;
  return returnSuccess(undefined);
};

const setSceneAnimationUpdate = (applicationState, updateAnimation) => {
  applicationState.sceneAnimationElapsedSeconds = 0;
  applicationState.sceneAnimationUpdate = updateAnimation;
  return returnSuccess(undefined);
};

const applyShowcaseSceneSettingsToState = (applicationState, sceneSettings = {}) => {
  const [, animationClearError] = clearSceneAnimation(applicationState);
  if (animationClearError) {
    return returnFailure(animationClearError.code, animationClearError.message, animationClearError.details);
  }

  applicationState.isBenchmarkModeActive = false;
  applicationState.activeBenchmarkSceneName = null;
  applicationState.environment = Number.isFinite(sceneSettings.environment)
    ? sceneSettings.environment
    : ENVIRONMENT.YELLOW_BLUE_CORNELL_BOX;
  applicationState.fogDensity = normalizeBoundedNumber(
    sceneSettings.fogDensity,
    DEFAULT_FOG_DENSITY,
    MIN_FOG_DENSITY,
    MAX_FOG_DENSITY
  );
  applicationState.skyBrightness = normalizeBoundedNumber(
    sceneSettings.skyBrightness,
    DEFAULT_SKY_BRIGHTNESS,
    MIN_SKY_BRIGHTNESS,
    MAX_SKY_BRIGHTNESS
  );
  applicationState.lightIntensity = normalizeBoundedNumber(
    sceneSettings.lightIntensity,
    DEFAULT_LIGHT_INTENSITY,
    MIN_LIGHT_INTENSITY,
    MAX_LIGHT_INTENSITY
  );
  applicationState.lightSize = normalizeBoundedNumber(
    sceneSettings.lightSize,
    DEFAULT_LIGHT_SIZE,
    MIN_LIGHT_SIZE,
    MAX_LIGHT_SIZE
  );
  applicationState.lightBounceCount = normalizeBoundedInteger(
    sceneSettings.lightBounceCount,
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  applicationState.raysPerPixel = normalizeBoundedInteger(
    sceneSettings.raysPerPixel,
    DEFAULT_RAYS_PER_PIXEL,
    MIN_RAYS_PER_PIXEL,
    MAX_RAYS_PER_PIXEL
  );
  applicationState.temporalBlendFrames = normalizeBoundedInteger(
    sceneSettings.temporalBlendFrames,
    DEFAULT_TEMPORAL_BLEND_FRAMES,
    MIN_TEMPORAL_BLEND_FRAMES,
    MAX_TEMPORAL_BLEND_FRAMES
  );
  applicationState.denoiserStrength = normalizeBoundedNumber(
    sceneSettings.denoiserStrength,
    DEFAULT_DENOISER_STRENGTH,
    MIN_DENOISER_STRENGTH,
    MAX_DENOISER_STRENGTH
  );
  applicationState.cameraDistance = normalizeBoundedNumber(sceneSettings.cameraDistance, INITIAL_CAMERA_DISTANCE, 1.5, 4);
  applicationState.cameraAngleX = normalizeBoundedNumber(sceneSettings.cameraAngleX, 0, -0.8, 0.8);
  applicationState.cameraAngleY = normalizeBoundedNumber(sceneSettings.cameraAngleY, 0, -Math.PI, Math.PI);
  applicationState.cameraMode = CAMERA_MODE_ORBIT;
  writeOrbitEyePosition(
    applicationState.fpsEyePosition,
    applicationState.cameraAngleX,
    applicationState.cameraAngleY,
    applicationState.cameraDistance
  );
  applicationState.isPointerLocked = false;
  clearFpsMovementState(applicationState);
  applicationState.cameraFieldOfViewDegrees = normalizeBoundedNumber(
    sceneSettings.cameraFieldOfViewDegrees,
    DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES,
    MIN_CAMERA_FIELD_OF_VIEW_DEGREES,
    MAX_CAMERA_FIELD_OF_VIEW_DEGREES
  );
  applicationState.cameraFocusDistance = normalizeBoundedNumber(
    sceneSettings.cameraFocusDistance,
    DEFAULT_CAMERA_FOCUS_DISTANCE,
    MIN_CAMERA_FOCUS_DISTANCE,
    MAX_CAMERA_FOCUS_DISTANCE
  );
  applicationState.cameraAperture = normalizeBoundedNumber(
    sceneSettings.cameraAperture,
    DEFAULT_CAMERA_APERTURE,
    MIN_CAMERA_APERTURE,
    MAX_CAMERA_APERTURE
  );
  applicationState.motionBlurStrength = normalizeBoundedNumber(
    sceneSettings.motionBlurStrength,
    DEFAULT_MOTION_BLUR_STRENGTH,
    MIN_MOTION_BLUR_STRENGTH,
    MAX_MOTION_BLUR_STRENGTH
  );
  applicationState.colorExposure = normalizeBoundedNumber(
    sceneSettings.colorExposure,
    DEFAULT_COLOR_EXPOSURE,
    MIN_COLOR_EXPOSURE,
    MAX_COLOR_EXPOSURE
  );
  applicationState.colorBrightness = normalizeBoundedNumber(
    sceneSettings.colorBrightness,
    DEFAULT_COLOR_BRIGHTNESS,
    MIN_COLOR_BRIGHTNESS,
    MAX_COLOR_BRIGHTNESS
  );
  applicationState.colorContrast = normalizeBoundedNumber(
    sceneSettings.colorContrast,
    DEFAULT_COLOR_CONTRAST,
    MIN_COLOR_CONTRAST,
    MAX_COLOR_CONTRAST
  );
  applicationState.colorSaturation = normalizeBoundedNumber(
    sceneSettings.colorSaturation,
    DEFAULT_COLOR_SATURATION,
    MIN_COLOR_SATURATION,
    MAX_COLOR_SATURATION
  );
  applicationState.colorGamma = normalizeBoundedNumber(
    sceneSettings.colorGamma,
    DEFAULT_COLOR_GAMMA,
    MIN_COLOR_GAMMA,
    MAX_COLOR_GAMMA
  );
  applicationState.toneMappingMode = normalizeToneMappingMode(sceneSettings.toneMappingMode);
  applicationState.bloomStrength = normalizeBoundedNumber(
    sceneSettings.bloomStrength,
    DEFAULT_BLOOM_STRENGTH,
    MIN_BLOOM_STRENGTH,
    MAX_BLOOM_STRENGTH
  );
  applicationState.bloomThreshold = normalizeBoundedNumber(
    sceneSettings.bloomThreshold,
    DEFAULT_BLOOM_THRESHOLD,
    MIN_BLOOM_THRESHOLD,
    MAX_BLOOM_THRESHOLD
  );
  applicationState.glareStrength = normalizeBoundedNumber(
    sceneSettings.glareStrength,
    DEFAULT_GLARE_STRENGTH,
    MIN_GLARE_STRENGTH,
    MAX_GLARE_STRENGTH
  );
  applicationState.isLightIntensityCycling = false;
  applicationState.lightIntensityCycleDirection = 1;
  applicationState.isCameraAutoRotating = sceneSettings.isCameraAutoRotating !== false;
  applicationState.cameraAutoRotationSpeed = normalizeBoundedNumber(
    sceneSettings.cameraAutoRotationSpeed,
    CAMERA_AUTO_ROTATION_SPEED,
    0,
    CAMERA_AUTO_ROTATION_SPEED
  );
  applicationState.renderDebugViewMode = RENDER_DEBUG_VIEW.BEAUTY;
  applicationState.isFramePaused = false;
  applicationState.didResumeFromFramePause = true;
  applicationState.isConvergencePauseEnabled = false;
  applicationState.isConvergencePaused = false;
  applicationState.isPickingFocus = false;

  if (Array.isArray(sceneSettings.lightPosition)) {
    const lightPosition = clampLightPosition(
      createVec3(
        sceneSettings.lightPosition[0],
        sceneSettings.lightPosition[1],
        sceneSettings.lightPosition[2]
      ),
      applicationState.lightSize
    );
    writeVec3(applicationState.lightPosition, lightPosition[0], lightPosition[1], lightPosition[2]);
  } else {
    writeVec3(applicationState.lightPosition, 0.4, 0.5, -0.6);
  }

  if (Array.isArray(sceneSettings.lightColor)) {
    writeVec3(
      applicationState.lightColor,
      normalizeBoundedNumber(sceneSettings.lightColor[0], 1, 0, 1),
      normalizeBoundedNumber(sceneSettings.lightColor[1], 1, 0, 1),
      normalizeBoundedNumber(sceneSettings.lightColor[2], 1, 0, 1)
    );
  } else {
    writeVec3(applicationState.lightColor, 1, 1, 1);
  }

  return returnSuccess(undefined);
};

const createConfiguredShowcaseSceneObjects = (applicationState, sceneSettings, createSceneObjects) => {
  const [, settingsError] = applyShowcaseSceneSettingsToState(applicationState, sceneSettings);
  if (settingsError) {
    return returnFailure(settingsError.code, settingsError.message, settingsError.details);
  }
  return returnSuccess(createSceneObjects());
};

const CORRIDOR_OF_LIGHT_SECONDARY_SUBJECT = Object.freeze({
  NONE: 'none',
  GLASS_SPHERE: 'glassSphere',
  MIRROR_CUBE: 'mirrorCube'
});

const createCorridorOfLightSecondarySubject = (applicationState, secondarySubject) => {
  if (secondarySubject === CORRIDOR_OF_LIGHT_SECONDARY_SUBJECT.GLASS_SPHERE) {
    return setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, 0, -0.76, 0.02, 0.18, MATERIAL.GLASS),
      'Central Glass Sphere'
    );
  }
  if (secondarySubject === CORRIDOR_OF_LIGHT_SECONDARY_SUBJECT.MIRROR_CUBE) {
    return setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.18, -0.94, -0.16, 0.18, -0.58, 0.20, MATERIAL.MIRROR),
      'Central Mirror Cube'
    );
  }
  return null;
};

const createCorridorOfLightSceneObjects = (applicationState, options = Object.freeze({})) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    environment: ENVIRONMENT.RED_GREEN_CORNELL_BOX,
    cameraDistance: 3.15,
    cameraAngleX: -0.05,
    cameraAngleY: 0.02,
    cameraFieldOfViewDegrees: 48,
    lightBounceCount: 7,
    raysPerPixel: 14,
    temporalBlendFrames: 18,
    denoiserStrength: 0.58,
    lightIntensity: 0.64,
    lightSize: 0.08,
    lightPosition: Object.freeze([0.0, 0.72, 0.0]),
    lightColor: Object.freeze([1.0, 0.84, 0.58]),
    fogDensity: 0,
    bloomStrength: 0.22,
    bloomThreshold: 0.95,
    glareStrength: 0.18,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.45
  }),
  () => {
    const sceneObjects = [
      setFixedSceneObjectDisplayName(
        createAreaLightObject(applicationState, 0, 0.72, 0, 0.18, 0.014, 0.12),
        'Centered Cornell Area Light'
      )
    ];
    const secondarySubject = createCorridorOfLightSecondarySubject(
      applicationState,
      options.secondarySubject || CORRIDOR_OF_LIGHT_SECONDARY_SUBJECT.NONE
    );
    if (secondarySubject) {
      sceneObjects.push(secondarySubject);
    }
    return sceneObjects;
  }
);

const createCorridorOfLightGlassSphereSceneObjects = (applicationState) => createCorridorOfLightSceneObjects(
  applicationState,
  Object.freeze({ secondarySubject: CORRIDOR_OF_LIGHT_SECONDARY_SUBJECT.GLASS_SPHERE })
);

const createCorridorOfLightMirrorCubeSceneObjects = (applicationState) => createCorridorOfLightSceneObjects(
  applicationState,
  Object.freeze({ secondarySubject: CORRIDOR_OF_LIGHT_SECONDARY_SUBJECT.MIRROR_CUBE })
);

const createDepthOfFieldPortraitSceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    cameraDistance: 2.12,
    cameraAngleX: -0.02,
    cameraAngleY: 0.08,
    cameraFieldOfViewDegrees: 42,
    cameraFocusDistance: 2.25,
    cameraAperture: 0.16,
    lightBounceCount: 8,
    raysPerPixel: 18,
    temporalBlendFrames: 24,
    denoiserStrength: 0.52,
    lightIntensity: 0.64,
    lightSize: 0.16,
    lightPosition: Object.freeze([-0.34, 0.62, -0.58]),
    lightColor: Object.freeze([1.0, 0.90, 0.78]),
    bloomStrength: 0.18,
    bloomThreshold: 1.05,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.20
  }),
  () => [
    setFixedSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0.02, 0.86, 0.82, MATERIAL.DIFFUSE),
      'Portrait Studio Floor'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.72, -0.98, -0.98, 0.72, 0.28, -0.94, MATERIAL.PROCEDURAL),
      'Soft Portrait Backdrop'
    ),
    setFixedSceneObjectDisplayName(
      createAreaLightObject(applicationState, -0.34, 0.62, -0.58, 0.26, 0.018, 0.18),
      'Large Soft Portrait Light'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, 0, -0.48, -0.16, 0.22, MATERIAL.GGX_PBR),
      'Sharp Focus PBR Portrait Sphere'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, -0.42, -0.72, -0.48, 0.10, MATERIAL.BOKEH),
      'Rear Bokeh Sphere 1'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, 0.36, -0.64, -0.62, 0.085, MATERIAL.THIN_FILM),
      'Rear Bokeh Sphere 2'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, -0.06, -0.78, -0.78, 0.075, MATERIAL.FIRE_PLASMA),
      'Rear Bokeh Sphere 3'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, 0.52, -0.74, -0.86, 0.065, MATERIAL.SPECTRAL_GLASS),
      'Rear Bokeh Sphere 4'
    )
  ]
);

const createShadowStudySceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    cameraDistance: 2.72,
    cameraAngleX: -0.10,
    cameraAngleY: -0.34,
    cameraFieldOfViewDegrees: 50,
    lightBounceCount: 5,
    raysPerPixel: 16,
    temporalBlendFrames: 18,
    lightIntensity: 0.70,
    lightSize: 0.035,
    lightPosition: Object.freeze([-0.64, 0.74, -0.54]),
    lightColor: Object.freeze([1.0, 0.96, 0.86]),
    colorContrast: 1.18,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.35
  }),
  () => [
    setFixedSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0.08, 0.86, 0.80, MATERIAL.DIFFUSE),
      'Shadow Study Floor'
    ),
    setFixedSceneObjectDisplayName(
      createAreaLightObject(applicationState, -0.62, 0.68, -0.52, 0.045, 0.010, 0.035),
      'Small Sharp Warm Light'
    ),
    setFixedSceneObjectDisplayName(
      createAreaLightObject(applicationState, 0.34, 0.56, -0.36, 0.11, 0.014, 0.08),
      'Medium Penumbra Fill Light'
    ),
    setFixedSceneObjectDisplayName(
      createAreaLightObject(applicationState, 0.06, 0.74, 0.34, 0.22, 0.018, 0.14),
      'Large Soft Overhead Light'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.54, -0.98, -0.22, -0.28, -0.44, 0.04, MATERIAL.DIFFUSE),
      'Tall Matte Shadow Block'
    ),
    setFixedSceneObjectDisplayName(
      createRoundedBoxObject(applicationState, 0.04, -0.84, -0.12, 0.20, 0.14, 0.18, 0.03, MATERIAL.DIFFUSE),
      'Low Rounded Shadow Block'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, 0.36, -0.98, 0.08, 0.58, -0.60, 0.30, MATERIAL.DIFFUSE),
      'Rear Matte Shadow Block'
    )
  ]
);

const createMirrorRoomSceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    cameraDistance: 2.82,
    cameraAngleX: -0.06,
    cameraAngleY: 0.36,
    cameraFieldOfViewDegrees: 52,
    lightBounceCount: 10,
    raysPerPixel: 22,
    temporalBlendFrames: 24,
    denoiserStrength: 0.54,
    lightIntensity: 0.42,
    lightSize: 0.025,
    lightPosition: Object.freeze([0.0, 0.58, -0.18]),
    bloomStrength: 0.22,
    bloomThreshold: 0.86,
    glareStrength: 0.18,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.30
  }),
  () => [
    setFixedSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0, 0.88, 0.88, MATERIAL.MIRROR),
      'Mirror Floor Plane'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.88, 0.58, -0.78, 0.88, 0.66, 0.78, MATERIAL.MIRROR),
      'Mirror Ceiling Plane'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.88, -0.98, -0.78, -0.80, 0.66, 0.78, MATERIAL.MIRROR),
      'Left Mirror Plane'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, 0.80, -0.98, -0.78, 0.88, 0.66, 0.78, MATERIAL.MIRROR),
      'Right Mirror Plane'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.88, -0.98, -0.86, 0.88, 0.66, -0.78, MATERIAL.MIRROR),
      'Rear Mirror Plane'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.88, -0.98, 0.78, 0.88, -0.70, 0.86, MATERIAL.MIRROR),
      'Front Mirror Plane'
    ),
    setFixedSceneObjectDisplayName(
      createAreaLightObject(applicationState, 0.0, 0.52, -0.20, 0.045, 0.010, 0.032),
      'Tiny Mirror Room Light'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, 0, -0.58, -0.08, 0.14, MATERIAL.DIFFUSE),
      'Central Colored Diffuse Sphere'
    )
  ]
);

const createSkySphereSceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    environment: ENVIRONMENT.OPEN_SKY_STUDIO,
    cameraDistance: 2.64,
    cameraAngleX: -0.18,
    cameraAngleY: 0.26,
    cameraFieldOfViewDegrees: 54,
    lightBounceCount: 6,
    raysPerPixel: 14,
    temporalBlendFrames: 18,
    skyBrightness: 1.55,
    lightIntensity: 0.48,
    lightSize: 0.18,
    lightPosition: Object.freeze([0.22, 0.78, -0.52]),
    lightColor: Object.freeze([0.86, 0.92, 1.0]),
    colorSaturation: 1.16,
    bloomStrength: 0.10,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.40
  }),
  () => [
    setFixedSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0.06, 0.92, 0.82, MATERIAL.DIFFUSE),
      'Open Sky Ground Receiver'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, 0, -0.34, -0.05, 0.34, MATERIAL.MIRROR),
      'Suspended Sky Mirror Sphere'
    )
  ]
);

const createFogCorridorSceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    environment: ENVIRONMENT.OPEN_SKY_STUDIO,
    cameraDistance: 3.18,
    cameraAngleX: -0.07,
    cameraAngleY: 0.04,
    cameraFieldOfViewDegrees: 50,
    lightBounceCount: 6,
    raysPerPixel: 12,
    temporalBlendFrames: 18,
    denoiserStrength: 0.60,
    fogDensity: 1.55,
    skyBrightness: 1.45,
    lightIntensity: 0.52,
    lightSize: 0.20,
    lightPosition: Object.freeze([0.18, 0.70, -0.62]),
    lightColor: Object.freeze([1.0, 0.78, 0.46]),
    bloomStrength: 0.20,
    bloomThreshold: 1.05,
    glareStrength: 0.12,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.25
  }),
  () => {
    const sceneObjects = [
      setFixedSceneObjectDisplayName(
        createPlaneObject(applicationState, 0, -0.985, 0, 0.86, 0.94, MATERIAL.DIFFUSE),
        'Fog Corridor Floor'
      )
    ];

    for (let pillarIndex = 0; pillarIndex < 6; pillarIndex += 1) {
      const zPosition = 0.70 - pillarIndex * 0.30;
      sceneObjects.push(setFixedSceneObjectDisplayName(
        createCylinderObject(applicationState, -0.44, -0.44, zPosition, 0.035, 0.54, MATERIAL.DIFFUSE),
        `Left Fog Pillar ${pillarIndex + 1}`
      ));
      sceneObjects.push(setFixedSceneObjectDisplayName(
        createCylinderObject(applicationState, 0.44, -0.44, zPosition, 0.035, 0.54, MATERIAL.DIFFUSE),
        `Right Fog Pillar ${pillarIndex + 1}`
      ));
    }

    sceneObjects.push(setFixedSceneObjectDisplayName(
      createCylinderObject(applicationState, 0, -0.58, -0.38, 0.11, 0.34, MATERIAL.HETEROGENEOUS_FOG),
      'Central Heterogeneous Fog Seed'
    ));

    return sceneObjects;
  }
);

const createMaterialGridSceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    cameraDistance: 3.05,
    cameraAngleX: -0.14,
    cameraAngleY: 0.28,
    cameraFieldOfViewDegrees: 52,
    lightBounceCount: 7,
    raysPerPixel: 16,
    temporalBlendFrames: 20,
    denoiserStrength: 0.56,
    lightIntensity: 0.64,
    lightSize: 0.14,
    lightPosition: Object.freeze([0.26, 0.66, -0.56]),
    bloomStrength: 0.18,
    bloomThreshold: 0.92,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.35
  }),
  () => {
    const materialGrid = [
      [MATERIAL.DIFFUSE, 'Diffuse'],
      [MATERIAL.MIRROR, 'Mirror'],
      [MATERIAL.GLOSSY, 'Glossy'],
      [MATERIAL.GLASS, 'Glass'],
      [MATERIAL.GGX_PBR, 'GGX PBR'],
      [MATERIAL.SPECTRAL_GLASS, 'Spectral Glass'],
      [MATERIAL.SUBSURFACE, 'Subsurface'],
      [MATERIAL.CAUSTICS, 'Caustics'],
      [MATERIAL.PROCEDURAL, 'Procedural'],
      [MATERIAL.SDF_FRACTAL, 'SDF Fractal Material'],
      [MATERIAL.VOLUMETRIC_SHAFTS, 'Volumetric Shafts'],
      [MATERIAL.BOKEH, 'Bokeh'],
      [MATERIAL.MOTION_BLUR_STRESS, 'Motion Blur Stress'],
      [MATERIAL.FIRE_PLASMA, 'Fire Plasma'],
      [MATERIAL.THIN_FILM, 'Thin Film'],
      [MATERIAL.EMISSIVE, 'Emissive'],
      [MATERIAL.RUBBER, 'Rubber'],
      [MATERIAL.MATTE_PLASTIC, 'Matte Plastic'],
      [MATERIAL.WOOD_GRAIN, 'Wood Grain'],
      [MATERIAL.MARBLE, 'Marble / Veined Stone'],
      [MATERIAL.CERAMIC_GLAZE, 'Ceramic Glaze'],
      [MATERIAL.CLEAR_COAT_AUTOMOTIVE, 'Clear Coat Automotive'],
      [MATERIAL.SKIN_WAX, 'Skin / Wax'],
      [MATERIAL.LEATHER, 'Leather'],
      [MATERIAL.SAND, 'Sand / Soil'],
      [MATERIAL.SNOW, 'Snow / Powder'],
      [MATERIAL.AMBER_HONEY, 'Amber / Honey Resin'],
      [MATERIAL.SOAP_FOAM, 'Soap / Foam'],
      [MATERIAL.WOVEN_FABRIC, 'Woven Fabric'],
      [MATERIAL.WATER_LIQUID, 'Water / Liquid'],
      [MATERIAL.ICE_FROSTED_GLASS, 'Ice / Frosted Glass'],
      [MATERIAL.PEARLESCENT_OPAL, 'Pearlescent / Opal'],
      [MATERIAL.CARBON_FIBRE, 'Carbon Fibre'],
      [MATERIAL.FUR_SHORT_HAIR, 'Fur / Short Hair'],
      [MATERIAL.CITRUS_PEEL, 'Orange / Citrus Peel'],
      [MATERIAL.FRUIT_FLESH, 'Fruit Flesh'],
      [MATERIAL.LEAF_CUTICLE, 'Leaf / Plant Cuticle'],
      [MATERIAL.MOSS_GRASS, 'Moss / Grass']
    ];
    const sceneObjects = [
      setFixedSceneObjectDisplayName(
        createPlaneObject(applicationState, 0, -0.985, 0.04, 0.94, 0.86, MATERIAL.DIFFUSE),
        'Material Grid Floor'
      ),
      setFixedSceneObjectDisplayName(
        createCubeObject(applicationState, -0.88, -0.98, -0.82, 0.88, 0.42, -0.74, MATERIAL.DIFFUSE),
        'Material Grid Back Wall'
      )
    ];
    const columnPositions = [-0.78, -0.52, -0.26, 0.0, 0.26, 0.52, 0.78];
    const rowPositions = [-0.66, -0.40, -0.14, 0.12, 0.38, 0.64];

    for (let materialIndex = 0; materialIndex < materialGrid.length; materialIndex += 1) {
      const columnIndex = materialIndex % columnPositions.length;
      const rowIndex = Math.floor(materialIndex / columnPositions.length);
      const [material, displayName] = materialGrid[materialIndex];
      sceneObjects.push(setFixedSceneObjectDisplayName(
        createSphereObject(
          applicationState,
          columnPositions[columnIndex],
          -0.865,
          rowPositions[rowIndex],
          0.062,
          material
        ),
        displayName
      ));
    }

    return sceneObjects;
  }
);

const createDemoNeonRoomSceneObjects = (applicationState) => createConfiguredShowcaseSceneObjects(
  applicationState,
  Object.freeze({
    cameraDistance: 2.74,
    cameraAngleX: -0.09,
    cameraAngleY: 0.20,
    cameraFieldOfViewDegrees: 54,
    lightBounceCount: 8,
    raysPerPixel: 18,
    temporalBlendFrames: 26,
    denoiserStrength: 0.50,
    lightIntensity: 0.10,
    lightSize: 0.02,
    lightPosition: Object.freeze([0.0, 0.54, -0.62]),
    lightColor: Object.freeze([0.35, 0.42, 0.55]),
    colorExposure: 0.00,
    colorContrast: 1.08,
    colorSaturation: 1.18,
    bloomStrength: 0.36,
    bloomThreshold: 0.95,
    glareStrength: 0.16,
    cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.18
  }),
  () => [
    setFixedSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0.02, 0.94, 0.88, MATERIAL.MIRROR),
      'Neon Room Reflective Floor'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.88, -0.98, -0.84, 0.88, 0.58, -0.78, MATERIAL.MIRROR),
      'Neon Room Rear Mirror Wall'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, -0.88, -0.98, -0.72, -0.82, 0.46, 0.74, MATERIAL.MIRROR),
      'Neon Room Left Reflector'
    ),
    setFixedSceneObjectDisplayName(
      createCubeObject(applicationState, 0.82, -0.98, -0.72, 0.88, 0.46, 0.74, MATERIAL.MIRROR),
      'Neon Room Right Reflector'
    ),
    setFixedSceneObjectDisplayName(
      setSceneObjectEmissiveSettings(
        createCubeObject(applicationState, -0.62, -0.38, -0.70, -0.58, 0.22, -0.66, MATERIAL.EMISSIVE),
        Object.freeze([0.10, 0.82, 1.0]),
        2.1
      ),
      'Cyan Neon Tube'
    ),
    setFixedSceneObjectDisplayName(
      setSceneObjectEmissiveSettings(
        createCubeObject(applicationState, 0.56, -0.28, -0.70, 0.62, 0.30, -0.66, MATERIAL.EMISSIVE),
        Object.freeze([1.0, 0.16, 0.74]),
        2.25
      ),
      'Magenta Neon Tube'
    ),
    setFixedSceneObjectDisplayName(
      setSceneObjectEmissiveSettings(
        createCubeObject(applicationState, -0.34, -0.82, -0.54, 0.32, -0.76, -0.50, MATERIAL.EMISSIVE),
        Object.freeze([1.0, 0.62, 0.08]),
        1.65
      ),
      'Amber Floor Strip'
    ),
    setFixedSceneObjectDisplayName(
      setSceneObjectEmissiveSettings(
        createSphereObject(applicationState, -0.24, -0.70, -0.10, 0.11, MATERIAL.EMISSIVE),
        Object.freeze([0.46, 0.88, 1.0]),
        1.55
      ),
      'Cyan Glow Orb'
    ),
    setFixedSceneObjectDisplayName(
      setSceneObjectEmissiveSettings(
        createSphereObject(applicationState, 0.22, -0.72, 0.14, 0.13, MATERIAL.EMISSIVE),
        Object.freeze([1.0, 0.24, 0.62]),
        1.75
      ),
      'Pink Glow Orb'
    ),
    setFixedSceneObjectDisplayName(
      createTorusObject(applicationState, 0.0, -0.76, 0.42, 0.19, 0.045, MATERIAL.THIN_FILM),
      'Iridescent Neon Ring'
    )
  ]
);

const SPONZA_ATRIUM_FLAGSTONE_BAND_COUNT = 4;
const SPONZA_ATRIUM_COLUMN_PAIR_COUNT = 3;
const SPONZA_ATRIUM_CURTAIN_PAIR_COUNT = 2;

const createBenchmarkSponzaAtriumSceneObjects = (applicationState) => {
  const lissajousAmplitudeX = 0.45;
  const lissajousAmplitudeY = 0.12;
  const lissajousAmplitudeZ = 0.38;
  const lissajousBaseY = 0.18;
  const lissajousFreqX = 3 * 0.11;
  const lissajousFreqY = 5 * 0.07;
  const lissajousFreqZ = 7 * 0.09;
  const lissajousInitialX = lissajousAmplitudeX * Math.sin(0);
  const lissajousInitialY = lissajousBaseY + lissajousAmplitudeY * Math.abs(Math.sin(0));
  const lissajousInitialZ = lissajousAmplitudeZ * Math.sin(0);
  const lissajousTranslation = createVec3(0, 0, 0);
  const sceneObjects = [];
  const pushFixedObject = (sceneObject, displayName) => {
    sceneObjects.push(setFixedSceneObjectDisplayName(sceneObject, displayName));
  };

  pushFixedObject(
    createAreaLightObject(applicationState, 0.40, 0.78, -0.18, 0.18, 0.014, 0.12),
    'Sponza Atrium Soft Skylight'
  );
  pushFixedObject(
    createCubeObject(applicationState, -0.42, -0.03, -0.58, 1.00, 0.00, 0.58, MATERIAL.MARBLE),
    'Sponza Flagstone Foundation'
  );
  pushFixedObject(
    createCubeObject(applicationState, -0.42, 0.70, -0.58, 1.00, 0.76, 0.58, MATERIAL.MARBLE),
    'Sponza Stone Ceiling'
  );
  pushFixedObject(
    createCubeObject(applicationState, -0.42, 0.00, -0.62, 1.00, 0.72, -0.58, MATERIAL.MARBLE),
    'Sponza Left Stone Arcade Wall'
  );
  pushFixedObject(
    createCubeObject(applicationState, -0.42, 0.00, 0.58, 1.00, 0.72, 0.62, MATERIAL.MARBLE),
    'Sponza Right Stone Arcade Wall'
  );

  for (let slabBandIndex = 0; slabBandIndex < SPONZA_ATRIUM_FLAGSTONE_BAND_COUNT; slabBandIndex += 1) {
    const minZ = -0.50 + slabBandIndex * 0.25;
    const material = slabBandIndex % 2 === 0 ? MATERIAL.SAND : MATERIAL.CERAMIC_GLAZE;
    pushFixedObject(
      createCubeObject(
        applicationState,
        -0.34,
        0.002,
        minZ,
        0.92,
        0.014,
        minZ + 0.20,
        material
      ),
      `Sponza Flagstone Band ${slabBandIndex + 1}`
    );
  }

  for (const side of [-1, 1]) {
    const zPosition = side * 0.42;
    const sideLabel = side < 0 ? 'Left' : 'Right';
    pushFixedObject(
      createCubeObject(applicationState, -0.35, 0.61, zPosition - 0.032, 0.94, 0.66, zPosition + 0.032, MATERIAL.MARBLE),
      `Sponza ${sideLabel} Arcade Beam`
    );
  }

  for (let columnIndex = 0; columnIndex < SPONZA_ATRIUM_COLUMN_PAIR_COUNT; columnIndex += 1) {
    const xPosition = -0.24 + columnIndex * 0.43;
    for (const side of [-1, 1]) {
      const zPosition = side * 0.42;
      const sideLabel = side < 0 ? 'Left' : 'Right';
      pushFixedObject(
        createCylinderObject(applicationState, xPosition, 0.31, zPosition, 0.044, 0.31, MATERIAL.MARBLE),
        `Sponza ${sideLabel} Column ${columnIndex + 1}`
      );
    }
    pushFixedObject(
      createCubeObject(applicationState, xPosition - 0.025, 0.64, -0.42, xPosition + 0.025, 0.69, 0.42, MATERIAL.MARBLE),
      `Sponza Cross Vault Rib ${columnIndex + 1}`
    );
  }

  for (let curtainIndex = 0; curtainIndex < SPONZA_ATRIUM_CURTAIN_PAIR_COUNT; curtainIndex += 1) {
    const xPosition = -0.02 + curtainIndex * 0.58;
    const material = curtainIndex % 2 === 0 ? MATERIAL.WOVEN_FABRIC : MATERIAL.VELVET;
    pushFixedObject(
      createCubeObject(applicationState, xPosition - 0.045, 0.20, -0.575, xPosition + 0.045, 0.60, -0.535, material),
      `Sponza Left Fabric Curtain ${curtainIndex + 1}`
    );
    pushFixedObject(
      createCubeObject(applicationState, xPosition - 0.045, 0.20, 0.535, xPosition + 0.045, 0.60, 0.575, material),
      `Sponza Right Fabric Curtain ${curtainIndex + 1}`
    );
  }

  const animatedSphere = setFixedSceneObjectDisplayName(
    createSphereObject(applicationState, 0, lissajousBaseY, 0, 0.18, MATERIAL.GLASS),
    'Sponza Lissajous Glass Sphere'
  );
  animatedSphere.physicsBodyType = PHYSICS_BODY_TYPE.STATIC;
  sceneObjects.push(animatedSphere);

  const [, animationError] = setSceneAnimationUpdate(applicationState, (elapsedSeconds) => {
    const xPosition = lissajousAmplitudeX * Math.sin(elapsedSeconds * lissajousFreqX);
    const yPosition = lissajousBaseY + lissajousAmplitudeY * Math.abs(Math.sin(elapsedSeconds * lissajousFreqY));
    const zPosition = lissajousAmplitudeZ * Math.sin(elapsedSeconds * lissajousFreqZ);
    const [, translationError] = animatedSphere.setTemporaryTranslation(writeVec3(
      lissajousTranslation,
      xPosition - lissajousInitialX,
      yPosition - lissajousInitialY,
      zPosition - lissajousInitialZ
    ));
    if (translationError) {
      return returnFailure(translationError.code, translationError.message, translationError.details);
    }
    return returnSuccess(true);
  });
  if (animationError) {
    return returnFailure(animationError.code, animationError.message, animationError.details);
  }

  return returnSuccess(sceneObjects);
};

const createBenchmarkShaderGauntletSceneObjects = (applicationState) => {
  const materialGrid = [
    [MATERIAL.GGX_PBR, 'GGX PBR'],
    [MATERIAL.SPECTRAL_GLASS, 'Spectral Glass'],
    [MATERIAL.SUBSURFACE, 'Subsurface'],
    [MATERIAL.CAUSTICS, 'Caustics'],
    [MATERIAL.PROCEDURAL, 'Procedural'],
    [MATERIAL.SDF_FRACTAL, 'SDF Fractal Material'],
    [MATERIAL.VOLUMETRIC_SHAFTS, 'Volumetric Shafts'],
    [MATERIAL.HETEROGENEOUS_FOG, 'Heterogeneous Fog'],
    [MATERIAL.BOKEH, 'Bokeh'],
    [MATERIAL.MOTION_BLUR_STRESS, 'Motion Blur Stress'],
    [MATERIAL.FIRE_PLASMA, 'Fire Plasma'],
    [MATERIAL.FUR_SHORT_HAIR, 'Fur / Short Hair'],
    [MATERIAL.CITRUS_PEEL, 'Orange / Citrus Peel'],
    [MATERIAL.FRUIT_FLESH, 'Fruit Flesh'],
    [MATERIAL.LEAF_CUTICLE, 'Leaf / Plant Cuticle'],
    [MATERIAL.MOSS_GRASS, 'Moss / Grass'],
    [MATERIAL.GLASS, 'Glass'],
    [MATERIAL.MIRROR, 'Mirror']
  ];
  const sceneObjects = [
    setSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, -0.03, 0.92, 0.82, MATERIAL.DIFFUSE),
      'Shader Gauntlet Floor'
    )
  ];
  const columnPositions = [-0.63, -0.21, 0.21, 0.63];
  const rowPositions = [-0.60, -0.22, 0.16, 0.54];

  for (let materialIndex = 0; materialIndex < materialGrid.length; materialIndex += 1) {
    const columnIndex = materialIndex % columnPositions.length;
    const rowIndex = Math.floor(materialIndex / columnPositions.length);
    const [material, displayName] = materialGrid[materialIndex];
    sceneObjects.push(setSceneObjectDisplayName(
      createSphereObject(
        applicationState,
        columnPositions[columnIndex],
        -0.875,
        rowPositions[rowIndex],
        0.105,
        material
      ),
      displayName
    ));
  }

  return returnSuccess(sceneObjects);
};

const createBenchmarkPhysicsChaosSceneObjects = (applicationState) => {
  const sceneObjects = [
    setSceneObjectDisplayName(
      createCubeObject(applicationState, -0.78, -0.98, -0.78, 0.78, -0.90, 0.78, MATERIAL.DIFFUSE),
      'Physics Bowl Floor'
    ),
    setSceneObjectDisplayName(
      createCubeObject(applicationState, -0.90, -0.98, -0.74, -0.78, -0.32, 0.74, MATERIAL.DIFFUSE),
      'Physics Bowl Left Wall'
    ),
    setSceneObjectDisplayName(
      createCubeObject(applicationState, 0.78, -0.98, -0.74, 0.90, -0.32, 0.74, MATERIAL.DIFFUSE),
      'Physics Bowl Right Wall'
    ),
    setSceneObjectDisplayName(
      createCubeObject(applicationState, -0.74, -0.98, -0.90, 0.74, -0.32, -0.78, MATERIAL.DIFFUSE),
      'Physics Bowl Back Wall'
    ),
    setSceneObjectDisplayName(
      createCubeObject(applicationState, -0.74, -0.98, 0.78, 0.74, -0.32, 0.90, MATERIAL.DIFFUSE),
      'Physics Bowl Front Wall'
    )
  ];

  for (let sphereIndex = 0; sphereIndex < 20; sphereIndex += 1) {
    const columnIndex = sphereIndex % 5;
    const rowIndex = Math.floor(sphereIndex / 5);
    const xPosition = -0.44 + columnIndex * 0.22 + (rowIndex % 2) * 0.04;
    const yPosition = 0.38 + rowIndex * 0.13;
    const zPosition = -0.36 + rowIndex * 0.22;
    const sphereObject = createSphereObject(
      applicationState,
      xPosition,
      yPosition,
      zPosition,
      0.062,
      sphereIndex % 2 === 0 ? MATERIAL.MIRROR : MATERIAL.GLASS
    );
    sphereObject.physicsFriction = 0.08;
    sphereObject.physicsRestitution = 0.92;
    sceneObjects.push(setSceneObjectDisplayName(
      sphereObject,
      `Chaos Sphere ${sphereIndex + 1}`
    ));
  }

  return returnSuccess(sceneObjects);
};

const createBenchmarkSdfComplexitySceneObjects = (applicationState) => {
  const sdfOrbitRadius = 0.075;
  const sdfOrbitLift = 0.022;
  const sdfOrbitSpeed = 0.42;
  const orbitTranslation = createVec3(0, 0, 0);
  const sdfObjects = [
    setSceneObjectDisplayName(
      createMandelbulbObject(applicationState, -0.57, -0.66, -0.14, 0.24, MATERIAL.PROCEDURAL),
      'Procedural Mandelbulb'
    ),
    setSceneObjectDisplayName(
      createSdfFractalObject(applicationState, -0.18, -0.66, 0.20, 0.24, MATERIAL.SDF_FRACTAL),
      'SDF Fractal'
    ),
    setSceneObjectDisplayName(
      createMetaballsObject(applicationState, 0.22, -0.67, -0.18, 0.20, MATERIAL.VOLUMETRIC_SHAFTS),
      'Metaballs Cluster'
    ),
    setSceneObjectDisplayName(
      createCsgObject(applicationState, 0.60, -0.66, 0.16, 0.25, MATERIAL.GGX_PBR),
      'CSG Shape'
    )
  ];
  const sceneObjects = [
    setSceneObjectDisplayName(
      createAreaLightObject(
        applicationState,
        applicationState.lightPosition[0],
        applicationState.lightPosition[1],
        applicationState.lightPosition[2],
        0.18,
        0.014,
        0.12
      ),
      'SDF Benchmark Area Light'
    ),
    setSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0.02, 0.94, 0.78, MATERIAL.DIFFUSE),
      'SDF Complexity Floor'
    ),
    setSceneObjectDisplayName(
      createCubeObject(applicationState, -0.84, -0.98, 0.58, 0.84, 0.30, 0.70, MATERIAL.PROCEDURAL),
      'Procedural SDF Backdrop'
    ),
    ...sdfObjects
  ];

  const [, animationError] = setSceneAnimationUpdate(applicationState, (elapsedSeconds) => {
    for (let objectIndex = 0; objectIndex < sdfObjects.length; objectIndex += 1) {
      const phase = objectIndex * Math.PI * 0.5;
      const orbitAngle = phase + elapsedSeconds * sdfOrbitSpeed * (1 + objectIndex * 0.08);
      const translationX = (Math.cos(orbitAngle) - Math.cos(phase)) * sdfOrbitRadius;
      const translationY = (Math.sin(orbitAngle * 0.7) - Math.sin(phase * 0.7)) * sdfOrbitLift;
      const translationZ = (Math.sin(orbitAngle) - Math.sin(phase)) * sdfOrbitRadius;
      const [, translationError] = sdfObjects[objectIndex].setTemporaryTranslation(
        writeVec3(orbitTranslation, translationX, translationY, translationZ)
      );
      if (translationError) {
        return returnFailure(translationError.code, translationError.message, translationError.details);
      }
    }
    return returnSuccess(true);
  });
  if (animationError) {
    return returnFailure(animationError.code, animationError.message, animationError.details);
  }

  return returnSuccess(sceneObjects);
};

const createBenchmarkCausticPoolSceneObjects = (applicationState) => returnSuccess([
  setSceneObjectDisplayName(
    createAreaLightObject(
      applicationState,
      applicationState.lightPosition[0],
      applicationState.lightPosition[1],
      applicationState.lightPosition[2],
      0.16,
      0.014,
      0.12
    ),
    'Benchmark Area Light'
  ),
  setSceneObjectDisplayName(
    createPlaneObject(applicationState, 0, -0.965, 0.08, 0.86, 0.68, MATERIAL.DIFFUSE),
    'Caustic Pool Floor'
  ),
  setSceneObjectDisplayName(
    createEllipsoidObject(applicationState, 0, -0.36, -0.10, 0.32, 0.32, 0.32, MATERIAL.GLASS),
    'Suspended Glass Sphere'
  ),
  setSceneObjectDisplayName(
    createEllipsoidObject(applicationState, -0.46, -0.48, 0.12, 0.16, 0.16, 0.16, MATERIAL.SPECTRAL_GLASS),
    'Left Spectral Glass Sphere'
  ),
  setSceneObjectDisplayName(
    createEllipsoidObject(applicationState, 0.46, -0.48, 0.12, 0.16, 0.16, 0.16, MATERIAL.SPECTRAL_GLASS),
    'Right Spectral Glass Sphere'
  )
]);

const createBenchmarkMotionBlurStressSceneObjects = (applicationState) => {
  const sceneObjects = [
    setSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0, 0.88, 0.88, MATERIAL.DIFFUSE),
      'Motion Blur Floor'
    ),
    setFixedSceneObjectDisplayName(
      createSphereObject(applicationState, 0, 0, 0, 0.18, MATERIAL.BOKEH),
      'Focus-Distance Bokeh Sphere'
    ),
    setSceneObjectDisplayName(
      createAreaLightObject(
        applicationState,
        applicationState.lightPosition[0],
        applicationState.lightPosition[1],
        applicationState.lightPosition[2],
        0.18,
        0.014,
        0.11
      ),
      'Motion Blur Area Light'
    )
  ];
  const cubeHalfExtent = 0.095;
  const cubeOrbitRadius = 0.070;
  const cubeOrbitLift = 0.035;
  const cubeOrbitSpeed = 0.86;
  const cubeTranslation = createVec3(0, 0, 0);
  const cubeAnimationSpecs = [];

  for (let cubeIndex = 0; cubeIndex < 8; cubeIndex += 1) {
    const angle = cubeIndex * Math.PI * 0.25;
    const xPosition = Math.cos(angle) * 0.56;
    const zPosition = Math.sin(angle) * 0.56;
    const cubeObject = createCubeObject(
      applicationState,
      xPosition - cubeHalfExtent,
      -0.12,
      zPosition - cubeHalfExtent,
      xPosition + cubeHalfExtent,
      0.12,
      zPosition + cubeHalfExtent,
      MATERIAL.MOTION_BLUR_STRESS
    );
    sceneObjects.push(setSceneObjectDisplayName(
      cubeObject,
      `Motion Cube ${cubeIndex + 1}`
    ));
    cubeAnimationSpecs.push(Object.freeze({
      cubeObject,
      phase: angle,
      radialX: Math.cos(angle),
      radialZ: Math.sin(angle),
      tangentX: -Math.sin(angle),
      tangentZ: Math.cos(angle),
      speed: cubeOrbitSpeed * (1 + cubeIndex * 0.045)
    }));
  }

  const [, animationError] = setSceneAnimationUpdate(applicationState, (elapsedSeconds) => {
    for (const animationSpec of cubeAnimationSpecs) {
      const orbitAngle = animationSpec.phase + elapsedSeconds * animationSpec.speed;
      const tangentOffset = (Math.cos(orbitAngle) - Math.cos(animationSpec.phase)) * cubeOrbitRadius;
      const radialOffset = (Math.sin(orbitAngle) - Math.sin(animationSpec.phase)) * cubeOrbitRadius;
      const verticalOffset = (
        Math.sin(orbitAngle * 1.7) -
        Math.sin(animationSpec.phase * 1.7)
      ) * cubeOrbitLift;
      const translationX = animationSpec.tangentX * tangentOffset + animationSpec.radialX * radialOffset;
      const translationZ = animationSpec.tangentZ * tangentOffset + animationSpec.radialZ * radialOffset;
      const [, translationError] = animationSpec.cubeObject.setTemporaryTranslation(
        writeVec3(cubeTranslation, translationX, verticalOffset, translationZ)
      );
      if (translationError) {
        return returnFailure(translationError.code, translationError.message, translationError.details);
      }
    }
    return returnSuccess(true);
  });
  if (animationError) {
    return returnFailure(animationError.code, animationError.message, animationError.details);
  }

  return returnSuccess(sceneObjects);
};

const attachParticleFluidSpringJoints = (
  particleObjects,
  particleFluidSpringRestLength,
  particleFluidSpringStiffness,
  particleFluidSpringDamping
) => {
  for (const particleObject of particleObjects) {
    particleObject.physicsSpringJoints = [];
  }

  const springPairKeys = new Set();
  for (let particleIndex = 0; particleIndex < particleObjects.length; particleIndex += 1) {
    const sourceObject = particleObjects[particleIndex];
    const sourcePosition = sourceObject.centerPosition;
    const neighborDistances = [];
    for (let targetIndex = 0; targetIndex < particleObjects.length; targetIndex += 1) {
      if (targetIndex === particleIndex) {
        continue;
      }
      const targetPosition = particleObjects[targetIndex].centerPosition;
      const deltaX = targetPosition[0] - sourcePosition[0];
      const deltaY = targetPosition[1] - sourcePosition[1];
      const deltaZ = targetPosition[2] - sourcePosition[2];
      neighborDistances.push(Object.freeze({
        targetIndex,
        distanceSquared: deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
      }));
    }

    neighborDistances.sort((leftNeighbor, rightNeighbor) => leftNeighbor.distanceSquared - rightNeighbor.distanceSquared);
    const neighborLimit = Math.min(PARTICLE_FLUID_NEIGHBOR_COUNT, neighborDistances.length);
    for (let neighborIndex = 0; neighborIndex < neighborLimit; neighborIndex += 1) {
      const targetIndex = neighborDistances[neighborIndex].targetIndex;
      const firstIndex = Math.min(particleIndex, targetIndex);
      const secondIndex = Math.max(particleIndex, targetIndex);
      const springPairKey = `${firstIndex}:${secondIndex}`;
      if (springPairKeys.has(springPairKey)) {
        continue;
      }

      springPairKeys.add(springPairKey);
      sourceObject.physicsSpringJoints.push(Object.freeze({
        targetObject: particleObjects[targetIndex],
        restLength: particleFluidSpringRestLength,
        stiffness: particleFluidSpringStiffness,
        damping: particleFluidSpringDamping
      }));
    }
  }

  return returnSuccess(springPairKeys.size);
};

const createBenchmarkParticleFluidSceneObjects = (applicationState) => {
  const particleFluidSettings = readApplicationStateParticleFluidSettings(applicationState);
  const particleFluidParticleCount = particleFluidSettings.particleCount;
  const particleFluidRadius = particleFluidSettings.radius;
  const particleFluidSpringStiffness = particleFluidSettings.springStiffness;
  const particleFluidSpringRestLength = Math.max(
    DEFAULT_PARTICLE_FLUID_SPRING_REST_LENGTH,
    particleFluidRadius * 2.25
  );
  const particleFluidSpringDamping = Math.max(4, Math.sqrt(particleFluidSpringStiffness) * 0.75);
  const particleSpacing = particleFluidSpringRestLength * 0.82;
  const columnCount = Math.ceil(Math.cbrt(particleFluidParticleCount * 1.25));
  const rowCount = Math.ceil(Math.sqrt(particleFluidParticleCount / columnCount));
  const layerCount = Math.ceil(particleFluidParticleCount / (columnCount * rowCount));
  const particlesPerLayer = columnCount * rowCount;
  const clusterCenterX = 0;
  const clusterCenterY = -0.18;
  const clusterCenterZ = -0.04;

  const glassContainer = setSceneObjectDisplayName(
    createRoundedBoxObject(applicationState, 0, -0.83, 0, 0.48, 0.065, 0.36, 0.055, MATERIAL.GLASS),
    'Particle Fluid Glass Container'
  );
  glassContainer.isPhysicsEnabled = true;
  glassContainer.physicsFriction = 0.18;
  glassContainer.physicsRestitution = 0.18;

  const sceneObjects = [
    setSceneObjectDisplayName(
      createAreaLightObject(
        applicationState,
        applicationState.lightPosition[0],
        applicationState.lightPosition[1],
        applicationState.lightPosition[2],
        0.20,
        0.014,
        0.14
      ),
      'Particle Fluid Area Light'
    ),
    setSceneObjectDisplayName(
      createPlaneObject(applicationState, 0, -0.985, 0.04, 0.92, 0.82, MATERIAL.DIFFUSE),
      'Particle Fluid Floor'
    ),
    glassContainer
  ];
  const particleObjects = [];

  for (let particleIndex = 0; particleIndex < particleFluidParticleCount; particleIndex += 1) {
    const layerIndex = Math.floor(particleIndex / particlesPerLayer);
    const inLayerIndex = particleIndex - layerIndex * particlesPerLayer;
    const rowIndex = Math.floor(inLayerIndex / columnCount);
    const columnIndex = inLayerIndex % columnCount;
    const staggerOffset = ((rowIndex + layerIndex) % 2) * particleFluidRadius * 0.38;
    const layerOffset = (layerIndex % 2) * particleFluidRadius * 0.34;
    const xPosition = clusterCenterX + (columnIndex - (columnCount - 1) * 0.5) * particleSpacing + staggerOffset;
    const yPosition = clusterCenterY + (layerIndex - (layerCount - 1) * 0.5) * particleSpacing * 0.95;
    const zPosition = clusterCenterZ + (rowIndex - (rowCount - 1) * 0.5) * particleSpacing + layerOffset;
    const particleObject = createSphereObject(
      applicationState,
      xPosition,
      yPosition,
      zPosition,
      particleFluidRadius,
      MATERIAL.SUBSURFACE
    );
    particleObject.physicsFriction = 0.16;
    particleObject.physicsRestitution = 0.10;
    particleObject.physicsMass = 0.32;
    particleObject.physicsGravityScale = 0.92;
    particleObjects.push(particleObject);
    sceneObjects.push(setSceneObjectDisplayName(
      particleObject,
      `Fluid Particle ${particleIndex + 1}`
    ));
  }

  const [, springError] = attachParticleFluidSpringJoints(
    particleObjects,
    particleFluidSpringRestLength,
    particleFluidSpringStiffness,
    particleFluidSpringDamping
  );
  if (springError) {
    return returnFailure(springError.code, springError.message, springError.details);
  }

  return returnSuccess(sceneObjects);
};

const createBenchmarkVolumetricFogSceneObjects = (applicationState) => returnSuccess([
  setSceneObjectDisplayName(
    createPlaneObject(applicationState, 0, -0.985, 0, 0.92, 0.92, MATERIAL.DIFFUSE),
    'Volumetric Fog Floor'
  ),
  setSceneObjectDisplayName(
    createCylinderObject(applicationState, -0.62, -0.55, -0.48, 0.08, 0.42, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Column 1'
  ),
  setSceneObjectDisplayName(
    createCylinderObject(applicationState, -0.22, -0.52, -0.56, 0.07, 0.45, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Column 2'
  ),
  setSceneObjectDisplayName(
    createCylinderObject(applicationState, 0.20, -0.57, -0.42, 0.09, 0.38, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Column 3'
  ),
  setSceneObjectDisplayName(
    createCylinderObject(applicationState, 0.58, -0.50, -0.50, 0.075, 0.46, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Column 4'
  ),
  setSceneObjectDisplayName(
    createSphereObject(applicationState, -0.48, -0.80, 0.12, 0.15, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Sphere 1'
  ),
  setSceneObjectDisplayName(
    createSphereObject(applicationState, -0.12, -0.76, 0.36, 0.18, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Sphere 2'
  ),
  setSceneObjectDisplayName(
    createSphereObject(applicationState, 0.28, -0.82, 0.18, 0.14, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Sphere 3'
  ),
  setSceneObjectDisplayName(
    createSphereObject(applicationState, 0.62, -0.78, 0.48, 0.16, MATERIAL.VOLUMETRIC_SHAFTS),
    'Fog Sphere 4'
  ),
  setSceneObjectDisplayName(
    createTorusObject(applicationState, 0.02, -0.78, -0.02, 0.22, 0.055, MATERIAL.HETEROGENEOUS_FOG),
    'Heterogeneous Fog Torus'
  )
]);

const lockBenchmarkSceneObjects = (sceneObjects) => {
  for (const sceneObject of sceneObjects) {
    sceneObject.isLocked = true;
  }
  return sceneObjects;
};

const createBenchmarkStandardSceneObjects = (applicationState) => returnSuccess(lockBenchmarkSceneObjects([
  setSceneObjectDisplayName(
    createAreaLightObject(
      applicationState,
      applicationState.lightPosition[0],
      applicationState.lightPosition[1],
      applicationState.lightPosition[2],
      0.24,
      0.018,
      0.20
    ),
    'Benchmark Area Light'
  ),
  setSceneObjectDisplayName(
    createCubeObject(applicationState, -0.86, -0.98, -0.78, 0.86, -0.92, 0.78, MATERIAL.DIFFUSE),
    'Benchmark Plinth'
  ),
  setSceneObjectDisplayName(
    createCubeObject(applicationState, -0.74, -0.92, -0.58, -0.50, -0.50, -0.34, MATERIAL.MIRROR),
    'Mirror Block'
  ),
  setSceneObjectDisplayName(
    createRoundedBoxObject(applicationState, -0.28, -0.76, -0.38, 0.18, 0.16, 0.18, 0.04, MATERIAL.GGX_PBR),
    'PBR Rounded Box'
  ),
  setSceneObjectDisplayName(
    createEllipsoidObject(applicationState, 0.18, -0.74, -0.30, 0.18, 0.24, 0.14, MATERIAL.GLASS),
    'Glass Ellipsoid'
  ),
  setSceneObjectDisplayName(
    createTorusObject(applicationState, 0.58, -0.76, -0.34, 0.16, 0.045, MATERIAL.PROCEDURAL),
    'Procedural Torus'
  ),
  setSceneObjectDisplayName(
    createFrustumObject(applicationState, -0.46, -0.78, 0.28, 0.18, 0.08, 0.28, MATERIAL.SUBSURFACE),
    'Subsurface Frustum'
  ),
  setSceneObjectDisplayName(
    createCsgObject(applicationState, 0.04, -0.72, 0.30, 0.23, MATERIAL.CAUSTICS),
    'Caustic CSG'
  ),
  setSceneObjectDisplayName(
    createMandelbulbObject(applicationState, 0.52, -0.74, 0.28, 0.22, MATERIAL.SDF_FRACTAL),
    'Fractal Stress'
  )
]));

const benchmarkSceneRegistry = Object.freeze({
  defaultBenchmarkScene: DEFAULT_BENCHMARK_SCENE_NAME,
  scenes: Object.freeze({
  benchmarkSponzaAtrium: Object.freeze({
    factory: createBenchmarkSponzaAtriumSceneObjects,
    metadata: Object.freeze({
      displayName: 'Sponza Atrium',
      targetBounces: 8,
      targetRaysPerPixel: 16,
      targetTemporalBlendFrames: 20,
      targetDenoiserStrength: 0.56,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      referenceAssetPath: SPONZA_GLB_REFERENCE_MODEL.assetPath,
      referenceTriangleCount: SPONZA_GLB_REFERENCE_MODEL.triangleCount,
      description: 'Deterministic atrium benchmark with dense stone/fabric primitives and a glass Lissajous caustic driver; the bundled Sponza GLB is tracked as the mesh reference asset.',
      cameraEyePosition: Object.freeze([0, 0.3, 0]),
      cameraTargetPosition: Object.freeze([1, 0.2, 0]),
      cameraFieldOfViewDegrees: 65,
      cameraAutoRotationSpeed: BENCHMARK_CAMERA_AUTO_ROTATION_SPEED * 0.55,
      lightIntensity: 0.54,
      lightSize: 0.13,
      lightPosition: Object.freeze([0.40, 0.78, -0.18]),
      lightColor: Object.freeze([1.0, 0.92, 0.78])
    })
  }),
  standard: Object.freeze({
    factory: createBenchmarkStandardSceneObjects,
    metadata: Object.freeze({
      displayName: 'Standard Benchmark',
      targetBounces: 6,
      targetRaysPerPixel: 12,
      targetTemporalBlendFrames: DEFAULT_TEMPORAL_BLEND_FRAMES,
      targetDenoiserStrength: DEFAULT_DENOISER_STRENGTH,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'Static mixed-material scene for repeatable WebGL path tracing comparisons.',
      cameraDistance: 2.55,
      cameraAngleX: 0.14,
      cameraAngleY: -0.38,
      cameraAutoRotationSpeed: BENCHMARK_CAMERA_AUTO_ROTATION_SPEED,
      lightIntensity: 0.58,
      lightSize: 0.12,
      lightPosition: Object.freeze([0.36, 0.58, -0.62])
    })
  }),
  benchmarkShaderGauntlet: Object.freeze({
    factory: createBenchmarkShaderGauntletSceneObjects,
    metadata: Object.freeze({
      displayName: 'Shader Gauntlet',
      targetBounces: 8,
      targetRaysPerPixel: 16,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'A 3x4 material grid covering the most expensive current shader branches.',
      cameraDistance: 2.85,
      cameraAngleX: -0.08,
      cameraAngleY: 0.35,
      cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED,
      lightIntensity: 0.62,
      lightSize: 0.12,
      lightPosition: Object.freeze([0.18, 0.64, -0.55])
    })
  }),
  benchmarkPhysicsChaos: Object.freeze({
    factory: createBenchmarkPhysicsChaosSceneObjects,
    metadata: Object.freeze({
      displayName: 'Physics Chaos',
      targetBounces: 6,
      targetRaysPerPixel: 8,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'A fixed bowl with 20 mirror/glass spheres for transform invalidation and reflection load.',
      cameraDistance: 2.9,
      cameraAngleX: -0.12,
      cameraAngleY: 0.10,
      cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED,
      lightIntensity: 0.58,
      lightSize: 0.16,
      lightPosition: Object.freeze([0.42, 0.64, -0.48])
    })
  }),
  benchmarkParticleFluid: Object.freeze({
    factory: createBenchmarkParticleFluidSceneObjects,
    metadata: Object.freeze({
      displayName: 'Particle Fluid',
      targetBounces: 6,
      targetRaysPerPixel: 8,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'Spring-jointed subsurface particles settling onto a static glass rounded-box container.',
      cameraDistance: 2.65,
      cameraAngleX: -0.08,
      cameraAngleY: 0.18,
      cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.65,
      lightIntensity: 0.62,
      lightSize: 0.14,
      lightPosition: Object.freeze([0.28, 0.66, -0.48])
    })
  }),
  benchmarkSdfComplexity: Object.freeze({
    factory: createBenchmarkSdfComplexitySceneObjects,
    metadata: Object.freeze({
      displayName: 'SDF Complexity',
      targetBounces: 5,
      targetRaysPerPixel: 12,
      targetTemporalBlendFrames: 18,
      targetDenoiserStrength: 0.58,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'Mandelbulb, fractal, metaballs, and CSG primitives with expensive materials.',
      cameraDistance: 2.85,
      cameraAngleX: -0.10,
      cameraAngleY: 0.28,
      cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.55,
      lightIntensity: 0.64,
      lightSize: 0.11,
      lightPosition: Object.freeze([0.32, 0.62, -0.62])
    })
  }),
  benchmarkCausticPool: Object.freeze({
    factory: createBenchmarkCausticPoolSceneObjects,
    metadata: Object.freeze({
      displayName: 'Caustic Pool',
      targetBounces: 10,
      targetRaysPerPixel: 24,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'Suspended glass and spectral-glass shapes over a diffuse receiver with a compact area light.',
      cameraDistance: 2.6,
      cameraAngleX: -0.06,
      cameraAngleY: 0.42,
      cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED,
      lightIntensity: 0.68,
      lightSize: 0.04,
      lightPosition: Object.freeze([-0.24, 0.66, -0.44]),
      cameraFocusDistance: 2.25,
      cameraAperture: 0.02
    })
  }),
  benchmarkMotionBlurStress: Object.freeze({
    factory: createBenchmarkMotionBlurStressSceneObjects,
    metadata: Object.freeze({
      displayName: 'Motion Blur Stress',
      targetBounces: 4,
      targetRaysPerPixel: 32,
      targetTemporalBlendFrames: 28,
      targetDenoiserStrength: 0.50,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'A ring of motion-blur material cubes with a central bokeh material sphere.',
      cameraDistance: 2.95,
      cameraAngleX: -0.08,
      cameraAngleY: 0.20,
      cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.85,
      lightIntensity: 0.60,
      lightSize: 0.14,
      lightPosition: Object.freeze([0.38, 0.60, -0.48]),
      cameraFocusDistance: 2.95,
      cameraAperture: 0.12,
      motionBlurStrength: 0.85
    })
  }),
  benchmarkVolumetricFog: Object.freeze({
    factory: createBenchmarkVolumetricFogSceneObjects,
    metadata: Object.freeze({
      displayName: 'Volumetric Fog Flythrough',
      targetBounces: 6,
      targetRaysPerPixel: 10,
      gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE,
      description: 'Heterogeneous fog, volumetric material spheres, and tall columns for volume-heavy rays.',
      cameraDistance: 3.05,
      cameraAngleX: -0.09,
      cameraAngleY: 0.30,
      cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED * 0.5,
      environment: ENVIRONMENT.OPEN_SKY_STUDIO,
      fogDensity: 0.8,
      skyBrightness: 1.35,
      lightIntensity: 0.52,
      lightSize: 0.18,
      lightPosition: Object.freeze([0.30, 0.62, -0.52])
    })
  })
  })
});

const benchmarkScenes = benchmarkSceneRegistry.scenes;
const defaultBenchmarkScene = benchmarkSceneRegistry.defaultBenchmarkScene;

const resolveBenchmarkSceneName = (benchmarkSceneName) => (
  benchmarkSceneName === 'default' ? defaultBenchmarkScene : benchmarkSceneName
);

const applyBenchmarkSceneSettingsToState = (applicationState, benchmarkSceneMetadata, benchmarkSceneName) => {
  const [, animationClearError] = clearSceneAnimation(applicationState);
  if (animationClearError) {
    return returnFailure(animationClearError.code, animationClearError.message, animationClearError.details);
  }

  applicationState.isBenchmarkModeActive = true;
  applicationState.activeBenchmarkSceneName = benchmarkSceneName;
  applicationState.isLightIntensityCycling = false;
  applicationState.lightIntensityCycleDirection = 1;
  applicationState.isRotatingCamera = false;
  applicationState.isFramePaused = false;
  applicationState.didResumeFromFramePause = true;
  applicationState.isConvergencePauseEnabled = false;
  applicationState.isConvergencePaused = false;
  const [, gravitySettingsError] = applySceneMetadataGravityToState(applicationState, benchmarkSceneMetadata);
  if (gravitySettingsError) {
    return returnFailure(gravitySettingsError.code, gravitySettingsError.message, gravitySettingsError.details);
  }
  applicationState.lightBounceCount = normalizeBoundedInteger(
    benchmarkSceneMetadata.targetBounces,
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  applicationState.raysPerPixel = normalizeBoundedInteger(
    benchmarkSceneMetadata.targetRaysPerPixel,
    DEFAULT_RAYS_PER_PIXEL,
    MIN_RAYS_PER_PIXEL,
    MAX_RAYS_PER_PIXEL
  );
  applicationState.temporalBlendFrames = normalizeBoundedInteger(
    benchmarkSceneMetadata.targetTemporalBlendFrames,
    DEFAULT_TEMPORAL_BLEND_FRAMES,
    MIN_TEMPORAL_BLEND_FRAMES,
    MAX_TEMPORAL_BLEND_FRAMES
  );
  applicationState.denoiserStrength = normalizeBoundedNumber(
    benchmarkSceneMetadata.targetDenoiserStrength,
    DEFAULT_DENOISER_STRENGTH,
    MIN_DENOISER_STRENGTH,
    MAX_DENOISER_STRENGTH
  );
  applicationState.isCameraAutoRotating = true;
  applicationState.cameraAutoRotationSpeed = normalizeBoundedNumber(
    benchmarkSceneMetadata.cameraAutoRotationSpeed,
    CAMERA_AUTO_ROTATION_SPEED,
    0,
    CAMERA_AUTO_ROTATION_SPEED
  );
  if (
    Array.isArray(benchmarkSceneMetadata.cameraEyePosition) &&
    Array.isArray(benchmarkSceneMetadata.cameraTargetPosition)
  ) {
    const cameraEyePosition = createVec3(
      benchmarkSceneMetadata.cameraEyePosition[0],
      benchmarkSceneMetadata.cameraEyePosition[1],
      benchmarkSceneMetadata.cameraEyePosition[2]
    );
    const cameraTargetPosition = createVec3(
      benchmarkSceneMetadata.cameraTargetPosition[0],
      benchmarkSceneMetadata.cameraTargetPosition[1],
      benchmarkSceneMetadata.cameraTargetPosition[2]
    );
    const cameraAngles = readFpsCameraAnglesFromEyeTarget(cameraEyePosition, cameraTargetPosition);
    applicationState.cameraMode = CAMERA_MODE_FPS;
    applicationState.cameraAngleX = normalizeBoundedNumber(cameraAngles.cameraAngleX, 0, -0.8, 0.8);
    applicationState.cameraAngleY = normalizeBoundedNumber(cameraAngles.cameraAngleY, 0, -Math.PI, Math.PI);
    applicationState.cameraDistance = normalizeBoundedNumber(
      cameraAngles.cameraDistance,
      INITIAL_CAMERA_DISTANCE,
      0,
      4
    );
    writeVec3(
      applicationState.fpsEyePosition,
      cameraEyePosition[0],
      cameraEyePosition[1],
      cameraEyePosition[2]
    );
  } else {
    applicationState.cameraDistance = normalizeBoundedNumber(
      benchmarkSceneMetadata.cameraDistance,
      INITIAL_CAMERA_DISTANCE,
      1.5,
      4
    );
    applicationState.cameraAngleX = normalizeBoundedNumber(benchmarkSceneMetadata.cameraAngleX, 0, -0.8, 0.8);
    applicationState.cameraAngleY = normalizeBoundedNumber(
      benchmarkSceneMetadata.cameraAngleY,
      0,
      -Math.PI,
      Math.PI
    );
    applicationState.cameraMode = CAMERA_MODE_ORBIT;
    writeOrbitEyePosition(
      applicationState.fpsEyePosition,
      applicationState.cameraAngleX,
      applicationState.cameraAngleY,
      applicationState.cameraDistance
    );
  }
  applicationState.isPointerLocked = false;
  clearFpsMovementState(applicationState);
  applicationState.lightIntensity = normalizeBoundedNumber(
    benchmarkSceneMetadata.lightIntensity,
    DEFAULT_LIGHT_INTENSITY,
    MIN_LIGHT_INTENSITY,
    MAX_LIGHT_INTENSITY
  );
  applicationState.lightSize = normalizeBoundedNumber(
    benchmarkSceneMetadata.lightSize,
    DEFAULT_LIGHT_SIZE,
    MIN_LIGHT_SIZE,
    MAX_LIGHT_SIZE
  );
  applicationState.environment = Number.isFinite(benchmarkSceneMetadata.environment)
    ? benchmarkSceneMetadata.environment
    : ENVIRONMENT.YELLOW_BLUE_CORNELL_BOX;
  applicationState.fogDensity = normalizeBoundedNumber(
    benchmarkSceneMetadata.fogDensity,
    DEFAULT_FOG_DENSITY,
    MIN_FOG_DENSITY,
    MAX_FOG_DENSITY
  );
  applicationState.skyBrightness = normalizeBoundedNumber(
    benchmarkSceneMetadata.skyBrightness,
    DEFAULT_SKY_BRIGHTNESS,
    MIN_SKY_BRIGHTNESS,
    MAX_SKY_BRIGHTNESS
  );
  applicationState.cameraFocusDistance = normalizeBoundedNumber(
    benchmarkSceneMetadata.cameraFocusDistance,
    DEFAULT_CAMERA_FOCUS_DISTANCE,
    MIN_CAMERA_FOCUS_DISTANCE,
    MAX_CAMERA_FOCUS_DISTANCE
  );
  applicationState.cameraAperture = normalizeBoundedNumber(
    benchmarkSceneMetadata.cameraAperture,
    DEFAULT_CAMERA_APERTURE,
    MIN_CAMERA_APERTURE,
    MAX_CAMERA_APERTURE
  );
  applicationState.motionBlurStrength = normalizeBoundedNumber(
    benchmarkSceneMetadata.motionBlurStrength,
    DEFAULT_MOTION_BLUR_STRENGTH,
    MIN_MOTION_BLUR_STRENGTH,
    MAX_MOTION_BLUR_STRENGTH
  );
  applicationState.cameraFieldOfViewDegrees = normalizeBoundedNumber(
    benchmarkSceneMetadata.cameraFieldOfViewDegrees,
    DEFAULT_CAMERA_FIELD_OF_VIEW_DEGREES,
    MIN_CAMERA_FIELD_OF_VIEW_DEGREES,
    MAX_CAMERA_FIELD_OF_VIEW_DEGREES
  );
  applicationState.isLightIntensityCycling = false;
  applicationState.lightIntensityCycleDirection = 1;
  applicationState.colorExposure = DEFAULT_COLOR_EXPOSURE;
  applicationState.colorBrightness = DEFAULT_COLOR_BRIGHTNESS;
  applicationState.colorContrast = DEFAULT_COLOR_CONTRAST;
  applicationState.colorSaturation = DEFAULT_COLOR_SATURATION;
  applicationState.colorGamma = DEFAULT_COLOR_GAMMA;
  applicationState.toneMappingMode = DEFAULT_TONE_MAPPING_MODE;
  applicationState.bloomStrength = DEFAULT_BLOOM_STRENGTH;
  applicationState.bloomThreshold = DEFAULT_BLOOM_THRESHOLD;
  applicationState.glareStrength = DEFAULT_GLARE_STRENGTH;
  applicationState.isFramePaused = false;
  applicationState.didResumeFromFramePause = true;
  applicationState.isConvergencePauseEnabled = false;
  applicationState.isConvergencePaused = false;
  applicationState.isRotatingCamera = false;
  applicationState.isPickingFocus = false;
  applicationState.renderDebugViewMode = RENDER_DEBUG_VIEW.BEAUTY;

  if (Array.isArray(benchmarkSceneMetadata.lightPosition)) {
    const lightPosition = clampLightPosition(
      createVec3(
        benchmarkSceneMetadata.lightPosition[0],
        benchmarkSceneMetadata.lightPosition[1],
        benchmarkSceneMetadata.lightPosition[2]
      ),
      applicationState.lightSize
    );
    writeVec3(applicationState.lightPosition, lightPosition[0], lightPosition[1], lightPosition[2]);
  }
  if (Array.isArray(benchmarkSceneMetadata.lightColor)) {
    writeVec3(
      applicationState.lightColor,
      normalizeBoundedNumber(benchmarkSceneMetadata.lightColor[0], 1, 0, 1),
      normalizeBoundedNumber(benchmarkSceneMetadata.lightColor[1], 1, 0, 1),
      normalizeBoundedNumber(benchmarkSceneMetadata.lightColor[2], 1, 0, 1)
    );
  } else {
    writeVec3(applicationState.lightColor, 1, 1, 1);
  }

  return returnSuccess(undefined);
};

const scenePresetFactories = Object.freeze({
  sphereColumn: createSphereColumnSceneObjects,
  spherePyramid: createSpherePyramidSceneObjects,
  sphereAndCube: createSphereAndCubeSceneObjects,
  cubeAndSpheres: createCubeAndSpheresSceneObjects,
  tableAndChair: createTableAndChairSceneObjects,
  stacks: createStacksSceneObjects,
  shaderShowcase: createShaderShowcaseSceneObjects,
  recursiveSpheres: createRecursiveSpheresSceneObjects,
  primitiveShowcase: createPrimitiveShowcaseSceneObjects,
  curvedPrimitiveShowcase: createCurvedPrimitiveShowcaseSceneObjects,
  flatPrimitiveShowcase: createFlatPrimitiveShowcaseSceneObjects,
  implicitPrimitiveShowcase: createImplicitPrimitiveShowcaseSceneObjects,
  areaLightShowcase: createAreaLightShowcaseSceneObjects,
  suzanneReference: createSuzanneReferenceSceneObjects,
  corridorOfLight: createCorridorOfLightSceneObjects,
  corridorOfLightGlassSphere: createCorridorOfLightGlassSphereSceneObjects,
  corridorOfLightMirrorCube: createCorridorOfLightMirrorCubeSceneObjects,
  depthOfFieldPortrait: createDepthOfFieldPortraitSceneObjects,
  shadowStudy: createShadowStudySceneObjects,
  mirrorRoom: createMirrorRoomSceneObjects,
  skySphere: createSkySphereSceneObjects,
  fogCorridor: createFogCorridorSceneObjects,
  materialGrid: createMaterialGridSceneObjects,
  neonRoom: createDemoNeonRoomSceneObjects
});

const createDefaultSceneMetadata = () => Object.freeze({
  gravityScale: DEFAULT_GLOBAL_GRAVITY_SCALE
});

const scenePresetMetadata = Object.freeze({
  sphereColumn: createDefaultSceneMetadata(),
  spherePyramid: createDefaultSceneMetadata(),
  sphereAndCube: createDefaultSceneMetadata(),
  cubeAndSpheres: createDefaultSceneMetadata(),
  tableAndChair: createDefaultSceneMetadata(),
  stacks: createDefaultSceneMetadata(),
  shaderShowcase: createDefaultSceneMetadata(),
  recursiveSpheres: createDefaultSceneMetadata(),
  primitiveShowcase: createDefaultSceneMetadata(),
  curvedPrimitiveShowcase: createDefaultSceneMetadata(),
  flatPrimitiveShowcase: createDefaultSceneMetadata(),
  implicitPrimitiveShowcase: createDefaultSceneMetadata(),
  areaLightShowcase: createDefaultSceneMetadata(),
  suzanneReference: createDefaultSceneMetadata(),
  corridorOfLight: createDefaultSceneMetadata(),
  corridorOfLightGlassSphere: createDefaultSceneMetadata(),
  corridorOfLightMirrorCube: createDefaultSceneMetadata(),
  depthOfFieldPortrait: createDefaultSceneMetadata(),
  shadowStudy: createDefaultSceneMetadata(),
  mirrorRoom: createDefaultSceneMetadata(),
  skySphere: createDefaultSceneMetadata(),
  fogCorridor: createDefaultSceneMetadata(),
  materialGrid: createDefaultSceneMetadata(),
  neonRoom: createDefaultSceneMetadata()
});

const readScenePresetMetadata = (presetName) => scenePresetMetadata[presetName] || createDefaultSceneMetadata();

const createEmptyScene = (applicationState = null) => {
  if (applicationState) {
    const [, animationClearError] = clearSceneAnimation(applicationState);
    if (animationClearError) {
      return returnFailure(animationClearError.code, animationClearError.message, animationClearError.details);
    }
  }
  return returnSuccess([]);
};

const validateSceneFactoryObjects = (
  sceneKey,
  sceneObjects,
  sceneKind,
  shouldRequireSceneObjects = false
) => {
  if (!Array.isArray(sceneObjects)) {
    return returnFailure(
      'scene-factory-invalid-objects',
      `${sceneKind} "${sceneKey}" did not return an object list.`
    );
  }

  if (shouldRequireSceneObjects && sceneObjects.length === 0) {
    return returnFailure(
      'scene-factory-empty-objects',
      `${sceneKind} "${sceneKey}" returned no scene objects.`
    );
  }

  const undefinedObjectIndex = sceneObjects.findIndex((sceneObject) => sceneObject === undefined);
  if (undefinedObjectIndex !== -1) {
    return returnFailure(
      'scene-factory-undefined-object',
      `${sceneKind} "${sceneKey}" returned undefined at object index ${undefinedObjectIndex}.`
    );
  }

  return returnSuccess(sceneObjects);
};

const createSceneObjectsFromFactory = (
  sceneKey,
  sceneFactory,
  applicationState,
  sceneKind,
  shouldRequireSceneObjects = false
) => {
  if (typeof sceneFactory !== 'function') {
    return returnFailure('scene-factory-missing', `${sceneKind} "${sceneKey}" is missing a factory function.`);
  }

  let sceneResult = null;
  try {
    sceneResult = sceneFactory(applicationState);
  } catch (factoryError) {
    return returnFailure(
      'scene-factory-threw',
      `${sceneKind} "${sceneKey}" could not be created.`,
      readErrorDetails(factoryError)
    );
  }

  if (!Array.isArray(sceneResult) || sceneResult.length < 2) {
    return returnFailure(
      'scene-factory-invalid-result',
      `${sceneKind} "${sceneKey}" did not return a result tuple.`
    );
  }

  const [sceneObjects, sceneError] = sceneResult;
  if (sceneError) {
    return returnFailure(
      sceneError.code || 'scene-factory-failed',
      sceneError.message || `${sceneKind} "${sceneKey}" could not be created.`,
      sceneError.details || null
    );
  }

  return validateSceneFactoryObjects(sceneKey, sceneObjects, sceneKind, shouldRequireSceneObjects);
};

const logSceneFactoryFailure = (channel, sceneKind, sceneKey, sceneError, recoveryMessage = '') => (
  logDiagnostic(
    'error',
    channel,
    `${sceneKind} "${sceneKey}" failed.${recoveryMessage}`,
    Object.freeze({
      code: sceneError.code,
      message: sceneError.message,
      details: sceneError.details
    })
  )
);

const runBenchmarkSceneFactoryStartupSmokeTest = () => {
  const failures = [];
  for (const [sceneKey, benchmarkScene] of Object.entries(benchmarkScenes)) {
    const smokeTestState = createApplicationState();
    const [, sceneError] = createSceneObjectsFromFactory(
      sceneKey,
      benchmarkScene && benchmarkScene.factory,
      smokeTestState,
      'Benchmark scene',
      true
    );
    if (!sceneError) {
      continue;
    }

    failures.push(Object.freeze({
      sceneKey,
      code: sceneError.code,
      message: sceneError.message,
      details: sceneError.details
    }));
    logSceneFactoryFailure('benchmark', 'Benchmark scene', sceneKey, sceneError);
  }

  if (failures.length > 0) {
    return returnFailure(
      'benchmark-scene-smoke-test-failed',
      `${failures.length} benchmark scene factory smoke test(s) failed.`,
      Object.freeze(failures)
    );
  }

  return returnSuccess(undefined);
};

const runScenePresetFactoryStartupSmokeTest = () => {
  const failures = [];
  for (const [sceneKey, sceneFactory] of Object.entries(scenePresetFactories)) {
    const smokeTestState = createApplicationState();
    const [, sceneError] = createSceneObjectsFromFactory(
      sceneKey,
      sceneFactory,
      smokeTestState,
      'Scene preset',
      true
    );
    if (!sceneError) {
      continue;
    }

    failures.push(Object.freeze({
      sceneKey,
      code: sceneError.code,
      message: sceneError.message,
      details: sceneError.details
    }));
    logSceneFactoryFailure('preset', 'Scene preset', sceneKey, sceneError);
  }

  if (failures.length > 0) {
    return returnFailure(
      'scene-preset-smoke-test-failed',
      `${failures.length} scene preset factory smoke test(s) failed.`,
      Object.freeze(failures)
    );
  }

  return returnSuccess(undefined);
};

const readInitialPresetName = (documentObject) => {
  const windowObject = documentObject.defaultView;
  if (!windowObject || !windowObject.location || !windowObject.URLSearchParams) {
    return 'sphereColumn';
  }

  const urlParameters = new windowObject.URLSearchParams(windowObject.location.search);
  const presetName = urlParameters.get('preset');
  return scenePresetFactories[presetName] ? presetName : 'sphereColumn';
};

const readInitialBenchmarkSceneName = (documentObject) => {
  const windowObject = documentObject.defaultView;
  if (!windowObject || !windowObject.location || !windowObject.URLSearchParams) {
    return '';
  }

  const urlParameters = new windowObject.URLSearchParams(windowObject.location.search);
  if (!urlParameters.has('bench')) {
    return '';
  }
  const benchmarkSceneName = resolveBenchmarkSceneName(urlParameters.get('bench') || 'default');
  return benchmarkScenes[benchmarkSceneName] ? benchmarkSceneName : '';
};

const createInitialSceneObjects = (applicationState, documentObject) => {
  const benchmarkSceneName = readInitialBenchmarkSceneName(documentObject);
  if (benchmarkSceneName) {
    const benchmarkScene = benchmarkScenes[benchmarkSceneName];
    const [, settingsError] = applyBenchmarkSceneSettingsToState(
      applicationState,
      benchmarkScene.metadata,
      benchmarkSceneName
    );
    if (settingsError) {
      return returnFailure(settingsError.code, settingsError.message, settingsError.details);
    }
    const [sceneObjects, sceneError] = createSceneObjectsFromFactory(
      benchmarkSceneName,
      benchmarkScene.factory,
      applicationState,
      'Benchmark scene',
      true
    );
    if (sceneError) {
      return returnFailure(sceneError.code, sceneError.message, sceneError.details);
    }
    return returnSuccess(lockBenchmarkSceneObjects(sceneObjects));
  }

  const presetName = readInitialPresetName(documentObject);
  const [, presetMetadataError] = applySceneMetadataGravityToState(
    applicationState,
    readScenePresetMetadata(presetName)
  );
  if (presetMetadataError) {
    return returnFailure(presetMetadataError.code, presetMetadataError.message, presetMetadataError.details);
  }
  const [sceneObjects, sceneError] = createSceneObjectsFromFactory(
    presetName,
    scenePresetFactories[presetName],
    applicationState,
    'Scene preset'
  );
  if (!sceneError) {
    return returnSuccess(sceneObjects);
  }

  logSceneFactoryFailure('preset', 'Scene preset', presetName, sceneError, ' Loading a blank scene instead.');
  applicationState.startupSceneLoadError = sceneError;
  const [emptySceneObjects, emptySceneError] = createEmptyScene(applicationState);
  if (emptySceneError) {
    return returnFailure(emptySceneError.code, emptySceneError.message, emptySceneError.details);
  }
  return returnSuccess(emptySceneObjects);
};

const readRequiredElement = (documentObject, elementId) => {
  const element = documentObject.getElementById(elementId);
  if (!element) {
    return returnFailure('missing-dom-element', `Required element "${elementId}" was not found.`);
  }
  return returnSuccess(element);
};

const readOptionalElement = (documentObject, elementId) => documentObject.getElementById(elementId);

const readRequiredInput = (documentObject, elementId) => {
  const [element, elementError] = readRequiredElement(documentObject, elementId);
  if (elementError) {
    return returnFailure(elementError.code, elementError.message, elementError.details);
  }

  if (!(element instanceof HTMLInputElement)) {
    return returnFailure('invalid-input-element', `Element "${elementId}" is not an input.`);
  }
  return returnSuccess(element);
};

const readRequiredSelect = (documentObject, elementId) => {
  const [element, elementError] = readRequiredElement(documentObject, elementId);
  if (elementError) {
    return returnFailure(elementError.code, elementError.message, elementError.details);
  }

  if (!(element instanceof HTMLSelectElement)) {
    return returnFailure('invalid-select-element', `Element "${elementId}" is not a select.`);
  }
  return returnSuccess(element);
};

const readRequiredButton = (documentObject, elementId) => {
  const [element, elementError] = readRequiredElement(documentObject, elementId);
  if (elementError) {
    return returnFailure(elementError.code, elementError.message, elementError.details);
  }

  if (!(element instanceof HTMLButtonElement)) {
    return returnFailure('invalid-button-element', `Element "${elementId}" is not a button.`);
  }
  return returnSuccess(element);
};

const readRequiredCanvas = (documentObject, elementId) => {
  const [element, elementError] = readRequiredElement(documentObject, elementId);
  if (elementError) {
    return returnFailure(elementError.code, elementError.message, elementError.details);
  }

  if (!(element instanceof HTMLCanvasElement)) {
    return returnFailure('invalid-canvas-element', `Element "${elementId}" is not a canvas.`);
  }

  return returnSuccess(element);
};

const applyCanvasSizeToDocument = (documentObject, canvasElement) => {
  applyRenderCanvasCssProperties(documentObject.documentElement, CANVAS_RENDER_WIDTH, CANVAS_RENDER_HEIGHT);
  canvasElement.width = CANVAS_RENDER_WIDTH;
  canvasElement.height = CANVAS_RENDER_HEIGHT;
  return returnSuccess(undefined);
};

const createWebGlContext = (canvasElement) => {
  const webGlContext = (
    canvasElement.getContext('webgl', HIGH_PERFORMANCE_WEBGL_CONTEXT_ATTRIBUTES) ||
    canvasElement.getContext('experimental-webgl', HIGH_PERFORMANCE_WEBGL_CONTEXT_ATTRIBUTES)
  );
  if (!webGlContext) {
    return returnFailure(
      'webgl-unavailable',
      'Your browser does not support WebGL.',
      'Please see https://get.webgl.org/get-a-webgl-implementation/'
    );
  }

  webGlContext.disable(webGlContext.DITHER);
  webGlContext.viewport(0, 0, CANVAS_RENDER_WIDTH, CANVAS_RENDER_HEIGHT);
  ACTIVE_WEBGL_PROGRAMS.delete(webGlContext);

  return returnSuccess(webGlContext);
};

const readWebGlStringParameter = (webGlContext, parameterName) => {
  const value = webGlContext.getParameter(parameterName);
  return typeof value === 'string' ? value : '';
};

const readWebGlPowerPreference = (webGlContext) => {
  if (typeof webGlContext.getContextAttributes !== 'function') {
    return WEBGL_POWER_PREFERENCE;
  }

  const contextAttributes = webGlContext.getContextAttributes();
  if (!contextAttributes || !contextAttributes.powerPreference) {
    return WEBGL_POWER_PREFERENCE;
  }

  return contextAttributes.powerPreference;
};

const readWebGlGpuInfo = (webGlContext) => {
  const debugRendererInfo = webGlContext.getExtension('WEBGL_debug_renderer_info');
  const vendorParameter = debugRendererInfo
    ? debugRendererInfo.UNMASKED_VENDOR_WEBGL
    : webGlContext.VENDOR;
  const rendererParameter = debugRendererInfo
    ? debugRendererInfo.UNMASKED_RENDERER_WEBGL
    : webGlContext.RENDERER;

  return Object.freeze({
    vendor: readWebGlStringParameter(webGlContext, vendorParameter),
    renderer: readWebGlStringParameter(webGlContext, rendererParameter),
    powerPreference: readWebGlPowerPreference(webGlContext),
    hasDebugRendererInfo: Boolean(debugRendererInfo)
  });
};

const readWebGlContextAttributesForLog = (webGlContext) => {
  if (typeof webGlContext.getContextAttributes !== 'function') {
    return null;
  }

  const contextAttributes = webGlContext.getContextAttributes();
  if (!contextAttributes) {
    return null;
  }

  return Object.freeze({
    alpha: Boolean(contextAttributes.alpha),
    antialias: Boolean(contextAttributes.antialias),
    depth: Boolean(contextAttributes.depth),
    desynchronized: Boolean(contextAttributes.desynchronized),
    failIfMajorPerformanceCaveat: Boolean(contextAttributes.failIfMajorPerformanceCaveat),
    powerPreference: contextAttributes.powerPreference || WEBGL_POWER_PREFERENCE,
    premultipliedAlpha: Boolean(contextAttributes.premultipliedAlpha),
    preserveDrawingBuffer: Boolean(contextAttributes.preserveDrawingBuffer),
    stencil: Boolean(contextAttributes.stencil)
  });
};

const readWebGlCapabilitiesForLog = (webGlContext) => Object.freeze({
  maxTextureSize: webGlContext.getParameter(webGlContext.MAX_TEXTURE_SIZE),
  maxTextureImageUnits: webGlContext.getParameter(webGlContext.MAX_TEXTURE_IMAGE_UNITS),
  maxVertexTextureImageUnits: webGlContext.getParameter(webGlContext.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
  maxRenderbufferSize: webGlContext.getParameter(webGlContext.MAX_RENDERBUFFER_SIZE),
  hasColorBufferFloat: Boolean(
    webGlContext.getExtension('EXT_color_buffer_float') ||
    webGlContext.getExtension('WEBGL_color_buffer_float')
  ),
  hasFloatTextures: Boolean(webGlContext.getExtension('OES_texture_float')),
  hasHalfFloatTextures: Boolean(webGlContext.getExtension('OES_texture_half_float')),
  hasTimerQuery: Boolean(webGlContext.getExtension('EXT_disjoint_timer_query')),
  hasDebugRendererInfo: Boolean(webGlContext.getExtension('WEBGL_debug_renderer_info'))
});

const logRendererInitialization = (webGlContext, gpuInfo, backendStatus) => (
  logDiagnostic('info', 'renderer', 'Renderer backend initialized.', Object.freeze({
    activeBackend: backendStatus && backendStatus.activeBackend ? backendStatus.activeBackend : 'webgl',
    hasWebGpuSupport: Boolean(backendStatus && backendStatus.hasWebGpuSupport),
    gpu: gpuInfo,
    renderResolution: Object.freeze({
      width: CANVAS_RENDER_WIDTH,
      height: CANVAS_RENDER_HEIGHT
    }),
    contextAttributes: readWebGlContextAttributesForLog(webGlContext),
    capabilities: readWebGlCapabilitiesForLog(webGlContext)
  }))
);

const isPreferredGpuRenderer = (gpuInfo) => {
  const searchableGpuText = `${gpuInfo.vendor} ${gpuInfo.renderer}`;
  return PREFERRED_GPU_RENDERER_PATTERNS.some((pattern) => pattern.test(searchableGpuText));
};

const updateGpuStatus = (documentObject, webGlContext) => {
  const gpuInfo = readWebGlGpuInfo(webGlContext);
  const rendererLabel = gpuInfo.renderer || 'Renderer hidden by browser';
  setBenchmarkGpuRenderer(rendererLabel);
  return returnSuccess(gpuInfo);
};

const updateRendererBackendStatus = (documentObject) => {
  const backendSelectElement = readOptionalElement(documentObject, 'renderer-backend');
  const backendStatusElement = readOptionalElement(documentObject, 'renderer-backend-status');
  const windowObject = documentObject.defaultView;
  const hasWebGpuSupport = Boolean(windowObject && windowObject.navigator && windowObject.navigator.gpu);

  if (backendSelectElement instanceof HTMLSelectElement) {
    backendSelectElement.value = 'webgl';
    const webGpuOptionElement = backendSelectElement.querySelector('option[value="webgpu"]');
    if (webGpuOptionElement instanceof HTMLOptionElement) {
      webGpuOptionElement.disabled = true;
      webGpuOptionElement.textContent = hasWebGpuSupport
        ? 'WebGPU detected - planned'
        : 'WebGPU unavailable';
    }
  }

  if (backendStatusElement) {
    backendStatusElement.textContent = hasWebGpuSupport
      ? 'WebGL active. WebGPU is detected but this build has no WebGPU renderer yet.'
      : 'WebGL active. WebGPU is not available in this browser.';
  }

  return returnSuccess(Object.freeze({
    activeBackend: 'webgl',
    hasWebGpuSupport
  }));
};

const DEFAULT_LOADING_DETAIL_TEXT = 'Blank frames during setup are expected while the renderer builds the scene.';
const SCENE_LOAD_DIALOG_DETAIL_TEXT = 'The renderer is releasing old GPU resources before building the new scene assets and associated components.';
const LOADING_STEP_STATE_LABELS = Object.freeze({
  pending: 'Queued',
  running: 'Running',
  done: 'Done',
  error: 'Failed'
});
const DEFERRED_SCENE_LOAD_STEPS = Object.freeze([
  Object.freeze({
    id: 'stop-runtime',
    label: 'Stop active interactions, benchmark runner, and pending frames'
  }),
  Object.freeze({
    id: 'release-shaders',
    label: 'Offload the previous path-tracer shader program'
  }),
  Object.freeze({
    id: 'clear-memory',
    label: 'Clear scene uniforms, texture bindings, and accumulation history'
  }),
  Object.freeze({
    id: 'yield',
    label: 'Yield one browser frame so this dialog can paint'
  }),
  Object.freeze({
    id: 'load-assets',
    label: 'Load new scene assets and associated components'
  }),
  Object.freeze({
    id: 'compile-shaders',
    label: 'Compile shaders, cache uniforms, and rebuild physics'
  }),
  Object.freeze({
    id: 'first-frame',
    label: 'Schedule the first frame with the new scene'
  })
]);

const clearLoadingSteps = (documentObject) => {
  const stepsElement = readOptionalElement(documentObject, 'loading-steps');
  if (!(stepsElement instanceof HTMLElement)) {
    return returnSuccess(undefined);
  }
  stepsElement.textContent = '';
  stepsElement.hidden = true;
  return returnSuccess(undefined);
};

const writeLoadingSteps = (
  documentObject,
  stepDefinitions,
  activeStepId,
  completedStepIds = Object.freeze([]),
  failedStepId = null
) => {
  const stepsElement = readOptionalElement(documentObject, 'loading-steps');
  if (!(stepsElement instanceof HTMLElement)) {
    return returnSuccess(undefined);
  }

  stepsElement.textContent = '';
  if (!Array.isArray(stepDefinitions) || stepDefinitions.length === 0) {
    stepsElement.hidden = true;
    return returnSuccess(undefined);
  }

  const completedStepIdSet = new Set(completedStepIds);
  for (const stepDefinition of stepDefinitions) {
    const stepId = stepDefinition.id;
    let stepState = 'pending';
    if (failedStepId === stepId) {
      stepState = 'error';
    } else if (completedStepIdSet.has(stepId)) {
      stepState = 'done';
    } else if (activeStepId === stepId) {
      stepState = 'running';
    }

    const itemElement = documentObject.createElement('li');
    itemElement.className = 'loading-step';
    itemElement.dataset.stepId = stepId;
    itemElement.dataset.stepState = stepState;

    const labelElement = documentObject.createElement('span');
    labelElement.className = 'loading-step-label';
    labelElement.textContent = stepDefinition.label;

    const stateElement = documentObject.createElement('span');
    stateElement.className = 'loading-step-state';
    stateElement.textContent = LOADING_STEP_STATE_LABELS[stepState];

    itemElement.append(labelElement, stateElement);
    stepsElement.appendChild(itemElement);
  }

  stepsElement.hidden = false;
  return returnSuccess(undefined);
};

const updateLoadingStatus = (documentObject, statusText, options = Object.freeze({})) => {
  const overlayElement = readOptionalElement(documentObject, 'loading-overlay');
  const statusElement = readOptionalElement(documentObject, 'loading-status');
  const detailElement = readOptionalElement(documentObject, 'loading-detail');
  if (statusElement) {
    statusElement.textContent = statusText;
  }
  if (detailElement) {
    detailElement.textContent = typeof options.detailText === 'string'
      ? options.detailText
      : DEFAULT_LOADING_DETAIL_TEXT;
  }
  if (overlayElement instanceof HTMLElement) {
    overlayElement.hidden = false;
    overlayElement.classList.remove('is-hidden');
    overlayElement.classList.remove('is-error');
  }
  if (!options.preserveLoadingSteps) {
    const [, clearStepsError] = clearLoadingSteps(documentObject);
    if (clearStepsError) {
      return returnFailure(clearStepsError.code, clearStepsError.message, clearStepsError.details);
    }
  }
  const errorPanelElement = readOptionalElement(documentObject, 'loading-error');
  if (errorPanelElement instanceof HTMLElement) {
    errorPanelElement.hidden = true;
  }
  const errorStackElement = readOptionalElement(documentObject, 'loading-error-stack');
  if (errorStackElement) {
    errorStackElement.textContent = '';
  }
  return returnSuccess(undefined);
};

const updateDeferredSceneLoadDialog = (
  documentObject,
  statusText,
  activeStepId,
  completedStepIds = Object.freeze([]),
  failedStepId = null
) => {
  const [, loadingError] = updateLoadingStatus(documentObject, statusText, {
    detailText: SCENE_LOAD_DIALOG_DETAIL_TEXT,
    preserveLoadingSteps: true
  });
  if (loadingError) {
    return returnFailure(loadingError.code, loadingError.message, loadingError.details);
  }

  return writeLoadingSteps(
    documentObject,
    DEFERRED_SCENE_LOAD_STEPS,
    activeStepId,
    completedStepIds,
    failedStepId
  );
};

const hideLoadingOverlay = (documentObject) => {
  const overlayElement = readOptionalElement(documentObject, 'loading-overlay');
  if (!(overlayElement instanceof HTMLElement)) {
    return returnSuccess(undefined);
  }

  overlayElement.classList.add('is-hidden');
  const windowObject = documentObject.defaultView;
  if (windowObject) {
    windowObject.setTimeout(() => {
      overlayElement.hidden = true;
    }, 180);
  } else {
    overlayElement.hidden = true;
  }
  return returnSuccess(undefined);
};

const queueLoadingOverlayDismiss = (documentObject) => {
  const windowObject = documentObject.defaultView;
  if (!windowObject) {
    return hideLoadingOverlay(documentObject);
  }
  windowObject.requestAnimationFrame(() => {
    hideLoadingOverlay(documentObject);
  });
  return returnSuccess(undefined);
};

const formatErrorDisplayText = (errorValue) => {
  const errorMessage = errorValue && errorValue.message ? String(errorValue.message) : 'Unknown renderer error.';
  const errorDetails = errorValue && errorValue.details ? String(errorValue.details) : '';
  return errorDetails ? `${errorMessage}\n\n${errorDetails}` : errorMessage;
};

const copyTextToClipboard = (documentObject, textValue) => {
  const windowObject = documentObject.defaultView;
  if (windowObject && windowObject.navigator && windowObject.navigator.clipboard) {
    windowObject.navigator.clipboard.writeText(textValue).catch(() => undefined);
    return;
  }

  const textAreaElement = documentObject.createElement('textarea');
  textAreaElement.value = textValue;
  textAreaElement.setAttribute('readonly', '');
  textAreaElement.style.position = 'fixed';
  textAreaElement.style.left = '-9999px';
  documentObject.body.appendChild(textAreaElement);
  textAreaElement.select();
  try {
    documentObject.execCommand('copy');
  } catch {
    // Best effort fallback for older browser shells.
  }
  documentObject.body.removeChild(textAreaElement);
};

const showLoadingError = (documentObject, errorValue, errorText) => {
  const overlayElement = readOptionalElement(documentObject, 'loading-overlay');
  if (!(overlayElement instanceof HTMLElement)) {
    return returnSuccess(undefined);
  }

  const shouldShowOverlayError = (
    !overlayElement.hidden ||
    !overlayElement.classList.contains('is-hidden') ||
    (errorValue && errorValue.code === 'startup-failed')
  );
  if (!shouldShowOverlayError) {
    return returnSuccess(undefined);
  }

  overlayElement.hidden = false;
  overlayElement.classList.remove('is-hidden');
  overlayElement.classList.add('is-error');

  const titleElement = readOptionalElement(documentObject, 'loading-status');
  if (titleElement) {
    titleElement.textContent = errorValue && errorValue.message
      ? errorValue.message
      : 'Renderer startup failed.';
  }

  const detailElement = readOptionalElement(documentObject, 'loading-detail');
  if (detailElement) {
    detailElement.textContent = 'The renderer stopped during startup. Copy the details below for debugging.';
  }

  const errorPanelElement = readOptionalElement(documentObject, 'loading-error');
  if (errorPanelElement instanceof HTMLElement) {
    errorPanelElement.hidden = false;
  }

  const stackElement = readOptionalElement(documentObject, 'loading-error-stack');
  if (stackElement) {
    stackElement.textContent = errorText;
  }

  const copyButton = readOptionalElement(documentObject, 'copy-loading-error');
  if (copyButton instanceof HTMLButtonElement) {
    copyButton.onclick = () => {
      copyTextToClipboard(documentObject, errorText);
      copyButton.title = 'Copied error details';
      copyButton.setAttribute('aria-label', 'Copied error details');
    };
  }

  return returnSuccess(undefined);
};

const displayError = (errorElement, errorValue) => {
  const errorText = formatErrorDisplayText(errorValue);
  errorElement.style.zIndex = '1';
  errorElement.textContent = errorText;
  return showLoadingError(errorElement.ownerDocument, errorValue, errorText);
};

const hideError = (errorElement) => {
  errorElement.style.zIndex = '-1';
  return returnSuccess(undefined);
};

const invalidateUserInterfaceCameraCache = (uiController) => {
  uiController.previousCameraAngleX = Number.NaN;
  uiController.previousCameraAngleY = Number.NaN;
  uiController.previousCameraDistance = Number.NaN;
  uiController.previousCameraFieldOfViewDegrees = Number.NaN;
  return returnSuccess(undefined);
};

const restoreWebGlRenderingResources = (application) => {
  const documentObject = application.canvasElement.ownerDocument;
  const [webGlContext, webGlContextError] = createWebGlContext(application.canvasElement);
  if (webGlContextError) {
    return returnFailure(webGlContextError.code, webGlContextError.message, webGlContextError.details);
  }

  const [gpuInfo] = updateGpuStatus(documentObject, webGlContext);
  const previousSelectedEntityId = application.uiController.selectionRenderer.selectedEntityId;
  const previousSelectedEntityIds = application.uiController.selectionRenderer.selectedEntityIds;
  const [selectionRenderer, rendererError] = SelectionRenderer.create(webGlContext);
  if (rendererError) {
    return returnFailure(rendererError.code, rendererError.message, rendererError.details);
  }

  selectionRenderer.setSelectedEntityIds(
    previousSelectedEntityIds,
    previousSelectedEntityId,
    { skipSceneStoreSync: true }
  );

  application.uiController.selectionRenderer = selectionRenderer;
  application.gpuInfo = gpuInfo;
  application.benchmarkDisplay.gpuRendererLabel = gpuInfo.renderer || 'Renderer hidden by browser';

  const [, rendererSyncError] = selectionRenderer.setObjects(
    application.uiController.sceneObjects,
    application.applicationState
  );
  if (rendererSyncError) {
    return returnFailure(rendererSyncError.code, rendererSyncError.message, rendererSyncError.details);
  }

  const [, cameraCacheError] = invalidateUserInterfaceCameraCache(application.uiController);
  if (cameraCacheError) {
    return returnFailure(cameraCacheError.code, cameraCacheError.message, cameraCacheError.details);
  }

  const [, selectedItemSyncError] = application.uiController.syncSelectedItemReadout();
  if (selectedItemSyncError) {
    return returnFailure(selectedItemSyncError.code, selectedItemSyncError.message, selectedItemSyncError.details);
  }

  return returnSuccess(undefined);
};

const createWebGlContextErrorValue = (code, message, details = null) => Object.freeze({
  code,
  message,
  details
});

const attachWebGlContextLossHandlers = (application) => {
  const canvasElement = application.canvasElement;
  const documentObject = canvasElement.ownerDocument;
  const applicationState = application.applicationState;
  let isRestoringWebGlContext = false;

  canvasElement.addEventListener('webglcontextlost', (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }

    applicationState.isWebGlContextLost = true;
    applicationState.isPointerDown = false;
    applicationState.isRotatingCamera = false;
    application.uiController.isMovingSelection = false;
    cancelScheduledAnimationFrame(applicationState);
    updateLoadingStatus(documentObject, 'Waiting for WebGL context restore...');
    logDiagnostic(
      'error',
      'renderer',
      'WebGL context was lost; rendering is paused until the browser restores the context.'
    );
    displayError(
      application.errorElement,
      createWebGlContextErrorValue(
        'webgl-context-lost',
        'WebGL context was lost.',
        'Rendering will resume when the browser restores the GPU context.'
      )
    );
  });

  canvasElement.addEventListener('webglcontextrestored', () => {
    if (isRestoringWebGlContext) {
      return;
    }

    isRestoringWebGlContext = true;
    updateLoadingStatus(documentObject, 'Restoring WebGL resources...');
    const [, restoreError] = restoreWebGlRenderingResources(application);
    if (restoreError) {
      applicationState.isWebGlContextLost = true;
      isRestoringWebGlContext = false;
      displayError(application.errorElement, restoreError);
      return;
    }

    applicationState.isWebGlContextLost = false;
    applicationState.didResumeFromFramePause = true;
    applicationState.isInitialFrameReady = false;
    hideError(application.errorElement);
    logDiagnostic('info', 'renderer', 'WebGL context restored and rendering resources were rebuilt.');
    isRestoringWebGlContext = false;

    const [, animationError] = scheduleAnimationFrame(applicationState);
    if (animationError) {
      displayError(application.errorElement, animationError);
      return;
    }

    if (applicationState.isFramePaused) {
      queueLoadingOverlayDismiss(documentObject);
    }
  });

  return returnSuccess(undefined);
};

const readCanvasPointerPosition = (canvasElement, event) => {
  const canvasBounds = canvasElement.getBoundingClientRect();
  return returnSuccess({
    x: (event.clientX - canvasBounds.left) * (canvasElement.width / canvasBounds.width),
    y: (event.clientY - canvasBounds.top) * (canvasElement.height / canvasBounds.height)
  });
};

const isPointerInsideCanvas = (pointerPosition) => (
  pointerPosition.x >= 0 &&
  pointerPosition.x < CANVAS_RENDER_WIDTH &&
  pointerPosition.y >= 0 &&
  pointerPosition.y < CANVAS_RENDER_HEIGHT
);

const isTextInputFocused = (documentObject) => {
  const activeElement = documentObject.activeElement;
  if (!activeElement) {
    return false;
  }

  if (activeElement.isContentEditable) {
    return true;
  }

  const tagName = activeElement.tagName;
  return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA';
};

const runAndDisplayError = (errorElement, action) => {
  const [, actionError] = action();
  if (actionError) {
    logDiagnostic('error', 'ui', 'UI action failed.', actionError);
    return displayError(errorElement, actionError);
  }
  return returnSuccess(undefined);
};

const DEFERRED_SCENE_LOAD_TOKENS = new WeakMap();

const readNextDeferredSceneLoadToken = (documentObject) => {
  const nextToken = (DEFERRED_SCENE_LOAD_TOKENS.get(documentObject) || 0) + 1;
  DEFERRED_SCENE_LOAD_TOKENS.set(documentObject, nextToken);
  return nextToken;
};

const isCurrentDeferredSceneLoadToken = (documentObject, sceneLoadToken) => (
  DEFERRED_SCENE_LOAD_TOKENS.get(documentObject) === sceneLoadToken
);

const displayDeferredSceneLoadError = (errorElement, errorValue) => {
  logDiagnostic('error', 'ui', 'Deferred scene load failed.', errorValue);
  return displayError(errorElement, errorValue);
};

const createDeferredSceneLoadThrownError = (errorValue) => returnFailure(
  'deferred-scene-load-threw',
  'Deferred scene load failed before it could report a structured error.',
  errorValue && errorValue.stack ? errorValue.stack : String(errorValue)
);

const isPromiseLike = (value) => Boolean(value && typeof value.then === 'function');

const requestDeferredSceneLoad = (documentObject, errorElement, statusText, teardownAction, loadAction) => {
  const sceneLoadToken = readNextDeferredSceneLoadToken(documentObject);
  const completedStepIds = [];
  const [, dialogError] = updateDeferredSceneLoadDialog(
    documentObject,
    statusText,
    'stop-runtime',
    completedStepIds
  );
  if (dialogError) {
    return displayDeferredSceneLoadError(errorElement, dialogError);
  }

  const [, teardownError] = teardownAction();
  if (teardownError) {
    updateDeferredSceneLoadDialog(
      documentObject,
      'Scene offload failed.',
      'stop-runtime',
      completedStepIds,
      'stop-runtime'
    );
    const [, dismissError] = queueLoadingOverlayDismiss(documentObject);
    if (dismissError) {
      logDiagnostic('error', 'ui', 'Deferred scene load could not dismiss loading overlay.', dismissError);
    }
    return displayDeferredSceneLoadError(errorElement, teardownError);
  }
  completedStepIds.push('stop-runtime', 'release-shaders', 'clear-memory');

  const [, yieldDialogError] = updateDeferredSceneLoadDialog(
    documentObject,
    'Old scene resources released. Preparing new scene load...',
    'yield',
    completedStepIds
  );
  if (yieldDialogError) {
    return displayDeferredSceneLoadError(errorElement, yieldDialogError);
  }

  const runLoadAction = () => {
    if (!isCurrentDeferredSceneLoadToken(documentObject, sceneLoadToken)) {
      return;
    }

    if (!completedStepIds.includes('load-assets')) {
      completedStepIds.push('load-assets');
    }
    updateDeferredSceneLoadDialog(
      documentObject,
      'Compiling shaders and syncing scene components...',
      'compile-shaders',
      completedStepIds
    );

    const finishLoadAction = (actionResult) => {
      if (!isCurrentDeferredSceneLoadToken(documentObject, sceneLoadToken)) {
        return;
      }
      const [, actionError] = actionResult || returnSuccess(undefined);
      if (actionError) {
        updateDeferredSceneLoadDialog(
          documentObject,
          'New scene load failed.',
          'compile-shaders',
          completedStepIds,
          'compile-shaders'
        );
        queueLoadingOverlayDismiss(documentObject);
        displayDeferredSceneLoadError(errorElement, actionError);
        return;
      }

      if (!completedStepIds.includes('compile-shaders')) {
        completedStepIds.push('compile-shaders');
      }
      updateDeferredSceneLoadDialog(
        documentObject,
        'Scene loaded. Rendering first frame...',
        'first-frame',
        completedStepIds
      );
      completedStepIds.push('first-frame');
      updateDeferredSceneLoadDialog(
        documentObject,
        'Scene loaded. Rendering first frame...',
        null,
        completedStepIds
      );
      const [, dismissError] = queueLoadingOverlayDismiss(documentObject);
      if (dismissError) {
        logDiagnostic('error', 'ui', 'Deferred scene load could not dismiss loading overlay.', dismissError);
      }
    };

    let actionResult;
    try {
      actionResult = loadAction();
    } catch (errorValue) {
      finishLoadAction(createDeferredSceneLoadThrownError(errorValue));
      return;
    }

    if (isPromiseLike(actionResult)) {
      actionResult
        .then(finishLoadAction)
        .catch((errorValue) => finishLoadAction(createDeferredSceneLoadThrownError(errorValue)));
      return;
    }

    finishLoadAction(actionResult);
  };
  const windowObject = documentObject.defaultView;
  const queueAfterFrame = () => {
    if (!isCurrentDeferredSceneLoadToken(documentObject, sceneLoadToken)) {
      return;
    }
    if (!completedStepIds.includes('yield')) {
      completedStepIds.push('yield');
    }
    updateDeferredSceneLoadDialog(
      documentObject,
      'Loading new scene assets and associated components...',
      'load-assets',
      completedStepIds
    );
    if (windowObject && typeof windowObject.setTimeout === 'function') {
      windowObject.setTimeout(runLoadAction, 0);
      return;
    }
    runLoadAction();
  };
  if (windowObject && typeof windowObject.requestAnimationFrame === 'function') {
    windowObject.requestAnimationFrame(queueAfterFrame);
  } else {
    queueAfterFrame();
  }

  return returnSuccess(undefined);
};

const clickUiButton = (documentObject, selector) => {
  const targetButton = documentObject.querySelector(selector);
  if (!(targetButton instanceof HTMLButtonElement)) {
    return returnFailure('missing-shortcut-target', `Shortcut target "${selector}" is not available.`);
  }

  targetButton.click();
  return returnSuccess(undefined);
};

const setSceneTreeCreateMenuOpen = (documentObject, shouldOpen) => {
  const createMenuElement = documentObject.getElementById('scene-tree-add-menu');
  const addButtonElement = documentObject.getElementById('scene-tree-add');
  if (!(createMenuElement instanceof HTMLElement)) {
    return returnFailure('missing-scene-tree-create-menu', 'Scene tree add menu is not available.');
  }

  if (shouldOpen) {
    const sceneTreeWindowElement = documentObject.getElementById('scene-tree-window');
    if (sceneTreeWindowElement instanceof HTMLElement) {
      sceneTreeWindowElement.hidden = false;
      sceneTreeWindowElement.classList.remove('is-collapsed');
    }
  }

  const createContainerElement = createMenuElement.closest('.scene-tree-create');
  if (createContainerElement instanceof HTMLElement) {
    createContainerElement.toggleAttribute('open', shouldOpen);
  }
  createMenuElement.hidden = !shouldOpen;
  const pressedValue = shouldOpen ? 'true' : 'false';
  for (const toggleButton of documentObject.querySelectorAll('button[data-action="toggle-scene-tree-create"]')) {
    if (toggleButton instanceof HTMLButtonElement) {
      toggleButton.setAttribute('aria-pressed', pressedValue);
    }
  }
  if (addButtonElement instanceof HTMLButtonElement) {
    addButtonElement.setAttribute('aria-expanded', pressedValue);
  }
  return returnSuccess(undefined);
};

const toggleSceneTreeCreateMenu = (documentObject) => {
  const createMenuElement = documentObject.getElementById('scene-tree-add-menu');
  if (!(createMenuElement instanceof HTMLElement)) {
    return returnFailure('missing-scene-tree-create-menu', 'Scene tree add menu is not available.');
  }
  return setSceneTreeCreateMenuOpen(documentObject, createMenuElement.hidden);
};

const requestCanvasPointerLock = (canvasElement) => {
  if (typeof canvasElement.requestPointerLock !== 'function') {
    return returnFailure('pointer-lock-unavailable', 'Pointer lock is not available for FPS camera control.');
  }

  try {
    const pointerLockRequest = canvasElement.requestPointerLock();
    if (pointerLockRequest && typeof pointerLockRequest.catch === 'function') {
      pointerLockRequest.catch(() => undefined);
    }
  } catch (error) {
    return returnFailure(
      'pointer-lock-request-failed',
      'Pointer lock could not be started for FPS camera control.',
      error instanceof Error ? error.message : null
    );
  }
  return returnSuccess(undefined);
};

const attachInputHandlers = (documentObject, canvasElement, errorElement, uiController) => {
  const applicationState = uiController.applicationState;
  const windowObject = documentObject.defaultView;

  canvasElement.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    applicationState.isPointerDown = true;
    applicationState.previousPointerX = pointerPosition.x;
    applicationState.previousPointerY = pointerPosition.y;

    if (!isPointerInsideCanvas(pointerPosition)) {
      applicationState.isPointerDown = false;
      return returnSuccess(undefined);
    }

    if (applicationState.isPickingFocus) {
      const [, focusPickError] = uiController.handleFocusPick(pointerPosition.x, pointerPosition.y);
      if (focusPickError) {
        displayError(errorElement, focusPickError);
      }
      event.preventDefault();
      return returnSuccess(undefined);
    }

    if (applicationState.isBenchmarkModeActive) {
      applicationState.isPointerDown = false;
      event.preventDefault();
      return returnSuccess(undefined);
    }

    if (normalizeCameraMode(applicationState.cameraMode) === CAMERA_MODE_FPS) {
      applicationState.isPointerDown = false;
      applicationState.isRotatingCamera = false;
      const [, pointerLockError] = requestCanvasPointerLock(canvasElement);
      if (pointerLockError) {
        displayError(errorElement, pointerLockError);
      }
      event.preventDefault();
      return returnSuccess(undefined);
    }

    const [didSelectObject, selectError] = uiController.handleCanvasPress(
      pointerPosition.x,
      pointerPosition.y,
      {
        isRangeSelection: event.shiftKey,
        isToggleSelection: event.ctrlKey || event.metaKey
      }
    );
    if (selectError) {
      displayError(errorElement, selectError);
      return returnSuccess(undefined);
    }

    applicationState.isRotatingCamera = !didSelectObject;
    event.preventDefault();
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('mousemove', (event) => {
    if (
      normalizeCameraMode(applicationState.cameraMode) === CAMERA_MODE_FPS &&
      applicationState.isPointerLocked
    ) {
      if (event.movementX !== 0 || event.movementY !== 0) {
        applicationState.cameraAngleY -= event.movementX * FPS_CAMERA_MOUSE_SPEED;
        applicationState.cameraAngleX += event.movementY * FPS_CAMERA_MOUSE_SPEED;
        applicationState.cameraAngleX = clampNumber(
          applicationState.cameraAngleX,
          -CAMERA_PITCH_LIMIT,
          CAMERA_PITCH_LIMIT
        );
        const [, clearError] = uiController.selectionRenderer.pathTracer.clearSamples(false);
        if (clearError) {
          displayError(errorElement, clearError);
        }
      }
      return returnSuccess(undefined);
    }

    if ((applicationState.isRotatingCamera || uiController.isMovingSelection) && event.buttons === 0) {
      const [, cancelError] = uiController.cancelActivePointerInteraction();
      if (cancelError) {
        displayError(errorElement, cancelError);
      }
      return returnSuccess(undefined);
    }

    if (!applicationState.isRotatingCamera && !uiController.isMovingSelection) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    if (applicationState.isRotatingCamera) {
      applicationState.cameraAngleY -= (pointerPosition.x - applicationState.previousPointerX) * CAMERA_ROTATION_SPEED;
      applicationState.cameraAngleX += (pointerPosition.y - applicationState.previousPointerY) * CAMERA_ROTATION_SPEED;
      applicationState.cameraAngleX = clampNumber(
        applicationState.cameraAngleX,
        -CAMERA_PITCH_LIMIT,
        CAMERA_PITCH_LIMIT
      );
      applicationState.previousPointerX = pointerPosition.x;
      applicationState.previousPointerY = pointerPosition.y;
      const [, clearError] = uiController.selectionRenderer.pathTracer.clearSamples(false);
      if (clearError) {
        displayError(errorElement, clearError);
      }
      return returnSuccess(undefined);
    }

    const [, moveError] = uiController.handleCanvasMove(pointerPosition.x, pointerPosition.y);
    if (moveError) {
      displayError(errorElement, moveError);
    }
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('mouseup', (event) => {
    const wasMovingSelection = uiController.isMovingSelection;
    applicationState.isPointerDown = false;
    applicationState.isRotatingCamera = false;

    if (!wasMovingSelection) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    const [, releaseError] = uiController.handleCanvasRelease(pointerPosition.x, pointerPosition.y);
    if (releaseError) {
      displayError(errorElement, releaseError);
    }
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('mouseleave', (event) => {
    if (event.buttons !== 0) {
      return returnSuccess(undefined);
    }

    const [, cancelError] = uiController.cancelActivePointerInteraction();
    if (cancelError) {
      displayError(errorElement, cancelError);
    }
    return returnSuccess(undefined);
  });

  if (windowObject) {
    windowObject.addEventListener('blur', () => {
      const [, cancelError] = uiController.cancelActivePointerInteraction();
      if (cancelError) {
        displayError(errorElement, cancelError);
      }
      return returnSuccess(undefined);
    });
  }

  documentObject.addEventListener('pointerlockchange', () => {
    const isPointerLocked = (
      documentObject.pointerLockElement === canvasElement &&
      normalizeCameraMode(applicationState.cameraMode) === CAMERA_MODE_FPS
    );
    applicationState.isPointerLocked = isPointerLocked;
    if (!isPointerLocked) {
      applicationState.isPointerDown = false;
      applicationState.isRotatingCamera = false;
      clearFpsMovementState(applicationState);
    }
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('pointerlockerror', () => {
    displayError(errorElement, Object.freeze({
      code: 'pointer-lock-request-failed',
      message: 'Pointer lock could not be started for FPS camera control.',
      details: null
    }));
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('keydown', (event) => {
    if (isTextInputFocused(documentObject)) {
      return returnSuccess(undefined);
    }

    const shouldHandleFpsMovementKey = (
      normalizeCameraMode(applicationState.cameraMode) === CAMERA_MODE_FPS &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    );
    if (shouldHandleFpsMovementKey) {
      const [didUpdateFpsKey, fpsKeyError] = setFpsMovementKeyState(applicationState, event.code, true);
      if (fpsKeyError) {
        displayError(errorElement, fpsKeyError);
        return returnSuccess(undefined);
      }
      if (didUpdateFpsKey) {
        event.preventDefault();
        return returnSuccess(undefined);
      }
    }

    if (event.repeat) {
      return returnSuccess(undefined);
    }

    const isSystemShortcut = event.ctrlKey || event.metaKey;
    if (isSystemShortcut && !event.altKey && !event.shiftKey) {
      const panelShortcutSelectors = Object.freeze({
        KeyN: 'button[data-action="reset-all"]',
        Digit1: '#scene-tree-add',
        Digit2: 'button[data-panel-target="object-panel"]',
        Digit3: 'button[data-panel-target="render-panel"]',
        Digit4: 'button[data-panel-target="camera-panel"]',
        Digit5: 'button[data-panel-target="output-panel"]',
        Digit6: 'button[data-panel-target="preset-panel"]',
        KeyS: 'button[data-action="save-bitmap"]'
      });
      const shortcutSelector = panelShortcutSelectors[event.code];
      if (shortcutSelector) {
        runAndDisplayError(errorElement, () => clickUiButton(documentObject, shortcutSelector));
        event.preventDefault();
        return returnSuccess(undefined);
      }
    }

    if (!isSystemShortcut && !event.altKey && !event.shiftKey) {
      const commandShortcutSelectors = Object.freeze({
        Digit1: 'button[data-quality-preset="draft"]',
        Digit2: 'button[data-quality-preset="preview"]',
        Digit3: 'button[data-quality-preset="final"]',
        KeyB: 'button[data-window-target="benchmark"]',
        KeyC: '#camera-playback',
        KeyF: '#canvas-fullscreen',
        KeyI: 'button[data-window-target="controls"]',
        KeyK: '#convergence-pause',
        KeyL: 'button[data-action="select-light"]',
        KeyP: '#frame-pause',
        KeyT: 'button[data-window-target="scene-tree-window"]'
      });
      const shortcutSelector = commandShortcutSelectors[event.code];
      if (shortcutSelector) {
        runAndDisplayError(errorElement, () => clickUiButton(documentObject, shortcutSelector));
        event.preventDefault();
        return returnSuccess(undefined);
      }
    }

    if (event.key === 'Escape' && applicationState.isPickingFocus) {
      applicationState.isPickingFocus = false;
      const [, focusPickError] = uiController.syncFocusPickMode();
      if (focusPickError) {
        displayError(errorElement, focusPickError);
      }
      event.preventDefault();
      return returnSuccess(undefined);
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      const [, deleteError] = uiController.deleteSelection();
      if (deleteError) {
        displayError(errorElement, deleteError);
      }
      event.preventDefault();
    }
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('keyup', (event) => {
    const [didUpdateFpsKey, fpsKeyError] = setFpsMovementKeyState(applicationState, event.code, false);
    if (fpsKeyError) {
      displayError(errorElement, fpsKeyError);
      return returnSuccess(undefined);
    }
    if (didUpdateFpsKey && normalizeCameraMode(applicationState.cameraMode) === CAMERA_MODE_FPS) {
      event.preventDefault();
    }
    return returnSuccess(undefined);
  });

  canvasElement.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) {
      applicationState.isPointerDown = false;
      applicationState.isRotatingCamera = false;
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event.touches[0]);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    applicationState.isPointerDown = true;
    applicationState.previousPointerX = pointerPosition.x;
    applicationState.previousPointerY = pointerPosition.y;

    if (applicationState.isPickingFocus) {
      const [, focusPickError] = uiController.handleFocusPick(pointerPosition.x, pointerPosition.y);
      if (focusPickError) {
        displayError(errorElement, focusPickError);
      }
      event.preventDefault();
      return returnSuccess(undefined);
    }

    if (applicationState.isBenchmarkModeActive) {
      applicationState.isPointerDown = false;
      event.preventDefault();
      return returnSuccess(undefined);
    }

    applicationState.isRotatingCamera = true;
    event.preventDefault();
    return returnSuccess(undefined);
  }, { passive: false });

  canvasElement.addEventListener('touchmove', (event) => {
    if (!applicationState.isRotatingCamera || event.touches.length !== 1) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event.touches[0]);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    applicationState.cameraAngleY -= (pointerPosition.x - applicationState.previousPointerX) * CAMERA_ROTATION_SPEED;
    applicationState.cameraAngleX += (pointerPosition.y - applicationState.previousPointerY) * CAMERA_ROTATION_SPEED;
    applicationState.cameraAngleX = clampNumber(
      applicationState.cameraAngleX,
      -CAMERA_PITCH_LIMIT,
      CAMERA_PITCH_LIMIT
    );
    applicationState.previousPointerX = pointerPosition.x;
    applicationState.previousPointerY = pointerPosition.y;
    const [, clearError] = uiController.selectionRenderer.pathTracer.clearSamples(false);
    if (clearError) {
      displayError(errorElement, clearError);
    }
    event.preventDefault();
    return returnSuccess(undefined);
  }, { passive: false });

  canvasElement.addEventListener('touchend', () => {
    return uiController.cancelActivePointerInteraction();
  }, { passive: false });

  canvasElement.addEventListener('touchcancel', () => {
    return uiController.cancelActivePointerInteraction();
  }, { passive: false });

  return returnSuccess(undefined);
};

const INSPECTOR_SECTION_STORAGE_PREFIX = 'inspector-section-';

const readInspectorSectionElement = (panelElement) => {
  const sectionElement = panelElement.closest('[data-inspector-section]');
  return sectionElement instanceof HTMLDetailsElement ? sectionElement : null;
};

const syncPanelButtonPressedStates = (documentObject) => {
  for (const menuButton of documentObject.querySelectorAll('button[data-panel-target]')) {
    const panelElement = documentObject.getElementById(menuButton.dataset.panelTarget);
    const sectionElement = panelElement ? readInspectorSectionElement(panelElement) : null;
    const isPressed = sectionElement ? sectionElement.open : Boolean(panelElement && !panelElement.hidden);
    menuButton.setAttribute('aria-pressed', isPressed ? 'true' : 'false');
  }
  return returnSuccess(undefined);
};

const writeInspectorSectionState = (documentObject, sectionElement) => {
  const sectionKey = sectionElement.dataset.inspectorSection;
  const windowObject = documentObject.defaultView;
  if (!sectionKey || !windowObject || !windowObject.localStorage) {
    return returnSuccess(undefined);
  }
  try {
    windowObject.localStorage.setItem(
      `${INSPECTOR_SECTION_STORAGE_PREFIX}${sectionKey}`,
      sectionElement.open ? 'true' : 'false'
    );
  } catch {
    return returnSuccess(undefined);
  }
  return returnSuccess(undefined);
};

const attachInspectorAccordionHandlers = (documentObject, controlsElement) => {
  const sectionElements = Array.from(controlsElement.querySelectorAll('details[data-inspector-section]'));
  const windowObject = documentObject.defaultView;
  for (const sectionElement of sectionElements) {
    const sectionKey = sectionElement.dataset.inspectorSection;
    if (sectionKey && sectionKey !== 'object' && windowObject && windowObject.localStorage) {
      try {
        const storedValue = windowObject.localStorage.getItem(`${INSPECTOR_SECTION_STORAGE_PREFIX}${sectionKey}`);
        if (storedValue === 'true' || storedValue === 'false') {
          sectionElement.open = storedValue === 'true';
        }
      } catch {
        // Ignore storage failures; the accordion still works without persistence.
      }
    }

    sectionElement.addEventListener('toggle', () => {
      writeInspectorSectionState(documentObject, sectionElement);
      syncPanelButtonPressedStates(documentObject);
    });
  }
  return syncPanelButtonPressedStates(documentObject);
};

const syncObjectInspectorSection = (documentObject, selectedObject, displayName) => {
  const sectionElement = documentObject.querySelector('details[data-inspector-section="object"]');
  if (!(sectionElement instanceof HTMLDetailsElement)) {
    return returnSuccess(undefined);
  }
  const labelElement = sectionElement.querySelector('[data-inspector-section-label]');
  if (labelElement) {
    const [, labelError] = writeElementTextIfChanged(
      labelElement,
      selectedObject ? displayName : 'Nothing selected'
    );
    if (labelError) {
      return returnFailure(labelError.code, labelError.message, labelError.details);
    }
  }
  sectionElement.open = Boolean(selectedObject);
  return syncPanelButtonPressedStates(documentObject);
};

const scrollInspectorToObjectDetails = (documentObject) => {
  if (isTextInputFocused(documentObject)) {
    return returnSuccess(undefined);
  }

  const controlsElement = documentObject.getElementById('controls');
  if (!(controlsElement instanceof HTMLElement)) {
    return returnSuccess(undefined);
  }

  controlsElement.hidden = false;
  controlsElement.classList.remove('is-collapsed');

  const sectionElement = documentObject.querySelector('details[data-inspector-section="object"]');
  if (sectionElement instanceof HTMLDetailsElement) {
    sectionElement.open = true;
    writeInspectorSectionState(documentObject, sectionElement);
  }

  const targetElement = documentObject.getElementById('selected-item-name') || sectionElement;
  const scrollContainer = controlsElement.querySelector('.floating-window-body') || controlsElement;
  if (
    targetElement instanceof HTMLElement &&
    scrollContainer instanceof HTMLElement &&
    typeof targetElement.getBoundingClientRect === 'function' &&
    typeof scrollContainer.getBoundingClientRect === 'function'
  ) {
    const targetRect = targetElement.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    scrollContainer.scrollTop = Math.max(
      0,
      scrollContainer.scrollTop + targetRect.top - containerRect.top - 10
    );
  }

  return syncPanelButtonPressedStates(documentObject);
};

const switchControlPanel = (documentObject, controlsElement, targetPanelId) => {
  const panelElements = Array.from(documentObject.querySelectorAll('[data-control-panel]'));
  if (panelElements.length === 0) {
    return returnFailure('missing-panel-navigation', 'Panel navigation controls are missing.');
  }
  const targetPanelElement = documentObject.getElementById(targetPanelId);
  if (!targetPanelElement || !targetPanelElement.matches('[data-control-panel]')) {
    return returnFailure('missing-control-panel', `Control panel "${targetPanelId}" is not available.`);
  }

  for (const panelElement of panelElements) {
    panelElement.hidden = false;
  }
  const sectionElement = readInspectorSectionElement(targetPanelElement);
  if (sectionElement) {
    sectionElement.open = true;
  }
  const [, pressedError] = syncPanelButtonPressedStates(documentObject);
  if (pressedError) {
    return returnFailure(pressedError.code, pressedError.message, pressedError.details);
  }
  const scrollContainer = controlsElement.querySelector('.floating-window-body') || controlsElement;
  if (sectionElement && sectionElement.offsetTop > 0) {
    scrollContainer.scrollTop = Math.max(0, sectionElement.offsetTop - scrollContainer.offsetTop - 8);
  }
  return returnSuccess(undefined);
};

const attachPanelMenuHandlers = (documentObject, controlsElement) => {
  const [menuElement, menuError] = readRequiredElement(documentObject, 'app-menu');
  if (menuError) {
    return returnFailure(menuError.code, menuError.message, menuError.details);
  }

  if (!menuElement.querySelector('button[data-panel-target]')) {
    return returnFailure('missing-panel-navigation', 'Panel navigation controls are missing.');
  }

  menuElement.addEventListener('click', (event) => {
    const targetButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(targetButton instanceof HTMLButtonElement) || !menuElement.contains(targetButton)) {
      return returnSuccess(undefined);
    }

    const targetPanelId = targetButton.dataset.panelTarget;
    if (!targetPanelId) {
      return returnSuccess(undefined);
    }

    return switchControlPanel(documentObject, controlsElement, targetPanelId);
  });

  return returnSuccess(undefined);
};

const FLOATING_WINDOW_STORAGE_KEY = 'pathtracer.floatingWindows.v1';
const MIN_FLOATING_WINDOW_VISIBLE_SIZE = 80;
const FLOATING_WINDOW_VIEWPORT_PADDING = 8;

const readFloatingWindowTopBoundary = (windowObject) => {
  const documentObject = windowObject && windowObject.document;
  const appMenuElement = documentObject && documentObject.getElementById('app-menu');
  if (!appMenuElement || typeof appMenuElement.getBoundingClientRect !== 'function') {
    return FLOATING_WINDOW_VIEWPORT_PADDING;
  }

  const appMenuRectangle = appMenuElement.getBoundingClientRect();
  return Math.max(
    FLOATING_WINDOW_VIEWPORT_PADDING,
    Math.ceil(appMenuRectangle.bottom + FLOATING_WINDOW_VIEWPORT_PADDING)
  );
};

const readFloatingWindowStates = (documentObject) => {
  const windowObject = documentObject.defaultView;
  if (!windowObject || !windowObject.localStorage) {
    return {};
  }

  try {
    return JSON.parse(windowObject.localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeFloatingWindowStates = (documentObject, floatingWindowElements) => {
  const windowObject = documentObject.defaultView;
  if (!windowObject || !windowObject.localStorage) {
    return returnSuccess(undefined);
  }

  const existingStates = readFloatingWindowStates(documentObject);
  const nextStates = {};
  for (const floatingWindowElement of floatingWindowElements) {
    const windowRectangle = floatingWindowElement.getBoundingClientRect();
    const existingState = existingStates[floatingWindowElement.id] || {};
    nextStates[floatingWindowElement.id] = {
      left: floatingWindowElement.hidden ? existingState.left : Math.round(windowRectangle.left),
      top: floatingWindowElement.hidden ? existingState.top : Math.round(windowRectangle.top),
      width: floatingWindowElement.hidden ? existingState.width : Math.round(windowRectangle.width),
      height: floatingWindowElement.hidden ? existingState.height : Math.round(windowRectangle.height),
      hidden: floatingWindowElement.hidden,
      collapsed: floatingWindowElement.classList.contains('is-collapsed')
    };
  }

  try {
    windowObject.localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, JSON.stringify(nextStates));
  } catch {
    return returnSuccess(undefined);
  }
  return returnSuccess(undefined);
};

const clampFloatingWindowToViewport = (windowObject, floatingWindowElement) => {
  if (!windowObject) {
    return returnSuccess(undefined);
  }

  const windowRectangle = floatingWindowElement.getBoundingClientRect();
  const maxLeft = Math.max(
    FLOATING_WINDOW_VIEWPORT_PADDING,
    windowObject.innerWidth - MIN_FLOATING_WINDOW_VISIBLE_SIZE
  );
  const maxTop = Math.max(
    FLOATING_WINDOW_VIEWPORT_PADDING,
    windowObject.innerHeight - MIN_FLOATING_WINDOW_VISIBLE_SIZE
  );
  const minTop = readFloatingWindowTopBoundary(windowObject);
  const nextLeft = clampNumber(
    windowRectangle.left,
    FLOATING_WINDOW_VIEWPORT_PADDING,
    maxLeft
  );
  const nextTop = clampNumber(
    windowRectangle.top,
    minTop,
    Math.max(minTop, maxTop)
  );
  floatingWindowElement.style.left = `${nextLeft}px`;
  floatingWindowElement.style.top = `${nextTop}px`;
  floatingWindowElement.style.right = 'auto';
  floatingWindowElement.style.bottom = 'auto';
  return returnSuccess(undefined);
};

const createFloatingWindowManager = (documentObject) => {
  const windowObject = documentObject.defaultView;
  const floatingWindowElements = Array.from(documentObject.querySelectorAll('[data-floating-window]'));
  const savedStates = readFloatingWindowStates(documentObject);
  let nextZIndex = 200;

  const syncWindowTargetButtons = () => {
    for (const targetButton of documentObject.querySelectorAll('button[data-window-target]:not([data-panel-target])')) {
      const targetWindow = documentObject.getElementById(targetButton.dataset.windowTarget);
      targetButton.setAttribute('aria-pressed', targetWindow && !targetWindow.hidden ? 'true' : 'false');
    }
    return returnSuccess(undefined);
  };

  const saveStates = () => {
    const [, saveError] = writeFloatingWindowStates(documentObject, floatingWindowElements);
    if (saveError) {
      return returnFailure(saveError.code, saveError.message, saveError.details);
    }
    return syncWindowTargetButtons();
  };

  const focusWindow = (floatingWindowElement) => {
    nextZIndex += 1;
    floatingWindowElement.style.zIndex = String(nextZIndex);
    return returnSuccess(undefined);
  };

  const showWindow = (windowId) => {
    const floatingWindowElement = documentObject.getElementById(windowId);
    if (!floatingWindowElement || !floatingWindowElement.matches('[data-floating-window]')) {
      return returnFailure('missing-floating-window', `Floating window "${windowId}" is not available.`);
    }

    floatingWindowElement.hidden = false;
    setUiWindowVisible(windowId, true);
    floatingWindowElement.classList.remove('is-collapsed');
    const [, clampError] = clampFloatingWindowToViewport(windowObject, floatingWindowElement);
    if (clampError) {
      return returnFailure(clampError.code, clampError.message, clampError.details);
    }
    const [, focusError] = focusWindow(floatingWindowElement);
    if (focusError) {
      return returnFailure(focusError.code, focusError.message, focusError.details);
    }
    return saveStates();
  };

  const toggleWindow = (windowId, shouldForceShow = false) => {
    const floatingWindowElement = documentObject.getElementById(windowId);
    if (!floatingWindowElement || !floatingWindowElement.matches('[data-floating-window]')) {
      return returnFailure('missing-floating-window', `Floating window "${windowId}" is not available.`);
    }

    floatingWindowElement.hidden = shouldForceShow ? false : !floatingWindowElement.hidden;
    setUiWindowVisible(windowId, !floatingWindowElement.hidden);
    if (!floatingWindowElement.hidden) {
      floatingWindowElement.classList.remove('is-collapsed');
      const [, clampError] = clampFloatingWindowToViewport(windowObject, floatingWindowElement);
      if (clampError) {
        return returnFailure(clampError.code, clampError.message, clampError.details);
      }
      const [, focusError] = focusWindow(floatingWindowElement);
      if (focusError) {
        return returnFailure(focusError.code, focusError.message, focusError.details);
      }
    }
    return saveStates();
  };

  for (const floatingWindowElement of floatingWindowElements) {
    const savedState = savedStates[floatingWindowElement.id];
    if (savedState) {
      if (Number.isFinite(savedState.left)) {
        floatingWindowElement.style.left = `${savedState.left}px`;
        floatingWindowElement.style.right = 'auto';
      }
      if (Number.isFinite(savedState.top)) {
        floatingWindowElement.style.top = `${savedState.top}px`;
        floatingWindowElement.style.bottom = 'auto';
      }
      if (Number.isFinite(savedState.width)) {
        floatingWindowElement.style.width = `${Math.max(savedState.width, MIN_FLOATING_WINDOW_VISIBLE_SIZE)}px`;
      }
      if (Number.isFinite(savedState.height) && !savedState.collapsed) {
        floatingWindowElement.style.height = `${Math.max(savedState.height, 34)}px`;
      }
      floatingWindowElement.hidden = Boolean(savedState.hidden);
      floatingWindowElement.classList.toggle('is-collapsed', Boolean(savedState.collapsed));
    }

    nextZIndex += 1;
    floatingWindowElement.style.zIndex = String(nextZIndex);
    floatingWindowElement.addEventListener('pointerdown', () => {
      focusWindow(floatingWindowElement);
    });
    if (!floatingWindowElement.hidden) {
      const [, clampError] = clampFloatingWindowToViewport(windowObject, floatingWindowElement);
      if (clampError) {
        return returnFailure(clampError.code, clampError.message, clampError.details);
      }
    }
  }

  let activeDragState = null;
  documentObject.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) {
      return returnSuccess(undefined);
    }
    if (event.target.closest('button, input, select, textarea, a')) {
      return returnSuccess(undefined);
    }

    const dragHandle = event.target.closest('[data-window-drag-handle]');
    if (!dragHandle) {
      return returnSuccess(undefined);
    }
    const floatingWindowElement = dragHandle.closest('[data-floating-window]');
    if (!(floatingWindowElement instanceof HTMLElement)) {
      return returnSuccess(undefined);
    }

    const windowRectangle = floatingWindowElement.getBoundingClientRect();
    activeDragState = {
      floatingWindowElement,
      pointerId: event.pointerId,
      pointerOffsetX: event.clientX - windowRectangle.left,
      pointerOffsetY: event.clientY - windowRectangle.top
    };
    floatingWindowElement.style.left = `${windowRectangle.left}px`;
    floatingWindowElement.style.top = `${windowRectangle.top}px`;
    floatingWindowElement.style.width = `${windowRectangle.width}px`;
    floatingWindowElement.style.height = `${windowRectangle.height}px`;
    floatingWindowElement.style.right = 'auto';
    floatingWindowElement.style.bottom = 'auto';
    focusWindow(floatingWindowElement);
    if (typeof dragHandle.setPointerCapture === 'function') {
      dragHandle.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('pointermove', (event) => {
    if (!activeDragState || activeDragState.pointerId !== event.pointerId || !windowObject) {
      return returnSuccess(undefined);
    }

    const floatingWindowElement = activeDragState.floatingWindowElement;
    const nextLeft = clampNumber(
      event.clientX - activeDragState.pointerOffsetX,
      FLOATING_WINDOW_VIEWPORT_PADDING,
      Math.max(FLOATING_WINDOW_VIEWPORT_PADDING, windowObject.innerWidth - MIN_FLOATING_WINDOW_VISIBLE_SIZE)
    );
    const minTop = readFloatingWindowTopBoundary(windowObject);
    const nextTop = clampNumber(
      event.clientY - activeDragState.pointerOffsetY,
      minTop,
      Math.max(minTop, windowObject.innerHeight - MIN_FLOATING_WINDOW_VISIBLE_SIZE)
    );
    floatingWindowElement.style.left = `${nextLeft}px`;
    floatingWindowElement.style.top = `${nextTop}px`;
    event.preventDefault();
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('pointerup', (event) => {
    if (!activeDragState || activeDragState.pointerId !== event.pointerId) {
      return returnSuccess(undefined);
    }

    activeDragState = null;
    return saveStates();
  });

  documentObject.addEventListener('click', (event) => {
    const targetButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(targetButton instanceof HTMLButtonElement)) {
      return returnSuccess(undefined);
    }

    const isReactManagedButton = Boolean(targetButton.closest('[data-react-app-shell="mounted"]'));
    const targetWindowId = targetButton.dataset.windowTarget;
    if (targetWindowId) {
      if (isReactManagedButton) {
        return returnSuccess(undefined);
      }
      const shouldForceShow = Boolean(targetButton.dataset.panelTarget);
      return toggleWindow(targetWindowId, shouldForceShow);
    }

    const windowCommand = targetButton.dataset.windowCommand;
    if (!windowCommand) {
      return returnSuccess(undefined);
    }
    if (isReactManagedButton) {
      return returnSuccess(undefined);
    }

    const floatingWindowElement = targetButton.closest('[data-floating-window]');
    if (!(floatingWindowElement instanceof HTMLElement)) {
      return returnSuccess(undefined);
    }

    if (windowCommand === 'collapse') {
      floatingWindowElement.classList.toggle('is-collapsed');
      return saveStates();
    }
    if (windowCommand === 'close') {
      floatingWindowElement.hidden = true;
      if (floatingWindowElement.id) {
        setUiWindowVisible(floatingWindowElement.id, false);
      }
      return saveStates();
    }
    return returnSuccess(undefined);
  });

  if (windowObject && typeof windowObject.ResizeObserver === 'function') {
    const resizeObserver = new windowObject.ResizeObserver(() => {
      saveStates();
    });
    for (const floatingWindowElement of floatingWindowElements) {
      resizeObserver.observe(floatingWindowElement);
    }
  }

  if (windowObject) {
    windowObject.addEventListener('resize', () => {
      for (const floatingWindowElement of floatingWindowElements) {
        if (!floatingWindowElement.hidden) {
          clampFloatingWindowToViewport(windowObject, floatingWindowElement);
        }
      }
      saveStates();
    });
  }

  const [, syncError] = syncWindowTargetButtons();
  if (syncError) {
    return returnFailure(syncError.code, syncError.message, syncError.details);
  }

  return returnSuccess(Object.freeze({
    showWindow,
    toggleWindow
  }));
};

const attachControlHandlers = (controlRootElement, errorElement, uiController) => {
  const windowObject = controlRootElement.ownerDocument.defaultView;
  const logMissingExpectedControl = (controlId, expectedType) => logDiagnostic(
    'warn',
    'ui',
    'Expected UI control was not available during event-listener registration.',
    Object.freeze({ controlId, expectedType })
  );

  controlRootElement.addEventListener('click', (event) => {
    const targetButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(targetButton instanceof HTMLButtonElement) || !controlRootElement.contains(targetButton)) {
      return returnSuccess(undefined);
    }

    const sceneObjectIndex = targetButton.dataset.sceneObjectIndex;
    const sceneEntityId = targetButton.dataset.sceneEntityId;
    const targetPanelId = targetButton.dataset.panelTarget;
    const actionName = targetButton.dataset.action;
    const presetName = targetButton.dataset.preset;
    const benchmarkSceneName = targetButton.dataset.benchmarkScene;
    const qualityPresetName = targetButton.dataset.qualityPreset;
    const resolutionPresetSize = targetButton.dataset.resolutionPreset;
    const debugViewModeName = targetButton.dataset.debugView;
    const cameraShotSaveSlot = targetButton.dataset.cameraShotSave;
    const cameraShotLoadSlot = targetButton.dataset.cameraShotLoad;
    const physicsJointRemoveId = targetButton.dataset.physicsJointRemove;

    if (physicsJointRemoveId !== undefined) {
      return runAndDisplayError(errorElement, () => uiController.removeSelectedPhysicsJoint(physicsJointRemoveId));
    }
    if (sceneEntityId !== undefined) {
      return runAndDisplayError(errorElement, () => uiController.selectSceneObjectByEntityId(
        sceneEntityId,
        {
          isRangeSelection: event.shiftKey,
          isToggleSelection: event.ctrlKey || event.metaKey
        }
      ));
    }
    if (sceneObjectIndex !== undefined) {
      return runAndDisplayError(errorElement, () => uiController.selectSceneObjectByIndex(
        sceneObjectIndex,
        {
          isRangeSelection: event.shiftKey,
          isToggleSelection: event.ctrlKey || event.metaKey
        }
      ));
    }
    if (qualityPresetName) {
      return runAndDisplayError(errorElement, () => uiController.applyQualityPreset(qualityPresetName));
    }
    if (resolutionPresetSize) {
      return runAndDisplayError(errorElement, () => {
        const [, presetError] = uiController.applyResolutionPreset(resolutionPresetSize);
        if (presetError) {
          return returnFailure(presetError.code, presetError.message, presetError.details);
        }
        return uiController.applyResolutionFromControls();
      });
    }
    if (debugViewModeName !== undefined) {
      return runAndDisplayError(errorElement, () => uiController.setRenderDebugView(debugViewModeName));
    }
    if (cameraShotSaveSlot !== undefined) {
      return runAndDisplayError(
        errorElement,
        () => uiController.saveCameraShot(Number.parseInt(cameraShotSaveSlot, 10))
      );
    }
    if (cameraShotLoadSlot !== undefined) {
      return runAndDisplayError(
        errorElement,
        () => uiController.loadCameraShot(Number.parseInt(cameraShotLoadSlot, 10))
      );
    }
    if (actionName === 'toggle-scene-tree-create') {
      return runAndDisplayError(errorElement, () => toggleSceneTreeCreateMenu(controlRootElement.ownerDocument));
    }
    if (targetPanelId) {
      const controlsElement = controlRootElement.ownerDocument.getElementById('controls');
      if (!controlsElement) {
        return displayError(errorElement, Object.freeze({
          code: 'missing-controls-panel',
          message: 'Inspector controls are not available.',
          details: null
        }));
      }
      return runAndDisplayError(
        errorElement,
        () => switchControlPanel(controlRootElement.ownerDocument, controlsElement, targetPanelId)
      );
    }

    if (actionName === 'select-light') {
      return runAndDisplayError(errorElement, () => uiController.selectLight());
    }
    if (actionName === 'delete-selection') {
      return runAndDisplayError(errorElement, () => uiController.deleteSelection());
    }
    if (actionName === 'duplicate-selection') {
      return runAndDisplayError(errorElement, () => uiController.duplicateSelection());
    }
    if (actionName === 'rename-selection') {
      return runAndDisplayError(errorElement, () => uiController.renameSelection());
    }
    if (actionName === 'toggle-selection-hidden') {
      return runAndDisplayError(errorElement, () => uiController.toggleSelectionHidden());
    }
    if (actionName === 'toggle-selection-locked') {
      return runAndDisplayError(errorElement, () => uiController.toggleSelectionLocked());
    }
    if (actionName === 'connect-selected-spring') {
      return runAndDisplayError(errorElement, () => uiController.connectSelectedPhysicsSpringJointFromControls());
    }
    if (actionName === 'add-sphere') {
      const actionResult = runAndDisplayError(errorElement, () => uiController.addSphere());
      setSceneTreeCreateMenuOpen(controlRootElement.ownerDocument, false);
      return actionResult;
    }
    if (actionName === 'add-cube') {
      const actionResult = runAndDisplayError(errorElement, () => uiController.addCube());
      setSceneTreeCreateMenuOpen(controlRootElement.ownerDocument, false);
      return actionResult;
    }
    if (primitiveActionFactories[actionName]) {
      const actionResult = runAndDisplayError(errorElement, () => uiController.addPrimitive(primitiveActionFactories[actionName]));
      setSceneTreeCreateMenuOpen(controlRootElement.ownerDocument, false);
      return actionResult;
    }
    if (actionName === 'apply-object-shader') {
      return runAndDisplayError(errorElement, () => uiController.applyMaterialToSelection());
    }
    if (actionName === 'toggle-camera-playback') {
      return runAndDisplayError(
        errorElement,
        () => uiController.toggleCameraAutoRotation(uiController.cameraPlaybackButton)
      );
    }
    if (actionName === 'toggle-camera-mode') {
      return runAndDisplayError(errorElement, () => uiController.toggleCameraMode());
    }
    if (actionName === 'toggle-frame-pause') {
      return runAndDisplayError(errorElement, () => uiController.toggleFramePause(uiController.framePauseButton));
    }
    if (actionName === 'toggle-convergence-pause') {
      return runAndDisplayError(
        errorElement,
        () => uiController.toggleConvergencePause(uiController.convergencePauseButton)
      );
    }
    if (actionName === 'reset-physics-interactions') {
      return runAndDisplayError(errorElement, () => uiController.resetPhysicsInteractions());
    }
    if (actionName === 'toggle-light-cycle') {
      return runAndDisplayError(errorElement, () => uiController.toggleLightIntensityCycle(uiController.lightCycleButton));
    }
    if (actionName === 'toggle-focus-pick') {
      return runAndDisplayError(errorElement, () => uiController.toggleFocusPickMode());
    }
    if (actionName === 'reset-color-correction') {
      return runAndDisplayError(errorElement, () => uiController.resetColorCorrection());
    }
    if (actionName === 'apply-resolution') {
      return runAndDisplayError(errorElement, () => uiController.applyResolutionFromControls());
    }
    if (actionName === 'save-scene-json') {
      return runAndDisplayError(errorElement, () => uiController.saveSceneJson());
    }
    if (actionName === 'load-scene-json') {
      return runAndDisplayError(errorElement, () => uiController.loadSceneJsonFromPicker());
    }
    if (actionName === 'save-bitmap') {
      return runAndDisplayError(errorElement, () => uiController.saveCanvasBitmap());
    }
    if (actionName === 'toggle-canvas-fullscreen') {
      return runAndDisplayError(errorElement, () => uiController.toggleCanvasFullscreen());
    }
    if (actionName === 'toggle-fullscreen-panels') {
      return runAndDisplayError(errorElement, () => uiController.toggleFullscreenPanels());
    }
    if (actionName === 'run-benchmark-sequence') {
      return runAndDisplayError(errorElement, () => uiController.startBenchmarkRunner());
    }
    if (actionName === 'stop-benchmark-sequence') {
      return runAndDisplayError(errorElement, () => uiController.stopBenchmarkRunner());
    }
    if (actionName === 'copy-benchmark-results') {
      return runAndDisplayError(errorElement, () => uiController.copyBenchmarkResults());
    }
    if (actionName === 'save-benchmark-baseline') {
      return runAndDisplayError(errorElement, () => uiController.saveBenchmarkBaseline());
    }
    if (actionName === 'share-benchmark-results') {
      return runAndDisplayError(errorElement, () => uiController.shareBenchmarkResults());
    }
    if (actionName === 'save-benchmark-score-card') {
      return runAndDisplayError(errorElement, () => uiController.saveBenchmarkScoreCard());
    }
    if (actionName === 'apply-particle-fluid-settings') {
      return runAndDisplayError(errorElement, () => uiController.applyParticleFluidSettingsFromControls());
    }
    if (actionName === 'reset-all') {
      return runAndDisplayError(errorElement, () => uiController.resetAllToDefaults());
    }
    if (presetName) {
      const documentObject = controlRootElement.ownerDocument;
      return requestDeferredSceneLoad(
        documentObject,
        errorElement,
        'Loading scene and compiling shaders...',
        () => uiController.releaseSceneRendererResources(),
        () => uiController.loadPresetSceneAsync(presetName, { windowObject: documentObject.defaultView })
      );
    }

    if (benchmarkSceneName) {
      const resolvedBenchmarkSceneName = resolveBenchmarkSceneName(benchmarkSceneName);
      const benchmarkScene = benchmarkScenes[resolvedBenchmarkSceneName];
      if (!benchmarkScene) {
        return displayError(errorElement, Object.freeze({
          code: 'unknown-benchmark-scene',
          message: `Benchmark scene "${resolvedBenchmarkSceneName}" is not available.`,
          details: null
        }));
      }

      const documentObject = controlRootElement.ownerDocument;
      return requestDeferredSceneLoad(
        documentObject,
        errorElement,
        `Loading benchmark scene: ${benchmarkScene.metadata.displayName}...`,
        () => {
          const [, stopRunnerError] = uiController.stopBenchmarkRunner();
          if (stopRunnerError) {
            return returnFailure(stopRunnerError.code, stopRunnerError.message, stopRunnerError.details);
          }
          return uiController.releaseSceneRendererResources();
        },
        () => uiController.loadBenchmarkSceneAsync(resolvedBenchmarkSceneName, { windowObject: documentObject.defaultView })
      );
    }

    return returnSuccess(undefined);
  });

  uiController.materialSelect.addEventListener('change', () => (
    runAndDisplayError(errorElement, () => uiController.updateMaterialFromSelect())
  ));

  if (uiController.materialUvProjectionModeSelect instanceof HTMLSelectElement) {
    uiController.materialUvProjectionModeSelect.addEventListener('change', () => (
      runAndDisplayError(errorElement, () => uiController.updateMaterialProjectionFromControls())
    ));
  }

  uiController.environmentSelect.addEventListener('change', () => (
    runAndDisplayError(errorElement, () => uiController.updateEnvironmentFromSelect())
  ));

  uiController.glossinessInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateGlossinessFromInput())
  ));

  for (const materialUvInput of [
    uiController.materialUvScaleInput,
    uiController.materialUvBlendSharpnessInput
  ]) {
    if (materialUvInput instanceof HTMLInputElement) {
      materialUvInput.addEventListener('input', () => (
        runAndDisplayError(errorElement, () => uiController.updateMaterialProjectionFromControls())
      ));
    }
  }

  uiController.resolutionPresetSelect.addEventListener('change', () => {
    if (uiController.resolutionPresetSelect.value === 'custom') {
      return runAndDisplayError(errorElement, () => uiController.updateCustomRenderResolutionPreview());
    }
    return runAndDisplayError(
      errorElement,
      () => uiController.applyResolutionPreset(uiController.resolutionPresetSelect.value)
    );
  });

  uiController.renderScaleModeSelect.addEventListener('change', () => (
    runAndDisplayError(errorElement, () => uiController.updateRenderScalePreviewFromInput())
  ));

  uiController.renderScaleInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateRenderScalePreviewFromInput())
  ));

  uiController.customRenderWidthInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateCustomRenderResolutionPreview())
  ));

  uiController.customRenderHeightInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateCustomRenderResolutionPreview())
  ));

  if (windowObject) {
    windowObject.addEventListener('resize', () => (
      runAndDisplayError(errorElement, () => uiController.updateRenderScalePreviewFromInput())
    ));
  }

  controlRootElement.ownerDocument.addEventListener('fullscreenchange', () => {
    runAndDisplayError(errorElement, () => {
      const [, canvasButtonError] = uiController.syncFullscreenCanvasButton();
      if (canvasButtonError) {
        return returnFailure(canvasButtonError.code, canvasButtonError.message, canvasButtonError.details);
      }
      return uiController.syncFullscreenPanelsButton();
    });
  });

  uiController.lightBounceInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateLightBounceCountFromInput())
  ));

  uiController.lightIntensityInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateLightIntensityFromInput())
  ));

  uiController.lightSizeInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateLightSizeFromInput())
  ));

  uiController.lightColorInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateLightColorFromInput())
  ));

  const selectedLightInputHandlers = Object.freeze({
    'selected-light-intensity': () => uiController.updateSelectedLightIntensityFromInput(),
    'selected-light-size': () => uiController.updateSelectedLightSizeFromInput(),
    'selected-light-temperature': () => uiController.updateSelectedLightTemperatureFromInput(),
    'selected-light-color': () => uiController.updateSelectedLightColorFromInput()
  });
  for (const [selectedLightInputId, selectedLightInputHandler] of Object.entries(selectedLightInputHandlers)) {
    const selectedLightInput = readOptionalElement(controlRootElement.ownerDocument, selectedLightInputId);
    if (selectedLightInput instanceof HTMLInputElement) {
      selectedLightInput.addEventListener('input', () => (
        runAndDisplayError(errorElement, selectedLightInputHandler)
      ));
    } else {
      logMissingExpectedControl(selectedLightInputId, 'HTMLInputElement');
    }
  }

  const emissionEnabledInput = readOptionalElement(controlRootElement.ownerDocument, 'emission-enabled');
  if (emissionEnabledInput instanceof HTMLInputElement) {
    emissionEnabledInput.addEventListener('change', () => (
      runAndDisplayError(errorElement, () => uiController.updateSelectedEmissiveFromControls())
    ));
  }

  for (const emissiveInputId of ['emissive-intensity', 'emissive-color']) {
    const emissiveInput = readOptionalElement(controlRootElement.ownerDocument, emissiveInputId);
    if (emissiveInput instanceof HTMLInputElement) {
      emissiveInput.addEventListener('input', () => (
        runAndDisplayError(errorElement, () => uiController.updateSelectedEmissiveFromControls())
      ));
    } else {
      logMissingExpectedControl(emissiveInputId, 'HTMLInputElement');
    }
  }

  uiController.fogDensityInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateFogDensityFromInput())
  ));

  uiController.skyBrightnessInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateSkyBrightnessFromInput())
  ));

  uiController.raysPerPixelInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateRaysPerPixelFromInput())
  ));

  uiController.temporalBlendFramesInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateTemporalBlendFramesFromInput())
  ));

  uiController.denoiserStrengthInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateDenoiserStrengthFromInput())
  ));

  uiController.cameraFieldOfViewInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateCameraFieldOfViewFromInput())
  ));

  uiController.cameraFocusDistanceInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateCameraFocusDistanceFromInput())
  ));

  uiController.cameraApertureInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateCameraApertureFromInput())
  ));

  uiController.motionBlurInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateMotionBlurFromInput())
  ));

  uiController.colorExposureInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorExposureFromInput())
  ));

  uiController.colorBrightnessInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorBrightnessFromInput())
  ));

  uiController.colorContrastInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorContrastFromInput())
  ));

  uiController.colorSaturationInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorSaturationFromInput())
  ));

  uiController.colorGammaInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorGammaFromInput())
  ));

  uiController.toneMappingSelect.addEventListener('change', () => (
    runAndDisplayError(errorElement, () => uiController.updateToneMappingFromSelect())
  ));

  uiController.bloomStrengthInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateBloomStrengthFromInput())
  ));

  uiController.bloomThresholdInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateBloomThresholdFromInput())
  ));

  uiController.glareStrengthInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateGlareStrengthFromInput())
  ));

  const documentObject = controlRootElement.ownerDocument;
  for (const lightPositionInputId of ['light-position-x', 'light-position-y', 'light-position-z']) {
    const lightPositionInput = readOptionalElement(documentObject, lightPositionInputId);
    if (lightPositionInput instanceof HTMLInputElement) {
      lightPositionInput.addEventListener('change', () => (
        runAndDisplayError(errorElement, () => uiController.updateLightPositionFromInputs())
      ));
    } else {
      logMissingExpectedControl(lightPositionInputId, 'HTMLInputElement');
    }
  }

  const globalGravityDirectionSelect = readOptionalElement(documentObject, 'global-gravity-direction');
  if (globalGravityDirectionSelect instanceof HTMLSelectElement) {
    globalGravityDirectionSelect.addEventListener('change', () => (
      runAndDisplayError(errorElement, () => uiController.updateGlobalGravityFromControls())
    ));
  } else {
    logMissingExpectedControl('global-gravity-direction', 'HTMLSelectElement');
  }

  const globalGravityMagnitudeInput = readOptionalElement(documentObject, 'global-gravity-magnitude');
  if (globalGravityMagnitudeInput instanceof HTMLInputElement) {
    globalGravityMagnitudeInput.addEventListener('input', () => (
      runAndDisplayError(errorElement, () => uiController.updateGlobalGravityFromControls())
    ));
  } else {
    logMissingExpectedControl('global-gravity-magnitude', 'HTMLInputElement');
  }

  for (const globalGravityCustomInputId of [
    'global-gravity-custom-x',
    'global-gravity-custom-y',
    'global-gravity-custom-z'
  ]) {
    const globalGravityCustomInput = readOptionalElement(documentObject, globalGravityCustomInputId);
    if (globalGravityCustomInput instanceof HTMLInputElement) {
      globalGravityCustomInput.addEventListener('input', () => (
        runAndDisplayError(errorElement, () => uiController.updateGlobalGravityFromControls())
      ));
    } else {
      logMissingExpectedControl(globalGravityCustomInputId, 'HTMLInputElement');
    }
  }

  for (const transformInputId of ['selected-position-x', 'selected-position-y', 'selected-position-z']) {
    const transformInput = readOptionalElement(documentObject, transformInputId);
    if (transformInput instanceof HTMLInputElement) {
      transformInput.addEventListener('change', () => (
        runAndDisplayError(errorElement, () => uiController.updateSelectionTransformFromInputs())
      ));
    } else {
      logMissingExpectedControl(transformInputId, 'HTMLInputElement');
    }
  }

  const physicsEnabledInput = readOptionalElement(documentObject, 'selected-physics-enabled');
  if (physicsEnabledInput instanceof HTMLInputElement) {
    physicsEnabledInput.addEventListener('change', () => (
      runAndDisplayError(errorElement, () => uiController.updateSelectedPhysicsFromControls())
    ));
  } else {
    logMissingExpectedControl('selected-physics-enabled', 'HTMLInputElement');
  }

  const physicsBodyTypeSelect = readOptionalElement(documentObject, 'selected-physics-body-type');
  if (physicsBodyTypeSelect instanceof HTMLSelectElement) {
    physicsBodyTypeSelect.addEventListener('change', () => (
      runAndDisplayError(errorElement, () => uiController.updateSelectedPhysicsFromControls())
    ));
  } else {
    logMissingExpectedControl('selected-physics-body-type', 'HTMLSelectElement');
  }

  for (const physicsInputId of [
    'selected-physics-mass',
    'selected-physics-gravity-scale',
    'selected-physics-friction',
    'selected-physics-restitution'
  ]) {
    const physicsInput = readOptionalElement(documentObject, physicsInputId);
    if (physicsInput instanceof HTMLInputElement) {
      physicsInput.addEventListener('input', () => (
        runAndDisplayError(errorElement, () => uiController.updateSelectedPhysicsFromControls())
      ));
    } else {
      logMissingExpectedControl(physicsInputId, 'HTMLInputElement');
    }
  }

  const physicsCollideWithObjectsInput = readOptionalElement(documentObject, 'selected-physics-collide-with-objects');
  if (physicsCollideWithObjectsInput instanceof HTMLInputElement) {
    physicsCollideWithObjectsInput.addEventListener('change', () => (
      runAndDisplayError(errorElement, () => uiController.updateSelectedPhysicsFromControls())
    ));
  } else {
    logMissingExpectedControl('selected-physics-collide-with-objects', 'HTMLInputElement');
  }

  for (const physicsSpringInputId of [
    'selected-physics-spring-rest-length',
    'selected-physics-spring-stiffness',
    'selected-physics-spring-damping'
  ]) {
    const physicsSpringInput = readOptionalElement(documentObject, physicsSpringInputId);
    if (physicsSpringInput instanceof HTMLInputElement) {
      physicsSpringInput.addEventListener('input', () => (
        runAndDisplayError(errorElement, () => uiController.syncSelectedSpringJointInputLabels())
      ));
    } else {
      logMissingExpectedControl(physicsSpringInputId, 'HTMLInputElement');
    }
  }

  return returnSuccess(undefined);
};

const createPathTracingApplication = async (documentObject) => {
  updateLoadingStatus(documentObject, 'Initialising renderer...');
  const [canvasElement, canvasError] = readRequiredCanvas(documentObject, 'canvas');
  if (canvasError) {
    return returnFailure(canvasError.code, canvasError.message, canvasError.details);
  }
  registerRenderCanvas(canvasElement);
  applyCanvasSizeToDocument(documentObject, canvasElement);

  const [errorElement, errorElementError] = readRequiredElement(documentObject, 'error');
  if (errorElementError) {
    return returnFailure(errorElementError.code, errorElementError.message, errorElementError.details);
  }

  const [controlsElement, controlsElementError] = readRequiredElement(documentObject, 'controls');
  if (controlsElementError) {
    return returnFailure(controlsElementError.code, controlsElementError.message, controlsElementError.details);
  }

  const [appShellElement, appShellElementError] = readRequiredElement(documentObject, 'app-shell');
  if (appShellElementError) {
    return returnFailure(appShellElementError.code, appShellElementError.message, appShellElementError.details);
  }

  const [cameraPlaybackButton, cameraPlaybackButtonError] = readRequiredButton(documentObject, 'camera-playback');
  if (cameraPlaybackButtonError) {
    return returnFailure(cameraPlaybackButtonError.code, cameraPlaybackButtonError.message, cameraPlaybackButtonError.details);
  }

  const [framePauseButton, framePauseButtonError] = readRequiredButton(documentObject, 'frame-pause');
  if (framePauseButtonError) {
    return returnFailure(framePauseButtonError.code, framePauseButtonError.message, framePauseButtonError.details);
  }

  const [convergencePauseButton, convergencePauseButtonError] = readRequiredButton(documentObject, 'convergence-pause');
  if (convergencePauseButtonError) {
    return returnFailure(convergencePauseButtonError.code, convergencePauseButtonError.message, convergencePauseButtonError.details);
  }

  const [lightCycleButton, lightCycleButtonError] = readRequiredButton(documentObject, 'light-cycle');
  if (lightCycleButtonError) {
    return returnFailure(lightCycleButtonError.code, lightCycleButtonError.message, lightCycleButtonError.details);
  }

  const benchmarkSignalBindingDisposers = attachLegacyBenchmarkSignalBindings(documentObject);

  const [benchmarkRunnerStatusElement, benchmarkRunnerStatusError] = readRequiredElement(
    documentObject,
    'benchmark-runner-status'
  );
  if (benchmarkRunnerStatusError) {
    return returnFailure(
      benchmarkRunnerStatusError.code,
      benchmarkRunnerStatusError.message,
      benchmarkRunnerStatusError.details
    );
  }

  const [benchmarkRunnerSummaryElement, benchmarkRunnerSummaryError] = readRequiredElement(
    documentObject,
    'benchmark-runner-summary'
  );
  if (benchmarkRunnerSummaryError) {
    return returnFailure(
      benchmarkRunnerSummaryError.code,
      benchmarkRunnerSummaryError.message,
      benchmarkRunnerSummaryError.details
    );
  }

  const [benchmarkRunnerWarmupInput, benchmarkRunnerWarmupError] = readRequiredInput(
    documentObject,
    'benchmark-runner-warmup'
  );
  if (benchmarkRunnerWarmupError) {
    return returnFailure(
      benchmarkRunnerWarmupError.code,
      benchmarkRunnerWarmupError.message,
      benchmarkRunnerWarmupError.details
    );
  }

  const [benchmarkRunnerMeasurementInput, benchmarkRunnerMeasurementError] = readRequiredInput(
    documentObject,
    'benchmark-runner-measurement'
  );
  if (benchmarkRunnerMeasurementError) {
    return returnFailure(
      benchmarkRunnerMeasurementError.code,
      benchmarkRunnerMeasurementError.message,
      benchmarkRunnerMeasurementError.details
    );
  }

  const [glossinessContainer, glossinessContainerError] = readRequiredElement(documentObject, 'glossiness-factor');
  if (glossinessContainerError) {
    return returnFailure(glossinessContainerError.code, glossinessContainerError.message, glossinessContainerError.details);
  }

  const [materialSelect, materialSelectError] = readRequiredSelect(documentObject, 'material');
  if (materialSelectError) {
    return returnFailure(materialSelectError.code, materialSelectError.message, materialSelectError.details);
  }
  const [, materialOptionsError] = appendAdditionalMaterialSelectOptions(materialSelect);
  if (materialOptionsError) {
    return returnFailure(materialOptionsError.code, materialOptionsError.message, materialOptionsError.details);
  }

  const [environmentSelect, environmentSelectError] = readRequiredSelect(documentObject, 'environment');
  if (environmentSelectError) {
    return returnFailure(environmentSelectError.code, environmentSelectError.message, environmentSelectError.details);
  }

  const [glossinessInput, glossinessInputError] = readRequiredInput(documentObject, 'glossiness');
  if (glossinessInputError) {
    return returnFailure(glossinessInputError.code, glossinessInputError.message, glossinessInputError.details);
  }

  const [lightBounceInput, lightBounceInputError] = readRequiredInput(documentObject, 'light-bounces');
  if (lightBounceInputError) {
    return returnFailure(lightBounceInputError.code, lightBounceInputError.message, lightBounceInputError.details);
  }

  const [lightBounceValueElement, lightBounceValueError] = readRequiredElement(documentObject, 'light-bounces-value');
  if (lightBounceValueError) {
    return returnFailure(lightBounceValueError.code, lightBounceValueError.message, lightBounceValueError.details);
  }

  const [lightIntensityInput, lightIntensityInputError] = readRequiredInput(documentObject, 'light-intensity');
  if (lightIntensityInputError) {
    return returnFailure(lightIntensityInputError.code, lightIntensityInputError.message, lightIntensityInputError.details);
  }

  const [lightIntensityValueElement, lightIntensityValueError] = readRequiredElement(documentObject, 'light-intensity-value');
  if (lightIntensityValueError) {
    return returnFailure(lightIntensityValueError.code, lightIntensityValueError.message, lightIntensityValueError.details);
  }

  const [lightSizeInput, lightSizeInputError] = readRequiredInput(documentObject, 'light-size');
  if (lightSizeInputError) {
    return returnFailure(lightSizeInputError.code, lightSizeInputError.message, lightSizeInputError.details);
  }

  const [lightSizeValueElement, lightSizeValueError] = readRequiredElement(documentObject, 'light-size-value');
  if (lightSizeValueError) {
    return returnFailure(lightSizeValueError.code, lightSizeValueError.message, lightSizeValueError.details);
  }

  const [lightColorInput, lightColorInputError] = readRequiredInput(documentObject, 'light-color');
  if (lightColorInputError) {
    return returnFailure(lightColorInputError.code, lightColorInputError.message, lightColorInputError.details);
  }

  const [fogDensityInput, fogDensityInputError] = readRequiredInput(documentObject, 'fog-density');
  if (fogDensityInputError) {
    return returnFailure(fogDensityInputError.code, fogDensityInputError.message, fogDensityInputError.details);
  }

  const [fogDensityValueElement, fogDensityValueError] = readRequiredElement(documentObject, 'fog-density-value');
  if (fogDensityValueError) {
    return returnFailure(fogDensityValueError.code, fogDensityValueError.message, fogDensityValueError.details);
  }

  const [skyBrightnessInput, skyBrightnessInputError] = readRequiredInput(documentObject, 'sky-brightness');
  if (skyBrightnessInputError) {
    return returnFailure(skyBrightnessInputError.code, skyBrightnessInputError.message, skyBrightnessInputError.details);
  }

  const [skyBrightnessValueElement, skyBrightnessValueError] = readRequiredElement(documentObject, 'sky-brightness-value');
  if (skyBrightnessValueError) {
    return returnFailure(skyBrightnessValueError.code, skyBrightnessValueError.message, skyBrightnessValueError.details);
  }

  const [raysPerPixelInput, raysPerPixelInputError] = readRequiredInput(documentObject, 'rays-per-pixel');
  if (raysPerPixelInputError) {
    return returnFailure(raysPerPixelInputError.code, raysPerPixelInputError.message, raysPerPixelInputError.details);
  }

  const [raysPerPixelValueElement, raysPerPixelValueError] = readRequiredElement(documentObject, 'rays-per-pixel-value');
  if (raysPerPixelValueError) {
    return returnFailure(raysPerPixelValueError.code, raysPerPixelValueError.message, raysPerPixelValueError.details);
  }

  const [temporalBlendFramesInput, temporalBlendFramesInputError] = readRequiredInput(documentObject, 'temporal-blend-frames');
  if (temporalBlendFramesInputError) {
    return returnFailure(
      temporalBlendFramesInputError.code,
      temporalBlendFramesInputError.message,
      temporalBlendFramesInputError.details
    );
  }

  const [temporalBlendFramesValueElement, temporalBlendFramesValueError] = readRequiredElement(
    documentObject,
    'temporal-blend-frames-value'
  );
  if (temporalBlendFramesValueError) {
    return returnFailure(
      temporalBlendFramesValueError.code,
      temporalBlendFramesValueError.message,
      temporalBlendFramesValueError.details
    );
  }

  const [denoiserStrengthInput, denoiserStrengthInputError] = readRequiredInput(documentObject, 'denoiser-strength');
  if (denoiserStrengthInputError) {
    return returnFailure(denoiserStrengthInputError.code, denoiserStrengthInputError.message, denoiserStrengthInputError.details);
  }

  const [denoiserStrengthValueElement, denoiserStrengthValueError] = readRequiredElement(
    documentObject,
    'denoiser-strength-value'
  );
  if (denoiserStrengthValueError) {
    return returnFailure(denoiserStrengthValueError.code, denoiserStrengthValueError.message, denoiserStrengthValueError.details);
  }

  const [focusPickButton, focusPickButtonError] = readRequiredButton(documentObject, 'focus-pick');
  if (focusPickButtonError) {
    return returnFailure(focusPickButtonError.code, focusPickButtonError.message, focusPickButtonError.details);
  }

  const [cameraFieldOfViewInput, cameraFieldOfViewInputError] = readRequiredInput(documentObject, 'camera-fov');
  if (cameraFieldOfViewInputError) {
    return returnFailure(
      cameraFieldOfViewInputError.code,
      cameraFieldOfViewInputError.message,
      cameraFieldOfViewInputError.details
    );
  }

  const [cameraFieldOfViewValueElement, cameraFieldOfViewValueError] = readRequiredElement(
    documentObject,
    'camera-fov-value'
  );
  if (cameraFieldOfViewValueError) {
    return returnFailure(
      cameraFieldOfViewValueError.code,
      cameraFieldOfViewValueError.message,
      cameraFieldOfViewValueError.details
    );
  }

  const [cameraFocusDistanceInput, cameraFocusDistanceInputError] = readRequiredInput(
    documentObject,
    'camera-focus-distance'
  );
  if (cameraFocusDistanceInputError) {
    return returnFailure(
      cameraFocusDistanceInputError.code,
      cameraFocusDistanceInputError.message,
      cameraFocusDistanceInputError.details
    );
  }

  const [cameraFocusDistanceValueElement, cameraFocusDistanceValueError] = readRequiredElement(
    documentObject,
    'camera-focus-distance-value'
  );
  if (cameraFocusDistanceValueError) {
    return returnFailure(
      cameraFocusDistanceValueError.code,
      cameraFocusDistanceValueError.message,
      cameraFocusDistanceValueError.details
    );
  }

  const [cameraApertureInput, cameraApertureInputError] = readRequiredInput(documentObject, 'camera-aperture');
  if (cameraApertureInputError) {
    return returnFailure(cameraApertureInputError.code, cameraApertureInputError.message, cameraApertureInputError.details);
  }

  const [cameraApertureValueElement, cameraApertureValueError] = readRequiredElement(
    documentObject,
    'camera-aperture-value'
  );
  if (cameraApertureValueError) {
    return returnFailure(cameraApertureValueError.code, cameraApertureValueError.message, cameraApertureValueError.details);
  }

  const [motionBlurInput, motionBlurInputError] = readRequiredInput(documentObject, 'motion-blur');
  if (motionBlurInputError) {
    return returnFailure(motionBlurInputError.code, motionBlurInputError.message, motionBlurInputError.details);
  }

  const [motionBlurValueElement, motionBlurValueError] = readRequiredElement(documentObject, 'motion-blur-value');
  if (motionBlurValueError) {
    return returnFailure(motionBlurValueError.code, motionBlurValueError.message, motionBlurValueError.details);
  }

  const [colorExposureInput, colorExposureInputError] = readRequiredInput(documentObject, 'color-exposure');
  if (colorExposureInputError) {
    return returnFailure(colorExposureInputError.code, colorExposureInputError.message, colorExposureInputError.details);
  }

  const [colorExposureValueElement, colorExposureValueError] = readRequiredElement(documentObject, 'color-exposure-value');
  if (colorExposureValueError) {
    return returnFailure(colorExposureValueError.code, colorExposureValueError.message, colorExposureValueError.details);
  }

  const [colorBrightnessInput, colorBrightnessInputError] = readRequiredInput(documentObject, 'color-brightness');
  if (colorBrightnessInputError) {
    return returnFailure(
      colorBrightnessInputError.code,
      colorBrightnessInputError.message,
      colorBrightnessInputError.details
    );
  }

  const [colorBrightnessValueElement, colorBrightnessValueError] = readRequiredElement(
    documentObject,
    'color-brightness-value'
  );
  if (colorBrightnessValueError) {
    return returnFailure(
      colorBrightnessValueError.code,
      colorBrightnessValueError.message,
      colorBrightnessValueError.details
    );
  }

  const [colorContrastInput, colorContrastInputError] = readRequiredInput(documentObject, 'color-contrast');
  if (colorContrastInputError) {
    return returnFailure(colorContrastInputError.code, colorContrastInputError.message, colorContrastInputError.details);
  }

  const [colorContrastValueElement, colorContrastValueError] = readRequiredElement(documentObject, 'color-contrast-value');
  if (colorContrastValueError) {
    return returnFailure(colorContrastValueError.code, colorContrastValueError.message, colorContrastValueError.details);
  }

  const [colorSaturationInput, colorSaturationInputError] = readRequiredInput(documentObject, 'color-saturation');
  if (colorSaturationInputError) {
    return returnFailure(
      colorSaturationInputError.code,
      colorSaturationInputError.message,
      colorSaturationInputError.details
    );
  }

  const [colorSaturationValueElement, colorSaturationValueError] = readRequiredElement(
    documentObject,
    'color-saturation-value'
  );
  if (colorSaturationValueError) {
    return returnFailure(
      colorSaturationValueError.code,
      colorSaturationValueError.message,
      colorSaturationValueError.details
    );
  }

  const [colorGammaInput, colorGammaInputError] = readRequiredInput(documentObject, 'color-gamma');
  if (colorGammaInputError) {
    return returnFailure(colorGammaInputError.code, colorGammaInputError.message, colorGammaInputError.details);
  }

  const [colorGammaValueElement, colorGammaValueError] = readRequiredElement(documentObject, 'color-gamma-value');
  if (colorGammaValueError) {
    return returnFailure(colorGammaValueError.code, colorGammaValueError.message, colorGammaValueError.details);
  }

  const [toneMappingSelect, toneMappingSelectError] = readRequiredSelect(documentObject, 'tone-mapping');
  if (toneMappingSelectError) {
    return returnFailure(toneMappingSelectError.code, toneMappingSelectError.message, toneMappingSelectError.details);
  }

  const [bloomStrengthInput, bloomStrengthInputError] = readRequiredInput(documentObject, 'bloom-strength');
  if (bloomStrengthInputError) {
    return returnFailure(bloomStrengthInputError.code, bloomStrengthInputError.message, bloomStrengthInputError.details);
  }

  const [bloomStrengthValueElement, bloomStrengthValueError] = readRequiredElement(documentObject, 'bloom-strength-value');
  if (bloomStrengthValueError) {
    return returnFailure(bloomStrengthValueError.code, bloomStrengthValueError.message, bloomStrengthValueError.details);
  }

  const [bloomThresholdInput, bloomThresholdInputError] = readRequiredInput(documentObject, 'bloom-threshold');
  if (bloomThresholdInputError) {
    return returnFailure(bloomThresholdInputError.code, bloomThresholdInputError.message, bloomThresholdInputError.details);
  }

  const [bloomThresholdValueElement, bloomThresholdValueError] = readRequiredElement(documentObject, 'bloom-threshold-value');
  if (bloomThresholdValueError) {
    return returnFailure(bloomThresholdValueError.code, bloomThresholdValueError.message, bloomThresholdValueError.details);
  }

  const [glareStrengthInput, glareStrengthInputError] = readRequiredInput(documentObject, 'glare-strength');
  if (glareStrengthInputError) {
    return returnFailure(glareStrengthInputError.code, glareStrengthInputError.message, glareStrengthInputError.details);
  }

  const [glareStrengthValueElement, glareStrengthValueError] = readRequiredElement(documentObject, 'glare-strength-value');
  if (glareStrengthValueError) {
    return returnFailure(glareStrengthValueError.code, glareStrengthValueError.message, glareStrengthValueError.details);
  }

  const [selectedItemNameElement, selectedItemNameError] = readRequiredElement(documentObject, 'selected-item-name');
  if (selectedItemNameError) {
    return returnFailure(selectedItemNameError.code, selectedItemNameError.message, selectedItemNameError.details);
  }

  const [sceneTreeListElement, sceneTreeListError] = readRequiredElement(documentObject, 'scene-tree-list');
  if (sceneTreeListError) {
    return returnFailure(sceneTreeListError.code, sceneTreeListError.message, sceneTreeListError.details);
  }

  const [sceneTreeCountElement, sceneTreeCountError] = readRequiredElement(documentObject, 'scene-tree-count');
  if (sceneTreeCountError) {
    return returnFailure(sceneTreeCountError.code, sceneTreeCountError.message, sceneTreeCountError.details);
  }

  const [resolutionPresetSelect, resolutionPresetError] = readRequiredSelect(documentObject, 'resolution-preset');
  if (resolutionPresetError) {
    return returnFailure(resolutionPresetError.code, resolutionPresetError.message, resolutionPresetError.details);
  }

  const [renderScaleModeSelect, renderScaleModeError] = readRequiredSelect(documentObject, 'render-scale-mode');
  if (renderScaleModeError) {
    return returnFailure(renderScaleModeError.code, renderScaleModeError.message, renderScaleModeError.details);
  }

  const [renderScaleInput, renderScaleInputError] = readRequiredInput(documentObject, 'render-scale');
  if (renderScaleInputError) {
    return returnFailure(renderScaleInputError.code, renderScaleInputError.message, renderScaleInputError.details);
  }

  const [renderScaleValueElement, renderScaleValueError] = readRequiredElement(documentObject, 'render-scale-value');
  if (renderScaleValueError) {
    return returnFailure(renderScaleValueError.code, renderScaleValueError.message, renderScaleValueError.details);
  }

  const [renderScaleResolutionElement, renderScaleResolutionError] = readRequiredElement(documentObject, 'render-scale-resolution');
  if (renderScaleResolutionError) {
    return returnFailure(renderScaleResolutionError.code, renderScaleResolutionError.message, renderScaleResolutionError.details);
  }

  const [customRenderWidthInput, customRenderWidthError] = readRequiredInput(documentObject, 'custom-render-width');
  if (customRenderWidthError) {
    return returnFailure(customRenderWidthError.code, customRenderWidthError.message, customRenderWidthError.details);
  }

  const [customRenderHeightInput, customRenderHeightError] = readRequiredInput(documentObject, 'custom-render-height');
  if (customRenderHeightError) {
    return returnFailure(customRenderHeightError.code, customRenderHeightError.message, customRenderHeightError.details);
  }

  const [uiCanvasResolutionElement, uiCanvasResolutionError] = readRequiredElement(documentObject, 'ui-canvas-resolution');
  if (uiCanvasResolutionError) {
    return returnFailure(uiCanvasResolutionError.code, uiCanvasResolutionError.message, uiCanvasResolutionError.details);
  }

  const [exportStatusElement, exportStatusError] = readRequiredElement(documentObject, 'export-status');
  if (exportStatusError) {
    return returnFailure(exportStatusError.code, exportStatusError.message, exportStatusError.details);
  }

  const [fullscreenCanvasButton, fullscreenCanvasButtonError] = readRequiredButton(
    documentObject,
    'canvas-fullscreen'
  );
  if (fullscreenCanvasButtonError) {
    return returnFailure(
      fullscreenCanvasButtonError.code,
      fullscreenCanvasButtonError.message,
      fullscreenCanvasButtonError.details
    );
  }

  const [fullscreenPanelsButton, fullscreenPanelsButtonError] = readRequiredButton(
    documentObject,
    'fullscreen-panels-toggle'
  );
  if (fullscreenPanelsButtonError) {
    return returnFailure(
      fullscreenPanelsButtonError.code,
      fullscreenPanelsButtonError.message,
      fullscreenPanelsButtonError.details
    );
  }

  updateLoadingStatus(documentObject, 'Creating WebGL context...');
  const [webGlContext, webGlContextError] = createWebGlContext(canvasElement);
  if (webGlContextError) {
    displayError(errorElement, webGlContextError);
    return returnFailure(webGlContextError.code, webGlContextError.message, webGlContextError.details);
  }
  const [gpuInfo] = updateGpuStatus(documentObject, webGlContext);
  const [backendStatus, backendStatusError] = updateRendererBackendStatus(documentObject);
  if (backendStatusError) {
    return returnFailure(backendStatusError.code, backendStatusError.message, backendStatusError.details);
  }
  const [, rendererLogError] = logRendererInitialization(webGlContext, gpuInfo, backendStatus);
  if (rendererLogError) {
    return returnFailure(rendererLogError.code, rendererLogError.message, rendererLogError.details);
  }

  errorElement.textContent = 'Loading...';

  updateLoadingStatus(documentObject, 'Initialising physics...');
  const [rapierRuntime, rapierError] = await createRapierRuntime();
  if (rapierError) {
    return returnFailure(rapierError.code, rapierError.message, rapierError.details);
  }

  updateLoadingStatus(documentObject, 'Checking scene presets...');
  const [, presetSmokeError] = runScenePresetFactoryStartupSmokeTest();
  if (presetSmokeError) {
    displayError(errorElement, presetSmokeError);
  }

  updateLoadingStatus(documentObject, 'Checking benchmark scenes...');
  const [, benchmarkSmokeError] = runBenchmarkSceneFactoryStartupSmokeTest();
  if (benchmarkSmokeError) {
    displayError(errorElement, benchmarkSmokeError);
  }

  const [physicsWorld, physicsWorldError] = createRapierPhysicsWorld(rapierRuntime);
  if (physicsWorldError) {
    return returnFailure(physicsWorldError.code, physicsWorldError.message, physicsWorldError.details);
  }

  const applicationState = createApplicationState();
  if (presetSmokeError) {
    applicationState.startupSceneLoadError = presetSmokeError;
  }
  if (benchmarkSmokeError) {
    applicationState.startupSceneLoadError = benchmarkSmokeError;
  }
  applicationState.environment = Number.parseInt(environmentSelect.value, 10);
  const [initialMaterial, initialMaterialError] = parseMaterial(materialSelect.value);
  if (initialMaterialError) {
    return returnFailure(initialMaterialError.code, initialMaterialError.message, initialMaterialError.details);
  }
  applicationState.material = initialMaterial;
  const [lightIntensity, lightIntensityError] = parseBoundedNumber(
    lightIntensityInput.value,
    DEFAULT_LIGHT_INTENSITY,
    MIN_LIGHT_INTENSITY,
    MAX_LIGHT_INTENSITY
  );
  if (lightIntensityError) {
    return returnFailure(lightIntensityError.code, lightIntensityError.message, lightIntensityError.details);
  }
  applicationState.lightIntensity = lightIntensity;
  lightIntensityInput.value = lightIntensity.toFixed(2);
  lightIntensityValueElement.textContent = formatLightIntensityValue(applicationState.lightIntensity);
  const [lightBounceCount, lightBounceCountError] = parseBoundedInteger(
    lightBounceInput.value,
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  if (lightBounceCountError) {
    return returnFailure(lightBounceCountError.code, lightBounceCountError.message, lightBounceCountError.details);
  }
  applicationState.lightBounceCount = lightBounceCount;
  lightBounceInput.value = String(lightBounceCount);
  lightBounceValueElement.textContent = String(lightBounceCount);

  const [raysPerPixel, raysPerPixelError] = parseBoundedInteger(
    raysPerPixelInput.value,
    DEFAULT_RAYS_PER_PIXEL,
    MIN_RAYS_PER_PIXEL,
    MAX_RAYS_PER_PIXEL
  );
  if (raysPerPixelError) {
    return returnFailure(raysPerPixelError.code, raysPerPixelError.message, raysPerPixelError.details);
  }
  applicationState.raysPerPixel = raysPerPixel;
  raysPerPixelInput.value = String(raysPerPixel);
  raysPerPixelValueElement.textContent = String(raysPerPixel);

  const [temporalBlendFrames, temporalBlendFramesError] = parseBoundedInteger(
    temporalBlendFramesInput.value,
    DEFAULT_TEMPORAL_BLEND_FRAMES,
    MIN_TEMPORAL_BLEND_FRAMES,
    MAX_TEMPORAL_BLEND_FRAMES
  );
  if (temporalBlendFramesError) {
    return returnFailure(
      temporalBlendFramesError.code,
      temporalBlendFramesError.message,
      temporalBlendFramesError.details
    );
  }
  applicationState.temporalBlendFrames = temporalBlendFrames;
  temporalBlendFramesInput.value = String(temporalBlendFrames);
  temporalBlendFramesValueElement.textContent = String(temporalBlendFrames);

  updateLoadingStatus(documentObject, 'Compiling shaders...');
  const [selectionRenderer, rendererError] = SelectionRenderer.create(webGlContext);
  if (rendererError) {
    return returnFailure(rendererError.code, rendererError.message, rendererError.details);
  }

  const benchmarkDisplay = new BenchmarkSignalBridge(
    applicationState,
    gpuInfo.renderer || 'Renderer hidden by browser'
  );

  const uiController = new UserInterfaceController(
    selectionRenderer,
    physicsWorld,
    applicationState,
    canvasElement,
    appShellElement,
    cameraPlaybackButton,
    framePauseButton,
    convergencePauseButton,
    lightCycleButton,
    focusPickButton,
    glossinessContainer,
    materialSelect,
    environmentSelect,
    glossinessInput,
    lightBounceInput,
    lightBounceValueElement,
    lightIntensityInput,
    lightIntensityValueElement,
    lightSizeInput,
    lightSizeValueElement,
    lightColorInput,
    fogDensityInput,
    fogDensityValueElement,
    skyBrightnessInput,
    skyBrightnessValueElement,
    raysPerPixelInput,
    raysPerPixelValueElement,
    temporalBlendFramesInput,
    temporalBlendFramesValueElement,
    denoiserStrengthInput,
    denoiserStrengthValueElement,
    colorExposureInput,
    colorExposureValueElement,
    colorBrightnessInput,
    colorBrightnessValueElement,
    colorContrastInput,
    colorContrastValueElement,
    colorSaturationInput,
    colorSaturationValueElement,
    colorGammaInput,
    colorGammaValueElement,
    toneMappingSelect,
    cameraFieldOfViewInput,
    cameraFieldOfViewValueElement,
    cameraFocusDistanceInput,
    cameraFocusDistanceValueElement,
    cameraApertureInput,
    cameraApertureValueElement,
    motionBlurInput,
    motionBlurValueElement,
    bloomStrengthInput,
    bloomStrengthValueElement,
    bloomThresholdInput,
    bloomThresholdValueElement,
    glareStrengthInput,
    glareStrengthValueElement,
    selectedItemNameElement,
    sceneTreeListElement,
    sceneTreeCountElement,
    resolutionPresetSelect,
    renderScaleModeSelect,
    renderScaleInput,
    renderScaleValueElement,
    renderScaleResolutionElement,
    customRenderWidthInput,
    customRenderHeightInput,
    uiCanvasResolutionElement,
    exportStatusElement,
    fullscreenCanvasButton,
    fullscreenPanelsButton,
    benchmarkDisplay,
    benchmarkRunnerStatusElement,
    benchmarkRunnerSummaryElement,
    benchmarkRunnerWarmupInput,
    benchmarkRunnerMeasurementInput
  );

  const [, colorCorrectionError] = uiController.updateColorCorrectionFromInputs();
  if (colorCorrectionError) {
    return returnFailure(colorCorrectionError.code, colorCorrectionError.message, colorCorrectionError.details);
  }

  const [, cameraEffectsError] = uiController.updateCameraEffectsFromInputs();
  if (cameraEffectsError) {
    return returnFailure(cameraEffectsError.code, cameraEffectsError.message, cameraEffectsError.details);
  }

  updateLoadingStatus(documentObject, 'Building scene...');
  const initialEffectUpdates = [
    () => uiController.updateLightSizeFromInput(),
    () => uiController.updateFogDensityFromInput(),
    () => uiController.updateSkyBrightnessFromInput(),
    () => uiController.updateDenoiserStrengthFromInput(),
    () => uiController.updateBloomStrengthFromInput(),
    () => uiController.updateBloomThresholdFromInput(),
    () => uiController.updateGlareStrengthFromInput()
  ];
  for (const updateEffect of initialEffectUpdates) {
    const [, updateError] = updateEffect();
    if (updateError) {
      return returnFailure(updateError.code, updateError.message, updateError.details);
    }
  }

  const [initialSceneObjects, sceneError] = createInitialSceneObjects(applicationState, documentObject);
  if (sceneError) {
    return returnFailure(sceneError.code, sceneError.message, sceneError.details);
  }

  const [, setSceneError] = uiController.setSceneObjects(initialSceneObjects);
  if (setSceneError) {
    return returnFailure(setSceneError.code, setSceneError.message, setSceneError.details);
  }

  const [, initialControlSyncError] = uiController.syncAllControlsFromState();
  if (initialControlSyncError) {
    return returnFailure(
      initialControlSyncError.code,
      initialControlSyncError.message,
      initialControlSyncError.details
    );
  }

  const [, inputHandlerError] = attachInputHandlers(documentObject, canvasElement, errorElement, uiController);
  if (inputHandlerError) {
    return returnFailure(inputHandlerError.code, inputHandlerError.message, inputHandlerError.details);
  }

  const [, floatingWindowManagerError] = createFloatingWindowManager(documentObject);
  if (floatingWindowManagerError) {
    return returnFailure(
      floatingWindowManagerError.code,
      floatingWindowManagerError.message,
      floatingWindowManagerError.details
    );
  }

  const [, controlHandlerError] = attachControlHandlers(appShellElement, errorElement, uiController);
  if (controlHandlerError) {
    return returnFailure(controlHandlerError.code, controlHandlerError.message, controlHandlerError.details);
  }
  logDiagnostic('info', 'ui', 'UI panels and controls initialized.', Object.freeze({
    hasInspector: Boolean(documentObject.getElementById('controls')),
    hasSceneTree: Boolean(documentObject.getElementById('scene-tree-window')),
    hasBenchmarkPanel: Boolean(documentObject.getElementById('benchmark')),
    hasLogPanel: Boolean(documentObject.getElementById('log-panel'))
  }));

  const [, accordionError] = attachInspectorAccordionHandlers(documentObject, controlsElement);
  if (accordionError) {
    return returnFailure(accordionError.code, accordionError.message, accordionError.details);
  }

  const [, panelMenuError] = attachPanelMenuHandlers(documentObject, controlsElement);
  if (panelMenuError) {
    return returnFailure(panelMenuError.code, panelMenuError.message, panelMenuError.details);
  }

  const [, sharedResultsError] = uiController.loadSharedBenchmarkResults();
  if (sharedResultsError) {
    return returnFailure(sharedResultsError.code, sharedResultsError.message, sharedResultsError.details);
  }

  if (applicationState.startupSceneLoadError) {
    displayError(errorElement, applicationState.startupSceneLoadError);
    const [, loadingDismissError] = queueLoadingOverlayDismiss(documentObject);
    if (loadingDismissError) {
      return returnFailure(loadingDismissError.code, loadingDismissError.message, loadingDismissError.details);
    }
  } else {
    hideError(errorElement);
  }

  return returnSuccess({
    canvasElement,
    errorElement,
    uiController,
    benchmarkDisplay,
    benchmarkSignalBindingDisposers,
    applicationState,
    gpuInfo
  });
};

const startAnimationLoop = (application) => {
  let previousFrameTime = performance.now();

  const renderFrame = (currentTime) => {
    if (application.applicationState.isWebGlContextLost) {
      return returnSuccess(undefined);
    }
    if (application.applicationState.isFramePaused) {
      return returnSuccess(undefined);
    }
    if (application.applicationState.didResumeFromFramePause) {
      previousFrameTime = currentTime;
      application.applicationState.didResumeFromFramePause = false;
    }

    const elapsedSeconds = (currentTime - previousFrameTime) * 0.001;
    previousFrameTime = currentTime;
    const pathTracer = application.uiController.selectionRenderer.pathTracer;

    const [didMovePhysicsObject, physicsError] = application.uiController.stepPhysics(elapsedSeconds);
    if (physicsError) {
      displayError(application.errorElement, physicsError);
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }

    const [didAnimateScene, sceneAnimationError] = advanceSceneAnimation(
      application.applicationState,
      elapsedSeconds,
      pathTracer
    );
    if (sceneAnimationError) {
      displayError(application.errorElement, sceneAnimationError);
      return returnFailure(sceneAnimationError.code, sceneAnimationError.message, sceneAnimationError.details);
    }

    const [didMoveFpsCamera, fpsMovementError] = advanceFpsCameraMovement(
      application.applicationState,
      elapsedSeconds,
      pathTracer
    );
    if (fpsMovementError) {
      displayError(application.errorElement, fpsMovementError);
      return returnFailure(fpsMovementError.code, fpsMovementError.message, fpsMovementError.details);
    }

    const [didAutoRotateCamera, autoRotationError] = advanceCameraAutoRotation(
      application.applicationState,
      elapsedSeconds,
      pathTracer
    );
    if (autoRotationError) {
      displayError(application.errorElement, autoRotationError);
      return returnFailure(autoRotationError.code, autoRotationError.message, autoRotationError.details);
    }

    const [didCycleLightIntensity, lightCycleError] = application.uiController.advanceLightIntensityCycle(elapsedSeconds);
    if (lightCycleError) {
      displayError(application.errorElement, lightCycleError);
      return returnFailure(lightCycleError.code, lightCycleError.message, lightCycleError.details);
    }

    const didRenderMotionThisFrame = Boolean(
      didMovePhysicsObject ||
      didAnimateScene ||
      didMoveFpsCamera ||
      didAutoRotateCamera ||
      didCycleLightIntensity
    );
    const [, motionSettleError] = pathTracer.settleContinuousMotionDisplayHistory(didRenderMotionThisFrame);
    if (motionSettleError) {
      displayError(application.errorElement, motionSettleError);
      return returnFailure(motionSettleError.code, motionSettleError.message, motionSettleError.details);
    }

    const [, updateError] = application.uiController.update();
    if (updateError) {
      displayError(application.errorElement, updateError);
      return returnFailure(updateError.code, updateError.message, updateError.details);
    }

    const [, renderError] = application.uiController.render();
    if (renderError) {
      displayError(application.errorElement, renderError);
      return returnFailure(renderError.code, renderError.message, renderError.details);
    }

    if (!application.applicationState.isInitialFrameReady) {
      application.applicationState.isInitialFrameReady = true;
      const [, loadingDismissError] = hideLoadingOverlay(application.uiController.canvasElement.ownerDocument);
      if (loadingDismissError) {
        displayError(application.errorElement, loadingDismissError);
        return returnFailure(loadingDismissError.code, loadingDismissError.message, loadingDismissError.details);
      }
    }

    const didTraceNewSamples = pathTracer.lastRenderedSampleCount > 0;
    if (didTraceNewSamples && pathTracer.benchmarkSnapshot.measurementSource !== 'gpu-timer') {
      const [, frameBenchmarkError] = pathTracer.writeBenchmarkSnapshot(
        currentTime,
        pathTracer.lastRenderedSampleCount,
        application.applicationState.lightBounceCount,
        elapsedSeconds * 1000,
        pathTracer.gpuBenchmarkTimer ? 'frame-estimate-pending' : 'frame-estimate'
      );
      if (frameBenchmarkError) {
        displayError(application.errorElement, frameBenchmarkError);
        return returnFailure(frameBenchmarkError.code, frameBenchmarkError.message, frameBenchmarkError.details);
      }
    }

    const [, framePacingError] = pathTracer.writeBenchmarkFramePacing(currentTime, elapsedSeconds);
    if (framePacingError) {
      displayError(application.errorElement, framePacingError);
      return returnFailure(framePacingError.code, framePacingError.message, framePacingError.details);
    }

    if (!didTraceNewSamples && application.applicationState.isConvergencePaused) {
      const [, pausedBenchmarkError] = pathTracer.writePausedBenchmarkSnapshot(
        'rays-paused',
        false,
        application.applicationState
      );
      if (pausedBenchmarkError) {
        displayError(application.errorElement, pausedBenchmarkError);
        return returnFailure(pausedBenchmarkError.code, pausedBenchmarkError.message, pausedBenchmarkError.details);
      }
    }

    const [, runnerError] = application.uiController.advanceBenchmarkRunner(
      currentTime,
      pathTracer.benchmarkSnapshot
    );
    if (runnerError) {
      displayError(application.errorElement, runnerError);
      return returnFailure(runnerError.code, runnerError.message, runnerError.details);
    }

    const [, benchmarkError] = application.benchmarkDisplay.update(
      currentTime,
      pathTracer.benchmarkSnapshot
    );
    if (benchmarkError) {
      displayError(application.errorElement, benchmarkError);
      return returnFailure(benchmarkError.code, benchmarkError.message, benchmarkError.details);
    }

    return scheduleAnimationFrame(application.applicationState);
  };

  return scheduleRenderFrame(application.applicationState, renderFrame, { canvas: application.canvasElement });
};

const startPathTracingDemo = async () => {
  const [application, applicationError] = await createPathTracingApplication(document);
  if (applicationError) {
    return returnFailure(applicationError.code, applicationError.message, applicationError.details);
  }

  window.pathTracingDemo = application;
  window.ui = application.uiController;

  const [, contextLossHandlerError] = attachWebGlContextLossHandlers(application);
  if (contextLossHandlerError) {
    return returnFailure(
      contextLossHandlerError.code,
      contextLossHandlerError.message,
      contextLossHandlerError.details
    );
  }

  const [, animationError] = startAnimationLoop(application);
  if (animationError) {
    return returnFailure(animationError.code, animationError.message, animationError.details);
  }

  return returnSuccess(application);
};

const bootPathTracingDemo = () => (
  startPathTracingDemo().then(([application, startupError]) => {
  if (startupError) {
    const errorElement = document.getElementById('error');
    if (errorElement) {
      displayError(errorElement, startupError);
    }
    return returnFailure(startupError.code, startupError.message, startupError.details);
  }

    return returnSuccess(application);
  }, (startupError) => {
    const errorElement = document.getElementById('error');
    const errorValue = Object.freeze({
      code: 'startup-failed',
      message: 'Path tracing demo startup failed.',
      details: readErrorDetails(startupError)
    });
    if (errorElement) {
      displayError(errorElement, errorValue);
    }
    return returnFailure(errorValue.code, errorValue.message, errorValue.details);
  })
);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPathTracingDemo);
} else {
  bootPathTracingDemo();
}
