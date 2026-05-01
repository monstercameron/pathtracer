export const PATH_TRACER_MATERIAL = Object.freeze({
  DIFFUSE: 0,
  MIRROR: 1,
  GLOSSY: 2,
  GLASS: 3,
  GGX_PBR: 4
});

export const DEFAULT_UV = Object.freeze([0, 0]);
export const DEFAULT_COLOR = Object.freeze([1, 1, 1]);

export const cloneVector2 = (value = DEFAULT_UV) => [
  Number.isFinite(value[0]) ? value[0] : 0,
  Number.isFinite(value[1]) ? value[1] : 0
];

export const cloneVector3 = (value = [0, 0, 0]) => [
  Number.isFinite(value[0]) ? value[0] : 0,
  Number.isFinite(value[1]) ? value[1] : 0,
  Number.isFinite(value[2]) ? value[2] : 0
];

export const subtractVector3 = (a, b) => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2]
];

export const crossVector3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];

export const normalizeVector3 = (value, fallback = [0, 1, 0]) => {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector3(fallback);
  }
  return [
    value[0] / length,
    value[1] / length,
    value[2] / length
  ];
};

export const computeFaceNormal = (positions) => {
  if (!positions || positions.length < 3) {
    return [0, 1, 0];
  }
  const edgeA = subtractVector3(positions[1], positions[0]);
  const edgeB = subtractVector3(positions[2], positions[0]);
  return normalizeVector3(crossVector3(edgeA, edgeB));
};

export const cloneColor = (value = DEFAULT_COLOR) => [
  clampNumber(value[0], 0, 1, 1),
  clampNumber(value[1], 0, 1, 1),
  clampNumber(value[2], 0, 1, 1)
];

export const clampNumber = (value, min = 0, max = 1, fallback = min) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
};

export const parseFiniteNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeColorComponent = (value, typeName = '') => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  if (/uchar|uint8|char|int8|ushort|uint16|short|int16|uint|int/i.test(typeName) || parsed > 1) {
    return clampNumber(parsed / 255, 0, 1, 1);
  }
  return clampNumber(parsed, 0, 1, 1);
};

export const createTriangle = ({
  positions,
  normals,
  uvs,
  materialName = null,
  objectName = null,
  groupName = null,
  vertexColors = null
}) => {
  const trianglePositions = positions.map(cloneVector3);
  const fallbackNormal = computeFaceNormal(trianglePositions);
  const triangleNormals = (normals && normals.length === 3 ? normals : [fallbackNormal, fallbackNormal, fallbackNormal])
    .map((normal) => normalizeVector3(normal, fallbackNormal));
  const triangleUvs = (uvs && uvs.length === 3 ? uvs : [DEFAULT_UV, DEFAULT_UV, DEFAULT_UV])
    .map(cloneVector2);
  const triangle = {
    positions: trianglePositions,
    normals: triangleNormals,
    uvs: triangleUvs,
    materialName,
    objectName,
    groupName
  };
  if (vertexColors && vertexColors.length === 3) {
    triangle.vertexColors = vertexColors.map(cloneColor);
  }
  return triangle;
};

export const triangulateFan = (vertices) => {
  const triangles = [];
  for (let index = 1; index < vertices.length - 1; index += 1) {
    triangles.push([vertices[0], vertices[index], vertices[index + 1]]);
  }
  return triangles;
};

