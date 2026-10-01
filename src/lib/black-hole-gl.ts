import {
  createDiskParticles,
  PARTICLE_FRAGMENT,
  PARTICLE_VERTEX,
} from "./black-hole-particles";
import {
  createGpuClock,
  drawingSize,
  HOLE_QUALITY,
  type HoleQuality,
} from "./black-hole-quality";
import {
  createDiskWake,
  DISK_WAKE_SHADER,
  pickDisk,
  WAKE_HISTORY,
  WAKE_TEXELS,
} from "./disk-wake";
import {
  createPointSky,
  firstSkyRow,
  SKY_FRAGMENT,
  SKY_VERTEX,
} from "./distant-sky";
import { infallTable, radialClock } from "./infall-geodesics";
import {
  createPlungingFlow,
  PLUNGE_SAMPLES,
  PLUNGE_SHADER,
} from "./plunging-flow";
import { cameraOf, OBSERVER_RADIUS, type SceneView } from "./scene-geometry";
import { createSpectrum, SPECTRUM_SAMPLES, SPECTRUM_SHADER } from "./spectrum";
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
 * Each intersection uses ingoing PG emission time and photon energy in the observer's falling frame.
 * Planck radiance at gT includes the frequency shift and beaming together. Disk and stellar intersections
 * are composited in ray order; the same escaping rays sample the distant star field.
 */

/** Shared initial clock offset; the actual observer radius changes during flight. */
const DISTANCE = OBSERVER_RADIUS;
/** The disk: from the innermost stable circular orbit out. */
const DISK_IN = 3;
const DISK_OUT = 11;

export interface HoleView extends SceneView {
  spin: 1 | -1;
  stars: number;
}

export interface HoleFrame {
  /** How much the disk takes in: its brightness, 1 at rest. */
  accretion: number;
  /** Time in r_s/c: at 1 per second the innermost gas goes round in about 46 seconds. */
  time: number;
}

