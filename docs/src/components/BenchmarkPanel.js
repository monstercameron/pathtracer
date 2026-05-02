import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import { uiLogger } from '../logger.js';
import {
  formattedBounces,
  formattedGpuRenderer,
  formattedConvergence,
  formattedConvergenceTitle,
  formattedGpuMemory,
  formattedGpuMemoryTitle,
  formattedMeasurementSource,
  formattedPerceptualFramesPerSecond,
  formattedPerformanceScore,
  formattedRayBandwidth,
  formattedRaysPerSecond,
  formattedResolution,
  formattedSamples,
  formattedSamplesTitle,
  formattedSceneComplexity,
  formattedSceneComplexityTitle
} from '../benchmarkStore.js';
import { uiWindowVisibilitySignals } from '../store.js';
import { FloatingWindow } from './FloatingWindow.js';

const METRICS = Object.freeze([
  {
    key: 'score',
    id: 'benchmark-performance-score',
    label: 'Score',
    signal: formattedPerformanceScore,
    title: 'Composite score from rolling active rays per second. Scores appear after enough trace samples are collected.'
  },
  {
    key: 'rays',
    id: 'benchmark-rays-per-second',
    label: 'Active rays/s',
    signal: formattedRaysPerSecond,
    title: 'Rolling rate of actively traced camera rays, excluding paused frames.'
  },
  { key: 'bandwidth', id: 'benchmark-ray-bandwidth', label: 'Ray mem BW', signal: formattedRayBandwidth, title: 'Estimated memory traffic from rolling active rays per second.' },
  {
    key: 'fps',
    id: 'benchmark-perceptual-fps',
    label: 'Perceptual FPS',
    signal: formattedPerceptualFramesPerSecond,
    title: 'Rolling visual frame pacing after render and display passes.'
  },
  {
    key: 'resolution',
    id: 'benchmark-resolution',
    label: 'Resolution',
    signal: formattedResolution,
    title: 'Current offscreen render-target resolution.'
  },
  {
    key: 'bounces',
    id: 'benchmark-bounces',
    label: 'Bounces',
    signal: formattedBounces,
    title: 'Configured light-bounce count for each traced path.'
  },
  {
    key: 'samples',
    id: 'benchmark-samples',
    label: 'Samples',
    signal: formattedSamples,
    titleSignal: formattedSamplesTitle
  },
  {
    key: 'convergence',
    id: 'benchmark-convergence',
    label: 'Convergence',
    signal: formattedConvergence,
    titleSignal: formattedConvergenceTitle
  },
  {
    key: 'gpu-memory',
    id: 'benchmark-gpu-memory',
    label: 'GPU buffers',
    signal: formattedGpuMemory,
    titleSignal: formattedGpuMemoryTitle
  },
  {
    key: 'scene-complexity',
    id: 'benchmark-scene-complexity',
    label: 'Scene weight',
    signal: formattedSceneComplexity,
    titleSignal: formattedSceneComplexityTitle
  }
]);

export function BenchmarkPanel({
  id = 'benchmark',
  defaultPosition = { left: 18, bottom: 18, width: 620 }
}) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'BenchmarkPanel', metricCount: METRICS.length });
  }, [id]);

  return html`
    <${FloatingWindow}
      id=${id}
      windowKey="benchmark"
      title="Benchmark"
      className="benchmark-panel"
      defaultPosition=${defaultPosition}
      defaultVisible=${true}
      visibleSignal=${uiWindowVisibilitySignals.benchmark}
    >
      <div className="benchmark-header">
        <div className="section-title">GPU benchmark</div>
        <div id="benchmark-source" className="benchmark-source">${formattedMeasurementSource.value}</div>
      </div>
      <div className="benchmark-grid">
        ${METRICS.map((metric) => html`
          <div key=${metric.key} className="benchmark-metric" title=${metric.titleSignal ? metric.titleSignal.value : metric.title}>
            <strong id=${metric.id}>${metric.signal.value}</strong>
            <span>${metric.label}</span>
          </div>
        `)}
      </div>
      <div id="benchmark-gpu-renderer" className="benchmark-gpu-label">${formattedGpuRenderer.value}</div>
      <div id="particle-fluid-controls" className="benchmark-runner" hidden>
        <div className="section-title">Particle fluid</div>
        <div className="button-row two-up">
          <label>
            Count
            <input id="particle-fluid-count" type="number" min="8" max="48" step="1" value="24" />
          </label>
          <label>
            Radius
            <input id="particle-fluid-radius" type="number" min="0.035" max="0.095" step="0.005" value="0.06" />
          </label>
        </div>
        <div className="button-row two-up">
          <label>
            Stiffness
            <input id="particle-fluid-stiffness" type="number" min="40" max="240" step="5" value="120" />
          </label>
          <button type="button" data-action="apply-particle-fluid-settings">Apply Fluid Settings</button>
        </div>
      </div>
      <div className="benchmark-runner">
        <div className="section-title">Benchmark sequence</div>
        <div className="button-row two-up">
          <button type="button" data-action="run-benchmark-sequence">Run Sequence</button>
          <button type="button" data-action="stop-benchmark-sequence">Stop</button>
        </div>
        <div className="button-row two-up">
          <label>
            Warm-up
            <input id="benchmark-runner-warmup" type="number" min="0" max="60" step="1" value="3" />
          </label>
          <label>
            Measure
            <input id="benchmark-runner-measurement" type="number" min="1" max="120" step="1" value="10" />
          </label>
        </div>
        <div className="button-row two-up">
          <button type="button" data-action="copy-benchmark-results">Copy Results</button>
          <button type="button" data-action="save-benchmark-baseline">Save As Baseline</button>
        </div>
        <div className="button-row two-up benchmark-result-actions">
          <button type="button" data-action="share-benchmark-results">Share Result URL</button>
          <button type="button" data-action="save-benchmark-score-card">Save Score Card PNG</button>
        </div>
        <div id="benchmark-runner-status" className="benchmark-source">Idle</div>
        <div id="benchmark-runner-summary" className="benchmark-runner-summary"></div>
      </div>
    <//>
  `;
}
