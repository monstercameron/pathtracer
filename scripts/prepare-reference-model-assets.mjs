import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rootAssetsDir = path.join(repoRoot, 'assets', 'models');
const docsAssetsDir = path.join(repoRoot, 'docs', 'assets', 'models');
const rootSourceDir = path.join(repoRoot, 'src');
const docsSourceDir = path.join(repoRoot, 'docs', 'src');

const KHRONOS_RAW = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';
const SUZANNE_BASE = `${KHRONOS_RAW}/Suzanne`;
const SPONZA_BASE = `${KHRONOS_RAW}/Sponza`;

const COMPONENTS_BY_TYPE = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};

const COMPONENT_READERS = {
  5120: { size: 1, read: (buffer, offset) => buffer.readInt8(offset) },
  5121: { size: 1, read: (buffer, offset) => buffer.readUInt8(offset) },
  5122: { size: 2, read: (buffer, offset) => buffer.readInt16LE(offset) },
  5123: { size: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) },
  5125: { size: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) },
  5126: { size: 4, read: (buffer, offset) => buffer.readFloatLE(offset) }
};

const align4 = (value) => (value + 3) & ~3;

const paddedBuffer = (buffer, padByte = 0) => {
  const paddedLength = align4(buffer.length);
  if (paddedLength === buffer.length) {
    return buffer;
  }
  const next = Buffer.alloc(paddedLength, padByte);
  buffer.copy(next);
  return next;
};

const ensureDir = async (dir) => mkdir(dir, { recursive: true });

const fetchBuffer = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const fetchText = async (url) => (await fetchBuffer(url)).toString('utf8');

const writeText = async (filePath, text) => {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, text, 'utf8');
};

const writeBinary = async (filePath, buffer) => {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, buffer);
};

const parseDataUri = (uri) => {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/u.exec(uri);
  if (!match) {
    return null;
  }
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = isBase64 ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  return { mimeType, payload };
};

const extensionMimeType = (uri) => {
  const extension = path.extname(uri).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  return 'application/octet-stream';
};

const readAccessor = (gltf, buffers, accessorIndex) => {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const buffer = buffers[bufferView.buffer || 0];
  const component = COMPONENT_READERS[accessor.componentType];
  const componentCount = COMPONENTS_BY_TYPE[accessor.type];

  if (!accessor || !bufferView || !buffer || !component || !componentCount) {
    throw new Error(`Unsupported accessor ${accessorIndex}`);
  }
  if (accessor.sparse) {
    throw new Error(`Sparse accessor ${accessorIndex} is not supported by this OBJ converter.`);
  }

  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteStride = bufferView.byteStride || component.size * componentCount;
  const values = [];

  for (let index = 0; index < accessor.count; index += 1) {
    const elementOffset = byteOffset + index * byteStride;
    const element = [];
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
      element.push(component.read(buffer, elementOffset + componentIndex * component.size));
    }
    values.push(componentCount === 1 ? element[0] : element);
  }

  return values;
};

const readGltfBuffers = async (gltf, baseUrl) => Promise.all((gltf.buffers || []).map(async (bufferDef) => {
  if (!bufferDef.uri) {
    throw new Error('External .gltf buffer is missing a URI.');
  }
  const dataUri = parseDataUri(bufferDef.uri);
  if (dataUri) {
    return dataUri.payload;
  }
  return fetchBuffer(`${baseUrl}/${bufferDef.uri}`);
}));

const addVec3 = (target, value) => {
  target[0] += value[0] || 0;
  target[1] += value[1] || 0;
  target[2] += value[2] || 0;
};

const addVec2 = (target, value) => {
  target[0] += value?.[0] || 0;
  target[1] += value?.[1] || 0;
};

const normalizeVec3 = (value) => {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
};

const subtractVec3 = (left, right) => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2]
];

const crossVec3 = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0]
];

