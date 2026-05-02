import { cloneVector2, cloneVector3 } from './geometry.js';

const DEFAULT_FIT_TARGET_SIZE = 1;
const DEFAULT_FIT_TARGET_CENTER = Object.freeze([0, 0, 0]);
const BYTES_PER_FLOAT32 = 4;

const finitePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const cloneBounds = (bounds) => ({
  empty: Boolean(bounds.empty),
  vertexCount: bounds.vertexCount || 0,
  min: cloneVector3(bounds.min),
  max: cloneVector3(bounds.max),
  size: cloneVector3(bounds.size),
  center: cloneVector3(bounds.center),
  longestAxis: Number.isFinite(bounds.longestAxis) ? bounds.longestAxis : 0,
  diagonal: Number.isFinite(bounds.diagonal) ? bounds.diagonal : 0
});

const createBoundsFromMinMax = (min, max, vertexCount) => {
  if (vertexCount <= 0) {
    return {
      empty: true,
      vertexCount: 0,
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0],
      longestAxis: 0,
      diagonal: 0
    };
  }

  const size = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2]
  ];
  return {
    empty: false,
    vertexCount,
    min: cloneVector3(min),
    max: cloneVector3(max),
    size,
    center: [
      min[0] + size[0] * 0.5,
      min[1] + size[1] * 0.5,
      min[2] + size[2] * 0.5
    ],
    longestAxis: Math.max(size[0], size[1], size[2]),
    diagonal: Math.hypot(size[0], size[1], size[2])
  };
};

const isFinitePosition = (position) => (
  position
  && Number.isFinite(position[0])
  && Number.isFinite(position[1])
  && Number.isFinite(position[2])
);

const transformBounds = (bounds, scale, translation) => {
  if (!bounds || bounds.empty) {
    return createBoundsFromMinMax([0, 0, 0], [0, 0, 0], 0);
  }
  return createBoundsFromMinMax(
    bounds.min.map((value, index) => value * scale + translation[index]),
    bounds.max.map((value, index) => value * scale + translation[index]),
    bounds.vertexCount
  );
};

const resolveFitOptions = (options = {}) => ({
  targetSize: finitePositiveNumber(options.targetSize, DEFAULT_FIT_TARGET_SIZE),
  targetCenter: cloneVector3(options.targetCenter || options.center || DEFAULT_FIT_TARGET_CENTER)
});

const cloneFit = (fit) => ({
  strategy: fit.strategy,
  targetSize: fit.targetSize,
  targetCenter: cloneVector3(fit.targetCenter),
  sourceCenter: cloneVector3(fit.sourceCenter),
  sourceLongestAxis: fit.sourceLongestAxis,
  scale: fit.scale,
  translation: cloneVector3(fit.translation),
  transform: {
    type: fit.transform.type,
    scale: cloneVector3(fit.transform.scale),
    translation: cloneVector3(fit.transform.translation)
  },
  fittedBounds: cloneBounds(fit.fittedBounds)
});

const triangleHasVertexColors = (triangle) => (
  Array.isArray(triangle?.vertexColors) && triangle.vertexColors.length === 3
);

const incrementSummaryCount = (map, key) => {
  const normalizedKey = key || 'unassigned';
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
};

const createCountSummary = (map) => Array.from(map.entries()).map(([name, triangleCount]) => ({
  name,
  triangleCount
}));

export const summarizeMeshTriangles = (triangles = []) => {
  const materialCounts = new Map();
  const objectCounts = new Map();
  const groupCounts = new Map();
  let texturedTriangleCount = 0;
  let uvTriangleCount = 0;
  let normalTriangleCount = 0;
  let vertexColorTriangleCount = 0;

  for (const triangle of triangles || []) {
    incrementSummaryCount(materialCounts, triangle?.materialName);
    incrementSummaryCount(objectCounts, triangle?.objectName);
    incrementSummaryCount(groupCounts, triangle?.groupName);
    if (Array.isArray(triangle?.uvs) && triangle.uvs.length === 3) {
      uvTriangleCount += 1;
    }
    if (Array.isArray(triangle?.normals) && triangle.normals.length === 3) {
      normalTriangleCount += 1;
    }
    if (triangleHasVertexColors(triangle)) {
      vertexColorTriangleCount += 1;
    }
    if (triangle?.materialName && triangle?.uvs?.length === 3) {
      texturedTriangleCount += 1;
    }
  }

  return {
    materials: createCountSummary(materialCounts),
    objects: createCountSummary(objectCounts),
    groups: createCountSummary(groupCounts),
    uvTriangleCount,
    normalTriangleCount,
    vertexColorTriangleCount,
    texturedTriangleCount
  };
};

export const computeMeshBounds = (triangles = []) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vertexCount = 0;

  for (const triangle of triangles || []) {
    for (const position of triangle?.positions || []) {
      if (!isFinitePosition(position)) {
        continue;
      }
      min[0] = Math.min(min[0], position[0]);
      min[1] = Math.min(min[1], position[1]);
      min[2] = Math.min(min[2], position[2]);
      max[0] = Math.max(max[0], position[0]);
      max[1] = Math.max(max[1], position[1]);
      max[2] = Math.max(max[2], position[2]);
      vertexCount += 1;
    }
  }

  return createBoundsFromMinMax(min, max, vertexCount);
};

