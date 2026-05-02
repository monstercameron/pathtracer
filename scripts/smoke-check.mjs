import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
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

const extractMarkdownSection = (source, heading) => {
  const headingIndex = source.indexOf(heading);
  if (headingIndex < 0) {
    return '';
  }
  const nextHeadingIndex = source.indexOf('\n## ', headingIndex + heading.length);
  return nextHeadingIndex < 0 ? source.slice(headingIndex) : source.slice(headingIndex, nextHeadingIndex);
};

const countObjFaces = (filePath) => {
  const source = readFileSync(filePath, 'utf8');
  return (source.match(/^f\s+/gmu) || []).length;
};

const readGlbHeader = (filePath) => {
  const fd = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(20);
    readSync(fd, header, 0, header.length, 0);
    const magic = header.readUInt32LE(0);
    const version = header.readUInt32LE(4);
    const byteLength = header.readUInt32LE(8);
    const jsonLength = header.readUInt32LE(12);
    const jsonType = header.readUInt32LE(16);
    const jsonChunk = Buffer.alloc(jsonLength);
    readSync(fd, jsonChunk, 0, jsonLength, 20);
    return {
      magic,
      version,
      byteLength,
      jsonType,
      json: JSON.parse(jsonChunk.toString('utf8').trim())
    };
  } finally {
    closeSync(fd);
  }
};

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

const sourceHasSelector = (source, selector) => {
  const idMatch = /^#([A-Za-z][\w:-]*)$/u.exec(selector);
  if (idMatch) {
    const [, id] = idMatch;
    return (
      source.includes(`id="${id}"`) ||
      source.includes(`id='${id}'`) ||
      source.includes(`id=${id}`) ||
      source.includes(`id = '${id}'`) ||
      source.includes(`id = "${id}"`) ||
      source.includes(`'${id}'`) ||
      source.includes(`"${id}"`)
    );
  }

  const elementIdMatch = /^([a-z]+)#([A-Za-z][\w:-]*)$/iu.exec(selector);
  if (elementIdMatch) {
    return sourceHasSelector(source, `#${elementIdMatch[2]}`);
  }

  const buttonMatch = /^button\[([^=\]]+)="([^"]+)"\]$/u.exec(selector);
  if (buttonMatch) {
    const [, attributeName, attributeValue] = buttonMatch;
    return source.includes(`${attributeName}="${attributeValue}"`) || source.includes(`${attributeName}=${attributeValue}`) || source.includes(`'${attributeValue}'`);
  }

  return source.includes(selector);
};

const readReactUiSource = () => [
  readUtf8('src', 'main.jsx.js'),
  readUtf8('src', 'components', 'MenuBar.js'),
  readUtf8('src', 'components', 'MenuGroup.js'),
  readUtf8('src', 'components', 'QuickActions.js'),
  readUtf8('src', 'components', 'LoadingOverlay.js'),
  readUtf8('src', 'components', 'SceneTreeWindow.js'),
  readUtf8('src', 'components', 'InspectorPanel.js'),
  readUtf8('src', 'components', 'BenchmarkPanel.js'),
  readUtf8('src', 'components', 'FloatingWindow.js'),
  readUtf8('src', 'components', 'panels', 'ObjectPanel.js'),
  readUtf8('src', 'components', 'panels', 'RenderPanel.js'),
  readUtf8('src', 'components', 'panels', 'PhysicsPanel.js'),
  readUtf8('src', 'components', 'panels', 'CameraPanel.js'),
  readUtf8('src', 'components', 'panels', 'OutputPanel.js'),
  readUtf8('src', 'components', 'panels', 'ImageCorrectionPanel.js'),
  readUtf8('src', 'components', 'panels', 'PresetPanel.js')
].join('\n');

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

const checkReferenceModelAssets = () => {
  const modelFiles = [
    'assets/models/suzanne.obj',
    'assets/models/suzanne_low.obj',
    'assets/models/suzanne.LICENSE.md',
    'assets/models/sponza/sponza.glb',
    'assets/models/sponza/LICENSE.md',
    'assets/models/sponza/README.upstream.md'
  ];

  for (const modelFile of modelFiles) {
    const rootPath = repoPath(...modelFile.split('/'));
    const docsPath = repoPath('docs', ...modelFile.split('/'));
    assert(`reference model exists ${modelFile}`, existsSync(rootPath) && statSync(rootPath).isFile());
    assert(`reference model mirror exists docs/${modelFile}`, existsSync(docsPath) && statSync(docsPath).isFile());
    if (existsSync(rootPath) && existsSync(docsPath)) {
      assert(`reference model mirror size ${modelFile}`, statSync(rootPath).size === statSync(docsPath).size);
    }
  }

  const suzannePath = repoPath('assets', 'models', 'suzanne.obj');
  const suzanneLowPath = repoPath('assets', 'models', 'suzanne_low.obj');
  if (existsSync(suzannePath)) {
    assert('reference Suzanne full triangle count', countObjFaces(suzannePath) === 3936);
  }
  if (existsSync(suzanneLowPath)) {
    const lowFaceCount = countObjFaces(suzanneLowPath);
    assert('reference Suzanne low triangle count', lowFaceCount >= 150 && lowFaceCount <= 220, String(lowFaceCount));
  }

  const suzanneLicense = readUtf8('assets', 'models', 'suzanne.LICENSE.md');
  const sponzaLicense = readUtf8('assets', 'models', 'sponza', 'LICENSE.md');
  const modelReadme = readUtf8('assets', 'models', 'README.md');
  assert('reference Suzanne license is CC0', suzanneLicense.includes('CC0 1.0 Universal') && modelReadme.includes('CC0-1.0'));
  assert('reference Sponza license is documented', sponzaLicense.includes('Cryengine Limited License Agreement') && modelReadme.includes('LicenseRef-CRYENGINE-Agreement'));

  const referenceModelSource = readUtf8('src', 'referenceModelData.js');
  const docsReferenceModelSource = readUtf8('docs', 'src', 'referenceModelData.js');
  assert('reference model data mirror parity', referenceModelSource === docsReferenceModelSource);
  assert('reference model data exports Suzanne low mesh', (
    referenceModelSource.includes('SUZANNE_LOW_REFERENCE_MODEL') &&
    referenceModelSource.includes("assetPath: 'assets/models/suzanne_low.obj'") &&
    referenceModelSource.includes('triangleCount: 196') &&
    referenceModelSource.includes('fullTriangleCount: 3936')
  ));
  assert('reference model data exports Sponza GLB metadata', (
    referenceModelSource.includes('SPONZA_GLB_REFERENCE_MODEL') &&
    referenceModelSource.includes("assetPath: 'assets/models/sponza/sponza.glb'") &&
    referenceModelSource.includes('triangleCount: 262267')
  ));

  const sponzaPath = repoPath('assets', 'models', 'sponza', 'sponza.glb');
  if (existsSync(sponzaPath)) {
    const glb = readGlbHeader(sponzaPath);
    assert('reference Sponza GLB magic', glb.magic === 0x46546c67);
    assert('reference Sponza GLB version', glb.version === 2);
    assert('reference Sponza GLB byte length', glb.byteLength === statSync(sponzaPath).size);
    assert('reference Sponza GLB JSON chunk', glb.jsonType === 0x4e4f534a && glb.json.asset?.version === '2.0');
    assert('reference Sponza GLB is self-contained', (
      glb.json.buffers?.length === 1
      && !glb.json.buffers[0].uri
      && glb.json.images?.length > 0
      && glb.json.images.every((image) => Number.isInteger(image.bufferView) && !image.uri)
    ), JSON.stringify({ buffers: glb.json.buffers?.length, images: glb.json.images?.length }));
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
  const reactUiSource = readReactUiSource();
  const menuBarSource = readUtf8('src', 'components', 'MenuBar.js');
  const menuGroupSource = readUtf8('src', 'components', 'MenuGroup.js');
  const appCss = readUtf8('src', 'app.css');
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
    assert(`keyboard selector target exists ${keyCode}`, htmlHasButtonSelector(html, selector) || sourceHasSelector(reactUiSource, selector), selector);
  }

  for (const documentedShortcut of ['Ctrl+1', 'Ctrl+2', 'Ctrl+6', 'Ctrl+N', 'Ctrl+S', '`C` toggles', '`P` pauses', '`K` pauses', '`F` toggles', '`I` toggles', '`T` toggles', '`B` toggles', '`L` selects']) {
    assert(`README documents shortcut ${documentedShortcut}`, readme.includes(documentedShortcut));
  }

  assert('main menu renders nested submenu popovers', menuGroupSource.includes('menu-submenu-popover') && menuGroupSource.includes('aria-haspopup="menu"'));
  assert('main menu has quick-action aligned presets submenu', menuBarSource.includes("submenu('scene-quick-presets'") && menuBarSource.includes('preset-shader-showcase'));
  assert('main menu nests benchmark scenes', menuBarSource.includes("submenu('scene-benchmark-scenes'") && menuBarSource.includes('benchmarkParticleFluid'));
  assert('main menu nests panel toggles', menuBarSource.includes("submenu('view-panels'") && menuBarSource.includes("windowTarget: 'benchmark'"));
  assert('nested submenu CSS exists', appCss.includes('.menu-submenu-popover') && appCss.includes('.menu-submenu:hover > .menu-submenu-popover'));
};

