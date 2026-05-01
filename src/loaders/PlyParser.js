import {
  DEFAULT_UV,
  PATH_TRACER_MATERIAL,
  computeFaceNormal,
  createTriangle,
  normalizeColorComponent,
  normalizeVector3,
  parseFiniteNumber,
  triangulateFan
} from './geometry.js';

const PLY_TYPE_READERS = Object.freeze({
  char: { size: 1, read: (view, offset) => view.getInt8(offset) },
  int8: { size: 1, read: (view, offset) => view.getInt8(offset) },
  uchar: { size: 1, read: (view, offset) => view.getUint8(offset) },
  uint8: { size: 1, read: (view, offset) => view.getUint8(offset) },
  short: { size: 2, read: (view, offset, littleEndian) => view.getInt16(offset, littleEndian) },
  int16: { size: 2, read: (view, offset, littleEndian) => view.getInt16(offset, littleEndian) },
  ushort: { size: 2, read: (view, offset, littleEndian) => view.getUint16(offset, littleEndian) },
  uint16: { size: 2, read: (view, offset, littleEndian) => view.getUint16(offset, littleEndian) },
  int: { size: 4, read: (view, offset, littleEndian) => view.getInt32(offset, littleEndian) },
  int32: { size: 4, read: (view, offset, littleEndian) => view.getInt32(offset, littleEndian) },
  uint: { size: 4, read: (view, offset, littleEndian) => view.getUint32(offset, littleEndian) },
  uint32: { size: 4, read: (view, offset, littleEndian) => view.getUint32(offset, littleEndian) },
  float: { size: 4, read: (view, offset, littleEndian) => view.getFloat32(offset, littleEndian) },
  float32: { size: 4, read: (view, offset, littleEndian) => view.getFloat32(offset, littleEndian) },
  double: { size: 8, read: (view, offset, littleEndian) => view.getFloat64(offset, littleEndian) },
  float64: { size: 8, read: (view, offset, littleEndian) => view.getFloat64(offset, littleEndian) }
});

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

const decodeText = (bytes) => new TextDecoder('utf-8').decode(bytes);

const findHeaderEnd = (bytes) => {
  const marker = new TextEncoder().encode('end_header');
  for (let index = 0; index <= bytes.length - marker.length; index += 1) {
    let matches = true;
    for (let markerIndex = 0; markerIndex < marker.length; markerIndex += 1) {
      if (bytes[index + markerIndex] !== marker[markerIndex]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    let endOffset = index + marker.length;
    if (bytes[endOffset] === 13 && bytes[endOffset + 1] === 10) {
      endOffset += 2;
    } else if (bytes[endOffset] === 10 || bytes[endOffset] === 13) {
      endOffset += 1;
    }
    return endOffset;
  }
  return -1;
};

const parseHeader = (headerText) => {
  const lines = headerText.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim());
  if (lines[0] !== 'ply') {
    throw new SyntaxError('PLY header must start with "ply".');
  }
  const elements = [];
  const comments = [];
  let format = null;
  let version = null;
  let currentElement = null;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line || line === 'end_header') {
      continue;
    }
    const tokens = line.split(/\s+/);
    const directive = tokens.shift();
    if (directive === 'format') {
      [format, version] = tokens;
    } else if (directive === 'comment') {
      comments.push(tokens.join(' '));
    } else if (directive === 'element') {
      currentElement = {
        name: tokens[0],
        count: Number.parseInt(tokens[1], 10) || 0,
        properties: []
      };
      elements.push(currentElement);
    } else if (directive === 'property' && currentElement) {
      if (tokens[0] === 'list') {
        currentElement.properties.push({
          kind: 'list',
          countType: tokens[1],
          itemType: tokens[2],
          name: tokens[3]
        });
      } else {
        currentElement.properties.push({
          kind: 'scalar',
          type: tokens[0],
          name: tokens[1]
        });
      }
    }
  }

  if (!format) {
    throw new SyntaxError('PLY header is missing a format declaration.');
  }
  return {
    format,
    version,
    elements,
    comments
  };
};

