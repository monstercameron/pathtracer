import { html } from 'htm/preact';
import {
  formattedBounces,
  formattedGpuRenderer,
  formattedMeasurementSource,
  formattedPerceptualFramesPerSecond,
  formattedPerformanceScore,
  formattedRayBandwidth,
  formattedRaysPerSecond,
  formattedResolution
} from '../benchmarkStore.js';
import { FloatingWindow } from './FloatingWindow.js';

const METRICS = Object.freeze([
  { key: 'score', id: 'benchmark-performance-score', label: 'Score', signal: formattedPerformanceScore },
  { key: 'rays', id: 'benchmark-rays-per-second', label: 'Active rays/s', signal: formattedRaysPerSecond },
  { key: 'bandwidth', id: 'benchmark-ray-bandwidth', label: 'Ray mem BW', signal: formattedRayBandwidth, title: 'Estimated memory traffic from rolling active rays per second.' },
  { key: 'fps', id: 'benchmark-perceptual-fps', label: 'Perceptual FPS', signal: formattedPerceptualFramesPerSecond },
  { key: 'resolution', id: 'benchmark-resolution', label: 'Resolution', signal: formattedResolution },
  { key: 'bounces', id: 'benchmark-bounces', label: 'Bounces', signal: formattedBounces }
]);

export function BenchmarkPanel({
  id = 'benchmark',
  defaultPosition = { left: 18, bottom: 18, width: 620 }
}) {
  return html`
    <${FloatingWindow}
      id=${id}
      windowKey="benchmark"
      title="Benchmark"
      className="benchmark-panel"
      defaultPosition=${defaultPosition}
      defaultVisible=${true}
    >
      <div className="benchmark-header">
        <div className="section-title">GPU benchmark</div>
        <div id="benchmark-source" className="benchmark-source">${formattedMeasurementSource.value}</div>
      </div>
      <div className="benchmark-grid">
        ${METRICS.map((metric) => html`
          <div key=${metric.key} className="benchmark-metric" title=${metric.title}>
            <strong id=${metric.id}>${metric.signal.value}</strong>
            <span>${metric.label}</span>
          </div>
        `)}
      </div>
      <div id="benchmark-gpu-renderer" className="benchmark-gpu-label">${formattedGpuRenderer.value}</div>
    <//>
  `;
}
