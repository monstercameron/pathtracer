import { batch, computed, signal } from '@preact/signals';

const writeSignal = (targetSignal, value) => {
  if (!Object.is(targetSignal.value, value)) {
    targetSignal.value = value;
  }
};

const readFiniteNumber = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

export const rendererBackend = signal('webgl');
export const activeRaysPerSecond = signal(0);
export const estimatedRayBandwidthBytesPerSecond = signal(0);
export const activeRaysPerFrame = signal(0);
export const pathRayBudgetPerFrame = signal(0);
export const samplesPerFrame = signal(0);
export const traceMilliseconds = signal(0);
export const rollingSamplesPerFrame = signal(0);
export const rollingTraceMilliseconds = signal(0);
export const perceptualFramesPerSecond = signal(0);
export const perceptualFrameMilliseconds = signal(0);
export const scoreSampleCount = signal(0);
export const performanceScore = signal(0);
export const measurementSource = signal('warming-up');
export const renderResolution = signal('512 x 512');
export const lightBounces = signal(5);
export const gpuRenderer = signal('Renderer hidden by browser');

export const score = performanceScore;
export const raysPerSecond = activeRaysPerSecond;
export const bandwidthBytesPerSecond = estimatedRayBandwidthBytesPerSecond;
export const perceptualFps = perceptualFramesPerSecond;
export const resolution = renderResolution;
export const bounces = lightBounces;

export const isPausedBenchmarkSource = (source) => (
  source === 'frame-paused' ||
  source === 'rays-paused' ||
  source === 'paused'
);

export const formatCompactMetricValue = (value) => {
  const numberValue = readFiniteNumber(value);
  if (numberValue <= 0) {
    return '...';
  }
  if (numberValue >= 1000000) {
    return `${(numberValue / 1000000).toFixed(1)}M`;
  }
  if (numberValue >= 1000) {
    return `${(numberValue / 1000).toFixed(1)}K`;
  }
  return String(Math.round(numberValue));
};

export const formatBenchmarkRateValue = (value) => {
  const numberValue = readFiniteNumber(value);
  if (numberValue <= 0) {
    return '...';
  }
  if (numberValue >= 1000000000) {
    return `${(numberValue / 1000000000).toFixed(2)}B`;
  }
  if (numberValue >= 1000000) {
    return `${(numberValue / 1000000).toFixed(1)}M`;
  }
  if (numberValue >= 1000) {
    return `${(numberValue / 1000).toFixed(1)}K`;
  }
  return String(Math.round(numberValue));
};

export const formatBandwidthValue = (bytesPerSecondValue) => {
  const bytesPerSecond = readFiniteNumber(bytesPerSecondValue);
  if (bytesPerSecond <= 0) {
    return '...';
  }
  const gibibytesPerSecond = bytesPerSecond / 1073741824;
  if (gibibytesPerSecond >= 1) {
    return `${gibibytesPerSecond.toFixed(1)} GiB/s`;
  }
  const mebibytesPerSecond = bytesPerSecond / 1048576;
  if (mebibytesPerSecond >= 1) {
    return `${mebibytesPerSecond.toFixed(0)} MiB/s`;
  }
  const kibibytesPerSecond = bytesPerSecond / 1024;
  return `${Math.max(1, Math.round(kibibytesPerSecond))} KiB/s`;
};

export const formatFramesPerSecondValue = (value) => {
  const numberValue = readFiniteNumber(value);
  return numberValue > 0 ? numberValue.toFixed(1) : '...';
};

export const formatBenchmarkSourceLabel = (source, backend = 'webgl') => {
  const backendLabel = backend === 'webgpu' ? 'WebGPU' : 'WebGL';
  if (source === 'gpu-timer') {
    return `${backendLabel} GPU timer`;
  }
  if (source === 'rolling-window') {
    return `${backendLabel} rolling`;
  }
  if (source === 'frame-estimate-pending') {
    return `${backendLabel} frame estimate pending`;
  }
  if (source === 'frame-estimate') {
    return `${backendLabel} frame estimate`;
  }
  if (isPausedBenchmarkSource(source)) {
    return 'Paused';
  }
  return 'Warming up';
};

