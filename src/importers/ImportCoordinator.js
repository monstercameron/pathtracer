import { GltfLoader } from '../loaders/GltfLoader.js';
import { MeshRecord } from '../loaders/MeshRecord.js';
import { ObjParser } from '../loaders/ObjParser.js';
import { PlyParser } from '../loaders/PlyParser.js';
import { StlParser } from '../loaders/StlParser.js';

const PRIMARY_EXTENSIONS = new Set(['obj', 'gltf', 'glb', 'stl', 'ply']);
const GLTF_BUFFER_EXTENSIONS = new Set(['bin']);
const TEXTURE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tga',
  'tif',
  'tiff',
  'exr',
  'hdr',
  'ktx',
  'ktx2'
]);
const COMPANION_EXTENSIONS = new Set(['mtl', ...GLTF_BUFFER_EXTENSIONS, ...TEXTURE_EXTENSIONS]);

const TEXT_DECODER = new TextDecoder('utf-8');
const TEXT_ENCODER = new TextEncoder();
const MISSING_TEXTURE_FALLBACK_KEY = 'fallback:missing-texture-checker';
const MISSING_TEXTURE_FALLBACK_BYTES = new Uint8Array([
  204, 204, 204, 255,
  128, 128, 128, 255,
  128, 128, 128, 255,
  204, 204, 204, 255
]);

const toArrayBuffer = (input) => {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  return null;
};

const normalizePath = (path) => String(path || '')
  .replace(/\\/g, '/')
  .split('/')
  .filter((part) => part && part !== '.')
  .reduce((parts, part) => {
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
    return parts;
  }, [])
  .join('/');

const getBaseName = (path) => {
  const normalizedPath = normalizePath(path);
  const slashIndex = normalizedPath.lastIndexOf('/');
  return slashIndex === -1 ? normalizedPath : normalizedPath.slice(slashIndex + 1);
};

const getDirName = (path) => {
  const normalizedPath = normalizePath(path);
  const slashIndex = normalizedPath.lastIndexOf('/');
  return slashIndex === -1 ? '' : normalizedPath.slice(0, slashIndex);
};

const getStem = (name) => {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
};

const addToMultiMap = (map, key, value) => {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
};

const isDroppedFileLike = (value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Boolean(
    value.name
    || value.fileName
    || value.webkitRelativePath
    || value.relativePath
    || value.path
    || typeof value.arrayBuffer === 'function'
    || typeof value.text === 'function'
    || Object.prototype.hasOwnProperty.call(value, 'content')
    || Object.prototype.hasOwnProperty.call(value, 'data')
    || Object.prototype.hasOwnProperty.call(value, 'bytes')
    || Object.prototype.hasOwnProperty.call(value, 'buffer')
  );
};

const listItems = (value) => {
  if (!value || typeof value === 'string') {
    return [];
  }
  if (typeof value[Symbol.iterator] === 'function') {
    return Array.from(value).filter(Boolean);
  }
  const length = Number(value.length);
  if (!Number.isInteger(length) || length < 0) {
    return [];
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const item = typeof value.item === 'function' ? value.item(index) : value[index];
    if (item) {
      items.push(item);
    }
  }
  return items;
};

const getFileFromDataTransferItem = (item) => {
  if (!item) {
    return null;
  }
  if (item.kind && item.kind !== 'file') {
    return null;
  }
  if (typeof item.getAsFile === 'function') {
    return item.getAsFile();
  }
  return isDroppedFileLike(item) ? item : null;
};

const createSourceFileInfo = (record) => ({
  name: record.name,
  path: record.path,
  extension: record.extension,
  type: record.type,
  size: record.size
});

const createTextureAssetInfo = (asset) => ({
  cacheKey: asset.cacheKey,
  status: asset.status,
  name: asset.name,
  path: asset.path,
  extension: asset.extension,
  type: asset.type,
  size: asset.size,
  byteLength: asset.byteLength,
  width: asset.width || null,
  height: asset.height || null,
  channels: asset.channels || null,
  format: asset.format || null,
  colorSpace: asset.colorSpace || null,
  sourceFile: asset.sourceFile || null,
  fallback: asset.fallback || null
});

const createTextureCacheKey = (record) => (
  `file:${(record.path || record.name || `texture-${record.index}`).toLowerCase()}`
);

const createMissingTextureAsset = () => ({
  cacheKey: MISSING_TEXTURE_FALLBACK_KEY,
  status: 'fallback',
  name: 'missing-texture-checker',
  path: MISSING_TEXTURE_FALLBACK_KEY,
  extension: 'raw',
  type: 'image/raw-rgba8',
  size: MISSING_TEXTURE_FALLBACK_BYTES.byteLength,
  byteLength: MISSING_TEXTURE_FALLBACK_BYTES.byteLength,
  width: 2,
  height: 2,
  channels: 4,
  format: 'rgba8',
  colorSpace: 'srgb',
  fallback: 'missingTextureChecker',
  sourceFile: null,
  data: MISSING_TEXTURE_FALLBACK_BYTES.slice()
});

