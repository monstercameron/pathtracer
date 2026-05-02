import {
  DEFAULT_UV,
  PATH_TRACER_MATERIAL,
  clampNumber,
  cloneColor,
  createTriangle,
  normalizeVector3
} from './geometry.js';

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;

const PRIMITIVE_MODE_TRIANGLES = 4;
const PRIMITIVE_MODE_TRIANGLE_STRIP = 5;
const PRIMITIVE_MODE_TRIANGLE_FAN = 6;

const ACCESSOR_COMPONENT_COUNTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
});

const COMPONENT_TYPES = Object.freeze({
  5120: {
    size: 1,
    read: (view, offset) => view.getInt8(offset),
    normalize: (value) => Math.max(value / 127, -1)
  },
  5121: {
    size: 1,
    read: (view, offset) => view.getUint8(offset),
    normalize: (value) => value / 255
  },
  5122: {
    size: 2,
    read: (view, offset) => view.getInt16(offset, true),
    normalize: (value) => Math.max(value / 32767, -1)
  },
  5123: {
    size: 2,
    read: (view, offset) => view.getUint16(offset, true),
    normalize: (value) => value / 65535
  },
  5125: {
    size: 4,
    read: (view, offset) => view.getUint32(offset, true),
    normalize: (value) => value / 4294967295
  },
  5126: {
    size: 4,
    read: (view, offset) => view.getFloat32(offset, true),
    normalize: (value) => value
  }
});

const DEFAULT_BASE_COLOR = Object.freeze([1, 1, 1, 1]);

const toUint8Array = (input) => {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
};

const isBinaryInput = (input) => input instanceof ArrayBuffer || ArrayBuffer.isView(input);

const decodeUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);

const looksLikeGlb = (bytes) => {
  if (!bytes || bytes.byteLength < 12) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === GLB_MAGIC;
};

const isDataUri = (uri) => /^data:/i.test(uri);

const decodeBase64 = (data) => {
  const normalized = data.replace(/\s/g, '');
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalized, 'base64'));
  }
  throw new Error('Base64 GLTF data URI decoding is not available in this environment.');
};

const decodeDataUri = (uri) => {
  const match = /^data:([^,]*),(.*)$/is.exec(uri);
  if (!match) {
    throw new SyntaxError('Invalid GLTF data URI.');
  }
  const [, metadata, data] = match;
  if (/(^|;)base64($|;)/i.test(metadata)) {
    return decodeBase64(data);
  }

  const decoded = decodeURIComponent(data);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index) & 0xff;
  }
  return bytes;
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const getProvidedBuffer = (buffers, bufferDef, index) => {
  if (!buffers) {
    return null;
  }
  if (isBinaryInput(buffers)) {
    return index === 0 ? buffers : null;
  }
  if (Array.isArray(buffers)) {
    return buffers[index] || null;
  }
  if (typeof buffers !== 'object') {
    return null;
  }

  const keys = [index, String(index)];
  if (bufferDef?.uri) {
    keys.push(bufferDef.uri);
    try {
      keys.push(decodeURIComponent(bufferDef.uri));
    } catch {
      // Keep the original URI key if it is not percent-encoded cleanly.
    }
  }
  if (bufferDef?.name) {
    keys.push(bufferDef.name);
  }

  for (const key of keys) {
    if (hasOwn(buffers, key)) {
      return buffers[key];
    }
  }
  return null;
};

const createMutableBufferMap = (buffers) => {
  if (!buffers) {
    return {};
  }
  if (isBinaryInput(buffers)) {
    return { 0: buffers };
  }
  if (Array.isArray(buffers)) {
    return buffers.reduce((map, buffer, index) => {
      map[index] = buffer;
      return map;
    }, {});
  }
  if (typeof buffers === 'object') {
    return { ...buffers };
  }
  return {};
};

const resolveBuffers = (gltf, options, warnings) => {
  const bufferDefs = gltf.buffers || [];
  return bufferDefs.map((bufferDef, index) => {
    let input = null;
    if (bufferDef.uri) {
      input = isDataUri(bufferDef.uri)
        ? decodeDataUri(bufferDef.uri)
        : getProvidedBuffer(options.buffers, bufferDef, index);
    } else {
      input = getProvidedBuffer(options.buffers, bufferDef, index)
        || options.embeddedBuffers?.[index]
        || null;
    }

    const bytes = toUint8Array(input);
    if (!bytes) {
      const uriLabel = bufferDef.uri ? `"${bufferDef.uri}"` : index;
      throw new Error(`Missing GLTF buffer ${uriLabel}. Pass it via options.buffers or use loadGltfFromUrl().`);
    }

    if (Number.isFinite(bufferDef.byteLength) && bytes.byteLength < bufferDef.byteLength) {
      throw new RangeError(`GLTF buffer ${index} is shorter than its declared byteLength.`);
    }
    if (Number.isFinite(bufferDef.byteLength) && bytes.byteLength > bufferDef.byteLength) {
      warnings.push(`GLTF buffer ${index} contains trailing bytes after its declared byteLength.`);
    }
    return bytes;
  });
};

