export const MIGRATED_STATIC_SECTIONS = Object.freeze([
  Object.freeze({
    id: 'app-menu',
    component: 'MenuBar',
    source: 'src/components/MenuBar.js',
    tombstone: 'react-migrated:app-menu',
    requiredSelectors: Object.freeze([
      'nav#app-menu',
      '#menu-quick-actions',
      'button[data-action="reset-all"]',
      'button[data-action="save-scene-json"]',
      'button[data-action="load-scene-json"]',
      'button[data-action="save-bitmap"]',
      '#camera-mode-toggle',
      '#canvas-fullscreen',
      '#fullscreen-panels-toggle',
      'button[data-panel-target="physics-panel"]',
      'button[data-benchmark-scene="standard"]',
      'button[data-preset="suzanneReference"]',
      'button[data-benchmark-scene="benchmarkSponzaAtrium"]'
    ])
  }),
  Object.freeze({
    id: 'loading-overlay',
    component: 'LoadingOverlay',
    source: 'src/components/LoadingOverlay.js',
    tombstone: 'react-migrated:loading-overlay',
    requiredSelectors: Object.freeze([
      '#loading-overlay',
      '#loading-status',
      '#loading-detail',
      '#loading-steps',
      '#loading-error',
      '#loading-error-stack',
      '#copy-loading-error'
    ])
  }),
  Object.freeze({
    id: 'scene-tree-window',
    component: 'SceneTreeWindow',
    source: 'src/components/SceneTreeWindow.js',
    tombstone: 'react-migrated:scene-tree-window',
    requiredSelectors: Object.freeze([
      '#scene-tree-window',
      '#scene-tree-count',
      '#scene-tree-add',
      '#scene-tree-add-menu',
      '#scene-tree-list',
      'button[data-panel-target="physics-panel"]'
    ])
  }),
  Object.freeze({
    id: 'controls',
    component: 'InspectorPanel',
    source: 'src/components/InspectorPanel.js',
    tombstone: 'react-migrated:controls',
    requiredSelectors: Object.freeze([
      '#controls',
      '#object-panel',
      '#physics-panel',
      '#render-panel',
      '#camera-panel',
      '#output-panel',
      '#preset-panel',
      '#selected-item-name',
      '#material',
      '#environment',
      '#light-bounces',
      '#camera-fov',
      '#resolution-preset',
      '#global-gravity-direction',
      '#selected-physics-spring-connect-controls',
      '#selected-physics-joints-section'
    ])
  }),
  Object.freeze({
    id: 'benchmark',
    component: 'BenchmarkPanel',
    source: 'src/components/BenchmarkPanel.js',
    tombstone: 'react-migrated:benchmark',
    requiredSelectors: Object.freeze([
      '#benchmark',
      '#benchmark-performance-score',
      '#benchmark-rays-per-second',
      '#benchmark-ray-bandwidth',
      '#benchmark-perceptual-fps',
      '#benchmark-resolution',
      '#benchmark-bounces',
      '#benchmark-samples',
      '#benchmark-convergence',
      '#benchmark-gpu-memory',
      '#benchmark-scene-complexity',
      '#benchmark-gpu-renderer',
      '#benchmark-source',
      '#benchmark-runner-status',
      '#benchmark-runner-summary',
      '#benchmark-runner-warmup',
      '#benchmark-runner-measurement',
      '#particle-fluid-controls',
      '#particle-fluid-count',
      '#particle-fluid-radius',
      '#particle-fluid-stiffness',
      'button[data-action="apply-particle-fluid-settings"]'
    ])
  })
]);
