import { GltfLoader } from './GltfLoader.js';
import { MeshRecord } from './MeshRecord.js';
import { MtlParser } from './MtlParser.js';
import { ObjParser } from './ObjParser.js';
import { PlyParser } from './PlyParser.js';
import { StlParser } from './StlParser.js';

const GLTF_POSITION_OFFSET = 0;
const GLTF_NORMAL_OFFSET = 36;
const GLTF_UV_OFFSET = 72;
const GLTF_INDEX_OFFSET = 96;
const GLTF_BYTE_LENGTH = 102;

const createTriangleGltfBuffer = () => {
  const buffer = new ArrayBuffer(GLTF_BYTE_LENGTH);
  new Float32Array(buffer, GLTF_POSITION_OFFSET, 9).set([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0
  ]);
  new Float32Array(buffer, GLTF_NORMAL_OFFSET, 9).set([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1
  ]);
  new Float32Array(buffer, GLTF_UV_OFFSET, 6).set([
    0, 0,
    1, 0,
    0, 1
  ]);
  new Uint16Array(buffer, GLTF_INDEX_OFFSET, 3).set([0, 1, 2]);
  return buffer;
};

const createTriangleGltfJson = (bufferByteLength, bufferUri = 'triangle.bin') => ({
  asset: {
    version: '2.0',
    generator: 'loader smoke sample'
  },
  buffers: [{
    ...(bufferUri ? { uri: bufferUri } : {}),
    byteLength: bufferByteLength
  }],
  bufferViews: [
    { buffer: 0, byteOffset: GLTF_POSITION_OFFSET, byteLength: 36 },
    { buffer: 0, byteOffset: GLTF_NORMAL_OFFSET, byteLength: 36 },
    { buffer: 0, byteOffset: GLTF_UV_OFFSET, byteLength: 24 },
    { buffer: 0, byteOffset: GLTF_INDEX_OFFSET, byteLength: 6 }
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
    { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' }
  ],
  materials: [{
    name: 'sample_gold',
    pbrMetallicRoughness: {
      baseColorFactor: [1, 0.766, 0.336, 1],
      metallicFactor: 1,
      roughnessFactor: 0.15
    }
  }],
  meshes: [{
    name: 'Triangle',
    primitives: [{
      attributes: {
        POSITION: 0,
        NORMAL: 1,
        TEXCOORD_0: 2
      },
      indices: 3,
      material: 0
    }]
  }],
  nodes: [{ mesh: 0 }],
  scenes: [{ nodes: [0] }],
  scene: 0
});

const createTriangleGlb = () => {
  const sourceBuffer = createTriangleGltfBuffer();
  const sourceBytes = new Uint8Array(sourceBuffer);
  const binPadding = (4 - (sourceBytes.byteLength % 4)) % 4;
  const binChunkLength = sourceBytes.byteLength + binPadding;
  const gltf = createTriangleGltfJson(binChunkLength, null);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonChunkLength = jsonBytes.byteLength + jsonPadding;
  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonChunkLength);

  const binHeaderOffset = 20 + jsonChunkLength;
  view.setUint32(binHeaderOffset, binChunkLength, true);
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true);
  bytes.set(sourceBytes, binHeaderOffset + 8);

  return bytes.buffer;
};

export const createLoaderSmokeSamples = () => {
  const gltfBuffer = createTriangleGltfBuffer();
  return {
    obj: [
      'mtllib sample.mtl',
      'o Triangle',
      'g Front',
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'vt 0 0',
      'vt 1 0',
      'vt 0 1',
      'vn 0 0 1',
      'usemtl white',
      'f 1/1/1 2/2/1 3/3/1'
    ].join('\n'),
    mtl: [
      'newmtl white',
      'Kd 1 1 1',
      'Ks 0.1 0.1 0.1',
      'Ns 64',
      'd 1',
      'map_Kd white.png'
    ].join('\n'),
    stl: [
      'solid triangle',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 0 0 0',
      'vertex 1 0 0',
      'vertex 0 1 0',
      'endloop',
      'endfacet',
      'endsolid triangle'
    ].join('\n'),
    ply: [
      'ply',
      'format ascii 1.0',
      'element vertex 3',
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'element face 1',
      'property list uchar int vertex_indices',
      'end_header',
      '0 0 0 255 255 255',
      '1 0 0 255 0 0',
      '0 1 0 0 255 0',
      '3 0 1 2'
    ].join('\n'),
    gltf: {
      json: JSON.stringify(createTriangleGltfJson(gltfBuffer.byteLength)),
      buffers: {
        'triangle.bin': gltfBuffer
      }
    },
    glb: createTriangleGlb()
  };
};

export const runLoaderSmokeSamples = () => {
  const samples = createLoaderSmokeSamples();
  const mtl = new MtlParser().parse(samples.mtl);
  const obj = new ObjParser().parse(samples.obj, { materials: mtl.materials });
  const stl = new StlParser().parse(samples.stl);
  const ply = new PlyParser().parse(samples.ply);
  const gltf = new GltfLoader().parse(samples.gltf.json, { buffers: samples.gltf.buffers });
  const glb = new GltfLoader().parse(samples.glb);
  const objMeshRecord = new MeshRecord({
    format: 'obj',
    name: 'loader-smoke-obj',
    triangles: obj.triangles,
    materials: obj.materials,
    fitOptions: {
      targetSize: 2,
      targetCenter: [0, 0, 0]
    }
  });
  const fittedObjTriangles = objMeshRecord.createFittedTriangles();

  return {
    objTriangleCount: obj.triangleCount,
    objMaterialCount: Object.keys(obj.materials).length,
    objMeshRecordTriangleCount: objMeshRecord.triangleCount,
    objMeshBoundsLongestAxis: objMeshRecord.bounds.longestAxis,
    objMeshMaterialSummaryCount: objMeshRecord.metadata.summary.materials.length,
    objMeshGroupSummaryCount: objMeshRecord.metadata.summary.groups.length,
    objMeshFitTargetSize: objMeshRecord.fit.targetSize,
    objMeshFitScale: objMeshRecord.fit.scale,
    objMeshFittedLongestAxis: objMeshRecord.fit.fittedBounds.longestAxis,
    objMeshEstimatedCpuBytes: objMeshRecord.estimatedCpuBytes,
    objMeshFittedFirstPosition: fittedObjTriangles[0]?.positions[0] || null,
    stlTriangleCount: stl.triangleCount,
    plyTriangleCount: ply.triangleCount,
    plyHasVertexColors: ply.hasVertexColors,
    gltfTriangleCount: gltf.triangleCount,
    gltfMaterialCount: Object.keys(gltf.materials).length,
    gltfMaterialType: gltf.materials.sample_gold.material,
    gltfEncoding: gltf.encoding,
    glbTriangleCount: glb.triangleCount,
    glbEncoding: glb.encoding
  };
};