export interface HoleRenderer {
  dispose: () => void;
  /** Screen position in normalized CSS coordinates; energy is bounded locally. */
  disturb: (
    x: number,
    y: number,
    time: number,
    strength: number,
    impact?: boolean
  ) => boolean;
  draw: (frame: HoleFrame) => void;
  gpuTime: () => number | null;
  quality: (level: HoleQuality) => void;
  /** Device-pixel rendering, bounded by the current GPU quality budget. */
  resize: (width: number, height: number, ratio: number) => void;
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
uniform sampler2D uPointSky;
uniform int uImages;
uniform vec2 uCenter;
uniform float uSensor;
uniform vec3 uLens; // tan(FOV/2), tan(FOV/4), stereographic blend
uniform mat3 uCamera;
uniform vec3 uEye;
uniform vec4 uGrid; // rows, rows below shadow edge, critical local angle, samples per row
uniform float uDistance;
uniform float uClockOrigin;
uniform float uTime;
uniform float uAccretion;
uniform float uSpin;
uniform float uStars;

out vec4 outColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float EPOCH = ${DISTANCE.toFixed(1)};
const float DISK_IN = ${DISK_IN.toFixed(1)};
const float DISK_OUT = ${DISK_OUT.toFixed(1)};
// Peak of the zero-torque Schwarzschild thin-disk flux, at r = 4.7755 r_s.
const float FLUX_PEAK = 0.00011458947;
// The hottest gas, kelvin, before any shift.
const float T_PEAK = 2800.0;


float rowOf(float angle) {
  if (angle < uGrid.z) return uGrid.y * (1.0 - sqrt(max(0.0, 1.0 - angle / uGrid.z)));
  return uGrid.y + sqrt(max(0.0, (angle - uGrid.z) / (PI - uGrid.z))) * (uGrid.x - 1.0 - uGrid.y);
}
float sampleRow(sampler2D data, int row, float phi) {
  float end = max(0.0000001, abs(texelFetch(uEnds, ivec2(row, 0), 0).r));
  float f = clamp(phi / end, 0.0, 1.0);
  float at = (f < 0.5 ? sqrt(f * 0.5) : 1.0 - sqrt((1.0 - f) * 0.5)) * (uGrid.w - 1.0);
  int left = int(floor(at));
  float a = texelFetch(data, ivec2(left, row), 0).r;
  float b = texelFetch(data, ivec2(min(left + 1, int(uGrid.w) - 1), row), 0).r;
  return mix(a, b, fract(at));
}
float tableValue(sampler2D data, float row, float phi) {
  int low = clamp(int(floor(row)), 0, int(uGrid.x) - 1);
  return mix(sampleRow(data, low, phi), sampleRow(data, min(low + 1, int(uGrid.x) - 1), phi), fract(row));
}
float inverseRadius(float row, float phi) { return tableValue(uTable, row, phi); }
float travelTime(float row, float phi) {
  float r = 1.0 / max(inverseRadius(row, phi), 0.0001);
  float root = sqrt(r);
  return tableValue(uTimes, row, phi) + r - 2.0 * root + 2.0 * log(1.0 + root) - uClockOrigin;
}
// The null first integral gives an accurate tangent even for tiny far-emitter angular spans.
float pathSlope(float row, float phi, float end, float angular, float energy) {
  float step = min(0.001, max(0.0000001, min(phi, end - phi) * 0.25));
  float change = inverseRadius(row, phi + step) - inverseRadius(row, max(0.0, phi - step));
  float u = inverseRadius(row, phi);
  float k = energy / max(angular, 1e-8);
  return sign(change) * sqrt(max(0.0, k * k - u * u + u * u * u));
}

${SPECTRUM_SHADER}
float densityNoise(vec2 p);
float filteredDensity(vec2 p);
${STELLAR_SHADER}
${DISK_WAKE_SHADER}
${PLUNGE_SHADER}

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

float densityHash(ivec2 cell) {
  uint h = uint(cell.x) * 1597334677u ^ uint(cell.y) * 3812015801u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}

float densityNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(cell);
  vec4 corners = vec4(densityHash(c), densityHash(c + ivec2(1, 0)), densityHash(c + ivec2(0, 1)), densityHash(c + ivec2(1)));
  return mix(mix(corners.x, corners.y, f.x), mix(corners.z, corners.w, f.x), f.y);
}

// Remove only unresolved frequencies; keep resolved filaments sharp as the view changes.
float filteredDensity(vec2 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(densityNoise(p), 0.5, smoothstep(0.45, 1.2, footprint));
}