const getMissingTextureAsset = (fileIndex) => {
  if (!fileIndex.textureAssetCache.has(MISSING_TEXTURE_FALLBACK_KEY)) {
    fileIndex.textureAssetCache.set(MISSING_TEXTURE_FALLBACK_KEY, createMissingTextureAsset());
  }
  return fileIndex.textureAssetCache.get(MISSING_TEXTURE_FALLBACK_KEY);
};

const loadTextureRecordAsset = async (fileIndex, record) => {
  const cacheKey = createTextureCacheKey(record);
  if (fileIndex.textureAssetCache.has(cacheKey)) {
    return fileIndex.textureAssetCache.get(cacheKey);
  }

  const arrayBuffer = await readFileAsArrayBuffer(record.file);
  const asset = {
    cacheKey,
    status: 'loaded',
    name: record.name,
    path: record.path,
    extension: record.extension,
    type: record.type || '',
    size: record.size,
    byteLength: arrayBuffer.byteLength,
    width: null,
    height: null,
    channels: null,
    format: null,
    colorSpace: 'srgb',
    fallback: null,
    sourceFile: createSourceFileInfo(record),
    arrayBuffer
  };
  fileIndex.textureAssetCache.set(cacheKey, asset);
  return asset;
};

const uniqueTextureAssets = (assets) => {
  const seen = new Set();
  const unique = [];
  for (const asset of assets || []) {
    if (!asset || seen.has(asset.cacheKey)) {
      continue;
    }
    seen.add(asset.cacheKey);
    unique.push(asset);
  }
  return unique;
};

const resolveMeshFitOptions = (options) => {
  const meshOptions = options.meshOptions || {};
  return {
    ...(meshOptions.fit || {}),
    ...(meshOptions.fitOptions || {}),
    ...(meshOptions.targetSize !== undefined ? { targetSize: meshOptions.targetSize } : {}),
    ...(meshOptions.targetCenter !== undefined ? { targetCenter: meshOptions.targetCenter } : {}),
    ...(meshOptions.center !== undefined ? { center: meshOptions.center } : {})
  };
};

const readNowMilliseconds = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const normalizeOptionalNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const createImportMeshRecord = ({
  format,
  primaryRecord,
  sourceFiles,
  result,
  options
}) => new MeshRecord({
  format,
  name: options.meshOptions?.name || result?.name || primaryRecord.stem || getStem(primaryRecord.name),
  sourceFile: createSourceFileInfo(primaryRecord),
  sourceFiles,
  triangles: result?.triangles || [],
  materials: result?.materials || {},
  materialOrder: result?.materialOrder || null,
  fitOptions: resolveMeshFitOptions(options)
});

const attachMeshRecordToResult = (result, meshRecord, meshMetadata) => {
  if (!result || typeof result !== 'object') {
    return {
      meshFitMilliseconds: null
    };
  }
  const fitStartedAt = readNowMilliseconds();
  const fittedTriangles = meshRecord.createFittedTriangles();
  const meshFitMilliseconds = readNowMilliseconds() - fitStartedAt;
  result.meshRecord = meshRecord;
  result.meshMetadata = meshMetadata;
  result.bounds = meshMetadata.bounds;
  result.fit = meshMetadata.fit;
  result.normalization = meshMetadata.normalization;
  result.fittedTriangles = fittedTriangles;
  result.normalizedTriangles = fittedTriangles;
  result.estimatedCpuBytes = meshMetadata.estimatedCpuBytes;
  result.meshTimings = {
    ...(result.meshTimings || {}),
    meshFitMilliseconds
  };
  return {
    meshFitMilliseconds
  };
};

const createParsedImport = ({
  format,
  primaryRecord,
  companionRecords = [],
  textureRecords = [],
  textureAssets = [],
  textureReferences = [],
  missingTextureReferences = [],
  fallbackTextureReferences = [],
  result,
  warnings = [],
  options = {}
}) => {
  const sourceFiles = uniqueRecords([primaryRecord, ...companionRecords, ...textureRecords]).map(createSourceFileInfo);
  const companionFiles = uniqueRecords(companionRecords).map(createSourceFileInfo);
  const textureFiles = uniqueRecords(textureRecords).map(createSourceFileInfo);
  const meshRecordStartedAt = readNowMilliseconds();
  const meshRecord = createImportMeshRecord({
    format,
    primaryRecord,
    sourceFiles,
    result,
    options
  });
  const meshRecordMilliseconds = readNowMilliseconds() - meshRecordStartedAt;
  const meshMetadataStartedAt = readNowMilliseconds();
  const meshMetadata = meshRecord.toMetadata();
  const meshMetadataMilliseconds = readNowMilliseconds() - meshMetadataStartedAt;
  const fitTimings = attachMeshRecordToResult(result, meshRecord, meshMetadata);
  const fittedTriangles = result?.fittedTriangles || [];

  return {
    format,
    fileName: primaryRecord.name,
    filePath: primaryRecord.path,
    sourceFiles,
    companionFiles,
    textureFiles,
    textureAssets: uniqueTextureAssets(textureAssets),
    textureReferences,
    missingTextureFiles: missingTextureReferences,
    fallbackTextureReferences,
    meshRecord,
    meshMetadata,
    fittedTriangles,
    normalizedTriangles: fittedTriangles,
    result,
    warnings,
    timings: {
      meshRecordMilliseconds,
      meshMetadataMilliseconds,
      meshFitMilliseconds: fitTimings.meshFitMilliseconds
    }
  };
};

