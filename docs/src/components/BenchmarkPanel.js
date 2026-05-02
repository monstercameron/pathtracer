import { html } from 'htm/preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
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
import { setUiWindowVisible, uiWindowVisibilitySignals } from '../store.js';
import { FLOATING_WINDOW_STORAGE_KEY } from './FloatingWindow.js';

const MIN_VISIBLE_SIZE = 80;
const VIEWPORT_PADDING = 8;

const toCssSize = (value) => (typeof value === 'number' ? `${value}px` : value);

const readTopViewportBoundary = () => {
  const documentObject = globalThis.document;
  const menuElement = documentObject && documentObject.getElementById('app-menu');
  if (!menuElement || typeof menuElement.getBoundingClientRect !== 'function') {
    return VIEWPORT_PADDING;
  }

  const menuRectangle = menuElement.getBoundingClientRect();
  return Math.max(VIEWPORT_PADDING, Math.ceil(menuRectangle.bottom + VIEWPORT_PADDING));
};

const clampToViewport = (value, maxValue, minValue = VIEWPORT_PADDING) => Math.min(
  Math.max(value, minValue),
  Math.max(minValue, maxValue - MIN_VISIBLE_SIZE)
);

const readStoredBenchmarkState = () => {
  try {
    if (!globalThis.localStorage) {
      return {};
    }
    const states = JSON.parse(globalThis.localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY) || '{}') || {};
    return states.benchmark || {};
  } catch (error) {
    uiLogger.warn('ui:benchmark-panel-storage-read-failed', { storageKey: FLOATING_WINDOW_STORAGE_KEY, error });
    return {};
  }
};

const writeStoredBenchmarkState = (state) => {
  try {
    if (!globalThis.localStorage) {
      return;
    }
    const states = JSON.parse(globalThis.localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY) || '{}') || {};
    states.benchmark = state;
    globalThis.localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, JSON.stringify(states));
  } catch (error) {
    uiLogger.warn('ui:benchmark-panel-storage-write-failed', { storageKey: FLOATING_WINDOW_STORAGE_KEY, error });
  }
};

const readInitialBenchmarkPosition = () => {
  const storedState = readStoredBenchmarkState();
  if (!Number.isFinite(storedState.left) || !Number.isFinite(storedState.top)) {
    return null;
  }

  return {
    left: clampToViewport(storedState.left, globalThis.innerWidth || 0),
    top: clampToViewport(storedState.top, globalThis.innerHeight || 0, readTopViewportBoundary()),
    right: 'auto',
    bottom: 'auto'
  };
};

