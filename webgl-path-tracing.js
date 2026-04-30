/*
 WebGL Path Tracing (https://madebyevan.com/webgl-path-tracing/)
 License: MIT License

 Copyright (c) 2010 Evan Wallace
 Modernized local runtime changes copyright (c) 2026.
*/

'use strict';

const CANVAS_SIZE = 512;
const HALF_CANVAS_SIZE = CANVAS_SIZE / 2;
const CANVAS_SIZE_RECIPROCAL = 1 / CANVAS_SIZE;
const CAMERA_FIELD_OF_VIEW_DEGREES = 55;
const CAMERA_NEAR_PLANE = 0.1;
const CAMERA_FAR_PLANE = 100;
const CAMERA_FIELD_SCALE = 1 / Math.tan((CAMERA_FIELD_OF_VIEW_DEGREES * Math.PI / 180) / 2);
const CAMERA_NEAR_FAR_RANGE = 1 / (CAMERA_NEAR_PLANE - CAMERA_FAR_PLANE);
const CAMERA_ROTATION_SPEED = 0.01;
const CAMERA_AUTO_ROTATION_SPEED = 0.12;
const INITIAL_CAMERA_DISTANCE = 2.5;
const PHYSICS_FIXED_TIMESTEP_SECONDS = 1 / 60;
const PHYSICS_MAX_FRAME_SECONDS = 1 / 15;
const PHYSICS_GRAVITY_Y = -2.5;
const PHYSICS_ROOM_WALL_THICKNESS = 0.04;
const PHYSICS_SPHERE_RESTITUTION = 0.45;
const PHYSICS_SPHERE_FRICTION = 0.75;
const PHYSICS_CUBE_FRICTION = 0.85;
const PHYSICS_CUBE_RESTITUTION = 0.15;
const PHYSICS_POSITION_EPSILON = 0.00001;
const DEFAULT_LIGHT_SIZE = 0.1;
const MIN_LIGHT_SIZE = 0.02;
const MAX_LIGHT_SIZE = 0.5;
const DEFAULT_LIGHT_INTENSITY = 0.5;
const MIN_LIGHT_INTENSITY = 0.1;
const MAX_LIGHT_INTENSITY = 1;
const LIGHT_INTENSITY_CYCLE_SPEED = 0.45;
const DEFAULT_FOG_DENSITY = 0;
const MIN_FOG_DENSITY = 0;
const MAX_FOG_DENSITY = 2;
const DEFAULT_SKY_BRIGHTNESS = 1.25;
const MIN_SKY_BRIGHTNESS = 0.1;
const MAX_SKY_BRIGHTNESS = 5;
const DEFAULT_LIGHT_BOUNCE_COUNT = 5;
const MIN_LIGHT_BOUNCE_COUNT = 1;
const MAX_LIGHT_BOUNCE_COUNT = 8;
const DEFAULT_RAYS_PER_PIXEL = 32;
const MIN_RAYS_PER_PIXEL = 1;
const MAX_RAYS_PER_PIXEL = 32;
const DEFAULT_TEMPORAL_BLEND_FRAMES = 32;
const MIN_TEMPORAL_BLEND_FRAMES = 1;
const MAX_TEMPORAL_BLEND_FRAMES = 32;
const DEFAULT_COLOR_EXPOSURE = 0;
const MIN_COLOR_EXPOSURE = -4;
const MAX_COLOR_EXPOSURE = 4;
const DEFAULT_COLOR_BRIGHTNESS = 0;
const MIN_COLOR_BRIGHTNESS = -1;
const MAX_COLOR_BRIGHTNESS = 1;
const DEFAULT_COLOR_CONTRAST = 1;
const MIN_COLOR_CONTRAST = 0;
const MAX_COLOR_CONTRAST = 2;
const DEFAULT_COLOR_SATURATION = 1;
const MIN_COLOR_SATURATION = 0;
const MAX_COLOR_SATURATION = 2;
const DEFAULT_COLOR_GAMMA = 1;
const MIN_COLOR_GAMMA = 0.2;
const MAX_COLOR_GAMMA = 3;
const DEFAULT_CAMERA_FOCUS_DISTANCE = 2.5;
const MIN_CAMERA_FOCUS_DISTANCE = 0.5;
const MAX_CAMERA_FOCUS_DISTANCE = 6;
const DEFAULT_CAMERA_APERTURE = 0;
const MIN_CAMERA_APERTURE = 0;
const MAX_CAMERA_APERTURE = 0.2;
const DEFAULT_MOTION_BLUR_STRENGTH = 0;
const MIN_MOTION_BLUR_STRENGTH = 0;
const MAX_MOTION_BLUR_STRENGTH = 0.95;
const DEFAULT_DENOISER_STRENGTH = 0.8;
const MIN_DENOISER_STRENGTH = 0;
const MAX_DENOISER_STRENGTH = 1;
const DEFAULT_BLOOM_STRENGTH = 0.35;
const MIN_BLOOM_STRENGTH = 0;
const MAX_BLOOM_STRENGTH = 2;
const DEFAULT_BLOOM_THRESHOLD = 1;
const MIN_BLOOM_THRESHOLD = 0;
const MAX_BLOOM_THRESHOLD = 4;
const DEFAULT_GLARE_STRENGTH = 0.2;
const MIN_GLARE_STRENGTH = 0;
const MAX_GLARE_STRENGTH = 2;
const RANDOM_SAMPLE_SEQUENCE_WRAP = 1048576;
const SKY_TEXTURE_WIDTH = 256;
const SKY_TEXTURE_HEIGHT = 128;
const BYTES_PER_RGBA_PIXEL = 4;
const UINT32_RECIPROCAL = 1 / 4294967296;
const HALTON_BASE_3_RECIPROCAL = 1 / 3;
const SHADER_EPSILON = '0.0001';
const SHADER_INFINITY = '10000.0';
const MAX_INTERSECTION_DISTANCE = Number.MAX_VALUE;
const FLOATS_PER_VEC3 = 3;
const FLOATS_PER_MAT4 = 16;
const WEBGL_POWER_PREFERENCE = 'high-performance';
const HIGH_PERFORMANCE_WEBGL_CONTEXT_ATTRIBUTES = Object.freeze({
  powerPreference: WEBGL_POWER_PREFERENCE,
  failIfMajorPerformanceCaveat: false
});
const PREFERRED_GPU_RENDERER_PATTERNS = Object.freeze([/\bB580\b/i, /\bArc\b/i]);
const TEMPORAL_DISPLAY_SCALAR_UNIFORM_NAMES = Object.freeze([
  'temporalBlendFrames',
  'temporalFrameAge',
  'historyAvailability',
  'motionBlurStrength',
  'denoiserStrength'
]);
const TRACER_FRAME_SCALAR_UNIFORM_NAMES = Object.freeze([
  'glossiness',
  'lightIntensity',
  'lightSize',
  'fogDensity',
  'skyBrightness',
  'cameraFocusDistance',
  'cameraAperture'
]);
const RENDER_SCALAR_UNIFORM_NAMES = Object.freeze([
  'colorExposureScale',
  'colorBrightness',
  'colorContrast',
  'colorSaturation',
  'colorGamma',
  'bloomStrength',
  'bloomThreshold',
  'glareStrength'
]);

const MATERIAL = Object.freeze({
  DIFFUSE: 0,
  MIRROR: 1,
  GLOSSY: 2,
  GLASS: 3
});

const ENVIRONMENT = Object.freeze({
  YELLOW_BLUE_CORNELL_BOX: 0,
  RED_GREEN_CORNELL_BOX: 1,
  OPEN_SKY_STUDIO: 2
});

const RECURSIVE_SPHERE_DIRECTION = Object.freeze({
  X_NEGATIVE: 0,
  X_POSITIVE: 1,
  Y_NEGATIVE: 2,
  Y_POSITIVE: 3,
  Z_NEGATIVE: 4,
  Z_POSITIVE: 5
});

const renderVertexSource = [
  'attribute vec2 vertex;',
  'varying vec2 texCoord;',
  'void main() {',
  '  texCoord = vertex.xy * 0.5 + 0.5;',
  '  gl_Position = vec4(vertex, 0.0, 1.0);',
  '}'
].join('');

const renderColorManagementSource = [
  'float renderColorLuminance(vec3 color) {',
  '  return dot(color, vec3(0.2126, 0.7152, 0.0722));',
  '}',
  'vec3 applyExposure(vec3 color) {',
  '  return color * colorExposureScale;',
  '}',
  'vec3 applyBrightness(vec3 color) {',
  '  return color + vec3(colorBrightness);',
  '}',
  'vec3 applyContrast(vec3 color) {',
  '  return (color - vec3(0.5)) * colorContrast + vec3(0.5);',
  '}',
  'vec3 applySaturation(vec3 color) {',
  '  return mix(vec3(renderColorLuminance(color)), color, colorSaturation);',
  '}',
  'vec3 applyGamma(vec3 color) {',
  '  return pow(max(color, vec3(0.0)), vec3(1.0 / max(colorGamma, 0.01)));',
  '}'
].join('');

const renderBloomSource = [
  `vec2 bloomPixelStep() { return vec2(1.0 / ${CANVAS_SIZE}.0); }`,
  'vec3 extractBloomColorFromExposed(vec3 exposedColor) {',
  '  float luminance = renderColorLuminance(exposedColor);',
  '  float knee = max(bloomThreshold * 0.25, 0.001);',
  '  float bloomWeight = smoothstep(bloomThreshold - knee, bloomThreshold + knee, luminance);',
  '  return exposedColor * bloomWeight;',
  '}',
  'vec3 extractBloomColor(vec3 color) {',
  '  return extractBloomColorFromExposed(applyExposure(color));',
  '}',
  'vec3 sampleBloomTap(vec2 texCoord, vec2 offset, float weight) {',
  '  vec2 sampleCoord = texCoord + offset * bloomPixelStep();',
  '  return extractBloomColor(texture2D(texture, sampleCoord).rgb) * weight;',
  '}',
  'vec3 gatherBloom(vec2 texCoord, vec3 centerExposedColor) {',
  '  vec3 bloomColor = vec3(0.0);',
  '  float radius = 1.0 + bloomStrength * 5.0;',
  '  bloomColor += extractBloomColorFromExposed(centerExposedColor) * 0.24;',
  '  bloomColor += sampleBloomTap(texCoord, vec2(radius, 0.0), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(-radius, 0.0), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(0.0, radius), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(0.0, -radius), 0.12);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(radius, radius), 0.07);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(-radius, radius), 0.07);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(radius, -radius), 0.07);',
  '  bloomColor += sampleBloomTap(texCoord, vec2(-radius, -radius), 0.07);',
  '  return bloomColor;',
  '}',
  'vec3 gatherGlare(vec2 texCoord) {',
  '  vec3 glareColor = vec3(0.0);',
  '  float radius = 2.0 + glareStrength * 8.0;',
  '  glareColor += sampleBloomTap(texCoord, vec2(radius, 0.0), 0.18);',
  '  glareColor += sampleBloomTap(texCoord, vec2(-radius, 0.0), 0.18);',
  '  glareColor += sampleBloomTap(texCoord, vec2(radius * 2.0, 0.0), 0.10);',
  '  glareColor += sampleBloomTap(texCoord, vec2(-radius * 2.0, 0.0), 0.10);',
  '  glareColor += sampleBloomTap(texCoord, vec2(0.0, radius), 0.14);',
  '  glareColor += sampleBloomTap(texCoord, vec2(0.0, -radius), 0.14);',
  '  glareColor += sampleBloomTap(texCoord, vec2(radius, radius), 0.08);',
  '  glareColor += sampleBloomTap(texCoord, vec2(-radius, -radius), 0.08);',
  '  return glareColor;',
  '}'
].join('');

const renderFragmentSource = [
  'precision highp float;',
  'varying vec2 texCoord;',
  'uniform sampler2D texture;',
  'uniform float colorExposureScale;',
  'uniform float colorBrightness;',
  'uniform float colorContrast;',
  'uniform float colorSaturation;',
  'uniform float colorGamma;',
  'uniform float bloomStrength;',
  'uniform float bloomThreshold;',
  'uniform float glareStrength;',
  renderColorManagementSource,
  renderBloomSource,
  'void main() {',
  '  vec3 sourceColor = texture2D(texture, texCoord).rgb;',
  '  vec3 color = sourceColor;',
  '  if(abs(colorExposureScale - 1.0) > 0.0001) color = applyExposure(color);',
  '  if(bloomStrength > 0.0001) color += gatherBloom(texCoord, color) * bloomStrength;',
  '  if(glareStrength > 0.0001) color += gatherGlare(texCoord) * glareStrength;',
  '  if(abs(colorBrightness) > 0.0001) color = applyBrightness(color);',
  '  if(abs(colorContrast - 1.0) > 0.0001) color = applyContrast(color);',
  '  if(abs(colorSaturation - 1.0) > 0.0001) color = applySaturation(color);',
  '  if(abs(colorGamma - 1.0) > 0.0001) color = applyGamma(color);',
  '  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);',
  '}'
].join('');

const lineVertexSource = [
  'precision highp float;',
  'attribute vec3 selectionVertex;',
  'uniform vec3 cubeMin;',
  'uniform vec3 cubeMax;',
  'uniform mat4 modelviewProjection;',
  'void main() {',
  '  vec3 boxPosition = cubeMin + (cubeMax - cubeMin) * selectionVertex;',
  '  gl_Position = modelviewProjection * vec4(boxPosition, 1.0);',
  '}'
].join('\n');

const lineFragmentSource = [
  'precision highp float;',
  'void main() {',
  '  gl_FragColor = vec4(1.0);',
  '}'
].join('\n');

const tracerVertexSource = [
  'precision highp float;',
  'attribute vec2 vertex;',
  'uniform vec3 rayCenter, rayClipX, rayClipY;',
  'uniform vec2 rayJitter;',
  'varying vec3 initialRay;',
  'void main() {',
  '  vec2 jitteredClip = vertex.xy + rayJitter;',
  '  initialRay = rayCenter + rayClipX * jitteredClip.x + rayClipY * jitteredClip.y;',
  '  gl_Position = vec4(vertex, 0.0, 1.0);',
  '}'
].join('');

const tracerFragmentSourceHeader = [
  'precision highp float;',
  'uniform vec3 eye;',
  'varying vec3 initialRay;',
  'uniform float textureWeight;',
  'uniform float sampleSeed;',
  'uniform sampler2D texture;',
  'uniform float glossiness;',
  'uniform float lightIntensity;',
  'uniform float lightSize;',
  'uniform float fogDensity;',
  'uniform float skyBrightness;',
  'uniform vec3 cameraRight;',
  'uniform vec3 cameraUp;',
  'uniform float cameraFocusDistance;',
  'uniform float cameraAperture;',
  'uniform sampler2D skyTexture;',
  'vec3 roomCubeMin = vec3(-1.0, -1.0, -1.0);',
  'vec3 roomCubeMax = vec3(1.0, 1.0, 1.0);'
].join('');

const intersectCubeSource = [
  'vec2 intersectCube(vec3 origin, vec3 ray, vec3 cubeMin, vec3 cubeMax) {',
  '  vec3 tMin = (cubeMin - origin) / ray;',
  '  vec3 tMax = (cubeMax - origin) / ray;',
  '  vec3 t1 = min(tMin, tMax);',
  '  vec3 t2 = max(tMin, tMax);',
  '  float tNear = max(max(t1.x, t1.y), t1.z);',
  '  float tFar = min(min(t2.x, t2.y), t2.z);',
  '  return vec2(tNear, tFar);',
  '}'
].join('');

const intersectCubeDistanceSource = [
  'float intersectCubeDistance(vec2 cubeHit) {',
  `  if(cubeHit.x >= cubeHit.y) return ${SHADER_INFINITY};`,
  `  if(cubeHit.x > ${SHADER_EPSILON}) return cubeHit.x;`,
  `  if(cubeHit.y > ${SHADER_EPSILON}) return cubeHit.y;`,
  `  return ${SHADER_INFINITY};`,
  '}'
].join('');

const normalForCubeSource = [
  'vec3 normalForCube(vec3 hit, vec3 cubeMin, vec3 cubeMax) {',
  `  if(hit.x < cubeMin.x + ${SHADER_EPSILON}) return vec3(-1.0, 0.0, 0.0);`,
  `  else if(hit.x > cubeMax.x - ${SHADER_EPSILON}) return vec3(1.0, 0.0, 0.0);`,
  `  else if(hit.y < cubeMin.y + ${SHADER_EPSILON}) return vec3(0.0, -1.0, 0.0);`,
  `  else if(hit.y > cubeMax.y - ${SHADER_EPSILON}) return vec3(0.0, 1.0, 0.0);`,
  `  else if(hit.z < cubeMin.z + ${SHADER_EPSILON}) return vec3(0.0, 0.0, -1.0);`,
  '  else return vec3(0.0, 0.0, 1.0);',
  '}'
].join('');

const intersectSphereSource = [
  'float intersectSphere(vec3 origin, vec3 ray, vec3 sphereCenter, float sphereRadius) {',
  '  vec3 toSphere = origin - sphereCenter;',
  '  float a = dot(ray, ray);',
  '  float b = 2.0 * dot(toSphere, ray);',
  '  float c = dot(toSphere, toSphere) - sphereRadius*sphereRadius;',
  '  float discriminant = b*b - 4.0*a*c;',
  '  if(discriminant > 0.0) {',
  '    float root = sqrt(discriminant);',
  '    float tNear = (-b - root) / (2.0 * a);',
  `    if(tNear > ${SHADER_EPSILON}) return tNear;`,
  '    float tFar = (-b + root) / (2.0 * a);',
  `    if(tFar > ${SHADER_EPSILON}) return tFar;`,
  '  }',
  `  return ${SHADER_INFINITY};`,
  '}'
].join('');

const normalForSphereSource = [
  'vec3 normalForSphere(vec3 hit, vec3 sphereCenter, float sphereRadius) {',
  '  return (hit - sphereCenter) / sphereRadius;',
  '}'
].join('');

const randomSource = [
  'float random(vec3 scale, float seed) {',
  '  vec3 hashInput = vec3(gl_FragCoord.xy, seed) + scale;',
  '  hashInput = fract(hashInput * vec3(0.1031, 0.11369, 0.13787));',
  '  hashInput += dot(hashInput, hashInput.yzx + 33.33);',
  '  return fract((hashInput.x + hashInput.y) * hashInput.z);',
  '}'
].join('');

const cosineWeightedDirectionSource = [
  'vec3 cosineWeightedDirection(float seed, vec3 normal) {',
  '  float u = random(vec3(12.9898, 78.233, 151.7182), seed);',
  '  float v = random(vec3(63.7264, 10.873, 623.6736), seed);',
  '  float r = sqrt(u);',
  '  float angle = 6.283185307179586 * v;',
  '  vec3 sdir, tdir;',
  '  if (abs(normal.x)<.5) {',
  '    sdir = cross(normal, vec3(1,0,0));',
  '  } else {',
  '    sdir = cross(normal, vec3(0,1,0));',
  '  }',
  '  tdir = cross(normal, sdir);',
  '  return r*cos(angle)*sdir + r*sin(angle)*tdir + sqrt(1.-u)*normal;',
  '}'
].join('');

const uniformlyRandomDirectionSource = [
  'vec3 uniformlyRandomDirection(float seed) {',
  '  float u = random(vec3(12.9898, 78.233, 151.7182), seed);',
  '  float v = random(vec3(63.7264, 10.873, 623.6736), seed);',
  '  float z = 1.0 - 2.0 * u;',
  '  float r = sqrt(1.0 - z * z);',
  '  float angle = 6.283185307179586 * v;',
  '  return vec3(r * cos(angle), r * sin(angle), z);',
  '}'
].join('');

const uniformlyRandomVectorSource = [
  'vec3 uniformlyRandomVector(float seed) {',
  '  return uniformlyRandomDirection(seed) * sqrt(random(vec3(36.7539, 50.3658, 306.2759), seed));',
  '}'
].join('');

const specularReflectionSource = [
  'vec3 reflectedLight = normalize(reflect(light - hit, normal));',
  'specularHighlight = max(0.0, dot(reflectedLight, normalize(hit - origin)));'
].join('');

const newDiffuseRaySource = 'ray = cosineWeightedDirection(sampleSeed + float(bounce) * 17.0, normal);';

const newReflectiveRaySource = [
  'ray = reflect(ray, normal);',
  specularReflectionSource,
  'float specularPower2 = specularHighlight * specularHighlight;',
  'float specularPower4 = specularPower2 * specularPower2;',
  'float specularPower5 = specularPower4 * specularHighlight;',
  'float specularPower10 = specularPower5 * specularPower5;',
  'specularHighlight = 2.0 * specularPower10 * specularPower10;'
].join('');

const newGlossyRaySource = [
  'ray = normalize(reflect(ray, normal)) + uniformlyRandomVector(sampleSeed + float(bounce) * 17.0) * glossiness;',
  specularReflectionSource,
  'specularHighlight = specularHighlight * specularHighlight * specularHighlight;'
].join('');

