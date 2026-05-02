import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { uiLogger } from '../logger.js';
import {
  deleteSelectedSceneItems,
  groupSelectedSceneItems,
  selectedItemIds,
  ungroupSelectedSceneItems
} from '../sceneStore.js';
import {
  openUiPanel,
  quickActionPressedSignals,
  setUiWindowVisible,
  toggleUiWindowVisible
} from '../store.js';
import { MenuGroup } from './MenuGroup.js';
import { QuickActions } from './QuickActions.js';

const freezeItems = (items) => Object.freeze(items);
const group = (key, label, items) => Object.freeze({ key, label, items: freezeItems(items) });
const submenu = (key, label, items) => Object.freeze({ key, label, items: freezeItems(items) });

export const MENU_GROUPS = Object.freeze([
  group('file', 'File', [
    submenu('file-scene', 'Scene File', [
      { key: 'new-scene', label: 'New Scene', action: 'reset-all', shortcut: 'Ctrl+N' },
      { key: 'reset-scene', label: 'Reset Scene', action: 'reset-all' },
      { key: 'save-scene-json', label: 'Save Scene JSON', action: 'save-scene-json' },
      { key: 'load-scene-json', label: 'Load Scene JSON', action: 'load-scene-json' }
    ]),
    submenu('file-export', 'Export', [
      { key: 'output-settings', label: 'Output Settings', panelTarget: 'output-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+5' },
      { key: 'save-png', label: 'Save PNG', action: 'save-bitmap', shortcut: 'Ctrl+S' }
    ])
  ]),
  group('edit', 'Edit', [
    submenu('edit-history', 'History', [
      { key: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', disabled: true },
      { key: 'redo', label: 'Redo', shortcut: 'Ctrl+Y', disabled: true },
      { key: 'duplicate-selected', label: 'Duplicate Selected', shortcut: 'Ctrl+D', disabled: true }
    ]),
    submenu('edit-selection', 'Selection', [
      { key: 'select-light', label: 'Select Light', action: 'select-light', shortcut: 'L' },
      { key: 'delete-selection', label: 'Delete Selection', action: 'delete-selection', shortcut: 'Del' },
      { key: 'group-selection', label: 'Group Selected', action: 'group-selection', shortcut: 'Ctrl+G' },
      { key: 'ungroup-selection', label: 'Ungroup', action: 'ungroup-selection', shortcut: 'Ctrl+Shift+G' }
    ])
  ]),
  group('view', 'View', [
    submenu('view-panels', 'Panels', [
      { key: 'inspector', label: 'Inspector', windowTarget: 'controls', shortcut: 'I' },
      { key: 'scene-tree', label: 'Scene Tree', windowTarget: 'scene-tree-window', shortcut: 'T' },
      { key: 'benchmark', label: 'Benchmark', windowTarget: 'benchmark', shortcut: 'B' },
      { key: 'log-panel', label: 'Log Panel', windowTarget: 'log-panel' }
    ]),
    submenu('view-camera-fullscreen', 'Camera And Fullscreen', [
      { key: 'camera-mode', id: 'camera-mode-toggle', label: 'Camera: Orbit', action: 'toggle-camera-mode', labelDataAttribute: 'camera-mode-label', pressed: false },
      { key: 'camera-auto-rotate', label: 'Camera Auto-Rotate', action: 'toggle-camera-playback', shortcut: 'C', pressed: true },
      { key: 'fullscreen', id: 'canvas-fullscreen', label: 'Fullscreen', action: 'toggle-canvas-fullscreen', shortcut: 'F', labelDataAttribute: 'fullscreen-label', pressed: false },
      { key: 'fullscreen-panels', id: 'fullscreen-panels-toggle', label: 'Fullscreen Panels', action: 'toggle-fullscreen-panels', labelDataAttribute: 'fullscreen-panels-label', pressed: false }
    ])
  ]),
  group('create', 'Create', [
    submenu('create-quick', 'Quick Primitives', [
      { key: 'add-sphere', label: 'Sphere', action: 'add-sphere' },
      { key: 'add-cube', label: 'Cube', action: 'add-cube' },
      { key: 'add-area-light', label: 'Area Light', action: 'add-area-light' }
    ]),
    submenu('create-curved', 'Curved', [
      { key: 'add-cylinder', label: 'Cylinder', action: 'add-cylinder' },
      { key: 'add-cone', label: 'Cone', action: 'add-cone' },
      { key: 'add-frustum', label: 'Frustum', action: 'add-frustum' },
      { key: 'add-capsule', label: 'Capsule', action: 'add-capsule' },
      { key: 'add-ellipsoid', label: 'Ellipsoid', action: 'add-ellipsoid' },
      { key: 'add-torus', label: 'Torus', action: 'add-torus' },
      { key: 'add-rounded-box', label: 'Rounded Box', action: 'add-rounded-box' }
    ]),
    submenu('create-flat', 'Flat', [
      { key: 'add-plane', label: 'Plane', action: 'add-plane' },
      { key: 'add-disk', label: 'Disk', action: 'add-disk' },
      { key: 'add-triangle', label: 'Triangle', action: 'add-triangle' },
      { key: 'add-wedge', label: 'Wedge', action: 'add-wedge' },
      { key: 'add-prism', label: 'Prism', action: 'add-prism' }
    ]),
    submenu('create-implicit', 'Implicit And Fractal', [
      { key: 'add-metaballs', label: 'Metaballs', action: 'add-metaballs' },
      { key: 'add-csg-shape', label: 'CSG Shape', action: 'add-csg-shape' },
      { key: 'add-mandelbulb', label: 'Mandelbulb', action: 'add-mandelbulb' },
      { key: 'add-sdf-fractal', label: 'SDF Fractal', action: 'add-sdf-fractal' }
    ])
  ]),
  group('scene', 'Scene', [
    submenu('scene-quick-presets', 'Quick Presets', [
      { key: 'preset-sphere-column', label: 'Sphere Column', preset: 'sphereColumn' },
      { key: 'preset-shader-showcase', label: 'Shader Showcase', preset: 'shaderShowcase' },
      { key: 'preset-primitive-showcase', label: 'Primitive Showcase', preset: 'primitiveShowcase' },
      { key: 'preset-area-light', label: 'Area Light Studio', preset: 'areaLightShowcase' }
    ]),
    submenu('scene-core-presets', 'Core Presets', [
      { key: 'preset-sphere-pyramid', label: 'Sphere Pyramid', preset: 'spherePyramid' },
      { key: 'preset-sphere-and-cube', label: 'Sphere and Cube', preset: 'sphereAndCube' },
      { key: 'preset-cube-and-spheres', label: 'Cube and Spheres', preset: 'cubeAndSpheres' },
      { key: 'preset-table-and-chair', label: 'Table and Chair', preset: 'tableAndChair' },
      { key: 'preset-stacks', label: 'Stacks', preset: 'stacks' }
    ]),
    submenu('scene-showcases', 'Showcases', [
      { key: 'preset-recursive-spheres', label: 'Recursive Spheres', preset: 'recursiveSpheres' },
      { key: 'preset-curved-primitives', label: 'Curved Primitives', preset: 'curvedPrimitiveShowcase' },
      { key: 'preset-flat-primitives', label: 'Flat Primitives', preset: 'flatPrimitiveShowcase' },
      { key: 'preset-implicit-primitives', label: 'Implicit Primitives', preset: 'implicitPrimitiveShowcase' }
    ]),
    submenu('scene-reference-models', 'Reference Models', [
      { key: 'preset-suzanne-reference', label: 'Suzanne Reference Mesh', preset: 'suzanneReference' }
    ]),
    submenu('scene-benchmark-scenes', 'Benchmark Scenes', [
      { key: 'benchmark-standard', label: 'Standard Benchmark', benchmarkScene: 'standard', shortcut: 'Fixed' },
      { key: 'benchmark-sponza-atrium', label: 'Sponza Atrium', benchmarkScene: 'benchmarkSponzaAtrium' },
      { key: 'benchmark-shader-gauntlet', label: 'Shader Gauntlet', benchmarkScene: 'benchmarkShaderGauntlet' },
      { key: 'benchmark-physics-chaos', label: 'Physics Chaos', benchmarkScene: 'benchmarkPhysicsChaos' },
      { key: 'benchmark-particle-fluid', label: 'Particle Fluid', benchmarkScene: 'benchmarkParticleFluid' },
      { key: 'benchmark-sdf-complexity', label: 'SDF Complexity', benchmarkScene: 'benchmarkSdfComplexity' },
      { key: 'benchmark-caustic-pool', label: 'Caustic Pool', benchmarkScene: 'benchmarkCausticPool' },
      { key: 'benchmark-motion-blur', label: 'Motion Blur Stress', benchmarkScene: 'benchmarkMotionBlurStress' },
      { key: 'benchmark-volumetric-fog', label: 'Volumetric Fog Flythrough', benchmarkScene: 'benchmarkVolumetricFog' },
      { key: 'benchmark-scenes-separator', type: 'separator' },
      { key: 'benchmark-runner', label: 'Run Benchmark Sequence', action: 'run-benchmark-sequence' }
    ]),
    submenu('scene-demo-scenes', 'Demo Scenes', [
      { key: 'preset-corridor-of-light', label: 'Corridor of Light', preset: 'corridorOfLight' },
      { key: 'preset-corridor-of-light-glass', label: 'Corridor + Glass Sphere', preset: 'corridorOfLightGlassSphere' },
      { key: 'preset-corridor-of-light-mirror', label: 'Corridor + Mirror Cube', preset: 'corridorOfLightMirrorCube' },
      { key: 'preset-depth-of-field-portrait', label: 'Depth-of-Field Portrait', preset: 'depthOfFieldPortrait' },
      { key: 'preset-shadow-study', label: 'Shadow Study', preset: 'shadowStudy' },
      { key: 'preset-mirror-room', label: 'Mirror Room', preset: 'mirrorRoom' },
      { key: 'preset-sky-sphere', label: 'Sky Sphere', preset: 'skySphere' },
      { key: 'preset-fog-corridor', label: 'Fog Corridor', preset: 'fogCorridor' },
      { key: 'preset-material-grid', label: 'Material Grid', preset: 'materialGrid' },
      { key: 'preset-neon-room', label: 'Neon Room', preset: 'neonRoom' }
    ])
  ]),
  group('render', 'Render', [
    submenu('render-playback', 'Playback', [
      { key: 'pause-frames', label: 'Pause Frames', action: 'toggle-frame-pause', shortcut: 'P' },
      { key: 'pause-rays', label: 'Pause Rays at Converged', action: 'toggle-convergence-pause', shortcut: 'K' }
    ]),
    submenu('render-quality', 'Quality', [
      { key: 'quality-draft', label: 'Draft', qualityPreset: 'draft', shortcut: '1' },
      { key: 'quality-preview', label: 'Preview', qualityPreset: 'preview', shortcut: '2' },
      { key: 'quality-final', label: 'Final', qualityPreset: 'final', shortcut: '3' }
    ]),
    submenu('render-debug-views', 'Debug Views', [
      { key: 'debug-beauty', label: 'Beauty', debugView: 'beauty', pressed: true },
      { key: 'debug-normals', label: 'Normals', debugView: 'normals', pressed: false },
      { key: 'debug-albedo', label: 'Albedo', debugView: 'albedo', pressed: false },
      { key: 'debug-depth', label: 'Depth', debugView: 'depth', pressed: false }
    ]),
    submenu('render-settings', 'Settings Panels', [
      { key: 'render-settings', label: 'Render Settings', panelTarget: 'render-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+3' },
      { key: 'physics-settings', label: 'Physics Settings', panelTarget: 'physics-panel', activationWindowTarget: 'controls' },
      { key: 'camera-settings', label: 'Camera Settings', panelTarget: 'camera-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+4' },
      { key: 'environment-settings', label: 'Environment Settings', panelTarget: 'render-panel', activationWindowTarget: 'controls' },
      { key: 'output-settings', label: 'Resolution / Output', panelTarget: 'output-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+5' }
    ])
  ]),
  group('help', 'Help', [
    { key: 'readme', label: 'README', href: 'README.md', target: '_blank', rel: 'noreferrer' }
  ])
]);

const LOCALLY_TOGGLED_ACTIONS = Object.freeze(new Set([
  'toggle-camera-playback',
  'toggle-frame-pause',
  'toggle-convergence-pause',
  'toggle-light-cycle',
  'toggle-focus-pick',
  'toggle-canvas-fullscreen',
  'toggle-fullscreen-panels'
]));

const isEditableShortcutTarget = (target) => (
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  Boolean(target && target.isContentEditable)
);

export function MenuBar({ groups = MENU_GROUPS }) {
  const [openMenuKey, setOpenMenuKey] = useState(null);
  const navRef = useRef(null);

  const runSelectionAction = (actionName, source) => {
    if (actionName === 'group-selection') {
      const groupItem = groupSelectedSceneItems();
      uiLogger.info(groupItem ? 'ui:menu-group-selected' : 'ui:menu-group-selected-noop', {
        source,
        selectedItemIds: selectedItemIds.value,
        groupId: groupItem?.id ?? null
      });
      return true;
    }
    if (actionName === 'ungroup-selection') {
      const didUngroup = ungroupSelectedSceneItems();
      uiLogger.info(didUngroup ? 'ui:menu-ungroup-selected' : 'ui:menu-ungroup-selected-noop', {
        source,
        selectedItemIds: selectedItemIds.value
      });
      return true;
    }
    if (actionName === 'delete-selection') {
      const didDelete = deleteSelectedSceneItems();
      uiLogger.info(didDelete ? 'ui:menu-delete-selected' : 'ui:menu-delete-selected-noop', {
        source,
        selectedItemIds: selectedItemIds.value
      });
      return true;
    }
    return false;
  };

  useEffect(() => {
    const documentObject = navRef.current
      ? navRef.current.ownerDocument
      : (typeof document === 'undefined' ? null : document);
    if (!documentObject || typeof documentObject.addEventListener !== 'function') {
      uiLogger.warn('ui:menu-event-target-unavailable');
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenMenuKey(null);
      }
    };
    const handleKeyDown = (event) => {
      if (
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.code !== 'KeyG' ||
        isEditableShortcutTarget(event.target)
      ) {
        return;
      }

      runSelectionAction(event.shiftKey ? 'ungroup-selection' : 'group-selection', 'keyboard');
      event.preventDefault();
      event.stopPropagation();
    };
    try {
      documentObject.addEventListener('pointerdown', handlePointerDown);
      documentObject.addEventListener('keydown', handleKeyDown);
      uiLogger.info('ui:menu-init', { groupCount: groups.length });
    } catch (error) {
      uiLogger.warn('ui:menu-event-listener-add-failed', { eventName: 'pointerdown/keydown', error });
      return undefined;
    }
    return () => {
      try {
        documentObject.removeEventListener('pointerdown', handlePointerDown);
        documentObject.removeEventListener('keydown', handleKeyDown);
      } catch (error) {
        uiLogger.warn('ui:menu-event-listener-remove-failed', { eventName: 'pointerdown/keydown', error });
      }
    };
  }, []);

  const handleButtonClick = (event, item = {}) => {
    const targetButton = event.currentTarget;
    if (!(targetButton instanceof HTMLButtonElement)) {
      uiLogger.warn('ui:menu-action-invalid-target', { itemKey: item.key });
      return;
    }

    const targetPanelId = targetButton.dataset.panelTarget;
    const targetWindowId = targetButton.dataset.windowTarget || item.activationWindowTarget;
    uiLogger.info('ui:menu-action', {
      itemKey: item.key,
      action: targetButton.dataset.action || null,
      preset: targetButton.dataset.preset || null,
      panelTarget: targetPanelId || null,
      windowTarget: targetWindowId || null,
      qualityPreset: targetButton.dataset.qualityPreset || null,
      benchmarkScene: targetButton.dataset.benchmarkScene || null,
      debugView: targetButton.dataset.debugView || null
    });
    if (targetPanelId) {
      if (targetWindowId) {
        setUiWindowVisible(targetWindowId, true);
      }
      openUiPanel(targetPanelId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (targetWindowId) {
      const targetWindowElement = globalThis.document?.getElementById(targetWindowId);
      if (targetWindowElement instanceof HTMLElement) {
        const shouldShowWindow = targetWindowElement.hidden;
        targetWindowElement.hidden = !shouldShowWindow;
        if (shouldShowWindow) {
          targetWindowElement.classList.remove('is-collapsed');
        }
        setUiWindowVisible(targetWindowId, shouldShowWindow);
      } else {
        toggleUiWindowVisible(targetWindowId);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const actionName = targetButton.dataset.action;
    if (runSelectionAction(actionName, 'menu')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const pressedSignal = actionName ? quickActionPressedSignals[actionName] : null;
    if (pressedSignal && LOCALLY_TOGGLED_ACTIONS.has(actionName)) {
      const previousValue = Boolean(pressedSignal.value);
      pressedSignal.value = !Boolean(pressedSignal.value);
      uiLogger.info('ui:local-action-toggle', {
        action: actionName,
        previousValue,
        nextValue: Boolean(pressedSignal.value)
      });
    }
  };

  return html`
    <nav id="app-menu" ref=${navRef} className="app-menu" aria-label="Application menu">
      ${groups.map((group) => html`
        <${MenuGroup}
          key=${group.key}
          group=${group}
          isOpen=${openMenuKey === group.key}
          pressedSignals=${quickActionPressedSignals}
          onOpen=${setOpenMenuKey}
          onClose=${() => setOpenMenuKey(null)}
          onItemClick=${handleButtonClick}
        />
      `)}
      <${QuickActions} pressedSignals=${quickActionPressedSignals} onButtonClick=${handleButtonClick} />
    </nav>
  `;
}