const readTypedValue = (view, offset, type, littleEndian) => {
  const reader = PLY_TYPE_READERS[type];
  if (!reader) {
    throw new SyntaxError(`Unsupported PLY property type "${type}".`);
  }
  return {
    value: reader.read(view, offset, littleEndian),
    offset: offset + reader.size
  };
};

const getElement = (header, name) => header.elements.find((element) => element.name === name) || null;

const hasColorProperties = (vertexElement) => {
  if (!vertexElement) {
    return false;
  }
  const names = new Set(vertexElement.properties.map((property) => property.name));
  return names.has('red') && names.has('green') && names.has('blue');
};

const vertexFromRecord = (record, vertexElement) => {
  const colorProperty = (name) => vertexElement.properties.find((property) => property.name === name);
  const vertex = {
    position: [
      parseFiniteNumber(record.x, 0),
      parseFiniteNumber(record.y, 0),
      parseFiniteNumber(record.z, 0)
    ],
    normal: record.nx !== undefined && record.ny !== undefined && record.nz !== undefined
      ? normalizeVector3([
        parseFiniteNumber(record.nx, 0),
        parseFiniteNumber(record.ny, 1),
        parseFiniteNumber(record.nz, 0)
      ])
      : null,
    color: null
  };
  if (record.red !== undefined && record.green !== undefined && record.blue !== undefined) {
    vertex.color = [
      normalizeColorComponent(record.red, colorProperty('red')?.type),
      normalizeColorComponent(record.green, colorProperty('green')?.type),
      normalizeColorComponent(record.blue, colorProperty('blue')?.type)
    ];
  }
  return vertex;
};

const findFaceIndices = (record) => record.vertex_indices || record.vertex_index || record.indices || null;

const buildTriangles = (vertices, faces) => {
  const triangles = [];
  for (const face of faces) {
    const indices = face.indices || [];
    if (indices.length < 3) {
      continue;
    }
    for (const triangleIndices of triangulateFan(indices)) {
      const triangleVertices = triangleIndices.map((index) => vertices[index]);
      if (triangleVertices.some((vertex) => !vertex)) {
        continue;
      }
      const positions = triangleVertices.map((vertex) => vertex.position);
      const flatNormal = computeFaceNormal(positions);
      const normals = triangleVertices.map((vertex) => vertex.normal || flatNormal);
      const vertexColors = triangleVertices.every((vertex) => vertex.color)
        ? triangleVertices.map((vertex) => vertex.color)
        : null;
      triangles.push(createTriangle({
        positions,
        normals,
        uvs: [DEFAULT_UV, DEFAULT_UV, DEFAULT_UV],
        vertexColors
      }));
    }
  }
  return triangles;
};

const createPlyResult = ({ header, vertices, faces, triangles, warnings }) => {
  const vertexElement = getElement(header, 'vertex');
  const hasVertexColors = hasColorProperties(vertexElement);
  return {
    format: 'ply',
    encoding: header.format,
    header,
    vertices,
    faces,
    triangles,
    warnings,
    hasVertexColors,
    material: hasVertexColors
      ? {
        pathTracerMaterial: PATH_TRACER_MATERIAL.DIFFUSE,
        material: PATH_TRACER_MATERIAL.DIFFUSE,
        usesVertexColors: true
      }
      : null,
    materials: {},
    triangleCount: triangles.length
  };
};

export class PlyParser {
  parse(input) {
    if (typeof input === 'string') {
      return this.parseText(input);
    }
    const bytes = toUint8Array(input);
    if (!bytes) {
      throw new TypeError('PlyParser.parse() expects a PLY string, ArrayBuffer, DataView, or typed array.');
    }
    const headerEndOffset = findHeaderEnd(bytes);
    if (headerEndOffset < 0) {
      throw new SyntaxError('PLY input is missing end_header.');
    }
    const headerText = decodeText(bytes.slice(0, headerEndOffset));
    const header = parseHeader(headerText);
    if (header.format === 'ascii') {
      return this.parseText(decodeText(bytes));
    }
    if (header.format !== 'binary_little_endian') {
      throw new SyntaxError(`Unsupported PLY format "${header.format}".`);
    }
    return this.parseBinaryLittleEndian(bytes, header, headerEndOffset);
  }