const getAccessorComponentInfo = (componentType) => {
  const info = COMPONENT_TYPES[componentType];
  if (!info) {
    throw new SyntaxError(`Unsupported GLTF accessor componentType "${componentType}".`);
  }
  return info;
};

const getAccessorComponentCount = (type) => {
  const componentCount = ACCESSOR_COMPONENT_COUNTS[type];
  if (!componentCount) {
    throw new SyntaxError(`Unsupported GLTF accessor type "${type}".`);
  }
  return componentCount;
};

const readItemsFromBufferView = ({
  context,
  accessorIndex,
  bufferViewIndex,
  byteOffset,
  count,
  componentType,
  type,
  normalized
}) => {
  const bufferView = context.gltf.bufferViews?.[bufferViewIndex];
  if (!bufferView) {
    throw new SyntaxError(`GLTF accessor ${accessorIndex} references missing bufferView ${bufferViewIndex}.`);
  }
  const buffer = context.buffers[bufferView.buffer];
  if (!buffer) {
    throw new SyntaxError(`GLTF bufferView ${bufferViewIndex} references missing buffer ${bufferView.buffer}.`);
  }

  const componentInfo = getAccessorComponentInfo(componentType);
  const componentCount = getAccessorComponentCount(type);
  const itemSize = componentInfo.size * componentCount;
  const stride = bufferView.byteStride || itemSize;
  if (stride < itemSize) {
    throw new RangeError(`GLTF bufferView ${bufferViewIndex} byteStride is smaller than accessor ${accessorIndex} item size.`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const startOffset = (bufferView.byteOffset || 0) + (byteOffset || 0);
  const values = [];
  for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
    const itemOffset = startOffset + itemIndex * stride;
    if (itemOffset + itemSize > buffer.byteLength) {
      throw new RangeError(`GLTF accessor ${accessorIndex} reads beyond buffer ${bufferView.buffer}.`);
    }
    const item = [];
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
      const rawValue = componentInfo.read(view, itemOffset + componentIndex * componentInfo.size);
      item.push(normalized ? componentInfo.normalize(rawValue) : rawValue);
    }
    values.push(item);
  }
  return values;
};

const createZeroAccessorValues = (count, type) => {
  const componentCount = getAccessorComponentCount(type);
  return Array.from({ length: count }, () => Array(componentCount).fill(0));
};

const readAccessor = (context, accessorIndex) => {
  if (context.accessorCache.has(accessorIndex)) {
    return context.accessorCache.get(accessorIndex);
  }

  const accessor = context.gltf.accessors?.[accessorIndex];
  if (!accessor) {
    throw new SyntaxError(`Missing GLTF accessor ${accessorIndex}.`);
  }
  const count = accessor.count || 0;
  const type = accessor.type || 'SCALAR';
  let values = accessor.bufferView === undefined
    ? createZeroAccessorValues(count, type)
    : readItemsFromBufferView({
      context,
      accessorIndex,
      bufferViewIndex: accessor.bufferView,
      byteOffset: accessor.byteOffset || 0,
      count,
      componentType: accessor.componentType,
      type,
      normalized: Boolean(accessor.normalized)
    });

  if (accessor.bufferView === undefined && !accessor.sparse) {
    context.warnings.push(`GLTF accessor ${accessorIndex} has no bufferView; using zero-filled ${type} data.`);
  }

  if (accessor.sparse) {
    const sparse = accessor.sparse;
    const sparseIndices = readItemsFromBufferView({
      context,
      accessorIndex,
      bufferViewIndex: sparse.indices.bufferView,
      byteOffset: sparse.indices.byteOffset || 0,
      count: sparse.count || 0,
      componentType: sparse.indices.componentType,
      type: 'SCALAR',
      normalized: false
    }).map((item) => item[0]);
    const sparseValues = readItemsFromBufferView({
      context,
      accessorIndex,
      bufferViewIndex: sparse.values.bufferView,
      byteOffset: sparse.values.byteOffset || 0,
      count: sparse.count || 0,
      componentType: accessor.componentType,
      type,
      normalized: Boolean(accessor.normalized)
    });
    values = values.slice();
    for (let index = 0; index < sparseIndices.length; index += 1) {
      values[sparseIndices[index]] = sparseValues[index];
    }
  }

  context.accessorCache.set(accessorIndex, values);
  return values;
};

