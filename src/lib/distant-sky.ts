import { type InfallTable, rowAngle } from "./infall-geodesics";
import { SPECTRUM_SHADER } from "./spectrum";

const SKY_SIZE = 128;
const POINT_FLUX = 1.77e-6;

/** Exact solid angle of a cube texel; avoid a denser catalogue at face corners. */
export function skySolidAngle(x: number, y: number, size: number) {
  const edge = (a: number, b: number) =>
    Math.atan2(a * b, Math.sqrt(1 + a * a + b * b));
  const u = (2 * x) / size - 1;
  const v = (2 * y) / size - 1;
  const du = 2 / size;
  return edge(u + du, v + du) - edge(u, v + du) - edge(u + du, v) + edge(u, v);
}

function directionOf(face: number, u: number, v: number) {
  const axes = [
    [1, -v, -u],
    [-1, -v, u],
    [u, 1, v],
    [u, -1, -v],
    [u, -v, 1],
    [-u, -v, -1],
  ];
  const direction = axes[face] ?? [1, 0, 0];
  const length = Math.hypot(...direction);
  return direction.map((value) => value / length);
}

/** PCG integer operations are confined to the catalogue seed. */
// biome-ignore-start lint/suspicious/noBitwiseOperators: PCG requires unsigned overflow and bit mixing.
function randomSky(x: number, y: number, face: number) {
  let a = (Math.imul(x + 65_536, 1_664_525) + 1_013_904_223) >>> 0;
  let b = (Math.imul(y + 65_536, 1_664_525) + 1_013_904_223) >>> 0;
  let c = (Math.imul(face + 65_536, 1_664_525) + 1_013_904_223) >>> 0;
  a = (a + Math.imul(b, c)) >>> 0;
  b = (b + Math.imul(c, a)) >>> 0;
  c = (c + Math.imul(a, b)) >>> 0;
  a ^= a >>> 16;
  b ^= b >>> 16;
  c ^= c >>> 16;
  a = (a + Math.imul(b, c)) >>> 0;
  b = (b + Math.imul(c, a)) >>> 0;
  c = (c + Math.imul(a, b)) >>> 0;
  return [
    (a >>> 0) / 4_294_967_296,
    (b >>> 0) / 4_294_967_296,
    (c >>> 0) / 4_294_967_296,
  ];
}
// biome-ignore-end lint/suspicious/noBitwiseOperators: PCG requires unsigned overflow and bit mixing.

function catalogueFace(face: number, data: number[]) {
  const axis = [0.35, 0.82, 0.45];
  const axisLength = Math.hypot(...axis);
  for (let y = 0; y < SKY_SIZE; y += 1) {
    for (let x = 0; x < SKY_SIZE; x += 1) {
      const [draw = 0, brightness = 0, type = 0] = randomSky(x, y, face);
      const [ox = 0, oy = 0] = randomSky(x + SKY_SIZE, y, face + 13);
      const direction = directionOf(
        face,
        (2 * (x + 0.2 + 0.6 * ox)) / SKY_SIZE - 1,
        (2 * (y + 0.2 + 0.6 * oy)) / SKY_SIZE - 1
      );
      const latitude =
        direction.reduce(
          (sum, value, index) => sum + value * (axis[index] ?? 0),
          0
        ) / axisLength;
      const population = Math.exp((-latitude * latitude) / 0.009);
      const area = skySolidAngle(x, y, SKY_SIZE);
      if (
        draw >
        ((0.024 + 0.075 * population) * area * SKY_SIZE * SKY_SIZE) / 4
      ) {
        continue;
      }
      const flux = (brightness ** 7 * 3 + 0.04) * POINT_FLUX;
      data.push(...direction, flux, 3200 + 10_800 * type * type);
    }
  }
}

/** Fixed world directions and integrated source flux, independent of the camera and radius. */
export function createDistantSky() {
  const data: number[] = [];
  for (let face = 0; face < 6; face += 1) {
    catalogueFace(face, data);
  }
  return new Float32Array(data);
}

export function firstSkyRow(table: InfallTable) {
  return table.ends.findIndex((end) => end > 0);
}

/** Invert the scene's escape-angle interpolation; phi includes image parity and winding. */
export function skyImage(table: InfallTable, phi: number) {
  let low = firstSkyRow(table);
  let high = table.rows - 1;
  if (
    low < 0 ||
    phi > (table.ends[low] ?? 0) ||
    phi < (table.ends[high] ?? 0)
  ) {
    return null;
  }
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if ((table.ends[middle] ?? 0) > phi) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const a = table.ends[low] ?? 0;
  const b = table.ends[high] ?? 0;
  const row = low + (a - phi) / (a - b);
  const angle = rowAngle(row, table);
  const rowDerivative =
    (2 * (Math.PI - table.critical) * (row - table.below)) /
    (table.rows - 1 - table.below) ** 2;
  return { angle, derivative: (b - a) / rowDerivative, row };
}

