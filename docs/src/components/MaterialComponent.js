export const MATERIAL_COMPONENT_TYPE = 'material';
export const DEFAULT_MATERIAL = 0;
export const DEFAULT_MATERIAL_GLOSSINESS = 0.6;
export const MATERIAL_UV_PROJECTION_MODES = Object.freeze([
  Object.freeze({ key: 'uv', label: 'UV' }),
  Object.freeze({ key: 'tri-planar', label: 'Tri-planar' })
]);
export const DEFAULT_MATERIAL_UV_PROJECTION_MODE = MATERIAL_UV_PROJECTION_MODES[0].key;
export const DEFAULT_MATERIAL_UV_SCALE = 1;
export const DEFAULT_MATERIAL_UV_BLEND_SHARPNESS = 4;
const MIN_MATERIAL_GLOSSINESS = 0;
const MAX_MATERIAL_GLOSSINESS = 1;
const MIN_MATERIAL_UV_SCALE = 0.05;
const MAX_MATERIAL_UV_SCALE = 64;
const MIN_MATERIAL_UV_BLEND_SHARPNESS = 1;
const MAX_MATERIAL_UV_BLEND_SHARPNESS = 12;
const MATERIAL_UV_PROJECTION_MODE_KEYS = new Set(MATERIAL_UV_PROJECTION_MODES.map((mode) => mode.key));

const normalizeFiniteNumber = (value, fallbackValue) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
};

const normalizeMaterialValue = (value, fallbackValue = DEFAULT_MATERIAL) => {
  const materialValue = normalizeFiniteNumber(value, fallbackValue);
  return Math.trunc(materialValue);
};

const normalizeGlossinessValue = (value, fallbackValue = DEFAULT_MATERIAL_GLOSSINESS) => {
  const glossinessValue = normalizeFiniteNumber(value, fallbackValue);
  return Math.min(Math.max(glossinessValue, MIN_MATERIAL_GLOSSINESS), MAX_MATERIAL_GLOSSINESS);
};

export const normalizeMaterialUvProjectionMode = (
  value,
  fallbackValue = DEFAULT_MATERIAL_UV_PROJECTION_MODE
) => {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  if (normalizedValue === 'triplanar' || normalizedValue === 'tri_planar') {
    return 'tri-planar';
  }
  return MATERIAL_UV_PROJECTION_MODE_KEYS.has(normalizedValue) ? normalizedValue : fallbackValue;
};

export const normalizeMaterialUvScale = (value, fallbackValue = DEFAULT_MATERIAL_UV_SCALE) => {
  const scaleValue = normalizeFiniteNumber(value, fallbackValue);
  return Math.min(Math.max(scaleValue, MIN_MATERIAL_UV_SCALE), MAX_MATERIAL_UV_SCALE);
};

export const normalizeMaterialUvBlendSharpness = (
  value,
  fallbackValue = DEFAULT_MATERIAL_UV_BLEND_SHARPNESS
) => {
  const blendValue = normalizeFiniteNumber(value, fallbackValue);
  return Math.min(Math.max(blendValue, MIN_MATERIAL_UV_BLEND_SHARPNESS), MAX_MATERIAL_UV_BLEND_SHARPNESS);
};

export class MaterialComponent {
  constructor(options = {}) {
    this.type = MATERIAL_COMPONENT_TYPE;
    this.material = normalizeMaterialValue(options.material ?? options.materialIndex, options.defaultMaterial);
    this.glossiness = normalizeGlossinessValue(options.glossiness, options.defaultGlossiness);
    this.uvProjectionMode = normalizeMaterialUvProjectionMode(
      options.uvProjectionMode ?? options.textureProjectionMode ?? options.projectionMode,
      options.defaultUvProjectionMode
    );
    this.uvScale = normalizeMaterialUvScale(
      options.uvScale ?? options.textureProjectionScale ?? options.projectionScale,
      options.defaultUvScale
    );
    this.uvBlendSharpness = normalizeMaterialUvBlendSharpness(
      options.uvBlendSharpness ?? options.textureProjectionBlendSharpness ?? options.projectionBlendSharpness,
      options.defaultUvBlendSharpness
    );
  }

  setMaterial(material, fallbackMaterial = this.material) {
    this.material = normalizeMaterialValue(material, fallbackMaterial);
    return this.material;
  }

  setGlossiness(glossiness, fallbackGlossiness = this.glossiness) {
    this.glossiness = normalizeGlossinessValue(glossiness, fallbackGlossiness);
    return this.glossiness;
  }

  setUvProjectionMode(mode, fallbackMode = this.uvProjectionMode) {
    this.uvProjectionMode = normalizeMaterialUvProjectionMode(mode, fallbackMode);
    return this.uvProjectionMode;
  }

  setUvScale(scale, fallbackScale = this.uvScale) {
    this.uvScale = normalizeMaterialUvScale(scale, fallbackScale);
    return this.uvScale;
  }

  setUvBlendSharpness(blendSharpness, fallbackBlendSharpness = this.uvBlendSharpness) {
    this.uvBlendSharpness = normalizeMaterialUvBlendSharpness(blendSharpness, fallbackBlendSharpness);
    return this.uvBlendSharpness;
  }

  clone(overrides = {}) {
    return new MaterialComponent({
      material: this.material,
      glossiness: this.glossiness,
      uvProjectionMode: this.uvProjectionMode,
      uvScale: this.uvScale,
      uvBlendSharpness: this.uvBlendSharpness,
      ...overrides
    });
  }

  toJSON() {
    return {
      type: this.type,
      material: this.material,
      glossiness: this.glossiness,
      uvProjectionMode: this.uvProjectionMode,
      uvScale: this.uvScale,
      uvBlendSharpness: this.uvBlendSharpness
    };
  }
}

export const createMaterialComponent = (options = {}) => new MaterialComponent(options);