const mergeOptions = (baseOptions, runOptions) => ({
  ...baseOptions,
  ...runOptions,
  objOptions: {
    ...(baseOptions.objOptions || {}),
    ...(runOptions.objOptions || {})
  },
  gltfOptions: {
    ...(baseOptions.gltfOptions || {}),
    ...(runOptions.gltfOptions || {})
  },
  stlOptions: {
    ...(baseOptions.stlOptions || {}),
    ...(runOptions.stlOptions || {})
  },
  plyOptions: {
    ...(baseOptions.plyOptions || {}),
    ...(runOptions.plyOptions || {})
  },
  meshOptions: {
    ...(baseOptions.meshOptions || {}),
    ...(runOptions.meshOptions || {})
  }
});

const resolveCompanionPath = (basePath, siblingPath) => {
  const normalizedSibling = normalizePath(siblingPath);
  if (!normalizedSibling) {
    return '';
  }
  const baseDir = getDirName(basePath);
  return normalizePath(baseDir ? `${baseDir}/${normalizedSibling}` : normalizedSibling);
};

const uniqueRecords = (records) => {
  const seen = new Set();
  const unique = [];
  for (const record of records) {
    if (seen.has(record.index)) {
      continue;
    }
    seen.add(record.index);
    unique.push(record);
  }
  return unique;
};

const findReferencedMtlRecord = (fileIndex, objRecord, libraryName) => {
  const resolvedPath = resolveCompanionPath(objRecord.path, libraryName).toLowerCase();
  const directPathMatch = fileIndex.byPath.get(resolvedPath)?.find((record) => record.extension === 'mtl');
  if (directPathMatch) {
    return directPathMatch;
  }

  const normalizedLibraryPath = normalizePath(libraryName).toLowerCase();
  const libraryPathMatch = fileIndex.byPath.get(normalizedLibraryPath)?.find((record) => record.extension === 'mtl');
  if (libraryPathMatch) {
    return libraryPathMatch;
  }

  const libraryNameOnly = getBaseName(libraryName).toLowerCase();
  return fileIndex.byName.get(libraryNameOnly)?.find((record) => record.extension === 'mtl') || null;
};

const findSameStemMtlRecords = (fileIndex, objRecord) => {
  const objDir = getDirName(objRecord.path).toLowerCase();
  const stemMatches = fileIndex.byStem.get(objRecord.stem.toLowerCase()) || [];
  const exactDirMatches = stemMatches.filter((record) => (
    record.extension === 'mtl' && getDirName(record.path).toLowerCase() === objDir
  ));
  if (exactDirMatches.length > 0) {
    return uniqueRecords(exactDirMatches);
  }
  return uniqueRecords(stemMatches.filter((record) => record.extension === 'mtl'));
};

const isTextureRecord = (record) => record && TEXTURE_EXTENSIONS.has(record.extension);

const sharedPathPrefixScore = (leftPath, rightPath) => {
  const leftParts = getDirName(leftPath).toLowerCase().split('/').filter(Boolean);
  const rightParts = getDirName(rightPath).toLowerCase().split('/').filter(Boolean);
  let score = 0;
  while (score < leftParts.length && score < rightParts.length && leftParts[score] === rightParts[score]) {
    score += 1;
  }
  return score;
};

const chooseNearestTextureRecord = (records, basePath) => records
  .slice()
  .sort((left, right) => (
    sharedPathPrefixScore(right.path, basePath) - sharedPathPrefixScore(left.path, basePath)
    || left.index - right.index
  ))[0] || null;

const createTextureMatch = (record, strategy, candidateCount = record ? 1 : 0) => ({
  record,
  strategy,
  candidateCount
});

const findReferencedTextureRecord = (fileIndex, basePath, texturePath) => {
  const resolvedPath = resolveCompanionPath(basePath, texturePath).toLowerCase();
  const directPathMatch = fileIndex.byPath.get(resolvedPath)?.find(isTextureRecord);
  if (directPathMatch) {
    return createTextureMatch(directPathMatch, 'material-relative');
  }

  const normalizedTexturePath = normalizePath(texturePath).toLowerCase();
  const texturePathMatch = fileIndex.byPath.get(normalizedTexturePath)?.find(isTextureRecord);
  if (texturePathMatch) {
    return createTextureMatch(texturePathMatch, 'drop-root-relative');
  }

  const textureNameOnly = getBaseName(texturePath).toLowerCase();
  const nameMatches = (fileIndex.byName.get(textureNameOnly) || []).filter(isTextureRecord);
  if (nameMatches.length > 0) {
    return createTextureMatch(
      chooseNearestTextureRecord(nameMatches, basePath),
      nameMatches.length === 1 ? 'basename' : 'basename-nearest',
      nameMatches.length
    );
  }
  return createTextureMatch(null, 'missing', 0);
};