const triangleIndicesForPrimitive = (primitive, vertexCount, indices) => {
  const source = indices || Array.from({ length: vertexCount }, (_, index) => index);
  const mode = primitive.mode ?? 4;
  const triangles = [];

  if (mode === 4) {
    for (let index = 0; index + 2 < source.length; index += 3) {
      triangles.push([source[index], source[index + 1], source[index + 2]]);
    }
    return triangles;
  }
  if (mode === 5) {
    for (let index = 0; index + 2 < source.length; index += 1) {
      const tri = index % 2 === 0
        ? [source[index], source[index + 1], source[index + 2]]
        : [source[index + 1], source[index], source[index + 2]];
      triangles.push(tri);
    }
    return triangles;
  }
  if (mode === 6) {
    for (let index = 1; index + 1 < source.length; index += 1) {
      triangles.push([source[0], source[index], source[index + 1]]);
    }
    return triangles;
  }

  throw new Error(`Unsupported primitive mode ${mode}`);
};

const collectTriangles = (gltf, buffers) => {
  const triangles = [];

  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const positions = readAccessor(gltf, buffers, primitive.attributes.POSITION);
      const normals = primitive.attributes.NORMAL == null
        ? []
        : readAccessor(gltf, buffers, primitive.attributes.NORMAL);
      const texcoords = primitive.attributes.TEXCOORD_0 == null
        ? []
        : readAccessor(gltf, buffers, primitive.attributes.TEXCOORD_0);
      const indices = primitive.indices == null
        ? null
        : readAccessor(gltf, buffers, primitive.indices);

      for (const tri of triangleIndicesForPrimitive(primitive, positions.length, indices)) {
        triangles.push(tri.map((vertexIndex) => ({
          position: positions[vertexIndex],
          normal: normals[vertexIndex] || null,
          texcoord: texcoords[vertexIndex] || null
        })));
      }
    }
  }

  return triangles;
};

const formatNumber = (value) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const normalized = Math.abs(value) < 1e-8 ? 0 : value;
  return Number(normalized.toFixed(8)).toString();
};

const trianglesToObj = (triangles, headerLines) => {
  const lines = [
    ...headerLines.map((line) => `# ${line}`),
    ''
  ];
  let vertexOffset = 1;

  for (const triangle of triangles) {
    for (const vertex of triangle) {
      lines.push(`v ${formatNumber(vertex.position[0])} ${formatNumber(vertex.position[1])} ${formatNumber(vertex.position[2])}`);
    }
    for (const vertex of triangle) {
      const uv = vertex.texcoord || [0, 0];
      lines.push(`vt ${formatNumber(uv[0])} ${formatNumber(uv[1])}`);
    }
    for (const vertex of triangle) {
      const normal = vertex.normal || [0, 0, 1];
      lines.push(`vn ${formatNumber(normal[0])} ${formatNumber(normal[1])} ${formatNumber(normal[2])}`);
    }

    const face = [0, 1, 2].map((index) => {
      const vertexIndex = vertexOffset + index;
      return `${vertexIndex}/${vertexIndex}/${vertexIndex}`;
    }).join(' ');
    lines.push(`f ${face}`);
    vertexOffset += 3;
  }

  lines.push('');
  return lines.join('\n');
};

const boundsForTriangles = (triangles) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex.position[axis]);
        max[axis] = Math.max(max[axis], vertex.position[axis]);
      }
    }
  }
  return { min, max };
};

const normalizeReferenceTriangles = (triangles, targetSize = 0.98) => {
  const { min, max } = boundsForTriangles(triangles);
  const center = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5
  ];
  const longestAxis = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  const scale = targetSize / longestAxis;
  const positions = [];
  const normals = [];
  const normalizedBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };

  for (const triangle of triangles) {
    const trianglePositions = triangle.map((vertex) => vertex.position.map((component, axis) => (
      (component - center[axis]) * scale
    )));
    const normal = normalizeVec3(crossVec3(
      subtractVec3(trianglePositions[1], trianglePositions[0]),
      subtractVec3(trianglePositions[2], trianglePositions[0])
    ));
    for (const position of trianglePositions) {
      positions.push(position[0], position[1], position[2]);
      for (let axis = 0; axis < 3; axis += 1) {
        normalizedBounds.min[axis] = Math.min(normalizedBounds.min[axis], position[axis]);
        normalizedBounds.max[axis] = Math.max(normalizedBounds.max[axis], position[axis]);
      }
    }
    normals.push(normal[0], normal[1], normal[2]);
  }

  return {
    positions,
    normals,
    bounds: normalizedBounds,
    sourceBounds: { min, max },
    scale
  };
};