const pausedAware = (formatter, value) => {
  if (isPausedBenchmarkSource(measurementSource.value)) {
    return '0';
  }
  return formatter(value);
};

export const formattedPerformanceScore = computed(() => pausedAware(formatCompactMetricValue, performanceScore.value));
export const formattedRaysPerSecond = computed(() => pausedAware(formatBenchmarkRateValue, activeRaysPerSecond.value));
export const formattedRayBandwidth = computed(() => {
  if (isPausedBenchmarkSource(measurementSource.value)) {
    return '0';
  }
  return formatBandwidthValue(estimatedRayBandwidthBytesPerSecond.value);
});
export const formattedPerceptualFramesPerSecond = computed(() => (
  pausedAware(formatFramesPerSecondValue, perceptualFramesPerSecond.value)
));
export const formattedResolution = computed(() => renderResolution.value || '...');
export const formattedBounces = computed(() => String(lightBounces.value ?? '...'));
export const formattedGpuRenderer = computed(() => gpuRenderer.value || 'Renderer hidden by browser');
export const measurementSourceLabel = computed(() => (
  formatBenchmarkSourceLabel(measurementSource.value, rendererBackend.value)
));
export const formattedMeasurementSource = measurementSourceLabel;

export const updateBenchmarkSignals = (benchmarkSnapshot = {}, context = {}) => {
  batch(() => {
    writeSignal(rendererBackend, benchmarkSnapshot.rendererBackend || context.rendererBackend || rendererBackend.value);
    writeSignal(activeRaysPerSecond, readFiniteNumber(benchmarkSnapshot.activeRaysPerSecond));
    writeSignal(
      estimatedRayBandwidthBytesPerSecond,
      readFiniteNumber(benchmarkSnapshot.estimatedRayBandwidthBytesPerSecond)
    );
    writeSignal(activeRaysPerFrame, readFiniteNumber(benchmarkSnapshot.activeRaysPerFrame));
    writeSignal(pathRayBudgetPerFrame, readFiniteNumber(benchmarkSnapshot.pathRayBudgetPerFrame));
    writeSignal(samplesPerFrame, readFiniteNumber(benchmarkSnapshot.samplesPerFrame));
    writeSignal(traceMilliseconds, readFiniteNumber(benchmarkSnapshot.traceMilliseconds));
    writeSignal(rollingSamplesPerFrame, readFiniteNumber(benchmarkSnapshot.rollingSamplesPerFrame));
    writeSignal(rollingTraceMilliseconds, readFiniteNumber(benchmarkSnapshot.rollingTraceMilliseconds));
    writeSignal(perceptualFramesPerSecond, readFiniteNumber(benchmarkSnapshot.perceptualFramesPerSecond));
    writeSignal(perceptualFrameMilliseconds, readFiniteNumber(benchmarkSnapshot.perceptualFrameMilliseconds));
    writeSignal(scoreSampleCount, readFiniteNumber(benchmarkSnapshot.scoreSampleCount));
    writeSignal(
      performanceScore,
      readFiniteNumber(benchmarkSnapshot.performanceScore ?? benchmarkSnapshot.score)
    );
    writeSignal(measurementSource, benchmarkSnapshot.measurementSource || context.measurementSource || measurementSource.value);
    writeSignal(
      renderResolution,
      benchmarkSnapshot.resolution || context.resolution || renderResolution.value
    );
    writeSignal(
      lightBounces,
      readFiniteNumber(benchmarkSnapshot.bounces ?? context.bounces ?? lightBounces.value, lightBounces.value)
    );
    writeSignal(
      gpuRenderer,
      benchmarkSnapshot.gpuRenderer || context.gpuRenderer || gpuRenderer.value
    );
  });
};

export const resetBenchmarkSignals = () => updateBenchmarkSignals({
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
  measurementSource: 'warming-up'
}, {
  resolution: '512 x 512',
  bounces: 5,
  gpuRenderer: 'Renderer hidden by browser'
});