/** The disk where a ray crosses it: its light (rgb) and how opaque it is (a). */
vec4 disk(float r, float psi, float lambda, float energy, float delay) {
	float x = sqrt(2.0 * r);
	float x0 = sqrt(6.0);
	float root3 = sqrt(3.0);
	float integral = x - x0 - root3 * 0.5 * log(((x - root3) * (x0 + root3)) / ((x + root3) * (x0 - root3)));
	float flux = max(0.0, integral / (pow(x, 5.0) * (x*x - 3.0))) / FLUX_PEAK;
	float omega = sqrt(0.5 / (r * r * r));
	float g = sqrt(max(0.0, 1.0 - 1.5 / r)) / (max(0.00001, energy - omega * lambda * uSpin));
	float splashes;
	vec4 wake = diskWake(r, psi, uTime - delay + EPOCH, splashes);
	float materialRadius = clamp(r - wake.z * sqrt(1.0 - 1.0 / r), DISK_IN, DISK_OUT);
	float materialOmega = sqrt(0.5 / pow(materialRadius, 3.0));
	float materialAngle = psi - wake.w / r;
	vec3 matter = textureLod(uParticles, vec2((materialAngle - materialOmega * uSpin * delay) / TAU + 0.5, (materialRadius - DISK_IN) / (DISK_OUT - DISK_IN)), 0.0).rgb;
	float n = 1.0 - exp(-matter.r * 3.0);
	// Advected density filaments: each annulus keeps its own Keplerian angular rate.
	float phase = psi + omega * uSpin * (uTime - delay + EPOCH);
	vec2 flow = vec2(cos(phase - wake.w / r), sin(phase - wake.w / r)) * (9.0 - wake.z * 1.2);
	float clouds = filteredDensity(flow * 0.75 + vec2(r * 3.7, 0.0));
	float wisps = filteredDensity(flow * 2.5 + vec2(r * 24.0 + clouds * 3.0, r * 2.0));
	float fine = filteredDensity(flow * 14.0 + vec2(r * 70.0, r * 15.0));
	float structure = smoothstep(0.18, 0.82, 0.35 * clouds + 0.45 * wisps + 0.2 * fine);
	float strandPhase = (r - wake.z) * 47.0 + clouds * 9.0 + sin(phase * 4.0) * 1.4;
	float strand = pow(0.5 + 0.5 * sin(strandPhase), 14.0);
	strand = mix(strand, 0.15, smoothstep(0.8, 2.0, fwidth(strandPhase)));
	// Small thermal eddies co-rotate with the disk; compression heats the wake's edges.
	float ember = smoothstep(0.64, 0.9, fine) * smoothstep(0.48, 0.8, wisps);
	float breathing = 0.5 + 0.5 * sin((uTime - delay) * 0.24 + clouds * TAU);
	// A coherent hot eddy orbits and shears; delayed higher-order images follow it.
	float eddyAngle = atan(sin(phase + 2.35), cos(phase + 2.35));
	float eddy = exp(-pow((r - 4.9) / 0.38, 2.0) - pow(eddyAngle / 0.12, 2.0));
	// Local heat injection followed by proper-time cooling. Every image samples this same event.
	float eventAge = mod(uTime - delay + EPOCH - 8.0, 72.0) * sqrt(1.0 - 1.5 / 4.9);
	float flare = (1.0 - exp(-eventAge / 0.65)) * exp(-eventAge / 3.5);
	float tracer = smoothstep(0.04, 0.22, matter.g);
	// A finite emitting inner boundary feeds the plunge, instead of a black gap at the ISCO.
	float feed = 1.0 - smoothstep(3.0, 3.8, r);
	vec4 injection = inflowMaterial(phase, uTime - delay + EPOCH);
	float innerTemperature = 2050.0 * (0.86 + 0.17 * injection.x + 0.13 * injection.z + injection.w * 0.08);
	float temperature = mix(T_PEAK * pow(flux, 0.25), innerTemperature, feed);
	float t = temperature * (1.0 + 0.09 * ember * breathing + 0.45 * eddy * flare + 0.18 * wake.y + tracer * (0.04 + wake.y * 0.16)) * g;
	float edge = 1.0 - smoothstep(7.0, DISK_OUT, r);
	float baseDensity = 0.055 + 0.09 * n + 0.65 * structure + 0.32 * strand;
	float alpha = edge * clamp(baseDensity * (1.0 + min(0.0, wake.x)) + max(0.0, wake.x) * 0.36 + tracer * wake.y * 0.15 + splashes * 0.3, 0.015, 1.0);
	alpha = mix(alpha, 1.0 - exp(-(0.015 + 1.4 * pow(injection.y, 3.0) + 1.8 * injection.w) * 0.9), feed);
	vec3 radiance = blackbody(t) * (0.85 + 0.4 * strand + tracer * wake.y * 0.35);
	radiance += blackbody(T_PEAK * pow(flux, 0.25) * 1.52 * g) * splashes * 0.18;
	return vec4(radiance * uAccretion, alpha);
}

float filteredGaussian(float position, float widthSquared, float variance) {
  float width = widthSquared + 2.0 * variance;
  return sqrt(widthSquared / width) * exp(-position * position / width);
}
float skyDensity(vec2 position, vec2 dx, vec2 dy) {
  float footprint = max(length(dx), length(dy));
  return mix(densityNoise(position), 0.5, smoothstep(0.45, 1.2, footprint));
}

