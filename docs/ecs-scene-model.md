# ECS Scene Model Decisions

This document closes TODO audit decision work for the scene ECS model, inspector mixed values, and Rapier body/collider ownership. It is both the contract for remaining migration work and the current Workstream 1 runtime shape: scene object classes still keep legacy renderer methods, but they now expose ECS identity, hierarchy, editor, and component fields for scene-store normalization.

## Entity Records

Every selectable scene item is represented by one entity record. Runtime class instances may keep their current methods during migration, but they must expose the same identity, hierarchy, editor, and component fields.

```ts
type EntityId = string;
type Vec3 = [number, number, number];
type SceneComponent = { type: string; [key: string]: unknown };

type SceneEntity = {
  entityId: EntityId;
  parentEntityId: EntityId | null;
  displayName: string;
  isHidden: boolean;
  isLocked: boolean;
  components: Record<string, SceneComponent>;
};
```

Rules:

- `entityId` is the stable primary key. It is always a string, is unique within a scene, is not derived from array index, and is not reused after deletion during the same editing session.
- The primary light keeps the reserved ID `light`.
- `parentEntityId: null` means the entity is a root. Non-null values must reference an existing entity and must not create cycles.
- `displayName` is editor text only. Empty string means the UI may synthesize a label from the entity type and index.
- `isHidden` prevents rendering, selection hits, and physics creation. `isLocked` prevents direct editor edits but does not by itself remove render or physics behavior.
- `components` is keyed by stable component name. Array form is allowed only as a temporary loader/import bridge; normalized ECS state uses object keys.
- Document order is the fallback display order. For groups, `GroupComponent.childEntityIds` supplies child order and must match each child's `parentEntityId`.
- Scene JSON persists `entityId`, `parentEntityId`, and group `childEntityIds` when present. Loading normalizes those fields, accepts legacy parent aliases, and repairs child lists from parent links before renderer/physics sync.
- Legacy DOM tree rendering follows the same contract: it collects root entities first, appends children depth-first from `parentEntityId` / `childEntityIds`, and keys reusable row buttons by `entityId` rather than array index.

## Core Components

All component objects include a string `type` equal to their key unless noted.

```ts
type TransformComponent = {
  type: 'transform';
  translation: [number, number, number];
  rotationEuler?: [number, number, number];
  scale?: [number, number, number];
  matrixWorld?: number[];
};

type VisibilityComponent = {
  type: 'visibility';
  hidden: boolean;
  locked: boolean;
};

type GeometryComponent =
  | { type: 'geometry'; shape: 'sphere'; radius: number }
  | { type: 'geometry'; shape: 'box'; minCorner: Vec3; maxCorner: Vec3 }
  | { type: 'geometry'; shape: 'sdf'; boundsHalfExtents: Vec3; parameterA: Vec3; parameterB: Vec3; sdfKind: string }
  | { type: 'geometry'; shape: 'mesh'; meshId: string; triangleCount: number; boundsMin: Vec3; boundsMax: Vec3 };

type MaterialComponent = {
  type: 'material';
  material: number;
  glossiness: number;
  emissiveColor?: Vec3;
  emissiveIntensity?: number;
  uvProjectionMode?: 'uv' | 'tri-planar';
  uvScale?: number;
  uvBlendSharpness?: number;
  textures?: Partial<Record<'albedo' | 'normal' | 'metallicRoughness' | 'emissive' | 'ambientOcclusion', {
    textureId: string;
    projection?: {
      mode: 'uv' | 'tri-planar';
      scale?: number;
      blendSharpness?: number;
    };
  }>>;
};

type RenderableComponent = {
  type: 'renderable';
  shaderObjectKind: 'sphere' | 'cube' | 'sdf' | 'mesh' | 'areaLight';
};
```

Rules:

