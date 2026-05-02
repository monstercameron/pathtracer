import { createLoaderSmokeSamples } from '../loaders/parserSmokeSamples.js';
import { importDroppedFiles } from './ImportCoordinator.js';

const cloneArrayBuffer = (buffer) => buffer.slice(0);

const TINY_WHITE_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0, 31, 21, 196,
  137, 0, 0, 0, 13, 73, 68, 65,
  84, 120, 156, 99, 248, 255, 255, 255,
  127, 0, 9, 251, 3, 253, 5, 67,
  69, 202, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130
]);

const GROUPED_OBJ_SAMPLE = [
  'mtllib materials/sample.mtl',
  'o GroupedTexturedQuad',
  'g ResolvedOne',
  'v 0 0 0',
  'v 1 0 0',
  'v 0 1 0',
  'v 1 1 0',
  'vt 0 0',
  'vt 1 0',
  'vt 0 1',
  'vt 1 1',
  'vn 0 0 1',
  'usemtl white',
  'f 1/1/1 2/2/1 3/3/1',
  'g ResolvedTwo',
  'usemtl white_copy',
  'f 2/2/1 4/4/1 3/3/1',
  'g MissingTexture',
  'usemtl missing_checker',
  'f 1/1/1 3/3/1 4/4/1'
].join('\n');

const GROUPED_MTL_SAMPLE = [
  'newmtl white',
  'Kd 1 1 1',
  'map_Kd textures/white.png',
  'newmtl white_copy',
  'Kd 0.9 0.9 0.9',
  'map_Kd textures/white.png',
  'newmtl missing_checker',
  'Kd 0.25 0.25 0.25',
  'map_Kd textures/missing.png'
].join('\n');

const toArrayBuffer = (input) => {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
};