// An extended source at infinity makes aberration and multiple lensed images visible.
// Surface brightness gets a spectral shift, never the point-source magnification factor.
vec3 distantGalaxy(vec3 dir, vec3 dx, vec3 dy, float shift) {
  vec3 axis = normalize(vec3(0.35, 0.82, 0.45));
  float latitude = dot(dir, axis);
  vec2 gradient = vec2(dot(dx, axis), dot(dy, axis));
  float variance = dot(gradient, gradient) / 12.0;
  vec2 field = dir.xy + vec2(dir.z * 0.7, -dir.z * 0.9);
  vec2 fieldX = dx.xy + vec2(dx.z * 0.7, -dx.z * 0.9);
  vec2 fieldY = dy.xy + vec2(dy.z * 0.7, -dy.z * 0.9);
  float clouds = skyDensity(field * 17.0, fieldX * 17.0, fieldY * 17.0);
  float detail = skyDensity(field * 61.0 + vec2(clouds * 2.0, 0.0), fieldX * 61.0, fieldY * 61.0);
  float knots = skyDensity(field * 143.0, fieldX * 143.0, fieldY * 143.0);
  float lane = (clouds - 0.5) * 0.045;
  // Integrate the narrow emitting band and its dust lane over the same pixel footprint.
  float band = filteredGaussian(latitude, 0.009, variance);
  float absorbed = exp(-lane * lane / (0.009 + 0.000324))
    * filteredGaussian(latitude + lane * 0.009 / (0.009 + 0.000324), 0.009 * 0.000324 / (0.009 + 0.000324), variance);
  float density = max(0.0, band - 0.94 * absorbed) * (0.08 + 1.1 * clouds * clouds) * (0.22 + 0.78 * detail);
  // A resolved stellar bulge and young patches provide fixed landmarks in the same external sky.
  vec3 center = normalize(vec3(0.91, -0.40, 0.045));
  vec3 meridian = normalize(cross(axis, center));
  float along = dot(dir, meridian);
  vec2 alongGradient = vec2(dot(dx, meridian), dot(dy, meridian));
  float bulge = filteredGaussian(along, 0.045, dot(alongGradient, alongGradient) / 12.0)
    * filteredGaussian(latitude, 0.022, variance) * smoothstep(0.0, 0.65, dot(dir, center));
  float obscuredBulge = max(0.0, bulge - bulge * (absorbed / max(band, 1e-6)) * 0.86);
  float young = density * smoothstep(0.55, 0.85, detail) * (0.2 + 0.8 * knots);
  return shiftedSpectrum(4300.0, shift) * (density + obscuredBulge * 0.6) * 0.0038
    + shiftedSpectrum(9000.0, shift) * young * 0.00022;
}