- `TransformComponent` owns placement. Legacy sphere `centerPosition`, cube `minCorner`/`maxCorner`, and SDF `centerPosition` fields are compatibility views over transform plus geometry data.
- `MaterialComponent` owns `material`, `glossiness`, optional emissive values, and material texture projection metadata. During migration, legacy `sceneObject.material`, `sceneObject.glossiness`, and projection fields may forward to this component so shader code can remain unchanged.
- Texture projection is renderer/material state. Mesh imports default to authored UV projection when valid UVs exist; primitives, SDFs, and UV-less meshes can explicitly use `tri-planar` projection, which blends three axis-aligned material texture samples by surface-normal weights.
- `RenderableComponent` means the entity can produce path-tracer shader/uniform data. Groups and pure editor helpers do not have this component.
- `GeometryComponent` describes authored shape data. It does not create physics by itself.

## Group Entities

Groups are first-class entities but do not render.

```ts
type GroupComponent = {
  type: 'group';
  childEntityIds: EntityId[];
};

type GroupEntity = SceneEntity & {
  components: {
    transform: TransformComponent;
    visibility: VisibilityComponent;
    group: GroupComponent;
    physics?: PhysicsComponent;
    collider?: CompoundColliderComponent;
  };
};
```

Rules:

- A group has `TransformComponent` and `GroupComponent`.
- A group never has `RenderableComponent` and must not generate GLSL uniforms, intersection code, shadow tests, or material evaluation.
- The active renderer enforces this with `isRenderableSceneObject()` guards before shader code joins, material scans, uniform caching, or uniform uploads touch scene objects.
- `childEntityIds` is ordered. A child is valid only when its `parentEntityId` matches the group entity ID.
- Moving a group updates the group transform. Child local transforms remain unchanged; their world transforms are derived from the ancestor chain.
- Hiding a group hides its subtree for rendering, selection, and physics creation. Locking a group prevents group edits and subtree transform edits unless a later tool explicitly supports locked-parent overrides.

## Import Hierarchy

glTF import should preserve node hierarchy with ECS entities:

- Each glTF node becomes a group entity when it has children or a non-identity transform.
- Each mesh primitive becomes a renderable entity under the node's group.
- Mesh entities carry `TransformComponent`, `GeometryComponent(shape: 'mesh')`, `MaterialComponent`, and `RenderableComponent`.
- Animation clips attach as `AnimationComponent` records to the entity whose transform they drive.
- Imported animation is editor animation state, not physics state. Benchmark scenes freeze it unless the benchmark explicitly enables animation.

## Mixed Values In Settings Panels

Mixed values appear when a panel edits more than one selected entity and the normalized values for a field are not equal.

Comparison rules:

- Booleans compare by exact value.
- Strings compare after trimming editor-only whitespace.
- Numbers compare after the same clamping/normalization used when committing the field. Values within `0.000001` are equal.
- Vec3 and color fields compare component-wise with the numeric rule.
- Select values compare after enum normalization. For physics body type, legacy `fixed` equals `static`.
- Missing optional component fields compare equal only when every selected entity is missing the field. Missing on some and present on others is mixed.

Display and commit rules:

- Text inputs show an empty value with placeholder `Mixed`. Typing commits the new value to every editable selected entity.
- Number inputs show an empty value with placeholder `Mixed`. Entering a number commits it to every editable selected entity after normal validation.
- Range sliders paired with numeric readouts show the readout text `Mixed`; the slider is disabled until the user enters a numeric value or picks a preset for that field.
- Selects use a temporary value `__mixed` displayed as `Mixed`. Choosing a real option applies it to every editable selected entity.
- Checkboxes use `indeterminate = true` and `aria-checked="mixed"`. The first click sets `true` for every editable selected entity; the next click sets `false`.
- Color controls show a checker swatch and `Mixed` label. Picking a color applies it to every editable selected entity.
- Vector fields mix per axis. For example, position may show `X: Mixed`, `Y: 0.25`, `Z: Mixed`.
- Locked entities are included when computing mixed state but skipped on commit. If every selected entity for a field is locked or lacks the relevant component, the control is disabled and keeps the mixed display.
- A bulk edit triggers the same side effects as a single edit: mark uniforms dirty, rebuild/resync physics if the field affects physics, update scene tree rows, and clear accumulated samples.

## Physics And Rapier Ownership

Only physics and collider components create Rapier objects. Render, material, geometry, animation, and editor metadata components never create Rapier bodies or colliders on their own.