const findReferencedBufferRecord = (fileIndex, basePath, bufferPath) => {
  const resolvedPath = resolveCompanionPath(basePath, bufferPath).toLowerCase();
  const directPathMatch = fileIndex.byPath.get(resolvedPath)?.find((record) => GLTF_BUFFER_EXTENSIONS.has(record.extension));
  if (directPathMatch) {
    return directPathMatch;
  }

  const normalizedBufferPath = normalizePath(bufferPath).toLowerCase();
  const bufferPathMatch = fileIndex.byPath.get(normalizedBufferPath)?.find((record) => GLTF_BUFFER_EXTENSIONS.has(record.extension));
  if (bufferPathMatch) {
    return bufferPathMatch;
  }

  const bufferNameOnly = getBaseName(bufferPath).toLowerCase();
  const nameMatches = (fileIndex.byName.get(bufferNameOnly) || [])
    .filter((record) => GLTF_BUFFER_EXTENSIONS.has(record.extension));
  return nameMatches.length > 0 ? chooseNearestTextureRecord(nameMatches, basePath) : null;
};

const isGltfExternalBufferUri = (uri) => uri && !/^data:/i.test(uri);

const createObjTextureMetadata = (fileIndex, objRecord, materials, materialLibraryRecords) => {
  const textureRecords = [];
  const textureIndices = new Set();
  const textureReferences = [];

  for (const [materialKey, material] of Object.entries(materials || {})) {
    if (!material?.diffuseTexture) {
      continue;
    }

    const libraryRecord = materialLibraryRecords.get(material.libraryName) || null;
    const basePath = libraryRecord?.path || material.libraryName || objRecord.path;
    const resolvedPath = resolveCompanionPath(basePath, material.diffuseTexture);
    const textureMatch = findReferencedTextureRecord(fileIndex, basePath, material.diffuseTexture);
    const textureRecord = textureMatch.record;
    const sourceFile = textureRecord ? createSourceFileInfo(textureRecord) : null;
    const status = textureRecord ? 'resolved' : 'missing';
    const reference = {
      materialKey,
      materialName: material.name || materialKey,
      texturePath: material.diffuseTexture,
      resolvedPath,
      libraryName: material.libraryName || null,
      status,
      assetStatus: status === 'resolved' ? 'pending' : 'fallback',
      assetKey: null,
      asset: null,
      sourceFile,
      recordIndex: textureRecord?.index ?? null,
      relinkStrategy: textureMatch.strategy,
      relinkCandidateCount: textureMatch.candidateCount,
      fallback: status === 'missing' ? 'missingTextureChecker' : null
    };

    material.diffuseTexturePath = resolvedPath;
    material.diffuseTextureStatus = status;
    material.diffuseTextureAssetStatus = reference.assetStatus;
    material.diffuseTextureAssetKey = null;
    material.diffuseTextureAsset = null;
    material.diffuseTextureSource = sourceFile;
    material.diffuseTextureFallback = reference.fallback;
    material.diffuseTextureRelinkStrategy = reference.relinkStrategy;

    if (textureRecord) {
      textureRecords.push(textureRecord);
      textureIndices.add(textureRecord.index);
    }
    textureReferences.push(reference);
  }

  return {
    textureRecords: uniqueRecords(textureRecords),
    textureIndices,
    textureReferences,
    missingTextureReferences: textureReferences.filter((reference) => reference.status === 'missing')
  };
};

const attachTextureReferenceAsset = (reference, material, asset, assetStatus, fallback = null) => {
  const assetInfo = createTextureAssetInfo(asset);
  reference.assetStatus = assetStatus;
  reference.assetKey = asset.cacheKey;
  reference.asset = assetInfo;
  reference.fallback = fallback;
  if (material) {
    material.diffuseTextureAssetStatus = assetStatus;
    material.diffuseTextureAssetKey = asset.cacheKey;
    material.diffuseTextureAsset = assetInfo;
    material.diffuseTextureFallback = fallback;
  }
};

const loadObjTextureAssets = async (fileIndex, objRecord, textureReferences, materials, options, warnings) => {
  const textureAssets = [];

  for (const reference of textureReferences) {
    const material = materials?.[reference.materialKey] || null;
    if (reference.status === 'resolved') {
      try {
        const textureRecord = fileIndex.records[reference.recordIndex];
        const asset = await loadTextureRecordAsset(fileIndex, textureRecord);
        attachTextureReferenceAsset(reference, material, asset, 'loaded');
        textureAssets.push(asset);
        continue;
      } catch (error) {
        const warning = `OBJ "${objRecord.name}" material "${reference.materialName}" could not read texture "${reference.texturePath}"; using missing texture checker fallback.`;
        if (options.strictTextures) {
          throw new Error(`${warning} ${error.message}`);
        }
        warnings.push(warning);
        reference.status = 'unreadable';
      }
    }

    const fallbackAsset = getMissingTextureAsset(fileIndex);
    attachTextureReferenceAsset(reference, material, fallbackAsset, 'fallback', 'missingTextureChecker');
    textureAssets.push(fallbackAsset);
  }

  return uniqueTextureAssets(textureAssets);
};

