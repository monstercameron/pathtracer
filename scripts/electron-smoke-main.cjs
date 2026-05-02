'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const checks = [];
const failures = [];
const pageErrors = [];
const externalRequests = [];
const staticServerRequests = [];
const staticServerFailures = [];
const performanceSummaries = [];
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pathtracer-electron-profile-'));

const argumentValue = (name) => {
  const prefix = `${name}=`;
  const inlineValue = process.argv.find((argument) => argument.startsWith(prefix));
  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }
  const argumentIndex = process.argv.indexOf(name);
  return argumentIndex === -1 ? null : process.argv[argumentIndex + 1] || null;
};

const outputPath = argumentValue('--out');

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

const record = (name, passed, detail = '') => {
  checks.push({ name, passed: Boolean(passed), detail });
  if (!passed) {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  }
};

const assert = (name, condition, detail = '') => record(name, Boolean(condition), detail);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isLocalHttpUrl = (requestUrl) => {
  try {
    const parsedUrl = new URL(requestUrl);
    return parsedUrl.protocol === 'http:' && (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost');
  } catch {
    return false;
  }
};

const mimeTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm'
});

const sendStaticResponse = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(body);
};

const normalizeBasePath = (basePath) => {
  if (!basePath || basePath === '/') {
    return '/';
  }
  const withLeadingSlash = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

const startStaticServer = (rootDirectory, options = {}) => new Promise((resolve, reject) => {
  const normalizedRoot = path.resolve(rootDirectory);
  const normalizedRootLower = normalizedRoot.toLowerCase();
  const basePath = normalizeBasePath(options.basePath || '/');
  const server = http.createServer((request, response) => {
    try {
      staticServerRequests.push(request.url || '/');
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const requestPathname = decodeURIComponent(requestUrl.pathname);
      if (!requestPathname.startsWith(basePath)) {
        if (requestPathname !== '/favicon.ico') {
          staticServerFailures.push(`${request.url || '/'} outside ${basePath}`);
        }
        sendStaticResponse(response, 404, 'Not found');
        return;
      }

      const relativePathname = requestPathname.slice(basePath.length) || 'index.html';
      const requestedPath = path.resolve(normalizedRoot, ...relativePathname.split('/').filter(Boolean));
      const requestedPathLower = requestedPath.toLowerCase();
      if (
        requestedPathLower !== normalizedRootLower &&
        !requestedPathLower.startsWith(`${normalizedRootLower}${path.sep}`)
      ) {
        staticServerFailures.push(`${request.url || '/'} escaped static root`);
        sendStaticResponse(response, 403, 'Forbidden');
        return;
      }

      fs.readFile(requestedPath, (readError, fileBuffer) => {
        if (readError) {
          const statusCode = readError.code === 'ENOENT' ? 404 : 500;
          staticServerFailures.push(`${request.url || '/'} -> ${statusCode}`);
          sendStaticResponse(response, statusCode, readError.message);
          return;
        }
        const contentType = mimeTypes[path.extname(requestedPath).toLowerCase()] || 'application/octet-stream';
        sendStaticResponse(response, 200, fileBuffer, { 'Content-Type': contentType });
      });
    } catch (error) {
      sendStaticResponse(response, 500, error && error.message ? error.message : String(error));
    }
  });
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve({
      server,
      basePath,
      url: `http://127.0.0.1:${address.port}${basePath}`
    });
  });
});

const closeServer = (server) => new Promise((resolve) => {
  if (!server) {
    resolve();
    return;
  }
  server.close(() => resolve());
});

const readLocalHttpUrl = (url) => new Promise((resolve) => {
  http.get(url, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      });
    });
  }).on('error', (error) => {
    resolve({
      statusCode: 0,
      body: error && error.message ? error.message : String(error)
    });
  });
});

const executeJavaScript = (webContents, script) => webContents.executeJavaScript(script, true);

const reloadWindow = (window) => new Promise((resolve) => {
  const timeoutId = setTimeout(resolve, 10000);
  window.webContents.once('did-finish-load', () => {
    clearTimeout(timeoutId);
    resolve();
  });
  window.reload();
});