const formatNumberArrayLiteral = (values, valuesPerLine = 12) => {
  const lines = [];
  for (let index = 0; index < values.length; index += valuesPerLine) {
    lines.push(`  ${values.slice(index, index + valuesPerLine).map(formatNumber).join(', ')}`);
  }
  return `Object.freeze([\n${lines.join(',\n')}\n])`;
};

const formatVec3Literal = (vector) => `Object.freeze([${vector.map(formatNumber).join(', ')}])`;

const countGltfPrimitiveTriangles = (primitive, gltf) => {
  const mode = primitive.mode ?? 4;
  const positionAccessor = gltf.accessors?.[primitive.attributes?.POSITION];
  const indexAccessor = primitive.indices == null ? null : gltf.accessors?.[primitive.indices];
  const sourceCount = indexAccessor?.count ?? positionAccessor?.count ?? 0;
  if (mode === 4) {
    return Math.floor(sourceCount / 3);
  }
  if (mode === 5 || mode === 6) {
    return Math.max(0, sourceCount - 2);
  }
  return 0;
};

const countGltfTriangles = (gltf) => {
  let triangleCount = 0;
  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      triangleCount += countGltfPrimitiveTriangles(primitive, gltf);
    }
  }
  return triangleCount;
};

const createReferenceModelDataModule = (suzanne, sponza) => {
  const normalizedSuzanne = normalizeReferenceTriangles(suzanne.lowTriangleData);
  return [
    '// Auto-generated by scripts/prepare-reference-model-assets.mjs.',
    '// Do not edit this file directly; update the source assets or generator instead.',
    '',
    'export const SUZANNE_LOW_REFERENCE_MODEL = Object.freeze({',
    "  name: 'Suzanne Low Reference Mesh',",
    "  format: 'obj',",
    "  assetPath: 'assets/models/suzanne_low.obj',",
    "  fullAssetPath: 'assets/models/suzanne.obj',",
    "  source: 'KhronosGroup/glTF-Sample-Assets Models/Suzanne',",
    "  license: 'CC0-1.0',",
    `  triangleCount: ${suzanne.lowTriangles},`,
    `  fullTriangleCount: ${suzanne.fullTriangles},`,
    `  sourceClusterResolution: ${suzanne.lowResolution},`,
    `  normalizedScale: ${formatNumber(normalizedSuzanne.scale)},`,
    `  bounds: Object.freeze({ min: ${formatVec3Literal(normalizedSuzanne.bounds.min)}, max: ${formatVec3Literal(normalizedSuzanne.bounds.max)} }),`,
    `  sourceBounds: Object.freeze({ min: ${formatVec3Literal(normalizedSuzanne.sourceBounds.min)}, max: ${formatVec3Literal(normalizedSuzanne.sourceBounds.max)} }),`,
    `  positions: ${formatNumberArrayLiteral(normalizedSuzanne.positions)},`,
    `  normals: ${formatNumberArrayLiteral(normalizedSuzanne.normals)}`,
    '});',
    '',
    'export const SPONZA_GLB_REFERENCE_MODEL = Object.freeze({',
    "  name: 'Sponza GLB Reference Scene',",
    "  format: 'glb',",
    "  assetPath: 'assets/models/sponza/sponza.glb',",
    "  source: 'KhronosGroup/glTF-Sample-Assets Models/Sponza',",
    "  license: 'LicenseRef-CRYENGINE-Agreement',",
    `  triangleCount: ${sponza.triangleCount},`,
    `  byteLength: ${sponza.bytes}`,
    '});',
    ''
  ].join('\n');
};

