export const MATERIAL_COMPONENT_TYPE = 'material';
export const DEFAULT_MATERIAL = 0;
export const DEFAULT_MATERIAL_GLOSSINESS = 0.6;
const MIN_MATERIAL_GLOSSINESS = 0;
const MAX_MATERIAL_GLOSSINESS = 1;

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

export class MaterialComponent {
  constructor(options = {}) {
    this.type = MATERIAL_COMPONENT_TYPE;
    this.material = normalizeMaterialValue(options.material ?? options.materialIndex, options.defaultMaterial);
    this.glossiness = normalizeGlossinessValue(options.glossiness, options.defaultGlossiness);
  }

  setMaterial(material, fallbackMaterial = this.material) {
    this.material = normalizeMaterialValue(material, fallbackMaterial);
    return this.material;
  }

  setGlossiness(glossiness, fallbackGlossiness = this.glossiness) {
    this.glossiness = normalizeGlossinessValue(glossiness, fallbackGlossiness);
    return this.glossiness;
  }

  clone(overrides = {}) {
    return new MaterialComponent({
      material: this.material,
      glossiness: this.glossiness,
      ...overrides
    });
  }

  toJSON() {
    return {
      type: this.type,
      material: this.material,
      glossiness: this.glossiness
    };
  }
}

export const createMaterialComponent = (options = {}) => new MaterialComponent(options);