  parseText(text) {
    if (typeof text !== 'string') {
      throw new TypeError('PlyParser.parseText() expects a PLY string.');
    }
    const normalizedText = text.replace(/\r\n?/g, '\n');
    const headerMatch = /(^|\n)end_header\n/.exec(normalizedText);
    if (!headerMatch) {
      throw new SyntaxError('PLY input is missing end_header.');
    }
    const headerEndIndex = headerMatch.index + headerMatch[0].length;
    const header = parseHeader(normalizedText.slice(0, headerEndIndex));
    if (header.format !== 'ascii') {
      throw new SyntaxError(`parseText() only supports ASCII PLY, received "${header.format}".`);
    }

    const dataLines = normalizedText.slice(headerEndIndex).split('\n');
    let lineOffset = 0;
    const vertices = [];
    const faces = [];
    const warnings = [];

    for (const element of header.elements) {
      for (let elementIndex = 0; elementIndex < element.count; elementIndex += 1) {
        const line = dataLines[lineOffset] || '';
        lineOffset += 1;
        const tokens = line.trim().split(/\s+/).filter(Boolean);
        let tokenOffset = 0;
        const record = {};
        for (const property of element.properties) {
          if (property.kind === 'list') {
            const count = Number.parseInt(tokens[tokenOffset], 10) || 0;
            tokenOffset += 1;
            record[property.name] = tokens
              .slice(tokenOffset, tokenOffset + count)
              .map((token) => Number.parseInt(token, 10));
            tokenOffset += count;
          } else {
            record[property.name] = parseFiniteNumber(tokens[tokenOffset], 0);
            tokenOffset += 1;
          }
        }
        if (element.name === 'vertex') {
          vertices.push(vertexFromRecord(record, element));
        } else if (element.name === 'face') {
          const indices = findFaceIndices(record);
          if (indices) {
            faces.push({ indices });
          } else {
            warnings.push('Skipped PLY face without a vertex_indices property.');
          }
        }
      }
    }

    return createPlyResult({
      header,
      vertices,
      faces,
      triangles: buildTriangles(vertices, faces),
      warnings
    });
  }

  parseBinaryLittleEndian(input, headerInput = null, headerEndInput = null) {
    const bytes = toUint8Array(input);
    if (!bytes) {
      throw new TypeError('PlyParser.parseBinaryLittleEndian() expects an ArrayBuffer, DataView, or typed array.');
    }
    const headerEndOffset = headerEndInput ?? findHeaderEnd(bytes);
    if (headerEndOffset < 0) {
      throw new SyntaxError('PLY input is missing end_header.');
    }
    const header = headerInput || parseHeader(decodeText(bytes.slice(0, headerEndOffset)));
    if (header.format !== 'binary_little_endian') {
      throw new SyntaxError(`parseBinaryLittleEndian() only supports binary_little_endian, received "${header.format}".`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vertices = [];
    const faces = [];
    const warnings = [];
    let offset = headerEndOffset;

    for (const element of header.elements) {
      for (let elementIndex = 0; elementIndex < element.count; elementIndex += 1) {
        const record = {};
        for (const property of element.properties) {
          if (property.kind === 'list') {
            const countResult = readTypedValue(view, offset, property.countType, true);
            offset = countResult.offset;
            const values = [];
            for (let itemIndex = 0; itemIndex < countResult.value; itemIndex += 1) {
              const itemResult = readTypedValue(view, offset, property.itemType, true);
              offset = itemResult.offset;
              values.push(itemResult.value);
            }
            record[property.name] = values;
          } else {
            const result = readTypedValue(view, offset, property.type, true);
            offset = result.offset;
            record[property.name] = result.value;
          }
        }
        if (element.name === 'vertex') {
          vertices.push(vertexFromRecord(record, element));
        } else if (element.name === 'face') {
          const indices = findFaceIndices(record);
          if (indices) {
            faces.push({ indices });
          } else {
            warnings.push('Skipped PLY face without a vertex_indices property.');
          }
        }
      }
    }

    return createPlyResult({
      header,
      vertices,
      faces,
      triangles: buildTriangles(vertices, faces),
      warnings
    });
  }
}

export const parsePly = (input) => new PlyParser().parse(input);

