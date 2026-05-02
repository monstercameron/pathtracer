import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(repoRoot, 'docs');
const projectBasePath = '/pathtracer/';
const checks = [];
const failures = [];
const serverRequests = [];
const refusedExternalFetches = [];

const mimeTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm'
});

const record = (name, passed, detail = '') => {
  checks.push({ name, passed: Boolean(passed), detail });
  if (!passed) {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  }
};

const assert = (name, condition, detail = '') => record(name, Boolean(condition), detail);

const stripQueryAndHash = (assetPath) => assetPath.split(/[?#]/u)[0];

const isExternalReference = (assetPath) => (
  /^(?:[a-z]+:)?\/\//iu.test(assetPath) ||
  assetPath.startsWith('data:') ||
  assetPath.startsWith('blob:') ||
  assetPath.startsWith('#')
);

const isNetworkReference = (assetPath) => /^(?:https?:)?\/\//iu.test(assetPath);

const toDisplayPath = (filePath) => path.relative(repoRoot, filePath).replaceAll(path.sep, '/');

const hashBuffer = (buffer) => createHash('sha256').update(buffer).digest('hex');

const parseImportMap = (html) => {
  const match = /<script\s+type="importmap"\s*>([\s\S]*?)<\/script>/iu.exec(html);
  return match ? JSON.parse(match[1]) : null;
};

const referencedHtmlAssets = (html) => {
  const assetReferences = new Set();
  const referencePattern = /\b(?:href|src)="([^"]+)"/giu;
  let match = referencePattern.exec(html);
  while (match) {
    const assetReference = stripQueryAndHash(match[1]);
    if (assetReference && !isExternalReference(assetReference)) {
      assetReferences.add(assetReference);
    }
    match = referencePattern.exec(html);
  }
  return [...assetReferences];
};

const referencedHtmlNetworkAssets = (html) => {
  const assetReferences = new Set();
  const referencePattern = /\b(?:href|src)="([^"]+)"/giu;
  let match = referencePattern.exec(html);
  while (match) {
    const assetReference = stripQueryAndHash(match[1]);
    if (assetReference && isNetworkReference(assetReference)) {
      assetReferences.add(assetReference);
    }
    match = referencePattern.exec(html);
  }
  return [...assetReferences];
};

const referencedCssAssets = (css) => {
  const assetReferences = new Set();
  const referencePattern = /\burl\(\s*(['"]?)(.*?)\1\s*\)/giu;
  let match = referencePattern.exec(css);
  while (match) {
    const assetReference = stripQueryAndHash(match[2].trim());
    if (assetReference && !isExternalReference(assetReference)) {
      assetReferences.add(assetReference);
    }
    match = referencePattern.exec(css);
  }
  return [...assetReferences];
};

const referencedCssNetworkAssets = (css) => {
  const assetReferences = new Set();
  const referencePattern = /\burl\(\s*(['"]?)(.*?)\1\s*\)/giu;
  let match = referencePattern.exec(css);
  while (match) {
    const assetReference = stripQueryAndHash(match[2].trim());
    if (assetReference && isNetworkReference(assetReference)) {
      assetReferences.add(assetReference);
    }
    match = referencePattern.exec(css);
  }
  return [...assetReferences];
};

const referencedModuleSpecifiers = (source) => {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/giu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/giu,
    /\bexport\s+[^'"]*?\s+from\s*['"]([^'"]+)['"]/giu,
    /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:import\.meta\.url|['"][^'"]*['"])\s*\)/giu
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match) {
      specifiers.add(match[1]);
      match = pattern.exec(source);
    }
  }
  return [...specifiers];
};

const isLocalServedUrl = (url, origin) => (
  url.origin === origin &&
  decodeURIComponent(url.pathname).startsWith(projectBasePath)
);

const filePathFromServedUrl = (url) => {
  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = decodedPath.slice(projectBasePath.length) || 'index.html';
  const requestedPath = path.resolve(docsRoot, ...relativePath.split('/').filter(Boolean));
  const docsRootWithSeparator = `${docsRoot}${path.sep}`.toLowerCase();
  const requestedPathLower = requestedPath.toLowerCase();
  if (requestedPathLower !== docsRoot.toLowerCase() && !requestedPathLower.startsWith(docsRootWithSeparator)) {
    return null;
  }
  return requestedPath;
};

const startProjectServer = () => new Promise((resolve, reject) => {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    serverRequests.push(request.url || '/');

    if (!decodeURIComponent(requestUrl.pathname).startsWith(projectBasePath)) {
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end('Not found');
      return;
    }

    const requestedPath = filePathFromServedUrl(requestUrl);
    if (!requestedPath) {
      response.writeHead(403, { 'Cache-Control': 'no-store' });
      response.end('Forbidden');
      return;
    }

    if (!existsSync(requestedPath) || !statSync(requestedPath).isFile()) {
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end('Not found');
      return;
    }

    const body = readFileSync(requestedPath);
    const contentType = mimeTypes[path.extname(requestedPath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentType
    });
    response.end(body);
  });
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve({
      server,
      origin: `http://127.0.0.1:${address.port}`,
      baseUrl: `http://127.0.0.1:${address.port}${projectBasePath}`
    });
  });
});

