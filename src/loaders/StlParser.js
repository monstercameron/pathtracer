import {
  DEFAULT_UV,
  computeFaceNormal,
  createTriangle,
  normalizeVector3,
  parseFiniteNumber
} from './geometry.js';

const BINARY_STL_HEADER_BYTES = 80;
const BINARY_STL_TRIANGLE_COUNT_BYTES = 4;
const BINARY_STL_TRIANGLE_BYTES = 50;

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

const decodeAscii = (bytes) => new TextDecoder('utf-8').decode(bytes);

const looksLikeBinaryStl = (bytes) => {
  if (!bytes || bytes.byteLength < BINARY_STL_HEADER_BYTES + BINARY_STL_TRIANGLE_COUNT_BYTES) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(BINARY_STL_HEADER_BYTES, true);
  return BINARY_STL_HEADER_BYTES + BINARY_STL_TRIANGLE_COUNT_BYTES + triangleCount * BINARY_STL_TRIANGLE_BYTES === bytes.byteLength;
};

const parseName = (text) => {
  const match = /^\s*solid\s+([^\r\n]+)/i.exec(text);
  return match ? match[1].trim() : null;
};

const parseVertexLine = (line) => {
  const [, x = '0', y = '0', z = '0'] = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line) || [];
  return [
    parseFiniteNumber(x, 0),
    parseFiniteNumber(y, 0),
    parseFiniteNumber(z, 0)
  ];
};

const parseNormalLine = (line) => {
  const [, x = '0', y = '1', z = '0'] = /^\s*facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line) || [];
  return normalizeVector3([
    parseFiniteNumber(x, 0),
    parseFiniteNumber(y, 1),
    parseFiniteNumber(z, 0)
  ]);
};

const createStlTriangle = (positions, normal) => {
  const faceNormal = normalizeVector3(normal || computeFaceNormal(positions), computeFaceNormal(positions));
  return createTriangle({
    positions,
    normals: [faceNormal, faceNormal, faceNormal],
    uvs: [DEFAULT_UV, DEFAULT_UV, DEFAULT_UV]
  });
};

export class StlParser {
  parse(input) {
    if (typeof input === 'string') {
      return this.parseAscii(input);
    }
    const bytes = toUint8Array(input);
    if (!bytes) {
      throw new TypeError('StlParser.parse() expects an STL string, ArrayBuffer, DataView, or typed array.');
    }
    if (looksLikeBinaryStl(bytes)) {
      return this.parseBinary(bytes);
    }
    const text = decodeAscii(bytes);
    if (/^\s*solid\b/i.test(text) && /\bfacet\s+normal\b/i.test(text)) {
      return this.parseAscii(text);
    }
    return this.parseBinary(bytes);
  }

  parseAscii(text) {
    if (typeof text !== 'string') {
      throw new TypeError('StlParser.parseAscii() expects an STL string.');
    }
    const triangles = [];
    const warnings = [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let currentNormal = null;
    let currentVertices = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex].trim();
      if (/^facet\s+normal\b/i.test(line)) {
        currentNormal = parseNormalLine(line);
        currentVertices = [];
      } else if (/^vertex\b/i.test(line)) {
        currentVertices.push(parseVertexLine(line));
      } else if (/^endfacet\b/i.test(line)) {
        if (currentVertices.length === 3) {
          triangles.push(createStlTriangle(currentVertices, currentNormal));
        } else if (currentVertices.length > 0) {
          warnings.push(`Skipped malformed ASCII STL facet ending on line ${lineIndex + 1}.`);
        }
        currentNormal = null;
        currentVertices = [];
      }
    }

    return {
      format: 'stl',
      encoding: 'ascii',
      name: parseName(text),
      triangles,
      warnings,
      triangleCount: triangles.length,
      materials: {}
    };
  }

  parseBinary(input) {
    const bytes = toUint8Array(input);
    if (!bytes) {
      throw new TypeError('StlParser.parseBinary() expects an ArrayBuffer, DataView, or typed array.');
    }
    if (bytes.byteLength < BINARY_STL_HEADER_BYTES + BINARY_STL_TRIANGLE_COUNT_BYTES) {
      throw new RangeError('Binary STL is too small to contain a header and triangle count.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangleCount = view.getUint32(BINARY_STL_HEADER_BYTES, true);
    const expectedLength = BINARY_STL_HEADER_BYTES + BINARY_STL_TRIANGLE_COUNT_BYTES + triangleCount * BINARY_STL_TRIANGLE_BYTES;
    const warnings = [];
    if (expectedLength > bytes.byteLength) {
      throw new RangeError('Binary STL triangle count exceeds the supplied byte length.');
    }
    if (expectedLength < bytes.byteLength) {
      warnings.push('Binary STL contains trailing bytes after the declared triangle data.');
    }

    const triangles = [];
    let offset = BINARY_STL_HEADER_BYTES + BINARY_STL_TRIANGLE_COUNT_BYTES;
    for (let index = 0; index < triangleCount; index += 1) {
      const normal = [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
      ];
      offset += 12;
      const positions = [];
      for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
        positions.push([
          view.getFloat32(offset, true),
          view.getFloat32(offset + 4, true),
          view.getFloat32(offset + 8, true)
        ]);
        offset += 12;
      }
      offset += 2;
      triangles.push(createStlTriangle(positions, normal));
    }

    const headerText = decodeAscii(bytes.slice(0, BINARY_STL_HEADER_BYTES)).replace(/\0/g, '').trim();
    return {
      format: 'stl',
      encoding: 'binary',
      name: headerText || null,
      triangles,
      warnings,
      triangleCount: triangles.length,
      materials: {}
    };
  }
}

export const parseStl = (input) => new StlParser().parse(input);

