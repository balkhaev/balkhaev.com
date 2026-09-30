import {
  createDiskParticles,
  PARTICLE_FRAGMENT,
  PARTICLE_VERTEX,
} from "./black-hole-particles";
import {
  createGpuClock,
  HOLE_QUALITY,
  type HoleQuality,
} from "./black-hole-quality";
import { contactAtlas } from "./contact-atlas";
import { CRITICAL_B, type GeodesicTable, geodesicTable } from "./geodesics";
import {
  CONTACT_NORMAL,
  CONTACT_UP,
  CONTACTS,
  cameraOf,
  contactHit,
  OBSERVER_RADIUS,
} from "./scene-geometry";
import { createStellarOrbit, STAR_SAMPLES } from "./stellar-orbit";
import { STELLAR_SHADER } from "./stellar-shader";

/**
 * The black hole drawn in WebGL 2 as light would show it. Every pixel's ray is followed back through the curved space
 * round the hole by the geodesic table (see geodesics.ts): where the ray's plane cuts the accretion disk, the ray
 * meets the disk's first image (the near side across the shadow, the far side lifted over it), then its second (the
 * far side's underside, bent under the shadow) and its third (the thin photon ring); a ray that falls in is the
 * shadow; a ray that gets away shows the stars it bent past.
 *
 * Passive circular tracers supply disk opacity. A zero-torque Schwarzschild thin-disk profile sets temperature.
 * Each intersection uses its retarded emission time, and g = sqrt(1-3/2r) / (sqrt(1-1/D)(1-Omega lambda)).
 * Planck radiance at gT includes the frequency shift and beaming together. Disk and contact-plane crossings
 * are composited in ray order; the same escaping rays sample the distant star field.
 */

/** The observer's distance, r_s: far enough for a long lens, as the pictures of M87 and Gargantua are drawn. */
const DISTANCE = OBSERVER_RADIUS;
/** The disk: from the innermost stable circular orbit out. */
const DISK_IN = 3;
const DISK_OUT = 11;

/** At most this many pixels are ray traced; a larger canvas is drawn smaller and stretched (the picture is soft). */
const MAX_PIXELS = 1_200_000;

export interface HoleView {
  azimuth?: number;
  /** How far the camera stands from the disk's axis, degrees (90: the disk edge-on). */
  inclination: number;
  /** The picture's turn, degrees. */
  roll: number;
  /** The shadow's radius, as a share of the canvas's shorter side. */
  size: number;
  /** Which way the disk turns seen from the camera: 1, the left side comes at the viewer; −1, the right side. */
  spin: 1 | -1;
  /** How much the stars show, 0–1. */
  stars: number;
  /** The hole's centre, as shares of the canvas's width and height from its top left. */
  x: number;
  y: number;
}

export interface HoleFrame {
  /** How much the disk takes in: its brightness, 1 at rest. */
  accretion: number;
  selected?: number;
  /** Time in r_s/c: at 1 per second the innermost gas goes round in about 46 seconds. */
  time: number;
}

export interface HoleRenderer {
  dispose: () => void;
  draw: (frame: HoleFrame) => void;
  gpuTime: () => number | null;
  hit: (x: number, y: number, time: number) => number;
  quality: (level: HoleQuality) => void;
  /**
   * Sizes the drawing to the canvas's CSS box times the device's pixel ratio, within the pixel budget times `detail`
   * (0–1; a slow device draws fewer pixels).
   */
  resize: (
    width: number,
    height: number,
    ratio: number,
    detail: number
  ) => void;
  view: (view: HoleView) => void;
}

