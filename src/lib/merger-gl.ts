import { MERGER_SHADER, PEAK_AMPLITUDE } from "./binary-merger";

/**
 * Renderer for the binary merger: every pixel follows a light ray backwards
 * through the field of both holes, so their shadows, photon rings and the
 * lensed sky come from the bending of light itself. Each hole bends a ray as
 * d²x/dλ² = -(3/2) r_s h² x / r⁵ (h = |x × dx/dλ|), which reproduces the
 * Schwarzschild orbit equation u'' + u = (3/2) r_s u² exactly for one hole;
 * the two fields are summed (a weak-field superposition, honest far from the
 * pair and an approximation in the gap between the horizons).
 *
 * The orbital plane carries a strain map: where a ray crosses it, the colour
 * shows the outgoing quadrupole wave r·h₊ at that point, evaluated at the
 * retarded time t − r. It is a diagnostic overlay, like a frequency map: the
 * real strain is far too small to see by eye.
 */

export interface MergerView {
  /** Azimuth around the orbital axis, in degrees. */
  azimuth: number;
  /** Camera distance from the centre of mass, in M. */
  distance: number;
  /** Elevation above the orbital plane, in degrees. */
  elevation: number;
  /** Vertical field of view, in degrees. */
  fov: number;
}

export interface MergerFrame {
  holes: [number, number, number][];
  /** Mass of each hole, in M. */
  mass: number;
  time: number;
  /** 0 hides the strain map, 1 shows it. */
  waves: number;
}