const createUnmatchedCompanionWarning = (file) => {
  const label = file.extension === 'mtl'
    ? 'MTL'
    : GLTF_BUFFER_EXTENSIONS.has(file.extension)
      ? 'GLTF buffer'
      : 'texture';
  return `Ignored companion ${label} file "${file.name}" because no imported asset referenced it.`;
};

export const getDroppedFiles = (source) => {
  if (!source) {
    return [];
  }
  if (source.dataTransfer) {
    return getDroppedFiles(source.dataTransfer);
  }
  if (source.clipboardData) {
    return getDroppedFiles(source.clipboardData);
  }
  if (source.target?.files) {
    return getDroppedFiles(source.target.files);
  }
  if (source.currentTarget?.files) {
    return getDroppedFiles(source.currentTarget.files);
  }
  if (source.detail?.files) {
    return getDroppedFiles(source.detail.files);
  }

  const files = listItems(source.files);
  if (files.length > 0) {
    return files;
  }

  const itemFiles = listItems(source.items).map(getFileFromDataTransferItem).filter(Boolean);
  if (itemFiles.length > 0) {
    return itemFiles;
  }

  if (isDroppedFileLike(source)) {
    return [source];
  }

  const directItems = listItems(source);
  if (directItems.some((item) => item?.kind || typeof item?.getAsFile === 'function')) {
    return directItems.map(getFileFromDataTransferItem).filter(Boolean);
  }
  return directItems;
};

export const getDroppedFilePath = (file) => normalizePath(
  file?.webkitRelativePath
    || file?.relativePath
    || file?.path
    || file?.name
    || file?.fileName
    || ''
);

export const getDroppedFileName = (file) => (
  getBaseName(getDroppedFilePath(file)) || String(file?.name || file?.fileName || '')
);

export const getDroppedFileExtension = (file) => {
  const name = getDroppedFileName(file);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex === -1 ? '' : name.slice(dotIndex + 1).toLowerCase();
};

export const classifyDroppedFile = (file) => {
  const extension = getDroppedFileExtension(file);
  if (PRIMARY_EXTENSIONS.has(extension)) {
    return 'primary';
  }
  if (COMPANION_EXTENSIONS.has(extension)) {
    return 'companion';
  }
  return 'unsupported';
};

export const readFileAsArrayBuffer = async (file) => {
  if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) {
    return toArrayBuffer(file);
  }
  if (typeof file?.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    const arrayBuffer = toArrayBuffer(buffer);
    if (arrayBuffer) {
      return arrayBuffer;
    }
    throw new TypeError(`arrayBuffer() for dropped file "${getDroppedFileName(file) || '<unnamed>'}" did not return binary data.`);
  }

  const raw = file?.content
    ?? file?.data
    ?? file?.bytes
    ?? (typeof file?.arrayBuffer === 'function' ? undefined : file?.arrayBuffer)
    ?? file?.buffer
    ?? (typeof file?.text === 'string' ? file.text : undefined);
  const rawBuffer = toArrayBuffer(raw);
  if (rawBuffer) {
    return rawBuffer;
  }
  if (typeof raw === 'string') {
    return toArrayBuffer(TEXT_ENCODER.encode(raw));
  }
  if (typeof file?.text === 'function') {
    return toArrayBuffer(TEXT_ENCODER.encode(await file.text()));
  }
  throw new TypeError(`Cannot read dropped file "${getDroppedFileName(file) || '<unnamed>'}" as an ArrayBuffer.`);
};

export const readFileAsText = async (file) => {
  if (typeof file?.text === 'function') {
    return String(await file.text());
  }

  const raw = file?.content
    ?? file?.data
    ?? file?.textContent
    ?? (typeof file?.text === 'string' ? file.text : undefined);
  if (typeof raw === 'string') {
    return raw;
  }

  return TEXT_DECODER.decode(await readFileAsArrayBuffer(file));
};

export const createDroppedFileIndex = (files) => {
  const records = getDroppedFiles(files).map((file, index) => {
    const path = getDroppedFilePath(file);
    const name = getDroppedFileName(file);
    const extension = getDroppedFileExtension(file);
    return {
      file,
      index,
      path,
      name,
      extension,
      stem: getStem(name),
      type: file?.type || '',
      size: Number.isFinite(file?.size) ? file.size : null,
      role: classifyDroppedFile(file)
    };
  });

  const byPath = new Map();
  const byName = new Map();
  const byStem = new Map();
  for (const record of records) {
    addToMultiMap(byPath, record.path.toLowerCase(), record);
    addToMultiMap(byName, record.name.toLowerCase(), record);
    addToMultiMap(byStem, record.stem.toLowerCase(), record);
  }

  return {
    records,
    primaryRecords: records.filter((record) => record.role === 'primary'),
    companionRecords: records.filter((record) => record.role === 'companion'),
    unsupportedRecords: records.filter((record) => record.role === 'unsupported'),
    byPath,
    byName,
    byStem,
    usedCompanionIndices: new Set(),
    textureAssetCache: new Map()
  };
};