const newGlassRaySource = [
  'surfaceColor = vec3(0.96, 0.985, 1.0);',
  'surfaceLightResponse = 0.0;',
  'vec3 normalizedRay = normalize(ray);',
  'float isOutsideSurface = dot(normalizedRay, normal) < 0.0 ? 1.0 : 0.0;',
  'vec3 orientedNormal = isOutsideSurface > 0.5 ? normal : -normal;',
  'float etaRatio = isOutsideSurface > 0.5 ? 0.6666667 : 1.5;',
  'float cosTheta = min(dot(-normalizedRay, orientedNormal), 1.0);',
  'float sinThetaSquared = max(0.0, 1.0 - cosTheta * cosTheta);',
  'float fresnelBase = 0.04;',
  'float oneMinusCosTheta = 1.0 - cosTheta;',
  'float fresnelFactor2 = oneMinusCosTheta * oneMinusCosTheta;',
  'float fresnelFactor5 = fresnelFactor2 * fresnelFactor2 * oneMinusCosTheta;',
  'float fresnel = fresnelBase + (1.0 - fresnelBase) * fresnelFactor5;',
  'vec3 refractedRay = refract(normalizedRay, orientedNormal, etaRatio);',
  'float reflectionSample = random(vec3(71.17, 19.31, 53.91), sampleSeed + float(bounce) * 29.0);',
  'if(etaRatio * etaRatio * sinThetaSquared > 1.0 || reflectionSample < fresnel) {',
  '  ray = reflect(normalizedRay, orientedNormal);',
  '} else {',
  '  ray = refractedRay;',
  '}',
  'colorMask *= surfaceColor;',
  `origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
  'continue;'
].join('');

const yellowBlueCornellBoxSource = [
  'if(hit.x < -0.9999) surfaceColor = vec3(0.1, 0.5, 1.0);',
  'else if(hit.x > 0.9999) surfaceColor = vec3(1.0, 0.9, 0.1);'
].join('');

const redGreenCornellBoxSource = [
  'if(hit.x < -0.9999) surfaceColor = vec3(1.0, 0.3, 0.1);',
  'else if(hit.x > 0.9999) surfaceColor = vec3(0.3, 1.0, 0.1);'
].join('');

const skyShaderSource = [
  'vec3 sampleEnvironmentSky(vec3 ray) {',
  '  vec3 skyDirection = normalize(ray);',
  '  float skyU = atan(skyDirection.z, skyDirection.x) / 6.28318530718 + 0.5;',
  '  float skyV = acos(clamp(skyDirection.y, -1.0, 1.0)) / 3.14159265359;',
  '  return texture2D(skyTexture, vec2(skyU, skyV)).rgb * skyBrightness;',
  '}',
  'float fogTransmittance(float distance) {',
  '  return exp(-max(fogDensity, 0.0) * max(distance, 0.0));',
  '}'
].join('');

const SUCCESS_UNDEFINED_RESULT = Object.freeze([undefined, null]);
const SUCCESS_TRUE_RESULT = Object.freeze([true, null]);
const SUCCESS_FALSE_RESULT = Object.freeze([false, null]);
const SUCCESS_NULL_RESULT = Object.freeze([null, null]);

const returnSuccess = (value) => {
  if (value === undefined) {
    return SUCCESS_UNDEFINED_RESULT;
  }
  if (value === true) {
    return SUCCESS_TRUE_RESULT;
  }
  if (value === false) {
    return SUCCESS_FALSE_RESULT;
  }
  if (value === null) {
    return SUCCESS_NULL_RESULT;
  }
  return [value, null];
};

const returnFailure = (code, message, details = null) => [
  null,
  Object.freeze({ code, message, details })
];

const readErrorMessage = (errorValue) => {
  if (errorValue && typeof errorValue.message === 'string') {
    return errorValue.message;
  }
  return String(errorValue);
};

const loadRapierModule = () => (
  import('./vendor/rapier/rapier.js').then(
    (rapierModule) => returnSuccess(rapierModule),
    (loadError) => returnFailure('rapier-module-load-failed', 'Rapier module could not be loaded.', readErrorMessage(loadError))
  )
);

const initializeRapierRuntime = (rapierModule) => {
  if (!rapierModule || typeof rapierModule.init !== 'function') {
    return Promise.resolve(returnFailure('rapier-init-missing', 'Rapier module does not expose an init function.'));
  }

  const wasmUrl = new URL('./vendor/rapier/rapier_wasm3d_bg.wasm', import.meta.url);
  return rapierModule.init(wasmUrl).then(
    () => returnSuccess(rapierModule),
    (initError) => returnFailure('rapier-init-failed', 'Rapier runtime could not be initialized.', readErrorMessage(initError))
  );
};

const createRapierRuntime = async () => {
  const [rapierModule, loadError] = await loadRapierModule();
  if (loadError) {
    return returnFailure(loadError.code, loadError.message, loadError.details);
  }

  const [rapierRuntime, initError] = await initializeRapierRuntime(rapierModule);
  if (initError) {
    return returnFailure(initError.code, initError.message, initError.details);
  }

  return returnSuccess(rapierRuntime);
};

const createVec3 = (x, y, z) => {
  const vector = new Float32Array(FLOATS_PER_VEC3);
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
  return vector;
};

const createMat4 = () => new Float32Array(FLOATS_PER_MAT4);

const cloneVec3 = (vector) => createVec3(vector[0], vector[1], vector[2]);

const writeVec3 = (outputVector, x, y, z) => {
  outputVector[0] = x;
  outputVector[1] = y;
  outputVector[2] = z;
  return outputVector;
};

const writeAddVec3 = (outputVector, leftVector, rightVector) => writeVec3(
  outputVector,
  leftVector[0] + rightVector[0],
  leftVector[1] + rightVector[1],
  leftVector[2] + rightVector[2]
);

const writeSubtractVec3 = (outputVector, leftVector, rightVector) => writeVec3(
  outputVector,
  leftVector[0] - rightVector[0],
  leftVector[1] - rightVector[1],
  leftVector[2] - rightVector[2]
);

const writeScaleVec3 = (outputVector, vector, scalar) => writeVec3(
  outputVector,
  vector[0] * scalar,
  vector[1] * scalar,
  vector[2] * scalar
);

const writeAddScaledVec3 = (outputVector, baseVector, vector, scalar) => writeVec3(
  outputVector,
  baseVector[0] + vector[0] * scalar,
  baseVector[1] + vector[1] * scalar,
  baseVector[2] + vector[2] * scalar
);

const writeCrossVec3 = (outputVector, leftVector, rightVector) => writeVec3(
  outputVector,
  leftVector[1] * rightVector[2] - leftVector[2] * rightVector[1],
  leftVector[2] * rightVector[0] - leftVector[0] * rightVector[2],
  leftVector[0] * rightVector[1] - leftVector[1] * rightVector[0]
);

const writeNormalizeVec3 = (outputVector, vector) => {
  const vectorLength = lengthVec3(vector);
  if (vectorLength === 0) {
    return writeVec3(outputVector, 0, 0, 0);
  }
  return writeScaleVec3(outputVector, vector, 1 / vectorLength);
};

const WORLD_UP_VECTOR = createVec3(0, 1, 0);
const ORIGIN_VECTOR = createVec3(0, 0, 0);

const addVec3 = (leftVector, rightVector) => createVec3(
  leftVector[0] + rightVector[0],
  leftVector[1] + rightVector[1],
  leftVector[2] + rightVector[2]
);

const dotVec3 = (leftVector, rightVector) => (
  leftVector[0] * rightVector[0] +
  leftVector[1] * rightVector[1] +
  leftVector[2] * rightVector[2]
);

const squaredLengthVec3 = (vector) => (
  vector[0] * vector[0] +
  vector[1] * vector[1] +
  vector[2] * vector[2]
);

const lengthVec3 = (vector) => Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);

const clampNumber = (value, minValue, maxValue) => Math.max(minValue, Math.min(maxValue, value));

const clampInteger = (value, minValue, maxValue) => Math.trunc(clampNumber(value, minValue, maxValue));

const normalizeBoundedInteger = (value, fallbackValue, minValue, maxValue) => {
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return clampInteger(value, minValue, maxValue);
};

const parseBoundedInteger = (rawValue, fallbackValue, minValue, maxValue) => {
  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) {
    return returnSuccess(fallbackValue);
  }
  return returnSuccess(normalizeBoundedInteger(parsedValue, fallbackValue, minValue, maxValue));
};

const normalizeBoundedNumber = (value, fallbackValue, minValue, maxValue) => {
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return clampNumber(value, minValue, maxValue);
};

const parseBoundedNumber = (rawValue, fallbackValue, minValue, maxValue) => {
  const parsedValue = Number.parseFloat(rawValue);
  if (Number.isNaN(parsedValue)) {
    return returnSuccess(fallbackValue);
  }
  return returnSuccess(normalizeBoundedNumber(parsedValue, fallbackValue, minValue, maxValue));
};

const formatColorAdjustmentValue = (value) => value.toFixed(2);

const formatSignedColorAdjustmentValue = (value) => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
};

const formatLightIntensityValue = (value) => value.toFixed(2);

const formatCameraEffectValue = (value) => value.toFixed(2);

const writeIdentityMat4 = (matrix) => {
  matrix.fill(0);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  return matrix;
};

const createIdentityMat4 = () => writeIdentityMat4(createMat4());

const writeMultiplyMat4 = (outputMatrix, leftMatrix, rightMatrix) => {
  const a00 = leftMatrix[0];
  const a01 = leftMatrix[1];
  const a02 = leftMatrix[2];
  const a03 = leftMatrix[3];
  const a10 = leftMatrix[4];
  const a11 = leftMatrix[5];
  const a12 = leftMatrix[6];
  const a13 = leftMatrix[7];
  const a20 = leftMatrix[8];
  const a21 = leftMatrix[9];
  const a22 = leftMatrix[10];
  const a23 = leftMatrix[11];
  const a30 = leftMatrix[12];
  const a31 = leftMatrix[13];
  const a32 = leftMatrix[14];
  const a33 = leftMatrix[15];

  const b00 = rightMatrix[0];
  const b01 = rightMatrix[1];
  const b02 = rightMatrix[2];
  const b03 = rightMatrix[3];
  const b10 = rightMatrix[4];
  const b11 = rightMatrix[5];
  const b12 = rightMatrix[6];
  const b13 = rightMatrix[7];
  const b20 = rightMatrix[8];
  const b21 = rightMatrix[9];
  const b22 = rightMatrix[10];
  const b23 = rightMatrix[11];
  const b30 = rightMatrix[12];
  const b31 = rightMatrix[13];
  const b32 = rightMatrix[14];
  const b33 = rightMatrix[15];

  outputMatrix[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
  outputMatrix[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
  outputMatrix[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
  outputMatrix[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
  outputMatrix[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
  outputMatrix[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
  outputMatrix[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
  outputMatrix[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
  outputMatrix[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
  outputMatrix[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
  outputMatrix[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
  outputMatrix[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
  outputMatrix[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
  outputMatrix[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
  outputMatrix[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
  outputMatrix[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;

  return outputMatrix;
};

const writeInvertMat4 = (outputMatrix, matrix) => {
  const a00 = matrix[0];
  const a01 = matrix[1];
  const a02 = matrix[2];
  const a03 = matrix[3];
  const a10 = matrix[4];
  const a11 = matrix[5];
  const a12 = matrix[6];
  const a13 = matrix[7];
  const a20 = matrix[8];
  const a21 = matrix[9];
  const a22 = matrix[10];
  const a23 = matrix[11];
  const a30 = matrix[12];
  const a31 = matrix[13];
  const a32 = matrix[14];
  const a33 = matrix[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (determinant === 0) {
    return returnFailure('matrix-not-invertible', 'Camera matrix cannot be inverted.');
  }

  const inverseDeterminant = 1 / determinant;

  outputMatrix[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant;
  outputMatrix[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant;
  outputMatrix[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant;
  outputMatrix[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant;
  outputMatrix[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant;
  outputMatrix[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant;
  outputMatrix[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant;
  outputMatrix[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant;
  outputMatrix[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant;
  outputMatrix[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant;
  outputMatrix[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant;
  outputMatrix[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant;
  outputMatrix[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant;
  outputMatrix[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant;
  outputMatrix[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant;
  outputMatrix[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant;

  return returnSuccess(undefined);
};

const writeEyeRayVector = (outputVector, inverseCameraMatrix, clipX, clipY, eyePosition) => {
  const transformedX = (
    inverseCameraMatrix[0] * clipX +
    inverseCameraMatrix[4] * clipY +
    inverseCameraMatrix[12]
  );
  const transformedY = (
    inverseCameraMatrix[1] * clipX +
    inverseCameraMatrix[5] * clipY +
    inverseCameraMatrix[13]
  );
  const transformedZ = (
    inverseCameraMatrix[2] * clipX +
    inverseCameraMatrix[6] * clipY +
    inverseCameraMatrix[14]
  );
  const transformedW = (
    inverseCameraMatrix[3] * clipX +
    inverseCameraMatrix[7] * clipY +
    inverseCameraMatrix[15]
  );
  const inverseW = 1 / transformedW;
  outputVector[0] = transformedX * inverseW - eyePosition[0];
  outputVector[1] = transformedY * inverseW - eyePosition[1];
  outputVector[2] = transformedZ * inverseW - eyePosition[2];
  return outputVector;
};

const writeCameraRayBasis = (
  centerRay,
  clipXRay,
  clipYRay,
  inverseCameraMatrix,
  eyePosition
) => {
  writeEyeRayVector(centerRay, inverseCameraMatrix, 0, 0, eyePosition);
  writeEyeRayVector(clipXRay, inverseCameraMatrix, 1, 0, eyePosition);
  writeSubtractVec3(clipXRay, clipXRay, centerRay);
  writeEyeRayVector(clipYRay, inverseCameraMatrix, 0, 1, eyePosition);
  writeSubtractVec3(clipYRay, clipYRay, centerRay);
};

const writeLookAtMat4 = (
  outputMatrix,
  eyePosition,
  targetPosition,
  upDirection,
  xAxis,
  yAxis,
  zAxis
) => {
  writeSubtractVec3(zAxis, eyePosition, targetPosition);
  writeNormalizeVec3(zAxis, zAxis);
  writeCrossVec3(xAxis, upDirection, zAxis);
  writeNormalizeVec3(xAxis, xAxis);
  writeCrossVec3(yAxis, zAxis, xAxis);

  if (squaredLengthVec3(xAxis) === 0 || squaredLengthVec3(yAxis) === 0 || squaredLengthVec3(zAxis) === 0) {
    return returnFailure('invalid-camera-basis', 'Camera basis vectors are invalid.');
  }

  outputMatrix[0] = xAxis[0];
  outputMatrix[1] = yAxis[0];
  outputMatrix[2] = zAxis[0];
  outputMatrix[3] = 0;
  outputMatrix[4] = xAxis[1];
  outputMatrix[5] = yAxis[1];
  outputMatrix[6] = zAxis[1];
  outputMatrix[7] = 0;
  outputMatrix[8] = xAxis[2];
  outputMatrix[9] = yAxis[2];
  outputMatrix[10] = zAxis[2];
  outputMatrix[11] = 0;
  outputMatrix[12] = -dotVec3(xAxis, eyePosition);
  outputMatrix[13] = -dotVec3(yAxis, eyePosition);
  outputMatrix[14] = -dotVec3(zAxis, eyePosition);
  outputMatrix[15] = 1;

  return returnSuccess(undefined);
};

const writeCameraProjectionMat4 = (outputMatrix) => {
  outputMatrix[0] = CAMERA_FIELD_SCALE;
  outputMatrix[1] = 0;
  outputMatrix[2] = 0;
  outputMatrix[3] = 0;
  outputMatrix[4] = 0;
  outputMatrix[5] = CAMERA_FIELD_SCALE;
  outputMatrix[6] = 0;
  outputMatrix[7] = 0;
  outputMatrix[8] = 0;
  outputMatrix[9] = 0;
  outputMatrix[10] = (CAMERA_FAR_PLANE + CAMERA_NEAR_PLANE) * CAMERA_NEAR_FAR_RANGE;
  outputMatrix[11] = -1;
  outputMatrix[12] = 0;
  outputMatrix[13] = 0;
  outputMatrix[14] = 2 * CAMERA_FAR_PLANE * CAMERA_NEAR_PLANE * CAMERA_NEAR_FAR_RANGE;
  outputMatrix[15] = 0;
};

const readHaltonBase2 = (sequenceIndex) => {
  let reversedBits = sequenceIndex >>> 0;
  reversedBits = ((reversedBits << 16) | (reversedBits >>> 16)) >>> 0;
  reversedBits = (((reversedBits & 0x00ff00ff) << 8) | ((reversedBits & 0xff00ff00) >>> 8)) >>> 0;
  reversedBits = (((reversedBits & 0x0f0f0f0f) << 4) | ((reversedBits & 0xf0f0f0f0) >>> 4)) >>> 0;
  reversedBits = (((reversedBits & 0x33333333) << 2) | ((reversedBits & 0xcccccccc) >>> 2)) >>> 0;
  reversedBits = (((reversedBits & 0x55555555) << 1) | ((reversedBits & 0xaaaaaaaa) >>> 1)) >>> 0;
  return reversedBits * UINT32_RECIPROCAL;
};

const readHaltonBase3 = (sequenceIndex) => {
  let currentIndex = sequenceIndex;
  let inverseBase = HALTON_BASE_3_RECIPROCAL;
  let haltonValue = 0;

  while (currentIndex > 0) {
    const digit = currentIndex % 3;
    haltonValue += digit * inverseBase;
    currentIndex = (currentIndex / 3) | 0;
    inverseBase *= HALTON_BASE_3_RECIPROCAL;
  }

  return haltonValue;
};

const writeRayJitterUniformValues = (uniformValues, sampleSequence) => {
  const sequenceIndex = sampleSequence + 1;
  uniformValues.rayJitterX = (readHaltonBase2(sequenceIndex) * 2 - 1) * CANVAS_SIZE_RECIPROCAL;
  uniformValues.rayJitterY = (readHaltonBase3(sequenceIndex) * 2 - 1) * CANVAS_SIZE_RECIPROCAL;
};

const joinObjectShaderCode = (sceneObjects, readShaderCode) => {
  const shaderParts = [];
  for (const sceneObject of sceneObjects) {
    shaderParts.push(readShaderCode(sceneObject));
  }
  return shaderParts.join('');
};

const createShadowShaderSource = (sceneObjects, renderSettings) => [
  'float shadow(vec3 origin, vec3 ray) {',
  renderSettings.material === MATERIAL.GLASS
    ? ''
    : joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getShadowTestCode()),
  '  return 1.0;',
  '}'
].join('');

const displayTemporalAntialiasingSource = [
  'vec3 rgbToYCoCg(vec3 color) {',
  '  float chromaOrange = color.r - color.b;',
  '  float temporaryBlue = color.b + chromaOrange * 0.5;',
  '  float chromaGreen = color.g - temporaryBlue;',
  '  float luminance = temporaryBlue + chromaGreen * 0.5;',
  '  return vec3(luminance, chromaOrange, chromaGreen);',
  '}',
  'vec3 ycocgToRgb(vec3 color) {',
  '  float temporaryBlue = color.x - color.z * 0.5;',
  '  float green = color.z + temporaryBlue;',
  '  float blue = temporaryBlue - color.y * 0.5;',
  '  float red = blue + color.y;',
  '  return vec3(red, green, blue);',
  '}',
  'vec3 readCurrentFrameColor(vec2 texCoord) {',
  '  return texture2D(texture, texCoord).rgb;',
  '}',
  'vec3 readDisplayHistoryColor(vec2 texCoord) {',
  '  return texture2D(displayHistoryTexture, texCoord).rgb;',
  '}',
  'float colorMetricYCoCg(vec3 leftYCoCg, vec3 rightYCoCg) {',
  '  float luminanceScale = max(max(leftYCoCg.x, rightYCoCg.x), 0.05);',
  '  vec2 chromaDelta = abs(leftYCoCg.yz - rightYCoCg.yz);',
  '  return abs(leftYCoCg.x - rightYCoCg.x) / luminanceScale + (chromaDelta.x + chromaDelta.y) * 0.25;',
  '}',
  'void includeNeighborhoodSample(vec2 texCoord, float spatialWeight, vec3 centerYCoCg, inout vec3 colorSum, inout float weightSum, inout vec3 minYCoCg, inout vec3 maxYCoCg) {',
  '  vec3 sampleColor = readCurrentFrameColor(texCoord);',
  '  vec3 sampleYCoCg = rgbToYCoCg(sampleColor);',
  '  float sampleDistance = colorMetricYCoCg(centerYCoCg, sampleYCoCg);',
  '  float sampleWeight = spatialWeight / (1.0 + sampleDistance * sampleDistance * 18.0);',
  '  colorSum += sampleColor * sampleWeight;',
  '  weightSum += sampleWeight;',
  '  minYCoCg = min(minYCoCg, sampleYCoCg);',
  '  maxYCoCg = max(maxYCoCg, sampleYCoCg);',
  '}',
  'vec3 resolveTemporalAntialiasing(vec2 texCoord) {',
  '  vec3 currentColor = readCurrentFrameColor(texCoord);',
  '  vec3 currentYCoCg = rgbToYCoCg(currentColor);',
  '  vec3 minYCoCg = currentYCoCg;',
  '  vec3 maxYCoCg = currentYCoCg;',
  '  vec3 colorSum = currentColor;',
  '  float weightSum = 1.0;',
  `  vec2 pixelStep = vec2(1.0 / ${CANVAS_SIZE}.0);`,
  '  includeNeighborhoodSample(texCoord + vec2(-pixelStep.x, 0.0), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(pixelStep.x, 0.0), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(0.0, -pixelStep.y), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(0.0, pixelStep.y), 0.75, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(-pixelStep.x, -pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(pixelStep.x, -pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(-pixelStep.x, pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(pixelStep.x, pixelStep.y), 0.45, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(-2.0 * pixelStep.x, 0.0), 0.22, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(2.0 * pixelStep.x, 0.0), 0.22, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(0.0, -2.0 * pixelStep.y), 0.22, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  includeNeighborhoodSample(texCoord + vec2(0.0, 2.0 * pixelStep.y), 0.22, currentYCoCg, colorSum, weightSum, minYCoCg, maxYCoCg);',
  '  vec3 filteredColor = colorSum / max(weightSum, 0.0001);',
  '  float edgeMetric = colorMetricYCoCg(currentYCoCg, rgbToYCoCg(filteredColor));',
  '  float edgeAmount = smoothstep(0.10, 0.45, edgeMetric);',
  '  float temporalDenoiseAmount = smoothstep(1.0, 32.0, temporalBlendFrames) * denoiserStrength;',
  '  float currentStabilizationAmount = clamp(temporalDenoiseAmount * (0.65 - edgeAmount * 0.45), 0.0, 0.75);',
  '  vec3 stabilizedCurrentColor = mix(currentColor, filteredColor, currentStabilizationAmount);',
  '  vec3 stabilizedCurrentYCoCg = rgbToYCoCg(stabilizedCurrentColor);',
  '  float temporalWindow = clamp((temporalBlendFrames - 1.0) / max(temporalBlendFrames, 1.0), 0.0, 0.96875);',
  '  float motionBlend = clamp(motionBlurStrength, 0.0, 0.95) * historyAvailability;',
  '  if(historyAvailability <= 0.5 || (temporalWindow <= 0.0001 && motionBlend <= 0.0001)) return stabilizedCurrentColor;',
  '  vec3 historyColor = readDisplayHistoryColor(texCoord);',
  '  vec3 historyYCoCg = rgbToYCoCg(historyColor);',
  '  vec3 clipPadding = vec3(0.035, 0.08, 0.08) + vec3(edgeAmount * 0.08);',
  '  vec3 clippedHistoryYCoCg = clamp(historyYCoCg, minYCoCg - clipPadding, maxYCoCg + clipPadding);',
  '  vec3 clippedHistoryColor = ycocgToRgb(clippedHistoryYCoCg);',
  '  float ageRamp = smoothstep(0.0, 1.0, temporalFrameAge);',
  '  float historyDelta = colorMetricYCoCg(clippedHistoryYCoCg, stabilizedCurrentYCoCg);',
  '  float historyRejection = smoothstep(0.12, 0.55, historyDelta);',
  '  float historyWeight = temporalWindow * historyAvailability * ageRamp;',
  '  historyWeight *= mix(1.0, 0.45, edgeAmount);',
  '  historyWeight *= 1.0 - historyRejection * 0.85;',
  '  vec3 antialiasedColor = mix(stabilizedCurrentColor, clippedHistoryColor, historyWeight);',
  '  return mix(antialiasedColor, historyColor, motionBlend);',
  '}'
].join('');

const temporalDisplayFragmentSource = [
  'precision highp float;',
  'varying vec2 texCoord;',
  'uniform sampler2D texture;',
  'uniform sampler2D displayHistoryTexture;',
  'uniform float temporalBlendFrames;',
  'uniform float temporalFrameAge;',
  'uniform float historyAvailability;',
  'uniform float motionBlurStrength;',
  'uniform float denoiserStrength;',
  displayTemporalAntialiasingSource,
  'void main() {',
  '  gl_FragColor = vec4(max(resolveTemporalAntialiasing(texCoord), vec3(0.0)), 1.0);',
  '}'
].join('');

const cameraFocusSource = [
  'vec2 randomApertureDisk(float seed) {',
  '  float angle = 6.283185307179586 * random(vec3(92.271, 41.347, 17.113), seed);',
  '  float radius = sqrt(random(vec3(13.711, 61.173, 83.497), seed + 29.0)) * cameraAperture;',
  '  return vec2(cos(angle), sin(angle)) * radius;',
  '}',
  'void applyCameraFocus(inout vec3 rayOrigin, inout vec3 rayDirection) {',
  '  if(cameraAperture <= 0.00001) return;',
  '  vec3 focusPoint = rayOrigin + normalize(rayDirection) * max(cameraFocusDistance, 0.01);',
  '  vec2 lensOffset = randomApertureDisk(sampleSeed + 211.0);',
  '  rayOrigin += cameraRight * lensOffset.x + cameraUp * lensOffset.y;',
  '  rayDirection = focusPoint - rayOrigin;',
  '}'
].join('');

const createCalculateColorShaderSource = (sceneObjects, renderSettings) => {
  const environmentSource = renderSettings.environment === ENVIRONMENT.RED_GREEN_CORNELL_BOX
    ? redGreenCornellBoxSource
    : yellowBlueCornellBoxSource;
  const isOpenSkyEnvironment = renderSettings.environment === ENVIRONMENT.OPEN_SKY_STUDIO;
  const isFogEnabled = renderSettings.fogDensity > 0.0001;
  const lightBounceCount = normalizeBoundedInteger(
    renderSettings.lightBounceCount,
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  const materialSource = [
    newDiffuseRaySource,
    newReflectiveRaySource,
    newGlossyRaySource,
    newGlassRaySource
  ][renderSettings.material] || newDiffuseRaySource;
  const roomOpenSource = isOpenSkyEnvironment
    ? '      if(roomNormal.y > 0.5) roomDistance = tRoom.y;'
    : '      roomDistance = tRoom.y;';
  const missSource = isOpenSkyEnvironment
    ? '      accumulatedColor += colorMask * sampleEnvironmentSky(ray);'
    : '';
  const fogSource = isFogEnabled
    ? [
      '    if(fogDensity > 0.0001) {',
      `      float fogDistance = t == ${SHADER_INFINITY} ? 6.0 : min(t * length(ray), 6.0);`,
      '      float viewTransmittance = fogTransmittance(fogDistance);',
      '      float fogAmount = 1.0 - viewTransmittance;',
      '      accumulatedColor += colorMask * sampleEnvironmentSky(ray) * fogAmount * 0.35;',
      '      colorMask *= viewTransmittance;',
      '    }'
    ].join('')
    : '';

  return [
    'vec3 calculateColor(vec3 origin, vec3 ray, vec3 light) {',
    '  vec3 colorMask = vec3(1.0);',
    '  vec3 accumulatedColor = vec3(0.0);',
    `  for(int bounce = 0; bounce < ${lightBounceCount}; bounce++) {`,
    '    vec2 tRoom = intersectCube(origin, ray, roomCubeMin, roomCubeMax);',
    `    float roomDistance = ${SHADER_INFINITY};`,
    '    vec3 roomHit = vec3(0.0);',
    '    vec3 roomNormal = vec3(0.0);',
    '    if(tRoom.x < tRoom.y) {',
    '      roomHit = origin + ray * tRoom.y;',
    '      roomNormal = -normalForCube(roomHit, roomCubeMin, roomCubeMax);',
    roomOpenSource,
    '    }',
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getIntersectCode()),
    '    float t = roomDistance;',
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getMinimumIntersectCode()),
    fogSource,
    '    vec3 hit = origin + ray * t;',
    '    vec3 surfaceColor = vec3(0.75);',
    '    float specularHighlight = 0.0;',
    '    float surfaceLightResponse = 1.0;',
    '    vec3 normal;',
    `    if(roomDistance < ${SHADER_INFINITY} && t == roomDistance) {`,
    '      hit = roomHit;',
    '      normal = roomNormal;',
    environmentSource,
    materialSource === newDiffuseRaySource ? newDiffuseRaySource : newDiffuseRaySource,
    `    } else if(t == ${SHADER_INFINITY}) {`,
    missSource,
    '      break;',
    '    } else {',
    '      if(false) ;',
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getNormalCalculationCode()),
    materialSource,
    '    }',
    '    vec3 toLight = light - hit;',
    '    float diffuse = max(0.0, dot(normalize(toLight), normal));',
    `    float shadowIntensity = shadow(hit + normal * ${SHADER_EPSILON}, toLight);`,
    '    colorMask *= surfaceColor;',
    '    accumulatedColor += colorMask * (lightIntensity * diffuse * shadowIntensity * surfaceLightResponse);',
    '    accumulatedColor += colorMask * lightIntensity * specularHighlight * shadowIntensity * surfaceLightResponse;',
    `    origin = hit + normalize(ray) * ${SHADER_EPSILON};`,
    '  }',
    '  return accumulatedColor;',
    '}'
  ].join('');
};

const createMainShaderSource = () => [
  'void main() {',
  '  vec3 newLight = light + uniformlyRandomVector(sampleSeed - 53.0) * lightSize;',
  `  vec3 texture = texture2D(texture, gl_FragCoord.xy / ${CANVAS_SIZE}.0).rgb;`,
  '  vec3 rayOrigin = eye;',
  '  vec3 rayDirection = initialRay;',
  '  applyCameraFocus(rayOrigin, rayDirection);',
  '  gl_FragColor = vec4(mix(calculateColor(rayOrigin, rayDirection, newLight), texture, textureWeight), 1.0);',
  '}'
].join('');

const createTracerFragmentSource = (sceneObjects, renderSettings) => {
  const shouldUseSkyShader = (
    renderSettings.environment === ENVIRONMENT.OPEN_SKY_STUDIO ||
    renderSettings.fogDensity > 0.0001
  );

  return [
    tracerFragmentSourceHeader,
    joinObjectShaderCode(sceneObjects, (sceneObject) => sceneObject.getGlobalCode()),
    intersectCubeSource,
    intersectCubeDistanceSource,
    normalForCubeSource,
    intersectSphereSource,
    normalForSphereSource,
    randomSource,
    cosineWeightedDirectionSource,
    uniformlyRandomDirectionSource,
    uniformlyRandomVectorSource,
    createShadowShaderSource(sceneObjects, renderSettings),
    cameraFocusSource,
    shouldUseSkyShader ? skyShaderSource : '',
    createCalculateColorShaderSource(sceneObjects, renderSettings),
    createMainShaderSource()
  ].join('');
};

const compileShaderSource = (webGlContext, source, shaderType, label) => {
  const shader = webGlContext.createShader(shaderType);
  if (!shader) {
    return returnFailure('shader-create-failed', `${label} shader could not be created.`);
  }

  webGlContext.shaderSource(shader, source);
  webGlContext.compileShader(shader);

  if (!webGlContext.getShaderParameter(shader, webGlContext.COMPILE_STATUS)) {
    const shaderInfo = webGlContext.getShaderInfoLog(shader) || 'No shader log was provided.';
    webGlContext.deleteShader(shader);
    return returnFailure('shader-compile-failed', `${label} shader failed to compile.`, shaderInfo);
  }

  return returnSuccess(shader);
};

const createLinkedProgram = (webGlContext, vertexSource, fragmentSource, label) => {
  const [vertexShader, vertexShaderError] = compileShaderSource(webGlContext, vertexSource, webGlContext.VERTEX_SHADER, `${label} vertex`);
  if (vertexShaderError) {
    return returnFailure(vertexShaderError.code, vertexShaderError.message, vertexShaderError.details);
  }

  const [fragmentShader, fragmentShaderError] = compileShaderSource(webGlContext, fragmentSource, webGlContext.FRAGMENT_SHADER, `${label} fragment`);
  if (fragmentShaderError) {
    webGlContext.deleteShader(vertexShader);
    return returnFailure(fragmentShaderError.code, fragmentShaderError.message, fragmentShaderError.details);
  }

  const program = webGlContext.createProgram();
  if (!program) {
    webGlContext.deleteShader(vertexShader);
    webGlContext.deleteShader(fragmentShader);
    return returnFailure('program-create-failed', `${label} program could not be created.`);
  }

  webGlContext.attachShader(program, vertexShader);
  webGlContext.attachShader(program, fragmentShader);
  webGlContext.linkProgram(program);
  webGlContext.deleteShader(vertexShader);
  webGlContext.deleteShader(fragmentShader);

  if (!webGlContext.getProgramParameter(program, webGlContext.LINK_STATUS)) {
    const programInfo = webGlContext.getProgramInfoLog(program) || 'No program log was provided.';
    webGlContext.deleteProgram(program);
    return returnFailure('program-link-failed', `${label} program failed to link.`, programInfo);
  }

  return returnSuccess(program);
};

const createBufferWithData = (webGlContext, target, typedArray, usage, label) => {
  const buffer = webGlContext.createBuffer();
  if (!buffer) {
    return returnFailure('buffer-create-failed', `${label} buffer could not be created.`);
  }

  webGlContext.bindBuffer(target, buffer);
  webGlContext.bufferData(target, typedArray, usage);

  return returnSuccess(buffer);
};

const createRenderTexture = (webGlContext, textureType) => {
  const texture = webGlContext.createTexture();
  if (!texture) {
    return returnFailure('texture-create-failed', 'Render texture could not be created.');
  }

  webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MAG_FILTER, webGlContext.NEAREST);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MIN_FILTER, webGlContext.NEAREST);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_S, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_T, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texImage2D(
    webGlContext.TEXTURE_2D,
    0,
    webGlContext.RGBA,
    CANVAS_SIZE,
    CANVAS_SIZE,
    0,
    webGlContext.RGBA,
    textureType,
    null
  );

  return returnSuccess(texture);
};

const createFramebufferForTexture = (webGlContext, texture, label) => {
  const framebuffer = webGlContext.createFramebuffer();
  if (!framebuffer) {
    return returnFailure('framebuffer-create-failed', `${label} framebuffer could not be created.`);
  }

  webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, framebuffer);
  webGlContext.framebufferTexture2D(
    webGlContext.FRAMEBUFFER,
    webGlContext.COLOR_ATTACHMENT0,
    webGlContext.TEXTURE_2D,
    texture,
    0
  );

  return returnSuccess(framebuffer);
};

const createProceduralSkyTexture = (webGlContext) => {
  const texture = webGlContext.createTexture();
  if (!texture) {
    return returnFailure('texture-create-failed', 'Sky texture could not be created.');
  }

  const skyPixels = new Uint8Array(SKY_TEXTURE_WIDTH * SKY_TEXTURE_HEIGHT * BYTES_PER_RGBA_PIXEL);
  for (let y = 0; y < SKY_TEXTURE_HEIGHT; y += 1) {
    const verticalPercent = y / (SKY_TEXTURE_HEIGHT - 1);
    const skyBlend = Math.max(0, 1 - verticalPercent * 1.35);
    const horizonBlend = 1 - Math.abs(verticalPercent - 0.55) * 1.7;
    for (let x = 0; x < SKY_TEXTURE_WIDTH; x += 1) {
      const horizontalPercent = x / (SKY_TEXTURE_WIDTH - 1);
      const sunDistance = Math.hypot(horizontalPercent - 0.66, verticalPercent - 0.32);
      const sunGlow = Math.max(0, 1 - sunDistance * 9);
      const pixelOffset = (y * SKY_TEXTURE_WIDTH + x) * BYTES_PER_RGBA_PIXEL;
      const red = 32 + skyBlend * 40 + horizonBlend * 85 + sunGlow * 170;
      const green = 48 + skyBlend * 82 + horizonBlend * 76 + sunGlow * 150;
      const blue = 72 + skyBlend * 150 + horizonBlend * 58 + sunGlow * 92;
      skyPixels[pixelOffset] = clampInteger(red, 0, 255);
      skyPixels[pixelOffset + 1] = clampInteger(green, 0, 255);
      skyPixels[pixelOffset + 2] = clampInteger(blue, 0, 255);
      skyPixels[pixelOffset + 3] = 255;
    }
  }

  webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MAG_FILTER, webGlContext.LINEAR);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_MIN_FILTER, webGlContext.LINEAR);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_S, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texParameteri(webGlContext.TEXTURE_2D, webGlContext.TEXTURE_WRAP_T, webGlContext.CLAMP_TO_EDGE);
  webGlContext.texImage2D(
    webGlContext.TEXTURE_2D,
    0,
    webGlContext.RGBA,
    SKY_TEXTURE_WIDTH,
    SKY_TEXTURE_HEIGHT,
    0,
    webGlContext.RGBA,
    webGlContext.UNSIGNED_BYTE,
    skyPixels
  );

  return returnSuccess(texture);
};

const createUniformLocationCache = () => new Map();

const readUniformLocation = (webGlContext, program, uniformLocationCache, uniformName) => {
  if (uniformLocationCache.has(uniformName)) {
    return uniformLocationCache.get(uniformName);
  }

  const uniformLocation = webGlContext.getUniformLocation(program, uniformName);
  uniformLocationCache.set(uniformName, uniformLocation);
  return uniformLocation;
};

const setSamplerUniform = (webGlContext, program, uniformLocationCache, uniformName, textureUnitIndex) => {
  const uniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, uniformName);
  if (uniformLocation === null) {
    return returnSuccess(undefined);
  }

  webGlContext.uniform1i(uniformLocation, textureUnitIndex);
  return returnSuccess(undefined);
};

const cacheNamedUniformLocations = (webGlContext, program, uniformLocationCache, targetLocations, uniformNames) => {
  for (const uniformName of uniformNames) {
    targetLocations[uniformName] = readUniformLocation(webGlContext, program, uniformLocationCache, uniformName);
  }

  return returnSuccess(undefined);
};

const setChangedCachedScalarUniformValues = (
  webGlContext,
  uniformLocations,
  uniformValues,
  previousUniformValues,
  uniformNames
) => {
  for (const uniformName of uniformNames) {
    const uniformValue = uniformValues[uniformName];
    if (previousUniformValues[uniformName] === uniformValue) {
      continue;
    }

    previousUniformValues[uniformName] = uniformValue;
    const uniformLocation = uniformLocations[uniformName];
    if (uniformLocation !== null && uniformLocation !== undefined) {
      webGlContext.uniform1f(uniformLocation, uniformValue);
    }
  }
};

const setChangedCachedVec3UniformValue = (webGlContext, uniformLocation, uniformValue, previousUniformValue) => {
  if (uniformLocation === null) {
    return;
  }

  if (
    previousUniformValue[0] === uniformValue[0] &&
    previousUniformValue[1] === uniformValue[1] &&
    previousUniformValue[2] === uniformValue[2]
  ) {
    return;
  }

  writeVec3(previousUniformValue, uniformValue[0], uniformValue[1], uniformValue[2]);
  webGlContext.uniform3f(uniformLocation, uniformValue[0], uniformValue[1], uniformValue[2]);
};

const writeInvalidMat4 = (matrix) => {
  for (let matrixIndex = 0; matrixIndex < FLOATS_PER_MAT4; matrixIndex += 1) {
    matrix[matrixIndex] = Number.NaN;
  }
  return matrix;
};

const createInvalidMat4 = () => writeInvalidMat4(createMat4());

const setChangedCachedMat4UniformValue = (webGlContext, uniformLocation, matrixValue, previousMatrixValue) => {
  if (uniformLocation === null) {
    return;
  }

  let didChange = false;
  for (let matrixIndex = 0; matrixIndex < FLOATS_PER_MAT4; matrixIndex += 1) {
    const nextValue = matrixValue[matrixIndex];
    if (previousMatrixValue[matrixIndex] !== nextValue) {
      didChange = true;
    }
    previousMatrixValue[matrixIndex] = nextValue;
  }

  if (didChange) {
    webGlContext.uniformMatrix4fv(uniformLocation, false, matrixValue);
  }
};

class SphereSceneObject {
  constructor(centerPosition, radius, objectId) {
    this.centerPosition = cloneVec3(centerPosition);
    this.radius = radius;
    this.centerUniformName = `sphereCenter${objectId}`;
    this.radiusUniformName = `sphereRadius${objectId}`;
    this.intersectionName = `tSphere${objectId}`;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformCenterPosition = createVec3(0, 0, 0);
    this.previousUniformCenterPosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.translatedCenterPosition = createVec3(0, 0, 0);
    this.radiusVector = createVec3(radius, radius, radius);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.physicsRigidBody = null;
    this.centerUniformLocation = null;
    this.radiusUniformLocation = null;
    this.previousUniformRadius = Number.NaN;
    this.isUniformCenterDirty = true;
    this.isUniformRadiusDirty = true;
  }

  getGlobalCode() {
    return `uniform vec3 ${this.centerUniformName};uniform float ${this.radiusUniformName};`;
  }

  getIntersectCode() {
    return `float ${this.intersectionName} = intersectSphere(origin, ray, ${this.centerUniformName}, ${this.radiusUniformName});`;
  }

  getShadowTestCode() {
    return `${this.getIntersectCode()}if(${this.intersectionName} < 1.0) return 0.0;`;
  }

  getMinimumIntersectCode() {
    return `if(${this.intersectionName} < t) t = ${this.intersectionName};`;
  }

  getNormalCalculationCode() {
    return `else if(t == ${this.intersectionName}) normal = normalForSphere(hit, ${this.centerUniformName}, ${this.radiusUniformName});`;
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.centerUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.centerUniformName);
    this.radiusUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.radiusUniformName);
    writeVec3(this.previousUniformCenterPosition, Number.NaN, Number.NaN, Number.NaN);
    this.previousUniformRadius = Number.NaN;
    this.isUniformCenterDirty = true;
    this.isUniformRadiusDirty = true;
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (this.centerUniformLocation !== null && this.isUniformCenterDirty) {
      writeAddVec3(this.uniformCenterPosition, this.centerPosition, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.centerUniformLocation,
        this.uniformCenterPosition,
        this.previousUniformCenterPosition
      );
      this.isUniformCenterDirty = false;
    }
    if (this.radiusUniformLocation !== null && this.isUniformRadiusDirty) {
      this.previousUniformRadius = this.radius;
      webGlContext.uniform1f(this.radiusUniformLocation, this.radius);
      this.isUniformRadiusDirty = false;
    }
  }

  setTemporaryTranslation(translationVector) {
    writeVec3(this.temporaryTranslation, translationVector[0], translationVector[1], translationVector[2]);
    this.isUniformCenterDirty = true;
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.centerPosition, this.centerPosition, translationVector);
    this.isUniformCenterDirty = true;
    return returnSuccess(undefined);
  }

  setCenterPosition(centerPosition) {
    writeVec3(this.centerPosition, centerPosition[0], centerPosition[1], centerPosition[2]);
    this.isUniformCenterDirty = true;
    return returnSuccess(undefined);
  }

  setCenterPositionComponents(xPosition, yPosition, zPosition) {
    writeVec3(this.centerPosition, xPosition, yPosition, zPosition);
    this.isUniformCenterDirty = true;
    return returnSuccess(undefined);
  }

  attachPhysicsRigidBody(rigidBody) {
    if (!rigidBody || typeof rigidBody.translation !== 'function') {
      return returnFailure('invalid-sphere-physics-body', 'Sphere physics body is invalid.');
    }

    this.physicsRigidBody = rigidBody;
    return returnSuccess(undefined);
  }

  clearPhysicsRigidBody() {
    this.physicsRigidBody = null;
    return returnSuccess(undefined);
  }

  getTranslatedCenter() {
    return writeAddVec3(this.translatedCenterPosition, this.centerPosition, this.temporaryTranslation);
  }

  getMinCorner() {
    return writeSubtractVec3(this.boundsMinCorner, this.getTranslatedCenter(), this.radiusVector);
  }

  getMaxCorner() {
    return writeAddVec3(this.boundsMaxCorner, this.getTranslatedCenter(), this.radiusVector);
  }

  intersectRay(originPosition, rayDirection) {
    const intersectionDistance = intersectSphere(originPosition, rayDirection, this.getTranslatedCenter(), this.radius);
    return returnSuccess(intersectionDistance);
  }
}

class CubeSceneObject {
  constructor(minCorner, maxCorner, objectId) {
    this.minCorner = cloneVec3(minCorner);
    this.maxCorner = cloneVec3(maxCorner);
    this.minUniformName = `cubeMin${objectId}`;
    this.maxUniformName = `cubeMax${objectId}`;
    this.intersectionName = `tCube${objectId}`;
    this.intersectionDistanceName = `dCube${objectId}`;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformMinCorner = createVec3(0, 0, 0);
    this.uniformMaxCorner = createVec3(0, 0, 0);
    this.previousUniformMinCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousUniformMaxCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.centerPosition = createVec3(0, 0, 0);
    this.halfExtents = createVec3(0, 0, 0);
    this.minUniformLocation = null;
    this.maxUniformLocation = null;
    this.areUniformBoundsDirty = true;
  }

  getGlobalCode() {
    return `uniform vec3 ${this.minUniformName};uniform vec3 ${this.maxUniformName};`;
  }

  getIntersectCode() {
    return `vec2 ${this.intersectionName} = intersectCube(origin, ray, ${this.minUniformName}, ${this.maxUniformName});`;
  }

  getShadowTestCode() {
    return [
      this.getIntersectCode(),
      `float ${this.intersectionDistanceName} = intersectCubeDistance(${this.intersectionName});`,
      `if(${this.intersectionDistanceName} < 1.0) return 0.0;`
    ].join('');
  }

  getMinimumIntersectCode() {
    return `float ${this.intersectionDistanceName} = intersectCubeDistance(${this.intersectionName});if(${this.intersectionDistanceName} < t) t = ${this.intersectionDistanceName};`;
  }

  getNormalCalculationCode() {
    return `else if(t == ${this.intersectionDistanceName}) normal = normalForCube(hit, ${this.minUniformName}, ${this.maxUniformName});`;
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.minUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.minUniformName);
    this.maxUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, this.maxUniformName);
    writeVec3(this.previousUniformMinCorner, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousUniformMaxCorner, Number.NaN, Number.NaN, Number.NaN);
    this.areUniformBoundsDirty = true;
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (!this.areUniformBoundsDirty) {
      return;
    }

    if (this.minUniformLocation !== null) {
      writeAddVec3(this.uniformMinCorner, this.minCorner, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.minUniformLocation,
        this.uniformMinCorner,
        this.previousUniformMinCorner
      );
    }
    if (this.maxUniformLocation !== null) {
      writeAddVec3(this.uniformMaxCorner, this.maxCorner, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.maxUniformLocation,
        this.uniformMaxCorner,
        this.previousUniformMaxCorner
      );
    }
    this.areUniformBoundsDirty = false;
  }

  setTemporaryTranslation(translationVector) {
    writeVec3(this.temporaryTranslation, translationVector[0], translationVector[1], translationVector[2]);
    this.areUniformBoundsDirty = true;
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.minCorner, this.minCorner, translationVector);
    writeAddVec3(this.maxCorner, this.maxCorner, translationVector);
    this.areUniformBoundsDirty = true;
    return returnSuccess(undefined);
  }

  getMinCorner() {
    return writeAddVec3(this.boundsMinCorner, this.minCorner, this.temporaryTranslation);
  }

  getMaxCorner() {
    return writeAddVec3(this.boundsMaxCorner, this.maxCorner, this.temporaryTranslation);
  }

  getCenterPosition() {
    const minCorner = this.getMinCorner();
    const maxCorner = this.getMaxCorner();
    return writeVec3(
      this.centerPosition,
      (minCorner[0] + maxCorner[0]) * 0.5,
      (minCorner[1] + maxCorner[1]) * 0.5,
      (minCorner[2] + maxCorner[2]) * 0.5
    );
  }

  getHalfExtents() {
    const minCorner = this.getMinCorner();
    const maxCorner = this.getMaxCorner();
    return writeVec3(
      this.halfExtents,
      (maxCorner[0] - minCorner[0]) * 0.5,
      (maxCorner[1] - minCorner[1]) * 0.5,
      (maxCorner[2] - minCorner[2]) * 0.5
    );
  }

  intersectRay(originPosition, rayDirection) {
    const intersectionDistance = intersectCube(originPosition, rayDirection, this.getMinCorner(), this.getMaxCorner());
    return returnSuccess(intersectionDistance);
  }
}

class LightSceneObject {
  constructor(applicationState) {
    this.applicationState = applicationState;
    this.temporaryTranslation = createVec3(0, 0, 0);
    this.uniformLightPosition = createVec3(0, 0, 0);
    this.previousUniformLightPosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.temporaryLightPosition = createVec3(0, 0, 0);
    this.clampedLightPosition = createVec3(0, 0, 0);
    this.translatedLightPosition = createVec3(0, 0, 0);
    this.selectionHalfExtentVector = createVec3(0, 0, 0);
    this.boundsMinCorner = createVec3(0, 0, 0);
    this.boundsMaxCorner = createVec3(0, 0, 0);
    this.lightUniformLocation = null;
  }

  getGlobalCode() {
    return 'uniform vec3 light;';
  }

  getIntersectCode() {
    return '';
  }

  getShadowTestCode() {
    return '';
  }

  getMinimumIntersectCode() {
    return '';
  }

  getNormalCalculationCode() {
    return '';
  }

  cacheUniformLocations(webGlContext, program, uniformLocationCache) {
    this.lightUniformLocation = readUniformLocation(webGlContext, program, uniformLocationCache, 'light');
    writeVec3(this.previousUniformLightPosition, Number.NaN, Number.NaN, Number.NaN);
    return returnSuccess(undefined);
  }

  setUniforms(webGlContext) {
    if (this.lightUniformLocation !== null) {
      writeAddVec3(this.uniformLightPosition, this.applicationState.lightPosition, this.temporaryTranslation);
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.lightUniformLocation,
        this.uniformLightPosition,
        this.previousUniformLightPosition
      );
    }
  }

  setTemporaryTranslation(translationVector) {
    writeAddVec3(this.temporaryLightPosition, this.applicationState.lightPosition, translationVector);
    writeClampLightPosition(this.clampedLightPosition, this.temporaryLightPosition, this.applicationState.lightSize);
    writeSubtractVec3(this.temporaryTranslation, this.clampedLightPosition, this.applicationState.lightPosition);
    return returnSuccess(undefined);
  }

  commitTranslation(translationVector) {
    writeAddVec3(this.temporaryLightPosition, this.applicationState.lightPosition, translationVector);
    writeClampLightPosition(this.applicationState.lightPosition, this.temporaryLightPosition, this.applicationState.lightSize);
    return returnSuccess(undefined);
  }

  getMinCorner() {
    const selectionHalfExtent = Math.max(this.applicationState.lightSize, MIN_LIGHT_SIZE);
    writeVec3(this.selectionHalfExtentVector, selectionHalfExtent, selectionHalfExtent, selectionHalfExtent);
    writeAddVec3(this.translatedLightPosition, this.applicationState.lightPosition, this.temporaryTranslation);
    return writeSubtractVec3(this.boundsMinCorner, this.translatedLightPosition, this.selectionHalfExtentVector);
  }

  getMaxCorner() {
    const selectionHalfExtent = Math.max(this.applicationState.lightSize, MIN_LIGHT_SIZE);
    writeVec3(this.selectionHalfExtentVector, selectionHalfExtent, selectionHalfExtent, selectionHalfExtent);
    writeAddVec3(this.translatedLightPosition, this.applicationState.lightPosition, this.temporaryTranslation);
    return writeAddVec3(this.boundsMaxCorner, this.translatedLightPosition, this.selectionHalfExtentVector);
  }

  intersectRay() {
    return returnSuccess(MAX_INTERSECTION_DISTANCE);
  }
}

const writeClampLightPosition = (outputVector, lightPosition, lightSize) => writeVec3(
  outputVector,
  clampNumber(lightPosition[0], lightSize - 1, 1 - lightSize),
  clampNumber(lightPosition[1], lightSize - 1, 1 - lightSize),
  clampNumber(lightPosition[2], lightSize - 1, 1 - lightSize)
);

const clampLightPosition = (lightPosition, lightSize) => writeClampLightPosition(createVec3(0, 0, 0), lightPosition, lightSize);

const intersectSphere = (originPosition, rayDirection, centerPosition, radius) => {
  const toSphereX = originPosition[0] - centerPosition[0];
  const toSphereY = originPosition[1] - centerPosition[1];
  const toSphereZ = originPosition[2] - centerPosition[2];
  const a = dotVec3(rayDirection, rayDirection);
  const b = 2 * (
    toSphereX * rayDirection[0] +
    toSphereY * rayDirection[1] +
    toSphereZ * rayDirection[2]
  );
  const c = toSphereX * toSphereX + toSphereY * toSphereY + toSphereZ * toSphereZ - radius * radius;
  const discriminant = b * b - 4 * a * c;

  if (discriminant > 0) {
    const intersectionDistance = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (intersectionDistance > 0) {
      return intersectionDistance;
    }
  }

  return MAX_INTERSECTION_DISTANCE;
};

const intersectCube = (originPosition, rayDirection, cubeMinCorner, cubeMaxCorner) => {
  const nearX = (cubeMinCorner[0] - originPosition[0]) / rayDirection[0];
  const nearY = (cubeMinCorner[1] - originPosition[1]) / rayDirection[1];
  const nearZ = (cubeMinCorner[2] - originPosition[2]) / rayDirection[2];
  const farX = (cubeMaxCorner[0] - originPosition[0]) / rayDirection[0];
  const farY = (cubeMaxCorner[1] - originPosition[1]) / rayDirection[1];
  const farZ = (cubeMaxCorner[2] - originPosition[2]) / rayDirection[2];
  const tNear = Math.max(
    Math.min(nearX, farX),
    Math.min(nearY, farY),
    Math.min(nearZ, farZ)
  );
  const tFar = Math.min(
    Math.max(nearX, farX),
    Math.max(nearY, farY),
    Math.max(nearZ, farZ)
  );

  if (tNear > 0 && tNear < tFar) {
    return tNear;
  }

  return MAX_INTERSECTION_DISTANCE;
};

const validateRapierRuntime = (rapierRuntime) => {
  const requiredRuntimeKeys = ['World', 'RigidBodyDesc', 'ColliderDesc'];
  for (const runtimeKey of requiredRuntimeKeys) {
    if (!rapierRuntime || !rapierRuntime[runtimeKey]) {
      return returnFailure('rapier-api-missing', `Rapier runtime is missing "${runtimeKey}".`);
    }
  }
  return returnSuccess(undefined);
};

const createRapierWorld = (rapierRuntime) => {
  const world = new rapierRuntime.World({ x: 0, y: PHYSICS_GRAVITY_Y, z: 0 });
  world.timestep = PHYSICS_FIXED_TIMESTEP_SECONDS;
  return world;
};

const createRapierPhysicsWorld = (rapierRuntime) => {
  const [, runtimeError] = validateRapierRuntime(rapierRuntime);
  if (runtimeError) {
    return returnFailure(runtimeError.code, runtimeError.message, runtimeError.details);
  }

  return returnSuccess(new RapierPhysicsWorld(rapierRuntime, createRapierWorld(rapierRuntime)));
};

const createRapierCuboidCollider = (rapierRuntime, centerPosition, halfExtents, friction, restitution) => (
  rapierRuntime.ColliderDesc
    .cuboid(halfExtents[0], halfExtents[1], halfExtents[2])
    .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2])
    .setFriction(friction)
    .setRestitution(restitution)
);

class RapierPhysicsWorld {
  constructor(rapierRuntime, world) {
    this.rapierRuntime = rapierRuntime;
    this.world = world;
    this.dynamicSphereBodies = new Map();
    this.dynamicSphereObjects = [];
    this.dynamicSphereRigidBodies = [];
    this.physicsAccumulatorSeconds = 0;
  }

  rebuildScene(sceneObjects, applicationState) {
    this.world = createRapierWorld(this.rapierRuntime);
    this.dynamicSphereBodies = new Map();
    this.dynamicSphereObjects = [];
    this.dynamicSphereRigidBodies = [];
    this.physicsAccumulatorSeconds = 0;

    const [, clearError] = this.clearSpherePhysicsBodies(sceneObjects);
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }

    const [, roomError] = this.addRoomBoundaryColliders(applicationState);
    if (roomError) {
      return returnFailure(roomError.code, roomError.message, roomError.details);
    }

    for (const sceneObject of sceneObjects) {
      if (sceneObject instanceof SphereSceneObject) {
        const [, sphereError] = this.addDynamicSphere(sceneObject);
        if (sphereError) {
          return returnFailure(sphereError.code, sphereError.message, sphereError.details);
        }
      } else if (sceneObject instanceof CubeSceneObject) {
        const [, cubeError] = this.addFixedCube(sceneObject);
        if (cubeError) {
          return returnFailure(cubeError.code, cubeError.message, cubeError.details);
        }
      }
    }

    const [, validationError] = this.validateAllSpheresHavePhysicsBodies(sceneObjects);
    if (validationError) {
      return returnFailure(validationError.code, validationError.message, validationError.details);
    }

    return returnSuccess(undefined);
  }

  clearSpherePhysicsBodies(sceneObjects) {
    for (const sceneObject of sceneObjects) {
      if (!(sceneObject instanceof SphereSceneObject)) {
        continue;
      }

      const [, clearError] = sceneObject.clearPhysicsRigidBody();
      if (clearError) {
        return returnFailure(clearError.code, clearError.message, clearError.details);
      }
    }

    return returnSuccess(undefined);
  }

  validateAllSpheresHavePhysicsBodies(sceneObjects) {
    for (const sceneObject of sceneObjects) {
      if (!(sceneObject instanceof SphereSceneObject)) {
        continue;
      }

      if (!sceneObject.physicsRigidBody) {
        return returnFailure('sphere-missing-rapier-body', 'A sphere was not attached to a Rapier rigid body.');
      }

      if (this.dynamicSphereBodies.get(sceneObject) !== sceneObject.physicsRigidBody) {
        return returnFailure('sphere-physics-body-mismatch', 'A sphere has a Rapier body that is not registered with the physics world.');
      }
    }

    return returnSuccess(undefined);
  }

  addRoomBoundaryColliders(applicationState) {
    const wallThickness = PHYSICS_ROOM_WALL_THICKNESS;
    const wallOffset = 1 + wallThickness;
    this.addRoomBoundaryCollider(0, -wallOffset, 0, 1, wallThickness, 1);

    if (applicationState.environment !== ENVIRONMENT.OPEN_SKY_STUDIO) {
      this.addRoomBoundaryCollider(0, wallOffset, 0, 1, wallThickness, 1);
      this.addRoomBoundaryCollider(-wallOffset, 0, 0, wallThickness, 1, 1);
      this.addRoomBoundaryCollider(wallOffset, 0, 0, wallThickness, 1, 1);
      this.addRoomBoundaryCollider(0, 0, -wallOffset, 1, 1, wallThickness);
      this.addRoomBoundaryCollider(0, 0, wallOffset, 1, 1, wallThickness);
    }

    return returnSuccess(undefined);
  }

  addRoomBoundaryCollider(centerX, centerY, centerZ, halfExtentX, halfExtentY, halfExtentZ) {
    const colliderDescription = this.rapierRuntime.ColliderDesc
      .cuboid(halfExtentX, halfExtentY, halfExtentZ)
      .setTranslation(centerX, centerY, centerZ)
      .setFriction(PHYSICS_CUBE_FRICTION)
      .setRestitution(PHYSICS_CUBE_RESTITUTION);
    this.world.createCollider(colliderDescription);
  }

  addFixedCube(cubeObject) {
    const colliderDescription = createRapierCuboidCollider(
      this.rapierRuntime,
      cubeObject.getCenterPosition(),
      cubeObject.getHalfExtents(),
      PHYSICS_CUBE_FRICTION,
      PHYSICS_CUBE_RESTITUTION
    );
    this.world.createCollider(colliderDescription);
    return returnSuccess(undefined);
  }

  addDynamicSphere(sphereObject) {
    const centerPosition = sphereObject.getTranslatedCenter();
    const bodyDescription = this.rapierRuntime.RigidBodyDesc
      .dynamic()
      .setTranslation(centerPosition[0], centerPosition[1], centerPosition[2])
      .setCanSleep(true);

    const rigidBody = this.world.createRigidBody(bodyDescription);
    const colliderDescription = this.rapierRuntime.ColliderDesc
      .ball(sphereObject.radius)
      .setFriction(PHYSICS_SPHERE_FRICTION)
      .setRestitution(PHYSICS_SPHERE_RESTITUTION);

    this.world.createCollider(colliderDescription, rigidBody);
    const [, attachError] = sphereObject.attachPhysicsRigidBody(rigidBody);
    if (attachError) {
      return returnFailure(attachError.code, attachError.message, attachError.details);
    }

    this.dynamicSphereBodies.set(sphereObject, rigidBody);
    this.dynamicSphereObjects.push(sphereObject);
    this.dynamicSphereRigidBodies.push(rigidBody);
    return returnSuccess(undefined);
  }

  step(elapsedSeconds, shouldStepPhysics) {
    if (!shouldStepPhysics || this.dynamicSphereObjects.length === 0) {
      return returnSuccess(false);
    }

    if (!this.hasAwakeDynamicSpheres()) {
      this.physicsAccumulatorSeconds = 0;
      return returnSuccess(false);
    }

    this.physicsAccumulatorSeconds += Math.min(elapsedSeconds, PHYSICS_MAX_FRAME_SECONDS);
    let didStepWorld = false;

    while (this.physicsAccumulatorSeconds >= PHYSICS_FIXED_TIMESTEP_SECONDS) {
      this.world.step();
      this.physicsAccumulatorSeconds -= PHYSICS_FIXED_TIMESTEP_SECONDS;
      didStepWorld = true;
    }

    if (!didStepWorld) {
      return returnSuccess(false);
    }

    return this.syncSphereObjectsFromBodies();
  }

  hasAwakeDynamicSpheres() {
    const rigidBodies = this.dynamicSphereRigidBodies;
    for (let bodyIndex = 0; bodyIndex < rigidBodies.length; bodyIndex += 1) {
      const rigidBody = rigidBodies[bodyIndex];
      if (typeof rigidBody.isSleeping !== 'function' || !rigidBody.isSleeping()) {
        return true;
      }
    }

    return false;
  }

  syncSphereObjectsFromBodies() {
    let didMoveAnySphere = false;
    const sphereObjects = this.dynamicSphereObjects;
    const rigidBodies = this.dynamicSphereRigidBodies;

    for (let bodyIndex = 0; bodyIndex < sphereObjects.length; bodyIndex += 1) {
      const sphereObject = sphereObjects[bodyIndex];
      const rigidBody = rigidBodies[bodyIndex];
      const bodyPosition = rigidBody.translation();
      const currentCenterPosition = sphereObject.centerPosition;
      const deltaX = Math.abs(bodyPosition.x - currentCenterPosition[0]);
      const deltaY = Math.abs(bodyPosition.y - currentCenterPosition[1]);
      const deltaZ = Math.abs(bodyPosition.z - currentCenterPosition[2]);

      if (
        deltaX > PHYSICS_POSITION_EPSILON ||
        deltaY > PHYSICS_POSITION_EPSILON ||
        deltaZ > PHYSICS_POSITION_EPSILON
      ) {
        const [, centerError] = sphereObject.setCenterPositionComponents(bodyPosition.x, bodyPosition.y, bodyPosition.z);
        if (centerError) {
          return returnFailure(centerError.code, centerError.message, centerError.details);
        }
        didMoveAnySphere = true;
      }
    }

    return returnSuccess(didMoveAnySphere);
  }
}

class PathTracer {
  constructor(
    webGlContext,
    vertexBuffer,
    framebuffers,
    displayFramebuffers,
    textures,
    displayTextures,
    skyTexture,
    textureType,
    renderProgram,
    renderVertexAttribute,
    temporalDisplayProgram,
    temporalDisplayVertexAttribute
  ) {
    this.webGlContext = webGlContext;
    this.vertexBuffer = vertexBuffer;
    this.framebuffers = framebuffers;
    this.displayFramebuffers = displayFramebuffers;
    this.textures = textures;
    this.displayTextures = displayTextures;
    this.textureSuccessResults = Object.freeze([returnSuccess(textures[0]), returnSuccess(textures[1])]);
    this.displayTextureSuccessResults = Object.freeze([
      returnSuccess(displayTextures[0]),
      returnSuccess(displayTextures[1])
    ]);
    this.skyTexture = skyTexture;
    this.textureType = textureType;
    this.renderProgram = renderProgram;
    this.renderVertexAttribute = renderVertexAttribute;
    this.temporalDisplayProgram = temporalDisplayProgram;
    this.temporalDisplayVertexAttribute = temporalDisplayVertexAttribute;
    this.renderUniformLocations = createUniformLocationCache();
    this.temporalDisplayUniformLocations = createUniformLocationCache();
    this.tracerUniformLocations = createUniformLocationCache();
    this.temporalDisplayScalarUniformLocations = Object.create(null);
    this.renderScalarUniformLocations = Object.create(null);
    this.tracerFrameScalarUniformValues = Object.create(null);
    this.temporalDisplayScalarUniformValues = Object.create(null);
    this.renderScalarUniformValues = Object.create(null);
    this.previousTracerFrameScalarUniformValues = Object.create(null);
    this.previousTemporalDisplayScalarUniformValues = Object.create(null);
    this.previousRenderScalarUniformValues = Object.create(null);
    this.previousRenderColorExposure = Number.NaN;
    this.renderColorExposureScale = 1;
    this.sceneObjects = [];
    this.sampleCount = 0;
    this.randomSampleSequence = 0;
    this.currentRaysPerPixel = DEFAULT_RAYS_PER_PIXEL;
    this.tracerProgram = null;
    this.tracerVertexAttribute = -1;
    this.currentTextureIndex = 0;
    this.currentDisplayTextureIndex = 0;
    this.hasCheckedFloatFramebuffer = false;
    this.hasDisplayHistory = false;
    this.hasValidatedRenderFramebuffer = false;
    this.hasValidatedDisplayFramebuffer = false;
    this.hasSetTracerSamplerUniforms = false;
    this.hasSetTemporalSamplerUniforms = false;
    this.hasSetRenderSamplerUniform = false;
    this.hasCompleteTracerSampleUniforms = false;
    this.cameraRight = createVec3(1, 0, 0);
    this.cameraUp = createVec3(0, 1, 0);
    this.cameraRayCenter = createVec3(0, 0, 0);
    this.cameraRayClipX = createVec3(0, 0, 0);
    this.cameraRayClipY = createVec3(0, 0, 0);
    this.previousEyePosition = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRight = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraUp = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRayCenter = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRayClipX = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousCameraRayClipY = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.sampleUniformValues = Object.create(null);
    this.sampleUniformValues.rayJitterX = 0;
    this.sampleUniformValues.rayJitterY = 0;
    this.tracerFrameUniformLocations = Object.create(null);
    this.tracerSampleUniformLocations = Object.create(null);
    cacheNamedUniformLocations(
      webGlContext,
      temporalDisplayProgram,
      this.temporalDisplayUniformLocations,
      this.temporalDisplayScalarUniformLocations,
      TEMPORAL_DISPLAY_SCALAR_UNIFORM_NAMES
    );
    cacheNamedUniformLocations(
      webGlContext,
      renderProgram,
      this.renderUniformLocations,
      this.renderScalarUniformLocations,
      RENDER_SCALAR_UNIFORM_NAMES
    );
  }

  static create(webGlContext) {
    const [vertexBuffer, vertexBufferError] = createBufferWithData(
      webGlContext,
      webGlContext.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]),
      webGlContext.STATIC_DRAW,
      'Path tracer vertex'
    );
    if (vertexBufferError) {
      return returnFailure(vertexBufferError.code, vertexBufferError.message, vertexBufferError.details);
    }

    const textureType = webGlContext.getExtension('OES_texture_float') ? webGlContext.FLOAT : webGlContext.UNSIGNED_BYTE;
    const [firstTexture, firstTextureError] = createRenderTexture(webGlContext, textureType);
    if (firstTextureError) {
      return returnFailure(firstTextureError.code, firstTextureError.message, firstTextureError.details);
    }

    const [secondTexture, secondTextureError] = createRenderTexture(webGlContext, textureType);
    if (secondTextureError) {
      return returnFailure(secondTextureError.code, secondTextureError.message, secondTextureError.details);
    }

    const [firstDisplayTexture, firstDisplayTextureError] = createRenderTexture(webGlContext, textureType);
    if (firstDisplayTextureError) {
      return returnFailure(firstDisplayTextureError.code, firstDisplayTextureError.message, firstDisplayTextureError.details);
    }

    const [secondDisplayTexture, secondDisplayTextureError] = createRenderTexture(webGlContext, textureType);
    if (secondDisplayTextureError) {
      return returnFailure(secondDisplayTextureError.code, secondDisplayTextureError.message, secondDisplayTextureError.details);
    }

    const [firstFramebuffer, firstFramebufferError] = createFramebufferForTexture(webGlContext, firstTexture, 'First path tracer');
    if (firstFramebufferError) {
      return returnFailure(firstFramebufferError.code, firstFramebufferError.message, firstFramebufferError.details);
    }

    const [secondFramebuffer, secondFramebufferError] = createFramebufferForTexture(webGlContext, secondTexture, 'Second path tracer');
    if (secondFramebufferError) {
      return returnFailure(secondFramebufferError.code, secondFramebufferError.message, secondFramebufferError.details);
    }

    const [firstDisplayFramebuffer, firstDisplayFramebufferError] = createFramebufferForTexture(
      webGlContext,
      firstDisplayTexture,
      'First temporal display'
    );
    if (firstDisplayFramebufferError) {
      return returnFailure(firstDisplayFramebufferError.code, firstDisplayFramebufferError.message, firstDisplayFramebufferError.details);
    }

    const [secondDisplayFramebuffer, secondDisplayFramebufferError] = createFramebufferForTexture(
      webGlContext,
      secondDisplayTexture,
      'Second temporal display'
    );
    if (secondDisplayFramebufferError) {
      return returnFailure(secondDisplayFramebufferError.code, secondDisplayFramebufferError.message, secondDisplayFramebufferError.details);
    }

    const [skyTexture, skyTextureError] = createProceduralSkyTexture(webGlContext);
    if (skyTextureError) {
      return returnFailure(skyTextureError.code, skyTextureError.message, skyTextureError.details);
    }

    webGlContext.bindTexture(webGlContext.TEXTURE_2D, null);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);

    const [renderProgram, renderProgramError] = createLinkedProgram(webGlContext, renderVertexSource, renderFragmentSource, 'render');
    if (renderProgramError) {
      return returnFailure(renderProgramError.code, renderProgramError.message, renderProgramError.details);
    }

    const renderVertexAttribute = webGlContext.getAttribLocation(renderProgram, 'vertex');
    if (renderVertexAttribute < 0) {
      return returnFailure('attribute-missing', 'Render vertex attribute was not found.');
    }

    const [temporalDisplayProgram, temporalDisplayProgramError] = createLinkedProgram(
      webGlContext,
      renderVertexSource,
      temporalDisplayFragmentSource,
      'temporal display'
    );
    if (temporalDisplayProgramError) {
      return returnFailure(
        temporalDisplayProgramError.code,
        temporalDisplayProgramError.message,
        temporalDisplayProgramError.details
      );
    }

    const temporalDisplayVertexAttribute = webGlContext.getAttribLocation(temporalDisplayProgram, 'vertex');
    if (temporalDisplayVertexAttribute < 0) {
      return returnFailure('attribute-missing', 'Temporal display vertex attribute was not found.');
    }

    webGlContext.enableVertexAttribArray(renderVertexAttribute);
    webGlContext.enableVertexAttribArray(temporalDisplayVertexAttribute);
    return returnSuccess(new PathTracer(
      webGlContext,
      vertexBuffer,
      [firstFramebuffer, secondFramebuffer],
      [firstDisplayFramebuffer, secondDisplayFramebuffer],
      [firstTexture, secondTexture],
      [firstDisplayTexture, secondDisplayTexture],
      skyTexture,
      textureType,
      renderProgram,
      renderVertexAttribute,
      temporalDisplayProgram,
      temporalDisplayVertexAttribute
    ));
  }

  setObjects(sceneObjects, renderSettings) {
    const nextFragmentSource = createTracerFragmentSource(sceneObjects, renderSettings);
    const [nextTracerProgram, tracerProgramError] = createLinkedProgram(this.webGlContext, tracerVertexSource, nextFragmentSource, 'path tracer');
    if (tracerProgramError) {
      return returnFailure(tracerProgramError.code, tracerProgramError.message, tracerProgramError.details);
    }

    const nextTracerVertexAttribute = this.webGlContext.getAttribLocation(nextTracerProgram, 'vertex');
    if (nextTracerVertexAttribute < 0) {
      this.webGlContext.deleteProgram(nextTracerProgram);
      return returnFailure('attribute-missing', 'Path tracer vertex attribute was not found.');
    }

    if (this.tracerProgram) {
      this.webGlContext.deleteProgram(this.tracerProgram);
    }

    this.sceneObjects = sceneObjects.slice();
    this.tracerProgram = nextTracerProgram;
    this.tracerVertexAttribute = nextTracerVertexAttribute;
    this.tracerUniformLocations = createUniformLocationCache();
    this.tracerFrameUniformLocations = Object.create(null);
    this.tracerSampleUniformLocations = Object.create(null);
    this.hasCompleteTracerSampleUniforms = false;
    this.previousTracerFrameScalarUniformValues = Object.create(null);
    writeVec3(this.previousEyePosition, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRight, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraUp, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayCenter, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayClipX, Number.NaN, Number.NaN, Number.NaN);
    writeVec3(this.previousCameraRayClipY, Number.NaN, Number.NaN, Number.NaN);
    this.sampleCount = 0;
    this.hasDisplayHistory = false;
    this.hasSetTracerSamplerUniforms = false;
    this.webGlContext.enableVertexAttribArray(this.tracerVertexAttribute);

    const [, frameUniformCacheError] = this.cacheTracerFrameUniformLocations();
    if (frameUniformCacheError) {
      return returnFailure(frameUniformCacheError.code, frameUniformCacheError.message, frameUniformCacheError.details);
    }

    const [, sampleUniformCacheError] = this.cacheTracerSampleUniformLocations();
    if (sampleUniformCacheError) {
      return returnFailure(sampleUniformCacheError.code, sampleUniformCacheError.message, sampleUniformCacheError.details);
    }

    for (const sceneObject of this.sceneObjects) {
      const [, objectUniformCacheError] = sceneObject.cacheUniformLocations(
        this.webGlContext,
        this.tracerProgram,
        this.tracerUniformLocations
      );
      if (objectUniformCacheError) {
        return returnFailure(
          objectUniformCacheError.code,
          objectUniformCacheError.message,
          objectUniformCacheError.details
        );
      }
    }

    return returnSuccess(undefined);
  }

  cacheTracerFrameUniformLocations() {
    this.tracerFrameUniformLocations.eye = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'eye'
    );
    this.tracerFrameUniformLocations.glossiness = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'glossiness'
    );
    this.tracerFrameUniformLocations.lightIntensity = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'lightIntensity'
    );
    this.tracerFrameUniformLocations.lightSize = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'lightSize'
    );
    this.tracerFrameUniformLocations.fogDensity = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'fogDensity'
    );
    this.tracerFrameUniformLocations.skyBrightness = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'skyBrightness'
    );
    this.tracerFrameUniformLocations.cameraRight = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraRight'
    );
    this.tracerFrameUniformLocations.cameraUp = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraUp'
    );
    this.tracerFrameUniformLocations.rayCenter = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayCenter'
    );
    this.tracerFrameUniformLocations.rayClipX = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayClipX'
    );
    this.tracerFrameUniformLocations.rayClipY = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayClipY'
    );
    this.tracerFrameUniformLocations.cameraFocusDistance = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraFocusDistance'
    );
    this.tracerFrameUniformLocations.cameraAperture = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'cameraAperture'
    );
    return returnSuccess(undefined);
  }

  setTracerFrameUniforms(applicationState) {
    const webGlContext = this.webGlContext;
    const locations = this.tracerFrameUniformLocations;

    setChangedCachedVec3UniformValue(webGlContext, locations.eye, applicationState.eyePosition, this.previousEyePosition);
    setChangedCachedVec3UniformValue(webGlContext, locations.cameraRight, this.cameraRight, this.previousCameraRight);
    setChangedCachedVec3UniformValue(webGlContext, locations.cameraUp, this.cameraUp, this.previousCameraUp);
    setChangedCachedVec3UniformValue(webGlContext, locations.rayCenter, this.cameraRayCenter, this.previousCameraRayCenter);
    setChangedCachedVec3UniformValue(webGlContext, locations.rayClipX, this.cameraRayClipX, this.previousCameraRayClipX);
    setChangedCachedVec3UniformValue(webGlContext, locations.rayClipY, this.cameraRayClipY, this.previousCameraRayClipY);

    const frameUniformValues = this.tracerFrameScalarUniformValues;
    frameUniformValues.glossiness = applicationState.glossiness;
    frameUniformValues.lightIntensity = applicationState.lightIntensity;
    frameUniformValues.lightSize = applicationState.lightSize;
    frameUniformValues.fogDensity = applicationState.fogDensity;
    frameUniformValues.skyBrightness = applicationState.skyBrightness;
    frameUniformValues.cameraFocusDistance = applicationState.cameraFocusDistance;
    frameUniformValues.cameraAperture = applicationState.cameraAperture;
    setChangedCachedScalarUniformValues(
      webGlContext,
      locations,
      frameUniformValues,
      this.previousTracerFrameScalarUniformValues,
      TRACER_FRAME_SCALAR_UNIFORM_NAMES
    );
  }

  cacheTracerSampleUniformLocations() {
    this.tracerSampleUniformLocations.rayJitter = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'rayJitter'
    );
    this.tracerSampleUniformLocations.textureWeight = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'textureWeight'
    );
    this.tracerSampleUniformLocations.sampleSeed = readUniformLocation(
      this.webGlContext,
      this.tracerProgram,
      this.tracerUniformLocations,
      'sampleSeed'
    );
    this.hasCompleteTracerSampleUniforms = (
      this.tracerSampleUniformLocations.rayJitter !== null &&
      this.tracerSampleUniformLocations.textureWeight !== null &&
      this.tracerSampleUniformLocations.sampleSeed !== null
    );
    return returnSuccess(undefined);
  }

  setTracerSampleUniforms(sampleUniformValues) {
    const webGlContext = this.webGlContext;
    const locations = this.tracerSampleUniformLocations;

    if (locations.rayJitter !== null) {
      webGlContext.uniform2f(locations.rayJitter, sampleUniformValues.rayJitterX, sampleUniformValues.rayJitterY);
    }
    if (locations.textureWeight !== null) {
      webGlContext.uniform1f(locations.textureWeight, sampleUniformValues.textureWeight);
    }
    if (locations.sampleSeed !== null) {
      webGlContext.uniform1f(locations.sampleSeed, sampleUniformValues.sampleSeed);
    }
  }

  renderCompleteAccumulationSamples(sampleCountToRender) {
    const webGlContext = this.webGlContext;
    const locations = this.tracerSampleUniformLocations;
    const textures = this.textures;
    const framebuffers = this.framebuffers;
    let currentTextureIndex = this.currentTextureIndex;
    let sampleCount = this.sampleCount;
    let randomSampleSequence = this.randomSampleSequence;

    for (let sampleIndex = 0; sampleIndex < sampleCountToRender; sampleIndex += 1) {
      const writeTextureIndex = 1 - currentTextureIndex;
      const nextSampleCount = sampleCount + 1;
      const sampleSeed = randomSampleSequence + 1;
      const jitterX = (readHaltonBase2(sampleSeed) * 2 - 1) * CANVAS_SIZE_RECIPROCAL;
      const jitterY = (readHaltonBase3(sampleSeed) * 2 - 1) * CANVAS_SIZE_RECIPROCAL;
      webGlContext.uniform2f(locations.rayJitter, jitterX, jitterY);
      webGlContext.uniform1f(locations.textureWeight, sampleCount / nextSampleCount);
      webGlContext.uniform1f(locations.sampleSeed, sampleSeed);

      webGlContext.bindTexture(webGlContext.TEXTURE_2D, textures[currentTextureIndex]);
      webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, framebuffers[writeTextureIndex]);
      webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);

      currentTextureIndex = writeTextureIndex;
      sampleCount = nextSampleCount;
      randomSampleSequence = sampleSeed === RANDOM_SAMPLE_SEQUENCE_WRAP ? 0 : sampleSeed;
    }

    this.currentTextureIndex = currentTextureIndex;
    this.sampleCount = sampleCount;
    this.randomSampleSequence = randomSampleSequence;
  }

  update(inverseCameraMatrix, applicationState, didCameraChange, cameraRight, cameraUp) {
    if (!this.tracerProgram) {
      return returnFailure('missing-tracer-program', 'Path tracer program has not been created.');
    }

    const webGlContext = this.webGlContext;
    const raysPerPixel = normalizeBoundedInteger(
      applicationState.raysPerPixel,
      DEFAULT_RAYS_PER_PIXEL,
      MIN_RAYS_PER_PIXEL,
      MAX_RAYS_PER_PIXEL
    );
    const sampleUniformValues = this.sampleUniformValues;
    this.currentRaysPerPixel = raysPerPixel;

    if (didCameraChange) {
      writeVec3(this.cameraRight, cameraRight[0], cameraRight[1], cameraRight[2]);
      writeVec3(this.cameraUp, cameraUp[0], cameraUp[1], cameraUp[2]);
      writeCameraRayBasis(
        this.cameraRayCenter,
        this.cameraRayClipX,
        this.cameraRayClipY,
        inverseCameraMatrix,
        applicationState.eyePosition
      );
    }

    webGlContext.useProgram(this.tracerProgram);
    if (!this.hasSetTracerSamplerUniforms) {
      const [, accumulationSamplerError] = setSamplerUniform(
        webGlContext,
        this.tracerProgram,
        this.tracerUniformLocations,
        'texture',
        0
      );
      if (accumulationSamplerError) {
        return returnFailure(accumulationSamplerError.code, accumulationSamplerError.message, accumulationSamplerError.details);
      }

      const [, skySamplerError] = setSamplerUniform(
        webGlContext,
        this.tracerProgram,
        this.tracerUniformLocations,
        'skyTexture',
        1
      );
      if (skySamplerError) {
        return returnFailure(skySamplerError.code, skySamplerError.message, skySamplerError.details);
      }

      this.hasSetTracerSamplerUniforms = true;
    }

    webGlContext.activeTexture(webGlContext.TEXTURE1);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.skyTexture);
    webGlContext.activeTexture(webGlContext.TEXTURE0);
    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.vertexAttribPointer(this.tracerVertexAttribute, 2, webGlContext.FLOAT, false, 0, 0);

    this.setTracerFrameUniforms(applicationState);

    const sceneObjects = this.sceneObjects;
    for (let objectIndex = 0; objectIndex < sceneObjects.length; objectIndex += 1) {
      sceneObjects[objectIndex].setUniforms(webGlContext);
    }

    if (!this.hasValidatedRenderFramebuffer) {
      const [, framebufferError] = this.prepareFramebufferForRendering();
      if (framebufferError) {
        webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);
        return returnFailure(framebufferError.code, framebufferError.message, framebufferError.details);
      }
    }

    if (this.hasCompleteTracerSampleUniforms) {
      this.renderCompleteAccumulationSamples(raysPerPixel);
    } else {
      for (let sampleIndex = 0; sampleIndex < raysPerPixel; sampleIndex += 1) {
        writeRayJitterUniformValues(
          sampleUniformValues,
          this.randomSampleSequence
        );

        this.renderAccumulationSample(sampleUniformValues);
      }
    }

    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);

    return returnSuccess(undefined);
  }

  renderAccumulationSample(sampleUniformValues) {
    const webGlContext = this.webGlContext;
    const writeTextureIndex = 1 - this.currentTextureIndex;
    const nextSampleCount = this.sampleCount + 1;
    const sampleSeed = this.randomSampleSequence + 1;
    sampleUniformValues.textureWeight = this.sampleCount / nextSampleCount;
    sampleUniformValues.sampleSeed = sampleSeed;

    this.setTracerSampleUniforms(sampleUniformValues);

    webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.textures[this.currentTextureIndex]);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, this.framebuffers[writeTextureIndex]);

    webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);

    this.currentTextureIndex = writeTextureIndex;
    this.sampleCount = nextSampleCount;
    this.randomSampleSequence = sampleSeed === RANDOM_SAMPLE_SEQUENCE_WRAP ? 0 : sampleSeed;
  }

  prepareFramebufferForRendering() {
    if (this.hasValidatedRenderFramebuffer) {
      return returnSuccess(undefined);
    }

    const webGlContext = this.webGlContext;
    const firstFramebuffer = this.framebuffers[0];
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, firstFramebuffer);
    const framebufferStatus = webGlContext.checkFramebufferStatus(webGlContext.FRAMEBUFFER);

    if (
      framebufferStatus !== webGlContext.FRAMEBUFFER_COMPLETE &&
      this.textureType === webGlContext.FLOAT &&
      !this.hasCheckedFloatFramebuffer
    ) {
      this.textureType = webGlContext.UNSIGNED_BYTE;
      this.hasCheckedFloatFramebuffer = true;
      this.hasDisplayHistory = false;
      this.hasValidatedRenderFramebuffer = false;
      this.hasValidatedDisplayFramebuffer = false;

      for (const texture of this.textures) {
        webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
        webGlContext.texImage2D(
          webGlContext.TEXTURE_2D,
          0,
          webGlContext.RGBA,
          CANVAS_SIZE,
          CANVAS_SIZE,
          0,
          webGlContext.RGBA,
          this.textureType,
          null
        );
      }

      for (const texture of this.displayTextures) {
        webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
        webGlContext.texImage2D(
          webGlContext.TEXTURE_2D,
          0,
          webGlContext.RGBA,
          CANVAS_SIZE,
          CANVAS_SIZE,
          0,
          webGlContext.RGBA,
          this.textureType,
          null
        );
      }
    }

    for (const framebuffer of this.framebuffers) {
      webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, framebuffer);
      const currentFramebufferStatus = webGlContext.checkFramebufferStatus(webGlContext.FRAMEBUFFER);
      if (currentFramebufferStatus !== webGlContext.FRAMEBUFFER_COMPLETE) {
        return returnFailure('framebuffer-incomplete', 'Path tracer framebuffer is incomplete.', currentFramebufferStatus);
      }
    }

    this.hasValidatedRenderFramebuffer = true;
    return returnSuccess(undefined);
  }

  shouldUseTemporalDisplayPass(temporalBlendFrames, motionBlurStrength, denoiserStrength) {
    return (
      temporalBlendFrames > MIN_TEMPORAL_BLEND_FRAMES ||
      motionBlurStrength > MIN_MOTION_BLUR_STRENGTH ||
      denoiserStrength > MIN_DENOISER_STRENGTH
    );
  }

  readRenderTexture(applicationState) {
    const temporalBlendFrames = normalizeBoundedInteger(
      applicationState.temporalBlendFrames,
      DEFAULT_TEMPORAL_BLEND_FRAMES,
      MIN_TEMPORAL_BLEND_FRAMES,
      MAX_TEMPORAL_BLEND_FRAMES
    );
    const motionBlurStrength = clampNumber(
      applicationState.motionBlurStrength,
      MIN_MOTION_BLUR_STRENGTH,
      MAX_MOTION_BLUR_STRENGTH
    );
    const denoiserStrength = clampNumber(
      applicationState.denoiserStrength,
      MIN_DENOISER_STRENGTH,
      MAX_DENOISER_STRENGTH
    );

    if (!this.shouldUseTemporalDisplayPass(temporalBlendFrames, motionBlurStrength, denoiserStrength)) {
      this.hasDisplayHistory = false;
      return this.textureSuccessResults[this.currentTextureIndex];
    }

    const [, temporalDisplayError] = this.renderTemporalDisplayTexture(
      temporalBlendFrames,
      motionBlurStrength,
      denoiserStrength
    );
    if (temporalDisplayError) {
      return returnFailure(temporalDisplayError.code, temporalDisplayError.message, temporalDisplayError.details);
    }

    return this.displayTextureSuccessResults[this.currentDisplayTextureIndex];
  }

  renderTemporalDisplayTexture(temporalBlendFrames, motionBlurStrength, denoiserStrength) {
    const webGlContext = this.webGlContext;
    const writeDisplayTextureIndex = 1 - this.currentDisplayTextureIndex;

    webGlContext.useProgram(this.temporalDisplayProgram);
    webGlContext.activeTexture(webGlContext.TEXTURE0);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.textures[this.currentTextureIndex]);

    webGlContext.activeTexture(webGlContext.TEXTURE1);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, this.displayTextures[this.currentDisplayTextureIndex]);
    if (!this.hasSetTemporalSamplerUniforms) {
      const [, currentTextureError] = setSamplerUniform(
        webGlContext,
        this.temporalDisplayProgram,
        this.temporalDisplayUniformLocations,
        'texture',
        0
      );
      if (currentTextureError) {
        return returnFailure(currentTextureError.code, currentTextureError.message, currentTextureError.details);
      }

      const [, historyTextureError] = setSamplerUniform(
        webGlContext,
        this.temporalDisplayProgram,
        this.temporalDisplayUniformLocations,
        'displayHistoryTexture',
        1
      );
      if (historyTextureError) {
        return returnFailure(historyTextureError.code, historyTextureError.message, historyTextureError.details);
      }

      this.hasSetTemporalSamplerUniforms = true;
    }

    const temporalUniformValues = this.temporalDisplayScalarUniformValues;
    temporalUniformValues.temporalBlendFrames = temporalBlendFrames;
    temporalUniformValues.temporalFrameAge = Math.min(this.sampleCount / this.currentRaysPerPixel, 1);
    temporalUniformValues.historyAvailability = this.hasDisplayHistory ? 1 : 0;
    temporalUniformValues.motionBlurStrength = motionBlurStrength;
    temporalUniformValues.denoiserStrength = denoiserStrength;

    setChangedCachedScalarUniformValues(
      webGlContext,
      this.temporalDisplayScalarUniformLocations,
      temporalUniformValues,
      this.previousTemporalDisplayScalarUniformValues,
      TEMPORAL_DISPLAY_SCALAR_UNIFORM_NAMES
    );

    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, this.displayFramebuffers[writeDisplayTextureIndex]);

    if (!this.hasValidatedDisplayFramebuffer) {
      for (const displayFramebuffer of this.displayFramebuffers) {
        webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, displayFramebuffer);
        const displayFramebufferStatus = webGlContext.checkFramebufferStatus(webGlContext.FRAMEBUFFER);
        if (displayFramebufferStatus !== webGlContext.FRAMEBUFFER_COMPLETE) {
          webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);
          webGlContext.activeTexture(webGlContext.TEXTURE0);
          return returnFailure('display-framebuffer-incomplete', 'Temporal display framebuffer is incomplete.', displayFramebufferStatus);
        }
      }
      this.hasValidatedDisplayFramebuffer = true;
      webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, this.displayFramebuffers[writeDisplayTextureIndex]);
    }

    webGlContext.vertexAttribPointer(this.temporalDisplayVertexAttribute, 2, webGlContext.FLOAT, false, 0, 0);
    webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);
    webGlContext.bindFramebuffer(webGlContext.FRAMEBUFFER, null);
    webGlContext.activeTexture(webGlContext.TEXTURE0);

    this.currentDisplayTextureIndex = writeDisplayTextureIndex;
    this.hasDisplayHistory = true;
    return returnSuccess(undefined);
  }

  render(applicationState) {
    const [renderTexture, renderTextureError] = this.readRenderTexture(applicationState);
    if (renderTextureError) {
      return returnFailure(renderTextureError.code, renderTextureError.message, renderTextureError.details);
    }

    const webGlContext = this.webGlContext;
    webGlContext.useProgram(this.renderProgram);
    webGlContext.activeTexture(webGlContext.TEXTURE0);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, renderTexture);
    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.vertexAttribPointer(this.renderVertexAttribute, 2, webGlContext.FLOAT, false, 0, 0);

    if (!this.hasSetRenderSamplerUniform) {
      const [, renderSamplerError] = setSamplerUniform(
        webGlContext,
        this.renderProgram,
        this.renderUniformLocations,
        'texture',
        0
      );
      if (renderSamplerError) {
        return returnFailure(renderSamplerError.code, renderSamplerError.message, renderSamplerError.details);
      }
      this.hasSetRenderSamplerUniform = true;
    }

    const renderUniformValues = this.renderScalarUniformValues;
    if (this.previousRenderColorExposure !== applicationState.colorExposure) {
      this.previousRenderColorExposure = applicationState.colorExposure;
      this.renderColorExposureScale = 2 ** applicationState.colorExposure;
    }
    renderUniformValues.colorExposureScale = this.renderColorExposureScale;
    renderUniformValues.colorBrightness = applicationState.colorBrightness;
    renderUniformValues.colorContrast = applicationState.colorContrast;
    renderUniformValues.colorSaturation = applicationState.colorSaturation;
    renderUniformValues.colorGamma = applicationState.colorGamma;
    renderUniformValues.bloomStrength = applicationState.bloomStrength;
    renderUniformValues.bloomThreshold = applicationState.bloomThreshold;
    renderUniformValues.glareStrength = applicationState.glareStrength;

    setChangedCachedScalarUniformValues(
      webGlContext,
      this.renderScalarUniformLocations,
      renderUniformValues,
      this.previousRenderScalarUniformValues,
      RENDER_SCALAR_UNIFORM_NAMES
    );

    webGlContext.drawArrays(webGlContext.TRIANGLE_STRIP, 0, 4);
    return returnSuccess(undefined);
  }

  clearSamples(shouldClearDisplayHistory = true) {
    this.sampleCount = 0;
    if (shouldClearDisplayHistory) {
      this.hasDisplayHistory = false;
    }
    return returnSuccess(undefined);
  }

  clearDisplayHistory() {
    this.hasDisplayHistory = false;
    return returnSuccess(undefined);
  }
}

class SelectionRenderer {
  constructor(webGlContext, vertexBuffer, indexBuffer, lineProgram, vertexAttribute, pathTracer) {
    this.webGlContext = webGlContext;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.lineProgram = lineProgram;
    this.vertexAttribute = vertexAttribute;
    this.pathTracer = pathTracer;
    this.lineUniformLocations = createUniformLocationCache();
    this.lineCubeMinUniformLocation = lineProgram
      ? readUniformLocation(webGlContext, lineProgram, this.lineUniformLocations, 'cubeMin')
      : null;
    this.lineCubeMaxUniformLocation = lineProgram
      ? readUniformLocation(webGlContext, lineProgram, this.lineUniformLocations, 'cubeMax')
      : null;
    this.lineModelviewProjectionUniformLocation = lineProgram
      ? readUniformLocation(webGlContext, lineProgram, this.lineUniformLocations, 'modelviewProjection')
      : null;
    this.sceneObjects = [];
    this.selectedObject = null;
    this.modelviewProjectionMatrix = createIdentityMat4();
    this.previousLineMinCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousLineMaxCorner = createVec3(Number.NaN, Number.NaN, Number.NaN);
    this.previousLineModelviewProjectionMatrix = createInvalidMat4();
  }

  static create(webGlContext) {
    const [vertexBuffer, vertexBufferError] = createBufferWithData(
      webGlContext,
      webGlContext.ARRAY_BUFFER,
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 1, 0,
        0, 0, 1,
        1, 0, 1,
        0, 1, 1,
        1, 1, 1
      ]),
      webGlContext.STATIC_DRAW,
      'Selection vertex'
    );
    if (vertexBufferError) {
      return returnFailure(vertexBufferError.code, vertexBufferError.message, vertexBufferError.details);
    }

    const [indexBuffer, indexBufferError] = createBufferWithData(
      webGlContext,
      webGlContext.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([
        0, 1, 1, 3, 3, 2, 2, 0,
        4, 5, 5, 7, 7, 6, 6, 4,
        0, 4, 1, 5, 2, 6, 3, 7
      ]),
      webGlContext.STATIC_DRAW,
      'Selection index'
    );
    if (indexBufferError) {
      return returnFailure(indexBufferError.code, indexBufferError.message, indexBufferError.details);
    }

    const [compiledLineProgram, lineProgramError] = createLinkedProgram(
      webGlContext,
      lineVertexSource,
      lineFragmentSource,
      'selection line'
    );
    let lineProgram = compiledLineProgram;
    let vertexAttribute = -1;
    if (!lineProgramError) {
      vertexAttribute = webGlContext.getAttribLocation(lineProgram, 'selectionVertex');
      if (vertexAttribute < 0) {
        webGlContext.deleteProgram(lineProgram);
        lineProgram = null;
      }
    }

    const [pathTracer, pathTracerError] = PathTracer.create(webGlContext);
    if (pathTracerError) {
      return returnFailure(pathTracerError.code, pathTracerError.message, pathTracerError.details);
    }

    if (lineProgram && vertexAttribute >= 0) {
      webGlContext.enableVertexAttribArray(vertexAttribute);
    }
    return returnSuccess(new SelectionRenderer(webGlContext, vertexBuffer, indexBuffer, lineProgram, vertexAttribute, pathTracer));
  }

  setObjects(sceneObjects, renderSettings) {
    const [, tracerError] = this.pathTracer.setObjects(sceneObjects, renderSettings);
    if (tracerError) {
      return returnFailure(tracerError.code, tracerError.message, tracerError.details);
    }

    this.sceneObjects = sceneObjects.slice();
    if (!this.sceneObjects.includes(this.selectedObject)) {
      this.selectedObject = null;
    }

    return returnSuccess(undefined);
  }

  update(modelviewProjectionMatrix, inverseCameraMatrix, applicationState, didCameraChange, cameraRight, cameraUp) {
    this.modelviewProjectionMatrix = modelviewProjectionMatrix;
    const [, tracerError] = this.pathTracer.update(
      inverseCameraMatrix,
      applicationState,
      didCameraChange,
      cameraRight,
      cameraUp
    );
    if (tracerError) {
      return returnFailure(tracerError.code, tracerError.message, tracerError.details);
    }
    return returnSuccess(undefined);
  }

  render(applicationState) {
    const [, pathTracerError] = this.pathTracer.render(applicationState);
    if (pathTracerError) {
      return returnFailure(pathTracerError.code, pathTracerError.message, pathTracerError.details);
    }

    if (!this.selectedObject || !this.lineProgram || this.vertexAttribute < 0) {
      return returnSuccess(undefined);
    }

    const webGlContext = this.webGlContext;
    webGlContext.useProgram(this.lineProgram);
    webGlContext.bindTexture(webGlContext.TEXTURE_2D, null);
    webGlContext.bindBuffer(webGlContext.ARRAY_BUFFER, this.vertexBuffer);
    webGlContext.bindBuffer(webGlContext.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    webGlContext.vertexAttribPointer(this.vertexAttribute, 3, webGlContext.FLOAT, false, 0, 0);

    if (this.lineCubeMinUniformLocation !== null) {
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.lineCubeMinUniformLocation,
        this.selectedObject.getMinCorner(),
        this.previousLineMinCorner
      );
    }
    if (this.lineCubeMaxUniformLocation !== null) {
      setChangedCachedVec3UniformValue(
        webGlContext,
        this.lineCubeMaxUniformLocation,
        this.selectedObject.getMaxCorner(),
        this.previousLineMaxCorner
      );
    }
    if (this.lineModelviewProjectionUniformLocation !== null) {
      setChangedCachedMat4UniformValue(
        webGlContext,
        this.lineModelviewProjectionUniformLocation,
        this.modelviewProjectionMatrix,
        this.previousLineModelviewProjectionMatrix
      );
    }

    webGlContext.drawElements(webGlContext.LINES, 24, webGlContext.UNSIGNED_SHORT, 0);
    return returnSuccess(undefined);
  }
}

class UserInterfaceController {
  constructor(
    selectionRenderer,
    physicsWorld,
    applicationState,
    canvasElement,
    focusPickButton,
    glossinessContainer,
    materialSelect,
    environmentSelect,
    glossinessInput,
    lightBounceInput,
    lightBounceValueElement,
    lightIntensityValueElement,
    lightSizeInput,
    lightSizeValueElement,
    fogDensityInput,
    fogDensityValueElement,
    skyBrightnessInput,
    skyBrightnessValueElement,
    raysPerPixelInput,
    raysPerPixelValueElement,
    temporalBlendFramesInput,
    temporalBlendFramesValueElement,
    denoiserStrengthInput,
    denoiserStrengthValueElement,
    colorExposureInput,
    colorExposureValueElement,
    colorBrightnessInput,
    colorBrightnessValueElement,
    colorContrastInput,
    colorContrastValueElement,
    colorSaturationInput,
    colorSaturationValueElement,
    colorGammaInput,
    colorGammaValueElement,
    cameraFocusDistanceInput,
    cameraFocusDistanceValueElement,
    cameraApertureInput,
    cameraApertureValueElement,
    motionBlurInput,
    motionBlurValueElement,
    bloomStrengthInput,
    bloomStrengthValueElement,
    bloomThresholdInput,
    bloomThresholdValueElement,
    glareStrengthInput,
    glareStrengthValueElement
  ) {
    this.selectionRenderer = selectionRenderer;
    this.physicsWorld = physicsWorld;
    this.applicationState = applicationState;
    this.canvasElement = canvasElement;
    this.focusPickButton = focusPickButton;
    this.glossinessContainer = glossinessContainer;
    this.materialSelect = materialSelect;
    this.environmentSelect = environmentSelect;
    this.glossinessInput = glossinessInput;
    this.lightBounceInput = lightBounceInput;
    this.lightBounceValueElement = lightBounceValueElement;
    this.lightIntensityValueElement = lightIntensityValueElement;
    this.lightSizeInput = lightSizeInput;
    this.lightSizeValueElement = lightSizeValueElement;
    this.fogDensityInput = fogDensityInput;
    this.fogDensityValueElement = fogDensityValueElement;
    this.skyBrightnessInput = skyBrightnessInput;
    this.skyBrightnessValueElement = skyBrightnessValueElement;
    this.raysPerPixelInput = raysPerPixelInput;
    this.raysPerPixelValueElement = raysPerPixelValueElement;
    this.temporalBlendFramesInput = temporalBlendFramesInput;
    this.temporalBlendFramesValueElement = temporalBlendFramesValueElement;
    this.denoiserStrengthInput = denoiserStrengthInput;
    this.denoiserStrengthValueElement = denoiserStrengthValueElement;
    this.colorExposureInput = colorExposureInput;
    this.colorExposureValueElement = colorExposureValueElement;
    this.colorBrightnessInput = colorBrightnessInput;
    this.colorBrightnessValueElement = colorBrightnessValueElement;
    this.colorContrastInput = colorContrastInput;
    this.colorContrastValueElement = colorContrastValueElement;
    this.colorSaturationInput = colorSaturationInput;
    this.colorSaturationValueElement = colorSaturationValueElement;
    this.colorGammaInput = colorGammaInput;
    this.colorGammaValueElement = colorGammaValueElement;
    this.cameraFocusDistanceInput = cameraFocusDistanceInput;
    this.cameraFocusDistanceValueElement = cameraFocusDistanceValueElement;
    this.cameraApertureInput = cameraApertureInput;
    this.cameraApertureValueElement = cameraApertureValueElement;
    this.motionBlurInput = motionBlurInput;
    this.motionBlurValueElement = motionBlurValueElement;
    this.bloomStrengthInput = bloomStrengthInput;
    this.bloomStrengthValueElement = bloomStrengthValueElement;
    this.bloomThresholdInput = bloomThresholdInput;
    this.bloomThresholdValueElement = bloomThresholdValueElement;
    this.glareStrengthInput = glareStrengthInput;
    this.glareStrengthValueElement = glareStrengthValueElement;
    this.sceneObjects = [];
    this.lightObject = new LightSceneObject(applicationState);
    this.isMovingSelection = false;
    this.isGlossinessVisible = null;
    this.movementNormal = createVec3(0, 0, 0);
    this.movementDistance = 0;
    this.originalHitPosition = createVec3(0, 0, 0);
    this.pointerRayDirection = createVec3(0, 0, 0);
    this.pointerHitPosition = createVec3(0, 0, 0);
    this.pointerTranslation = createVec3(0, 0, 0);
    this.modelviewMatrix = createIdentityMat4();
    this.projectionMatrix = createIdentityMat4();
    writeCameraProjectionMat4(this.projectionMatrix);
    this.modelviewProjectionMatrix = createIdentityMat4();
    this.inverseModelviewProjectionMatrix = createIdentityMat4();
    this.cameraXAxis = createVec3(1, 0, 0);
    this.cameraYAxis = createVec3(0, 1, 0);
    this.cameraZAxis = createVec3(0, 0, 1);
    this.previousCameraAngleX = Number.NaN;
    this.previousCameraAngleY = Number.NaN;
    this.previousCameraDistance = Number.NaN;
  }

  setSceneObjects(sceneObjects) {
    this.sceneObjects = [this.lightObject, ...sceneObjects];
    return this.syncSceneObjectsToRendererAndPhysics();
  }

  syncSceneObjectsToRendererAndPhysics() {
    const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }

    const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
    if (physicsError) {
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }

    return returnSuccess(undefined);
  }

  stepPhysics(elapsedSeconds) {
    if (this.isMovingSelection && !this.applicationState.isPointerDown) {
      const [, cancelError] = this.cancelActivePointerInteraction();
      if (cancelError) {
        return returnFailure(cancelError.code, cancelError.message, cancelError.details);
      }
    }

    const shouldStepPhysics = !this.isMovingSelection;
    const [didMoveSphere, physicsError] = this.physicsWorld.step(elapsedSeconds, shouldStepPhysics);
    if (physicsError) {
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }

    if (!didMoveSphere) {
      return returnSuccess(undefined);
    }

    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  update() {
    const eyePosition = this.applicationState.eyePosition;
    const cameraAngleX = this.applicationState.cameraAngleX;
    const cameraAngleY = this.applicationState.cameraAngleY;
    const cameraDistance = this.applicationState.cameraDistance;
    const didCameraChange = (
      this.previousCameraAngleX !== cameraAngleX ||
      this.previousCameraAngleY !== cameraAngleY ||
      this.previousCameraDistance !== cameraDistance
    );

    if (didCameraChange) {
      this.previousCameraAngleX = cameraAngleX;
      this.previousCameraAngleY = cameraAngleY;
      this.previousCameraDistance = cameraDistance;

      const sinCameraAngleX = Math.sin(cameraAngleX);
      const cosCameraAngleX = Math.cos(cameraAngleX);
      const sinCameraAngleY = Math.sin(cameraAngleY);
      const cosCameraAngleY = Math.cos(cameraAngleY);
      eyePosition[0] = cameraDistance * sinCameraAngleY * cosCameraAngleX;
      eyePosition[1] = cameraDistance * sinCameraAngleX;
      eyePosition[2] = cameraDistance * cosCameraAngleY * cosCameraAngleX;
    }

    const isGlossinessVisible = this.applicationState.material === MATERIAL.GLOSSY;
    if (this.isGlossinessVisible !== isGlossinessVisible) {
      this.isGlossinessVisible = isGlossinessVisible;
      this.glossinessContainer.style.display = isGlossinessVisible ? 'inline' : 'none';
    }

    if (didCameraChange) {
      const [, modelviewError] = writeLookAtMat4(
        this.modelviewMatrix,
        eyePosition,
        ORIGIN_VECTOR,
        WORLD_UP_VECTOR,
        this.cameraXAxis,
        this.cameraYAxis,
        this.cameraZAxis
      );
      if (modelviewError) {
        return returnFailure(modelviewError.code, modelviewError.message, modelviewError.details);
      }

      writeMultiplyMat4(this.modelviewProjectionMatrix, this.projectionMatrix, this.modelviewMatrix);
      const [, inverseError] = writeInvertMat4(this.inverseModelviewProjectionMatrix, this.modelviewProjectionMatrix);
      if (inverseError) {
        return returnFailure(inverseError.code, inverseError.message, inverseError.details);
      }
    }

    const [, rendererError] = this.selectionRenderer.update(
      this.modelviewProjectionMatrix,
      this.inverseModelviewProjectionMatrix,
      this.applicationState,
      didCameraChange,
      this.cameraXAxis,
      this.cameraYAxis
    );
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }

    return returnSuccess(undefined);
  }

  render() {
    return this.selectionRenderer.render(this.applicationState);
  }

  selectLight() {
    this.selectionRenderer.selectedObject = this.lightObject;
    return returnSuccess(undefined);
  }

  addSphere() {
    const sphereObject = new SphereSceneObject(createVec3(0, 0, 0), 0.25, allocateSceneObjectId(this.applicationState));
    this.sceneObjects.push(sphereObject);
    return this.syncSceneObjectsToRendererAndPhysics();
  }

  addCube() {
    const cubeObject = new CubeSceneObject(
      createVec3(-0.25, -0.25, -0.25),
      createVec3(0.25, 0.25, 0.25),
      allocateSceneObjectId(this.applicationState)
    );
    this.sceneObjects.push(cubeObject);
    return this.syncSceneObjectsToRendererAndPhysics();
  }

  deleteSelection() {
    const selectedObject = this.selectionRenderer.selectedObject;
    if (!selectedObject || selectedObject === this.lightObject) {
      return returnSuccess(undefined);
    }

    const selectedObjectIndex = this.sceneObjects.indexOf(selectedObject);
    if (selectedObjectIndex >= 0) {
      this.sceneObjects.splice(selectedObjectIndex, 1);
    }

    this.selectionRenderer.selectedObject = null;
    return this.syncSceneObjectsToRendererAndPhysics();
  }

  updateMaterialFromSelect() {
    const nextMaterial = Number.parseInt(this.materialSelect.value, 10);
    if (Number.isNaN(nextMaterial)) {
      return returnFailure('invalid-material', 'Selected material is invalid.');
    }

    if (this.applicationState.material === nextMaterial) {
      return returnSuccess(undefined);
    }

    this.applicationState.material = nextMaterial;
    const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }
    return returnSuccess(undefined);
  }

  updateEnvironmentFromSelect() {
    const nextEnvironment = Number.parseInt(this.environmentSelect.value, 10);
    if (Number.isNaN(nextEnvironment)) {
      return returnFailure('invalid-environment', 'Selected environment is invalid.');
    }

    if (this.applicationState.environment === nextEnvironment) {
      return returnSuccess(undefined);
    }

    this.applicationState.environment = nextEnvironment;
    return this.syncSceneObjectsToRendererAndPhysics();
  }

  updateGlossinessFromInput() {
    const parsedGlossiness = Number.parseFloat(this.glossinessInput.value);
    const nextGlossiness = clampNumber(Number.isNaN(parsedGlossiness) ? 0 : parsedGlossiness, 0, 1);

    if (this.applicationState.material === MATERIAL.GLOSSY && this.applicationState.glossiness !== nextGlossiness) {
      const [, clearError] = this.selectionRenderer.pathTracer.clearSamples();
      if (clearError) {
        return returnFailure(clearError.code, clearError.message, clearError.details);
      }
    }

    this.applicationState.glossiness = nextGlossiness;
    return returnSuccess(undefined);
  }

  updateLightBounceCountFromInput() {
    const [nextLightBounceCount, parseError] = parseBoundedInteger(
      this.lightBounceInput.value,
      DEFAULT_LIGHT_BOUNCE_COUNT,
      MIN_LIGHT_BOUNCE_COUNT,
      MAX_LIGHT_BOUNCE_COUNT
    );
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    this.lightBounceInput.value = String(nextLightBounceCount);
    this.lightBounceValueElement.textContent = String(nextLightBounceCount);

    if (this.applicationState.lightBounceCount === nextLightBounceCount) {
      return returnSuccess(undefined);
    }

    this.applicationState.lightBounceCount = nextLightBounceCount;
    const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
    if (rendererError) {
      return returnFailure(rendererError.code, rendererError.message, rendererError.details);
    }
    return returnSuccess(undefined);
  }

  syncLightIntensityValue() {
    this.lightIntensityValueElement.textContent = formatLightIntensityValue(this.applicationState.lightIntensity);
    return returnSuccess(undefined);
  }

  updatePathTracingNumberControlFromInput(inputElement, valueElement, stateKey, fallbackValue, minValue, maxValue) {
    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatColorAdjustmentValue(nextValue);

    const previousValue = this.applicationState[stateKey];
    if (previousValue === nextValue) {
      return returnSuccess(undefined);
    }

    const wasFogEnabled = stateKey === 'fogDensity' && previousValue > 0.0001;
    this.applicationState[stateKey] = nextValue;
    if (stateKey === 'lightSize') {
      this.applicationState.lightPosition = clampLightPosition(this.applicationState.lightPosition, nextValue);
    }

    const isFogEnabled = stateKey === 'fogDensity' && nextValue > 0.0001;
    if (wasFogEnabled !== isFogEnabled) {
      const [, rendererError] = this.selectionRenderer.setObjects(this.sceneObjects, this.applicationState);
      if (rendererError) {
        return returnFailure(rendererError.code, rendererError.message, rendererError.details);
      }
      return returnSuccess(undefined);
    }

    return this.selectionRenderer.pathTracer.clearSamples();
  }

  updateDisplayNumberControlFromInput(inputElement, valueElement, stateKey, fallbackValue, minValue, maxValue) {
    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatColorAdjustmentValue(nextValue);

    if (this.applicationState[stateKey] === nextValue) {
      return returnSuccess(undefined);
    }

    this.applicationState[stateKey] = nextValue;
    if (stateKey === 'denoiserStrength') {
      return this.selectionRenderer.pathTracer.clearDisplayHistory();
    }

    return returnSuccess(undefined);
  }

  updateLightSizeFromInput() {
    return this.updatePathTracingNumberControlFromInput(
      this.lightSizeInput,
      this.lightSizeValueElement,
      'lightSize',
      DEFAULT_LIGHT_SIZE,
      MIN_LIGHT_SIZE,
      MAX_LIGHT_SIZE
    );
  }

  updateFogDensityFromInput() {
    return this.updatePathTracingNumberControlFromInput(
      this.fogDensityInput,
      this.fogDensityValueElement,
      'fogDensity',
      DEFAULT_FOG_DENSITY,
      MIN_FOG_DENSITY,
      MAX_FOG_DENSITY
    );
  }

  updateSkyBrightnessFromInput() {
    return this.updatePathTracingNumberControlFromInput(
      this.skyBrightnessInput,
      this.skyBrightnessValueElement,
      'skyBrightness',
      DEFAULT_SKY_BRIGHTNESS,
      MIN_SKY_BRIGHTNESS,
      MAX_SKY_BRIGHTNESS
    );
  }

  updateDenoiserStrengthFromInput() {
    return this.updateDisplayNumberControlFromInput(
      this.denoiserStrengthInput,
      this.denoiserStrengthValueElement,
      'denoiserStrength',
      DEFAULT_DENOISER_STRENGTH,
      MIN_DENOISER_STRENGTH,
      MAX_DENOISER_STRENGTH
    );
  }

  updateBloomStrengthFromInput() {
    return this.updateDisplayNumberControlFromInput(
      this.bloomStrengthInput,
      this.bloomStrengthValueElement,
      'bloomStrength',
      DEFAULT_BLOOM_STRENGTH,
      MIN_BLOOM_STRENGTH,
      MAX_BLOOM_STRENGTH
    );
  }

  updateBloomThresholdFromInput() {
    return this.updateDisplayNumberControlFromInput(
      this.bloomThresholdInput,
      this.bloomThresholdValueElement,
      'bloomThreshold',
      DEFAULT_BLOOM_THRESHOLD,
      MIN_BLOOM_THRESHOLD,
      MAX_BLOOM_THRESHOLD
    );
  }

  updateGlareStrengthFromInput() {
    return this.updateDisplayNumberControlFromInput(
      this.glareStrengthInput,
      this.glareStrengthValueElement,
      'glareStrength',
      DEFAULT_GLARE_STRENGTH,
      MIN_GLARE_STRENGTH,
      MAX_GLARE_STRENGTH
    );
  }

  toggleLightIntensityCycle(toggleButton) {
    this.applicationState.isLightIntensityCycling = !this.applicationState.isLightIntensityCycling;
    const [, buttonError] = updateLightIntensityCycleButton(
      toggleButton,
      this.applicationState.isLightIntensityCycling
    );
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }

    return this.syncLightIntensityValue();
  }

  advanceLightIntensityCycle(elapsedSeconds) {
    if (!this.applicationState.isLightIntensityCycling) {
      return returnSuccess(undefined);
    }

    const span = MAX_LIGHT_INTENSITY - MIN_LIGHT_INTENSITY;
    if (span <= 0) {
      return returnSuccess(undefined);
    }

    const cycleDistance = span * 2;
    const currentCyclePosition = this.applicationState.lightIntensityCycleDirection >= 0
      ? this.applicationState.lightIntensity - MIN_LIGHT_INTENSITY
      : span + (MAX_LIGHT_INTENSITY - this.applicationState.lightIntensity);
    const nextCyclePosition = (currentCyclePosition + LIGHT_INTENSITY_CYCLE_SPEED * elapsedSeconds) % cycleDistance;
    const isRising = nextCyclePosition <= span;
    const nextIntensity = clampNumber(
      isRising
        ? MIN_LIGHT_INTENSITY + nextCyclePosition
        : MAX_LIGHT_INTENSITY - (nextCyclePosition - span),
      MIN_LIGHT_INTENSITY,
      MAX_LIGHT_INTENSITY
    );
    const nextDirection = isRising ? 1 : -1;

    if (Math.abs(this.applicationState.lightIntensity - nextIntensity) < 0.000001) {
      return returnSuccess(undefined);
    }

    this.applicationState.lightIntensity = nextIntensity;
    this.applicationState.lightIntensityCycleDirection = nextDirection;
    this.syncLightIntensityValue();
    this.selectionRenderer.pathTracer.clearSamples(false);
    return returnSuccess(undefined);
  }

  updateRaysPerPixelFromInput() {
    const [nextRaysPerPixel, parseError] = parseBoundedInteger(
      this.raysPerPixelInput.value,
      DEFAULT_RAYS_PER_PIXEL,
      MIN_RAYS_PER_PIXEL,
      MAX_RAYS_PER_PIXEL
    );
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    this.raysPerPixelInput.value = String(nextRaysPerPixel);
    this.raysPerPixelValueElement.textContent = String(nextRaysPerPixel);

    if (this.applicationState.raysPerPixel === nextRaysPerPixel) {
      return returnSuccess(undefined);
    }

    this.applicationState.raysPerPixel = nextRaysPerPixel;
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  updateTemporalBlendFramesFromInput() {
    const [nextTemporalBlendFrames, parseError] = parseBoundedInteger(
      this.temporalBlendFramesInput.value,
      DEFAULT_TEMPORAL_BLEND_FRAMES,
      MIN_TEMPORAL_BLEND_FRAMES,
      MAX_TEMPORAL_BLEND_FRAMES
    );
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    this.temporalBlendFramesInput.value = String(nextTemporalBlendFrames);
    this.temporalBlendFramesValueElement.textContent = String(nextTemporalBlendFrames);

    if (this.applicationState.temporalBlendFrames === nextTemporalBlendFrames) {
      return returnSuccess(undefined);
    }

    this.applicationState.temporalBlendFrames = nextTemporalBlendFrames;
    return this.selectionRenderer.pathTracer.clearDisplayHistory();
  }

  updateCameraEffectControlFromInput(inputElement, valueElement, stateKey, fallbackValue, minValue, maxValue) {
    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatCameraEffectValue(nextValue);

    if (this.applicationState[stateKey] === nextValue) {
      return returnSuccess(undefined);
    }

    this.applicationState[stateKey] = nextValue;
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  updateCameraFocusDistanceFromInput() {
    return this.updateCameraEffectControlFromInput(
      this.cameraFocusDistanceInput,
      this.cameraFocusDistanceValueElement,
      'cameraFocusDistance',
      DEFAULT_CAMERA_FOCUS_DISTANCE,
      MIN_CAMERA_FOCUS_DISTANCE,
      MAX_CAMERA_FOCUS_DISTANCE
    );
  }

  updateCameraApertureFromInput() {
    return this.updateCameraEffectControlFromInput(
      this.cameraApertureInput,
      this.cameraApertureValueElement,
      'cameraAperture',
      DEFAULT_CAMERA_APERTURE,
      MIN_CAMERA_APERTURE,
      MAX_CAMERA_APERTURE
    );
  }

  updateMotionBlurFromInput() {
    return this.updateCameraEffectControlFromInput(
      this.motionBlurInput,
      this.motionBlurValueElement,
      'motionBlurStrength',
      DEFAULT_MOTION_BLUR_STRENGTH,
      MIN_MOTION_BLUR_STRENGTH,
      MAX_MOTION_BLUR_STRENGTH
    );
  }

  updateCameraEffectsFromInputs() {
    const updateActions = [
      () => this.updateCameraFocusDistanceFromInput(),
      () => this.updateCameraApertureFromInput(),
      () => this.updateMotionBlurFromInput()
    ];

    for (const updateAction of updateActions) {
      const [, updateError] = updateAction();
      if (updateError) {
        return returnFailure(updateError.code, updateError.message, updateError.details);
      }
    }

    return returnSuccess(undefined);
  }

  syncFocusPickMode() {
    this.canvasElement.classList.toggle('focus-pick-mode', this.applicationState.isPickingFocus);
    const [, buttonError] = updateFocusPickButton(this.focusPickButton, this.applicationState.isPickingFocus);
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }
    return returnSuccess(undefined);
  }

  toggleFocusPickMode() {
    this.applicationState.isPickingFocus = !this.applicationState.isPickingFocus;
    this.applicationState.isRotatingCamera = false;
    this.isMovingSelection = false;
    return this.syncFocusPickMode();
  }

  updateFocusDistanceFromSceneHit(focusDistance) {
    const nextFocusDistance = normalizeBoundedNumber(
      focusDistance,
      DEFAULT_CAMERA_FOCUS_DISTANCE,
      MIN_CAMERA_FOCUS_DISTANCE,
      MAX_CAMERA_FOCUS_DISTANCE
    );

    this.applicationState.cameraFocusDistance = nextFocusDistance;
    this.cameraFocusDistanceInput.value = nextFocusDistance.toFixed(2);
    this.cameraFocusDistanceValueElement.textContent = formatCameraEffectValue(nextFocusDistance);
    const [, clearError] = this.selectionRenderer.pathTracer.clearSamples();
    if (clearError) {
      return returnFailure(clearError.code, clearError.message, clearError.details);
    }
    return returnSuccess(undefined);
  }

  handleFocusPick(xPosition, yPosition) {
    const originPosition = this.applicationState.eyePosition;
    const rayDirection = this.pointerRayDirection;
    writeEyeRayVector(
      rayDirection,
      this.inverseModelviewProjectionMatrix,
      (xPosition / HALF_CANVAS_SIZE) - 1,
      1 - (yPosition / HALF_CANVAS_SIZE),
      originPosition
    );
    let closestDistance = MAX_INTERSECTION_DISTANCE;

    for (const sceneObject of this.sceneObjects) {
      const [objectDistance, objectDistanceError] = sceneObject.intersectRay(originPosition, rayDirection);
      if (objectDistanceError) {
        return returnFailure(objectDistanceError.code, objectDistanceError.message, objectDistanceError.details);
      }

      if (objectDistance < closestDistance) {
        closestDistance = objectDistance;
      }
    }

    if (closestDistance >= MAX_INTERSECTION_DISTANCE) {
      return returnSuccess(false);
    }

    const focusDistance = lengthVec3(rayDirection) * closestDistance;
    const [, focusError] = this.updateFocusDistanceFromSceneHit(focusDistance);
    if (focusError) {
      return returnFailure(focusError.code, focusError.message, focusError.details);
    }

    this.applicationState.isPickingFocus = false;
    const [, syncError] = this.syncFocusPickMode();
    if (syncError) {
      return returnFailure(syncError.code, syncError.message, syncError.details);
    }

    return returnSuccess(true);
  }

  updateColorCorrectionControlFromInput(
    inputElement,
    valueElement,
    stateKey,
    fallbackValue,
    minValue,
    maxValue,
    formatValue
  ) {
    const [nextValue, parseError] = parseBoundedNumber(inputElement.value, fallbackValue, minValue, maxValue);
    if (parseError) {
      return returnFailure(parseError.code, parseError.message, parseError.details);
    }

    inputElement.value = nextValue.toFixed(2);
    valueElement.textContent = formatValue(nextValue);
    this.applicationState[stateKey] = nextValue;
    return returnSuccess(undefined);
  }

  syncColorCorrectionControlFromState(inputElement, valueElement, value, formatValue) {
    inputElement.value = value.toFixed(2);
    valueElement.textContent = formatValue(value);
    return returnSuccess(undefined);
  }

  updateColorExposureFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorExposureInput,
      this.colorExposureValueElement,
      'colorExposure',
      DEFAULT_COLOR_EXPOSURE,
      MIN_COLOR_EXPOSURE,
      MAX_COLOR_EXPOSURE,
      formatSignedColorAdjustmentValue
    );
  }

  updateColorBrightnessFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorBrightnessInput,
      this.colorBrightnessValueElement,
      'colorBrightness',
      DEFAULT_COLOR_BRIGHTNESS,
      MIN_COLOR_BRIGHTNESS,
      MAX_COLOR_BRIGHTNESS,
      formatSignedColorAdjustmentValue
    );
  }

  updateColorContrastFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorContrastInput,
      this.colorContrastValueElement,
      'colorContrast',
      DEFAULT_COLOR_CONTRAST,
      MIN_COLOR_CONTRAST,
      MAX_COLOR_CONTRAST,
      formatColorAdjustmentValue
    );
  }

  updateColorSaturationFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorSaturationInput,
      this.colorSaturationValueElement,
      'colorSaturation',
      DEFAULT_COLOR_SATURATION,
      MIN_COLOR_SATURATION,
      MAX_COLOR_SATURATION,
      formatColorAdjustmentValue
    );
  }

  updateColorGammaFromInput() {
    return this.updateColorCorrectionControlFromInput(
      this.colorGammaInput,
      this.colorGammaValueElement,
      'colorGamma',
      DEFAULT_COLOR_GAMMA,
      MIN_COLOR_GAMMA,
      MAX_COLOR_GAMMA,
      formatColorAdjustmentValue
    );
  }

  updateColorCorrectionFromInputs() {
    const updateActions = [
      () => this.updateColorExposureFromInput(),
      () => this.updateColorBrightnessFromInput(),
      () => this.updateColorContrastFromInput(),
      () => this.updateColorSaturationFromInput(),
      () => this.updateColorGammaFromInput()
    ];

    for (const updateAction of updateActions) {
      const [, updateError] = updateAction();
      if (updateError) {
        return returnFailure(updateError.code, updateError.message, updateError.details);
      }
    }

    return returnSuccess(undefined);
  }

  resetColorCorrection() {
    this.applicationState.colorExposure = DEFAULT_COLOR_EXPOSURE;
    this.applicationState.colorBrightness = DEFAULT_COLOR_BRIGHTNESS;
    this.applicationState.colorContrast = DEFAULT_COLOR_CONTRAST;
    this.applicationState.colorSaturation = DEFAULT_COLOR_SATURATION;
    this.applicationState.colorGamma = DEFAULT_COLOR_GAMMA;

    const syncActions = [
      () => this.syncColorCorrectionControlFromState(
        this.colorExposureInput,
        this.colorExposureValueElement,
        this.applicationState.colorExposure,
        formatSignedColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorBrightnessInput,
        this.colorBrightnessValueElement,
        this.applicationState.colorBrightness,
        formatSignedColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorContrastInput,
        this.colorContrastValueElement,
        this.applicationState.colorContrast,
        formatColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorSaturationInput,
        this.colorSaturationValueElement,
        this.applicationState.colorSaturation,
        formatColorAdjustmentValue
      ),
      () => this.syncColorCorrectionControlFromState(
        this.colorGammaInput,
        this.colorGammaValueElement,
        this.applicationState.colorGamma,
        formatColorAdjustmentValue
      )
    ];

    for (const syncAction of syncActions) {
      const [, syncError] = syncAction();
      if (syncError) {
        return returnFailure(syncError.code, syncError.message, syncError.details);
      }
    }

    return returnSuccess(undefined);
  }

  toggleCameraAutoRotation(toggleButton) {
    this.applicationState.isCameraAutoRotating = !this.applicationState.isCameraAutoRotating;
    const [, buttonError] = updateCameraAutoRotationButton(toggleButton, this.applicationState.isCameraAutoRotating);
    if (buttonError) {
      return returnFailure(buttonError.code, buttonError.message, buttonError.details);
    }
    return this.selectionRenderer.pathTracer.clearSamples();
  }

  cancelActivePointerInteraction() {
    this.applicationState.isPointerDown = false;
    this.applicationState.isRotatingCamera = false;

    if (!this.isMovingSelection) {
      return returnSuccess(undefined);
    }

    const selectedObject = this.selectionRenderer.selectedObject;
    if (selectedObject) {
      const [, resetError] = selectedObject.setTemporaryTranslation(ORIGIN_VECTOR);
      if (resetError) {
        this.isMovingSelection = false;
        return returnFailure(resetError.code, resetError.message, resetError.details);
      }
    }

    this.isMovingSelection = false;
    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  handleCanvasPress(xPosition, yPosition) {
    const originPosition = this.applicationState.eyePosition;
    const rayDirection = this.pointerRayDirection;
    writeEyeRayVector(
      rayDirection,
      this.inverseModelviewProjectionMatrix,
      (xPosition / HALF_CANVAS_SIZE) - 1,
      1 - (yPosition / HALF_CANVAS_SIZE),
      originPosition
    );

    const selectedObject = this.selectionRenderer.selectedObject;
    if (selectedObject) {
      const minBounds = selectedObject.getMinCorner();
      const maxBounds = selectedObject.getMaxCorner();
      const selectionBoxDistance = intersectCube(originPosition, rayDirection, minBounds, maxBounds);

      if (selectionBoxDistance < MAX_INTERSECTION_DISTANCE) {
        const hitPosition = writeAddScaledVec3(this.pointerHitPosition, originPosition, rayDirection, selectionBoxDistance);
        writeMovementNormalFromHit(this.movementNormal, hitPosition, minBounds, maxBounds);
        this.movementDistance = dotVec3(this.movementNormal, hitPosition);
        writeVec3(this.originalHitPosition, hitPosition[0], hitPosition[1], hitPosition[2]);
        this.isMovingSelection = true;
        return returnSuccess(true);
      }
    }

    let closestDistance = MAX_INTERSECTION_DISTANCE;
    let closestObject = null;

    for (const sceneObject of this.sceneObjects) {
      const [objectDistance, objectDistanceError] = sceneObject.intersectRay(originPosition, rayDirection);
      if (objectDistanceError) {
        return returnFailure(objectDistanceError.code, objectDistanceError.message, objectDistanceError.details);
      }

      if (objectDistance < closestDistance) {
        closestDistance = objectDistance;
        closestObject = sceneObject;
      }
    }

    this.selectionRenderer.selectedObject = closestObject;
    return returnSuccess(closestDistance < MAX_INTERSECTION_DISTANCE);
  }

  handleCanvasMove(xPosition, yPosition) {
    if (!this.isMovingSelection || !this.selectionRenderer.selectedObject) {
      return returnSuccess(undefined);
    }

    const [hitPosition, hitError] = this.readMovementPlaneHit(xPosition, yPosition);
    if (hitError) {
      return returnFailure(hitError.code, hitError.message, hitError.details);
    }

    if (!hitPosition) {
      return returnSuccess(undefined);
    }

    writeSubtractVec3(this.pointerTranslation, hitPosition, this.originalHitPosition);
    const [, translateError] = this.selectionRenderer.selectedObject.setTemporaryTranslation(this.pointerTranslation);
    if (translateError) {
      return returnFailure(translateError.code, translateError.message, translateError.details);
    }

    return this.selectionRenderer.pathTracer.clearSamples(false);
  }

  handleCanvasRelease(xPosition, yPosition) {
    if (!this.isMovingSelection || !this.selectionRenderer.selectedObject) {
      this.isMovingSelection = false;
      return returnSuccess(undefined);
    }

    const selectedObject = this.selectionRenderer.selectedObject;
    const [hitPosition, hitError] = this.readMovementPlaneHit(xPosition, yPosition);
    if (hitError) {
      this.isMovingSelection = false;
      return returnFailure(hitError.code, hitError.message, hitError.details);
    }

    const [, resetError] = selectedObject.setTemporaryTranslation(ORIGIN_VECTOR);
    if (resetError) {
      this.isMovingSelection = false;
      return returnFailure(resetError.code, resetError.message, resetError.details);
    }

    if (hitPosition) {
      writeSubtractVec3(this.pointerTranslation, hitPosition, this.originalHitPosition);
      const [, commitError] = selectedObject.commitTranslation(this.pointerTranslation);
      if (commitError) {
        this.isMovingSelection = false;
        return returnFailure(commitError.code, commitError.message, commitError.details);
      }

      const [, physicsError] = this.physicsWorld.rebuildScene(this.sceneObjects, this.applicationState);
      if (physicsError) {
        this.isMovingSelection = false;
        return returnFailure(physicsError.code, physicsError.message, physicsError.details);
      }
    }

    this.isMovingSelection = false;
    return returnSuccess(undefined);
  }

  readMovementPlaneHit(xPosition, yPosition) {
    const originPosition = this.applicationState.eyePosition;
    const rayDirection = this.pointerRayDirection;
    writeEyeRayVector(
      rayDirection,
      this.inverseModelviewProjectionMatrix,
      (xPosition / HALF_CANVAS_SIZE) - 1,
      1 - (yPosition / HALF_CANVAS_SIZE),
      originPosition
    );
    const denominator = dotVec3(this.movementNormal, rayDirection);

    if (Math.abs(denominator) < 0.000001) {
      return returnSuccess(null);
    }

    const hitDistance = (this.movementDistance - dotVec3(this.movementNormal, originPosition)) / denominator;
    return returnSuccess(writeAddScaledVec3(this.pointerHitPosition, originPosition, rayDirection, hitDistance));
  }
}

const writeMovementNormalFromHit = (outputVector, hitPosition, minBounds, maxBounds) => {
  if (Math.abs(hitPosition[0] - minBounds[0]) < 0.001) {
    return writeVec3(outputVector, -1, 0, 0);
  }
  if (Math.abs(hitPosition[0] - maxBounds[0]) < 0.001) {
    return writeVec3(outputVector, 1, 0, 0);
  }
  if (Math.abs(hitPosition[1] - minBounds[1]) < 0.001) {
    return writeVec3(outputVector, 0, -1, 0);
  }
  if (Math.abs(hitPosition[1] - maxBounds[1]) < 0.001) {
    return writeVec3(outputVector, 0, 1, 0);
  }
  if (Math.abs(hitPosition[2] - minBounds[2]) < 0.001) {
    return writeVec3(outputVector, 0, 0, -1);
  }
  return writeVec3(outputVector, 0, 0, 1);
};

const allocateSceneObjectId = (applicationState) => {
  const objectId = applicationState.nextObjectId;
  applicationState.nextObjectId += 1;
  return objectId;
};

const createApplicationState = () => ({
  cameraAngleX: 0,
  cameraAngleY: 0,
  cameraDistance: INITIAL_CAMERA_DISTANCE,
  eyePosition: createVec3(0, 0, 0),
  lightPosition: createVec3(0.4, 0.5, -0.6),
  nextObjectId: 0,
  material: MATERIAL.DIFFUSE,
  glossiness: 0.6,
  environment: ENVIRONMENT.YELLOW_BLUE_CORNELL_BOX,
  lightIntensity: DEFAULT_LIGHT_INTENSITY,
  lightSize: DEFAULT_LIGHT_SIZE,
  fogDensity: DEFAULT_FOG_DENSITY,
  skyBrightness: DEFAULT_SKY_BRIGHTNESS,
  isLightIntensityCycling: false,
  lightIntensityCycleDirection: 1,
  lightBounceCount: DEFAULT_LIGHT_BOUNCE_COUNT,
  raysPerPixel: DEFAULT_RAYS_PER_PIXEL,
  temporalBlendFrames: DEFAULT_TEMPORAL_BLEND_FRAMES,
  colorExposure: DEFAULT_COLOR_EXPOSURE,
  colorBrightness: DEFAULT_COLOR_BRIGHTNESS,
  colorContrast: DEFAULT_COLOR_CONTRAST,
  colorSaturation: DEFAULT_COLOR_SATURATION,
  colorGamma: DEFAULT_COLOR_GAMMA,
  cameraFocusDistance: DEFAULT_CAMERA_FOCUS_DISTANCE,
  cameraAperture: DEFAULT_CAMERA_APERTURE,
  motionBlurStrength: DEFAULT_MOTION_BLUR_STRENGTH,
  denoiserStrength: DEFAULT_DENOISER_STRENGTH,
  bloomStrength: DEFAULT_BLOOM_STRENGTH,
  bloomThreshold: DEFAULT_BLOOM_THRESHOLD,
  glareStrength: DEFAULT_GLARE_STRENGTH,
  isRotatingCamera: false,
  isPickingFocus: false,
  isPointerDown: false,
  isCameraAutoRotating: true,
  cameraAutoRotationSpeed: CAMERA_AUTO_ROTATION_SPEED,
  previousPointerX: 0,
  previousPointerY: 0,
  animationFrameId: 0
});

const updateCameraAutoRotationButton = (toggleButton, isCameraAutoRotating) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Camera playback control is not a button.');
  }

  toggleButton.textContent = isCameraAutoRotating ? 'Pause Camera' : 'Play Camera';
  toggleButton.setAttribute('aria-pressed', isCameraAutoRotating ? 'true' : 'false');
  return returnSuccess(undefined);
};

const updateLightIntensityCycleButton = (toggleButton, isLightIntensityCycling) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Light cycle control is not a button.');
  }

  toggleButton.textContent = isLightIntensityCycling ? 'Stop Light Cycle' : 'Cycle Light';
  toggleButton.setAttribute('aria-pressed', isLightIntensityCycling ? 'true' : 'false');
  return returnSuccess(undefined);
};

const updateFocusPickButton = (toggleButton, isPickingFocus) => {
  if (!(toggleButton instanceof HTMLButtonElement)) {
    return returnFailure('invalid-toggle-button', 'Focus pick control is not a button.');
  }

  toggleButton.textContent = isPickingFocus ? 'Click Focus Target' : 'Pick Focus';
  toggleButton.setAttribute('aria-pressed', isPickingFocus ? 'true' : 'false');
  return returnSuccess(undefined);
};

const advanceCameraAutoRotation = (applicationState, elapsedSeconds, pathTracer) => {
  if (!applicationState.isCameraAutoRotating || applicationState.isRotatingCamera) {
    return returnSuccess(undefined);
  }

  applicationState.cameraAngleY -= applicationState.cameraAutoRotationSpeed * elapsedSeconds;
  pathTracer.clearSamples(false);
  return returnSuccess(undefined);
};

const createSphereObject = (applicationState, x, y, z, radius) => new SphereSceneObject(
  createVec3(x, y, z),
  radius,
  allocateSceneObjectId(applicationState)
);

const createCubeObject = (applicationState, minX, minY, minZ, maxX, maxY, maxZ) => new CubeSceneObject(
  createVec3(minX, minY, minZ),
  createVec3(maxX, maxY, maxZ),
  allocateSceneObjectId(applicationState)
);

const createStacksSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.5, -0.75, -0.5, 0.5, -0.7, 0.5),
  createCubeObject(applicationState, -0.45, -1, -0.45, -0.4, -0.45, -0.4),
  createCubeObject(applicationState, 0.4, -1, -0.45, 0.45, -0.45, -0.4),
  createCubeObject(applicationState, -0.45, -1, 0.4, -0.4, -0.45, 0.45),
  createCubeObject(applicationState, 0.4, -1, 0.4, 0.45, -0.45, 0.45),
  createCubeObject(applicationState, -0.3, -0.5, -0.3, 0.3, -0.45, 0.3),
  createCubeObject(applicationState, -0.25, -0.7, -0.25, -0.2, -0.25, -0.2),
  createCubeObject(applicationState, 0.2, -0.7, -0.25, 0.25, -0.25, -0.2),
  createCubeObject(applicationState, -0.25, -0.7, 0.2, -0.2, -0.25, 0.25),
  createCubeObject(applicationState, 0.2, -0.7, 0.2, 0.25, -0.25, 0.25),
  createCubeObject(applicationState, -0.25, -0.25, -0.25, 0.25, -0.2, 0.25)
]);

const createTableAndChairSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.5, -0.35, -0.5, 0.3, -0.3, 0.5),
  createCubeObject(applicationState, -0.45, -1, -0.45, -0.4, -0.35, -0.4),
  createCubeObject(applicationState, 0.2, -1, -0.45, 0.25, -0.35, -0.4),
  createCubeObject(applicationState, -0.45, -1, 0.4, -0.4, -0.35, 0.45),
  createCubeObject(applicationState, 0.2, -1, 0.4, 0.25, -0.35, 0.45),
  createCubeObject(applicationState, 0.3, -0.6, -0.2, 0.7, -0.55, 0.2),
  createCubeObject(applicationState, 0.3, -1, -0.2, 0.35, -0.6, -0.15),
  createCubeObject(applicationState, 0.3, -1, 0.15, 0.35, -0.6, 0.2),
  createCubeObject(applicationState, 0.65, -1, -0.2, 0.7, 0.1, -0.15),
  createCubeObject(applicationState, 0.65, -1, 0.15, 0.7, 0.1, 0.2),
  createCubeObject(applicationState, 0.65, 0.05, -0.15, 0.7, 0.1, 0.15),
  createCubeObject(applicationState, 0.65, -0.55, -0.09, 0.7, 0.1, -0.03),
  createCubeObject(applicationState, 0.65, -0.55, 0.03, 0.7, 0.1, 0.09),
  createSphereObject(applicationState, -0.1, -0.05, 0, 0.25)
]);

const createSphereAndCubeSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.25, -1, -0.25, 0.25, -0.75, 0.25),
  createSphereObject(applicationState, 0, -0.75, 0, 0.25)
]);

const createSphereColumnSceneObjects = (applicationState) => returnSuccess([
  createSphereObject(applicationState, 0, 0.75, 0, 0.25),
  createSphereObject(applicationState, 0, 0.25, 0, 0.25),
  createSphereObject(applicationState, 0, -0.25, 0, 0.25),
  createSphereObject(applicationState, 0, -0.75, 0, 0.25)
]);

const createCubeAndSpheresSceneObjects = (applicationState) => returnSuccess([
  createCubeObject(applicationState, -0.25, -0.25, -0.25, 0.25, 0.25, 0.25),
  createSphereObject(applicationState, -0.25, 0, 0, 0.25),
  createSphereObject(applicationState, 0.25, 0, 0, 0.25),
  createSphereObject(applicationState, 0, -0.25, 0, 0.25),
  createSphereObject(applicationState, 0, 0.25, 0, 0.25),
  createSphereObject(applicationState, 0, 0, -0.25, 0.25),
  createSphereObject(applicationState, 0, 0, 0.25, 0.25)
]);

const createSpherePyramidSceneObjects = (applicationState) => {
  const root3Over4 = 0.433012701892219;
  const root3Over6 = 0.288675134594813;
  const root6Over6 = 0.408248290463863;

  return returnSuccess([
    createSphereObject(applicationState, -0.5, -0.75, -root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75, -root3Over6, 0.25),
    createSphereObject(applicationState, 0.5, -0.75, -root3Over6, 0.25),
    createSphereObject(applicationState, -0.25, -0.75, root3Over4 - root3Over6, 0.25),
    createSphereObject(applicationState, 0.25, -0.75, root3Over4 - root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75, 2 * root3Over4 - root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75 + root6Over6, root3Over6, 0.25),
    createSphereObject(applicationState, -0.25, -0.75 + root6Over6, -0.5 * root3Over6, 0.25),
    createSphereObject(applicationState, 0.25, -0.75 + root6Over6, -0.5 * root3Over6, 0.25),
    createSphereObject(applicationState, 0, -0.75 + 2 * root6Over6, 0, 0.25)
  ]);
};

const addRecursiveSpheresBranch = (sceneObjects, applicationState, centerPosition, radius, depth, direction) => {
  sceneObjects.push(new SphereSceneObject(centerPosition, radius, allocateSceneObjectId(applicationState)));

  if (depth <= 0) {
    return returnSuccess(undefined);
  }

  const nextDepth = depth - 1;
  const offset = radius * 1.5;
  const branchSpecs = [
    [RECURSIVE_SPHERE_DIRECTION.X_NEGATIVE, RECURSIVE_SPHERE_DIRECTION.X_POSITIVE, createVec3(-offset, 0, 0)],
    [RECURSIVE_SPHERE_DIRECTION.X_POSITIVE, RECURSIVE_SPHERE_DIRECTION.X_NEGATIVE, createVec3(offset, 0, 0)],
    [RECURSIVE_SPHERE_DIRECTION.Y_NEGATIVE, RECURSIVE_SPHERE_DIRECTION.Y_POSITIVE, createVec3(0, -offset, 0)],
    [RECURSIVE_SPHERE_DIRECTION.Y_POSITIVE, RECURSIVE_SPHERE_DIRECTION.Y_NEGATIVE, createVec3(0, offset, 0)],
    [RECURSIVE_SPHERE_DIRECTION.Z_NEGATIVE, RECURSIVE_SPHERE_DIRECTION.Z_POSITIVE, createVec3(0, 0, -offset)],
    [RECURSIVE_SPHERE_DIRECTION.Z_POSITIVE, RECURSIVE_SPHERE_DIRECTION.Z_NEGATIVE, createVec3(0, 0, offset)]
  ];

  for (const [blockedDirection, nextDirection, translationVector] of branchSpecs) {
    if (direction === blockedDirection) {
      continue;
    }

    const [, branchError] = addRecursiveSpheresBranch(
      sceneObjects,
      applicationState,
      addVec3(centerPosition, translationVector),
      radius / 2,
      nextDepth,
      nextDirection
    );
    if (branchError) {
      return returnFailure(branchError.code, branchError.message, branchError.details);
    }
  }

  return returnSuccess(undefined);
};

const createRecursiveSpheresSceneObjects = (applicationState) => {
  const sceneObjects = [];
  const [, branchError] = addRecursiveSpheresBranch(sceneObjects, applicationState, createVec3(0, 0, 0), 0.3, 2, -1);
  if (branchError) {
    return returnFailure(branchError.code, branchError.message, branchError.details);
  }
  return returnSuccess(sceneObjects);
};

const scenePresetFactories = Object.freeze({
  sphereColumn: createSphereColumnSceneObjects,
  spherePyramid: createSpherePyramidSceneObjects,
  sphereAndCube: createSphereAndCubeSceneObjects,
  cubeAndSpheres: createCubeAndSpheresSceneObjects,
  tableAndChair: createTableAndChairSceneObjects,
  stacks: createStacksSceneObjects,
  recursiveSpheres: createRecursiveSpheresSceneObjects
});

const readRequiredElement = (documentObject, elementId) => {
  const element = documentObject.getElementById(elementId);
  if (!element) {
    return returnFailure('missing-dom-element', `Required element "${elementId}" was not found.`);
  }
  return returnSuccess(element);
};

const readOptionalElement = (documentObject, elementId) => documentObject.getElementById(elementId);

const readRequiredInput = (documentObject, elementId) => {
  const [element, elementError] = readRequiredElement(documentObject, elementId);
  if (elementError) {
    return returnFailure(elementError.code, elementError.message, elementError.details);
  }

  if (!(element instanceof HTMLInputElement)) {
    return returnFailure('invalid-input-element', `Element "${elementId}" is not an input.`);
  }
  return returnSuccess(element);
};

const readRequiredButton = (documentObject, elementId) => {
  const [element, elementError] = readRequiredElement(documentObject, elementId);
  if (elementError) {
    return returnFailure(elementError.code, elementError.message, elementError.details);
  }

  if (!(element instanceof HTMLButtonElement)) {
    return returnFailure('invalid-button-element', `Element "${elementId}" is not a button.`);
  }
  return returnSuccess(element);
};

const readRequiredCanvas = (documentObject, elementId) => {
  const [element, elementError] = readRequiredElement(documentObject, elementId);
  if (elementError) {
    return returnFailure(elementError.code, elementError.message, elementError.details);
  }

  if (!(element instanceof HTMLCanvasElement)) {
    return returnFailure('invalid-canvas-element', `Element "${elementId}" is not a canvas.`);
  }

  return returnSuccess(element);
};

const createWebGlContext = (canvasElement) => {
  const webGlContext = (
    canvasElement.getContext('webgl', HIGH_PERFORMANCE_WEBGL_CONTEXT_ATTRIBUTES) ||
    canvasElement.getContext('experimental-webgl', HIGH_PERFORMANCE_WEBGL_CONTEXT_ATTRIBUTES)
  );
  if (!webGlContext) {
    return returnFailure(
      'webgl-unavailable',
      'Your browser does not support WebGL.',
      'Please see https://get.webgl.org/get-a-webgl-implementation/'
    );
  }

  return returnSuccess(webGlContext);
};

const readWebGlStringParameter = (webGlContext, parameterName) => {
  const value = webGlContext.getParameter(parameterName);
  return typeof value === 'string' ? value : '';
};

const readWebGlPowerPreference = (webGlContext) => {
  if (typeof webGlContext.getContextAttributes !== 'function') {
    return WEBGL_POWER_PREFERENCE;
  }

  const contextAttributes = webGlContext.getContextAttributes();
  if (!contextAttributes || !contextAttributes.powerPreference) {
    return WEBGL_POWER_PREFERENCE;
  }

  return contextAttributes.powerPreference;
};

const readWebGlGpuInfo = (webGlContext) => {
  const debugRendererInfo = webGlContext.getExtension('WEBGL_debug_renderer_info');
  const vendorParameter = debugRendererInfo
    ? debugRendererInfo.UNMASKED_VENDOR_WEBGL
    : webGlContext.VENDOR;
  const rendererParameter = debugRendererInfo
    ? debugRendererInfo.UNMASKED_RENDERER_WEBGL
    : webGlContext.RENDERER;

  return Object.freeze({
    vendor: readWebGlStringParameter(webGlContext, vendorParameter),
    renderer: readWebGlStringParameter(webGlContext, rendererParameter),
    powerPreference: readWebGlPowerPreference(webGlContext),
    hasDebugRendererInfo: Boolean(debugRendererInfo)
  });
};

const isPreferredGpuRenderer = (gpuInfo) => {
  const searchableGpuText = `${gpuInfo.vendor} ${gpuInfo.renderer}`;
  return PREFERRED_GPU_RENDERER_PATTERNS.some((pattern) => pattern.test(searchableGpuText));
};

const updateGpuStatus = (documentObject, webGlContext) => {
  const gpuInfo = readWebGlGpuInfo(webGlContext);
  const gpuStatusElement = readOptionalElement(documentObject, 'gpu-status');
  const gpuRendererElement = readOptionalElement(documentObject, 'gpu-renderer');
  if (!gpuStatusElement || !gpuRendererElement) {
    return returnSuccess(gpuInfo);
  }

  const rendererLabel = gpuInfo.renderer || 'Renderer hidden by browser';
  const isPreferredRenderer = isPreferredGpuRenderer(gpuInfo);
  const isB580Renderer = /\bB580\b/i.test(`${gpuInfo.vendor} ${gpuInfo.renderer}`);
  const statusPrefix = isB580Renderer
    ? 'B580 active'
    : (isPreferredRenderer ? 'Arc GPU active' : 'High-performance requested');

  gpuRendererElement.textContent = `${statusPrefix}: ${rendererLabel}`;
  gpuStatusElement.classList.toggle('is-preferred', isPreferredRenderer);
  gpuStatusElement.classList.toggle('is-fallback', !isPreferredRenderer);
  gpuStatusElement.title = [
    `Vendor: ${gpuInfo.vendor || 'Unknown'}`,
    `Renderer: ${rendererLabel}`,
    `WebGL power preference: ${gpuInfo.powerPreference}`,
    gpuInfo.hasDebugRendererInfo ? 'Unmasked renderer info available' : 'Renderer details are masked by the browser'
  ].join('\n');

  console.info('Path tracing GPU', gpuInfo);
  return returnSuccess(gpuInfo);
};

const displayError = (errorElement, errorValue) => {
  errorElement.style.zIndex = '1';
  errorElement.textContent = errorValue.details
    ? `${errorValue.message} ${errorValue.details}`
    : errorValue.message;
  return returnSuccess(undefined);
};

const hideError = (errorElement) => {
  errorElement.style.zIndex = '-1';
  return returnSuccess(undefined);
};

const readCanvasPointerPosition = (canvasElement, event) => {
  const canvasBounds = canvasElement.getBoundingClientRect();
  return returnSuccess({
    x: (event.clientX - canvasBounds.left) * (canvasElement.width / canvasBounds.width),
    y: (event.clientY - canvasBounds.top) * (canvasElement.height / canvasBounds.height)
  });
};

const isPointerInsideCanvas = (pointerPosition) => (
  pointerPosition.x >= 0 &&
  pointerPosition.x < CANVAS_SIZE &&
  pointerPosition.y >= 0 &&
  pointerPosition.y < CANVAS_SIZE
);

const isTextInputFocused = (documentObject) => {
  const activeElement = documentObject.activeElement;
  if (!activeElement) {
    return false;
  }

  const tagName = activeElement.tagName;
  return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA';
};

const runAndDisplayError = (errorElement, action) => {
  const [, actionError] = action();
  if (actionError) {
    return displayError(errorElement, actionError);
  }
  return returnSuccess(undefined);
};

const attachInputHandlers = (documentObject, canvasElement, errorElement, uiController) => {
  const applicationState = uiController.applicationState;
  const windowObject = documentObject.defaultView;

  canvasElement.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    applicationState.isPointerDown = true;
    applicationState.previousPointerX = pointerPosition.x;
    applicationState.previousPointerY = pointerPosition.y;

    if (!isPointerInsideCanvas(pointerPosition)) {
      applicationState.isPointerDown = false;
      return returnSuccess(undefined);
    }

    if (applicationState.isPickingFocus) {
      const [, focusPickError] = uiController.handleFocusPick(pointerPosition.x, pointerPosition.y);
      if (focusPickError) {
        displayError(errorElement, focusPickError);
      }
      event.preventDefault();
      return returnSuccess(undefined);
    }

    const [didSelectObject, selectError] = uiController.handleCanvasPress(pointerPosition.x, pointerPosition.y);
    if (selectError) {
      displayError(errorElement, selectError);
      return returnSuccess(undefined);
    }

    applicationState.isRotatingCamera = !didSelectObject;
    event.preventDefault();
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('mousemove', (event) => {
    if ((applicationState.isRotatingCamera || uiController.isMovingSelection) && event.buttons === 0) {
      const [, cancelError] = uiController.cancelActivePointerInteraction();
      if (cancelError) {
        displayError(errorElement, cancelError);
      }
      return returnSuccess(undefined);
    }

    if (!applicationState.isRotatingCamera && !uiController.isMovingSelection) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    if (applicationState.isRotatingCamera) {
      applicationState.cameraAngleY -= (pointerPosition.x - applicationState.previousPointerX) * CAMERA_ROTATION_SPEED;
      applicationState.cameraAngleX += (pointerPosition.y - applicationState.previousPointerY) * CAMERA_ROTATION_SPEED;
      applicationState.cameraAngleX = clampNumber(
        applicationState.cameraAngleX,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01
      );
      applicationState.previousPointerX = pointerPosition.x;
      applicationState.previousPointerY = pointerPosition.y;
      const [, clearError] = uiController.selectionRenderer.pathTracer.clearSamples(false);
      if (clearError) {
        displayError(errorElement, clearError);
      }
      return returnSuccess(undefined);
    }

    const [, moveError] = uiController.handleCanvasMove(pointerPosition.x, pointerPosition.y);
    if (moveError) {
      displayError(errorElement, moveError);
    }
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('mouseup', (event) => {
    const wasMovingSelection = uiController.isMovingSelection;
    applicationState.isPointerDown = false;
    applicationState.isRotatingCamera = false;

    if (!wasMovingSelection) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    const [, releaseError] = uiController.handleCanvasRelease(pointerPosition.x, pointerPosition.y);
    if (releaseError) {
      displayError(errorElement, releaseError);
    }
    return returnSuccess(undefined);
  });

  documentObject.addEventListener('mouseleave', (event) => {
    if (event.buttons !== 0) {
      return returnSuccess(undefined);
    }

    const [, cancelError] = uiController.cancelActivePointerInteraction();
    if (cancelError) {
      displayError(errorElement, cancelError);
    }
    return returnSuccess(undefined);
  });

  if (windowObject) {
    windowObject.addEventListener('blur', () => {
      const [, cancelError] = uiController.cancelActivePointerInteraction();
      if (cancelError) {
        displayError(errorElement, cancelError);
      }
      return returnSuccess(undefined);
    });
  }

  documentObject.addEventListener('keydown', (event) => {
    if (isTextInputFocused(documentObject)) {
      return returnSuccess(undefined);
    }

    if (event.key === 'Escape' && applicationState.isPickingFocus) {
      applicationState.isPickingFocus = false;
      const [, focusPickError] = uiController.syncFocusPickMode();
      if (focusPickError) {
        displayError(errorElement, focusPickError);
      }
      event.preventDefault();
      return returnSuccess(undefined);
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      const [, deleteError] = uiController.deleteSelection();
      if (deleteError) {
        displayError(errorElement, deleteError);
      }
      event.preventDefault();
    }
    return returnSuccess(undefined);
  });

  canvasElement.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) {
      applicationState.isPointerDown = false;
      applicationState.isRotatingCamera = false;
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event.touches[0]);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    applicationState.isPointerDown = true;
    applicationState.previousPointerX = pointerPosition.x;
    applicationState.previousPointerY = pointerPosition.y;

    if (applicationState.isPickingFocus) {
      const [, focusPickError] = uiController.handleFocusPick(pointerPosition.x, pointerPosition.y);
      if (focusPickError) {
        displayError(errorElement, focusPickError);
      }
      event.preventDefault();
      return returnSuccess(undefined);
    }

    applicationState.isRotatingCamera = true;
    event.preventDefault();
    return returnSuccess(undefined);
  }, { passive: false });

  canvasElement.addEventListener('touchmove', (event) => {
    if (!applicationState.isRotatingCamera || event.touches.length !== 1) {
      return returnSuccess(undefined);
    }

    const [pointerPosition, pointerError] = readCanvasPointerPosition(canvasElement, event.touches[0]);
    if (pointerError) {
      displayError(errorElement, pointerError);
      return returnSuccess(undefined);
    }

    applicationState.cameraAngleY -= (pointerPosition.x - applicationState.previousPointerX) * CAMERA_ROTATION_SPEED;
    applicationState.cameraAngleX += (pointerPosition.y - applicationState.previousPointerY) * CAMERA_ROTATION_SPEED;
    applicationState.cameraAngleX = clampNumber(
      applicationState.cameraAngleX,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01
    );
    applicationState.previousPointerX = pointerPosition.x;
    applicationState.previousPointerY = pointerPosition.y;
    const [, clearError] = uiController.selectionRenderer.pathTracer.clearSamples(false);
    if (clearError) {
      displayError(errorElement, clearError);
    }
    event.preventDefault();
    return returnSuccess(undefined);
  }, { passive: false });

  canvasElement.addEventListener('touchend', () => {
    return uiController.cancelActivePointerInteraction();
  }, { passive: false });

  canvasElement.addEventListener('touchcancel', () => {
    return uiController.cancelActivePointerInteraction();
  }, { passive: false });

  return returnSuccess(undefined);
};

const attachControlHandlers = (controlsElement, errorElement, uiController) => {
  controlsElement.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLButtonElement)) {
      return returnSuccess(undefined);
    }

    const actionName = event.target.dataset.action;
    const presetName = event.target.dataset.preset;

    if (actionName === 'select-light') {
      return runAndDisplayError(errorElement, () => uiController.selectLight());
    }
    if (actionName === 'add-sphere') {
      return runAndDisplayError(errorElement, () => uiController.addSphere());
    }
    if (actionName === 'add-cube') {
      return runAndDisplayError(errorElement, () => uiController.addCube());
    }
    if (actionName === 'toggle-camera-playback') {
      return runAndDisplayError(errorElement, () => uiController.toggleCameraAutoRotation(event.target));
    }
    if (actionName === 'toggle-light-cycle') {
      return runAndDisplayError(errorElement, () => uiController.toggleLightIntensityCycle(event.target));
    }
    if (actionName === 'toggle-focus-pick') {
      return runAndDisplayError(errorElement, () => uiController.toggleFocusPickMode());
    }
    if (actionName === 'reset-color-correction') {
      return runAndDisplayError(errorElement, () => uiController.resetColorCorrection());
    }
    if (presetName) {
      const presetFactory = scenePresetFactories[presetName];
      if (!presetFactory) {
        return displayError(errorElement, Object.freeze({
          code: 'unknown-preset',
          message: `Preset "${presetName}" is not available.`,
          details: null
        }));
      }

      const [sceneObjects, presetError] = presetFactory(uiController.applicationState);
      if (presetError) {
        return displayError(errorElement, presetError);
      }

      const [, sceneError] = uiController.setSceneObjects(sceneObjects);
      if (sceneError) {
        return displayError(errorElement, sceneError);
      }
    }

    return returnSuccess(undefined);
  });

  uiController.materialSelect.addEventListener('change', () => (
    runAndDisplayError(errorElement, () => uiController.updateMaterialFromSelect())
  ));

  uiController.environmentSelect.addEventListener('change', () => (
    runAndDisplayError(errorElement, () => uiController.updateEnvironmentFromSelect())
  ));

  uiController.glossinessInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateGlossinessFromInput())
  ));

  uiController.lightBounceInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateLightBounceCountFromInput())
  ));

  uiController.lightSizeInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateLightSizeFromInput())
  ));

  uiController.fogDensityInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateFogDensityFromInput())
  ));

  uiController.skyBrightnessInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateSkyBrightnessFromInput())
  ));

  uiController.raysPerPixelInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateRaysPerPixelFromInput())
  ));

  uiController.temporalBlendFramesInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateTemporalBlendFramesFromInput())
  ));

  uiController.denoiserStrengthInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateDenoiserStrengthFromInput())
  ));

  uiController.cameraFocusDistanceInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateCameraFocusDistanceFromInput())
  ));

  uiController.cameraApertureInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateCameraApertureFromInput())
  ));

  uiController.motionBlurInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateMotionBlurFromInput())
  ));

  uiController.colorExposureInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorExposureFromInput())
  ));

  uiController.colorBrightnessInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorBrightnessFromInput())
  ));

  uiController.colorContrastInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorContrastFromInput())
  ));

  uiController.colorSaturationInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorSaturationFromInput())
  ));

  uiController.colorGammaInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateColorGammaFromInput())
  ));

  uiController.bloomStrengthInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateBloomStrengthFromInput())
  ));

  uiController.bloomThresholdInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateBloomThresholdFromInput())
  ));

  uiController.glareStrengthInput.addEventListener('input', () => (
    runAndDisplayError(errorElement, () => uiController.updateGlareStrengthFromInput())
  ));

  return returnSuccess(undefined);
};

const createPathTracingApplication = async (documentObject) => {
  const [canvasElement, canvasError] = readRequiredCanvas(documentObject, 'canvas');
  if (canvasError) {
    return returnFailure(canvasError.code, canvasError.message, canvasError.details);
  }

  const [errorElement, errorElementError] = readRequiredElement(documentObject, 'error');
  if (errorElementError) {
    return returnFailure(errorElementError.code, errorElementError.message, errorElementError.details);
  }

  const [controlsElement, controlsElementError] = readRequiredElement(documentObject, 'controls');
  if (controlsElementError) {
    return returnFailure(controlsElementError.code, controlsElementError.message, controlsElementError.details);
  }

  const [glossinessContainer, glossinessContainerError] = readRequiredElement(documentObject, 'glossiness-factor');
  if (glossinessContainerError) {
    return returnFailure(glossinessContainerError.code, glossinessContainerError.message, glossinessContainerError.details);
  }

  const [materialSelect, materialSelectError] = readRequiredElement(documentObject, 'material');
  if (materialSelectError) {
    return returnFailure(materialSelectError.code, materialSelectError.message, materialSelectError.details);
  }

  const [environmentSelect, environmentSelectError] = readRequiredElement(documentObject, 'environment');
  if (environmentSelectError) {
    return returnFailure(environmentSelectError.code, environmentSelectError.message, environmentSelectError.details);
  }

  const [glossinessInput, glossinessInputError] = readRequiredInput(documentObject, 'glossiness');
  if (glossinessInputError) {
    return returnFailure(glossinessInputError.code, glossinessInputError.message, glossinessInputError.details);
  }

  const [lightBounceInput, lightBounceInputError] = readRequiredInput(documentObject, 'light-bounces');
  if (lightBounceInputError) {
    return returnFailure(lightBounceInputError.code, lightBounceInputError.message, lightBounceInputError.details);
  }

  const [lightBounceValueElement, lightBounceValueError] = readRequiredElement(documentObject, 'light-bounces-value');
  if (lightBounceValueError) {
    return returnFailure(lightBounceValueError.code, lightBounceValueError.message, lightBounceValueError.details);
  }

  const [lightIntensityValueElement, lightIntensityValueError] = readRequiredElement(documentObject, 'light-intensity-value');
  if (lightIntensityValueError) {
    return returnFailure(lightIntensityValueError.code, lightIntensityValueError.message, lightIntensityValueError.details);
  }

  const [lightSizeInput, lightSizeInputError] = readRequiredInput(documentObject, 'light-size');
  if (lightSizeInputError) {
    return returnFailure(lightSizeInputError.code, lightSizeInputError.message, lightSizeInputError.details);
  }

  const [lightSizeValueElement, lightSizeValueError] = readRequiredElement(documentObject, 'light-size-value');
  if (lightSizeValueError) {
    return returnFailure(lightSizeValueError.code, lightSizeValueError.message, lightSizeValueError.details);
  }

  const [fogDensityInput, fogDensityInputError] = readRequiredInput(documentObject, 'fog-density');
  if (fogDensityInputError) {
    return returnFailure(fogDensityInputError.code, fogDensityInputError.message, fogDensityInputError.details);
  }

  const [fogDensityValueElement, fogDensityValueError] = readRequiredElement(documentObject, 'fog-density-value');
  if (fogDensityValueError) {
    return returnFailure(fogDensityValueError.code, fogDensityValueError.message, fogDensityValueError.details);
  }

  const [skyBrightnessInput, skyBrightnessInputError] = readRequiredInput(documentObject, 'sky-brightness');
  if (skyBrightnessInputError) {
    return returnFailure(skyBrightnessInputError.code, skyBrightnessInputError.message, skyBrightnessInputError.details);
  }

  const [skyBrightnessValueElement, skyBrightnessValueError] = readRequiredElement(documentObject, 'sky-brightness-value');
  if (skyBrightnessValueError) {
    return returnFailure(skyBrightnessValueError.code, skyBrightnessValueError.message, skyBrightnessValueError.details);
  }

  const [raysPerPixelInput, raysPerPixelInputError] = readRequiredInput(documentObject, 'rays-per-pixel');
  if (raysPerPixelInputError) {
    return returnFailure(raysPerPixelInputError.code, raysPerPixelInputError.message, raysPerPixelInputError.details);
  }

  const [raysPerPixelValueElement, raysPerPixelValueError] = readRequiredElement(documentObject, 'rays-per-pixel-value');
  if (raysPerPixelValueError) {
    return returnFailure(raysPerPixelValueError.code, raysPerPixelValueError.message, raysPerPixelValueError.details);
  }

  const [temporalBlendFramesInput, temporalBlendFramesInputError] = readRequiredInput(documentObject, 'temporal-blend-frames');
  if (temporalBlendFramesInputError) {
    return returnFailure(
      temporalBlendFramesInputError.code,
      temporalBlendFramesInputError.message,
      temporalBlendFramesInputError.details
    );
  }

  const [temporalBlendFramesValueElement, temporalBlendFramesValueError] = readRequiredElement(
    documentObject,
    'temporal-blend-frames-value'
  );
  if (temporalBlendFramesValueError) {
    return returnFailure(
      temporalBlendFramesValueError.code,
      temporalBlendFramesValueError.message,
      temporalBlendFramesValueError.details
    );
  }

  const [denoiserStrengthInput, denoiserStrengthInputError] = readRequiredInput(documentObject, 'denoiser-strength');
  if (denoiserStrengthInputError) {
    return returnFailure(denoiserStrengthInputError.code, denoiserStrengthInputError.message, denoiserStrengthInputError.details);
  }

  const [denoiserStrengthValueElement, denoiserStrengthValueError] = readRequiredElement(
    documentObject,
    'denoiser-strength-value'
  );
  if (denoiserStrengthValueError) {
    return returnFailure(denoiserStrengthValueError.code, denoiserStrengthValueError.message, denoiserStrengthValueError.details);
  }

  const [focusPickButton, focusPickButtonError] = readRequiredButton(documentObject, 'focus-pick');
  if (focusPickButtonError) {
    return returnFailure(focusPickButtonError.code, focusPickButtonError.message, focusPickButtonError.details);
  }

  const [cameraFocusDistanceInput, cameraFocusDistanceInputError] = readRequiredInput(
    documentObject,
    'camera-focus-distance'
  );
  if (cameraFocusDistanceInputError) {
    return returnFailure(
      cameraFocusDistanceInputError.code,
      cameraFocusDistanceInputError.message,
      cameraFocusDistanceInputError.details
    );
  }

  const [cameraFocusDistanceValueElement, cameraFocusDistanceValueError] = readRequiredElement(
    documentObject,
    'camera-focus-distance-value'
  );
  if (cameraFocusDistanceValueError) {
    return returnFailure(
      cameraFocusDistanceValueError.code,
      cameraFocusDistanceValueError.message,
      cameraFocusDistanceValueError.details
    );
  }

  const [cameraApertureInput, cameraApertureInputError] = readRequiredInput(documentObject, 'camera-aperture');
  if (cameraApertureInputError) {
    return returnFailure(cameraApertureInputError.code, cameraApertureInputError.message, cameraApertureInputError.details);
  }

  const [cameraApertureValueElement, cameraApertureValueError] = readRequiredElement(
    documentObject,
    'camera-aperture-value'
  );
  if (cameraApertureValueError) {
    return returnFailure(cameraApertureValueError.code, cameraApertureValueError.message, cameraApertureValueError.details);
  }

  const [motionBlurInput, motionBlurInputError] = readRequiredInput(documentObject, 'motion-blur');
  if (motionBlurInputError) {
    return returnFailure(motionBlurInputError.code, motionBlurInputError.message, motionBlurInputError.details);
  }

  const [motionBlurValueElement, motionBlurValueError] = readRequiredElement(documentObject, 'motion-blur-value');
  if (motionBlurValueError) {
    return returnFailure(motionBlurValueError.code, motionBlurValueError.message, motionBlurValueError.details);
  }

  const [colorExposureInput, colorExposureInputError] = readRequiredInput(documentObject, 'color-exposure');
  if (colorExposureInputError) {
    return returnFailure(colorExposureInputError.code, colorExposureInputError.message, colorExposureInputError.details);
  }

  const [colorExposureValueElement, colorExposureValueError] = readRequiredElement(documentObject, 'color-exposure-value');
  if (colorExposureValueError) {
    return returnFailure(colorExposureValueError.code, colorExposureValueError.message, colorExposureValueError.details);
  }

  const [colorBrightnessInput, colorBrightnessInputError] = readRequiredInput(documentObject, 'color-brightness');
  if (colorBrightnessInputError) {
    return returnFailure(
      colorBrightnessInputError.code,
      colorBrightnessInputError.message,
      colorBrightnessInputError.details
    );
  }

  const [colorBrightnessValueElement, colorBrightnessValueError] = readRequiredElement(
    documentObject,
    'color-brightness-value'
  );
  if (colorBrightnessValueError) {
    return returnFailure(
      colorBrightnessValueError.code,
      colorBrightnessValueError.message,
      colorBrightnessValueError.details
    );
  }

  const [colorContrastInput, colorContrastInputError] = readRequiredInput(documentObject, 'color-contrast');
  if (colorContrastInputError) {
    return returnFailure(colorContrastInputError.code, colorContrastInputError.message, colorContrastInputError.details);
  }

  const [colorContrastValueElement, colorContrastValueError] = readRequiredElement(documentObject, 'color-contrast-value');
  if (colorContrastValueError) {
    return returnFailure(colorContrastValueError.code, colorContrastValueError.message, colorContrastValueError.details);
  }

  const [colorSaturationInput, colorSaturationInputError] = readRequiredInput(documentObject, 'color-saturation');
  if (colorSaturationInputError) {
    return returnFailure(
      colorSaturationInputError.code,
      colorSaturationInputError.message,
      colorSaturationInputError.details
    );
  }

  const [colorSaturationValueElement, colorSaturationValueError] = readRequiredElement(
    documentObject,
    'color-saturation-value'
  );
  if (colorSaturationValueError) {
    return returnFailure(
      colorSaturationValueError.code,
      colorSaturationValueError.message,
      colorSaturationValueError.details
    );
  }

  const [colorGammaInput, colorGammaInputError] = readRequiredInput(documentObject, 'color-gamma');
  if (colorGammaInputError) {
    return returnFailure(colorGammaInputError.code, colorGammaInputError.message, colorGammaInputError.details);
  }

  const [colorGammaValueElement, colorGammaValueError] = readRequiredElement(documentObject, 'color-gamma-value');
  if (colorGammaValueError) {
    return returnFailure(colorGammaValueError.code, colorGammaValueError.message, colorGammaValueError.details);
  }

  const [bloomStrengthInput, bloomStrengthInputError] = readRequiredInput(documentObject, 'bloom-strength');
  if (bloomStrengthInputError) {
    return returnFailure(bloomStrengthInputError.code, bloomStrengthInputError.message, bloomStrengthInputError.details);
  }

  const [bloomStrengthValueElement, bloomStrengthValueError] = readRequiredElement(documentObject, 'bloom-strength-value');
  if (bloomStrengthValueError) {
    return returnFailure(bloomStrengthValueError.code, bloomStrengthValueError.message, bloomStrengthValueError.details);
  }

  const [bloomThresholdInput, bloomThresholdInputError] = readRequiredInput(documentObject, 'bloom-threshold');
  if (bloomThresholdInputError) {
    return returnFailure(bloomThresholdInputError.code, bloomThresholdInputError.message, bloomThresholdInputError.details);
  }

  const [bloomThresholdValueElement, bloomThresholdValueError] = readRequiredElement(documentObject, 'bloom-threshold-value');
  if (bloomThresholdValueError) {
    return returnFailure(bloomThresholdValueError.code, bloomThresholdValueError.message, bloomThresholdValueError.details);
  }

  const [glareStrengthInput, glareStrengthInputError] = readRequiredInput(documentObject, 'glare-strength');
  if (glareStrengthInputError) {
    return returnFailure(glareStrengthInputError.code, glareStrengthInputError.message, glareStrengthInputError.details);
  }

  const [glareStrengthValueElement, glareStrengthValueError] = readRequiredElement(documentObject, 'glare-strength-value');
  if (glareStrengthValueError) {
    return returnFailure(glareStrengthValueError.code, glareStrengthValueError.message, glareStrengthValueError.details);
  }

  const [webGlContext, webGlContextError] = createWebGlContext(canvasElement);
  if (webGlContextError) {
    displayError(errorElement, webGlContextError);
    return returnFailure(webGlContextError.code, webGlContextError.message, webGlContextError.details);
  }
  const [gpuInfo] = updateGpuStatus(documentObject, webGlContext);

  errorElement.textContent = 'Loading...';

  const [rapierRuntime, rapierError] = await createRapierRuntime();
  if (rapierError) {
    return returnFailure(rapierError.code, rapierError.message, rapierError.details);
  }

  const [physicsWorld, physicsWorldError] = createRapierPhysicsWorld(rapierRuntime);
  if (physicsWorldError) {
    return returnFailure(physicsWorldError.code, physicsWorldError.message, physicsWorldError.details);
  }

  const applicationState = createApplicationState();
  applicationState.material = Number.parseInt(materialSelect.value, 10);
  applicationState.environment = Number.parseInt(environmentSelect.value, 10);
  lightIntensityValueElement.textContent = formatLightIntensityValue(applicationState.lightIntensity);
  const [lightBounceCount, lightBounceCountError] = parseBoundedInteger(
    lightBounceInput.value,
    DEFAULT_LIGHT_BOUNCE_COUNT,
    MIN_LIGHT_BOUNCE_COUNT,
    MAX_LIGHT_BOUNCE_COUNT
  );
  if (lightBounceCountError) {
    return returnFailure(lightBounceCountError.code, lightBounceCountError.message, lightBounceCountError.details);
  }
  applicationState.lightBounceCount = lightBounceCount;
  lightBounceInput.value = String(lightBounceCount);
  lightBounceValueElement.textContent = String(lightBounceCount);

  const [raysPerPixel, raysPerPixelError] = parseBoundedInteger(
    raysPerPixelInput.value,
    DEFAULT_RAYS_PER_PIXEL,
    MIN_RAYS_PER_PIXEL,
    MAX_RAYS_PER_PIXEL
  );
  if (raysPerPixelError) {
    return returnFailure(raysPerPixelError.code, raysPerPixelError.message, raysPerPixelError.details);
  }
  applicationState.raysPerPixel = raysPerPixel;
  raysPerPixelInput.value = String(raysPerPixel);
  raysPerPixelValueElement.textContent = String(raysPerPixel);

  const [temporalBlendFrames, temporalBlendFramesError] = parseBoundedInteger(
    temporalBlendFramesInput.value,
    DEFAULT_TEMPORAL_BLEND_FRAMES,
    MIN_TEMPORAL_BLEND_FRAMES,
    MAX_TEMPORAL_BLEND_FRAMES
  );
  if (temporalBlendFramesError) {
    return returnFailure(
      temporalBlendFramesError.code,
      temporalBlendFramesError.message,
      temporalBlendFramesError.details
    );
  }
  applicationState.temporalBlendFrames = temporalBlendFrames;
  temporalBlendFramesInput.value = String(temporalBlendFrames);
  temporalBlendFramesValueElement.textContent = String(temporalBlendFrames);

  const [selectionRenderer, rendererError] = SelectionRenderer.create(webGlContext);
  if (rendererError) {
    return returnFailure(rendererError.code, rendererError.message, rendererError.details);
  }

  const uiController = new UserInterfaceController(
    selectionRenderer,
    physicsWorld,
    applicationState,
    canvasElement,
    focusPickButton,
    glossinessContainer,
    materialSelect,
    environmentSelect,
    glossinessInput,
    lightBounceInput,
    lightBounceValueElement,
    lightIntensityValueElement,
    lightSizeInput,
    lightSizeValueElement,
    fogDensityInput,
    fogDensityValueElement,
    skyBrightnessInput,
    skyBrightnessValueElement,
    raysPerPixelInput,
    raysPerPixelValueElement,
    temporalBlendFramesInput,
    temporalBlendFramesValueElement,
    denoiserStrengthInput,
    denoiserStrengthValueElement,
    colorExposureInput,
    colorExposureValueElement,
    colorBrightnessInput,
    colorBrightnessValueElement,
    colorContrastInput,
    colorContrastValueElement,
    colorSaturationInput,
    colorSaturationValueElement,
    colorGammaInput,
    colorGammaValueElement,
    cameraFocusDistanceInput,
    cameraFocusDistanceValueElement,
    cameraApertureInput,
    cameraApertureValueElement,
    motionBlurInput,
    motionBlurValueElement,
    bloomStrengthInput,
    bloomStrengthValueElement,
    bloomThresholdInput,
    bloomThresholdValueElement,
    glareStrengthInput,
    glareStrengthValueElement
  );

  const [, colorCorrectionError] = uiController.updateColorCorrectionFromInputs();
  if (colorCorrectionError) {
    return returnFailure(colorCorrectionError.code, colorCorrectionError.message, colorCorrectionError.details);
  }

  const [, cameraEffectsError] = uiController.updateCameraEffectsFromInputs();
  if (cameraEffectsError) {
    return returnFailure(cameraEffectsError.code, cameraEffectsError.message, cameraEffectsError.details);
  }

  const initialEffectUpdates = [
    () => uiController.updateLightSizeFromInput(),
    () => uiController.updateFogDensityFromInput(),
    () => uiController.updateSkyBrightnessFromInput(),
    () => uiController.updateDenoiserStrengthFromInput(),
    () => uiController.updateBloomStrengthFromInput(),
    () => uiController.updateBloomThresholdFromInput(),
    () => uiController.updateGlareStrengthFromInput()
  ];
  for (const updateEffect of initialEffectUpdates) {
    const [, updateError] = updateEffect();
    if (updateError) {
      return returnFailure(updateError.code, updateError.message, updateError.details);
    }
  }

  const [initialSceneObjects, sceneError] = createSphereColumnSceneObjects(applicationState);
  if (sceneError) {
    return returnFailure(sceneError.code, sceneError.message, sceneError.details);
  }

  const [, setSceneError] = uiController.setSceneObjects(initialSceneObjects);
  if (setSceneError) {
    return returnFailure(setSceneError.code, setSceneError.message, setSceneError.details);
  }

  const [, inputHandlerError] = attachInputHandlers(documentObject, canvasElement, errorElement, uiController);
  if (inputHandlerError) {
    return returnFailure(inputHandlerError.code, inputHandlerError.message, inputHandlerError.details);
  }

  const [, controlHandlerError] = attachControlHandlers(controlsElement, errorElement, uiController);
  if (controlHandlerError) {
    return returnFailure(controlHandlerError.code, controlHandlerError.message, controlHandlerError.details);
  }

  hideError(errorElement);

  return returnSuccess({
    canvasElement,
    errorElement,
    uiController,
    applicationState,
    gpuInfo
  });
};

const startAnimationLoop = (application) => {
  let previousFrameTime = performance.now();

  const renderFrame = (currentTime) => {
    const elapsedSeconds = (currentTime - previousFrameTime) * 0.001;
    previousFrameTime = currentTime;

    const [, physicsError] = application.uiController.stepPhysics(elapsedSeconds);
    if (physicsError) {
      displayError(application.errorElement, physicsError);
      return returnFailure(physicsError.code, physicsError.message, physicsError.details);
    }

    const [, autoRotationError] = advanceCameraAutoRotation(
      application.applicationState,
      elapsedSeconds,
      application.uiController.selectionRenderer.pathTracer
    );
    if (autoRotationError) {
      displayError(application.errorElement, autoRotationError);
      return returnFailure(autoRotationError.code, autoRotationError.message, autoRotationError.details);
    }

    const [, lightCycleError] = application.uiController.advanceLightIntensityCycle(elapsedSeconds);
    if (lightCycleError) {
      displayError(application.errorElement, lightCycleError);
      return returnFailure(lightCycleError.code, lightCycleError.message, lightCycleError.details);
    }

    const [, updateError] = application.uiController.update();
    if (updateError) {
      displayError(application.errorElement, updateError);
      return returnFailure(updateError.code, updateError.message, updateError.details);
    }

    const [, renderError] = application.uiController.render();
    if (renderError) {
      displayError(application.errorElement, renderError);
      return returnFailure(renderError.code, renderError.message, renderError.details);
    }

    application.applicationState.animationFrameId = requestAnimationFrame(renderFrame);
    return returnSuccess(undefined);
  };

  application.applicationState.animationFrameId = requestAnimationFrame(renderFrame);
  return returnSuccess(undefined);
};

const startPathTracingDemo = async () => {
  const [application, applicationError] = await createPathTracingApplication(document);
  if (applicationError) {
    return returnFailure(applicationError.code, applicationError.message, applicationError.details);
  }

  window.pathTracingDemo = application;
  window.ui = application.uiController;

  const [, animationError] = startAnimationLoop(application);
  if (animationError) {
    return returnFailure(animationError.code, animationError.message, animationError.details);
  }

  return returnSuccess(application);
};

const bootPathTracingDemo = () => (
  startPathTracingDemo().then(([application, startupError]) => {
  if (startupError) {
    const errorElement = document.getElementById('error');
    if (errorElement) {
      displayError(errorElement, startupError);
    }
    return returnFailure(startupError.code, startupError.message, startupError.details);
  }

    return returnSuccess(application);
  }, (startupError) => {
    const errorElement = document.getElementById('error');
    const errorValue = Object.freeze({
      code: 'startup-failed',
      message: 'Path tracing demo startup failed.',
      details: readErrorMessage(startupError)
    });
    if (errorElement) {
      displayError(errorElement, errorValue);
    }
    return returnFailure(errorValue.code, errorValue.message, errorValue.details);
  })
);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPathTracingDemo);
} else {
  bootPathTracingDemo();
}