const clusterTriangles = (triangles, targetTriangleCount) => {
  const { min, max } = boundsForTriangles(triangles);
  let best = null;

  for (let resolution = 3; resolution <= 32; resolution += 1) {
    const cells = new Map();
    const cellKeyFor = (position) => position.map((component, axis) => {
      const range = max[axis] - min[axis] || 1;
      return Math.max(0, Math.min(resolution - 1, Math.floor(((component - min[axis]) / range) * resolution)));
    }).join(',');

    for (const triangle of triangles) {
      for (const vertex of triangle) {
        const key = cellKeyFor(vertex.position);
        let cell = cells.get(key);
        if (!cell) {
          cell = {
            key,
            position: [0, 0, 0],
            normal: [0, 0, 0],
            texcoord: [0, 0],
            count: 0
          };
          cells.set(key, cell);
        }
        addVec3(cell.position, vertex.position);
        addVec3(cell.normal, vertex.normal || [0, 0, 1]);
        addVec2(cell.texcoord, vertex.texcoord);
        cell.count += 1;
      }
    }

    const vertices = new Map();
    for (const cell of cells.values()) {
      vertices.set(cell.key, {
        position: cell.position.map((value) => value / cell.count),
        normal: normalizeVec3(cell.normal),
        texcoord: cell.texcoord.map((value) => value / cell.count)
      });
    }

    const seenFaces = new Set();
    const clustered = [];
    for (const triangle of triangles) {
      const keys = triangle.map((vertex) => cellKeyFor(vertex.position));
      if (new Set(keys).size !== 3) {
        continue;
      }
      const sortedKey = [...keys].sort().join('|');
      if (seenFaces.has(sortedKey)) {
        continue;
      }
      seenFaces.add(sortedKey);
      clustered.push(keys.map((key) => vertices.get(key)));
    }

    const score = Math.abs(clustered.length - targetTriangleCount) + (clustered.length > targetTriangleCount ? 1000 : 0);
    if (!best || score < best.score) {
      best = { score, resolution, triangles: clustered };
    }
  }

  return best;
};

const prepareSuzanne = async () => {
  const gltf = JSON.parse(await fetchText(`${SUZANNE_BASE}/glTF/Suzanne.gltf`));
  const buffers = await readGltfBuffers(gltf, `${SUZANNE_BASE}/glTF`);
  const triangles = collectTriangles(gltf, buffers);
  const low = clusterTriangles(triangles, 200);
  const header = [
    'Blender Suzanne reference model',
    'Source: KhronosGroup/glTF-Sample-Assets Models/Suzanne',
    'License: CC0-1.0 for model assets',
    'Converted from glTF to OBJ for pathtracer importer smoke and benchmark work'
  ];

  await writeText(path.join(rootAssetsDir, 'suzanne.obj'), trianglesToObj(triangles, [
    ...header,
    `Triangle count: ${triangles.length}`
  ]));
  await writeText(path.join(rootAssetsDir, 'suzanne_low.obj'), trianglesToObj(low.triangles, [
    ...header,
    `Low variant: vertex-clustered ${low.triangles.length} triangle mesh, grid resolution ${low.resolution}`
  ]));
  await writeText(path.join(rootAssetsDir, 'suzanne.LICENSE.md'), await fetchText(`${SUZANNE_BASE}/LICENSE.md`));

  return {
    fullTriangles: triangles.length,
    lowTriangles: low.triangles.length,
    lowResolution: low.resolution,
    lowTriangleData: low.triangles
  };
};

