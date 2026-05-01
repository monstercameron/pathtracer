import { batch } from '@preact/signals';
import { updateBenchmarkSignals } from './benchmarkStore.js';

let activeAnimationFrameId = 0;
let activeWindow = null;
let activeCanvas = null;
let isRunning = false;
let previousTimestamp = 0;

const readAnimationWindow = (canvas) => (
  canvas &&
  canvas.ownerDocument &&
  canvas.ownerDocument.defaultView
    ? canvas.ownerDocument.defaultView
    : globalThis
);

export const stopRenderLoop = () => {
  if (isRunning && activeWindow && activeAnimationFrameId) {
    activeWindow.cancelAnimationFrame(activeAnimationFrameId);
  }

  activeAnimationFrameId = 0;
  activeWindow = null;
  activeCanvas = null;
  isRunning = false;
  previousTimestamp = 0;
};

export const isRenderLoopRunning = () => isRunning;
export const getActiveRenderCanvas = () => activeCanvas;

export const startRenderLoop = (canvas, appState = {}, options = {}) => {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('startRenderLoop requires a canvas element.');
  }

  stopRenderLoop();

  activeCanvas = canvas;
  activeWindow = readAnimationWindow(canvas);
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

    activeAnimationFrameId = activeWindow.requestAnimationFrame(frame);
  };

  activeAnimationFrameId = activeWindow.requestAnimationFrame(frame);
  return stopRenderLoop;
};