void main() {
	vec2 offset = (gl_FragCoord.xy - uCenter) * uSensor;
	float rho = length(offset);
	float angle = mix(atan(rho * uLens.x), 2.0 * atan(rho * uLens.y), uLens.z);
	vec3 local = vec3(rho > 1e-8 ? offset * (sin(angle) / rho) : vec2(0.0), cos(angle));
	vec3 dir = normalize(uCamera * local);
	vec3 e1 = uEye / uDistance;
	float cosA = dot(dir, e1);
	vec3 across = dir - cosA * e1;
	float sinA = length(across);
	vec3 e2 = sinA > 1e-7 ? across / sinA : normalize(cross(e1, vec3(1.0, 0.0, 0.0)));
	float angular = uDistance * sinA;
  float energy = 1.0 + cosA / sqrt(uDistance);
  float row = rowOf(acos(clamp(-cosA, -1.0, 1.0)));
  float end = endOf(row);
  float phiEnd = abs(end);
  vec3 away = cos(phiEnd) * e1 + sin(phiEnd) * e2;
	vec3 skyX = dFdx(away);
	vec3 skyY = dFdy(away);

	vec3 light = vec3(0.0);
	float through = 1.0;
	{
		vec3 normal = cross(e1, e2);
		float diskPhi = mod(atan(e2.y, e1.y) + 0.5 * PI, PI);
		float starImageA = starIntersection(row, angular, energy, phiEnd, e1, e2, 0.0);
		float starImageB = starIntersection(row, angular, energy, phiEnd, e1, e2, TAU);
		float starPhi = min(starImageA, starImageB);
		float starSecond = max(starImageA, starImageB);
		int diskCount = 0;
		for (int k = 0; k < 5; k++) {
			float phi = diskPhi;
			bool stellar = starPhi < phi;
			if (stellar) { phi = starPhi; starPhi = starSecond; starSecond = 1e5; }
			else { diskCount++; diskPhi = diskCount >= uImages ? 1e5 : diskPhi + PI; }
			if (phi >= phiEnd || through < 0.01) {
				break;
			}
			float u = inverseRadius(row, phi);
			if (u <= 0.0 || u > 1.0 / PLUNGE_MIN) {
				continue;
			}
			float r = 1.0 / u;
			vec3 hit = r * (cos(phi) * e1 + sin(phi) * e2);
			float delay = travelTime(row, phi);
			vec4 emission;
			if (stellar) {
				vec3 radial = normalize(hit);
				vec3 tangent = -sin(phi) * e1 + cos(phi) * e2;
				float slope = pathSlope(row, phi, phiEnd, angular, energy);
				float radialCovector = (angular * slope + sqrt(u) * energy) / (1.0 - u);
        vec3 photonCovector = radialCovector * radial - angular * u * tangent;
				emission = photosphere(hit, uTime - delay + EPOCH, photonCovector, energy);
			} else {
				if (r > DISK_OUT) continue;
				float psi = atan(hit.z, hit.x);
				float lambda = -angular * normal.y;
				if (r >= DISK_IN) emission = disk(r, psi, lambda, energy, delay);
				else emission = plungingDisk(r, psi, lambda, angular, energy, pathSlope(row, phi, phiEnd, angular, energy), delay);
			}
			light += through * emission.rgb * emission.a;
			through *= 1.0 - emission.a;
		}
	}
	if (end > 0.0 && uStars > 0.0) {
		float shift = 1.0 / max(energy, 0.0001);
		light += through * distantGalaxy(away, skyX, skyY, shift) * uStars;
	}
  light += through * texelFetch(uPointSky, ivec2(gl_FragCoord.xy), 0).rgb;
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

const METER = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 light = (texture(uSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb
    + texture(uSource, vUv + uTexel * vec2(1.0, -1.0)).rgb
    + texture(uSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb
    + texture(uSource, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  float luminance = dot(light, vec3(0.2126, 0.7152, 0.0722));
  float weight = smoothstep(0.003, 0.03, luminance);
  // Weighted log light: empty space and a single point source cannot dominate the exposure.
  outColor = vec4((log(max(luminance, 1e-8)) + 20.0) / 40.0 * weight, weight, 0.0, 1.0);
}`;

const ADAPT = `#version 300 es
precision highp float;
uniform sampler2D uMeter;
uniform sampler2D uPrevious;
uniform float uBlend;
out vec4 outColor;
void main() {
  vec2 meter = texelFetch(uMeter, ivec2(0), 0).rg;
  float mean = meter.y > 1e-6 ? exp(meter.x / meter.y * 40.0 - 20.0) : 0.0;
  float target = (log(5.0 / (1.0 + mean / 0.18)) + 24.0) / 28.0;
  float previous = texelFetch(uPrevious, ivec2(0), 0).r;
  outColor = vec4(mix(previous, target, uBlend), 0.0, 0.0, 1.0);
}`;

const COMPOSE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uGlow0;
uniform sampler2D uGlow1;
uniform sampler2D uGlow2;
uniform sampler2D uGlow3;
uniform sampler2D uGlow4;
uniform sampler2D uExposure;
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
	vec3 glow = texture(uGlow0, vUv).rgb * 0.6 + texture(uGlow1, vUv).rgb * 0.25 + texture(uGlow2, vUv).rgb * 0.1 + texture(uGlow3, vUv).rgb * 0.04 + texture(uGlow4, vUv).rgb * 0.01;
	vec3 light = mix(scene.rgb, glow, 0.018) * exp(texelFetch(uExposure, ivec2(0), 0).r * 28.0 - 24.0);
	// Luminance tone mapping preserves the thermal colour in bright filaments.
	float luminance = dot(light, vec3(0.2126, 0.7152, 0.0722));
	vec3 mapped = light * (aces(vec3(luminance)).x / max(luminance, 1e-6));
	mapped /= max(1.0, max(mapped.r, max(mapped.g, mapped.b)));
	vec3 colour = encode(mapped);
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
  let skyProgram: Program;
  let meterProgram: Program;
  let adaptProgram: Program;
  try {
    scene = compile(gl, SCENE, [
      "uTable",
      "uEnds",
      "uParticles",
      "uTimes",
      "uSpectrum",
      "uOrbit",
      "uOrbitClock",
      "uImages",
      "uCenter",
      "uSensor",
      "uLens",
      "uCamera",
      "uEye",
      "uGrid",
      "uDistance",
      "uClockOrigin",
      "uTime",
      "uAccretion",
      "uSpin",
      "uStars",
      "uPointSky",
      "uPlunge",
      "uPlungeClock",
      "uWakeHistoryCount",
      "uWakeHistory",
    ]);
    downsample = compile(gl, DOWNSAMPLE, ["uSource", "uTexel"]);
    blur = compile(gl, BLUR, ["uSource", "uStep"]);
    meterProgram = compile(gl, METER, ["uSource", "uTexel"]);
    adaptProgram = compile(gl, ADAPT, ["uMeter", "uPrevious", "uBlend"]);
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
    skyProgram = compile(
      gl,
      SKY_FRAGMENT,
      [
        "uEnds",
        "uSpectrum",
        "uGrid",
        "uSkyFirst",
        "uDistance",
        "uRadial",
        "uCamera",
        "uLens",
        "uViewport",
        "uCenter",
        "uSensor",
        "uStars",
      ],
      SKY_VERTEX
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
    return null;
  }

  const table = infallTable(initial.distance);
  const tableTexture = dataTexture(gl, table.phiCount, table.rows, table.u);
  const endsTexture = dataTexture(gl, table.rows, 1, table.ends);
  const timesTexture = dataTexture(gl, table.phiCount, table.rows, table.times);
  const spectrumTexture = dataTexture(
    gl,
    SPECTRUM_SAMPLES,
    1,
    createSpectrum(),
    true
  );
  const orbit = createStellarOrbit();
  const orbitTexture = dataTexture(gl, STAR_SAMPLES, 1, orbit.data, true);
  const sky = createPointSky(gl);
  const particles = createDiskParticles(gl, particleProgram.program);
  const wake = createDiskWake();
  const wakeTexture = dataTexture(
    gl,
    WAKE_TEXELS,
    WAKE_HISTORY,
    wake.textureData,
    true
  );
  let wakeRevision = wake.revision;
  const plunge = createPlungingFlow();
  const plungeTexture = dataTexture(gl, PLUNGE_SAMPLES, 1, plunge.data, true);
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
  let skyTarget: Target | null = null;
  /** Per level: the downsampled picture and the one it is blurred through. */
  let glow: [Target, Target][] = [];
  const meterFirst = target(64, 64);
  const meterTargets = [
    meterFirst,
    ...[32, 16, 8, 4, 2, 1].map((size) => target(size, size)),
  ];
  const exposures = [target(1, 1), target(1, 1)] as const;
  let exposureIndex: 0 | 1 = 0;
  let lastExposure = 0;

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

  // Global adaptation follows actual scene light and applies one exposure to the entire frame.
  const adaptExposure = (source: Target) => {
    const meterAt = bind(meterProgram);
    texture(0, source.texture);
    gl.uniform1i(meterAt("uSource"), 0);
    gl.uniform2f(meterAt("uTexel"), 0.25 / source.width, 0.25 / source.height);
    let meterSource = meterFirst;
    pass(meterSource);
    for (const down of meterTargets.slice(1)) {
      const shrink = bind(downsample);
      texture(0, meterSource.texture);
      gl.uniform1i(shrink("uSource"), 0);
      gl.uniform2f(
        shrink("uTexel"),
        0.5 / meterSource.width,
        0.5 / meterSource.height
      );
      pass(down);
      meterSource = down;
    }
    const previous = exposures[exposureIndex];
    exposureIndex = exposureIndex === 0 ? 1 : 0;
    const exposure = exposures[exposureIndex];
    const adaptAt = bind(adaptProgram);
    texture(0, meterSource.texture);
    texture(1, previous.texture);
    gl.uniform1i(adaptAt("uMeter"), 0);
    gl.uniform1i(adaptAt("uPrevious"), 1);
    const now = performance.now();
    gl.uniform1f(
      adaptAt("uBlend"),
      lastExposure
        ? 1 - Math.exp(-Math.max(0, (now - lastExposure) / 1000) * 2)
        : 1
    );
    lastExposure = now;
    pass(exposure);
    return exposure;
  };

  return {
    dispose() {
      free([
        ...(sceneTarget ? [sceneTarget] : []),
        ...(skyTarget ? [skyTarget] : []),
        ...glow.flat(),
        ...meterTargets,
        ...exposures,
      ]);
      gl.deleteTexture(tableTexture);
      gl.deleteTexture(endsTexture);
      gl.deleteTexture(timesTexture);
      gl.deleteTexture(spectrumTexture);
      gl.deleteTexture(orbitTexture);
      gl.deleteTexture(plungeTexture);
      gl.deleteTexture(wakeTexture);
      sky.dispose();
      particles.dispose();
      gpu.dispose();
      gl.deleteVertexArray(vao);
      for (const each of [
        scene,
        downsample,
        blur,
        compose,
        particleProgram,
        skyProgram,
        meterProgram,
        adaptProgram,
      ]) {
        gl.deleteProgram(each.program);
      }
    },
    disturb(x, y, time, strength, impact = false) {
      const hit = pickDisk(table, view, width, height, x, y);
      if (!hit) {
        return false;
      }
      wake.push(hit, time - hit.delay + DISTANCE, strength, {
        impact,
        observedTime: time,
        spin: view.spin,
      });
      canvas.dataset.diskImpulses = String(wake.count);
      return true;
    },

    draw({ accretion, time }) {
      if (!(sceneTarget && skyTarget)) {
        return;
      }
      gpu.begin();
      wake.seek(time + DISTANCE);
      if (wakeRevision !== wake.revision) {
        gl.bindTexture(gl.TEXTURE_2D, wakeTexture);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          WAKE_TEXELS,
          WAKE_HISTORY,
          gl.RGBA,
          gl.FLOAT,
          wake.textureData
        );
        wakeRevision = wake.revision;
      }
      canvas.dataset.diskImpulses = String(wake.count);
      canvas.dataset.diskHistory = String(wake.historyCount);

      const { basis, eye } = cameraOf(view);
      particles.draw(time + DISTANCE, view.spin);
      const half = (view.fov * Math.PI) / 360;
      const skyAt = bind(skyProgram);
      texture(0, endsTexture);
      texture(1, spectrumTexture);
      gl.uniform1i(skyAt("uEnds"), 0);
      gl.uniform1i(skyAt("uSpectrum"), 1);
      gl.uniform4f(
        skyAt("uGrid"),
        table.rows,
        table.below,
        table.critical,
        table.phiCount
      );
      gl.uniform1i(skyAt("uSkyFirst"), firstSkyRow(table));
      gl.uniform1f(skyAt("uDistance"), table.distance);
      gl.uniform3f(
        skyAt("uRadial"),
        eye[0] / table.distance,
        eye[1] / table.distance,
        eye[2] / table.distance
      );
      gl.uniformMatrix3fv(skyAt("uCamera"), false, basis);
      gl.uniform3f(
        skyAt("uLens"),
        Math.tan(half),
        Math.tan(half * 0.5),
        view.panorama ?? 0
      );
      gl.uniform2f(skyAt("uViewport"), width, height);
      gl.uniform2f(skyAt("uCenter"), view.x * width, (1 - view.y) * height);
      gl.uniform1f(skyAt("uSensor"), 2 / Math.min(width, height));
      gl.uniform1f(skyAt("uStars"), view.stars);
      gl.bindFramebuffer(gl.FRAMEBUFFER, skyTarget.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      sky.draw();
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vao);
      const at = bind(scene);
      texture(0, tableTexture);
      texture(1, endsTexture);
      texture(2, particles.texture);
      texture(3, spectrumTexture);
      texture(4, timesTexture);
      texture(5, orbitTexture);
      texture(6, skyTarget.texture);
      texture(7, plungeTexture);
      texture(8, wakeTexture);
      gl.uniform1i(at("uTable"), 0);
      gl.uniform1i(at("uEnds"), 1);
      gl.uniform1i(at("uParticles"), 2);
      gl.uniform1i(at("uSpectrum"), 3);
      gl.uniform1i(at("uTimes"), 4);
      gl.uniform1i(at("uOrbit"), 5);
      gl.uniform1i(at("uPointSky"), 6);
      gl.uniform1i(at("uPlunge"), 7);
      gl.uniform2f(at("uPlungeClock"), plunge.clock, plunge.proper);
      gl.uniform1i(at("uWakeHistory"), 8);
      gl.uniform4f(
        at("uOrbitClock"),
        orbit.period,
        orbit.advance,
        orbit.offset,
        orbit.orientation
      );
      gl.uniform1i(at("uImages"), HOLE_QUALITY[quality].images);
      gl.uniform2f(at("uCenter"), view.x * width, (1 - view.y) * height);
      gl.uniform1f(at("uSensor"), 2 / Math.min(width, height));
      gl.uniform3f(
        at("uLens"),
        Math.tan(half),
        Math.tan(half * 0.5),
        view.panorama ?? 0
      );
      gl.uniformMatrix3fv(at("uCamera"), false, basis);
      gl.uniform3f(at("uEye"), eye[0], eye[1], eye[2]);
      gl.uniform4f(
        at("uGrid"),
        table.rows,
        table.below,
        table.critical,
        table.phiCount
      );
      gl.uniform1f(at("uDistance"), table.distance);
      gl.uniform1f(at("uClockOrigin"), radialClock(table.distance));
      gl.uniform1f(at("uTime"), time);
      gl.uniform1f(at("uAccretion"), accretion);
      gl.uniform1f(at("uSpin"), view.spin);
      gl.uniform1f(at("uStars"), view.stars);
      gl.uniform1i(at("uWakeHistoryCount"), wake.historyCount);
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

      const exposure = adaptExposure(source);

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
      texture(6, exposure.texture);
      gl.uniform1i(finish("uExposure"), 6);
      pass(null);
      gpu.end();
    },
    gpuTime: gpu.read,
    quality(next) {
      if (quality !== next) {
        quality = next;
        particles.setQuality(next);
      }
      canvas.dataset.holeQuality = next;
      canvas.dataset.holeParticles = String(HOLE_QUALITY[next].particles);
    },

    resize(cssWidth, cssHeight, ratio) {
      const { width: nextWidth, height: nextHeight } = drawingSize(
        cssWidth,
        cssHeight,
        ratio,
        quality
      );
      if (
        nextWidth === width &&
        nextHeight === height &&
        sceneTarget &&
        skyTarget &&
        glow.length === HOLE_QUALITY[quality].bloom
      ) {
        return;
      }
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      free([
        ...(sceneTarget ? [sceneTarget] : []),
        ...(skyTarget ? [skyTarget] : []),
        ...glow.flat(),
      ]);
      sceneTarget = target(width, height);
      skyTarget = target(width, height);
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
      if (Math.abs(table.distance - next.distance) > 1e-7) {
        infallTable(next.distance, table);
        for (const [source, data, tw, th] of [
          [tableTexture, table.u, table.phiCount, table.rows],
          [timesTexture, table.times, table.phiCount, table.rows],
          [endsTexture, table.ends, table.rows, 1],
        ] as const) {
          gl.bindTexture(gl.TEXTURE_2D, source);
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            tw,
            th,
            gl.RED,
            gl.FLOAT,
            data
          );
        }
      }
    },
  };
}