const VERTEX = `#version 300 es
const vec2 CORNERS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
	vec2 corner = CORNERS[gl_VertexID];
	vUv = corner * 0.5 + 0.5;
	gl_Position = vec4(corner, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTable;
uniform sampler2D uEnds;
uniform sampler2D uParticles;
uniform sampler2D uTimes;
uniform sampler2D uContacts;
uniform int uSelected;
uniform int uImages;
uniform vec2 uCenter;
uniform float uFocal;
uniform mat3 uCamera;
uniform vec3 uEye;
uniform vec4 uGrid; // rows, rows below b_c, b max, angles per row
uniform float uPhiMax;
uniform float uTime;
uniform float uAccretion;
uniform float uSpin;
uniform float uStars;

out vec4 outColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float BC = ${CRITICAL_B.toFixed(8)};
const float D = ${DISTANCE.toFixed(1)};
const float DISK_IN = ${DISK_IN.toFixed(1)};
const float DISK_OUT = ${DISK_OUT.toFixed(1)};
// Peak of the zero-torque Schwarzschild thin-disk flux, at r = 4.7755 r_s.
const float FLUX_PEAK = 0.00011458947;
// Planck's law at the three primaries for 6500 K: the white the colours are balanced to.
const vec3 WHITE = vec3(0.32205, 0.36152, 0.39627);
// The hottest gas, kelvin, before any shift.
const float T_PEAK = 5400.0;
const vec3 CONTACT_UP = vec3(${CONTACT_UP.join(", ")});
const vec3 CONTACT_NORMAL = vec3(${CONTACT_NORMAL.join(", ")});


float rowOf(float b) {
	float rows = uGrid.x;
	float below = uGrid.y;
	if (b < BC) {
		return below - sqrt(max(0.0, 1.0 - b / BC)) * below;
	}
	return below + pow(min(1.0, (b - BC) / (uGrid.z - BC)), 1.0 / 3.0) * (rows - 1.0 - below);
}

float cell(ivec2 at) {
	ivec2 size = ivec2(int(uGrid.w), int(uGrid.x));
	return texelFetch(uTable, clamp(at, ivec2(0), size - 1), 0).r;
}

/** u = 1/r of the ray at row \`row\` after it has swept \`phi\`. */
float inverseRadius(float row, float phi) {
	vec2 at = vec2(phi / uPhiMax * (uGrid.w - 1.0), row);
	ivec2 base = ivec2(floor(at));
	vec2 f = at - vec2(base);
	float a = mix(cell(base), cell(base + ivec2(1, 0)), f.x);
	float b = mix(cell(base + ivec2(0, 1)), cell(base + ivec2(1, 1)), f.x);
	return mix(a, b, f.y);
}

float travelTime(float row, float phi) {
  vec2 at = vec2(phi / uPhiMax * (uGrid.w - 1.0), row);
  ivec2 base = ivec2(floor(at));
  ivec2 last = ivec2(int(uGrid.w) - 1, int(uGrid.x) - 1);
  vec2 f = fract(at);
  float a = mix(texelFetch(uTimes, clamp(base, ivec2(0), last), 0).r, texelFetch(uTimes, clamp(base + ivec2(1, 0), ivec2(0), last), 0).r, f.x);
  float b = mix(texelFetch(uTimes, clamp(base + ivec2(0, 1), ivec2(0), last), 0).r, texelFetch(uTimes, clamp(base + ivec2(1, 1), ivec2(0), last), 0).r, f.x);
  return mix(a, b, f.y);
}

vec3 blackbody(float t);
${STELLAR_SHADER}

vec4 beacon(vec3 hit, float time, vec3 photonCovector, float facing) {
  const vec4 bodies[2] = vec4[2](
    vec4(${CONTACTS[0].radius.toFixed(4)}, ${CONTACTS[0].phase.toFixed(4)}, ${CONTACTS[0].width.toFixed(4)}, ${CONTACTS[0].height.toFixed(4)}),
    vec4(${CONTACTS[1].radius.toFixed(4)}, ${CONTACTS[1].phase.toFixed(4)}, ${CONTACTS[1].width.toFixed(4)}, ${CONTACTS[1].height.toFixed(4)})
  );
  for (int index = 0; index < 2; index++) {
    vec4 body = bodies[index];
    float omega = sqrt(0.5 / (body.x * body.x * body.x));
    float angle = body.y + omega * time;
    vec2 center = body.x * vec2(cos(angle), sin(angle));
    vec2 uv = (vec2(hit.x, dot(hit, CONTACT_UP)) - center) / body.zw;
    if (abs(uv.x) > 0.5 || abs(uv.y) > 0.5) continue;
    uv = vec2(0.5 - uv.x * facing, 0.5 - uv.y);
    vec4 ink = texture(uContacts, vec2(uv.x, (float(index) + uv.y) * 0.5));
    vec3 velocity = body.x * omega * (vec3(-sin(angle), 0.0, 0.0) + CONTACT_UP * cos(angle));
    float lapse = 1.0 - 1.0 / length(hit);
    float radialVelocity = dot(velocity, normalize(hit));
    float properRate = sqrt(max(0.0, lapse - dot(velocity, velocity) - (1.0 / lapse - 1.0) * radialVelocity * radialVelocity));
    float g = properRate / (sqrt(1.0 - 1.0 / D) * (1.0 - dot(photonCovector, velocity)));
    // I_nu / nu^3 is invariant: a Planck emitter is observed as B_nu(g T).
    vec3 colour = blackbody(6500.0 * g) * 0.65;
    float underline = uSelected == index ? (1.0 - smoothstep(0.008, 0.017, abs(uv.y - 0.84))) * step(0.07, uv.x) * step(uv.x, 0.93) : 0.0;
    float alpha = max(ink.a, underline * 0.7);
    return vec4(colour, alpha);
  }
  return vec4(0.0);
}

/** Where the ray ends: the angle it escapes at, or minus the angle it falls in at. */
float endOf(float row) {
	int last = int(uGrid.x) - 1;
	int low = clamp(int(floor(row)), 0, last);
	int high = min(low + 1, last);
	float a = texelFetch(uEnds, ivec2(low, 0), 0).r;
	float b = texelFetch(uEnds, ivec2(high, 0), 0).r;
	float f = fract(row);
	if (sign(a) != sign(b)) {
		return f < 0.5 ? a : b;
	}
	return mix(a, b, f);
}

/** Three random numbers for a cell of the sky: the PCG hash (Jarzynski & Olano), with no pattern between neighbours. */
vec3 random3(vec3 cell, uint salt) {
	uvec3 v = uvec3(ivec3(cell) + 65536) * 1664525u + 1013904223u + salt;
	v.x += v.y * v.z;
	v.y += v.z * v.x;
	v.z += v.x * v.y;
	v ^= v >> 16u;
	v.x += v.y * v.z;
	v.y += v.z * v.x;
	v.z += v.x * v.y;
	return vec3(v) / 4294967295.0;
}

/** Three spectral samples of Planck radiance, calibrated to a 6500 K white. */
vec3 blackbody(float t) {
	vec3 lambda = vec3(0.611, 0.549, 0.464);
	vec3 radiance = 1.0 / (pow(lambda, vec3(5.0)) * (exp(14387.77 / (lambda * max(t, 400.0))) - 1.0));
	return radiance / WHITE;
}

float densityNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 corners = fract(sin(vec4(dot(cell, vec2(127.1, 311.7)), dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7)), dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(cell + vec2(1.0), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(corners.x, corners.y, f.x), mix(corners.z, corners.w, f.x), f.y);
}

/** The disk where a ray crosses it: its light (rgb) and how opaque it is (a). */
vec4 disk(float r, float psi, float lambda, float delay) {
	float x = sqrt(2.0 * r);
	float x0 = sqrt(6.0);
	float root3 = sqrt(3.0);
	float integral = x - x0 - root3 * 0.5 * log(((x - root3) * (x0 + root3)) / ((x + root3) * (x0 - root3)));
	float flux = max(0.0, integral / (pow(x, 5.0) * (x*x - 3.0))) / FLUX_PEAK;
	float omega = sqrt(0.5 / (r * r * r));
	float g = sqrt(max(0.0, 1.0 - 1.5 / r)) / (sqrt(1.0 - 1.0 / D) * (1.0 - omega * lambda * uSpin));
	vec3 matter = textureLod(uParticles, vec2((psi - omega * uSpin * delay) / TAU + 0.5, (r - DISK_IN) / (DISK_OUT - DISK_IN)), 0.0).rgb;
	float n = 1.0 - exp(-matter.r * 3.0);
	// Advected density filaments: each annulus keeps its own Keplerian angular rate.
	float phase = psi + omega * uSpin * (uTime - delay + D);
	vec2 flow = vec2(cos(phase), sin(phase)) * 9.0;
	float clouds = densityNoise(flow + vec2(r * 8.0, 0.0));
	float fine = densityNoise(flow * 3.0 + vec2(r * 29.0, r * 7.0));
	float bands = sin(r * 23.0 + 3.0 * clouds) * (1.0 - smoothstep(0.3, 1.5, fwidth(r * 23.0)));
	float t = T_PEAK * pow(flux, 0.25) * g;
	float edge = smoothstep(DISK_IN, DISK_IN + 0.45, r) * (1.0 - smoothstep(7.0, DISK_OUT, r));
	float alpha = edge * (0.38 + 0.16 * n + 0.05 * bands + 0.29 * clouds + 0.12 * fine);
	return vec4(blackbody(t) * uAccretion, alpha);
}

/**
 * Faint stars. A star is a point, and lensing only moves it and changes its brightness: the sky this close to the hole
 * is squeezed and stretched round it (the whole frame lies inside the Einstein ring), so a star is found in the sky
 * the pixel sees, put back through the pixel's own map of the sky (dx, dy: how the sky moves per pixel) to a spot a
 * pixel wide on the screen, and made as much brighter as the map magnifies there. Where a pixel holds a great deal of
 * sky, by the photon ring, the stars fade instead of sparkling.
 */
vec3 stars(vec3 dir, vec3 dx, vec3 dy) {
	const float CELLS = 150.0;
	vec3 id = floor(dir * CELLS);
	vec3 draw = random3(id, 0u);
	if (draw.x > 0.008) {
		return vec3(0.0);
	}
	vec3 star = normalize((id + 0.3 + 0.4 * random3(id, 7u)) / CELLS);
	vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
	vec3 t2 = cross(dir, t1);
	mat2 map = mat2(dot(dx, t1), dot(dx, t2), dot(dy, t1), dot(dy, t2));
	float area = abs(determinant(map));
	if (area < 1e-14) {
		return vec3(0.0);
	}
	vec2 spot = inverse(map) * vec2(dot(star - dir, t1), dot(star - dir, t2));
	float pixel = 1.0 / uFocal;
	float gain = min(5.0, pixel * pixel / area);
	float energy = pow(draw.y, 7.0) * 3.0 + 0.04;
	vec3 tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), draw.z);
	return tint * energy * gain * exp(-dot(spot, spot) / 0.45);
}

void main() {
	vec2 offset = (gl_FragCoord.xy - uCenter) / uFocal;
	vec3 dir = normalize(uCamera * vec3(offset, 1.0));
	vec3 e1 = uEye / D;
	float cosA = dot(dir, e1);
	vec3 across = dir - cosA * e1;
	float sinA = length(across);
	vec3 e2 = sinA > 1e-7 ? across / sinA : vec3(0.0, 1.0, 0.0);
	float b = D * sinA / sqrt(1.0 - 1.0 / D);
	bool inTable = b <= uGrid.z;
	float row = rowOf(b);
	float end = inTable ? endOf(row) : PI;
	float phiEnd = abs(end);
	vec3 away = inTable ? cos(phiEnd) * e1 + sin(phiEnd) * e2 : dir;
	vec3 skyX = dFdx(away);
	vec3 skyY = dFdy(away);

	vec3 light = vec3(0.0);
	float through = 1.0;
	if (inTable) {
		vec3 normal = cross(e1, e2);
		float diskPhi = mod(atan(e2.y, e1.y) + 0.5 * PI, PI);
		float beaconPhi = mod(atan(dot(e2, CONTACT_NORMAL), dot(e1, CONTACT_NORMAL)) + 0.5 * PI, PI);
		float starImageA = starIntersection(row, b, phiEnd, e1, e2, 0.0);
		float starImageB = starIntersection(row, b, phiEnd, e1, e2, TAU);
		float starPhi = min(starImageA, starImageB);
		float starSecond = max(starImageA, starImageB);
		int diskCount = 0;
		int beaconCount = 0;
		for (int k = 0; k < 8; k++) {
			bool surface = beaconPhi < diskPhi;
			float phi = min(beaconPhi, diskPhi);
			bool stellar = starPhi < phi;
			if (stellar) { phi = starPhi; starPhi = starSecond; starSecond = 1e5; }
			else if (surface) { beaconCount++; beaconPhi = beaconCount >= uImages ? 1e5 : beaconPhi + PI; }
			else { diskCount++; diskPhi = diskCount >= uImages ? 1e5 : diskPhi + PI; }
			if (phi >= phiEnd || through < 0.01) {
				break;
			}
			float u = inverseRadius(row, phi);
			if (u <= 0.0 || u >= 1.0) {
				continue;
			}
			float r = 1.0 / u;
			vec3 hit = r * (cos(phi) * e1 + sin(phi) * e2);
			float delay = travelTime(row, phi);
			vec4 emission;
			if (surface || stellar) {
				vec3 radial = normalize(hit);
				vec3 tangent = -sin(phi) * e1 + cos(phi) * e2;
				float slope = (inverseRadius(row, phi + 0.002) - inverseRadius(row, max(0.0, phi - 0.002))) / 0.004;
				vec3 photonCovector = b * slope / (1.0 - u) * radial - b * u * tangent;
				emission = stellar ? photosphere(hit, uTime - delay + D, photonCovector) : beacon(hit, uTime - delay + D, photonCovector, sign(dot(tangent, CONTACT_NORMAL)));
			} else {
				if (r < DISK_IN || r > DISK_OUT) continue;
				emission = disk(r, atan(hit.z, hit.x), -b * normal.y, delay);
			}
			light += through * emission.rgb * emission.a;
			through *= 1.0 - emission.a;
		}
	}
	if (end > 0.0 && uStars > 0.0) {
		light += through * stars(away, skyX, skyY) * uStars;
	}
	float opacity = end < 0.0 ? 1.0 : 1.0 - through;
	outColor = vec4(light, opacity);
}`;

