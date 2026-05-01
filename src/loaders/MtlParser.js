import {
  PATH_TRACER_MATERIAL,
  clampNumber,
  cloneColor,
  parseFiniteNumber
} from './geometry.js';

const DEFAULT_MATERIAL_NAME = 'default';

const TEXTURE_OPTION_ARITY = Object.freeze({
  '-blendu': 1,
  '-blendv': 1,
  '-boost': 1,
  '-bm': 1,
  '-cc': 1,
  '-clamp': 1,
  '-imfchan': 1,
  '-mm': 2,
  '-o': 3,
  '-s': 3,
  '-t': 3,
  '-texres': 1,
  '-type': 1
});
const NUMERIC_TEXTURE_OPTIONS = new Set(['-bm', '-boost', '-mm', '-o', '-s', '-t', '-texres']);

const createDefaultMaterial = (name) => ({
  name,
  diffuseColor: [0.8, 0.8, 0.8],
  specularColor: [0, 0, 0],
  shininess: 0,
  opacity: 1,
  diffuseTexture: null,
  pathTracerMaterial: PATH_TRACER_MATERIAL.DIFFUSE,
  material: PATH_TRACER_MATERIAL.DIFFUSE,
  glossiness: 0,
  roughness: 1,
  isTextured: false
});

const tokenizeMtlLine = (line) => {
  const tokens = [];
  let token = '';
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        token += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }
    token += character;
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
};

const stripInlineComment = (line) => {
  const hashIndex = line.indexOf('#');
  return hashIndex === -1 ? line : line.slice(0, hashIndex);
};

const parseColor = (tokens, fallback) => {
  if (tokens.length < 3) {
    return cloneColor(fallback);
  }
  return cloneColor([
    parseFiniteNumber(tokens[0], fallback[0]),
    parseFiniteNumber(tokens[1], fallback[1]),
    parseFiniteNumber(tokens[2], fallback[2])
  ]);
};

const parseTexturePath = (tokens) => {
  const pathTokens = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('-')) {
      const arity = TEXTURE_OPTION_ARITY[token.toLowerCase()] ?? 0;
      if (NUMERIC_TEXTURE_OPTIONS.has(token.toLowerCase())) {
        let consumed = 0;
        while (
          consumed < arity &&
          index + 1 < tokens.length &&
          !tokens[index + 1].startsWith('-') &&
          Number.isFinite(Number.parseFloat(tokens[index + 1]))
        ) {
          index += 1;
          consumed += 1;
        }
      } else {
        index += arity;
      }
      continue;
    }
    pathTokens.push(token);
  }
  return pathTokens.length > 0 ? pathTokens.join(' ') : null;
};

const classifyMaterial = (material) => {
  const maxSpecular = Math.max(...material.specularColor);
  const opacity = material.opacity;
  const shininess = material.shininess;
  if (opacity < 0.98) {
    return PATH_TRACER_MATERIAL.GLASS;
  }
  if (maxSpecular > 0.85 && shininess >= 500) {
    return PATH_TRACER_MATERIAL.MIRROR;
  }
  if (maxSpecular > 0.05 || shininess > 1) {
    return PATH_TRACER_MATERIAL.GGX_PBR;
  }
  return PATH_TRACER_MATERIAL.DIFFUSE;
};

const finalizeMaterial = (material) => {
  const normalizedShininess = clampNumber(material.shininess / 1000, 0, 1, 0);
  material.opacity = clampNumber(material.opacity, 0, 1, 1);
  material.glossiness = normalizedShininess;
  material.roughness = clampNumber(1 - Math.sqrt(normalizedShininess), 0.02, 1, 1);
  material.isTextured = Boolean(material.diffuseTexture);
  material.pathTracerMaterial = classifyMaterial(material);
  material.material = material.pathTracerMaterial;
  return material;
};

export class MtlParser {
  parse(text) {
    if (typeof text !== 'string') {
      throw new TypeError('MtlParser.parse() expects an MTL string.');
    }

    const materials = {};
    const materialOrder = [];
    const warnings = [];
    let currentMaterial = null;

    const commitMaterial = () => {
      if (!currentMaterial) {
        return;
      }
      materials[currentMaterial.name] = finalizeMaterial(currentMaterial);
    };

    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = stripInlineComment(lines[lineIndex]).trim();
      if (!line) {
        continue;
      }
      const tokens = tokenizeMtlLine(line);
      const directive = tokens.shift();
      if (!directive) {
        continue;
      }
      const normalizedDirective = directive.toLowerCase();
      if (normalizedDirective === 'newmtl') {
        commitMaterial();
        const name = tokens.join(' ').trim() || `${DEFAULT_MATERIAL_NAME}_${materialOrder.length + 1}`;
        currentMaterial = createDefaultMaterial(name);
        materialOrder.push(name);
        continue;
      }
      if (!currentMaterial) {
        currentMaterial = createDefaultMaterial(DEFAULT_MATERIAL_NAME);
        materialOrder.push(currentMaterial.name);
      }

      if (normalizedDirective === 'kd') {
        currentMaterial.diffuseColor = parseColor(tokens, currentMaterial.diffuseColor);
      } else if (normalizedDirective === 'ks') {
        currentMaterial.specularColor = parseColor(tokens, currentMaterial.specularColor);
      } else if (normalizedDirective === 'ns') {
        currentMaterial.shininess = Math.max(parseFiniteNumber(tokens[0], currentMaterial.shininess), 0);
      } else if (normalizedDirective === 'd') {
        currentMaterial.opacity = clampNumber(parseFiniteNumber(tokens[0], currentMaterial.opacity), 0, 1, currentMaterial.opacity);
      } else if (normalizedDirective === 'tr') {
        currentMaterial.opacity = 1 - clampNumber(parseFiniteNumber(tokens[0], 1 - currentMaterial.opacity), 0, 1, 0);
      } else if (normalizedDirective === 'map_kd') {
        currentMaterial.diffuseTexture = parseTexturePath(tokens);
      } else {
        warnings.push(`Ignored unsupported MTL directive "${directive}" on line ${lineIndex + 1}.`);
      }
    }
    commitMaterial();

    return {
      materials,
      materialOrder,
      warnings,
      getMaterial(name) {
        return materials[name] || null;
      }
    };
  }
}

export const parseMtl = (text) => new MtlParser().parse(text);
export { PATH_TRACER_MATERIAL };
