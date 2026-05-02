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

export const MENU_GROUPS = Object.freeze([
  {
    key: 'file',
    label: 'File',
    items: Object.freeze([
      { key: 'new-scene', label: 'New Scene', action: 'reset-all', shortcut: 'Ctrl+N' },
      { key: 'reset-scene', label: 'Reset Scene', action: 'reset-all' },
      { key: 'file-output-separator', type: 'separator' },
      { key: 'output-settings', label: 'Output Settings', panelTarget: 'output-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+5' },
      { key: 'save-png', label: 'Save PNG', action: 'save-bitmap', shortcut: 'Ctrl+S' }
    ])
  },
  {
    key: 'edit',
    label: 'Edit',
    items: Object.freeze([
      { key: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', disabled: true },
      { key: 'redo', label: 'Redo', shortcut: 'Ctrl+Y', disabled: true },
      { key: 'edit-separator', type: 'separator' },
      { key: 'select-light', label: 'Select Light', action: 'select-light', shortcut: 'L' },
      { key: 'delete-selection', label: 'Delete Selection', action: 'delete-selection', shortcut: 'Del' },
      { key: 'group-selection', label: 'Group Selected', action: 'group-selection', shortcut: 'Ctrl+G' },
      { key: 'ungroup-selection', label: 'Ungroup', action: 'ungroup-selection', shortcut: 'Ctrl+Shift+G' },
      { key: 'duplicate-selected', label: 'Duplicate Selected', shortcut: 'Ctrl+D', disabled: true }
    ])
  },
  {
    key: 'view',
    label: 'View',
    items: Object.freeze([
      { key: 'inspector', label: 'Inspector', windowTarget: 'controls', shortcut: 'I' },
      { key: 'scene-tree', label: 'Scene Tree', windowTarget: 'scene-tree-window', shortcut: 'T' },
      { key: 'benchmark', label: 'Benchmark', windowTarget: 'benchmark', shortcut: 'B' },
      { key: 'log-panel', label: 'Log Panel', windowTarget: 'log-panel' },
      { key: 'view-separator', type: 'separator' },
      { key: 'camera-auto-rotate', label: 'Camera Auto-Rotate', action: 'toggle-camera-playback', shortcut: 'C', pressed: true },
      { key: 'fullscreen', id: 'canvas-fullscreen', label: 'Fullscreen', action: 'toggle-canvas-fullscreen', shortcut: 'F', pressed: false },
      { key: 'fullscreen-panels', id: 'fullscreen-panels-toggle', label: 'Fullscreen Panels', action: 'toggle-fullscreen-panels', pressed: false }
    ])
  },
  {
    key: 'create',
    label: 'Create',
    items: Object.freeze([
      { key: 'core-label', type: 'label', label: 'Core' },
      { key: 'add-sphere', label: 'Sphere', action: 'add-sphere' },
      { key: 'add-cube', label: 'Cube', action: 'add-cube' },
      { key: 'add-area-light', label: 'Area Light', action: 'add-area-light' },
      { key: 'curved-separator', type: 'separator' },
      { key: 'curved-label', type: 'label', label: 'Curved' },
      { key: 'add-cylinder', label: 'Cylinder', action: 'add-cylinder' },
      { key: 'add-cone', label: 'Cone', action: 'add-cone' },
      { key: 'add-frustum', label: 'Frustum', action: 'add-frustum' },
      { key: 'add-capsule', label: 'Capsule', action: 'add-capsule' },
      { key: 'add-ellipsoid', label: 'Ellipsoid', action: 'add-ellipsoid' },
      { key: 'add-torus', label: 'Torus', action: 'add-torus' },
      { key: 'add-rounded-box', label: 'Rounded Box', action: 'add-rounded-box' },
      { key: 'flat-separator', type: 'separator' },
      { key: 'flat-label', type: 'label', label: 'Flat' },
      { key: 'add-plane', label: 'Plane', action: 'add-plane' },
      { key: 'add-disk', label: 'Disk', action: 'add-disk' },
      { key: 'add-triangle', label: 'Triangle', action: 'add-triangle' },
      { key: 'add-wedge', label: 'Wedge', action: 'add-wedge' },
      { key: 'add-prism', label: 'Prism', action: 'add-prism' },
      { key: 'implicit-separator', type: 'separator' },
      { key: 'implicit-label', type: 'label', label: 'Implicit' },
      { key: 'add-metaballs', label: 'Metaballs', action: 'add-metaballs' },
      { key: 'add-csg-shape', label: 'CSG Shape', action: 'add-csg-shape' },
      { key: 'add-mandelbulb', label: 'Mandelbulb', action: 'add-mandelbulb' },
      { key: 'add-sdf-fractal', label: 'SDF Fractal', action: 'add-sdf-fractal' }
    ])
  },
  {
    key: 'scene',
    label: 'Scene',
    items: Object.freeze([
      { key: 'core-presets-label', type: 'label', label: 'Core presets' },
      { key: 'preset-sphere-column', label: 'Sphere Column', preset: 'sphereColumn' },
      { key: 'preset-sphere-pyramid', label: 'Sphere Pyramid', preset: 'spherePyramid' },
      { key: 'preset-sphere-and-cube', label: 'Sphere and Cube', preset: 'sphereAndCube' },
      { key: 'preset-cube-and-spheres', label: 'Cube and Spheres', preset: 'cubeAndSpheres' },
      { key: 'preset-table-and-chair', label: 'Table and Chair', preset: 'tableAndChair' },
      { key: 'preset-stacks', label: 'Stacks', preset: 'stacks' },
      { key: 'shader-presets-separator', type: 'separator' },
      { key: 'shader-presets-label', type: 'label', label: 'Shader and recursive' },
      { key: 'preset-shader-showcase', label: 'Shader Showcase', preset: 'shaderShowcase' },
      { key: 'preset-recursive-spheres', label: 'Recursive Spheres', preset: 'recursiveSpheres' },
      { key: 'primitive-presets-separator', type: 'separator' },
      { key: 'primitive-presets-label', type: 'label', label: 'Primitive and light showcases' },
      { key: 'preset-primitive-showcase', label: 'Primitive Showcase', preset: 'primitiveShowcase' },
      { key: 'preset-curved-primitives', label: 'Curved Primitives', preset: 'curvedPrimitiveShowcase' },
      { key: 'preset-flat-primitives', label: 'Flat Primitives', preset: 'flatPrimitiveShowcase' },
      { key: 'preset-implicit-primitives', label: 'Implicit Primitives', preset: 'implicitPrimitiveShowcase' },
      { key: 'preset-area-light', label: 'Area Light Studio', preset: 'areaLightShowcase' },
      { key: 'benchmark-scenes-separator', type: 'separator' },
      { key: 'benchmark-scenes-label', type: 'label', label: 'Benchmark scenes' },
      { key: 'benchmark-standard', label: 'Standard Benchmark', benchmarkScene: 'default', shortcut: 'Fixed' },
      { key: 'benchmark-shader-gauntlet', label: 'Shader Gauntlet', benchmarkScene: 'benchmarkShaderGauntlet' },
      { key: 'benchmark-physics-chaos', label: 'Physics Chaos', benchmarkScene: 'benchmarkPhysicsChaos' },
      { key: 'benchmark-sdf-complexity', label: 'SDF Complexity', benchmarkScene: 'benchmarkSdfComplexity' },
      { key: 'benchmark-caustic-pool', label: 'Caustic Pool', benchmarkScene: 'benchmarkCausticPool' },
      { key: 'benchmark-motion-blur', label: 'Motion Blur Stress', benchmarkScene: 'benchmarkMotionBlurStress' },
      { key: 'benchmark-volumetric-fog', label: 'Volumetric Fog Flythrough', benchmarkScene: 'benchmarkVolumetricFog' },
      { key: 'scene-disabled-separator', type: 'separator' },
      { key: 'benchmark-runner', label: 'Run Benchmark Sequence', action: 'run-benchmark-sequence' },
      { key: 'demo-scenes-separator', type: 'separator' },
      { key: 'demo-scenes-label', type: 'label', label: 'Demo scenes' },
      { key: 'preset-corridor-of-light', label: 'Corridor of Light', preset: 'corridorOfLight' },
      { key: 'preset-depth-of-field-portrait', label: 'Depth-of-Field Portrait', preset: 'depthOfFieldPortrait' },
      { key: 'preset-shadow-study', label: 'Shadow Study', preset: 'shadowStudy' },
      { key: 'preset-mirror-room', label: 'Mirror Room', preset: 'mirrorRoom' },
      { key: 'preset-sky-sphere', label: 'Sky Sphere', preset: 'skySphere' },
      { key: 'preset-fog-corridor', label: 'Fog Corridor', preset: 'fogCorridor' },
      { key: 'preset-material-grid', label: 'Material Grid', preset: 'materialGrid' },
      { key: 'preset-neon-room', label: 'Neon Room', preset: 'neonRoom' }
    ])
  },
  {
    key: 'render',
    label: 'Render',
    items: Object.freeze([
      { key: 'pause-frames', label: 'Pause Frames', action: 'toggle-frame-pause', shortcut: 'P' },
      { key: 'pause-rays', label: 'Pause Rays at Converged', action: 'toggle-convergence-pause', shortcut: 'K' },
      { key: 'render-quality-separator', type: 'separator' },
      { key: 'quality-label', type: 'label', label: 'Quality' },
      { key: 'quality-draft', label: 'Draft', qualityPreset: 'draft', shortcut: '1' },
      { key: 'quality-preview', label: 'Preview', qualityPreset: 'preview', shortcut: '2' },
      { key: 'quality-final', label: 'Final', qualityPreset: 'final', shortcut: '3' },
      { key: 'render-settings-separator', type: 'separator' },
      { key: 'debug-label', type: 'label', label: 'Debug views' },
      { key: 'debug-beauty', label: 'Beauty', debugView: 'beauty', pressed: true },
      { key: 'debug-normals', label: 'Normals', debugView: 'normals', pressed: false },
      { key: 'debug-albedo', label: 'Albedo', debugView: 'albedo', pressed: false },
      { key: 'debug-depth', label: 'Depth', debugView: 'depth', pressed: false },
      { key: 'debug-settings-separator', type: 'separator' },
      { key: 'settings-label', type: 'label', label: 'Settings' },
      { key: 'render-settings', label: 'Render Settings', panelTarget: 'render-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+3' },
      { key: 'camera-settings', label: 'Camera Settings', panelTarget: 'camera-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+4' },
      { key: 'environment-settings', label: 'Environment Settings', panelTarget: 'render-panel', activationWindowTarget: 'controls' },
      { key: 'output-settings', label: 'Resolution / Output', panelTarget: 'output-panel', activationWindowTarget: 'controls', shortcut: 'Ctrl+5' }
    ])
  },
  {
    key: 'help',
    label: 'Help',
    items: Object.freeze([
      { key: 'readme', label: 'README', href: 'README.md', target: '_blank', rel: 'noreferrer' }
    ])
  }
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
      return;
    }

    if (targetWindowId) {
      toggleUiWindowVisible(targetWindowId);
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
    <nav ref=${navRef} className="app-menu" aria-label="Application menu">
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