const DOWNSAMPLE = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
	vec4 sum = texture(uSource, vUv + uTexel * vec2(-1.0, -1.0));
	sum += texture(uSource, vUv + uTexel * vec2(1.0, -1.0));
	sum += texture(uSource, vUv + uTexel * vec2(-1.0, 1.0));
	sum += texture(uSource, vUv + uTexel * vec2(1.0, 1.0));
	outColor = sum * 0.25;
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
	vec4 sum = texture(uSource, vUv) * 0.2270270270;
	sum += (texture(uSource, vUv + uStep * 1.3846153846) + texture(uSource, vUv - uStep * 1.3846153846)) * 0.3162162162;
	sum += (texture(uSource, vUv + uStep * 3.2307692308) + texture(uSource, vUv - uStep * 3.2307692308)) * 0.0702702703;
	outColor = sum;
}`;

const COMPOSE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uGlow0;
uniform sampler2D uGlow1;
uniform sampler2D uGlow2;
uniform sampler2D uGlow3;
uniform sampler2D uGlow4;
uniform float uExposure;
in vec2 vUv;
out vec4 outColor;

vec3 aces(vec3 x) {
	return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 encode(vec3 linear) {
	return mix(linear * 12.92, 1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, linear));
}

void main() {
	vec4 scene = texture(uScene, vUv);
	vec3 glow = texture(uGlow0, vUv).rgb * 0.18 + texture(uGlow1, vUv).rgb * 0.2 + texture(uGlow2, vUv).rgb * 0.22 + texture(uGlow3, vUv).rgb * 0.22 + texture(uGlow4, vUv).rgb * 0.18;
	vec3 light = mix(scene.rgb, glow, 0.24) * uExposure;
	vec3 colour = encode(aces(light));
	float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
	colour = max(colour + noise / 255.0, 0.0);
	float alpha = max(scene.a, max(colour.r, max(colour.g, colour.b)));
	outColor = vec4(colour, alpha);
}`;

