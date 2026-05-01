import { MtlParser } from './MtlParser.js';
import {
  DEFAULT_UV,
  computeFaceNormal,
  createTriangle,
  normalizeVector3,
  parseFiniteNumber,
  triangulateFan
} from './geometry.js';

const DEFAULT_OBJECT_NAME = 'Object';
const DEFAULT_GROUP_NAME = 'default';

const stripInlineComment = (line) => {
  const hashIndex = line.indexOf('#');
  return hashIndex === -1 ? line : line.slice(0, hashIndex);
};

const normalizeObjText = (text) => text
  .replace(/\r\n?/g, '\n')
  .replace(/\\\n/g, ' ');

const resolveObjIndex = (rawIndex, collectionLength) => {
  if (!rawIndex) {
    return -1;
  }
  const parsed = Number.parseInt(rawIndex, 10);
  if (!Number.isFinite(parsed) || parsed === 0) {
    return -1;
  }
  return parsed < 0 ? collectionLength + parsed : parsed - 1;
};

const readVector3 = (tokens) => [
  parseFiniteNumber(tokens[0], 0),
  parseFiniteNumber(tokens[1], 0),
  parseFiniteNumber(tokens[2], 0)
];

const readVector2 = (tokens) => [
  parseFiniteNumber(tokens[0], 0),
  parseFiniteNumber(tokens[1], 0)
];

const parseFaceVertex = (token, counts) => {
  const parts = token.split('/');
  return {
    positionIndex: resolveObjIndex(parts[0], counts.positions),
    uvIndex: resolveObjIndex(parts[1], counts.uvs),
    normalIndex: resolveObjIndex(parts[2], counts.normals)
  };
};

const parseMtlInputs = (inputs) => {
  if (!inputs) {
    return {};
  }
  if (typeof inputs === 'string') {
    return new MtlParser().parse(inputs).materials;
  }
  if (inputs.materials && typeof inputs.materials === 'object') {
    return inputs.materials;
  }
  if (Object.values(inputs).every((value) => value && typeof value === 'object' && typeof value.name === 'string')) {
    return inputs;
  }
  const parsedMaterials = {};
  for (const [libraryName, mtlText] of Object.entries(inputs)) {
    if (typeof mtlText !== 'string') {
      continue;
    }
    const parsedLibrary = new MtlParser().parse(mtlText);
    for (const [materialName, material] of Object.entries(parsedLibrary.materials)) {
      parsedMaterials[materialName] = {
        ...material,
        libraryName
      };
    }
  }
  return parsedMaterials;
};

const createObjResult = ({
  triangles,
  positions,
  normals,
  uvs,
  objects,
  groups,
  materialLibraries,
  materials,
  warnings
}) => ({
  format: 'obj',
  triangles,
  positions,
  normals,
  uvs,
  objects,
  groups,
  materialLibraries,
  materials,
  warnings,
  triangleCount: triangles.length
});

export class ObjParser {
  constructor(options = {}) {
    this.options = options;
  }