const VERTEX = `#version 300 es
const vec2 CORNERS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
	gl_Position = vec4(CORNERS[gl_VertexID], 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uEye;
uniform mat3 uBasis;
uniform float uTanHalf;
uniform vec3 uHoleA;
uniform vec3 uHoleB;
uniform float uMass;
uniform float uTime;
uniform float uWaves;
out vec4 color;
${MERGER_SHADER}
const float PEAK = ${PEAK_AMPLITUDE.toFixed(6)};
const float FAR = 90.0;
const int STEPS = 220;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}
float noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	vec3 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
			mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
		mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
			mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
		u.z);
}
float fbm(vec3 p) {
	float sum = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 5; i++) {
		sum += amp * noise(p);
		p = p * 2.03 + 17.1;
		amp *= 0.5;
	}
	return sum;
}

// One layer of point stars: a star per lucky cell, drawn with a footprint of
// at least one pixel. Where lensing magnifies the sky the footprint in the sky
// shrinks, so stars stretch into arcs with their surface brightness kept.
vec3 starLayer(vec3 dir, float cells, float chance, float pixel) {
	vec3 p = dir * cells;
	vec3 cell = floor(p);
	vec3 h = hash33(cell);
	if (h.x > chance) {
		return vec3(0.0);
	}
	vec3 star = cell + 0.25 + 0.5 * hash33(cell + 7.0);
	float d = length(p - star) / cells;
	float size = max(pixel, 0.00035);
	float flux = pow(h.y, 6.0) * 2.2 + 0.05;
	float temperature = h.z;
	vec3 tint = mix(vec3(1.0, 0.72, 0.48), vec3(0.72, 0.84, 1.0), smoothstep(0.15, 0.85, temperature));
	return tint * flux * exp(-0.5 * d * d / (size * size)) * min(1.0, (pixel * pixel) / (size * size));
}

vec3 sky(vec3 dir, float pixel) {
	vec3 bandNormal = normalize(vec3(0.42, 0.82, -0.4));
	vec3 core = normalize(cross(bandNormal, vec3(0.2, 0.0, 1.0)));
	float b = dot(dir, bandNormal);
	float toCore = dot(dir, core);
	float cloud = fbm(dir * 5.0);
	float detail = fbm(dir * 17.0 + 3.0);
	float band = exp(-b * b / (0.018 + 0.03 * cloud)) * (0.35 + 0.9 * cloud * detail);
	float bulge = exp(-(1.0 - toCore) * 7.0) * exp(-b * b / 0.04);
	float dust = smoothstep(0.42, 0.62, fbm(dir * 9.0 + 11.0)) * exp(-b * b / 0.004);
	vec3 milk = vec3(0.55, 0.6, 0.78) * band * 0.07 + vec3(1.0, 0.78, 0.52) * bulge * 0.18;
	milk *= 1.0 - 0.75 * dust;
	vec3 stars = starLayer(dir, 50.0, 0.35, pixel)
		+ starLayer(dir, 130.0, 0.18, pixel) * 0.6
		+ starLayer(dir, 320.0, 0.06 + 0.3 * band, pixel) * 0.4;
	return milk + stars + vec3(0.002, 0.003, 0.006);
}

vec3 bend(vec3 x, vec3 v, vec3 hole, float rs) {
	vec3 d = x - hole;
	float r2 = dot(d, d);
	vec3 l = cross(d, v);
	return -1.5 * rs * dot(l, l) * d / (r2 * r2 * sqrt(r2));
}
vec3 accel(vec3 x, vec3 v, float rs) {
	return bend(x, v, uHoleA, rs) + bend(x, v, uHoleB, rs);
}

// Diverging strain colour: stretched along one axis (cool), the other (warm).
vec3 strainColor(float s) {
	vec3 cool = vec3(0.25, 0.62, 1.0);
	vec3 warm = vec3(1.0, 0.5, 0.2);
	return s > 0.0 ? cool * s : warm * -s;
}

vec4 strainAt(vec3 p) {
	float r = length(p.xz);
	float phi = atan(p.z, p.x);
	vec2 w = wave(uTime - r);
	float wavePhase = w.y - 2.0 * phi;
	float strength = min(1.0, w.x / PEAK);
	float s = strength * cos(wavePhase);
	// Inside about a wavelength the field is not yet a wave (near zone).
	float near = smoothstep(2.5, 7.0, r);
	float far = exp(-r / 60.0);
	// Crests (stretch along x) and troughs (squeeze) drawn as bright fronts.
	float front = pow(abs(cos(wavePhase)), 14.0);
	// The map stops short of the horizons, where space is no longer a flat sheet.
	float rs = 2.0 * uMass;
	float clear = smoothstep(1.6 * rs, 3.5 * rs, min(length(p - uHoleA), length(p - uHoleB)));
	float alpha = near * far * clear * strength * (0.08 + 0.7 * front);
	return vec4(strainColor(sign(s)) * (0.6 + 1.6 * front), alpha * uWaves);
}

void main() {
	vec2 ndc = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
	vec3 v = normalize(uBasis * vec3(ndc * uTanHalf, 1.0));
	vec3 x = uEye;
	float rs = 2.0 * uMass;
	bool captured = false;
	bool escaped = false;
	vec3 overlay = vec3(0.0);
	float through = 1.0;
	for (int i = 0; i < STEPS; i++) {
		vec3 da = x - uHoleA;
		vec3 db = x - uHoleB;
		float ra = length(da);
		float rb = length(db);
		// Inside the common horizon of the pair (exact for one hole), or inside
		// a photon sphere and still falling: such light never comes back out.
		bool fallingA = ra < 1.5 * rs && dot(da, v) < 0.0;
		bool fallingB = rb < 1.5 * rs && dot(db, v) < 0.0;
		if (rs / ra + rs / rb > 1.0 || fallingA || fallingB) {
			captured = true;
			break;
		}
		if (dot(x, x) > FAR * FAR && dot(x, v) > 0.0) {
			escaped = true;
			break;
		}
		float near = min(ra, rb);
		float step = clamp(0.18 * near, 0.015, 3.0) / length(v);
		vec3 a1 = accel(x, v, rs);
		vec3 xm = x + 0.5 * step * v;
		vec3 vm = v + 0.5 * step * a1;
		vec3 a2 = accel(xm, vm, rs);
		vec3 next = x + step * vm;
		v += step * a2;
		if (x.y * next.y < 0.0 && through > 0.02) {
			vec3 hit = mix(x, next, x.y / (x.y - next.y));
			vec4 strain = strainAt(hit);
			overlay += through * strain.a * strain.rgb;
			through *= 1.0 - strain.a;
		}
		x = next;
	}
	vec3 dir = normalize(v);
	vec3 dx = dFdx(dir);
	vec3 dy = dFdy(dir);
	float pixel = clamp(sqrt(max(length(dx) * length(dy), 1e-12)), 1e-5, 0.02);
	// A ray still winding near the photon spheres after all steps is treated as lost.
	vec3 light = captured || !escaped ? vec3(0.0) : sky(dir, pixel);
	light = light * through + overlay;
	// Filmic shoulder that keeps hue, then sRGB encoding.
	float peak = max(max(light.r, light.g), light.b);
	vec3 mapped = peak > 0.0 ? light / peak * (1.0 - exp(-peak * 1.6)) : vec3(0.0);
	color = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}`;