interface Target {
  framebuffer: WebGLFramebuffer;
  height: number;
  texture: WebGLTexture;
  width: number;
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

let sharedTable: GeodesicTable | null = null;

function tableOnce(): GeodesicTable {
  sharedTable ??= geodesicTable({
    bMax: 60.5,
    distance: DISTANCE,
    phiCount: 1024,
  });
  return sharedTable;
}

function compile(
  gl: WebGL2RenderingContext,
  fragment: string,
  names: string[],
  vertex = VERTEX
): Program {
  const shader = (type: number, source: string) => {
    const made = gl.createShader(type);
    if (!made) {
      throw new Error("WebGL: no shader");
    }
    gl.shaderSource(made, source);
    gl.compileShader(made);
    if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) {
      throw new Error(`WebGL: ${gl.getShaderInfoLog(made) ?? "shader"}`);
    }
    return made;
  };
  const program = gl.createProgram();
  const vertexShader = shader(gl.VERTEX_SHADER, vertex);
  const fragmentShader = shader(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL: ${gl.getProgramInfoLog(program) ?? "program"}`);
  }
  return {
    program,
    uniforms: new Map(
      names.map((name) => [name, gl.getUniformLocation(program, name)])
    ),
  };
}

function dataTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data: Float32Array,
  rgba = false
): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    rgba ? gl.RGBA32F : gl.R32F,
    width,
    height,
    0,
    rgba ? gl.RGBA : gl.RED,
    gl.FLOAT,
    data
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Makes the renderer, or null where WebGL 2 is not to be had. */
export function createHoleRenderer(
  canvas: HTMLCanvasElement,
  initial: HoleView
): HoleRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
    premultipliedAlpha: true,
    stencil: false,
  });
  if (!gl) {
    return null;
  }
  const floatTargets = gl.getExtension("EXT_color_buffer_float") !== null;
  let scene: Program;
  let downsample: Program;
  let blur: Program;
  let compose: Program;
  let particleProgram: Program;
  try {
    scene = compile(gl, SCENE, [
      "uTable",
      "uEnds",
      "uParticles",
      "uTimes",
      "uContacts",
      "uOrbit",
      "uOrbitClock",
      "uSelected",
      "uImages",
      "uCenter",
      "uFocal",
      "uCamera",
      "uEye",
      "uGrid",
      "uPhiMax",
      "uTime",
      "uAccretion",
      "uSpin",
      "uStars",
    ]);
    downsample = compile(gl, DOWNSAMPLE, ["uSource", "uTexel"]);
    blur = compile(gl, BLUR, ["uSource", "uStep"]);
    compose = compile(gl, COMPOSE, [
      "uScene",
      "uGlow0",
      "uGlow1",
      "uGlow2",
      "uGlow3",
      "uGlow4",
      "uExposure",
    ]);
    particleProgram = compile(gl, PARTICLE_FRAGMENT, [], PARTICLE_VERTEX);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
    return null;
  }

  const table = tableOnce();
  const tableTexture = dataTexture(gl, table.phiCount, table.rows, table.u);
  const endsTexture = dataTexture(gl, table.rows, 1, table.ends);
  const timesTexture = dataTexture(gl, table.phiCount, table.rows, table.times);
  const orbit = createStellarOrbit();
  const orbitTexture = dataTexture(gl, STAR_SAMPLES, 1, orbit.data, true);
  const contactsTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, contactsTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    contactAtlas()
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const particles = createDiskParticles(gl, particleProgram.program);
  const gpu = createGpuClock(gl);
  let quality: HoleQuality = "balanced";
  const vao = gl.createVertexArray();

  const target = (targetWidth: number, targetHeight: number): Target => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      floatTargets ? gl.RGBA16F : gl.RGBA8,
      targetWidth,
      targetHeight,
      0,
      gl.RGBA,
      floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );
    return {
      framebuffer,
      height: targetHeight,
      texture,
      width: targetWidth,
    };
  };
  const free = (targets: Target[]) => {
    for (const each of targets) {
      gl.deleteFramebuffer(each.framebuffer);
      gl.deleteTexture(each.texture);
    }
  };

  let view = initial;
  let width = 1;
  let height = 1;
  let sceneTarget: Target | null = null;
  /** Per level: the downsampled picture and the one it is blurred through. */
  let glow: [Target, Target][] = [];

  const bind = (program: Program) => {
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl.useProgram(program.program);
    return (name: string) => program.uniforms.get(name) ?? null;
  };
  const pass = (into: Target | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into?.framebuffer ?? null);
    gl.viewport(0, 0, into?.width ?? width, into?.height ?? height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const texture = (unit: number, source: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, source);
  };

  return {
    dispose() {
      free([...(sceneTarget ? [sceneTarget] : []), ...glow.flat()]);
      gl.deleteTexture(tableTexture);
      gl.deleteTexture(endsTexture);
      gl.deleteTexture(timesTexture);
      gl.deleteTexture(orbitTexture);
      gl.deleteTexture(contactsTexture);
      particles.dispose();
      gpu.dispose();
      gl.deleteVertexArray(vao);
      for (const each of [scene, downsample, blur, compose, particleProgram]) {
        gl.deleteProgram(each.program);
      }
    },

    draw({ accretion, time, selected = -1 }) {
      if (!sceneTarget) {
        return;
      }
      gpu.begin();

      const shorter = Math.min(width, height);
      const shadow = view.size * shorter;
      const sinShadow = (CRITICAL_B * Math.sqrt(1 - 1 / DISTANCE)) / DISTANCE;
      const focal = shadow / Math.tan(Math.asin(sinShadow));
      const { basis, eye } = cameraOf(view);
      particles.draw(time + DISTANCE, view.spin);
      gl.bindVertexArray(vao);
      const at = bind(scene);
      texture(0, tableTexture);
      texture(1, endsTexture);
      texture(2, particles.texture);
      texture(4, timesTexture);
      texture(6, orbitTexture);
      if (contactsTexture) {
        texture(5, contactsTexture);
      }
      gl.uniform1i(at("uTable"), 0);
      gl.uniform1i(at("uEnds"), 1);
      gl.uniform1i(at("uParticles"), 2);
      gl.uniform1i(at("uTimes"), 4);
      gl.uniform1i(at("uContacts"), 5);
      gl.uniform1i(at("uOrbit"), 6);
      gl.uniform4f(
        at("uOrbitClock"),
        orbit.period,
        orbit.advance,
        orbit.offset,
        orbit.orientation
      );
      gl.uniform1i(at("uSelected"), selected);
      gl.uniform1i(at("uImages"), HOLE_QUALITY[quality].images);
      gl.uniform2f(at("uCenter"), view.x * width, (1 - view.y) * height);
      gl.uniform1f(at("uFocal"), focal);
      gl.uniformMatrix3fv(at("uCamera"), false, basis);
      gl.uniform3f(at("uEye"), eye[0], eye[1], eye[2]);
      gl.uniform4f(
        at("uGrid"),
        table.rows,
        table.below,
        table.bMax,
        table.phiCount
      );
      gl.uniform1f(at("uPhiMax"), table.phiMax);
      gl.uniform1f(at("uTime"), time);
      gl.uniform1f(at("uAccretion"), accretion);
      gl.uniform1f(at("uSpin"), view.spin);
      gl.uniform1f(at("uStars"), view.stars);
      pass(sceneTarget);

      let source = sceneTarget;
      for (const [down, across] of glow) {
        const shrink = bind(downsample);
        texture(0, source.texture);
        gl.uniform1i(shrink("uSource"), 0);
        gl.uniform2f(shrink("uTexel"), 0.5 / source.width, 0.5 / source.height);
        pass(down);
        const soften = bind(blur);
        gl.uniform1i(soften("uSource"), 0);
        texture(0, down.texture);
        gl.uniform2f(soften("uStep"), 1 / down.width, 0);
        pass(across);
        texture(0, across.texture);
        gl.uniform2f(soften("uStep"), 0, 1 / down.height);
        pass(down);
        source = down;
      }

      const finish = bind(compose);
      texture(0, sceneTarget.texture);
      for (let level = 0; level < 5; level += 1) {
        const down = glow[Math.min(level, glow.length - 1)]?.[0];
        if (down) {
          texture(level + 1, down.texture);
        }
      }
      gl.uniform1i(finish("uScene"), 0);
      gl.uniform1i(finish("uGlow0"), 1);
      gl.uniform1i(finish("uGlow1"), 2);
      gl.uniform1i(finish("uGlow2"), 3);
      gl.uniform1i(finish("uGlow3"), 4);
      gl.uniform1i(finish("uGlow4"), 5);
      gl.uniform1f(finish("uExposure"), 1.65);
      pass(null);
      gpu.end();
    },
    gpuTime: gpu.read,
    hit(x, y, time) {
      const bounds = canvas.getBoundingClientRect();
      return contactHit(
        table,
        view,
        bounds.width,
        bounds.height,
        x - bounds.left,
        y - bounds.top,
        time,
        HOLE_QUALITY[quality].images
      );
    },
    quality(next) {
      if (quality !== next) {
        quality = next;
        particles.setQuality(next);
      }
      canvas.dataset.holeQuality = next;
      canvas.dataset.holeParticles = String(HOLE_QUALITY[next].particles);
    },

    resize(cssWidth, cssHeight, ratio, detail) {
      const pixels = cssWidth * cssHeight * ratio * ratio;
      const scale =
        ratio *
        Math.min(1, Math.sqrt((MAX_PIXELS * detail) / Math.max(pixels, 1)));
      const nextWidth = Math.max(2, Math.round(cssWidth * scale));
      const nextHeight = Math.max(2, Math.round(cssHeight * scale));
      if (
        nextWidth === width &&
        nextHeight === height &&
        sceneTarget &&
        glow.length === HOLE_QUALITY[quality].bloom
      ) {
        return;
      }
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      free([...(sceneTarget ? [sceneTarget] : []), ...glow.flat()]);
      sceneTarget = target(width, height);
      glow = [];
      let levelWidth = width;
      let levelHeight = height;
      for (let level = 0; level < HOLE_QUALITY[quality].bloom; level += 1) {
        levelWidth = Math.max(1, Math.round(levelWidth / 2));
        levelHeight = Math.max(1, Math.round(levelHeight / 2));
        glow.push([
          target(levelWidth, levelHeight),
          target(levelWidth, levelHeight),
        ]);
      }
    },

    view(next) {
      view = next;
    },
  };
}