const normalizeTextureInfo = (textureInfo) => {
  if (!textureInfo || !Number.isInteger(textureInfo.index)) {
    return null;
  }
  return {
    index: textureInfo.index,
    texCoord: Number.isInteger(textureInfo.texCoord) ? textureInfo.texCoord : 0
  };
};

const createBaseColorFactor = (factor = DEFAULT_BASE_COLOR) => [
  clampNumber(factor[0], 0, 1, 1),
  clampNumber(factor[1], 0, 1, 1),
  clampNumber(factor[2], 0, 1, 1),
  clampNumber(factor[3], 0, 1, 1)
];

const classifyGltfMaterial = ({ alphaMode, opacity, metallicFactor, roughnessFactor }) => {
  if (alphaMode === 'BLEND' || opacity < 0.98) {
    return PATH_TRACER_MATERIAL.GLASS;
  }
  if (metallicFactor >= 0.95 && roughnessFactor <= 0.05) {
    return PATH_TRACER_MATERIAL.MIRROR;
  }
  if (metallicFactor > 0.05 || roughnessFactor < 0.95) {
    return PATH_TRACER_MATERIAL.GGX_PBR;
  }
  return PATH_TRACER_MATERIAL.DIFFUSE;
};

const makeUniqueMaterialName = (baseName, materials) => {
  let name = baseName;
  let suffix = 2;
  while (hasOwn(materials, name)) {
    name = `${baseName}_${suffix}`;
    suffix += 1;
  }
  return name;
};

const createGltfMaterial = (sourceMaterial, sourceIndex, materials) => {
  const pbr = sourceMaterial.pbrMetallicRoughness || {};
  const baseColorFactor = createBaseColorFactor(pbr.baseColorFactor);
  const opacity = baseColorFactor[3];
  const metallicFactor = clampNumber(pbr.metallicFactor ?? 1, 0, 1, 1);
  const roughnessFactor = clampNumber(pbr.roughnessFactor ?? 1, 0.02, 1, 1);
  const alphaMode = sourceMaterial.alphaMode || 'OPAQUE';
  const materialName = makeUniqueMaterialName(
    (sourceMaterial.name || `material_${sourceIndex}`).trim() || `material_${sourceIndex}`,
    materials
  );
  const pathTracerMaterial = classifyGltfMaterial({
    alphaMode,
    opacity,
    metallicFactor,
    roughnessFactor
  });
  const baseColorTexture = normalizeTextureInfo(pbr.baseColorTexture);
  const metallicRoughnessTexture = normalizeTextureInfo(pbr.metallicRoughnessTexture);
  const normalTexture = normalizeTextureInfo(sourceMaterial.normalTexture);
  const occlusionTexture = normalizeTextureInfo(sourceMaterial.occlusionTexture);
  const emissiveTexture = normalizeTextureInfo(sourceMaterial.emissiveTexture);

  return {
    name: materialName,
    sourceIndex,
    diffuseColor: cloneColor(baseColorFactor),
    baseColorFactor,
    opacity,
    alphaMode,
    alphaCutoff: clampNumber(sourceMaterial.alphaCutoff ?? 0.5, 0, 1, 0.5),
    metallicFactor,
    roughness: roughnessFactor,
    roughnessFactor,
    glossiness: clampNumber(1 - roughnessFactor, 0, 1, 0),
    emissiveColor: cloneColor(sourceMaterial.emissiveFactor || [0, 0, 0]),
    doubleSided: Boolean(sourceMaterial.doubleSided),
    baseColorTexture,
    diffuseTexture: baseColorTexture,
    metallicRoughnessTexture,
    normalTexture,
    occlusionTexture,
    emissiveTexture,
    isTextured: Boolean(
      baseColorTexture
      || metallicRoughnessTexture
      || normalTexture
      || occlusionTexture
      || emissiveTexture
    ),
    pathTracerMaterial,
    material: pathTracerMaterial
  };
};