const waitForCondition = async (webContents, name, script, predicate, timeoutMilliseconds = 20000) => {
  const startMilliseconds = Date.now();
  let lastValue = null;
  let lastError = null;
  while (Date.now() - startMilliseconds < timeoutMilliseconds) {
    try {
      lastValue = await executeJavaScript(webContents, script);
      if (predicate(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  const detail = lastError
    ? lastError.message
    : JSON.stringify(lastValue);
  assert(name, false, detail);
  return lastValue;
};

const pageReadyScript = `(() => {
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('loading-overlay');
  const errorElement = document.getElementById('error');
  const overlayHidden = Boolean(overlay && (overlay.hidden || overlay.classList.contains('is-hidden')));
  const overlayError = Boolean(overlay && overlay.classList.contains('is-error'));
  const errorVisible = Boolean(errorElement && getComputedStyle(errorElement).zIndex === '1');
  return {
    ready: Boolean(canvas && canvas.width > 0 && canvas.height > 0 && overlayHidden && !overlayError && !errorVisible),
    canvasWidth: canvas ? canvas.width : 0,
    canvasHeight: canvas ? canvas.height : 0,
    overlayHidden,
    overlayError,
    errorVisible,
    errorText: errorElement ? errorElement.textContent.trim().slice(0, 300) : ''
  };
})()`;

const requiredDomScript = `(() => {
  const selectors = [
    '#app-shell',
    '#app-menu',
    '#canvas',
    '#scene-tree-window[data-floating-window]',
    '#controls[data-floating-window]',
    '#benchmark[data-floating-window]',
    '#benchmark-performance-score',
    '#benchmark-source',
    '#benchmark-gpu-renderer'
  ];
  return selectors.map((selector) => ({ selector, exists: Boolean(document.querySelector(selector)) }));
})()`;

const importMapRuntimeScript = `(async () => {
  try {
    const importMapElement = document.querySelector('script[type="importmap"]');
    const importMap = importMapElement ? JSON.parse(importMapElement.textContent) : null;
    const [preactModule, hooksModule, htmModule, signalsModule, signalsCoreModule] = await Promise.all([
      import('preact'),
      import('preact/hooks'),
      import('htm/preact'),
      import('@preact/signals'),
      import('@preact/signals-core')
    ]);
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    return {
      ok: Boolean(
        importMap &&
        importMap.imports &&
        typeof preactModule.render === 'function' &&
        typeof hooksModule.useEffect === 'function' &&
        typeof htmModule.html === 'function' &&
        typeof signalsModule.signal === 'function' &&
        typeof signalsCoreModule.signal === 'function'
      ),
      allImportsVendored: Boolean(
        importMap &&
        importMap.imports &&
        Object.values(importMap.imports).every((importPath) => (
          typeof importPath === 'string' && importPath.startsWith('./vendor/')
        ))
      ),
      imports: importMap && importMap.imports ? importMap.imports : {},
      vendorResources: resources.filter((resource) => resource.includes('/vendor/') || resource.includes('\\\\vendor\\\\'))
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.stack ? error.stack : String(error)
    };
  }
})()`;

const renderSampleScript = `(() => {
  const canvas = document.getElementById('canvas');
  if (!canvas) {
    return { ok: false, reason: 'missing canvas' };
  }
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    return { ok: false, reason: 'missing webgl context' };
  }
  const samplePoints = [
    [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
    [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
    [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]
  ];
  const pixel = new Uint8Array(4);
  let nonBlackSamples = 0;
  let colorSum = 0;
  for (const [xFactor, yFactor] of samplePoints) {
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * xFactor)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * yFactor)));
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const rgb = pixel[0] + pixel[1] + pixel[2];
    colorSum += rgb;
    if (rgb > 8) {
      nonBlackSamples += 1;
    }
  }
  return {
    ok: nonBlackSamples > 0,
    width: canvas.width,
    height: canvas.height,
    nonBlackSamples,
    colorSum,
    dataUrlLength: canvas.toDataURL('image/png').length
  };
})()`;

const keyboardSmokeScript = `(async () => {
  const shortcuts = [
    { code: 'KeyN', key: 'n', ctrlKey: true, selector: 'button[data-action="reset-all"]' },
    { code: 'Digit1', key: '1', ctrlKey: true, selector: '#scene-tree-add' },
    { code: 'Digit2', key: '2', ctrlKey: true, selector: 'button[data-panel-target="object-panel"]' },
    { code: 'Digit3', key: '3', ctrlKey: true, selector: 'button[data-panel-target="render-panel"]' },
    { code: 'Digit4', key: '4', ctrlKey: true, selector: 'button[data-panel-target="camera-panel"]' },
    { code: 'Digit5', key: '5', ctrlKey: true, selector: 'button[data-panel-target="output-panel"]' },
    { code: 'Digit6', key: '6', ctrlKey: true, selector: 'button[data-panel-target="preset-panel"]' },
    { code: 'KeyS', key: 's', ctrlKey: true, selector: 'button[data-action="save-bitmap"]' },
    { code: 'Digit1', key: '1', selector: 'button[data-quality-preset="draft"]' },
    { code: 'Digit2', key: '2', selector: 'button[data-quality-preset="preview"]' },
    { code: 'Digit3', key: '3', selector: 'button[data-quality-preset="final"]' },
    { code: 'KeyB', key: 'b', selector: 'button[data-window-target="benchmark"]' },
    { code: 'KeyC', key: 'c', selector: '#camera-playback' },
    { code: 'KeyF', key: 'f', selector: '#canvas-fullscreen' },
    { code: 'KeyI', key: 'i', selector: 'button[data-window-target="controls"]' },
    { code: 'KeyK', key: 'k', selector: '#convergence-pause' },
    { code: 'KeyL', key: 'l', selector: 'button[data-action="select-light"]' },
    { code: 'KeyP', key: 'p', selector: '#frame-pause' },
    { code: 'KeyT', key: 't', selector: 'button[data-window-target="scene-tree-window"]' }
  ];
  const results = [];
  let activeShortcut = null;
  const clickListener = (event) => {
    const targetButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!targetButton || !activeShortcut) {
      return;
    }
    results.push({
      code: activeShortcut.code,
      selector: activeShortcut.selector,
      ctrlKey: Boolean(activeShortcut.ctrlKey),
      matched: targetButton === document.querySelector(activeShortcut.selector),
      clicked: targetButton.outerHTML.slice(0, 180)
    });
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener('click', clickListener, true);
  try {
    for (const shortcut of shortcuts) {
      activeShortcut = shortcut;
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      document.body.focus();
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: shortcut.code,
        key: shortcut.key,
        ctrlKey: Boolean(shortcut.ctrlKey),
        metaKey: false,
        altKey: false,
        shiftKey: false
      });
      const dispatchResult = document.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const clickResult = results.findLast((result) => (
        result.code === shortcut.code &&
        result.selector === shortcut.selector &&
        result.ctrlKey === Boolean(shortcut.ctrlKey)
      ));
      if (!clickResult) {
        results.push({
          code: shortcut.code,
          selector: shortcut.selector,
          ctrlKey: Boolean(shortcut.ctrlKey),
          matched: false,
          clicked: null,
          dispatchResult,
          defaultPrevented: event.defaultPrevented
        });
      } else {
        clickResult.dispatchResult = dispatchResult;
        clickResult.defaultPrevented = event.defaultPrevented;
      }
    }
  } finally {
    activeShortcut = null;
    document.removeEventListener('click', clickListener, true);
  }
  return results;
})()`;

const menuDropdownSmokeScript = `(async () => {
  const menuElement = document.getElementById('app-menu');
  const trigger = menuElement && menuElement.querySelector('.menu-trigger');
  if (!(menuElement instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) {
    return { ok: false, reason: 'missing menu trigger' };
  }

  trigger.focus();
  trigger.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const popover = trigger.closest('.menu-group')?.querySelector('.menu-popover');
  if (!(popover instanceof HTMLElement)) {
    return { ok: false, reason: 'missing menu popover' };
  }

  const menuRect = menuElement.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const sampleX = Math.floor(popoverRect.left + Math.min(24, Math.max(1, popoverRect.width / 2)));
  const sampleY = Math.floor(popoverRect.top + Math.min(16, Math.max(1, popoverRect.height / 2)));
  const hitElement = document.elementFromPoint(sampleX, sampleY);
  const hitPopover = hitElement instanceof Element ? hitElement.closest('.menu-popover') : null;

  return {
    ok: (
      getComputedStyle(popover).display !== 'none' &&
      popoverRect.top >= menuRect.bottom &&
      popoverRect.height > 20 &&
      hitPopover === popover
    ),
    display: getComputedStyle(popover).display,
    menuBottom: Math.round(menuRect.bottom),
    popoverTop: Math.round(popoverRect.top),
    popoverHeight: Math.round(popoverRect.height),
    sampleX,
    sampleY,
    hitElement: hitElement ? hitElement.outerHTML.slice(0, 180) : null
  };
})()`;

const floatingSmokeScript = `(async () => {
  const storageKey = 'pathtracer.floatingWindows.v1';
  const windowElement = document.getElementById('benchmark');
  const dragHandle = windowElement && windowElement.querySelector('[data-window-drag-handle]');
  if (!(windowElement instanceof HTMLElement) || !(dragHandle instanceof HTMLElement)) {
    return { ok: false, reason: 'missing benchmark floating window' };
  }
  localStorage.removeItem(storageKey);
  const showButton = document.querySelector('button[data-window-target="benchmark"]');
  if (windowElement.hidden && showButton instanceof HTMLButtonElement) {
    showButton.click();
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const before = windowElement.getBoundingClientRect();
  const startX = before.left + Math.min(80, Math.max(20, before.width / 3));
  const startY = before.top + 14;
  const originalSetPointerCapture = dragHandle.setPointerCapture;
  dragHandle.setPointerCapture = () => undefined;
  try {
    dragHandle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 77,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: startX,
      clientY: startY
    }));
    dragHandle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 77,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: startX + 72,
      clientY: startY + 46
    }));
    dragHandle.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 77,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: startX + 72,
      clientY: startY + 46
    }));
  } finally {
    dragHandle.setPointerCapture = originalSetPointerCapture;
  }
  await new Promise((resolve) => setTimeout(resolve, 160));
  const afterDrag = windowElement.getBoundingClientRect();
  const collapseButton = windowElement.querySelector('button[data-window-command="collapse"]');
  const closeButton = windowElement.querySelector('button[data-window-command="close"]');
  collapseButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const collapsed = windowElement.classList.contains('is-collapsed');
  closeButton.click();
  await new Promise((resolve) => setTimeout(resolve, 160));
  const storedState = JSON.parse(localStorage.getItem(storageKey) || '{}').benchmark || null;
  return {
    ok: true,
    before: { left: Math.round(before.left), top: Math.round(before.top) },
    afterDrag: { left: Math.round(afterDrag.left), top: Math.round(afterDrag.top) },
    moved: Math.abs(afterDrag.left - before.left) >= 20 || Math.abs(afterDrag.top - before.top) >= 20,
    collapsed,
    hidden: windowElement.hidden,
    storedState
  };
})()`;

const floatingPersistenceScript = `(async () => {
  const storageKey = 'pathtracer.floatingWindows.v1';
  const windowElement = document.getElementById('benchmark');
  const storedState = JSON.parse(localStorage.getItem(storageKey) || '{}').benchmark || null;
  const quickActionButton = document.querySelector('#menu-quick-actions button[data-window-target="benchmark"]');
  const beforeShow = {
    hidden: windowElement ? windowElement.hidden : null,
    collapsed: windowElement ? windowElement.classList.contains('is-collapsed') : null,
    left: windowElement ? Math.round(windowElement.getBoundingClientRect().left) : null,
    top: windowElement ? Math.round(windowElement.getBoundingClientRect().top) : null,
    quickActionPressed: quickActionButton ? quickActionButton.getAttribute('aria-pressed') : null
  };
  const targetButton = quickActionButton ||
    document.querySelector('button[data-window-target="benchmark"]');
  if (targetButton) {
    targetButton.click();
  }
  const showStartMilliseconds = performance.now();
  while (
    windowElement &&
    (windowElement.hidden || windowElement.classList.contains('is-collapsed')) &&
    performance.now() - showStartMilliseconds < 1200
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    storedState,
    beforeShow,
    afterShow: {
      hidden: windowElement ? windowElement.hidden : null,
      collapsed: windowElement ? windowElement.classList.contains('is-collapsed') : null,
      left: windowElement ? Math.round(windowElement.getBoundingClientRect().left) : null,
      top: windowElement ? Math.round(windowElement.getBoundingClientRect().top) : null,
      quickActionPressed: quickActionButton ? quickActionButton.getAttribute('aria-pressed') : null
    }
  };
})()`;

const floatingReloadStateScript = `(() => {
  const storageKey = 'pathtracer.floatingWindows.v1';
  const windowElement = document.getElementById('benchmark');
  const quickActionButton = document.querySelector('#menu-quick-actions button[data-window-target="benchmark"]');
  const storedState = JSON.parse(localStorage.getItem(storageKey) || '{}').benchmark || null;
  return {
    ready: Boolean(
      windowElement &&
      storedState &&
      storedState.hidden === true &&
      storedState.collapsed === true &&
      windowElement.hidden === true &&
      windowElement.classList.contains('is-collapsed') &&
      quickActionButton &&
      quickActionButton.getAttribute('aria-pressed') === 'false'
    ),
    storedState,
    hidden: windowElement ? windowElement.hidden : null,
    collapsed: windowElement ? windowElement.classList.contains('is-collapsed') : null,
    quickActionPressed: quickActionButton ? quickActionButton.getAttribute('aria-pressed') : null
  };
})()`;

const benchmarkThrottleScript = `(async () => {
  const observedElements = [
    '#benchmark-samples',
    '#benchmark-rays-per-second',
    '#benchmark-perceptual-fps',
    '#benchmark-source'
  ].map((selector) => document.querySelector(selector)).filter(Boolean);
  const mutationTimes = [];
  const frameDeltas = [];
  let previousFrameTime = performance.now();
  let running = true;
  const observer = new MutationObserver(() => {
    const now = performance.now();
    if (mutationTimes.length === 0 || now - mutationTimes[mutationTimes.length - 1] > 20) {
      mutationTimes.push(now);
    }
  });
  for (const element of observedElements) {
    observer.observe(element, { childList: true, characterData: true, subtree: true });
  }
  const frame = (timestamp) => {
    frameDeltas.push(timestamp - previousFrameTime);
    previousFrameTime = timestamp;
    if (running) {
      requestAnimationFrame(frame);
    }
  };
  requestAnimationFrame(frame);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  running = false;
  observer.disconnect();
  const deltas = mutationTimes.slice(1).map((time, index) => time - mutationTimes[index]);
  const sortedFrameDeltas = frameDeltas.slice().sort((a, b) => a - b);
  const severeFrameStalls = frameDeltas.filter((delta) => delta >= 250);
  const averageFrameDelta = frameDeltas.length
    ? frameDeltas.reduce((total, value) => total + value, 0) / frameDeltas.length
    : 0;
  const p95FrameDelta = sortedFrameDeltas.length
    ? sortedFrameDeltas[Math.min(sortedFrameDeltas.length - 1, Math.floor(sortedFrameDeltas.length * 0.95))]
    : 0;
  return {
    observedElementCount: observedElements.length,
    mutationCount: mutationTimes.length,
    minMutationDelta: deltas.length ? Math.min(...deltas) : 0,
    maxMutationDelta: deltas.length ? Math.max(...deltas) : 0,
    frameCount: frameDeltas.length,
    averageFrameDelta,
    maxFrameDelta: frameDeltas.length ? Math.max(...frameDeltas) : 0,
    p95FrameDelta,
    severeFrameStallCount: severeFrameStalls.length
  };
})()`;

const sceneLoadPacingScript = `(async () => {
  const sceneButton = document.querySelector('button[data-benchmark-scene="standard"]');
  const overlay = document.getElementById('loading-overlay');
  const stepsElement = document.getElementById('loading-steps');
  if (!(sceneButton instanceof HTMLButtonElement) || !(overlay instanceof HTMLElement) || !(stepsElement instanceof HTMLElement)) {
    return { ok: false, reason: 'missing scene load controls' };
  }

  const frameDeltas = [];
  const stepSnapshots = [];
  const phaseMarks = [];
  let previousFrameTime = performance.now();
  let running = true;
  const observer = new MutationObserver(() => {
    const snapshot = Array.from(stepsElement.querySelectorAll('.loading-step')).map((step) => ({
      id: step.dataset.stepId || '',
      state: step.dataset.stepState || ''
    }));
    stepSnapshots.push(snapshot);
    phaseMarks.push({
      elapsedMilliseconds: performance.now() - startMilliseconds,
      completedStepIds: snapshot.filter((step) => step.state === 'done').map((step) => step.id),
      runningStepId: snapshot.find((step) => step.state === 'running')?.id || ''
    });
  });
  observer.observe(stepsElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-step-state'] });

  const frame = (timestamp) => {
    frameDeltas.push(timestamp - previousFrameTime);
    previousFrameTime = timestamp;
    if (running) {
      requestAnimationFrame(frame);
    }
  };
  requestAnimationFrame(frame);

  const startMilliseconds = performance.now();
  sceneButton.click();
  await new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, 12000);
    const poll = () => {
      const overlayHidden = overlay.hidden || overlay.classList.contains('is-hidden');
      const latestSnapshot = stepSnapshots.length ? stepSnapshots[stepSnapshots.length - 1] : [];
      const completedStepIds = latestSnapshot.filter((step) => step.state === 'done').map((step) => step.id);
      if (overlayHidden && completedStepIds.includes('first-frame')) {
        clearTimeout(timeoutId);
        resolve();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  running = false;
  observer.disconnect();

  const sortedFrameDeltas = frameDeltas.slice().sort((a, b) => a - b);
  const p95FrameDelta = sortedFrameDeltas.length
    ? sortedFrameDeltas[Math.min(sortedFrameDeltas.length - 1, Math.floor(sortedFrameDeltas.length * 0.95))]
    : 0;
  const severeFrameStalls = frameDeltas.filter((delta) => delta >= 300);
  const lastStepSnapshot = stepSnapshots.length ? stepSnapshots[stepSnapshots.length - 1] : [];
  return {
    ok: overlay.hidden || overlay.classList.contains('is-hidden'),
    elapsedMilliseconds: performance.now() - startMilliseconds,
    frameCount: frameDeltas.length,
    maxFrameDelta: frameDeltas.length ? Math.max(...frameDeltas) : 0,
    p95FrameDelta,
    severeFrameStallCount: severeFrameStalls.length,
    stepSnapshotCount: stepSnapshots.length,
    completedStepIds: lastStepSnapshot.filter((step) => step.state === 'done').map((step) => step.id),
    phaseMarks
  };
})()`;

const createSmokeWindow = (label) => {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    skipTaskbar: true,
    useContentSize: true,
    backgroundColor: '#aeb6bf',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setPosition(-20000, -20000);
  window.showInactive();

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 3) {
      pageErrors.push({
        label,
        message: `${message}${sourceId ? ` (${sourceId}:${line})` : ''}`
      });
    }
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    pageErrors.push({
      label,
      message: `load failed ${errorCode} ${errorDescription} ${validatedURL}`
    });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    pageErrors.push({
      label,
      message: `render process gone: ${details.reason}`
    });
  });

  return window;
};

const loadSmokePage = async ({ label, filePath, url, query }) => {
  const window = createSmokeWindow(label);
  const beforeErrorCount = pageErrors.length;
  try {
    if (filePath) {
      await window.loadFile(filePath, query ? { query } : undefined);
    } else {
      await window.loadURL(url);
    }

    const pageState = await waitForCondition(
      window.webContents,
      `${label} app reaches first rendered frame`,
      pageReadyScript,
      (value) => Boolean(value && value.ready),
      25000
    );
    assert(`${label} canvas has render dimensions`, pageState && pageState.canvasWidth > 0 && pageState.canvasHeight > 0, JSON.stringify(pageState));
    assert(`${label} loading overlay dismissed`, pageState && pageState.overlayHidden && !pageState.overlayError, JSON.stringify(pageState));

    const domResults = await executeJavaScript(window.webContents, requiredDomScript);
    for (const domResult of domResults) {
      assert(`${label} DOM includes ${domResult.selector}`, domResult.exists);
    }

    const importMapResult = await executeJavaScript(window.webContents, importMapRuntimeScript);
    assert(`${label} runtime importmap loads vendored modules`, importMapResult.ok, importMapResult.error || JSON.stringify(importMapResult.imports));
    assert(
      `${label} runtime importmap used vendor resources`,
      importMapResult.allImportsVendored,
      JSON.stringify(importMapResult.imports)
    );

    const renderSample = await waitForCondition(
      window.webContents,
      `${label} canvas has nonblank pixels`,
      renderSampleScript,
      (value) => Boolean(value && value.ok),
      10000
    );
    assert(`${label} canvas readback is nonblank`, renderSample && renderSample.ok, JSON.stringify(renderSample));

    assert(
      `${label} page produced no console or load errors`,
      pageErrors.length === beforeErrorCount,
      JSON.stringify(pageErrors.slice(beforeErrorCount))
    );

    return window;
  } catch (error) {
    assert(`${label} page smoke did not throw`, false, error && error.stack ? error.stack : String(error));
    window.destroy();
    return null;
  }
};

const runKeyboardSmoke = async (window) => {
  const results = await executeJavaScript(window.webContents, keyboardSmokeScript);
  for (const result of results) {
    const shortcutLabel = `${result.ctrlKey ? 'Ctrl+' : ''}${result.code}`;
    assert(
      `keyboard shortcut ${shortcutLabel} clicks ${result.selector}`,
      result.matched && result.defaultPrevented,
      JSON.stringify(result)
    );
  }
  assert('keyboard smoke covered all keydown-map shortcuts', results.length === 19, `covered ${results.length}`);
};

const runMenuDropdownSmoke = async (window) => {
  const menuResult = await executeJavaScript(window.webContents, menuDropdownSmokeScript);
  assert('main menu dropdown renders below the menu bar', menuResult && menuResult.ok, JSON.stringify(menuResult));
};

const runFloatingSmoke = async (window) => {
  const floatingResult = await executeJavaScript(window.webContents, floatingSmokeScript);
  assert('floating window drag moved benchmark panel', floatingResult && floatingResult.moved, JSON.stringify(floatingResult));
  assert('floating window collapse command applied class', floatingResult && floatingResult.collapsed, JSON.stringify(floatingResult));
  assert('floating window close command hides panel', floatingResult && floatingResult.hidden, JSON.stringify(floatingResult));
  assert(
    'floating window persisted drag/collapse/close state',
    Boolean(
      floatingResult &&
      floatingResult.storedState &&
      Number.isFinite(floatingResult.storedState.left) &&
      Number.isFinite(floatingResult.storedState.top) &&
      floatingResult.storedState.hidden === true &&
      floatingResult.storedState.collapsed === true
    ),
    JSON.stringify(floatingResult)
  );

  await reloadWindow(window);
  await waitForCondition(
    window.webContents,
    'floating persistence reload reapplies stored state',
    floatingReloadStateScript,
    (value) => Boolean(value && value.ready),
    25000
  );
  const persistenceResult = await executeJavaScript(window.webContents, floatingPersistenceScript);
  assert(
    'floating window reload restores hidden/collapsed persisted state',
    Boolean(
      persistenceResult &&
      persistenceResult.beforeShow.hidden === true &&
      persistenceResult.beforeShow.collapsed === true
    ),
    JSON.stringify(persistenceResult)
  );
  assert(
    'floating window reopen clears collapsed state and keeps position',
    Boolean(
      persistenceResult &&
      persistenceResult.afterShow.hidden === false &&
      persistenceResult.afterShow.collapsed === false &&
      persistenceResult.storedState &&
      Math.abs(persistenceResult.afterShow.left - persistenceResult.storedState.left) <= 2 &&
      Math.abs(persistenceResult.afterShow.top - persistenceResult.storedState.top) <= 2
    ),
    JSON.stringify(persistenceResult)
  );
};

const runBenchmarkThrottleSmoke = async (window) => {
  const throttleResult = await executeJavaScript(window.webContents, benchmarkThrottleScript);
  performanceSummaries.push({ name: 'benchmark-throttle', ...throttleResult });
  assert('benchmark throttle observed live metric updates', throttleResult.mutationCount >= 3, JSON.stringify(throttleResult));
  assert(
    'benchmark throttle does not update faster than render budget',
    throttleResult.minMutationDelta >= 180,
    JSON.stringify(throttleResult)
  );
  assert('benchmark throttle sampled requestAnimationFrame pacing', throttleResult.frameCount >= 8, JSON.stringify(throttleResult));
  assert(
    'benchmark throttle reports frame pacing stall budget',
    throttleResult.p95FrameDelta > 0 &&
      Number.isFinite(throttleResult.maxFrameDelta) &&
      throttleResult.maxFrameDelta >= 0 &&
      throttleResult.severeFrameStallCount >= 0,
    JSON.stringify(throttleResult)
  );
};

const runSceneLoadPacingSmoke = async (window) => {
  const sceneLoadResult = await executeJavaScript(window.webContents, sceneLoadPacingScript);
  performanceSummaries.push({ name: 'scene-load-pacing', ...sceneLoadResult });
  assert('scene load pacing completed deferred benchmark switch', sceneLoadResult && sceneLoadResult.ok, JSON.stringify(sceneLoadResult));
  if (!sceneLoadResult || !sceneLoadResult.ok) {
    return;
  }
  assert(
    'scene load pacing emitted step diagnostics',
    Array.isArray(sceneLoadResult.phaseMarks) &&
      sceneLoadResult.phaseMarks.length >= 2 &&
      sceneLoadResult.phaseMarks.some((mark) => mark.runningStepId === 'yield') &&
      sceneLoadResult.phaseMarks.some((mark) => mark.runningStepId === 'load-assets'),
    JSON.stringify(sceneLoadResult)
  );
  assert(
    'scene load pacing completed loading steps',
    Array.isArray(sceneLoadResult.completedStepIds) &&
      ['stop-runtime', 'release-shaders', 'clear-memory', 'yield', 'load-assets', 'compile-shaders', 'first-frame']
        .every((stepId) => sceneLoadResult.completedStepIds.includes(stepId)),
    JSON.stringify(sceneLoadResult)
  );
  assert('scene load pacing yielded before shader compilation', sceneLoadResult.frameCount >= 2, JSON.stringify(sceneLoadResult));
  assert(
    'scene load pacing reports shader compile stall budget',
    Number.isFinite(sceneLoadResult.p95FrameDelta) &&
      Number.isFinite(sceneLoadResult.maxFrameDelta) &&
      sceneLoadResult.maxFrameDelta >= 0 &&
      sceneLoadResult.severeFrameStallCount >= 0,
    JSON.stringify(sceneLoadResult)
  );
};

const runSmoke = async () => {
  app.setPath('userData', userDataDirectory);
  app.commandLine.appendSwitch('force_high_performance_gpu');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('no-proxy-server');

  await app.whenReady();
  await session.defaultSession.setProxy({ mode: 'direct' });

  session.defaultSession.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
    if (/^https?:/i.test(details.url) && !isLocalHttpUrl(details.url)) {
      externalRequests.push(details.url);
    }
  });
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
    if (/^https?:/i.test(details.url) && !isLocalHttpUrl(details.url)) {
      externalRequests.push(`${details.url} (${details.error})`);
    }
  });

  const rootWindow = await loadSmokePage({
    label: 'electron-root',
    filePath: path.join(repoRoot, 'index.html')
  });

  if (rootWindow) {
    await runMenuDropdownSmoke(rootWindow);
    await runKeyboardSmoke(rootWindow);
    await runBenchmarkThrottleSmoke(rootWindow);
    await runSceneLoadPacingSmoke(rootWindow);
    await runFloatingSmoke(rootWindow);
  }

  const suzannePresetWindow = await loadSmokePage({
    label: 'electron-root-suzanne-reference',
    filePath: path.join(repoRoot, 'index.html'),
    query: { preset: 'suzanneReference' }
  });
  if (suzannePresetWindow) {
    suzannePresetWindow.destroy();
  }

  const staticRequestStart = staticServerRequests.length;
  const staticFailureStart = staticServerFailures.length;
  const staticServer = await startStaticServer(path.join(repoRoot, 'docs'), { basePath: '/pathtracer/' });
  try {
    const serverCheck = await readLocalHttpUrl(staticServer.url);
    assert(
      'browser docs project-path local server serves index',
      serverCheck.statusCode === 200 && serverCheck.body.includes('<script type="importmap">'),
      `status ${serverCheck.statusCode}: ${serverCheck.body.slice(0, 160)}`
    );
    const docsWindow = await loadSmokePage({
      label: 'browser-docs-project-http',
      url: staticServer.url
    });
    if (docsWindow) {
      docsWindow.destroy();
    }

    const docsServerRequests = staticServerRequests.slice(staticRequestStart);
    const offProjectPathRequests = docsServerRequests.filter((requestUrl) => {
      const requestPathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
      return requestPathname !== '/favicon.ico' && !requestPathname.startsWith(staticServer.basePath);
    });
    assert(
      'browser docs local server used GitHub Pages project path',
      docsServerRequests.length > 0 && offProjectPathRequests.length === 0,
      JSON.stringify(docsServerRequests)
    );
    assert(
      'browser docs local server resolved every requested asset',
      staticServerFailures.length === staticFailureStart,
      JSON.stringify(staticServerFailures.slice(staticFailureStart))
    );
  } finally {
    await closeServer(staticServer.server);
  }

  if (rootWindow) {
    rootWindow.destroy();
  }

  assert('runtime made no external network requests', externalRequests.length === 0, JSON.stringify(externalRequests));
};

const writeResultAndQuit = async () => {
  const payload = {
    checks,
    failures,
    pageErrors,
    externalRequests,
    staticServerRequests,
    staticServerFailures,
    performanceSummaries
  };
  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  try {
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
  app.quit();
};

process.on('uncaughtException', (error) => {
  assert('electron smoke uncaught exception', false, error && error.stack ? error.stack : String(error));
  writeResultAndQuit();
});

process.on('unhandledRejection', (error) => {
  assert('electron smoke unhandled rejection', false, error && error.stack ? error.stack : String(error));
  writeResultAndQuit();
});

runSmoke()
  .catch((error) => {
    assert('electron smoke runner completed', false, error && error.stack ? error.stack : String(error));
  })
  .finally(() => {
    writeResultAndQuit();
  });