const readAssetPipelineLogger = (options = {}) => {
  const optionLogger = options.assetPipelineLogger
    || options.assetLogger
    || options.logger?.assetPipeline
    || options.logger;
  if (optionLogger && typeof optionLogger.info === 'function') {
    return optionLogger;
  }

  if (typeof globalThis === 'undefined') {
    return null;
  }

  const globalLogger = globalThis.pathTracerLoggers?.assetPipeline
    || globalThis.pathTracerAssetPipelineLogger;
  return globalLogger && typeof globalLogger.info === 'function'
    ? globalLogger
    : null;
};

const readTextureAssetByteLength = (asset) => {
  const explicitByteLength = Number(asset?.byteLength ?? asset?.size);
  if (Number.isFinite(explicitByteLength) && explicitByteLength > 0) {
    return explicitByteLength;
  }

  const width = Number(asset?.width);
  const height = Number(asset?.height);
  const channels = Number(asset?.channels || 4);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width * height * Math.max(1, channels)
    : 0;
};

const createTextureAssetPipelineSummary = (textureAssets = []) => {
  const assets = uniqueTextureAssets(textureAssets);
  const dimensions = assets
    .map((asset) => ({
      width: Number(asset?.width),
      height: Number(asset?.height)
    }))
    .filter((dimension) => (
      Number.isFinite(dimension.width)
      && Number.isFinite(dimension.height)
      && dimension.width > 0
      && dimension.height > 0
    ));
  const textureByteLength = assets.reduce((total, asset) => total + readTextureAssetByteLength(asset), 0);

  return {
    atlasStatus: 'unavailable',
    atlasWidth: null,
    atlasHeight: null,
    atlasLayerCount: null,
    atlasUnavailableReason: 'Texture atlas packing is not built by ImportCoordinator.',
    sourceTextureCount: assets.length,
    loadedTextureCount: assets.filter((asset) => asset?.status === 'loaded').length,
    fallbackTextureCount: assets.filter((asset) => asset?.status === 'fallback').length,
    sourceTextureKnownDimensionCount: dimensions.length,
    sourceTextureMaxWidth: dimensions.length > 0 ? Math.max(...dimensions.map((dimension) => dimension.width)) : null,
    sourceTextureMaxHeight: dimensions.length > 0 ? Math.max(...dimensions.map((dimension) => dimension.height)) : null,
    textureByteLength
  };
};

const createAssetPipelineImportDetails = (entry, timings = {}) => {
  const textureSummary = createTextureAssetPipelineSummary(entry?.textureAssets);
  const meshRecord = entry?.meshRecord || null;
  const meshMetadata = entry?.meshMetadata || null;
  const estimatedMeshBytes = normalizeOptionalNonNegativeNumber(
    meshMetadata?.estimatedCpuBytes ?? meshRecord?.estimatedCpuBytes ?? entry?.result?.estimatedCpuBytes
  ) ?? 0;
  const estimatedTextureBytes = textureSummary.textureByteLength;
  const estimatedUploadBytes = estimatedMeshBytes + estimatedTextureBytes;
  const bvhBuildMilliseconds = normalizeOptionalNonNegativeNumber(
    meshMetadata?.bvhBuildMilliseconds
      ?? meshRecord?.bvhBuildMilliseconds
      ?? entry?.result?.bvhBuildMilliseconds
      ?? entry?.result?.bvh?.buildMilliseconds
  );
  const bvhNodeCount = normalizeOptionalNonNegativeNumber(
    meshMetadata?.bvhNodeCount
      ?? meshRecord?.bvhNodeCount
      ?? entry?.result?.bvhNodeCount
      ?? entry?.result?.bvh?.nodeCount
  );
  const meshTimings = entry?.timings || {};
  const meshRecordMilliseconds = normalizeOptionalNonNegativeNumber(meshTimings.meshRecordMilliseconds);
  const meshMetadataMilliseconds = normalizeOptionalNonNegativeNumber(meshTimings.meshMetadataMilliseconds);
  const meshFitMilliseconds = normalizeOptionalNonNegativeNumber(
    meshTimings.meshFitMilliseconds ?? entry?.result?.meshTimings?.meshFitMilliseconds
  );

  return {
    fileName: entry?.fileName || null,
    filePath: entry?.filePath || null,
    modelName: meshMetadata?.name || meshRecord?.name || entry?.result?.name || entry?.fileName || null,
    format: entry?.format || null,
    triangleCount: normalizeOptionalNonNegativeNumber(meshRecord?.triangleCount ?? entry?.result?.triangleCount ?? entry?.fittedTriangles?.length) ?? 0,
    vertexCount: normalizeOptionalNonNegativeNumber(meshMetadata?.vertexCount ?? meshRecord?.bounds?.vertexCount) ?? 0,
    estimatedCpuBytes: estimatedMeshBytes,
    estimatedMeshBytes,
    estimatedTextureBytes,
    estimatedUploadBytes,
    estimatedGpuUploadBytes: estimatedUploadBytes,
    bvhBuildMilliseconds,
    bvhNodeCount,
    bvhStatus: bvhBuildMilliseconds !== null || bvhNodeCount !== null ? 'built' : 'unavailable',
    bvhUnavailableReason: bvhBuildMilliseconds !== null || bvhNodeCount !== null
      ? null
      : 'No BVH builder runs in ImportCoordinator.',
    importMilliseconds: Number.isFinite(timings.importMilliseconds) ? timings.importMilliseconds : null,
    meshRecordMilliseconds,
    meshMetadataMilliseconds,
    meshFitMilliseconds,
    sourceFileCount: entry?.sourceFiles?.length || 0,
    companionFileCount: entry?.companionFiles?.length || 0,
    textureFileCount: entry?.textureFiles?.length || 0,
    textureAtlas: textureSummary,
    warningCount: entry?.warnings?.length || 0
  };
};