export const computeMeshFit = (bounds, options = {}) => {
  const resolvedOptions = resolveFitOptions(options);
  const sourceBounds = cloneBounds(bounds || createBoundsFromMinMax([0, 0, 0], [0, 0, 0], 0));
  const scale = sourceBounds.longestAxis > 0
    ? resolvedOptions.targetSize / sourceBounds.longestAxis
    : 1;
  const translation = resolvedOptions.targetCenter.map((targetValue, index) => (
    targetValue - sourceBounds.center[index] * scale
  ));
  const fittedBounds = transformBounds(sourceBounds, scale, translation);

  return {
    strategy: 'uniform-longest-axis',
    targetSize: resolvedOptions.targetSize,
    targetCenter: resolvedOptions.targetCenter,
    sourceCenter: sourceBounds.center,
    sourceLongestAxis: sourceBounds.longestAxis,
    scale,
    translation,
    transform: {
      type: 'scale-translate',
      scale: [scale, scale, scale],
      translation
    },
    fittedBounds
  };
};

export const applyMeshFitToPosition = (position, fit) => {
  const source = cloneVector3(position);
  const scale = Number.isFinite(fit?.scale) ? fit.scale : 1;
  const translation = cloneVector3(fit?.translation || [0, 0, 0]);
  return [
    source[0] * scale + translation[0],
    source[1] * scale + translation[1],
    source[2] * scale + translation[2]
  ];
};

export const createFittedTriangles = (triangles = [], fit) => triangles.map((triangle) => ({
  ...triangle,
  positions: (triangle.positions || []).map((position) => applyMeshFitToPosition(position, fit)),
  normals: (triangle.normals || []).map(cloneVector3),
  uvs: (triangle.uvs || []).map(cloneVector2),
  ...(triangleHasVertexColors(triangle)
    ? { vertexColors: triangle.vertexColors.map(cloneVector3) }
    : {})
}));

export const estimateMeshTriangleBytes = (triangles = []) => {
  let floatCount = 0;
  for (const triangle of triangles || []) {
    floatCount += (triangle.positions?.length || 0) * 3;
    floatCount += (triangle.normals?.length || 0) * 3;
    floatCount += (triangle.uvs?.length || 0) * 2;
    if (triangleHasVertexColors(triangle)) {
      floatCount += triangle.vertexColors.length * 3;
    }
  }
  return floatCount * BYTES_PER_FLOAT32;
};

export class MeshRecord {
  constructor({
    format = null,
    name = 'mesh',
    sourceFile = null,
    sourceFiles = [],
    triangles = [],
    materials = {},
    materialOrder = null,
    fitOptions = {}
  } = {}) {
    this.kind = 'meshRecord';
    this.format = format;
    this.name = name;
    this.sourceFile = sourceFile;
    this.sourceFiles = sourceFiles;
    this.triangles = Array.isArray(triangles) ? triangles : [];
    this.triangleCount = this.triangles.length;
    this.materials = materials || {};
    this.materialOrder = Array.isArray(materialOrder) ? materialOrder.slice() : Object.keys(this.materials);
    this.materialCount = Object.keys(this.materials).length;
    this.hasVertexColors = this.triangles.some(triangleHasVertexColors);
    this.summary = summarizeMeshTriangles(this.triangles);
    this.bounds = computeMeshBounds(this.triangles);
    this.fit = computeMeshFit(this.bounds, fitOptions);
    this.normalization = this.fit;
    this.estimatedCpuBytes = estimateMeshTriangleBytes(this.triangles);
    this.metadata = this.toMetadata();
  }

  getFittedPosition(position) {
    return applyMeshFitToPosition(position, this.fit);
  }

  createFittedTriangles() {
    return createFittedTriangles(this.triangles, this.fit);
  }

  toMetadata() {
    return {
      kind: this.kind,
      format: this.format,
      name: this.name,
      sourceFile: this.sourceFile,
      sourceFiles: this.sourceFiles,
      triangleCount: this.triangleCount,
      vertexCount: this.bounds.vertexCount,
      materialCount: this.materialCount,
      materialOrder: this.materialOrder.slice(),
      hasVertexColors: this.hasVertexColors,
      summary: {
        materials: this.summary.materials.map((entry) => ({ ...entry })),
        objects: this.summary.objects.map((entry) => ({ ...entry })),
        groups: this.summary.groups.map((entry) => ({ ...entry })),
        uvTriangleCount: this.summary.uvTriangleCount,
        normalTriangleCount: this.summary.normalTriangleCount,
        vertexColorTriangleCount: this.summary.vertexColorTriangleCount,
        texturedTriangleCount: this.summary.texturedTriangleCount
      },
      estimatedCpuBytes: this.estimatedCpuBytes,
      bounds: cloneBounds(this.bounds),
      fit: cloneFit(this.fit),
      normalization: cloneFit(this.normalization)
    };
  }
}

export const createMeshRecord = (options = {}) => new MeshRecord(options);