const closeServer = (server) => new Promise((resolve) => {
  server.close(() => resolve());
});

const fetchLocal = (url) => new Promise((resolve) => {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'http:' || (parsedUrl.hostname !== '127.0.0.1' && parsedUrl.hostname !== 'localhost')) {
    refusedExternalFetches.push(parsedUrl.href);
    resolve({
      statusCode: 0,
      headers: {},
      body: Buffer.from(`Refused non-local URL ${parsedUrl.href}`)
    });
    return;
  }

  http.get(parsedUrl, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      });
    });
  }).on('error', (error) => {
    resolve({
      statusCode: 0,
      headers: {},
      body: Buffer.from(error && error.message ? error.message : String(error))
    });
  });
});

const resolveAssetUrl = (assetReference, baseUrl, origin) => {
  if (isExternalReference(assetReference)) {
    return null;
  }
  const resolvedUrl = new URL(assetReference, baseUrl);
  return isLocalServedUrl(resolvedUrl, origin) ? resolvedUrl : null;
};

const resolveModuleSpecifier = (specifier, importerUrl, documentUrl, origin, importMap) => {
  if (isExternalReference(specifier) || specifier.startsWith('/')) {
    return null;
  }
  if (specifier.startsWith('.') || /\.(?:css|html|js|json|map|md|wasm)$/iu.test(specifier)) {
    return resolveAssetUrl(specifier, importerUrl, origin);
  }
  const mappedSpecifier = importMap && importMap.imports ? importMap.imports[specifier] : null;
  return typeof mappedSpecifier === 'string'
    ? resolveAssetUrl(mappedSpecifier, documentUrl, origin)
    : null;
};

const verifyFetchedAsset = async ({ url, label, expectedPath }) => {
  const result = await fetchLocal(url);
  const diskBuffer = expectedPath && existsSync(expectedPath) ? readFileSync(expectedPath) : null;
  assert(`${label} served with HTTP 200`, result.statusCode === 200, `${result.statusCode} ${url.href}`);
  if (diskBuffer) {
    assert(
      `${label} served bytes match docs artifact`,
      hashBuffer(result.body) === hashBuffer(diskBuffer),
      toDisplayPath(expectedPath)
    );
  }
  return result;
};

