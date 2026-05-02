export const PHYSICS_COMPONENT_TYPE = 'physics';
export const PHYSICS_COMPONENT_BODY_TYPE = Object.freeze({
  STATIC: 'static',
  KINEMATIC: 'kinematic',
  DYNAMIC: 'dynamic'
});

const normalizeFiniteNumber = (value, fallbackValue, minValue = Number.NEGATIVE_INFINITY, maxValue = Number.POSITIVE_INFINITY) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallbackValue;
  }
  return Math.min(Math.max(numberValue, minValue), maxValue);
};

const normalizeBoolean = (value, fallbackValue) => {
  if (value === null || value === undefined) {
    return Boolean(fallbackValue);
  }
  return Boolean(value);
};

const normalizeBodyType = (value, fallbackValue = PHYSICS_COMPONENT_BODY_TYPE.STATIC) => {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  if (
    normalizedValue === PHYSICS_COMPONENT_BODY_TYPE.DYNAMIC ||
    normalizedValue === PHYSICS_COMPONENT_BODY_TYPE.KINEMATIC ||
    normalizedValue === PHYSICS_COMPONENT_BODY_TYPE.STATIC
  ) {
    return normalizedValue;
  }
  if (normalizedValue === 'fixed') {
    return PHYSICS_COMPONENT_BODY_TYPE.STATIC;
  }
  return fallbackValue;
};

export class PhysicsComponent {
  constructor(options = {}) {
    this.type = PHYSICS_COMPONENT_TYPE;
    this.enabled = normalizeBoolean(options.enabled ?? options.isEnabled, true);
    this.bodyType = normalizeBodyType(options.bodyType ?? options.physicsBodyType, options.defaultBodyType);
    this.mass = normalizeFiniteNumber(options.mass ?? options.physicsMass, 1, 0);
    this.gravityScale = normalizeFiniteNumber(options.gravityScale ?? options.physicsGravityScale, 1, 0);
    this.friction = normalizeFiniteNumber(options.friction ?? options.physicsFriction, 0, 0, 1);
    this.restitution = normalizeFiniteNumber(options.restitution ?? options.physicsRestitution, 0, 0, 1);
    this.collideWithObjects = normalizeBoolean(options.collideWithObjects, true);
    this.physicsRigidBody = options.physicsRigidBody ?? options.rigidBody ?? null;
  }

  get rigidBody() {
    return this.physicsRigidBody;
  }

  set rigidBody(rigidBody) {
    this.physicsRigidBody = rigidBody ?? null;
  }

  attachRigidBody(rigidBody) {
    this.physicsRigidBody = rigidBody;
    return this.physicsRigidBody;
  }

  clearRigidBody() {
    this.physicsRigidBody = null;
    return this.physicsRigidBody;
  }

  clone(overrides = {}) {
    return new PhysicsComponent({
      enabled: this.enabled,
      bodyType: this.bodyType,
      mass: this.mass,
      gravityScale: this.gravityScale,
      friction: this.friction,
      restitution: this.restitution,
      collideWithObjects: this.collideWithObjects,
      ...overrides,
      physicsRigidBody: overrides.physicsRigidBody ?? overrides.rigidBody ?? null
    });
  }

  toJSON() {
    return {
      type: this.type,
      enabled: this.enabled,
      bodyType: this.bodyType,
      mass: this.mass,
      gravityScale: this.gravityScale,
      friction: this.friction,
      restitution: this.restitution,
      collideWithObjects: this.collideWithObjects
    };
  }
}

export const createPhysicsComponent = (options = {}) => new PhysicsComponent(options);