const packGltfToGlb = async (gltfUrl, baseUrl) => {
  const gltf = JSON.parse(await fetchText(gltfUrl));
  const triangleCount = countGltfTriangles(gltf);
  const binParts = [];
  const bufferBaseOffsets = [];
  let totalByteLength = 0;

  for (const bufferDef of gltf.buffers || []) {
    let payload;
    if (bufferDef.uri) {
      const dataUri = parseDataUri(bufferDef.uri);
      payload = dataUri ? dataUri.payload : await fetchBuffer(`${baseUrl}/${bufferDef.uri}`);
    } else {
      payload = Buffer.alloc(0);
    }
    totalByteLength = align4(totalByteLength);
    bufferBaseOffsets.push(totalByteLength);
    binParts.push({ offset: totalByteLength, payload: paddedBuffer(payload) });
    totalByteLength += align4(payload.length);
  }

  for (const bufferView of gltf.bufferViews || []) {
    const bufferIndex = bufferView.buffer || 0;
    bufferView.buffer = 0;
    bufferView.byteOffset = (bufferView.byteOffset || 0) + (bufferBaseOffsets[bufferIndex] || 0);
  }

  for (const image of gltf.images || []) {
    if (!image.uri) {
      continue;
    }
    const dataUri = parseDataUri(image.uri);
    const payload = dataUri ? dataUri.payload : await fetchBuffer(`${baseUrl}/${image.uri}`);
    const mimeType = image.mimeType || dataUri?.mimeType || extensionMimeType(image.uri);
    totalByteLength = align4(totalByteLength);
    const bufferViewIndex = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: totalByteLength,
      byteLength: payload.length
    });
    binParts.push({ offset: totalByteLength, payload: paddedBuffer(payload) });
    totalByteLength += align4(payload.length);
    delete image.uri;
    image.mimeType = mimeType;
    image.bufferView = bufferViewIndex;
  }

  gltf.buffers = [{ byteLength: totalByteLength }];
  gltf.asset = {
    ...gltf.asset,
    generator: `${gltf.asset?.generator || 'unknown'}; pathtracer reference asset packer`
  };

  const binChunk = Buffer.alloc(totalByteLength);
  for (const part of binParts) {
    part.payload.copy(binChunk, part.offset);
  }

  const jsonChunk = paddedBuffer(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const header = Buffer.alloc(12);
  const jsonHeader = Buffer.alloc(8);
  const binHeader = Buffer.alloc(8);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;

  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  return {
    buffer: Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]),
    triangleCount
  };
};

const prepareSponza = async () => {
  const sponzaDir = path.join(rootAssetsDir, 'sponza');
  await ensureDir(sponzaDir);
  const glb = await packGltfToGlb(`${SPONZA_BASE}/glTF/Sponza.gltf`, `${SPONZA_BASE}/glTF`);
  await writeBinary(path.join(sponzaDir, 'sponza.glb'), glb.buffer);
  await writeText(path.join(sponzaDir, 'LICENSE.md'), await fetchText(`${SPONZA_BASE}/LICENSE.md`));
  await writeText(path.join(sponzaDir, 'README.upstream.md'), await fetchText(`${SPONZA_BASE}/README.md`));

  return { bytes: glb.buffer.length, triangleCount: glb.triangleCount };
};

const writeReferenceModelData = async (suzanne, sponza) => {
  const moduleSource = createReferenceModelDataModule(suzanne, sponza);
  await writeText(path.join(rootSourceDir, 'referenceModelData.js'), moduleSource);
  await writeText(path.join(docsSourceDir, 'referenceModelData.js'), moduleSource);
};

const mirrorToDocs = async () => {
  await rm(docsAssetsDir, { recursive: true, force: true });
  await ensureDir(docsAssetsDir);
  const copyRecursive = async (sourceDir, targetDir) => {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await ensureDir(targetPath);
        await copyRecursive(sourcePath, targetPath);
      } else if (entry.isFile()) {
        await ensureDir(path.dirname(targetPath));
        await writeFile(targetPath, await readFile(sourcePath));
      }
    }
  };
  await copyRecursive(rootAssetsDir, docsAssetsDir);
};

await ensureDir(rootAssetsDir);

const suzanne = await prepareSuzanne();
const sponza = await prepareSponza();
await mirrorToDocs();
await writeReferenceModelData(suzanne, sponza);

console.log(`Prepared suzanne.obj (${suzanne.fullTriangles} triangles)`);
console.log(`Prepared suzanne_low.obj (${suzanne.lowTriangles} triangles, grid ${suzanne.lowResolution})`);
console.log(`Prepared sponza/sponza.glb (${sponza.bytes} bytes, ${sponza.triangleCount} triangles)`);
console.log('Prepared src/referenceModelData.js');