export const SKY_VERTEX = `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location = 0) in vec4 aSource; // world direction, integrated flux
layout(location = 1) in float aTemperature;
uniform sampler2D uEnds;
uniform vec4 uGrid;
uniform int uSkyFirst;
uniform float uDistance;
uniform vec3 uRadial;
uniform mat3 uCamera;
uniform vec3 uLens;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform float uSensor;
uniform float uStars;
flat out vec2 vCentre;
flat out vec3 vFlux;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const vec2 CORNERS[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
${SPECTRUM_SHADER}
float endAt(int row) { return texelFetch(uEnds, ivec2(row, 0), 0).r; }
float cameraAngle(float rho) { return mix(atan(rho * uLens.x), 2.0 * atan(rho * uLens.y), uLens.z); }
void main() {
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  vFlux = vec3(0.0);
  vCentre = vec2(0.0);
  int image = gl_InstanceID % 6;
  bool reverse = image % 2 == 1;
  vec3 source = normalize(aSource.xyz);
  float beta = atan(length(cross(source, uRadial)), dot(source, uRadial));
  float phi = (reverse ? TAU - beta : beta) + float(image / 2) * TAU;
  int low = uSkyFirst;
  int high = int(uGrid.x) - 1;
  if (low < 0 || phi > endAt(low) || phi < endAt(high)) return;
  for (int k = 0; k < 10; k++) {
    if (high - low <= 1) break;
    int middle = (low + high) / 2;
    if (endAt(middle) > phi) low = middle; else high = middle;
  }
  float a = endAt(low);
  float b = endAt(high);
  float row = float(low) + (a - phi) / (a - b);
  float fraction = (row - uGrid.y) / (uGrid.x - 1.0 - uGrid.y);
  float theta = uGrid.z + (PI - uGrid.z) * fraction * fraction;
  float rowDerivative = 2.0 * (PI - uGrid.z) * fraction / (uGrid.x - 1.0 - uGrid.y);
  float phiDerivative = (b - a) / rowDerivative;
  vec3 across = normalize(source - cos(beta) * uRadial);
  vec3 ray = -cos(theta) * uRadial + (reverse ? -1.0 : 1.0) * sin(theta) * across;
  vec3 local = transpose(uCamera) * ray;
  float sensorAngle = atan(length(local.xy), local.z);
  float upper = length(max(uCenter, uViewport - uCenter) + 3.0) * uSensor;
  if (sensorAngle > cameraAngle(upper)) return;
  float lower = 0.0;
  for (int k = 0; k < 18; k++) {
    float middle = (lower + upper) * 0.5;
    if (cameraAngle(middle) < sensorAngle) lower = middle; else upper = middle;
  }
  float rho = (lower + upper) * 0.5;
  vec2 offset = length(local.xy) > 1e-8 ? normalize(local.xy) * rho : vec2(0.0);
  vCentre = uCenter + offset / uSensor;
  float angularRate = mix(uLens.x / (1.0 + rho * rho * uLens.x * uLens.x), 2.0 * uLens.y / (1.0 + rho * rho * uLens.y * uLens.y), uLens.z);
  float cameraArea = uSensor * uSensor * (rho > 1e-5 ? sin(sensorAngle) * angularRate / rho : angularRate * angularRate);
  float gain = min(12.0, sin(theta) / max(abs(sin(beta) * phiDerivative), 1e-12));
  float energy = 1.0 - cos(theta) / sqrt(uDistance);
  vFlux = shiftedSpectrum(aTemperature, 1.0 / max(energy, 0.0001)) * aSource.w * gain / max(cameraArea, 1e-14) * uStars;
  vec2 pixel = vCentre + CORNERS[gl_VertexID] * 3.0;
  gl_Position = vec4(pixel / uViewport * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SKY_FRAGMENT = `#version 300 es
precision highp float;
flat in vec2 vCentre;
flat in vec3 vFlux;
out vec4 outColor;
// Pixel-integrated half-pixel Gaussian PSF conserves flux as the source crosses pixel boundaries.
float erfApprox(float x) {
  float t = 1.0 / (1.0 + 0.3275911 * abs(x));
  float p = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign(x) * (1.0 - p * exp(-x * x));
}
void main() {
  vec2 at = gl_FragCoord.xy - vCentre;
  vec2 a = (at - 0.5) * 1.41421356237;
  vec2 b = (at + 0.5) * 1.41421356237;
  float response = 0.25 * (erfApprox(b.x) - erfApprox(a.x)) * (erfApprox(b.y) - erfApprox(a.y));
  outColor = vec4(vFlux * response, 0.0);
}`;

export function createPointSky(gl: WebGL2RenderingContext) {
  const data = createDistantSky();
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
  gl.vertexAttribDivisor(0, 6);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
  gl.vertexAttribDivisor(1, 6);
  return {
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    },
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, (data.length / 5) * 6);
    },
  };
}