const buildMaterials = (gltf) => {
  const materials = {};
  const materialOrder = [];
  const materialNamesByIndex = [];
  for (let index = 0; index < (gltf.materials || []).length; index += 1) {
    const material = createGltfMaterial(gltf.materials[index] || {}, index, materials);
    materials[material.name] = material;
    materialOrder.push(material.name);
    materialNamesByIndex[index] = material.name;
  }
  return {
    materials,
    materialOrder,
    materialNamesByIndex
  };
};

const createSequentialIndices = (count) => Array.from({ length: count }, (_, index) => index);

const buildTriangleIndexGroups = (indices, mode, warnings, label) => {
  const groups = [];
  if (mode === undefined || mode === PRIMITIVE_MODE_TRIANGLES) {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      groups.push([indices[index], indices[index + 1], indices[index + 2]]);
    }
    if (indices.length % 3 !== 0) {
      warnings.push(`${label} has trailing vertex indices that do not form a triangle.`);
    }
    return groups;
  }

  if (mode === PRIMITIVE_MODE_TRIANGLE_STRIP) {
    for (let index = 0; index + 2 < indices.length; index += 1) {
      groups.push(index % 2 === 0
        ? [indices[index], indices[index + 1], indices[index + 2]]
        : [indices[index + 1], indices[index], indices[index + 2]]);
    }
    return groups;
  }

  if (mode === PRIMITIVE_MODE_TRIANGLE_FAN) {
    for (let index = 1; index + 1 < indices.length; index += 1) {
      groups.push([indices[0], indices[index], indices[index + 1]]);
    }
    return groups;
  }

  warnings.push(`${label} uses unsupported primitive mode ${mode}; only triangles, triangle strips, and triangle fans are loaded.`);
  return groups;
};

const createPrimitiveLabel = (meshName, meshIndex, primitiveIndex) => (
  `${meshName || `mesh_${meshIndex}`} primitive ${primitiveIndex}`
);

const buildPrimitive = (context, mesh, meshIndex, primitive, primitiveIndex) => {
  const meshName = mesh.name || `mesh_${meshIndex}`;
  const label = createPrimitiveLabel(mesh.name, meshIndex, primitiveIndex);
  if (!primitive.attributes || primitive.attributes.POSITION === undefined) {
    context.warnings.push(`Skipped ${label} because it has no POSITION accessor.`);
    return null;
  }

  let positions;
  try {
    positions = readAccessor(context, primitive.attributes.POSITION);
  } catch (error) {
    context.warnings.push(`Skipped ${label}: ${error.message}`);
    return null;
  }

  let normals = null;
  if (primitive.attributes.NORMAL !== undefined) {
    try {
      normals = readAccessor(context, primitive.attributes.NORMAL)
        .map((normal) => normalizeVector3(normal));
    } catch (error) {
      context.warnings.push(`Ignored NORMAL data for ${label}: ${error.message}`);
    }
  }

  let uvs = null;
  if (primitive.attributes.TEXCOORD_0 !== undefined) {
    try {
      uvs = readAccessor(context, primitive.attributes.TEXCOORD_0);
    } catch (error) {
      context.warnings.push(`Ignored TEXCOORD_0 data for ${label}: ${error.message}`);
    }
  }

  let indices = createSequentialIndices(positions.length);
  if (primitive.indices !== undefined) {
    try {
      indices = readAccessor(context, primitive.indices).map((item) => Math.trunc(item[0]));
    } catch (error) {
      context.warnings.push(`Skipped ${label}: ${error.message}`);
      return null;
    }
  }

  const materialIndex = Number.isInteger(primitive.material) ? primitive.material : null;
  const materialName = materialIndex === null ? null : context.materialNamesByIndex[materialIndex] || null;
  const triangleIndexGroups = buildTriangleIndexGroups(indices, primitive.mode, context.warnings, label);
  const triangles = [];
  for (const triangleIndices of triangleIndexGroups) {
    if (new Set(triangleIndices).size < 3) {
      continue;
    }
    const trianglePositions = triangleIndices.map((index) => positions[index]);
    if (trianglePositions.some((position) => !position)) {
      context.warnings.push(`Skipped ${label} triangle with an out-of-range vertex index.`);
      continue;
    }
    const triangleNormals = normals ? triangleIndices.map((index) => normals[index]).filter(Boolean) : null;
    const triangleUvs = uvs ? triangleIndices.map((index) => uvs[index] || DEFAULT_UV) : null;
    const triangle = createTriangle({
      positions: trianglePositions,
      normals: triangleNormals && triangleNormals.length === 3 ? triangleNormals : null,
      uvs: triangleUvs && triangleUvs.length === 3 ? triangleUvs : null,
      materialName,
      objectName: meshName,
      groupName: `${meshName}/primitive_${primitiveIndex}`
    });
    triangle.meshIndex = meshIndex;
    triangle.primitiveIndex = primitiveIndex;
    triangle.materialIndex = materialIndex;
    triangles.push(triangle);
  }

  return {
    sourceIndex: primitiveIndex,
    mode: primitive.mode ?? PRIMITIVE_MODE_TRIANGLES,
    attributes: { ...primitive.attributes },
    materialIndex,
    materialName,
    positions,
    normals,
    uvs,
    indices,
    triangles,
    triangleCount: triangles.length
  };
};