export interface MergerRenderer {
  dispose: () => void;
  draw: (frame: MergerFrame) => void;
  resize: (width: number, height: number, ratio: number) => void;
  view: (next: MergerView) => void;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log ?? "shader");
  }
  return shader;
}

/** Orthonormal camera basis (right, up, forward) looking at the origin. */
export function mergerCamera(view: MergerView) {
  const az = (view.azimuth * Math.PI) / 180;
  const el = (view.elevation * Math.PI) / 180;
  const eye: [number, number, number] = [
    view.distance * Math.cos(el) * Math.sin(az),
    view.distance * Math.sin(el),
    view.distance * Math.cos(el) * Math.cos(az),
  ];
  const forward = eye.map((value) => -value / view.distance);
  const [fx = 0, fy = 0, fz = 0] = forward;
  const rightLength = Math.hypot(fz, fx) || 1;
  const right = [-fz / rightLength, 0, fx / rightLength];
  const [rx = 0, ry = 0, rz = 0] = right;
  const up = [ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx];
  return { basis: [...right, ...up, ...forward], eye };
}

export function createMergerRenderer(
  canvas: HTMLCanvasElement
): MergerRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  if (!gl) {
    return null;
  }
  const program = gl.createProgram();
  try {
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "link");
    }
  } catch (error) {
    console.error(error);
    return null;
  }
  const names = [
    "uResolution",
    "uEye",
    "uBasis",
    "uTanHalf",
    "uHoleA",
    "uHoleB",
    "uMass",
    "uTime",
    "uWaves",
  ] as const;
  const at = Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)])
  ) as Record<(typeof names)[number], WebGLUniformLocation | null>;
  const vao = gl.createVertexArray();
  let camera = mergerCamera({
    azimuth: 0,
    distance: 30,
    elevation: 25,
    fov: 50,
  });
  let tanHalf = Math.tan((25 * Math.PI) / 180);
  return {
    dispose() {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
    draw(frame) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      const [a = [0, 0, 0], b = [0, 0, 0]] = frame.holes;
      gl.uniform2f(at.uResolution, canvas.width, canvas.height);
      gl.uniform3fv(at.uEye, camera.eye);
      gl.uniformMatrix3fv(at.uBasis, false, camera.basis);
      gl.uniform1f(at.uTanHalf, tanHalf);
      gl.uniform3fv(at.uHoleA, a);
      gl.uniform3fv(at.uHoleB, b);
      gl.uniform1f(at.uMass, frame.mass);
      gl.uniform1f(at.uTime, frame.time);
      gl.uniform1f(at.uWaves, frame.waves);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    resize(width, height, ratio) {
      // The ray march is heavy; a lighter pixel grid keeps it fluid.
      const pixels = 900_000;
      const scale = Math.min(
        Math.min(ratio, 1.5) * 0.75,
        Math.sqrt(pixels / Math.max(1, width * height))
      );
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
    },
    view(next) {
      camera = mergerCamera(next);
      tanHalf = Math.tan((next.fov * Math.PI) / 360);
    },
  };
}