```ts
type PhysicsComponent = {
  type: 'physics';
  enabled: boolean;
  bodyType: 'dynamic' | 'kinematic' | 'static';
  mass: number;
  gravityScale: number;
  friction: number;
  restitution: number;
  collideWithObjects: boolean;
};

type SphereColliderComponent = {
  type: 'collider';
  shape: 'sphere';
  radius: number;
  isTrigger?: boolean;
};

type BoxColliderComponent = {
  type: 'collider';
  shape: 'box';
  halfExtents: Vec3;
  isTrigger?: boolean;
};

type CompoundColliderComponent = {
  type: 'collider';
  shape: 'compound';
  childEntityIds: EntityId[];
};

type ColliderComponent =
  | SphereColliderComponent
  | BoxColliderComponent
  | CompoundColliderComponent;
```

Rapier creation rules:

- An entity is considered for Rapier only when it is visible, has `PhysicsComponent.enabled === true`, has `TransformComponent`, and has `ColliderComponent`.
- `PhysicsComponent.bodyType: 'dynamic'` creates a Rapier dynamic rigid body plus attached collider.
- `PhysicsComponent.bodyType: 'kinematic'` creates a Rapier position-based kinematic rigid body plus attached collider. If the loaded Rapier build lacks that API, the integration may fall back to static collider creation and must report the fallback.
- `PhysicsComponent.bodyType: 'static'` creates a fixed world collider. The ECS entity should not retain a `physicsRigidBody` handle for static colliders.
- `SphereColliderComponent` creates `ColliderDesc.ball(radius)`.
- `BoxColliderComponent` creates `ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)`.
- `CompoundColliderComponent` is valid only on groups. It creates one body for the group and attaches child colliders computed from each listed child's bounds in group-local space.
- A child under an enabled compound physics group does not create its own rigid body. Its collider data contributes to the nearest enabled ancestor group body.
- `isTrigger: true` creates a sensor collider. It reports overlap/collision events but must not contribute physical response.
- `mass` and `gravityScale` apply only to dynamic bodies. Static and kinematic bodies keep the values in ECS for future body-type changes but ignore them at Rapier creation time.
- `friction` and `restitution` apply to every collider shape.
- `collideWithObjects: true` uses the normal object collision mask: floor plus other objects. `false` uses the ghost mask: floor only. It is not the same as a trigger.
- Room boundary colliders are world infrastructure, not ECS entities. Closed Cornell environments create floor, ceiling, and four walls; open-sky studio creates the floor only.

Current migration mapping:

- `SphereSceneObject` maps to transform, sphere geometry, material, renderable, physics, and sphere collider components. Its default physics body is `dynamic`.
- `CubeSceneObject` maps to transform, box geometry, material, renderable, physics, and box collider components. Its default physics body is `static`.
- `SdfSceneObject` and subclasses map to transform, SDF geometry, material, and renderable components. They do not create Rapier objects until an explicit collider component is added.
- `AreaLightSceneObject` maps to transform, SDF/rounded-box geometry, material/light emission, and renderable components. It does not create Rapier objects by default.
- `LightSceneObject` maps to transform and light components only. It does not create Rapier objects.
- `GroupEntity` is active in the legacy runtime and appears directly in `sceneObjects`. It maps to transform, visibility, group, and optional physics compatibility data, but intentionally has no renderable component or shader methods.
- Scene save/load now includes ECS IDs, parent links, and group child IDs. Loading creates `GroupEntity` instances for group snapshots, restores child `parentEntityId` values, and re-syncs group `childEntityIds` from the runtime object list.
- The runtime sync path calls `setSceneStoreSceneItems(this.sceneObjects)` after hierarchy repair, so `sceneStore` reflects the active runtime items instead of a separate static copy.
- Runtime renderable objects now store material state in `MaterialComponent` instances while exposing `sceneObject.material` and `sceneObject.glossiness` as compatibility accessors for shader generation and scene save/load paths.
- Physics-capable runtime objects now store body settings and the transient Rapier handle in `PhysicsComponent` instances while exposing `physicsRigidBody`, `isPhysicsEnabled`, `physicsBodyType`, `physicsMass`, `physicsGravityScale`, `physicsFriction`, `physicsRestitution`, and `collideWithObjects` as compatibility accessors for the existing physics rebuild path.