const run = async () => {
  const indexPath = path.join(docsRoot, 'index.html');
  assert('docs index exists', existsSync(indexPath));
  const html = readFileSync(indexPath, 'utf8');
  const importMap = parseImportMap(html);
  assert('docs index includes importmap', Boolean(importMap && importMap.imports));

  const staticAssetReferences = referencedHtmlAssets(html);
  const networkHtmlReferences = referencedHtmlNetworkAssets(html);
  assert('docs index uses relative static references', staticAssetReferences.every((assetReference) => !assetReference.startsWith('/')), JSON.stringify(staticAssetReferences));
  assert('docs index has no network asset references', networkHtmlReferences.length === 0, JSON.stringify(networkHtmlReferences));

  const serverContext = await startProjectServer();
  try {
    const documentUrl = new URL(serverContext.baseUrl);
    const indexResult = await verifyFetchedAsset({
      url: documentUrl,
      label: 'project subpath index',
      expectedPath: indexPath
    });
    assert('project subpath index contains importmap', indexResult.body.toString('utf8').includes('<script type="importmap">'));

    const rootResult = await fetchLocal(`${serverContext.origin}/index.html`);
    assert('server does not mask project-subpath regressions at origin root', rootResult.statusCode === 404, `${rootResult.statusCode}`);

    const assetQueue = [];
    const seenUrls = new Set([documentUrl.href]);

    for (const assetReference of staticAssetReferences) {
      const assetUrl = resolveAssetUrl(assetReference, documentUrl, serverContext.origin);
      assert(`static reference stays under project path ${assetReference}`, Boolean(assetUrl), assetReference);
      if (assetUrl && !seenUrls.has(assetUrl.href)) {
        seenUrls.add(assetUrl.href);
        assetQueue.push(assetUrl);
      }
    }

    for (const [specifier, mappedPath] of Object.entries(importMap.imports || {})) {
      assert(`importmap ${specifier} maps to relative vendor asset`, typeof mappedPath === 'string' && mappedPath.startsWith('./vendor/'), mappedPath || 'missing');
      const assetUrl = resolveAssetUrl(mappedPath, documentUrl, serverContext.origin);
      assert(`importmap ${specifier} stays under project path`, Boolean(assetUrl), mappedPath || 'missing');
      if (assetUrl && !seenUrls.has(assetUrl.href)) {
        seenUrls.add(assetUrl.href);
        assetQueue.push(assetUrl);
      }
    }

    for (let index = 0; index < assetQueue.length; index += 1) {
      const assetUrl = assetQueue[index];
      const assetPath = filePathFromServedUrl(assetUrl);
      assert(`asset path exists ${assetUrl.pathname}`, Boolean(assetPath && existsSync(assetPath)), assetUrl.href);
      if (!assetPath || !existsSync(assetPath)) {
        continue;
      }

      const result = await verifyFetchedAsset({
        url: assetUrl,
        label: `asset ${assetUrl.pathname}`,
        expectedPath: assetPath
      });

      const extension = path.extname(assetPath).toLowerCase();
      const source = result.body.toString('utf8');
      if (extension === '.css') {
        const networkCssReferences = referencedCssNetworkAssets(source);
        assert(`css contains no network asset references ${assetUrl.pathname}`, networkCssReferences.length === 0, JSON.stringify(networkCssReferences));
        for (const cssReference of referencedCssAssets(source)) {
          const cssAssetUrl = resolveAssetUrl(cssReference, assetUrl, serverContext.origin);
          assert(`css reference stays under project path ${cssReference}`, Boolean(cssAssetUrl), cssReference);
          if (cssAssetUrl && !seenUrls.has(cssAssetUrl.href)) {
            seenUrls.add(cssAssetUrl.href);
            assetQueue.push(cssAssetUrl);
          }
        }
      } else if (extension === '.js') {
        for (const specifier of referencedModuleSpecifiers(source)) {
          const moduleUrl = resolveModuleSpecifier(specifier, assetUrl, documentUrl, serverContext.origin, importMap);
          assert(`module reference resolves locally ${specifier}`, Boolean(moduleUrl), `${specifier} from ${assetUrl.pathname}`);
          if (moduleUrl && !seenUrls.has(moduleUrl.href)) {
            seenUrls.add(moduleUrl.href);
            assetQueue.push(moduleUrl);
          }
        }
      }
    }

    const unexpectedServerRequests = serverRequests.filter((requestUrl) => {
      const requestPath = decodeURIComponent(new URL(requestUrl, serverContext.origin).pathname);
      return !requestPath.startsWith(projectBasePath);
    });
    const unexpectedAppRequests = unexpectedServerRequests.filter((requestUrl) => requestUrl !== '/index.html');
    assert('all app asset requests stayed under project subpath', unexpectedAppRequests.length === 0, JSON.stringify(unexpectedAppRequests));
    assert('deploy smoke refused no external fetches', refusedExternalFetches.length === 0, JSON.stringify(refusedExternalFetches));
  } finally {
    await closeServer(serverContext.server);
  }
};

await run();

for (const check of checks) {
  const detail = check.detail ? `: ${check.detail}` : '';
  console.log(`${check.passed ? 'ok' : 'not ok'} - ${check.name}${detail}`);
}

if (failures.length > 0) {
  console.error('\nPages deploy smoke failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`\n${checks.length} Pages deploy smoke checks passed.`);
