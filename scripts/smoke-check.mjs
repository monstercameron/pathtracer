import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const syntaxOnly = process.argv.includes('--syntax-only');
const failures = [];
const checks = [];

const record = (name, passed, detail = '') => {
  checks.push({ name, passed, detail });
  if (!passed) {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  }
};

const repoPath = (...parts) => path.join(repoRoot, ...parts);
const displayPath = (filePath) => path.relative(repoRoot, filePath).replaceAll(path.sep, '/');

const assert = (name, condition, detail = '') => record(name, Boolean(condition), detail);

const fileHash = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');
const readUtf8 = (...parts) => readFileSync(repoPath(...parts), 'utf8');

const listFiles = (directory, predicate = () => true) => {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(fullPath, predicate);
    }
    return predicate(fullPath) ? [fullPath] : [];
  });
};

const stripQueryAndHash = (assetPath) => assetPath.split(/[?#]/u)[0];

const isExternalReference = (assetPath) => (
  /^(?:[a-z]+:)?\/\//iu.test(assetPath) ||
  assetPath.startsWith('data:') ||
  assetPath.startsWith('blob:') ||
  assetPath.startsWith('#')
);

const htmlHasButtonSelector = (html, selector) => {
  const idMatch = /^#([A-Za-z][\w:-]*)$/u.exec(selector);
  if (idMatch) {
    const [, id] = idMatch;
    return new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`, 'u').test(html);
  }

  const match = /^button\[([^=\]]+)="([^"]+)"\]$/u.exec(selector);
  if (!match) {
    return html.includes(selector);
  }
  const [, attributeName, attributeValue] = match;
  const buttonPattern = new RegExp(`<button\\b[^>]*\\b${attributeName}="${attributeValue}"[^>]*>`, 'u');
  return buttonPattern.test(html);
};

const extractImportMap = (html) => {
  const match = /<script\s+type="importmap"\s*>([\s\S]*?)<\/script>/iu.exec(html);
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
};

const referencedHtmlAssets = (html) => {
  const assetReferences = [];
  const referencePattern = /\b(?:href|src)="([^"]+)"/giu;
  let match = referencePattern.exec(html);
  while (match) {
    const assetReference = stripQueryAndHash(match[1]);
    if (assetReference && !isExternalReference(assetReference)) {
      assetReferences.push(assetReference);
    }
    match = referencePattern.exec(html);
  }
  return assetReferences;
};

const checkSyntax = () => {
  const syntaxFiles = [
    repoPath('electron-main.cjs'),
    ...listFiles(repoPath('src'), (filePath) => filePath.endsWith('.js')),
    ...listFiles(repoPath('docs', 'src'), (filePath) => filePath.endsWith('.js'))
  ];

  for (const filePath of syntaxFiles) {
    const result = spawnSync(process.execPath, ['--check', filePath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    assert(`syntax ${displayPath(filePath)}`, result.status === 0, detail);
  }
};

const checkMirrorPairs = () => {
  const mirrorPairs = [
    ['README.md', 'docs/README.md'],
    ['CHANGELOG.md', 'docs/CHANGELOG.md'],
    ['index.html', 'docs/index.html'],
    ['dist/app.css', 'docs/dist/app.css'],
    ['src/app.css', 'docs/src/app.css'],
    ['src/components/RenderCanvas.js', 'docs/src/components/RenderCanvas.js'],
    ['assets/models/README.md', 'docs/assets/models/README.md']
  ];

  for (const [rootFile, docsFile] of mirrorPairs) {
    const rootPath = repoPath(...rootFile.split('/'));
    const docsPath = repoPath(...docsFile.split('/'));
    assert(`mirror exists ${rootFile}`, existsSync(rootPath));
    assert(`mirror exists ${docsFile}`, existsSync(docsPath));
    if (existsSync(rootPath) && existsSync(docsPath)) {
      assert(`mirror parity ${rootFile}`, fileHash(rootPath) === fileHash(docsPath), `${rootFile} differs from ${docsFile}`);
    }
  }

  const sourceFiles = listFiles(repoPath('src'), (filePath) => filePath.endsWith('.js') || filePath.endsWith('.css'));
  for (const sourceFile of sourceFiles) {
    const relativeSourcePath = displayPath(sourceFile);
    const docsSourcePath = repoPath('docs', ...relativeSourcePath.split('/'));
    assert(`mirror exists docs/${relativeSourcePath}`, existsSync(docsSourcePath));
  }
};

const checkVendorFiles = () => {
  const vendorFiles = [
    'vendor/preact/preact.module.js',
    'vendor/preact/hooks.module.js',
    'vendor/preact/LICENSE',
    'vendor/htm/htm.module.js',
    'vendor/htm/preact.module.js',
    'vendor/htm/LICENSE',
    'vendor/preact-signals/signals.module.js',
    'vendor/preact-signals/signals-core.module.js',
    'vendor/preact-signals/LICENSE',
    'vendor/preact-signals/LICENSE.signals-core',
    'vendor/rapier/rapier.js',
    'vendor/rapier/rapier_wasm3d_bg.wasm'
  ];

  for (const vendorFile of vendorFiles) {
    for (const prefix of ['', 'docs/']) {
      const filePath = repoPath(...`${prefix}${vendorFile}`.split('/'));
      assert(`vendor exists ${prefix}${vendorFile}`, existsSync(filePath) && statSync(filePath).isFile());
      if (existsSync(filePath)) {
        assert(`vendor non-empty ${prefix}${vendorFile}`, statSync(filePath).size > 0);
      }
    }
  }
};

const checkStylesheetContracts = () => {
  const htmlRoots = [
    { label: 'root', html: readUtf8('index.html') },
    { label: 'docs', html: readUtf8('docs', 'index.html') }
  ];

  for (const htmlRoot of htmlRoots) {
    const srcAppCssLinks = htmlRoot.html.match(/<link\s+rel="stylesheet"\s+href="src\/app\.css">/giu) || [];
    assert(`stylesheet ${htmlRoot.label} uses src/app.css`, srcAppCssLinks.length === 1, `${srcAppCssLinks.length} src/app.css links`);
    assert(`stylesheet ${htmlRoot.label} drops dist/app.css`, !htmlRoot.html.includes('href="dist/app.css"'));
    assert(`stylesheet ${htmlRoot.label} has no inline style block`, !/<style\b/iu.test(htmlRoot.html));
  }

  for (const cssPath of [['src', 'app.css'], ['docs', 'src', 'app.css']]) {
    const source = readUtf8(...cssPath);
    const label = cssPath.join('/');
    assert(`stylesheet ${label} preserves antialiased utility`, (
      source.includes('.antialiased') &&
      source.includes('-webkit-font-smoothing: antialiased') &&
      source.includes('-moz-osx-font-smoothing: grayscale')
    ));
  }
};

const checkImportMapAndStaticAssets = () => {
  const expectedImports = Object.freeze({
    preact: './vendor/preact/preact.module.js',
    'preact/hooks': './vendor/preact/hooks.module.js',
    'htm/preact': './vendor/htm/preact.module.js',
    '@preact/signals': './vendor/preact-signals/signals.module.js',
    '@preact/signals-core': './vendor/preact-signals/signals-core.module.js'
  });

  const htmlRoots = [
    { label: 'root', directory: repoRoot, html: readUtf8('index.html') },
    { label: 'docs', directory: repoPath('docs'), html: readUtf8('docs', 'index.html') }
  ];

  for (const htmlRoot of htmlRoots) {
    const importMap = extractImportMap(htmlRoot.html);
    assert(`importmap exists ${htmlRoot.label}`, Boolean(importMap && importMap.imports));
    if (importMap && importMap.imports) {
      for (const [specifier, expectedPath] of Object.entries(expectedImports)) {
        const mappedPath = importMap.imports[specifier];
        assert(`importmap ${htmlRoot.label} maps ${specifier}`, mappedPath === expectedPath, `${specifier} mapped to ${mappedPath || 'missing'}`);
        const assetPath = mappedPath ? repoPath(path.relative(repoRoot, htmlRoot.directory), ...stripQueryAndHash(mappedPath).split('/')) : '';
        assert(`importmap asset exists ${htmlRoot.label} ${specifier}`, Boolean(mappedPath) && existsSync(assetPath), mappedPath || 'missing');
      }
    }

    for (const assetReference of referencedHtmlAssets(htmlRoot.html)) {
      assert(`static asset uses relative path ${htmlRoot.label} ${assetReference}`, !assetReference.startsWith('/'));
      const assetPath = path.resolve(htmlRoot.directory, assetReference);
      assert(`static asset exists ${htmlRoot.label} ${assetReference}`, assetPath.startsWith(htmlRoot.directory) && existsSync(assetPath), displayPath(assetPath));
    }
  }
};

const checkKeyboardShortcutContracts = () => {
  const bundle = readUtf8('webgl-path-tracing.js');
  const html = readUtf8('index.html');
  const readme = readUtf8('README.md');

  const ctrlShortcutSelectors = Object.freeze({
    KeyN: 'button[data-action="reset-all"]',
    Digit1: '#scene-tree-add',
    Digit2: 'button[data-panel-target="object-panel"]',
    Digit3: 'button[data-panel-target="render-panel"]',
    Digit4: 'button[data-panel-target="camera-panel"]',
    Digit5: 'button[data-panel-target="output-panel"]',
    Digit6: 'button[data-panel-target="preset-panel"]',
    KeyS: 'button[data-action="save-bitmap"]'
  });

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

  assert('keyboard listens for keydown', bundle.includes("addEventListener('keydown'"));
  assert('keyboard supports Ctrl or Command shortcuts', bundle.includes('event.ctrlKey || event.metaKey'));
  assert('keyboard prevents browser save for Ctrl+S', bundle.includes('event.preventDefault()') && bundle.includes('KeyS'));

  for (const [keyCode, selector] of Object.entries({ ...ctrlShortcutSelectors, ...commandShortcutSelectors })) {
    assert(`keyboard selector ${keyCode}`, bundle.includes(`${keyCode}: '${selector}'`), selector);
    assert(`keyboard selector target exists ${keyCode}`, htmlHasButtonSelector(html, selector), selector);
  }

  for (const documentedShortcut of ['Ctrl+1', 'Ctrl+2', 'Ctrl+6', 'Ctrl+N', 'Ctrl+S', '`C` toggles', '`P` pauses', '`K` pauses', '`F` toggles', '`I` toggles', '`T` toggles', '`B` toggles', '`L` selects']) {
    assert(`README documents shortcut ${documentedShortcut}`, readme.includes(documentedShortcut));
  }
};

const checkFloatingWindowContracts = () => {
  const source = readUtf8('src', 'components', 'FloatingWindow.js');
  const html = readUtf8('index.html');
  const readme = readUtf8('README.md');

  assert('floating window exports stable storage key', source.includes("FLOATING_WINDOW_STORAGE_KEY = 'pathtracer.floatingWindows.v1'"));
  assert('floating window reads persisted state', source.includes('localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY)'));
  assert('floating window writes persisted state', source.includes('localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY'));
  for (const persistedField of ['left', 'top', 'width', 'height', 'hidden', 'collapsed']) {
    assert(`floating window persists ${persistedField}`, source.includes(persistedField));
  }
  for (const handler of ['handlePointerDown', 'handlePointerMove', 'handlePointerUp', 'setPointerCapture', 'releasePointerCapture', 'clampToViewport']) {
    assert(`floating window drag contract ${handler}`, source.includes(handler));
  }
  assert('floating window collapse command button', source.includes('data-window-command="collapse"') && source.includes('setCollapsed'));
  assert('floating window close command button', source.includes('data-window-command="close"') && source.includes('setWindowVisible(false)'));
  assert('floating window show clears collapse', source.includes('setCollapsed(false)'));

  for (const windowId of ['scene-tree-window', 'controls', 'benchmark']) {
    const sectionPattern = new RegExp(`<section\\b[^>]*\\bid="${windowId}"[^>]*\\bdata-floating-window\\b`, 'u');
    assert(`fallback HTML has floating window ${windowId}`, sectionPattern.test(html));
  }
  assert('fallback HTML has drag handles', (html.match(/data-window-drag-handle/gu) || []).length >= 3);
  assert('fallback HTML has collapse commands', (html.match(/data-window-command="collapse"/gu) || []).length >= 3);
  assert('fallback HTML has close commands', (html.match(/data-window-command="close"/gu) || []).length >= 3);
  assert('README documents floating panel restore', readme.includes('panel layout is restored in the browser'));
};

const checkReactCanvasCssContracts = () => {
  const canvasCssProperties = [
    '--canvas-render-size',
    '--canvas-render-width',
    '--canvas-render-height',
    '--canvas-aspect-ratio'
  ];
  const renderCanvasSource = readUtf8('src', 'components', 'RenderCanvas.js');
  const docsRenderCanvasSource = readUtf8('docs', 'src', 'components', 'RenderCanvas.js');
  const legacyRendererSource = readUtf8('webgl-path-tracing.js');
  const html = readUtf8('index.html');
  const mainSource = readUtf8('src', 'main.jsx.js');

  assert('render canvas mirror parity', renderCanvasSource === docsRenderCanvasSource);
  assert('render canvas imports useEffect', /import \{[^}]*useEffect[^}]*\} from 'preact\/hooks';/u.test(renderCanvasSource));
  assert('render canvas owns CSS property names', canvasCssProperties.every((propertyName) => renderCanvasSource.includes(`'${propertyName}'`)));
  assert('render canvas computes width/height/aspect CSS values', (
    renderCanvasSource.includes("'--canvas-render-width': `${renderWidth}px`") &&
    renderCanvasSource.includes("'--canvas-render-height': `${renderHeight}px`") &&
    renderCanvasSource.includes("'--canvas-aspect-ratio': String(renderWidth / renderHeight)")
  ));
  assert('render canvas CSS effect targets document root', (
    renderCanvasSource.includes('ownerDocument.documentElement') &&
    renderCanvasSource.includes('return writeCanvasCssProperties(documentElement, width, height);') &&
    renderCanvasSource.includes('}, [width, height]);')
  ));
  assert('render canvas restores previous document root CSS values', (
    renderCanvasSource.includes('previousProperties') &&
    renderCanvasSource.includes('style.getPropertyPriority(propertyName)') &&
    renderCanvasSource.includes('style.removeProperty(propertyName)')
  ));
  assert('render canvas avoids canvas inline CSS custom-property writes', (
    !/canvas(?:Ref\.current|Element)?\.style\.setProperty\(\s*['"`]--canvas-/u.test(renderCanvasSource)
  ));

  assert('active entrypoint still loads legacy renderer', html.includes('<script type="module" src="webgl-path-tracing.js"></script>'));
  assert('active entrypoint still has fallback canvas', html.includes('<canvas id="canvas" width="512" height="512"></canvas>'));
  assert('React scaffold remains inert unless explicitly activated', (
    html.includes('<div id="ui-root" hidden></div>') &&
    mainSource.includes('AppScaffold({ active = false, includeCanvas = false, onCanvasReady })')
  ));
  assert('legacy fallback writes canvas CSS custom properties on document root', (
    legacyRendererSource.includes('const applyCanvasSizeToDocument = (documentObject, canvasElement) => {') &&
    canvasCssProperties.every((propertyName) => (
      legacyRendererSource.includes(`documentObject.documentElement.style.setProperty('${propertyName}'`)
    ))
  ));
  assert('legacy fallback sizes the active canvas element', (
    legacyRendererSource.includes('canvasElement.width = CANVAS_RENDER_WIDTH;') &&
    legacyRendererSource.includes('canvasElement.height = CANVAS_RENDER_HEIGHT;')
  ));
  assert('legacy fallback avoids canvas inline CSS custom-property writes', (
    !/canvasElement\.style\.setProperty\(\s*['"`]--canvas-/u.test(legacyRendererSource)
  ));
};

const checkBenchmarkSignalContracts = () => {
  const mirroredFiles = [
    'src/store.js',
    'src/benchmarkStore.js',
    'src/renderBridge.js',
    'src/components/BenchmarkPanel.js',
    'src/components/panels/RenderPanel.js'
  ];

  for (const sourceFile of mirroredFiles) {
    const docsFile = `docs/${sourceFile}`;
    assert(`signal mirror exists ${docsFile}`, existsSync(repoPath(...docsFile.split('/'))));
    if (existsSync(repoPath(...docsFile.split('/')))) {
      assert(
        `signal mirror parity ${sourceFile}`,
        fileHash(repoPath(...sourceFile.split('/'))) === fileHash(repoPath(...docsFile.split('/'))),
        `${sourceFile} differs from ${docsFile}`
      );
    }
  }

  const storeSource = readUtf8('src', 'store.js');
  assert('store exports signal equality guard', storeSource.includes('export const areSignalValuesEqual'));
  assert('store guards app signal writes', storeSource.includes('if (!areSignalValuesEqual(fieldSignal.value, nextValue))'));
  assert('store bound app object skips unchanged writes', storeSource.includes('} else if (!areSignalValuesEqual(signals[fieldName].value, nextValue)) {'));
  assert('store patches state inside batch', /export const patchApplicationState[\s\S]*batch\(\(\) =>/u.test(storeSource));

  const benchmarkStoreSource = readUtf8('src', 'benchmarkStore.js');
  assert('benchmark store exports updateBenchmarkSignals', benchmarkStoreSource.includes('export const updateBenchmarkSignals'));
  assert('benchmark store batches signal updates', /export const updateBenchmarkSignals[\s\S]*batch\(\(\) =>/u.test(benchmarkStoreSource));
  assert('benchmark store skips unchanged writes', benchmarkStoreSource.includes('if (!Object.is(targetSignal.value, value))'));
  for (const fieldName of [
    'activeRaysPerSecond',
    'estimatedRayBandwidthBytesPerSecond',
    'perceptualFramesPerSecond',
    'performanceScore',
    'measurementSource',
    'renderResolution',
    'lightBounces',
    'gpuRenderer'
  ]) {
    assert(`benchmark store updates ${fieldName}`, benchmarkStoreSource.includes(fieldName));
  }

  const renderBridgeSource = readUtf8('src', 'renderBridge.js');
  assert('render bridge imports benchmark signal updater', renderBridgeSource.includes("import { updateBenchmarkSignals } from './benchmarkStore.js';"));
  assert('render bridge batches render-loop signal writes', renderBridgeSource.includes('batch(() =>'));
  assert('render bridge passes benchmark context', renderBridgeSource.includes('updateBenchmarkSignals(benchmarkSnapshot, {'));

  const legacyRendererSource = readUtf8('webgl-path-tracing.js');
  assert(
    'legacy renderer imports benchmark signal updater',
    legacyRendererSource.includes("import { updateBenchmarkSignals } from './src/benchmarkStore.js';")
  );
  assert(
    'legacy benchmark display updates signals at throttle point',
    /this\.previousUpdateMilliseconds = currentTimeMilliseconds;\s*updateBenchmarkSignals\(benchmarkSnapshot, \{/u.test(legacyRendererSource)
  );
  assert('interactive quality throttle uses one ray per pixel', legacyRendererSource.includes('const INTERACTIVE_QUALITY_RAYS_PER_PIXEL = 1;'));
  assert('interactive quality throttle uses two bounces', legacyRendererSource.includes('const INTERACTIVE_QUALITY_LIGHT_BOUNCE_COUNT = 2;'));
  assert('interactive quality throttle follows camera drag state', legacyRendererSource.includes('const isInteractiveQualityThrottleActive = Boolean(applicationState.isRotatingCamera);'));
  assert(
    'interactive quality throttle clears after restore',
    /this\.wasInteractiveQualityThrottleActive\s*&&\s*!\s*effectiveRenderQuality\.isInteractiveQualityThrottleActive[\s\S]*this\.clearSamples\(false\)/u.test(legacyRendererSource)
  );
};

const checkBenchmarkSceneContracts = () => {
  const legacyRendererSource = readUtf8('webgl-path-tracing.js');
  const html = readUtf8('index.html');

  assert('particle fluid benchmark factory exists', legacyRendererSource.includes('const createBenchmarkParticleFluidSceneObjects'));
  assert('particle fluid benchmark registered', legacyRendererSource.includes('benchmarkParticleFluid: Object.freeze({'));
  assert(
    'particle fluid benchmark uses Rapier spring joints',
    legacyRendererSource.includes('JointData.spring') && legacyRendererSource.includes('createImpulseJoint')
  );
  assert('particle fluid benchmark exposes particle count constant', legacyRendererSource.includes('DEFAULT_PARTICLE_FLUID_PARTICLE_COUNT = 24'));
  assert('particle fluid benchmark exposes radius constant', legacyRendererSource.includes('DEFAULT_PARTICLE_FLUID_RADIUS = 0.06'));
  assert('particle fluid benchmark exposes stiffness constant', legacyRendererSource.includes('DEFAULT_PARTICLE_FLUID_SPRING_STIFFNESS = 120'));
  assert(
    'particle fluid benchmark target settings',
    /benchmarkParticleFluid:[\s\S]*targetBounces:\s*6,[\s\S]*targetRaysPerPixel:\s*8/u.test(legacyRendererSource)
  );
  assert(
    'particle fluid benchmark has subsurface particles and glass container',
    legacyRendererSource.includes('MATERIAL.SUBSURFACE') &&
      legacyRendererSource.includes('Particle Fluid Glass Container') &&
      legacyRendererSource.includes('MATERIAL.GLASS')
  );
  assert('particle fluid benchmark menu button exists', htmlHasButtonSelector(html, 'button[data-benchmark-scene="benchmarkParticleFluid"]'));
  assert('particle fluid benchmark controls exist', (
    html.includes('id="particle-fluid-controls"') &&
    html.includes('id="particle-fluid-count"') &&
    html.includes('id="particle-fluid-radius"') &&
    html.includes('id="particle-fluid-stiffness"') &&
    htmlHasButtonSelector(html, 'button[data-action="apply-particle-fluid-settings"]')
  ));
};

const checkEmissionModifierContracts = () => {
  const rendererSource = readUtf8('webgl-path-tracing.js');
  const objectPanelSource = readUtf8('src', 'components', 'panels', 'ObjectPanel.js');

  assert(
    'emission modifier renderer mirror parity',
    fileHash(repoPath('webgl-path-tracing.js')) === fileHash(repoPath('docs', 'webgl-path-tracing.js')),
    'webgl-path-tracing.js differs from docs/webgl-path-tracing.js'
  );
  assert(
    'emission modifier panel mirror parity',
    fileHash(repoPath('src', 'components', 'panels', 'ObjectPanel.js')) ===
      fileHash(repoPath('docs', 'src', 'components', 'panels', 'ObjectPanel.js')),
    'src/components/panels/ObjectPanel.js differs from docs/src/components/panels/ObjectPanel.js'
  );
  assert('emission modifier has enabled state reader', rendererSource.includes('const readSceneObjectEmissionEnabled'));
  assert('emission modifier composes shader source', rendererSource.includes('createEmissionModifierShaderSource(sceneObject)'));
  assert('emission modifier serializes enabled flag', rendererSource.includes('objectSnapshot.emission =') && rendererSource.includes('emissiveSnapshot.enabled'));
  assert('legacy emissive material enables modifier', rendererSource.includes('this.isEmissionEnabled = this.material === MATERIAL.EMISSIVE'));
  assert('object panel exposes emission checkbox', objectPanelSource.includes('id="emission-enabled"'));
  assert('object panel allows emission on any material object', objectPanelSource.includes('Number.isFinite(Number(selectedItem.material))'));
};

const checkTodoEvidence = () => {
  const readme = readFileSync(repoPath('README.md'), 'utf8');
  const changelog = readFileSync(repoPath('CHANGELOG.md'), 'utf8');
  const decisionsPath = repoPath('docs', 'workstream-decisions.md');
  const ecsPath = repoPath('docs', 'ecs-scene-model.md');
  const decisions = existsSync(decisionsPath) ? readFileSync(decisionsPath, 'utf8') : '';
  const ecs = existsSync(ecsPath) ? readFileSync(ecsPath, 'utf8') : '';
  const legacyRenderer = readFileSync(repoPath('webgl-path-tracing.js'), 'utf8');
  const docsLegacyRendererPath = repoPath('docs', 'webgl-path-tracing.js');
  const materialComponentPath = repoPath('src', 'components', 'MaterialComponent.js');
  const docsMaterialComponentPath = repoPath('docs', 'src', 'components', 'MaterialComponent.js');
  const physicsComponentPath = repoPath('src', 'components', 'PhysicsComponent.js');
  const docsPhysicsComponentPath = repoPath('docs', 'src', 'components', 'PhysicsComponent.js');

  assert('evidence README documents loader scaffold', readme.includes('OBJ/MTL, STL, PLY, glTF 2.0 JSON'));
  assert('evidence README documents import coordinator', readme.includes('src/importers'));
  assert('evidence README links workstream decisions', readme.includes('docs/workstream-decisions.md'));
  assert('evidence decisions doc exists', existsSync(decisionsPath));
  assert('evidence ECS scene model doc exists', existsSync(ecsPath));
  assert('evidence decisions cover imported assets', decisions.includes('## Imported Assets'));
  assert('evidence decisions cover renderer backends', decisions.includes('## Renderer Backends'));
  assert('evidence decisions cover canvas export', decisions.includes('## Canvas Export'));
  assert('evidence changelog notes workstream decisions', changelog.includes('Add workstream decision notes'));
  assert('evidence changelog notes loader scaffold', changelog.includes('Add OBJ/MTL, STL, and PLY parser modules plus loader smoke samples'));
  assert('evidence changelog notes GLTF/GLB APIs', changelog.includes('Document the GLTF/GLB loader APIs'));
  assert('evidence material component exists', existsSync(materialComponentPath) && existsSync(docsMaterialComponentPath));
  assert('evidence material component mirror parity', fileHash(materialComponentPath) === fileHash(docsMaterialComponentPath));
  assert('evidence physics component exists', existsSync(physicsComponentPath) && existsSync(docsPhysicsComponentPath));
  assert('evidence physics component mirror parity', fileHash(physicsComponentPath) === fileHash(docsPhysicsComponentPath));
  assert('evidence renderer mirror parity', fileHash(repoPath('webgl-path-tracing.js')) === fileHash(docsLegacyRendererPath));
  assert('evidence renderer imports material component', legacyRenderer.includes("import { DEFAULT_MATERIAL_GLOSSINESS, MaterialComponent } from './src/components/MaterialComponent.js';"));
  assert('evidence renderer imports physics component', legacyRenderer.includes("import { PhysicsComponent } from './src/components/PhysicsComponent.js';"));
  assert('evidence renderer uses material component storage', legacyRenderer.includes('this.materialComponent = createSceneObjectMaterialComponent(material);'));
  assert('evidence renderer uses physics component storage', legacyRenderer.includes('this.physicsComponent = createSceneObjectPhysicsComponent({'));
  assert('evidence renderer preserves material accessor', legacyRenderer.includes('return ensureSceneObjectMaterialComponent(this).material;'));
  assert('evidence renderer preserves physics rigid body accessor', legacyRenderer.includes('return ensureSceneObjectPhysicsComponent(this).physicsRigidBody;'));
  assert('evidence ECS doc notes material migration', ecs.includes('store material state in `MaterialComponent` instances'));
  assert('evidence ECS doc notes physics migration', ecs.includes('store body settings and the transient Rapier handle in `PhysicsComponent` instances'));
};

const checkLoaderSmoke = async () => {
  const { runLoaderSmokeSamples } = await import(pathToFileURL(repoPath('src', 'loaders', 'parserSmokeSamples.js')).href);
  const result = runLoaderSmokeSamples();

  assert('loader smoke OBJ triangles', result.objTriangleCount === 1, JSON.stringify(result));
  assert('loader smoke MTL materials', result.objMaterialCount === 1, JSON.stringify(result));
  assert('loader smoke STL triangles', result.stlTriangleCount === 1, JSON.stringify(result));
  assert('loader smoke PLY triangles', result.plyTriangleCount === 1, JSON.stringify(result));
  assert('loader smoke PLY vertex colors', result.plyHasVertexColors === true, JSON.stringify(result));
  assert('loader smoke glTF triangles', result.gltfTriangleCount === 1, JSON.stringify(result));
  assert('loader smoke glTF material mapping', result.gltfMaterialCount === 1 && Number.isFinite(result.gltfMaterialType), JSON.stringify(result));
  assert('loader smoke GLB triangles', result.glbTriangleCount === 1 && result.glbEncoding === 'glb', JSON.stringify(result));
  assert('loader smoke mesh fit metadata', result.objMeshFitScale === 2 && result.objMeshFittedLongestAxis === 2, JSON.stringify(result));
  assert('loader smoke mesh memory estimate', result.objMeshEstimatedCpuBytes > 0, JSON.stringify(result));
  assert('loader smoke fitted triangle data', Array.isArray(result.objMeshFittedFirstPosition) && result.objMeshFittedFirstPosition[0] === -1, JSON.stringify(result));
};

const checkImporterSmoke = async () => {
  const { runImportCoordinatorSmokeSamples } = await import(pathToFileURL(repoPath('src', 'importers', 'importerSmokeSamples.js')).href);
  const result = await runImportCoordinatorSmokeSamples();

  assert('importer smoke format count', result.importCount === result.formats.length && result.importCount === 5, JSON.stringify(result));
  assert('importer smoke formats', ['obj', 'gltf', 'glb', 'stl', 'ply'].every((format) => result.formats.includes(format)), JSON.stringify(result));
  assert('importer smoke glTF JSON', result.gltfTriangleCount === 1, JSON.stringify(result));
  assert('importer smoke OBJ mesh record', result.objTriangleCount === 3 && result.objMeshRecordTriangleCount === 3, JSON.stringify(result));
  assert('importer smoke OBJ fitted triangles', result.objFittedTriangleCount === 3 && result.objResultFittedTriangleCount === 3 && result.objResultNormalizedTriangleCount === 3, JSON.stringify(result));
  assert('importer smoke texture resolution', result.objResolvedTextureReferenceCount === 2 && result.objLoadedTextureAssetCount === 1, JSON.stringify(result));
  assert('importer smoke texture fallback', result.objMissingTextureFileCount === 1 && result.objFallbackTextureAssetCount === 1, JSON.stringify(result));
  assert('importer smoke mesh metadata', result.meshRecordCount === result.importCount && result.meshMetadataCount === result.importCount, JSON.stringify(result));
  assert('importer smoke all mesh metadata', result.allMeshRecordsHaveMetadata === true, JSON.stringify(result));
  assert('importer smoke assetPipeline log count', result.assetPipelineLogCount === result.importCount, JSON.stringify(result));
  assert('importer smoke assetPipeline logs every import', result.assetPipelineAllImportsLogged === true, JSON.stringify(result));
  assert('importer smoke assetPipeline mesh details', result.assetPipelineLogsHaveMeshDetails === true, JSON.stringify(result));
  assert('importer smoke assetPipeline timing details', result.assetPipelineLogsHaveTimingDetails === true, JSON.stringify(result));
  assert('importer smoke assetPipeline OBJ model', result.objAssetPipelineModelName === 'sample' && result.objAssetPipelineTriangleCount === result.objTriangleCount, JSON.stringify(result));
  assert('importer smoke assetPipeline memory estimates', result.objAssetPipelineEstimatedMeshBytes === result.objMeshEstimatedCpuBytes && result.objAssetPipelineEstimatedTextureBytes > 0 && result.objAssetPipelineEstimatedUploadBytes >= result.objAssetPipelineEstimatedMeshBytes, JSON.stringify(result));
  assert('importer smoke assetPipeline atlas/BVH unavailable', result.objAssetPipelineAtlasStatus === 'unavailable' && result.objAssetPipelineBvhStatus === 'unavailable' && result.objAssetPipelineSourceTextureCount === result.objTextureAssetCount, JSON.stringify(result));
  assert('importer smoke fit scaling', result.scaledObjMeshFitScale === 2 && result.scaledObjMeshFittedLongestAxis === 2, JSON.stringify(result));
  assert('importer smoke GLTF/GLB/STL/PLY', result.gltfTriangleCount === 1 && result.glbTriangleCount === 1 && result.stlTriangleCount === 1 && result.plyTriangleCount === 1, JSON.stringify(result));
};

const importSceneStoreForSmoke = async () => {
  const signalsCoreUrl = pathToFileURL(repoPath('vendor', 'preact-signals', 'signals-core.module.js')).href;
  const source = readUtf8('src', 'sceneStore.js')
    .replace("from '@preact/signals';", `from '${signalsCoreUrl}';`);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
};

const checkSceneStoreGroupingSmoke = async () => {
  const sceneStore = await importSceneStoreForSmoke();
  const result = sceneStore.runSceneStoreSmokeSamples();

  assert('scene store smoke creates GroupEntity', result.groupEntityClassName === 'GroupEntity', JSON.stringify(result));
  assert('scene store smoke records group id', result.groupId === 'group-test', JSON.stringify(result));
  assert('scene store smoke groups selected children', result.groupedChildCount === 2 && result.groupedChildEntityIds.join(',') === 'sphere-a,cube-b', JSON.stringify(result));
  assert('scene store smoke selects group subtree', result.groupedSelectedItemId === 'group-test' && result.groupedSelectedItemIds.join(',') === 'group-test,sphere-a,cube-b', JSON.stringify(result));
  assert('scene store smoke expands group selection', result.expandedGroupSelectionIds.join(',') === 'group-test,sphere-a,cube-b', JSON.stringify(result));
  assert('scene store smoke preserves parent ids through serialize round trip', result.roundTripGroupParent === null && result.roundTripChildParentIds.every((parentId) => parentId === 'group-test'), JSON.stringify(result));
  assert('scene store smoke ungroups to root', result.didUngroup === true && result.ungroupedItemCount === 3 && ['sphere-a', 'cube-b', 'light'].every((itemId) => result.ungroupedRootIds.includes(itemId)), JSON.stringify(result));
  assert('scene store smoke applies bulk hide lock', result.didHideSelection === true && result.didLockSelection === true && result.bulkEditedItemIds.join(',') === 'sphere-a,cube-b', JSON.stringify(result));
  assert('scene store smoke deletes selected children', result.didDeleteSelection === true && result.deletedItemCount === 1 && result.deletedRemainingIds.join(',') === 'light', JSON.stringify(result));
};

const checkEditorGroupingContracts = () => {
  const sceneStoreSource = readUtf8('src', 'sceneStore.js');
  const menuSource = readUtf8('src', 'components', 'MenuBar.js');
  const sceneTreeSource = readUtf8('src', 'components', 'SceneTreeWindow.js');
  const inspectorSource = readUtf8('src', 'components', 'InspectorPanel.js');

  for (const sourceFile of [
    'src/sceneStore.js',
    'src/components/MenuBar.js',
    'src/components/SceneTreeWindow.js',
    'src/components/InspectorPanel.js'
  ]) {
    const docsFile = `docs/${sourceFile}`;
    assert(`grouping mirror exists ${docsFile}`, existsSync(repoPath(...docsFile.split('/'))));
    if (existsSync(repoPath(...docsFile.split('/')))) {
      assert(
        `grouping mirror parity ${sourceFile}`,
        fileHash(repoPath(...sourceFile.split('/'))) === fileHash(repoPath(...docsFile.split('/'))),
        `${sourceFile} differs from ${docsFile}`
      );
    }
  }

  assert('scene store defines GroupEntity', sceneStoreSource.includes('export class GroupEntity'));
  assert('scene store normalizes parentEntityId', sceneStoreSource.includes('parentEntityId: readParentEntityId(item)'));
  assert('scene store syncs childEntityIds from parent ids', sceneStoreSource.includes('syncSceneGroupChildEntityIds'));
  assert('scene store exposes grouping actions', ['canGroupSceneItems', 'groupSelectedSceneItems', 'canUngroupSceneItems', 'ungroupSelectedSceneItems'].every((name) => sceneStoreSource.includes(`export const ${name}`)));
  assert('scene store exposes bulk scene actions', ['deleteSelectedSceneItems', 'toggleSelectedSceneItemsHidden', 'toggleSelectedSceneItemsLocked'].every((name) => sceneStoreSource.includes(`export const ${name}`)));

  assert('menu exposes group shortcuts', menuSource.includes("shortcut: 'Ctrl+G'") && menuSource.includes("shortcut: 'Ctrl+Shift+G'"));
  assert('menu handles Ctrl+G keyboard action', menuSource.includes("event.code !== 'KeyG'") && menuSource.includes("event.shiftKey ? 'ungroup-selection' : 'group-selection'"));
  assert('menu runs group and ungroup actions', menuSource.includes('groupSelectedSceneItems()') && menuSource.includes('ungroupSelectedSceneItems()'));

  assert('scene tree renders recursive tree role', sceneTreeSource.includes('role="tree"') && sceneTreeSource.includes('role="treeitem"') && sceneTreeSource.includes('role="group"'));
  assert('scene tree renders collapsible group chevrons', sceneTreeSource.includes('scene-tree-chevron') && sceneTreeSource.includes('aria-expanded') && sceneTreeSource.includes('setCollapsedGroupIds'));
  assert('scene tree selects group subtree', sceneTreeSource.includes('collectSceneTreeNodeItemIds') && sceneTreeSource.includes("item.sceneItemKind === 'group'"));
  assert('scene tree exposes grouping toolbar actions', sceneTreeSource.includes('data-action="group-selection"') && sceneTreeSource.includes('data-action="ungroup-selection"'));

  assert('inspector exposes bulk controls', inspectorSource.includes('data-selection-bulk-controls') && inspectorSource.includes('selectedCount > 1 || canUngroupSelection'));
  assert('inspector exposes bulk hide lock delete', ['toggleSelectedSceneItemsHidden', 'toggleSelectedSceneItemsLocked', 'deleteSelectedSceneItems'].every((name) => inspectorSource.includes(name)));
  assert('inspector exposes group ungroup bulk actions', inspectorSource.includes('groupSelectedSceneItems()') && inspectorSource.includes('ungroupSelectedSceneItems()'));
};

checkSyntax();

if (!syntaxOnly) {
  checkMirrorPairs();
  checkVendorFiles();
  checkStylesheetContracts();
  checkImportMapAndStaticAssets();
  checkKeyboardShortcutContracts();
  checkFloatingWindowContracts();
  checkReactCanvasCssContracts();
  checkBenchmarkSignalContracts();
  checkBenchmarkSceneContracts();
  checkEmissionModifierContracts();
  checkTodoEvidence();
  checkEditorGroupingContracts();
  await checkLoaderSmoke();
  await checkImporterSmoke();
  await checkSceneStoreGroupingSmoke();
}

for (const check of checks) {
  console.log(`${check.passed ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failures.length > 0) {
  console.error('\nSmoke check failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`\n${checks.length} smoke checks passed.`);