  parse(text, parseOptions = {}) {
    if (typeof text !== 'string') {
      throw new TypeError('ObjParser.parse() expects an OBJ string.');
    }

    const options = {
      ...this.options,
      ...parseOptions
    };
    const positions = [];
    const normals = [];
    const uvs = [];
    const triangles = [];
    const objects = [];
    const groups = [];
    const materialLibraries = [];
    const warnings = [];
    const materials = parseMtlInputs(options.mtlText || options.mtlTexts || options.materials);
    let objectName = options.objectName || DEFAULT_OBJECT_NAME;
    let groupName = options.groupName || DEFAULT_GROUP_NAME;
    let materialName = null;

    const addObjectName = (name) => {
      const normalizedName = name || DEFAULT_OBJECT_NAME;
      objectName = normalizedName;
      if (!objects.includes(normalizedName)) {
        objects.push(normalizedName);
      }
    };
    const addGroupName = (name) => {
      const normalizedName = name || DEFAULT_GROUP_NAME;
      groupName = normalizedName;
      if (!groups.includes(normalizedName)) {
        groups.push(normalizedName);
      }
    };
    addObjectName(objectName);
    addGroupName(groupName);

    const lines = normalizeObjText(text).split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = stripInlineComment(lines[lineIndex]).trim();
      if (!line) {
        continue;
      }
      const [directive, ...tokens] = line.split(/\s+/);
      const normalizedDirective = directive.toLowerCase();

      if (normalizedDirective === 'v') {
        positions.push(readVector3(tokens));
      } else if (normalizedDirective === 'vn') {
        normals.push(normalizeVector3(readVector3(tokens)));
      } else if (normalizedDirective === 'vt') {
        uvs.push(readVector2(tokens));
      } else if (normalizedDirective === 'o') {
        addObjectName(tokens.join(' ').trim());
      } else if (normalizedDirective === 'g') {
        addGroupName(tokens.join(' ').trim());
      } else if (normalizedDirective === 'usemtl') {
        materialName = tokens.join(' ').trim() || null;
      } else if (normalizedDirective === 'mtllib') {
        const libraryName = tokens.join(' ').trim();
        if (libraryName) {
          materialLibraries.push(libraryName);
        }
      } else if (normalizedDirective === 'f') {
        if (tokens.length < 3) {
          warnings.push(`Skipped face with fewer than three vertices on line ${lineIndex + 1}.`);
          continue;
        }
        const faceVertices = tokens.map((token) => parseFaceVertex(token, {
          positions: positions.length,
          normals: normals.length,
          uvs: uvs.length
        }));
        const fanTriangles = triangulateFan(faceVertices);
        for (const triangleVertices of fanTriangles) {
          const trianglePositions = triangleVertices.map((vertex) => positions[vertex.positionIndex]);
          if (trianglePositions.some((position) => !position)) {
            warnings.push(`Skipped face with invalid position index on line ${lineIndex + 1}.`);
            continue;
          }
          const fallbackNormal = computeFaceNormal(trianglePositions);
          const triangleNormals = triangleVertices.map((vertex) => normals[vertex.normalIndex] || fallbackNormal);
          const triangleUvs = triangleVertices.map((vertex) => uvs[vertex.uvIndex] || DEFAULT_UV);
          triangles.push(createTriangle({
            positions: trianglePositions,
            normals: triangleNormals,
            uvs: triangleUvs,
            materialName,
            objectName,
            groupName
          }));
        }
      }
    }

    return createObjResult({
      triangles,
      positions,
      normals,
      uvs,
      objects,
      groups,
      materialLibraries,
      materials,
      warnings
    });
  }
}

export const loadObjFromText = (text, options = {}) => new ObjParser(options).parse(text, options);

const resolveSiblingUrl = (url, siblingPath) => {
  try {
    return new URL(siblingPath, url).toString();
  } catch {
    return siblingPath;
  }
};

const fetchText = async (url, fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('loadObjFromUrl() requires a fetch implementation.');
  }
  const response = await fetchImpl(url);
  if (!response || !response.ok) {
    throw new Error(`Failed to fetch OBJ asset: ${url}`);
  }
  return response.text();
};

export const loadObjFromUrl = async (url, options = {}) => {
  const objText = await fetchText(url, options.fetch);
  let mtlTexts = options.mtlTexts || null;
  if (!mtlTexts && options.loadMaterials !== false) {
    const probeResult = new ObjParser(options).parse(objText, {
      ...options,
      mtlTexts: null,
      mtlText: null,
      materials: null
    });
    mtlTexts = {};
    await Promise.all(probeResult.materialLibraries.map(async (libraryName) => {
      const libraryUrl = resolveSiblingUrl(url, libraryName);
      try {
        mtlTexts[libraryName] = await fetchText(libraryUrl, options.fetch);
      } catch (error) {
        if (options.strictMaterials) {
          throw error;
        }
      }
    }));
  }
  return new ObjParser(options).parse(objText, {
    ...options,
    mtlTexts
  });
};