const buildMeshes = (context) => {
  const meshes = [];
  const triangles = [];
  for (let meshIndex = 0; meshIndex < (context.gltf.meshes || []).length; meshIndex += 1) {
    const mesh = context.gltf.meshes[meshIndex] || {};
    const meshResult = {
      sourceIndex: meshIndex,
      name: mesh.name || `mesh_${meshIndex}`,
      primitives: []
    };

    for (let primitiveIndex = 0; primitiveIndex < (mesh.primitives || []).length; primitiveIndex += 1) {
      const primitiveResult = buildPrimitive(context, mesh, meshIndex, mesh.primitives[primitiveIndex] || {}, primitiveIndex);
      if (!primitiveResult) {
        continue;
      }
      meshResult.primitives.push(primitiveResult);
      triangles.push(...primitiveResult.triangles);
    }
    meshes.push(meshResult);
  }
  return {
    meshes,
    triangles
  };
};

const normalizeGltfJson = (input) => {
  if (typeof input === 'string') {
    return JSON.parse(input);
  }
  if (input && typeof input === 'object' && !isBinaryInput(input)) {
    return input;
  }
  throw new TypeError('GltfLoader.parseJson() expects a GLTF JSON string or object.');
};

const createGltfResult = ({
  gltf,
  encoding,
  buffers,
  meshes,
  materials,
  materialOrder,
  triangles,
  warnings
}) => ({
  format: 'gltf',
  encoding,
  version: gltf.asset?.version || null,
  generator: gltf.asset?.generator || null,
  asset: gltf.asset || {},
  scene: Number.isInteger(gltf.scene) ? gltf.scene : null,
  scenes: gltf.scenes || [],
  nodes: gltf.nodes || [],
  bufferViews: gltf.bufferViews || [],
  accessors: gltf.accessors || [],
  bufferCount: buffers.length,
  meshes,
  materials,
  materialOrder,
  triangles,
  warnings,
  triangleCount: triangles.length
});

export class GltfLoader {
  constructor(options = {}) {
    this.options = options;
  }

  parse(input, parseOptions = {}) {
    const options = {
      ...this.options,
      ...parseOptions
    };
    if (typeof input === 'string' || (input && typeof input === 'object' && !isBinaryInput(input))) {
      return this.parseJson(input, options);
    }

    const bytes = toUint8Array(input);
    if (!bytes) {
      throw new TypeError('GltfLoader.parse() expects a GLTF JSON string/object, ArrayBuffer, DataView, or typed array.');
    }
    if (looksLikeGlb(bytes)) {
      return this.parseGlb(bytes, options);
    }
    return this.parseJson(decodeUtf8(bytes), options);
  }

  parseJson(input, parseOptions = {}) {
    const options = {
      ...this.options,
      ...parseOptions
    };
    const gltf = normalizeGltfJson(input);
    const warnings = [...(options.warnings || [])];
    if (gltf.asset?.version && !String(gltf.asset.version).startsWith('2.')) {
      warnings.push(`GLTF asset version "${gltf.asset.version}" may not be compatible with this GLTF 2.0 loader.`);
    }

    const materialResult = buildMaterials(gltf);
    const buffers = resolveBuffers(gltf, options, warnings);
    const context = {
      gltf,
      buffers,
      warnings,
      accessorCache: new Map(),
      materialNamesByIndex: materialResult.materialNamesByIndex
    };
    const meshResult = buildMeshes(context);

    return createGltfResult({
      gltf,
      encoding: options.encoding || 'json',
      buffers,
      meshes: meshResult.meshes,
      materials: materialResult.materials,
      materialOrder: materialResult.materialOrder,
      triangles: meshResult.triangles,
      warnings
    });
  }