const checkFloatingWindowContracts = () => {
  const source = readUtf8('src', 'components', 'FloatingWindow.js');
  const benchmarkSource = readUtf8('src', 'components', 'BenchmarkPanel.js');
  const html = readUtf8('index.html');
  const reactUiSource = readReactUiSource();
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

  for (const windowId of ['scene-tree-window', 'controls']) {
    assert(`React has floating window ${windowId}`, sourceHasSelector(reactUiSource, `#${windowId}`));
    assert(`HTML tombstones floating window ${windowId}`, html.includes(`react-migrated:${windowId}`));
  }
  assert('React has standing benchmark panel', sourceHasSelector(reactUiSource, '#benchmark') && benchmarkSource.includes('data-standing-panel'));
  assert('benchmark panel is not mounted as a floating window', !benchmarkSource.includes('<${FloatingWindow}'));
  assert(
    'standing benchmark panel has window controls',
    benchmarkSource.includes('data-window-command="collapse"') &&
      benchmarkSource.includes('data-window-command="close"') &&
      benchmarkSource.includes("setUiWindowVisible('benchmark', false)") &&
      benchmarkSource.includes('is-collapsed')
  );
  assert(
    'standing benchmark panel has drag controls',
    benchmarkSource.includes('data-window-drag-handle') &&
      benchmarkSource.includes('handlePointerDown') &&
      benchmarkSource.includes('handlePointerMove') &&
      benchmarkSource.includes('handlePointerUp') &&
      benchmarkSource.includes('ui:benchmark-panel-drag-end')
  );
  assert('HTML tombstones standing benchmark panel', html.includes('react-migrated:benchmark'));
  assert('React has drag handles', source.includes('data-window-drag-handle'));
  assert('React has collapse commands', source.includes('data-window-command="collapse"'));
  assert('React has close commands', source.includes('data-window-command="close"'));
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
    renderCanvasSource.includes('return applyRenderCanvasCssProperties(documentElement, width, height);') &&
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
  assert('active entrypoint loads React shell before legacy renderer', html.indexOf('src="src/main.jsx.js"') !== -1 && html.indexOf('src="src/main.jsx.js"') < html.indexOf('src="webgl-path-tracing.js"'));
  assert('active entrypoint still has fallback canvas', html.includes('<canvas id="canvas" width="512" height="512"></canvas>'));
  assert('React scaffold activates from ui-root dataset', (
    html.includes('<div id="ui-root" data-react-app-shell="active"></div>') &&
    mainSource.includes("rootElement.dataset.reactAppShell === 'active'") &&
    mainSource.includes("rootElement.dataset.reactMounted = mountOptions.active ? 'active' : 'inert';")
  ));
  assert('React scaffold keeps canvas compatibility opt-in', (
    mainSource.includes('AppScaffold({ active = false, includeCanvas = false, onCanvasReady })') &&
    mainSource.includes("rootElement.dataset.reactCanvas === 'active'")
  ));
  assert('legacy fallback writes canvas CSS custom properties through RenderCanvas helper', (
    legacyRendererSource.includes("import { applyRenderCanvasCssProperties } from './src/components/RenderCanvas.js';") &&
    legacyRendererSource.includes('const applyCanvasSizeToDocument = (documentObject, canvasElement) => {') &&
    legacyRendererSource.includes('applyRenderCanvasCssProperties(documentObject.documentElement, CANVAS_RENDER_WIDTH, CANVAS_RENDER_HEIGHT);')
  ));
  assert('legacy fallback avoids raw document root canvas CSS custom-property writes', (
    !/documentObject\.documentElement\.style\.setProperty\(\s*['"`]--canvas-/u.test(legacyRendererSource)
  ));
  assert('legacy fallback sizes the active canvas element', (
    legacyRendererSource.includes('canvasElement.width = CANVAS_RENDER_WIDTH;') &&
    legacyRendererSource.includes('canvasElement.height = CANVAS_RENDER_HEIGHT;')
  ));
  assert('legacy fallback avoids canvas inline CSS custom-property writes', (
    !/canvasElement\.style\.setProperty\(\s*['"`]--canvas-/u.test(legacyRendererSource)
  ));
};

const checkReactStaticMigrationContracts = async () => {
  const { MIGRATED_STATIC_SECTIONS } = await import(pathToFileURL(repoPath('src', 'components', 'migrationManifest.js')).href);
  const html = readUtf8('index.html');
  const reactUiSource = readReactUiSource();
  const mainSource = readUtf8('src', 'main.jsx.js');

  assert('migration manifest has migrated sections', Array.isArray(MIGRATED_STATIC_SECTIONS) && MIGRATED_STATIC_SECTIONS.length >= 5);
  assert('React app exports migration manifest', mainSource.includes('export { MIGRATED_STATIC_SECTIONS };'));
  assert('React app renders loading overlay', mainSource.includes('<${LoadingOverlay} />'));
  assert('index keeps only renderer compatibility canvas', html.includes('data-legacy-renderer-compat="canvas"'));

  for (const section of MIGRATED_STATIC_SECTIONS) {
    const sourcePath = repoPath(...section.source.split('/'));
    assert(`migration source exists ${section.id}`, existsSync(sourcePath), section.source);
    assert(`migration tombstone exists ${section.id}`, html.includes(section.tombstone), section.tombstone);
    assert(`migration component mounted ${section.component}`, mainSource.includes(section.component) || reactUiSource.includes(`function ${section.component}`), section.component);
    for (const selector of section.requiredSelectors) {
      assert(`migration selector ${section.id} ${selector}`, sourceHasSelector(reactUiSource, selector), selector);
    }
  }

  for (const removedStaticId of ['app-menu', 'loading-overlay', 'scene-tree-window', 'controls', 'benchmark']) {
    assert(
      `index removed static ${removedStaticId}`,
      !new RegExp(`<(?:nav|section|div)\\b[^>]*\\bid="${removedStaticId}"`, 'u').test(html),
      removedStaticId
    );
  }
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
  assert('store exports legacy application state binder', storeSource.includes('export const bindLegacyApplicationStateObject = bindApplicationStateObject;'));
  assert('store binder patches initial legacy state', /export const bindApplicationStateObject[\s\S]*patchApplicationState\(initialStatePatch, signals\);/u.test(storeSource));

  const benchmarkStoreSource = readUtf8('src', 'benchmarkStore.js');
  assert('benchmark store exports updateBenchmarkSignals', benchmarkStoreSource.includes('export const updateBenchmarkSignals'));
  assert('benchmark store exports gpu renderer setter', benchmarkStoreSource.includes('export const setBenchmarkGpuRenderer'));
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
    'gpuRenderer',
    'accumulatedSamples',
    'convergenceSampleCount',
    'estimatedGpuBufferMemoryBytes',
    'sceneComplexityScore',
    'benchmarkSceneLabel'
  ]) {
    assert(`benchmark store updates ${fieldName}`, benchmarkStoreSource.includes(fieldName));
  }

  const renderBridgeSource = readUtf8('src', 'renderBridge.js');
  assert('render bridge imports benchmark signal updater', renderBridgeSource.includes("import { updateBenchmarkSignals } from './benchmarkStore.js';"));
  assert('render bridge batches render-loop signal writes', renderBridgeSource.includes('batch(() =>'));
  assert('render bridge passes benchmark context', renderBridgeSource.includes('updateBenchmarkSignals(benchmarkSnapshot, {'));
  assert('render bridge owns render frame scheduling', (
    renderBridgeSource.includes('export const scheduleRenderFrame =') &&
    renderBridgeSource.includes('activeWindow.requestAnimationFrame(runScheduledFrame)') &&
    renderBridgeSource.includes('export const cancelScheduledRenderFrame =')
  ));
  assert('render bridge exposes WebGL render invocation', renderBridgeSource.includes('export const invokeWebGlRenderer ='));

  const legacyRendererSource = readUtf8('webgl-path-tracing.js');
  const updateGpuStatusBody = legacyRendererSource.match(
    /const updateGpuStatus = \(documentObject, webGlContext\) => \{([\s\S]*?)\n\};/u
  )?.[1] || '';
  const loggerSource = readUtf8('src', 'logger.js');
  const electronSmokeMainSource = readUtf8('scripts', 'electron-smoke-main.cjs');
  const electronSmokeCheckSource = readUtf8('scripts', 'electron-smoke-check.mjs');
  assert('logger exposes performance channel', (
    loggerSource.includes("'performance'") &&
    loggerSource.includes('export const performanceLogger = logger.performance;')
  ));
  assert(
    'legacy renderer imports benchmark signal updater',
    legacyRendererSource.includes('updateBenchmarkSignals') &&
      legacyRendererSource.includes("'./src/benchmarkStore.js'")
  );
  assert('legacy renderer imports signal effect', legacyRendererSource.includes("import { effect } from '@preact/signals';"));
  assert(
    'legacy renderer imports application state binder',
    legacyRendererSource.includes("import { bindLegacyApplicationStateObject } from './src/store.js';")
  );
  assert(
    'legacy application state is signal-bound',
    legacyRendererSource.includes('const createApplicationState = () => bindLegacyApplicationStateObject({')
  );
  assert(
    'legacy benchmark bridge updates signals at throttle point',
    /class BenchmarkSignalBridge[\s\S]*this\.previousUpdateMilliseconds = currentTimeMilliseconds;[\s\S]*updateBenchmarkSignals\(benchmarkSnapshot, \{/u.test(legacyRendererSource)
  );
  assert('legacy benchmark display class retired', !legacyRendererSource.includes('class BenchmarkDisplay'));
  assert(
    'legacy benchmark fallback binds DOM to signals',
    legacyRendererSource.includes('const attachLegacyBenchmarkSignalBindings = (documentObject) => (') &&
      legacyRendererSource.includes('LEGACY_BENCHMARK_SIGNAL_BINDINGS.map((binding) => effect(() => {')
  );
  assert(
    'legacy benchmark metrics avoid required DOM reads',
    !/readRequiredElement\(\s*documentObject,\s*['"`]benchmark-(performance-score|rays-per-second|ray-bandwidth|perceptual-fps|resolution|bounces|samples|convergence|gpu-memory|scene-complexity|gpu-renderer|source)['"`]/u.test(legacyRendererSource)
  );
  assert(
    'gpu status populates gpu renderer signal without DOM writes',
    updateGpuStatusBody.includes('setBenchmarkGpuRenderer(rendererLabel);') &&
      updateGpuStatusBody.includes('return returnSuccess(gpuInfo);') &&
      !/(?:textContent|classList\.toggle|\.title =)/u.test(updateGpuStatusBody)
  );
  assert('environment select change rebuilds even after signal sync', (
    /updateEnvironmentFromSelect\(\) \{[\s\S]*const nextEnvironment = Number\.parseInt\(this\.environmentSelect\.value, 10\);[\s\S]*this\.applicationState\.environment = nextEnvironment;[\s\S]*return this\.syncSceneObjectsToRendererAndPhysics\(\);/u.test(legacyRendererSource) &&
    !/updateEnvironmentFromSelect\(\) \{[\s\S]*this\.applicationState\.environment === nextEnvironment[\s\S]*return returnSuccess\(undefined\);/u.test(legacyRendererSource)
  ));
  assert('benchmark score has a fixed reference render pixel count', (
    legacyRendererSource.includes('PERFORMANCE_SCORE_REFERENCE_RENDER_PIXELS = DEFAULT_CANVAS_SIZE * DEFAULT_CANVAS_SIZE') &&
    legacyRendererSource.includes('renderPixelCount: ACTIVE_RAYS_PER_SAMPLE')
  ));
  assert('frame-estimated benchmark score is render-resolution normalized', (
    legacyRendererSource.includes('shouldNormalizePerformanceScoreForRenderResolution') &&
    legacyRendererSource.includes("measurementSource === 'frame-estimate'") &&
    legacyRendererSource.includes("measurementSource === 'frame-estimate-pending'") &&
    legacyRendererSource.includes('activeRaysPerSecond * PERFORMANCE_SCORE_REFERENCE_RENDER_PIXELS / renderPixelCount')
  ));
  assert('gpu-timer benchmark score keeps raw ray throughput', (
    /if \(!shouldNormalizePerformanceScoreForRenderResolution\(benchmarkSnapshot\.measurementSource\)\) \{\s*return activeRaysPerSecond;\s*\}/u.test(legacyRendererSource)
  ));
  assert('legacy render-loop scheduling routes through bridge', (
    legacyRendererSource.includes('scheduleRenderFrame(application.applicationState, renderFrame, { canvas: application.canvasElement })') &&
    legacyRendererSource.includes('return scheduleRenderFrame(applicationState);') &&
    legacyRendererSource.includes('return cancelScheduledRenderFrame(applicationState);') &&
    !legacyRendererSource.includes('requestAnimationFrame(applicationState.animationFrameCallback)') &&
    !legacyRendererSource.includes('cancelAnimationFrame(applicationState.animationFrameId)')
  ));
  assert('legacy WebGL render invocation routes through bridge', (
    legacyRendererSource.includes('invokeWebGlRenderer(this.pathTracer, applicationState)') &&
    !legacyRendererSource.includes('this.pathTracer.render(applicationState)')
  ));
  assert('electron smoke checks benchmark stall counters', (
    electronSmokeMainSource.includes('severeFrameStallCount') &&
    electronSmokeMainSource.includes('benchmark throttle reports frame pacing stall budget')
  ));
  assert('electron smoke checks deferred scene-load frame pacing', (
    electronSmokeMainSource.includes('const sceneLoadPacingScript =') &&
    electronSmokeMainSource.includes('scene load pacing completed deferred benchmark switch') &&
    electronSmokeMainSource.includes('scene load pacing yielded before shader compilation') &&
    electronSmokeMainSource.includes('scene load pacing reports shader compile stall budget')
  ));
  assert('electron smoke compiles Suzanne reference preset', (
    electronSmokeMainSource.includes("label: 'electron-root-suzanne-reference'") &&
    electronSmokeMainSource.includes("query: { preset: 'suzanneReference' }")
  ));
  assert('electron smoke prints performance summaries', electronSmokeCheckSource.includes('perf - ${summary.name}: frames='));
  assert('interactive quality throttle uses one ray per pixel', legacyRendererSource.includes('const INTERACTIVE_QUALITY_RAYS_PER_PIXEL = 1;'));
  assert('interactive quality throttle preserves configured bounces', (
    !legacyRendererSource.includes('INTERACTIVE_QUALITY_LIGHT_BOUNCE_COUNT') &&
    legacyRendererSource.includes('lightBounceCount: configuredLightBounceCount')
  ));
  assert('interactive quality throttle follows camera drag state', legacyRendererSource.includes('const isInteractiveQualityThrottleActive = Boolean(applicationState.isRotatingCamera);'));
  assert(
    'interactive quality throttle restore clears one-ray camera seed',
    legacyRendererSource.includes('clearInteractiveCameraSamplesError') &&
      /wasInteractiveQualityThrottleActive\s*&&\s*!isInteractiveQualityThrottleActive\s*&&\s*this\.hasInteractiveCameraMotionDisplayHistory[\s\S]*this\.clearSamples\(\)/u.test(legacyRendererSource)
  );
};

const checkBenchmarkSceneContracts = () => {
  const legacyRendererSource = readUtf8('webgl-path-tracing.js');
  const html = readUtf8('index.html');
  const reactUiSource = readReactUiSource();
  const appCss = readUtf8('src', 'app.css');

  assert('sponza atrium benchmark factory exists', legacyRendererSource.includes('const createBenchmarkSponzaAtriumSceneObjects'));
  assert('sponza atrium benchmark is default', legacyRendererSource.includes("const DEFAULT_BENCHMARK_SCENE_NAME = 'benchmarkSponzaAtrium';"));
  assert('sponza atrium benchmark registered', legacyRendererSource.includes('benchmarkSponzaAtrium: Object.freeze({'));
  assert('reference mesh scene object exists', legacyRendererSource.includes('class ReferenceMeshSceneObject'));
  assert('reference mesh shader intersection exists', legacyRendererSource.includes('const intersectTriangleSource = ['));
  assert('Suzanne reference preset registered', (
    legacyRendererSource.includes('suzanneReference: createSuzanneReferenceSceneObjects') &&
    legacyRendererSource.includes('suzanneReference: createDefaultSceneMetadata()') &&
    sourceHasSelector(reactUiSource, 'button[data-preset="suzanneReference"]')
  ));
  assert('Sponza benchmark tracks GLB reference metadata', (
    legacyRendererSource.includes('referenceAssetPath: SPONZA_GLB_REFERENCE_MODEL.assetPath') &&
    legacyRendererSource.includes('referenceTriangleCount: SPONZA_GLB_REFERENCE_MODEL.triangleCount')
  ));
  assert(
    'sponza atrium benchmark target settings',
    /benchmarkSponzaAtrium:[\s\S]*targetBounces:\s*8,[\s\S]*targetRaysPerPixel:\s*16/u.test(legacyRendererSource)
  );
  assert(
    'sponza atrium benchmark uses exact opening camera metadata',
    legacyRendererSource.includes('cameraEyePosition: Object.freeze([0, 0.3, 0])') &&
      legacyRendererSource.includes('cameraTargetPosition: Object.freeze([1, 0.2, 0])') &&
      legacyRendererSource.includes('cameraFieldOfViewDegrees: 65')
  );
  assert(
    'sponza atrium benchmark exposes lissajous tuning constants',
    legacyRendererSource.includes('const lissajousAmplitudeX = 0.45;') &&
      legacyRendererSource.includes('const lissajousAmplitudeY = 0.12;') &&
      legacyRendererSource.includes('const lissajousAmplitudeZ = 0.38;') &&
      legacyRendererSource.includes('const lissajousFreqX = 3 * 0.11;') &&
      legacyRendererSource.includes('const lissajousFreqY = 5 * 0.07;') &&
      legacyRendererSource.includes('const lissajousFreqZ = 7 * 0.09;')
  );
  assert(
    'sponza atrium benchmark keeps shader object budget capped',
    legacyRendererSource.includes('const SPONZA_ATRIUM_FLAGSTONE_BAND_COUNT = 4;') &&
      legacyRendererSource.includes('const SPONZA_ATRIUM_COLUMN_PAIR_COUNT = 3;') &&
      legacyRendererSource.includes('const SPONZA_ATRIUM_CURTAIN_PAIR_COUNT = 2;') &&
      !legacyRendererSource.includes('slabXIndex < 6') &&
      !legacyRendererSource.includes('columnIndex < 5')
  );
  assert('sponza atrium benchmark menu button exists', (
    htmlHasButtonSelector(html, 'button[data-benchmark-scene="benchmarkSponzaAtrium"]') ||
    sourceHasSelector(reactUiSource, 'button[data-benchmark-scene="benchmarkSponzaAtrium"]')
  ));
  assert(
    'scene menu loads release path tracer program before deferred compile',
    /releaseSceneProgram\(\) \{[\s\S]*deleteProgram\(this\.tracerProgram\)[\s\S]*this\.sceneObjects = \[\][\s\S]*webGlContext\.flush\(\)/u.test(legacyRendererSource) &&
      legacyRendererSource.includes('releaseSceneRendererResources()') &&
      legacyRendererSource.includes('const requestDeferredSceneLoad =') &&
      legacyRendererSource.includes('windowObject.requestAnimationFrame(queueAfterFrame)') &&
      legacyRendererSource.includes('windowObject.setTimeout(runLoadAction, 0)') &&
      /if \(presetName\) \{[\s\S]*requestDeferredSceneLoad/u.test(legacyRendererSource) &&
      /if \(benchmarkSceneName\) \{[\s\S]*requestDeferredSceneLoad/u.test(legacyRendererSource)
  );
  assert(
    'scene loading dialog lists offload and new asset steps',
    sourceHasSelector(reactUiSource, '#loading-overlay') &&
      sourceHasSelector(reactUiSource, '#loading-steps') &&
      legacyRendererSource.includes('const DEFERRED_SCENE_LOAD_STEPS = Object.freeze([') &&
      legacyRendererSource.includes('Offload the previous path-tracer shader program') &&
      legacyRendererSource.includes('Clear scene uniforms, texture bindings, and accumulation history') &&
      legacyRendererSource.includes('Load new scene assets and associated components') &&
      legacyRendererSource.includes('const updateDeferredSceneLoadDialog =') &&
      legacyRendererSource.includes('const writeLoadingSteps =') &&
      appCss.includes('.loading-step[data-step-state="running"]') &&
      appCss.includes('.loading-step[data-step-state="done"]') &&
      appCss.includes('.loading-step[data-step-state="error"]')
  );
  assert(
    'benchmark lighting outliers are toned down',
    !legacyRendererSource.includes('skyBrightness: 2.65') &&
      !legacyRendererSource.includes('skyBrightness: 2.35') &&
      !legacyRendererSource.includes('skyBrightness: 2.0') &&
      !legacyRendererSource.includes('bloomStrength: 0.82') &&
      !legacyRendererSource.includes('glareStrength: 0.42') &&
      !legacyRendererSource.includes('lightIntensity: 0.92')
  );
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
  assert('particle fluid benchmark menu button exists', (
    htmlHasButtonSelector(html, 'button[data-benchmark-scene="benchmarkParticleFluid"]') ||
    sourceHasSelector(reactUiSource, 'button[data-benchmark-scene="benchmarkParticleFluid"]')
  ));
  assert('particle fluid benchmark controls exist', (
    sourceHasSelector(reactUiSource, '#particle-fluid-controls') &&
    sourceHasSelector(reactUiSource, '#particle-fluid-count') &&
    sourceHasSelector(reactUiSource, '#particle-fluid-radius') &&
    sourceHasSelector(reactUiSource, '#particle-fluid-stiffness') &&
    sourceHasSelector(reactUiSource, 'button[data-action="apply-particle-fluid-settings"]')
  ));
};

const checkPhysicsJointContracts = () => {
  const legacyRendererSource = readUtf8('webgl-path-tracing.js');
  const reactUiSource = readReactUiSource();
  const decisions = readUtf8('docs', 'workstream-decisions.md');

  assert('spring joint fallback controls exist', (
    sourceHasSelector(reactUiSource, '#selected-physics-spring-connect-controls') &&
    sourceHasSelector(reactUiSource, '#selected-physics-spring-rest-length') &&
    sourceHasSelector(reactUiSource, '#selected-physics-spring-stiffness') &&
    sourceHasSelector(reactUiSource, '#selected-physics-spring-damping') &&
    sourceHasSelector(reactUiSource, 'button[data-action="connect-selected-spring"]')
  ));
  assert('spring joint connected list exists', (
    sourceHasSelector(reactUiSource, '#selected-physics-joints-section') &&
    sourceHasSelector(reactUiSource, '#selected-physics-joint-list')
  ));
  assert('spring joints use two selected physics objects', (
    legacyRendererSource.includes('readSelectedPhysicsJointObjects()') &&
    legacyRendererSource.includes('selectedObjects.length !== 2') &&
    legacyRendererSource.includes('isPhysicsSpringJointSelectableSceneObject')
  ));
  assert('spring joints create Rapier spring data', (
    legacyRendererSource.includes('JointData.spring') &&
    legacyRendererSource.includes('connectSelectedPhysicsSpringJointFromControls')
  ));
  assert('spring joints record handles on both endpoints', (
    legacyRendererSource.includes('writePhysicsSpringJointHandleToObjectRecord(') &&
    legacyRendererSource.includes('jointHandle') &&
    legacyRendererSource.includes('impulseJoint')
  ));
  assert('spring joints remove through Rapier', (
    legacyRendererSource.includes('removeSpringJoint(jointRecord)') &&
    legacyRendererSource.includes('removeImpulseJoint') &&
    legacyRendererSource.includes('removeSelectedPhysicsJoint')
  ));
  assert('spring joints annotate fallback scene tree', (
    legacyRendererSource.includes('formatSceneObjectSpringJointSceneTreeAnnotation') &&
    legacyRendererSource.includes('[spring selection]')
  ));
  assert('spring joint decision note exists', decisions.includes('## Physics Spring Joints'));
};

const checkPhysicsHotPathContracts = () => {
  const legacyRendererSource = readUtf8('webgl-path-tracing.js');

  assert('physics rebuild dirty flag helper exists', (
    legacyRendererSource.includes('SCENE_OBJECT_PHYSICS_REBUILD_DIRTY_FLAG') &&
    legacyRendererSource.includes('markSceneObjectPhysicsRebuildDirty(this)') &&
    legacyRendererSource.includes('isSceneObjectPhysicsRebuildDirty(sceneObject)')
  ));
  assert('physics incremental rebuild plan exists', (
    legacyRendererSource.includes('createIncrementalRebuildPlan(sceneObjects, applicationState)') &&
    legacyRendererSource.includes('rebuildSceneIncrementally(sceneObjects, applicationState, rebuildPlan)') &&
    legacyRendererSource.includes('previous-body-not-removable') &&
    legacyRendererSource.includes('spring-joints-configured')
  ));
  assert('physics awake cache avoids repeated sleep scans', (
    legacyRendererSource.includes('hasKnownAwakeDynamicPhysicsObjects') &&
    legacyRendererSource.includes('isDynamicPhysicsAwakeCacheDirty') &&
    legacyRendererSource.includes('awakeDynamicPhysicsSleepScanCount') &&
    /hasAwakeDynamicPhysicsObjects\(\) \{[\s\S]*if \(!this\.isDynamicPhysicsAwakeCacheDirty\)/u.test(legacyRendererSource)
  ));
  assert('physics Rapier collision event queue feeds awake cache', (
    legacyRendererSource.includes('new this.rapierRuntime.EventQueue(true)') &&
    legacyRendererSource.includes('this.world.step(this.collisionEventQueue)') &&
    legacyRendererSource.includes('drainCollisionEvents') &&
    legacyRendererSource.includes('ActiveEvents.COLLISION_EVENTS')
  ));
  assert('physics worker shared memory scaffold documents isolation headers', (
    legacyRendererSource.includes('createRapierPhysicsWorkerCapability') &&
    legacyRendererSource.includes('createRapierPhysicsWorkerSharedStepState') &&
    legacyRendererSource.includes('SharedArrayBuffer') &&
    legacyRendererSource.includes('Atomics.store') &&
    legacyRendererSource.includes('Cross-Origin-Opener-Policy: same-origin') &&
    legacyRendererSource.includes('Cross-Origin-Embedder-Policy: require-corp')
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

const checkMaterialPresetTextureContracts = () => {
  const storeSource = readUtf8('src', 'store.js');
  const materialComponentSource = readUtf8('src', 'components', 'MaterialComponent.js');
  const objectPanelSource = readUtf8('src', 'components', 'panels', 'ObjectPanel.js');
  const rendererSource = readUtf8('webgl-path-tracing.js');
  const decisions = readUtf8('docs', 'workstream-decisions.md');

  assert(
    'material projection renderer mirror parity',
    fileHash(repoPath('webgl-path-tracing.js')) === fileHash(repoPath('docs', 'webgl-path-tracing.js')),
    'webgl-path-tracing.js differs from docs/webgl-path-tracing.js'
  );
  assert('material presets store default library', storeSource.includes('export const DEFAULT_SAVED_MATERIAL_PRESETS'));
  assert('material presets store active id signal', storeSource.includes('activeMaterialPresetId'));
  assert('material presets store save helper', storeSource.includes('export const saveMaterialPreset'));
  assert('material presets store apply helper', storeSource.includes('export const applyMaterialPreset'));
  assert('material texture store channel list', storeSource.includes('export const MATERIAL_TEXTURE_CHANNELS'));
  assert('material texture store assignment setter', storeSource.includes('export const setMaterialTextureAssignment'));
  assert('material texture store swap helper', storeSource.includes('export const swapMaterialTextureAssignments'));
  for (const textureChannel of ['albedo', 'normal', 'metallicRoughness', 'emissive', 'ambientOcclusion']) {
    assert(`material texture channel ${textureChannel}`, storeSource.includes(`key: '${textureChannel}'`));
  }
  assert('material projection store exposes modes', (
    storeSource.includes('MATERIAL_UV_PROJECTION_MODES') &&
    materialComponentSource.includes("key: 'uv'") &&
    materialComponentSource.includes("key: 'tri-planar'")
  ));
  assert('material projection store exposes setters', (
    storeSource.includes('export const setMaterialUvProjectionMode') &&
    storeSource.includes('export const setMaterialUvScale') &&
    storeSource.includes('export const setMaterialUvBlendSharpness')
  ));

  assert('object panel imports material preset helpers', objectPanelSource.includes('saveMaterialPreset') && objectPanelSource.includes('applyMaterialPreset'));
  assert('object panel exposes preset controls', objectPanelSource.includes('data-material-preset-controls'));
  assert('object panel exposes apply preset action', objectPanelSource.includes('data-action="apply-material-preset"'));
  assert('object panel exposes save preset action', objectPanelSource.includes('data-action="save-material-preset"'));
  assert('object panel exposes texture controls', objectPanelSource.includes('data-material-texture-controls'));
  assert('object panel exposes texture file input', objectPanelSource.includes('id="material-texture-file"'));
  assert('object panel exposes texture assign action', objectPanelSource.includes('data-action="assign-material-texture"'));
  assert('object panel exposes texture swap action', objectPanelSource.includes('data-action="swap-material-textures"'));
  assert('object panel exposes texture clear action', objectPanelSource.includes('data-action="clear-material-texture"'));
  assert('object panel tags texture channels', objectPanelSource.includes('data-texture-channel'));
  assert('object panel exposes UV projection controls', (
    objectPanelSource.includes('id="material-uv-projection-mode"') &&
    objectPanelSource.includes('setMaterialUvProjectionMode') &&
    objectPanelSource.includes('id="material-uv-scale"') &&
    objectPanelSource.includes('id="material-uv-blend-sharpness"')
  ));

  assert('tri-planar projection shader samples material albedo texture', (
    rendererSource.includes('uniform sampler2D materialAlbedoTexture') &&
    rendererSource.includes('createProceduralMaterialAlbedoTexture') &&
    rendererSource.includes('sampleTriplanarAlbedo(') &&
    rendererSource.includes('materialAlbedoTexture,')
  ));
  assert('tri-planar projection shader computes axis weights', (
    rendererSource.includes('vec3 shaderTriplanarWeights') &&
    rendererSource.includes('pow(max(abs(normal)') &&
    rendererSource.includes('axisWeights.x + axisWeights.y + axisWeights.z')
  ));
  assert('tri-planar projection participates in object shader source', (
    rendererSource.includes('createMaterialTextureShaderSource') &&
    rendererSource.includes('composeObjectSurfaceShaderSource') &&
    rendererSource.includes('sceneObjectUsesSurfaceShaderUtilities')
  ));
  assert('tri-planar projection serializes scene material metadata', (
    rendererSource.includes('objectSnapshot.textureProjection =') &&
    rendererSource.includes('textureProjectionSnapshot') &&
    rendererSource.includes('uvBlendSharpness')
  ));

  assert('decisions document material presets and texture assignments', decisions.includes('## Material Presets And Texture Assignment'));
  assert('decisions document tri-planar projection', decisions.includes('## Material Texture Projection'));
};

const checkRendererPostProcessContracts = () => {
  const rendererSource = readUtf8('webgl-path-tracing.js');
  const docsRendererPath = repoPath('docs', 'webgl-path-tracing.js');

  assert(
    'postprocess renderer mirror parity',
    fileHash(repoPath('webgl-path-tracing.js')) === fileHash(docsRendererPath),
    'webgl-path-tracing.js differs from docs/webgl-path-tracing.js'
  );
  assert('draft postprocess detects draft preset state', (
    rendererSource.includes('const isDraftQualityPresetState') &&
    rendererSource.includes('QUALITY_PRESET_STATE_KEYS.every') &&
    rendererSource.includes('QUALITY_PRESETS.draft[stateKey]')
  ));
  const draftPostProcessBypassMatch = rendererSource.match(
    /const shouldUseDraftPostProcessBypass = \(applicationState\) => \(([\s\S]*?)\);/u
  );
  assert('draft postprocess does not darken camera drag', (
    draftPostProcessBypassMatch !== null &&
    draftPostProcessBypassMatch[1].includes('isDraftQualityPresetState(applicationState)') &&
    !draftPostProcessBypassMatch[1].includes('isRotatingCamera')
  ));
  assert('draft postprocess skips temporal texture pass', (
    /readRenderTexture\(applicationState\) \{[\s\S]*shouldUseDraftPostProcessBypass\(applicationState\)[\s\S]*this\.hasDisplayHistory = false;[\s\S]*return this\.textureSuccessResults\[this\.currentTextureIndex\];/u
      .test(rendererSource)
  ));
  assert('accumulation textures prefer full float before half-float fallback', (
    /const readRenderTextureTypes = \(webGlContext\) => \{\s*const textureTypes = \[\];\s*if \(webGlContext\.getExtension\('OES_texture_float'\)\) \{\s*textureTypes\.push\(webGlContext\.FLOAT\);\s*\}\s*const halfFloatTextureExtension = webGlContext\.getExtension\('OES_texture_half_float'\);[\s\S]*textureTypes\.push\(halfFloatTextureExtension\.HALF_FLOAT_OES\);[\s\S]*textureTypes\.push\(webGlContext\.UNSIGNED_BYTE\);/u
      .test(rendererSource)
  ));
  assert('accumulation blend keeps an unbiased running average', (
    rendererSource.includes('gl_FragColor = vec4(mix(calculateColor(rayOrigin, rayDirection, newLight), texture, textureWeight), 1.0);') &&
      rendererSource.includes('webGlContext.uniform1f(locations.textureWeight, sampleCount / nextSampleCount);') &&
      rendererSource.includes('sampleUniformValues.textureWeight = this.sampleCount / nextSampleCount;')
  ));
  assert('temporal display remains sample-count neutral after raw accumulation updates', (
    !rendererSource.includes('shouldBypassSettledTemporalDisplay') &&
    !rendererSource.includes('TEMPORAL_DISPLAY_SETTLED_SAMPLE_FLOOR') &&
    !rendererSource.includes('accumulationDenoiseTrust') &&
    !rendererSource.includes('accumulationProgress') &&
    rendererSource.includes('float temporalDenoiseAmount = smoothstep(1.0, 32.0, temporalBlendFrames) * denoiserStrength;') &&
    rendererSource.includes('float motionBlend = clamp(motionBlurStrength, 0.0, 0.95) * historyAvailability;') &&
    rendererSource.includes('float historyWeight = temporalWindow * historyAvailability * ageRamp;')
  ));
  assert('temporal display is evaluated once per accumulation state', (
    rendererSource.includes('hasCurrentTemporalDisplayTexture(temporalBlendFrames, motionBlurStrength, denoiserStrength)') &&
      /if \(this\.hasCurrentTemporalDisplayTexture\(\s*temporalBlendFrames,\s*motionBlurStrength,\s*denoiserStrength\s*\)\) \{\s*return this\.displayTextureSuccessResults\[this\.currentDisplayTextureIndex\];\s*\}/u.test(rendererSource) &&
      rendererSource.includes('this.lastTemporalDisplayInputSampleCount = this.sampleCount;') &&
      rendererSource.includes('this.lastTemporalDisplayInputTextureIndex = this.currentTextureIndex;') &&
      rendererSource.includes('resetTemporalDisplayCache()')
  ));
  assert('temporal display pass stays enabled for denoiser-only mode', (
    /shouldUseTemporalDisplayPass\(temporalBlendFrames, motionBlurStrength, denoiserStrength\) \{[\s\S]*denoiserStrength > MIN_DENOISER_STRENGTH/u
      .test(rendererSource)
  ));
  assert('temporal history ramps over configured blend frames', (
    rendererSource.includes('readTemporalFrameAge(temporalBlendFrames)') &&
    rendererSource.includes('temporalBlendFrames * samplesPerDisplayFrame') &&
    rendererSource.includes('temporalUniformValues.temporalFrameAge = this.readTemporalFrameAge(temporalBlendFrames);')
  ));
  assert('static temporal history stops before long convergence accumulation', (
    rendererSource.includes('readTemporalHistoryAvailability(temporalBlendFrames, motionBlurStrength)') &&
      rendererSource.includes('if (motionBlurStrength > MIN_MOTION_BLUR_STRENGTH) {') &&
      rendererSource.includes('const temporalHistorySamples = Math.max(samplesPerDisplayFrame, temporalBlendFrames * samplesPerDisplayFrame);') &&
      rendererSource.includes('return this.sampleCount <= temporalHistorySamples ? 1 : 0;') &&
      rendererSource.includes('temporalUniformValues.historyAvailability = this.readTemporalHistoryAvailability(')
  ));
  assert('temporal display preserves luminance while using history', (
    rendererSource.includes('float luminanceCorrection = clamp(targetLuminance / filteredLuminance, 0.5, 2.0);') &&
    rendererSource.includes('return temporallyFilteredColor * mix(1.0, luminanceCorrection, luminancePreservation);')
  ));
  assert('temporal spatial denoise preserves current luminance', (
    rendererSource.includes('float currentLuminance = max(currentYCoCg.x, 0.0001);') &&
      rendererSource.includes('float stabilizedLuminance = max(rgbToYCoCg(stabilizedCurrentColor).x, 0.0001);') &&
      rendererSource.includes('stabilizedCurrentColor *= clamp(currentLuminance / stabilizedLuminance, 0.5, 2.0);')
  ));
  const readRenderTextureFunctionMatch = rendererSource.match(
    /readRenderTexture\(applicationState\) \{([\s\S]*?)\n  renderTemporalDisplayTexture/u
  );
  assert('convergence target only controls pause state and benchmark progress', (
    readRenderTextureFunctionMatch !== null &&
      !readRenderTextureFunctionMatch[1].includes('convergenceSampleCount') &&
      rendererSource.includes('benchmarkSnapshot.convergenceProgress = clampNumber(sampleCount / convergenceSampleCount, 0, 1);') &&
      /applicationState\.isConvergencePauseEnabled\s*&&\s*this\.sampleCount >= applicationState\.convergenceSampleCount/u
        .test(rendererSource)
  ));
  assert('continuous motion history clears on first still frame', (
    rendererSource.includes('settleContinuousMotionDisplayHistory(didRenderMotionThisFrame)') &&
      rendererSource.includes('this.hasContinuousMotionDisplayHistory = true;') &&
      /if \(!this\.hasContinuousMotionDisplayHistory\) \{\s*return returnSuccess\(false\);\s*\}[\s\S]*const \[, clearError\] = this\.clearSamples\(\);/u.test(rendererSource) &&
      rendererSource.includes('const didRenderMotionThisFrame = Boolean(') &&
      rendererSource.includes('didAutoRotateCamera') &&
      rendererSource.includes('didAnimateScene') &&
      rendererSource.includes('didCycleLightIntensity')
  ));
  assert('bounce-count shader rebuild clears stale accumulation immediately', (
    /scheduleShaderRebuildFromInput\(statusText = 'Compiling shaders\.\.\.'\) \{[\s\S]*const \[, clearPendingSamplesError\] = this\.selectionRenderer\.pathTracer\.clearSamples\(\);[\s\S]*this\.shaderRebuildInputTimerId = windowObject\.setTimeout/u
      .test(rendererSource)
  ));
  assert('pearlescent opal shader avoids NaN fireflies', (
    rendererSource.includes('vec3 shaderSafeNormalize(vec3 value, vec3 fallback)') &&
    rendererSource.includes('float shaderSaturate(float value)') &&
    rendererSource.includes('vec3 pearlViewDirection = shaderSafeNormalize(origin - hit, normal);') &&
    rendererSource.includes('float pearlAngle = pow(1.0 - shaderSaturate(dot(pearlViewDirection, normal)), 1.7);') &&
    rendererSource.includes('float pearlSpecularBase = shaderSaturate(dot(pearlReflectedLight, -pearlViewDirection));')
  ));
  assert('temporal history depends on actual camera-change invalidation', (
    !rendererSource.includes('shouldUseTemporalHistory(applicationState)') &&
    rendererSource.includes('temporalUniformValues.historyAvailability = this.readTemporalHistoryAvailability(') &&
    /if \(didCameraChange\) \{[\s\S]*const \[, clearCameraSamplesError\] = this\.clearSamples\(\);/u.test(rendererSource)
  ));
  assert('manual camera press preserves valid temporal history until movement', (
    /applicationState\.isRotatingCamera = !didSelectObject;[\s\S]{0,160}event\.preventDefault\(\);/u.test(rendererSource) &&
      !/applicationState\.isRotatingCamera = !didSelectObject;[\s\S]{0,160}clearDisplayHistory\(\)/u.test(rendererSource)
  ));
  assert('manual camera drag release clears interactive seed only after movement', (
    rendererSource.includes('this.hasInteractiveCameraMotionDisplayHistory = false;') &&
      /wasInteractiveQualityThrottleActive\s*&&\s*!isInteractiveQualityThrottleActive\s*&&\s*this\.hasInteractiveCameraMotionDisplayHistory[\s\S]*const \[, clearInteractiveCameraSamplesError\] = this\.clearSamples\(\);/u.test(rendererSource) &&
      /if \(isInteractiveQualityThrottleActive\) \{\s*this\.hasInteractiveCameraMotionDisplayHistory = true;\s*\}/u.test(rendererSource)
  ));
  assert('camera playback pause preserves temporal display history', (
    /toggleCameraAutoRotation\(toggleButton\) \{[\s\S]*this\.applicationState\.isCameraAutoRotating = !this\.applicationState\.isCameraAutoRotating;[\s\S]*updateCameraAutoRotationButton/u
      .test(rendererSource) &&
      !/toggleCameraAutoRotation\(toggleButton\) \{[\s\S]*this\.applicationState\.isCameraAutoRotating = !this\.applicationState\.isCameraAutoRotating;[\s\S]*clearDisplayHistory\(\)/u
        .test(rendererSource)
  ));
  assert('draft postprocess disables bloom and glare shader taps', (
    rendererSource.includes('const effectiveBloomStrength = shouldBypassDraftPostProcess ? 0 : applicationState.bloomStrength;') &&
    rendererSource.includes('const effectiveGlareStrength = shouldBypassDraftPostProcess ? 0 : applicationState.glareStrength;') &&
    rendererSource.includes('renderUniformValues.bloomStrength = effectiveBloomStrength;') &&
    rendererSource.includes('renderUniformValues.glareStrength = effectiveGlareStrength;')
  ));
  assert('draft postprocess logs bypass mode', (
    rendererSource.includes("postProcessMode: shouldBypassDraftPostProcess ? 'draft-bypass' : 'full'")
  ));
};

const checkTodoEvidence = () => {
  const readme = readFileSync(repoPath('README.md'), 'utf8');
  const changelog = readFileSync(repoPath('CHANGELOG.md'), 'utf8');
  const todos = readFileSync(repoPath('TODOS.md'), 'utf8');
  const verificationSmoke = readFileSync(repoPath('docs', 'verification-smoke.md'), 'utf8');
  const packageJson = JSON.parse(readFileSync(repoPath('package.json'), 'utf8'));
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
  const ws9Section = extractMarkdownSection(todos, '## Workstream 9: JS Performance (CPU-Side Hot Path Fixes)');
  const deferredPerformanceSection = extractMarkdownSection(todos, '## Deferred Performance And React Runtime Follow-Ups');

  assert('evidence README documents loader scaffold', readme.includes('OBJ/MTL, STL, PLY, glTF 2.0 JSON'));
  assert('evidence README documents import coordinator', readme.includes('src/importers'));
  assert('evidence README links workstream decisions', readme.includes('docs/workstream-decisions.md'));
  assert('evidence README documents WS9 performance work', readme.includes('CPU-side performance work is tracked as WS9'));
  assert('evidence README documents Pages deploy smoke', readme.includes('npm run test:pages-deploy') && readme.includes('/pathtracer/'));
  assert('evidence decisions doc exists', existsSync(decisionsPath));
  assert('evidence ECS scene model doc exists', existsSync(ecsPath));
  assert('evidence decisions cover imported assets', decisions.includes('## Imported Assets'));
  assert('evidence decisions cover renderer backends', decisions.includes('## Renderer Backends'));
  assert('evidence decisions cover canvas export', decisions.includes('## Canvas Export'));
  assert('evidence decisions cover WS9 closure', decisions.includes('## WS9 Performance Closure'));
  assert('evidence decisions document deferred runtime work', decisions.includes('Deferred Performance And React Runtime Follow-Ups'));
  assert('evidence verification documents migration validation', verificationSmoke.includes('WS9 migration validation'));
  assert('evidence verification documents Pages deploy smoke', verificationSmoke.includes('npm run test:pages-deploy') && verificationSmoke.includes('GitHub Pages project URL'));
  assert('evidence verification documents performance coverage', verificationSmoke.includes('CPU-side performance contracts'));
  assert('evidence package default test runs Pages deploy smoke', packageJson.scripts?.test?.includes('npm run test:pages-deploy'));
  assert('evidence WS9 TODO section exists', ws9Section.includes('### DOM and Display') && ws9Section.includes('### Migration Sequence and Validation'));
  assert('evidence WS9 has no unchecked TODOs', !/^- \[ \]/mu.test(ws9Section));
  assert('evidence deferred performance follow-ups remain open', (
    deferredPerformanceSection.includes('SharedArrayBuffer') &&
    deferredPerformanceSection.includes('BenchmarkDisplay') &&
    /^- \[ \]/mu.test(deferredPerformanceSection)
  ));
  assert('evidence changelog notes workstream decisions', changelog.includes('Add workstream decision notes'));
  assert('evidence changelog notes loader scaffold', changelog.includes('Add OBJ/MTL, STL, and PLY parser modules plus loader smoke samples'));
  assert('evidence changelog notes GLTF/GLB APIs', changelog.includes('Document the GLTF/GLB loader APIs'));
  assert('evidence changelog notes WS9 closure', changelog.includes('Close WS9 validation and TODO audit'));
  assert('evidence WS9 caches action toggle queries', legacyRenderer.includes('this.actionToggleButtonCache = new Map();') && legacyRenderer.includes('getActionToggleButtons(actionName)'));
  assert('evidence WS9 guards control value writes', legacyRenderer.includes('syncIntegerControlFromState(inputElement, valueElement, value)') && legacyRenderer.includes('if (inputElement.value !== nextValue)'));
  assert('evidence WS9 caches element text writes', legacyRenderer.includes('const ELEMENT_TEXT_CACHE = new WeakMap();') && legacyRenderer.includes('ELEMENT_TEXT_CACHE.get(element) === nextText'));
  assert('evidence WS9 reuses benchmark samples', legacyRenderer.includes('static createReusableSample()') && legacyRenderer.includes('static createSampleBuffer(sampleCapacity)') && legacyRenderer.includes('this.samples[(this.sampleStartIndex + this.sampleCount) % this.samples.length]'));
  assert('evidence WS9 prunes benchmark samples only when needed', legacyRenderer.includes('shouldPruneOldEntries(currentTimeMilliseconds)') && legacyRenderer.includes('pruneOldEntriesIfNeeded(currentTimeMilliseconds)'));
  assert('evidence WS9 throttles benchmark update before snapshot formatting', legacyRenderer.includes('this.previousFrameSnapshotMilliseconds > 0') && legacyRenderer.includes('timestampMilliseconds - this.previousFrameSnapshotMilliseconds < BENCHMARK_UPDATE_INTERVAL_MILLISECONDS'));
  assert('evidence WS9 caches WebGL program binds', legacyRenderer.includes('const ACTIVE_WEBGL_PROGRAMS = new WeakMap();') && legacyRenderer.includes('const useWebGlProgramIfNeeded = (webGlContext, program) =>'));
  assert('evidence WS9 guards tracer frame scalar uniforms', legacyRenderer.includes('haveTracerFrameScalarUniformsChanged(') && legacyRenderer.includes('this.previousTracerFrameScalarUniformValues'));
  assert('evidence WS9 uses entity keyed scene tree diff', legacyRenderer.includes('this.sceneTreeButtons = new Map();') && legacyRenderer.includes('itemButton.dataset.sceneEntityId = entityId'));
  assert('evidence WS9 uses constructor display-name cache', legacyRenderer.includes('const SCENE_OBJECT_DISPLAY_NAMES = new Map();') && legacyRenderer.includes('SCENE_OBJECT_DISPLAY_NAMES.set(constructorFunction, displayName)'));
  assert('evidence material component exists', existsSync(materialComponentPath) && existsSync(docsMaterialComponentPath));
  assert('evidence material component mirror parity', fileHash(materialComponentPath) === fileHash(docsMaterialComponentPath));
  assert('evidence physics component exists', existsSync(physicsComponentPath) && existsSync(docsPhysicsComponentPath));
  assert('evidence physics component mirror parity', fileHash(physicsComponentPath) === fileHash(docsPhysicsComponentPath));
  assert('evidence renderer mirror parity', fileHash(repoPath('webgl-path-tracing.js')) === fileHash(docsLegacyRendererPath));
  assert('evidence renderer imports material component', (
    legacyRenderer.includes("from './src/components/MaterialComponent.js';") &&
    legacyRenderer.includes('DEFAULT_MATERIAL_GLOSSINESS') &&
    legacyRenderer.includes('MaterialComponent')
  ));
  assert('evidence renderer imports physics component', legacyRenderer.includes("import { PhysicsComponent } from './src/components/PhysicsComponent.js';"));
  assert('evidence renderer uses material component storage', legacyRenderer.includes('this.materialComponent = createSceneObjectMaterialComponent(material);'));
  assert('evidence renderer uses physics component storage', legacyRenderer.includes('this.physicsComponent = createSceneObjectPhysicsComponent({'));
  assert('evidence renderer preserves material accessor', legacyRenderer.includes('return ensureSceneObjectMaterialComponent(this).material;'));
  assert('evidence renderer preserves physics rigid body accessor', legacyRenderer.includes('return ensureSceneObjectPhysicsComponent(this).physicsRigidBody;'));
  assert('evidence renderer stores selected entity id', legacyRenderer.includes('this.selectedEntityId = null;') && legacyRenderer.includes('this.selectedEntityIds = Object.freeze([]);'));
  assert('evidence renderer resolves selection by entity id', legacyRenderer.includes('resolveSelectedObject(sceneObjects = this.sceneObjects)') && legacyRenderer.includes('findSceneObjectByEntityId(sceneObjects, this.selectedEntityId)'));
  assert('evidence renderer syncs sceneStore selection signal', legacyRenderer.includes('sceneStoreSelectedItemId') && legacyRenderer.includes('setSceneStoreSelectedItemIds(this.selectedEntityIds, this.selectedEntityId)'));
  assert('evidence renderer supports viewport modifier selection', legacyRenderer.includes('handleCanvasPress(xPosition, yPosition, selectionOptions = {})') && legacyRenderer.includes('isRangeSelection: event.shiftKey') && legacyRenderer.includes('isToggleSelection: event.ctrlKey || event.metaKey'));
  assert('evidence renderer supports tree modifier selection', legacyRenderer.includes('sceneEntityId !== undefined') && legacyRenderer.includes('uiController.selectSceneObjectByEntityId(') && legacyRenderer.includes('selectSceneObjectByIndex('));
  assert('evidence renderer keys tree buttons by entity id', legacyRenderer.includes('this.sceneTreeButtons = new Map();') && legacyRenderer.includes('itemButton.dataset.sceneEntityId = entityId'));
  assert('evidence renderer orders tree by ECS parent ids', legacyRenderer.includes('createSceneTreeDisplayEntries') && legacyRenderer.includes('childrenByParentEntityId') && legacyRenderer.includes('parentObject.childEntityIds'));
  assert('evidence renderer defines runtime GroupEntity', legacyRenderer.includes('class GroupEntity') && legacyRenderer.includes("this.sceneItemKind = 'group';") && legacyRenderer.includes('this.childEntityIds = childEntityIds;'));
  assert('evidence renderer defines group renderability guards', legacyRenderer.includes('const isGroupEntitySceneObject = (sceneObject) =>') && legacyRenderer.includes('const isRenderableSceneObject = (sceneObject) =>') && legacyRenderer.includes('!isGroupEntitySceneObject(sceneObject)'));
  assert('evidence renderer shader joins skip groups', /const joinObjectShaderCode = \(sceneObjects, readShaderCode\) => \{[\s\S]*if \(!isRenderableSceneObject\(sceneObject\)\) \{[\s\S]*continue;[\s\S]*shaderParts\.push\(readShaderCode\(sceneObject\)\);/u.test(legacyRenderer));
  assert('evidence selection renderer traces renderable visible objects', /class SelectionRenderer[\s\S]*setObjects\(sceneObjects, renderSettings\) \{[\s\S]*const visibleSceneObjects = sceneObjects\.filter\(\(sceneObject\) => \([\s\S]*!sceneObject\.isHidden[\s\S]*isRenderableSceneObject\(sceneObject\)[\s\S]*this\.pathTracer\.setObjects\(visibleSceneObjects, renderSettings\)/u.test(legacyRenderer));
  assert('evidence renderer serializes group hierarchy ids', /if \(type === 'group'\) \{[\s\S]*entityId: readSceneObjectEntityId\(sceneObject\),[\s\S]*childEntityIds: normalizeSceneEntityIdList\(sceneObject\.childEntityIds\),[\s\S]*const parentEntityId = readSceneObjectParentEntityId\(sceneObject\);[\s\S]*objectSnapshot\.parentEntityId = parentEntityId;/u.test(legacyRenderer));
  assert('evidence renderer loads group scene objects', /if \(objectType === 'group'\) \{[\s\S]*const groupEntity = new GroupEntity\(\{[\s\S]*childEntityIds: objectSnapshot\.childEntityIds,[\s\S]*return applySceneObjectSnapshotIdentityFields\(groupEntity, objectSnapshot\);/u.test(legacyRenderer));
  assert('evidence renderer syncs sceneStore scene items', legacyRenderer.includes('setSceneItems as setSceneStoreSceneItems') && /setSceneObjects\(sceneObjects\) \{[\s\S]*syncSceneGroupEntityChildren\(this\.sceneObjects\);[\s\S]*setSceneStoreSceneItems\(this\.sceneObjects\);/u.test(legacyRenderer));
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
  const isNear = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) <= epsilon;

  assert('scene store smoke creates GroupEntity', result.groupEntityClassName === 'GroupEntity', JSON.stringify(result));
  assert('scene store smoke records group id', result.groupId === 'group-test', JSON.stringify(result));
  assert('scene store smoke groups selected children', result.groupedChildCount === 2 && result.groupedChildEntityIds.join(',') === 'sphere-a,cube-b', JSON.stringify(result));
  assert('scene store smoke creates transform animation component', result.transformAnimationComponentType === 'procedural-transform-animation', JSON.stringify(result));
  assert('scene store smoke stacks group animations', result.groupedAnimationIds.join(',') === 'transform-spin,transform-bob', JSON.stringify(result));
  assert('scene store smoke toggles animation enabled state', result.didDisableBobAnimation === true && result.groupedAnimationEnabledFlags.join(',') === 'true,false', JSON.stringify(result));
  assert('scene store smoke summarizes animation stack', result.groupedAnimationSummary === '1/2 enabled: Spin, Bob', JSON.stringify(result));
  assert('scene store smoke exposes animation component rows', ['animation', 'animation-transform-spin', 'animation-transform-bob'].every((rowKey) => result.groupedAnimationRowKeys.includes(rowKey)), JSON.stringify(result));
  assert('scene store smoke updates orbit config', result.didUpdateOrbitAnimation === true, JSON.stringify(result));
  assert('scene store smoke removes individual animation', result.didRemoveWobbleAnimation === true && result.sphereAnimationIdsAfterRemove.join(',') === 'transform-pulse,transform-orbit', JSON.stringify(result));
  assert('scene store smoke covers pulse orbit types after remove', result.sphereAnimationTypesAfterRemove.join(',') === 'pulse,orbit', JSON.stringify(result));
  assert('scene store smoke evaluates enabled spin only on group', result.groupAnimationAppliedIdsAtOneSecond.join(',') === 'transform-spin' && isNear(result.groupAnimationRotationYAtOneSecond, 90) && isNear(result.groupAnimationPositionYAtOneSecond, 0), JSON.stringify(result));
  assert('scene store smoke evaluates pulse orbit wobble stack', (
    result.sphereAnimationAppliedIdsBeforeRemove.join(',') === 'transform-pulse,transform-orbit,transform-wobble' &&
    isNear(result.sphereAnimationPositionBeforeRemove[0], 1) &&
    isNear(result.sphereAnimationPositionBeforeRemove[1], 0) &&
    isNear(result.sphereAnimationPositionBeforeRemove[2], 3) &&
    isNear(result.sphereAnimationScaleBeforeRemove[0], 1.2) &&
    result.sphereAnimationRotationBeforeRemove.some((value) => Math.abs(value) > 0.1)
  ), JSON.stringify(result));
  assert('scene store smoke selects group subtree', result.groupedSelectedItemId === 'group-test' && result.groupedSelectedItemIds.join(',') === 'group-test,sphere-a,cube-b', JSON.stringify(result));
  assert('scene store smoke expands group selection', result.expandedGroupSelectionIds.join(',') === 'group-test,sphere-a,cube-b', JSON.stringify(result));
  assert('scene store smoke preserves parent ids through serialize round trip', result.roundTripGroupParent === null && result.roundTripChildParentIds.every((parentId) => parentId === 'group-test'), JSON.stringify(result));
  assert('scene store smoke preserves animation stacks through serialize round trip', result.roundTripGroupAnimationCount === 2 && result.roundTripSphereAnimationCount === 2, JSON.stringify(result));
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
  assert('scene store defines transform animation component', sceneStoreSource.includes('export class TransformAnimationComponent') && sceneStoreSource.includes("TRANSFORM_ANIMATION_COMPONENT_TYPE = 'procedural-transform-animation'"));
  assert('scene store exposes transform animation actions', ['attachTransformAnimationToSceneItem', 'updateTransformAnimationConfig', 'setTransformAnimationEnabled', 'removeTransformAnimationFromSceneItem', 'detachTransformAnimationFromSceneItem'].every((name) => sceneStoreSource.includes(`export const ${name}`)));
  assert('scene store evaluates procedural transform animations', ['TRANSFORM_ANIMATION_TYPES.SPIN', 'TRANSFORM_ANIMATION_TYPES.BOB', 'TRANSFORM_ANIMATION_TYPES.PULSE', 'TRANSFORM_ANIMATION_TYPES.ORBIT', 'TRANSFORM_ANIMATION_TYPES.WOBBLE', 'evaluateSceneItemTransformAnimations'].every((name) => sceneStoreSource.includes(name)));

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
  assert('inspector exposes transform animation controls', inspectorSource.includes('data-transform-animation-controls') && inspectorSource.includes('attachTransformAnimationToSceneItem') && inspectorSource.includes('TRANSFORM_ANIMATION_TYPE_OPTIONS'));
  assert('inspector exposes animation enable remove controls', inspectorSource.includes('data-action="toggle-transform-animation-enabled"') && inspectorSource.includes('data-action="remove-transform-animation"'));
  assert('inspector exposes animation config editors', inspectorSource.includes('updateTransformAnimationConfig') && inspectorSource.includes('speedDegreesPerSecond') && inspectorSource.includes('frequencyHertz') && inspectorSource.includes('amplitudeDegrees'));
};

checkSyntax();

if (!syntaxOnly) {
  checkMirrorPairs();
  checkReferenceModelAssets();
  checkVendorFiles();
  checkStylesheetContracts();
  checkImportMapAndStaticAssets();
  checkKeyboardShortcutContracts();
  checkFloatingWindowContracts();
  checkReactCanvasCssContracts();
  await checkReactStaticMigrationContracts();
  checkBenchmarkSignalContracts();
  checkBenchmarkSceneContracts();
  checkPhysicsJointContracts();
  checkPhysicsHotPathContracts();
  checkEmissionModifierContracts();
  checkMaterialPresetTextureContracts();
  checkRendererPostProcessContracts();
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