const textFile = (name, text, type = 'text/plain', relativePath = name) => ({
  name,
  relativePath,
  webkitRelativePath: relativePath,
  type,
  size: text.length,
  async text() {
    return text;
  },
  async arrayBuffer() {
    const bytes = new TextEncoder().encode(text);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
});

const binaryFile = (name, buffer, type = 'application/octet-stream', relativePath = name) => {
  const arrayBuffer = toArrayBuffer(buffer);
  return {
  name,
  relativePath,
  webkitRelativePath: relativePath,
  type,
  size: arrayBuffer.byteLength,
  async arrayBuffer() {
    return cloneArrayBuffer(arrayBuffer);
  }
  };
};

const fileListLike = (files) => ({
  length: files.length,
  item(index) {
    return files[index] || null;
  }
});

const findImport = (importResult, format) => importResult.imports.find((entry) => entry.format === format);

const createAssetPipelineLogCapture = () => {
  const entries = [];
  const write = (level, message, details) => {
    const entry = { level, message, details };
    entries.push(entry);
    return entry;
  };
  return {
    entries,
    logger: {
      info: (message, details) => write('info', message, details),
      error: (message, details) => write('error', message, details)
    }
  };
};

const summarizeImportMesh = (entry) => ({
  format: entry?.format || null,
  triangleCount: entry?.result?.triangleCount || 0,
  meshRecordTriangleCount: entry?.meshRecord?.triangleCount || 0,
  meshMetadataTriangleCount: entry?.meshMetadata?.triangleCount || 0,
  fittedTriangleCount: entry?.fittedTriangles?.length || 0,
  resultFittedTriangleCount: entry?.result?.fittedTriangles?.length || 0,
  resultNormalizedTriangleCount: entry?.result?.normalizedTriangles?.length || 0,
  vertexCount: entry?.meshMetadata?.vertexCount || 0,
  estimatedCpuBytes: entry?.meshMetadata?.estimatedCpuBytes || 0,
  boundsLongestAxis: entry?.meshMetadata?.bounds?.longestAxis || 0,
  fittedBoundsLongestAxis: entry?.meshMetadata?.fit?.fittedBounds?.longestAxis || 0
});

export const createImportCoordinatorSmokeFiles = () => {
  const samples = createLoaderSmokeSamples();
  return [
    textFile('sample.mtl', GROUPED_MTL_SAMPLE, 'model/mtl', 'models/materials/sample.mtl'),
    textFile('sample.obj', GROUPED_OBJ_SAMPLE, 'model/obj', 'models/sample.obj'),
    binaryFile('white.png', TINY_WHITE_PNG, 'image/png', 'models/materials/textures/white.png'),
    textFile('triangle.gltf', samples.gltf.json, 'model/gltf+json', 'models/triangle.gltf'),
    binaryFile('triangle.bin', samples.gltf.buffers['triangle.bin'], 'application/octet-stream', 'models/triangle.bin'),
    binaryFile('triangle.glb', samples.glb, 'model/gltf-binary'),
    textFile('triangle.stl', samples.stl, 'model/stl'),
    textFile('triangle.ply', samples.ply, 'application/octet-stream')
  ];
};

export const createImportCoordinatorGroupedDrop = () => ({
  dataTransfer: {
    files: fileListLike(createImportCoordinatorSmokeFiles())
  }
});

export const runImportCoordinatorSmokeSamples = async () => {
  const assetPipelineCapture = createAssetPipelineLogCapture();
  const importResult = await importDroppedFiles(createImportCoordinatorGroupedDrop(), {
    assetPipelineLogger: assetPipelineCapture.logger
  });
  const scaledImportResult = await importDroppedFiles(createImportCoordinatorGroupedDrop(), {
    meshOptions: {
      targetSize: 2
    }
  });
  const obj = findImport(importResult, 'obj')?.result;
  const objImport = findImport(importResult, 'obj');
  const scaledObjImport = findImport(scaledImportResult, 'obj');
  const glb = findImport(importResult, 'glb')?.result;
  const gltf = findImport(importResult, 'gltf')?.result;
  const stl = findImport(importResult, 'stl')?.result;
  const ply = findImport(importResult, 'ply')?.result;
  const meshSummaries = importResult.imports.map(summarizeImportMesh);
  const objTextureAssets = objImport?.textureAssets || [];
  const objTextureReferences = objImport?.textureReferences || [];
  const objMeshRecord = objImport?.meshRecord || null;
  const objMeshMetadata = objImport?.meshMetadata || null;
  const scaledObjMeshMetadata = scaledObjImport?.meshMetadata || null;
  const assetPipelineMeshLogs = assetPipelineCapture.entries
    .filter((entry) => entry.level === 'info' && entry.message === 'assetPipeline:mesh-import');
  const objAssetPipelineLog = assetPipelineMeshLogs.find((entry) => entry.details?.format === 'obj') || null;

  return {
    importCount: importResult.imports.length,
    inputFileCount: importResult.fileCount,
    skippedFileCount: importResult.skippedFiles.length,
    unmatchedCompanionFileCount: importResult.unmatchedCompanionFiles.length,
    meshRecordCount: importResult.meshRecords.length,
    meshMetadataCount: importResult.meshMetadata.length,
    formats: importResult.imports.map((entry) => entry.format),
    assetPipelineLogCount: assetPipelineMeshLogs.length,
    assetPipelineAllImportsLogged: importResult.imports.every((entry) => (
      assetPipelineMeshLogs.some((logEntry) => (
        logEntry.details?.format === entry.format
        && logEntry.details?.fileName === entry.fileName
      ))
    )),
    assetPipelineLogsHaveMeshDetails: assetPipelineMeshLogs.every((logEntry) => (
      Boolean(logEntry.details?.fileName)
      && Boolean(logEntry.details?.modelName)
      && logEntry.details.triangleCount > 0
      && logEntry.details.vertexCount === logEntry.details.triangleCount * 3
      && logEntry.details.estimatedCpuBytes > 0
      && logEntry.details.estimatedMeshBytes === logEntry.details.estimatedCpuBytes
      && logEntry.details.estimatedGpuUploadBytes >= logEntry.details.estimatedCpuBytes
      && logEntry.details.estimatedUploadBytes === logEntry.details.estimatedGpuUploadBytes
    )),
    assetPipelineLogsHaveTimingDetails: assetPipelineMeshLogs.every((logEntry) => (
      Number.isFinite(logEntry.details?.importMilliseconds)
      && Number.isFinite(logEntry.details?.meshRecordMilliseconds)
      && Number.isFinite(logEntry.details?.meshMetadataMilliseconds)
      && Number.isFinite(logEntry.details?.meshFitMilliseconds)
      && logEntry.details.bvhStatus === 'unavailable'
      && logEntry.details.bvhBuildMilliseconds === null
      && logEntry.details.textureAtlas?.atlasStatus === 'unavailable'
      && logEntry.details.textureAtlas?.atlasWidth === null
      && logEntry.details.textureAtlas?.atlasHeight === null
      && logEntry.details.textureAtlas?.atlasLayerCount === null
    )),
    meshSummaries,
    allMeshRecordsHaveMetadata: meshSummaries.every((summary) => (
      summary.triangleCount === summary.meshRecordTriangleCount
      && summary.triangleCount === summary.meshMetadataTriangleCount
      && summary.triangleCount === summary.fittedTriangleCount
      && summary.triangleCount === summary.resultFittedTriangleCount
      && summary.triangleCount === summary.resultNormalizedTriangleCount
      && summary.vertexCount === summary.triangleCount * 3
      && summary.estimatedCpuBytes > 0
      && summary.boundsLongestAxis > 0
      && summary.fittedBoundsLongestAxis > 0
    )),
    objTriangleCount: obj?.triangleCount || 0,
    objMaterialCount: obj ? Object.keys(obj.materials).length : 0,
    objMeshRecordTriangleCount: objMeshRecord?.triangleCount || 0,
    objFittedTriangleCount: objImport?.fittedTriangles?.length || 0,
    objResultFittedTriangleCount: obj?.fittedTriangles?.length || 0,
    objResultNormalizedTriangleCount: obj?.normalizedTriangles?.length || 0,
    objMeshVertexCount: objMeshRecord?.bounds.vertexCount || 0,
    objMeshBoundsLongestAxis: objMeshRecord?.bounds.longestAxis || 0,
    objMeshMaterialSummaryCount: objMeshMetadata?.summary?.materials?.length || 0,
    objMeshGroupSummaryCount: objMeshMetadata?.summary?.groups?.length || 0,
    objMeshFitTargetSize: objMeshMetadata?.fit?.targetSize || 0,
    objMeshFitScale: objMeshMetadata?.fit?.scale || 0,
    objMeshFittedLongestAxis: objMeshMetadata?.fit?.fittedBounds?.longestAxis || 0,
    scaledObjMeshFitTargetSize: scaledObjMeshMetadata?.fit?.targetSize || 0,
    scaledObjMeshFitScale: scaledObjMeshMetadata?.fit?.scale || 0,
    scaledObjMeshFittedLongestAxis: scaledObjMeshMetadata?.fit?.fittedBounds?.longestAxis || 0,
    objMeshEstimatedCpuBytes: objMeshMetadata?.estimatedCpuBytes || 0,
    objTextureReferenceCount: objImport?.textureReferences.length || 0,
    objResolvedTextureReferenceCount: objTextureReferences.filter((reference) => reference.status === 'resolved').length,
    objMissingTextureFileCount: objImport?.missingTextureFiles.length || 0,
    objTextureFileCount: objImport?.textureFiles.length || 0,
    objTextureAssetCount: objTextureAssets.length,
    objLoadedTextureAssetCount: objTextureAssets.filter((asset) => asset.status === 'loaded').length,
    objFallbackTextureAssetCount: objTextureAssets.filter((asset) => asset.status === 'fallback').length,
    objFallbackTextureReferenceCount: objImport?.fallbackTextureReferences.length || 0,
    objTextureCacheKeyCount: new Set(objTextureReferences.map((reference) => reference.assetKey).filter(Boolean)).size,
    objResolvedTextureCacheKeyCount: new Set(objTextureReferences
      .filter((reference) => reference.status === 'resolved')
      .map((reference) => reference.assetKey)
      .filter(Boolean)).size,
    objTextureRelinkStrategies: objTextureReferences.map((reference) => reference.relinkStrategy),
    objAssetPipelineModelName: objAssetPipelineLog?.details?.modelName || null,
    objAssetPipelineTriangleCount: objAssetPipelineLog?.details?.triangleCount || 0,
    objAssetPipelineEstimatedMeshBytes: objAssetPipelineLog?.details?.estimatedMeshBytes || 0,
    objAssetPipelineEstimatedTextureBytes: objAssetPipelineLog?.details?.estimatedTextureBytes || 0,
    objAssetPipelineEstimatedUploadBytes: objAssetPipelineLog?.details?.estimatedGpuUploadBytes || 0,
    objAssetPipelineAtlasStatus: objAssetPipelineLog?.details?.textureAtlas?.atlasStatus || null,
    objAssetPipelineSourceTextureCount: objAssetPipelineLog?.details?.textureAtlas?.sourceTextureCount || 0,
    objAssetPipelineBvhStatus: objAssetPipelineLog?.details?.bvhStatus || null,
    gltfTriangleCount: gltf?.triangleCount || 0,
    gltfEncoding: gltf?.encoding || null,
    glbTriangleCount: glb?.triangleCount || 0,
    glbEncoding: glb?.encoding || null,
    stlTriangleCount: stl?.triangleCount || 0,
    plyTriangleCount: ply?.triangleCount || 0,
    plyHasVertexColors: Boolean(ply?.hasVertexColors)
  };
};