const logAssetPipelineImportEntry = (entry, options, timings) => {
  const assetLogger = readAssetPipelineLogger(options);
  if (!assetLogger) {
    return null;
  }
  return assetLogger.info(
    'assetPipeline:mesh-import',
    createAssetPipelineImportDetails(entry, timings)
  );
};

const logAssetPipelineImportError = (record, options, error, timings = {}) => {
  const assetLogger = readAssetPipelineLogger(options);
  if (!assetLogger || typeof assetLogger.error !== 'function') {
    return null;
  }
  return assetLogger.error('assetPipeline:mesh-import-error', {
    fileName: record?.name || null,
    filePath: record?.path || null,
    format: record?.extension || null,
    importMilliseconds: Number.isFinite(timings.importMilliseconds) ? timings.importMilliseconds : null,
    errorName: error?.name || null,
    errorMessage: error?.message || String(error)
  });
};

export class ImportCoordinator {
  constructor(options = {}) {
    this.options = options;
  }

  async importFiles(files, runOptions = {}) {
    const options = mergeOptions(this.options, runOptions);
    const fileIndex = createDroppedFileIndex(files);
    const imports = [];

    for (const record of fileIndex.primaryRecords) {
      const startedAt = readNowMilliseconds();
      try {
        const importEntry = await this.importFileRecord(record, fileIndex, options);
        const importMilliseconds = readNowMilliseconds() - startedAt;
        logAssetPipelineImportEntry(importEntry, options, { importMilliseconds });
        imports.push(importEntry);
      } catch (error) {
        logAssetPipelineImportError(record, options, error, {
          importMilliseconds: readNowMilliseconds() - startedAt
        });
        throw error;
      }
    }

    const unsupportedWarnings = fileIndex.unsupportedRecords.map((record) => (
      `Ignored unsupported dropped file "${record.name}".`
    ));
    const unmatchedCompanionFiles = fileIndex.companionRecords
      .filter((record) => !fileIndex.usedCompanionIndices.has(record.index))
      .map(createSourceFileInfo);

    return {
      imports,
      results: imports.map((entry) => entry.result),
      fileCount: fileIndex.records.length,
      skippedFiles: fileIndex.unsupportedRecords.map(createSourceFileInfo),
      companionFiles: fileIndex.companionRecords.map(createSourceFileInfo),
      textureAssets: uniqueTextureAssets(imports.flatMap((entry) => entry.textureAssets || [])),
      textureReferences: imports.flatMap((entry) => entry.textureReferences || []),
      fallbackTextureReferences: imports.flatMap((entry) => entry.fallbackTextureReferences || []),
      meshRecords: imports.map((entry) => entry.meshRecord).filter(Boolean),
      meshMetadata: imports.map((entry) => entry.meshMetadata).filter(Boolean),
      unmatchedCompanionFiles,
      warnings: [
        ...unsupportedWarnings,
        ...unmatchedCompanionFiles.map(createUnmatchedCompanionWarning),
        ...imports.flatMap((entry) => entry.warnings)
      ]
    };
  }

  async parseFiles(files, runOptions = {}) {
    return this.importFiles(files, runOptions);
  }

  async importFileRecord(record, fileIndex, options) {
    if (record.extension === 'obj') {
      return this.importObj(record, fileIndex, options);
    }
    if (record.extension === 'gltf') {
      return this.importGltf(record, fileIndex, options);
    }
    if (record.extension === 'glb') {
      return this.importGlb(record, options);
    }
    if (record.extension === 'stl') {
      return this.importStl(record, options);
    }
    if (record.extension === 'ply') {
      return this.importPly(record, options);
    }
    throw new TypeError(`Unsupported import format for "${record.name}".`);
  }

