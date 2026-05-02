import { batch } from '@preact/signals';
import { updateBenchmarkSignals } from './benchmarkStore.js';

let activeAnimationFrameId = 0;
let activeWindow = null;
let activeCanvas = null;
let activeApplicationState = null;
let activeFrameCallback = null;
let isRunning = false;
let previousTimestamp = 0;

const returnSuccess = (value) => [value, null];
const returnFailure = (code, message, details = null) => [null, Object.freeze({ code, message, details })];

const readAnimationWindow = (canvas) => (
  canvas &&
  canvas.ownerDocument &&
  canvas.ownerDocument.defaultView
    ? canvas.ownerDocument.defaultView
    : globalThis
);

const readSchedulingWindow = (options = {}) => {
  if (options.windowObject && typeof options.windowObject.requestAnimationFrame === 'function') {
    return options.windowObject;
  }
  if (options.canvas) {
    return readAnimationWindow(options.canvas);
  }
  if (activeCanvas) {
    return readAnimationWindow(activeCanvas);
  }
  return globalThis;
};

export const registerRenderCanvas = (canvas) => {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('registerRenderCanvas requires a canvas element.');
  }

  activeCanvas = canvas;
  activeWindow = readAnimationWindow(canvas);

  return () => {
    if (activeCanvas === canvas) {
      activeCanvas = null;
      activeWindow = null;
    }
  };
};

export const stopRenderLoop = () => {
  if (isRunning && activeWindow && activeAnimationFrameId) {
    activeWindow.cancelAnimationFrame(activeAnimationFrameId);
  }

  if (activeApplicationState && activeApplicationState.animationFrameId === activeAnimationFrameId) {
    activeApplicationState.animationFrameId = 0;
  }

  activeAnimationFrameId = 0;
  activeWindow = null;
  activeCanvas = null;
  activeApplicationState = null;
  activeFrameCallback = null;
  isRunning = false;
  previousTimestamp = 0;
};

export const isRenderLoopRunning = () => isRunning;
export const getActiveRenderCanvas = () => activeCanvas;
export const getActiveAnimationFrameId = () => activeAnimationFrameId;

export const cancelScheduledRenderFrame = (appState = activeApplicationState) => {
  if (activeAnimationFrameId && activeWindow && typeof activeWindow.cancelAnimationFrame === 'function') {
    activeWindow.cancelAnimationFrame(activeAnimationFrameId);
  }

  if (appState && appState.animationFrameId === activeAnimationFrameId) {
    appState.animationFrameId = 0;
  }
  if (activeApplicationState && activeApplicationState.animationFrameId === activeAnimationFrameId) {
    activeApplicationState.animationFrameId = 0;
  }

  activeAnimationFrameId = 0;
  activeApplicationState = null;
  isRunning = false;
  return returnSuccess(undefined);
};

export const scheduleRenderFrame = (appState = {}, frameCallback = activeFrameCallback, options = {}) => {
  if (appState.isWebGlContextLost || appState.isFramePaused || activeAnimationFrameId || appState.animationFrameId) {
    return returnSuccess(undefined);
  }
  if (typeof frameCallback !== 'function') {
    return returnFailure('missing-animation-callback', 'Animation loop callback is not available.');
  }

  const schedulingWindow = readSchedulingWindow(options);
  if (
    !schedulingWindow ||
    typeof schedulingWindow.requestAnimationFrame !== 'function' ||
    typeof schedulingWindow.cancelAnimationFrame !== 'function'
  ) {
    return returnFailure('missing-animation-window', 'Animation frame scheduling is not available.');
  }

  if (options.canvas) {
    activeCanvas = options.canvas;
  }
  activeWindow = schedulingWindow;
  activeApplicationState = appState;
  activeFrameCallback = frameCallback;
  isRunning = true;

  const runScheduledFrame = (timestamp) => {
    const scheduledApplicationState = activeApplicationState;
    if (scheduledApplicationState && scheduledApplicationState.animationFrameId === activeAnimationFrameId) {
      scheduledApplicationState.animationFrameId = 0;
    }
    activeAnimationFrameId = 0;
    return frameCallback(timestamp);
  };

  activeAnimationFrameId = activeWindow.requestAnimationFrame(runScheduledFrame);
  appState.animationFrameId = activeAnimationFrameId;
  return returnSuccess(activeAnimationFrameId);
};

export const invokeWebGlRenderer = (renderer, appState, ...renderArguments) => {
  if (!renderer || typeof renderer.render !== 'function') {
    return returnFailure('missing-webgl-renderer', 'WebGL renderer is not available.');
  }

  return renderer.render(appState, ...renderArguments);
};

export const startRenderLoop = (canvas, appState = {}, options = {}) => {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('startRenderLoop requires a canvas element.');
  }

  stopRenderLoop();

  registerRenderCanvas(canvas);
  isRunning = true;
  previousTimestamp = 0;

  const onFrame = typeof options.onFrame === 'function' ? options.onFrame : null;
  const readBenchmarkSnapshot = typeof options.readBenchmarkSnapshot === 'function'
    ? options.readBenchmarkSnapshot
    : null;

  const frame = (timestamp) => {
    if (!isRunning) {
      return;
    }

    const elapsedMilliseconds = previousTimestamp > 0 ? timestamp - previousTimestamp : 0;
    previousTimestamp = timestamp;

    batch(() => {
      if (onFrame) {
        onFrame({
          canvas: activeCanvas,
          appState,
          timestamp,
          elapsedMilliseconds
        });
      }

      const benchmarkSnapshot = readBenchmarkSnapshot ? readBenchmarkSnapshot() : options.benchmarkSnapshot;
      if (benchmarkSnapshot) {
        updateBenchmarkSignals(benchmarkSnapshot, {
          resolution: options.resolution,
          bounces: options.bounces,
          gpuRenderer: options.gpuRenderer
        });
      }
    });

    if (isRunning) {
      scheduleRenderFrame(appState, frame, { canvas: activeCanvas });
    }
  };

  const [, scheduleError] = scheduleRenderFrame(appState, frame, { canvas });
  if (scheduleError) {
    stopRenderLoop();
    throw new Error(scheduleError.message);
  }
  return stopRenderLoop;
};
