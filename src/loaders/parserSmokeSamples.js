import { MtlParser } from './MtlParser.js';
import { ObjParser } from './ObjParser.js';
import { PlyParser } from './PlyParser.js';
import { StlParser } from './StlParser.js';

export const createLoaderSmokeSamples = () => ({
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
  ].join('\n')
});

export const runLoaderSmokeSamples = () => {
  const samples = createLoaderSmokeSamples();
  const mtl = new MtlParser().parse(samples.mtl);
  const obj = new ObjParser().parse(samples.obj, { materials: mtl.materials });
  const stl = new StlParser().parse(samples.stl);
  const ply = new PlyParser().parse(samples.ply);
  return {
    objTriangleCount: obj.triangleCount,
    objMaterialCount: Object.keys(obj.materials).length,
    stlTriangleCount: stl.triangleCount,
    plyTriangleCount: ply.triangleCount,
    plyHasVertexColors: ply.hasVertexColors
  };
};