const METRICS = Object.freeze([
  {
    key: 'score',
    id: 'benchmark-performance-score',
    label: 'Score',
    signal: formattedPerformanceScore,
    title: 'Composite score from rolling active rays per second. Frame-estimated timing is normalized to a fixed 512 x 512 render target so render resolution does not dominate the score.'
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
  id = 'benchmark'
}) {
  const isVisible = uiWindowVisibilitySignals.benchmark.value;
  const panelRef = useRef(null);
  const dragStateRef = useRef(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [position, setPosition] = useState(readInitialBenchmarkPosition);

  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'BenchmarkPanel', metricCount: METRICS.length });
  }, [id]);

  useEffect(() => {
    if (isVisible) {
      setIsCollapsed(false);
    }
  }, [isVisible]);

  const persistBenchmarkState = useCallback((overrides = {}) => {
    const panelElement = panelRef.current;
    const rectangle = panelElement && typeof panelElement.getBoundingClientRect === 'function'
      ? panelElement.getBoundingClientRect()
      : null;
    writeStoredBenchmarkState({
      left: rectangle ? Math.round(rectangle.left) : position?.left,
      top: rectangle ? Math.round(rectangle.top) : position?.top,
      width: rectangle ? Math.round(rectangle.width) : undefined,
      height: rectangle ? Math.round(rectangle.height) : undefined,
      hidden: !isVisible,
      collapsed: isCollapsed,
      ...overrides
    });
  }, [isCollapsed, isVisible, position]);

  useEffect(() => {
    const handleResize = () => {
      setPosition((currentPosition) => {
        if (!currentPosition) {
          return currentPosition;
        }
        return {
          ...currentPosition,
          left: clampToViewport(currentPosition.left, globalThis.innerWidth || 0),
          top: clampToViewport(currentPosition.top, globalThis.innerHeight || 0, readTopViewportBoundary())
        };
      });
    };
    globalThis.addEventListener?.('resize', handleResize);
    return () => globalThis.removeEventListener?.('resize', handleResize);
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest('button, input, select, textarea, a')) {
      return;
    }
    if (!panelRef.current) {
      return;
    }

    const rectangle = panelRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      pointerOffsetX: event.clientX - rectangle.left,
      pointerOffsetY: event.clientY - rectangle.top
    };
    panelRef.current.style.left = `${rectangle.left}px`;
    panelRef.current.style.top = `${rectangle.top}px`;
    panelRef.current.style.right = 'auto';
    panelRef.current.style.bottom = 'auto';
    panelRef.current.style.zIndex = '130';
    uiLogger.debug('ui:benchmark-panel-drag-start', {
      left: Math.round(rectangle.left),
      top: Math.round(rectangle.top)
    });
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        uiLogger.warn('ui:benchmark-panel-pointer-capture-failed', { error });
      }
    }
    event.preventDefault();
  }, []);

  const handlePointerMove = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !panelRef.current) {
      return;
    }

    const nextLeft = clampToViewport(event.clientX - dragState.pointerOffsetX, globalThis.innerWidth || 0);
    const nextTop = clampToViewport(
      event.clientY - dragState.pointerOffsetY,
      globalThis.innerHeight || 0,
      readTopViewportBoundary()
    );
    panelRef.current.style.left = `${nextLeft}px`;
    panelRef.current.style.top = `${nextTop}px`;
    panelRef.current.style.right = 'auto';
    panelRef.current.style.bottom = 'auto';
    event.preventDefault();
  }, []);

  const handlePointerUp = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !panelRef.current) {
      return;
    }

    const rectangle = panelRef.current.getBoundingClientRect();
    const nextPosition = {
      left: Math.round(rectangle.left),
      top: Math.round(rectangle.top),
      right: 'auto',
      bottom: 'auto'
    };
    dragStateRef.current = null;
    setPosition(nextPosition);
    writeStoredBenchmarkState({
      ...nextPosition,
      width: Math.round(rectangle.width),
      height: Math.round(rectangle.height),
      hidden: !isVisible,
      collapsed: isCollapsed
    });
    uiLogger.debug('ui:benchmark-panel-drag-end', {
      left: nextPosition.left,
      top: nextPosition.top,
      width: Math.round(rectangle.width),
      height: Math.round(rectangle.height)
    });
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (error) {
        uiLogger.warn('ui:benchmark-panel-pointer-release-failed', { error });
      }
    }
  }, [isCollapsed, isVisible]);

  const handleToggleCollapse = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsCollapsed((currentValue) => {
      const nextValue = !currentValue;
      uiLogger.info('ui:benchmark-panel-collapse', { previousValue: currentValue, nextValue });
      return nextValue;
    });
  };

  const handleClose = (event) => {
    event.preventDefault();
    event.stopPropagation();
    uiLogger.info('ui:benchmark-panel-close');
    persistBenchmarkState({ hidden: true });
    setUiWindowVisible('benchmark', false);
  };

  const style = position ? {
    left: toCssSize(position.left),
    top: toCssSize(position.top),
    right: toCssSize(position.right),
    bottom: toCssSize(position.bottom)
  } : undefined;

  return html`
    <section
      id=${id}
      ref=${panelRef}
      className=${`benchmark-panel benchmark-standing-panel ${isCollapsed ? 'is-collapsed' : ''}`.trim()}
      data-standing-panel
      data-window-key="benchmark"
      hidden=${!isVisible}
      style=${style}
      aria-label="Benchmark"
      role="region"
    >
      <header
        className="benchmark-titlebar"
        data-window-drag-handle
        onPointerDown=${handlePointerDown}
        onPointerMove=${handlePointerMove}
        onPointerUp=${handlePointerUp}
        onPointerCancel=${handlePointerUp}
      >
        <strong>Benchmark</strong>
        <div className="benchmark-titlebar-end">
          <span id="benchmark-source" className="benchmark-source">${formattedMeasurementSource.value}</span>
          <div className="floating-window-actions" aria-label="Benchmark panel controls">
            <button type="button" data-window-command="collapse" aria-label="Collapse Benchmark" onClick=${handleToggleCollapse}>
              <span className="window-command-icon window-command-collapse" aria-hidden="true"></span>
            </button>
            <button type="button" data-window-command="close" aria-label="Close Benchmark" onClick=${handleClose}>
              <span className="window-command-icon window-command-close" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </header>
      <div className="benchmark-panel-body">
        <div className="benchmark-header">
          <div className="section-title">GPU benchmark</div>
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
      </div>
    </section>
  `;
}