  parseGlb(input, parseOptions = {}) {
    const options = {
      ...this.options,
      ...parseOptions
    };
    const bytes = toUint8Array(input);
    if (!bytes) {
      throw new TypeError('GltfLoader.parseGlb() expects an ArrayBuffer, DataView, or typed array.');
    }
    if (bytes.byteLength < 20) {
      throw new RangeError('GLB input is too small to contain a header and JSON chunk.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) {
      throw new SyntaxError('GLB header is missing the glTF magic value.');
    }
    const version = view.getUint32(4, true);
    if (version !== 2) {
      throw new SyntaxError(`Unsupported GLB version ${version}; only GLB 2.0 is supported.`);
    }
    const declaredLength = view.getUint32(8, true);
    if (declaredLength > bytes.byteLength) {
      throw new RangeError('GLB declared length exceeds the supplied byte length.');
    }

    const warnings = [...(options.warnings || [])];
    if (declaredLength < bytes.byteLength) {
      warnings.push('GLB contains trailing bytes after its declared length.');
    }

    let json = null;
    const embeddedBuffers = [];
    let offset = 12;
    while (offset + 8 <= declaredLength) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkLength;
      if (chunkEnd > declaredLength) {
        throw new RangeError('GLB chunk length exceeds the declared GLB length.');
      }

      const chunkBytes = bytes.slice(chunkStart, chunkEnd);
      if (chunkType === GLB_JSON_CHUNK_TYPE) {
        json = JSON.parse(decodeUtf8(chunkBytes).replace(/\0+$/g, '').trimEnd());
      } else if (chunkType === GLB_BIN_CHUNK_TYPE) {
        embeddedBuffers.push(chunkBytes);
      } else {
        warnings.push(`Ignored unsupported GLB chunk type ${chunkType}.`);
      }
      offset = chunkEnd;
    }

    if (!json) {
      throw new SyntaxError('GLB input is missing a JSON chunk.');
    }

    const buffers = createMutableBufferMap(options.buffers);
    if (embeddedBuffers[0] && !hasOwn(buffers, 0)) {
      buffers[0] = embeddedBuffers[0];
    }

    return this.parseJson(json, {
      ...options,
      buffers,
      embeddedBuffers,
      warnings,
      encoding: 'glb'
    });
  }
}

const resolveSiblingUrl = (url, siblingPath) => {
  try {
    return new URL(siblingPath, url).toString();
  } catch {
    return siblingPath;
  }
};

const fetchOrThrow = async (url, fetchImpl) => {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('loadGltfFromUrl() requires a fetch implementation.');
  }
  const response = await fetchImpl(url);
  if (!response || !response.ok) {
    throw new Error(`Failed to fetch GLTF asset: ${url}`);
  }
  return response;
};

export const parseGltfJson = (input, options = {}) => new GltfLoader(options).parseJson(input, options);

export const loadGltfFromText = parseGltfJson;

export const parseGlb = (input, options = {}) => new GltfLoader(options).parseGlb(input, options);

export const loadGltfFromBinary = (input, options = {}) => new GltfLoader(options).parse(input, options);

export const loadGltfFromUrl = async (url, options = {}) => {
  const fetchImpl = options.fetch || globalThis.fetch;
  const response = await fetchOrThrow(url, fetchImpl);
  const contentType = response.headers?.get?.('content-type') || '';
  const isGlb = /\.glb(?:$|[?#])/i.test(url) || /model\/gltf-binary/i.test(contentType);
  if (isGlb) {
    return new GltfLoader(options).parseGlb(await response.arrayBuffer(), options);
  }

  const text = await response.text();
  if (options.loadBuffers === false) {
    return new GltfLoader(options).parseJson(text, options);
  }

  const gltf = JSON.parse(text);
  const buffers = createMutableBufferMap(options.buffers);
  await Promise.all((gltf.buffers || []).map(async (bufferDef, index) => {
    if (!bufferDef.uri || isDataUri(bufferDef.uri) || getProvidedBuffer(buffers, bufferDef, index)) {
      return;
    }
    const bufferUrl = resolveSiblingUrl(url, bufferDef.uri);
    const bufferResponse = await fetchOrThrow(bufferUrl, fetchImpl);
    buffers[bufferDef.uri] = await bufferResponse.arrayBuffer();
  }));

  return new GltfLoader(options).parseJson(gltf, {
    ...options,
    buffers,
    encoding: 'json'
  });
};

export const parseGltf = (input, options = {}) => new GltfLoader(options).parse(input, options);