  async importObj(record, fileIndex, options) {
    const objText = await readFileAsText(record.file);
    const objOptions = options.objOptions || {};
    const probe = new ObjParser(objOptions).parse(objText, {
      ...objOptions,
      materials: null,
      mtlText: null,
      mtlTexts: null
    });
    const warnings = [];
    const mtlTexts = {};
    const companionRecords = [];
    const companionIndices = new Set();
    const materialLibraryRecords = new Map();

    for (const libraryName of new Set(probe.materialLibraries)) {
      const mtlRecord = findReferencedMtlRecord(fileIndex, record, libraryName);
      if (!mtlRecord) {
        const warning = `OBJ "${record.name}" references missing MTL "${libraryName}".`;
        if (options.strictMaterials) {
          throw new Error(warning);
        }
        warnings.push(warning);
        continue;
      }
      companionIndices.add(mtlRecord.index);
      mtlTexts[libraryName] = await readFileAsText(mtlRecord.file);
      materialLibraryRecords.set(libraryName, mtlRecord);
      companionRecords.push(mtlRecord);
    }

    if (probe.materialLibraries.length === 0 && options.attachSameStemMtl !== false) {
      for (const mtlRecord of findSameStemMtlRecords(fileIndex, record)) {
        companionIndices.add(mtlRecord.index);
        mtlTexts[mtlRecord.path || mtlRecord.name] = await readFileAsText(mtlRecord.file);
        materialLibraryRecords.set(mtlRecord.path || mtlRecord.name, mtlRecord);
        companionRecords.push(mtlRecord);
      }
    }

    for (const companionIndex of companionIndices) {
      fileIndex.usedCompanionIndices.add(companionIndex);
    }

    const result = new ObjParser(objOptions).parse(objText, {
      ...objOptions,
      mtlTexts
    });
    const textureMetadata = createObjTextureMetadata(fileIndex, record, result.materials, materialLibraryRecords);
    for (const textureIndex of textureMetadata.textureIndices) {
      fileIndex.usedCompanionIndices.add(textureIndex);
    }
    for (const textureReference of textureMetadata.missingTextureReferences) {
      const warning = `OBJ "${record.name}" material "${textureReference.materialName}" references missing texture "${textureReference.texturePath}"; using missing texture checker fallback.`;
      if (options.strictTextures) {
        throw new Error(warning);
      }
      if (options.warnMissingTextures !== false) {
        warnings.push(warning);
      }
    }
    const textureAssets = await loadObjTextureAssets(
      fileIndex,
      record,
      textureMetadata.textureReferences,
      result.materials,
      options,
      warnings
    );

    return createParsedImport({
      format: 'obj',
      primaryRecord: record,
      companionRecords: uniqueRecords(companionRecords),
      textureRecords: textureMetadata.textureRecords,
      textureAssets,
      textureReferences: textureMetadata.textureReferences,
      missingTextureReferences: textureMetadata.missingTextureReferences,
      fallbackTextureReferences: textureMetadata.textureReferences.filter((reference) => reference.assetStatus === 'fallback'),
      result,
      warnings: [...warnings, ...result.warnings],
      options
    });
  }

  async importGltf(record, fileIndex, options) {
    const gltfOptions = options.gltfOptions || {};
    const gltfText = await readFileAsText(record.file);
    const gltf = JSON.parse(gltfText);
    const buffers = { ...(gltfOptions.buffers || {}) };
    const companionRecords = [];
    const warnings = [];

    for (let index = 0; index < (gltf.buffers || []).length; index += 1) {
      const bufferDef = gltf.buffers[index] || {};
      if (!isGltfExternalBufferUri(bufferDef.uri) || buffers[index] || buffers[String(index)] || buffers[bufferDef.uri]) {
        continue;
      }

      const bufferRecord = findReferencedBufferRecord(fileIndex, record.path, bufferDef.uri);
      if (!bufferRecord) {
        const warning = `GLTF "${record.name}" references missing buffer "${bufferDef.uri}".`;
        if (options.strictBuffers) {
          throw new Error(warning);
        }
        warnings.push(warning);
        continue;
      }

      const buffer = await readFileAsArrayBuffer(bufferRecord.file);
      buffers[index] = buffer;
      buffers[String(index)] = buffer;
      buffers[bufferDef.uri] = buffer;
      companionRecords.push(bufferRecord);
      fileIndex.usedCompanionIndices.add(bufferRecord.index);
    }

    const result = new GltfLoader(gltfOptions).parseJson(gltf, {
      ...gltfOptions,
      buffers,
      warnings
    });
    return createParsedImport({
      format: 'gltf',
      primaryRecord: record,
      companionRecords: uniqueRecords(companionRecords),
      result,
      warnings: result.warnings,
      options
    });
  }

  async importGlb(record, options) {
    const result = new GltfLoader(options.gltfOptions).parseGlb(
      await readFileAsArrayBuffer(record.file),
      options.gltfOptions
    );
    return createParsedImport({
      format: 'glb',
      primaryRecord: record,
      result,
      warnings: result.warnings,
      options
    });
  }

  async importStl(record, options) {
    const result = new StlParser(options.stlOptions).parse(await readFileAsArrayBuffer(record.file));
    return createParsedImport({
      format: 'stl',
      primaryRecord: record,
      result,
      warnings: result.warnings,
      options
    });
  }

  async importPly(record, options) {
    const result = new PlyParser(options.plyOptions).parse(await readFileAsArrayBuffer(record.file));
    return createParsedImport({
      format: 'ply',
      primaryRecord: record,
      result,
      warnings: result.warnings,
      options
    });
  }
}

export const importDroppedFiles = (files, options = {}) => new ImportCoordinator(options).importFiles(files);

export const importDroppedSource = importDroppedFiles;

export const parseDroppedFiles = importDroppedFiles;

export const parseDroppedSource = importDroppedFiles;
