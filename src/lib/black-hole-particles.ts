import type { DiskHit } from "./black-hole-hit";
import { HOLE_QUALITY, type HoleQuality } from "./black-hole-quality";

const MAX_TRAILS = 12;
const TRAIL_LIFE_MS = 2400;
const STAMP_INTERVAL_MS = 65;

// The same disk-space obstacle drives particle deflection and the smooth gas opacity.
// Taking the strongest wake keeps a stationary cursor from accumulating a giant hole.
const WAKE_FIELD = `
uniform vec4 uTrails[12]; // radius, advected angle, strength, age
uniform int uTrailCount;
vec4 wakeAt(vec2 position) {
 vec2 push = vec2(0.0);
 float clearing = 0.0;
 float heat = 0.0;
 for (int i = 0; i < 12; i++) {
  if (i >= uTrailCount) break;
  vec4 trail = uTrails[i];
  vec2 normal = vec2(cos(trail.y), sin(trail.y));
  vec2 tangent = vec2(-normal.y, normal.x);
  vec2 delta = position - trail.x * normal;
  float across = dot(delta, normal);
  float along = dot(delta, tangent);
  float width = 0.24 + trail.w * 0.06;
  float length = 0.48 + trail.w * 0.8;
  float envelope = exp(-pow(along / length, 2.0)) * trail.z;
  float core = exp(-pow(across / width, 2.0)) * envelope;
  float rim = exp(-pow((abs(across) - width * 1.5) / (width * 0.55), 2.0)) * envelope;
  heat = max(heat, rim * 0.65);
  if (core > clearing) {
   clearing = core;
   push = normal * (across < 0.0 ? -1.0 : 1.0) * width * 1.6 * core;
  }
 }
 return vec4(push, heat, clearing);
}`;

export const WAKE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${WAKE_FIELD}
void main() {
 float angle = (vUv.x - 0.5) * 6.28318530718;
 float radius = 3.0 + vUv.y * 8.0;
 vec4 wake = wakeAt(radius * vec2(cos(angle), sin(angle)));
 outColor = vec4(0.0, wake.z, wake.w, 0.0);
}`;

export const PARTICLE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 aSeed; // radius, orbital phase, size, luminosity
uniform float uTime;
uniform float uSpin;
uniform float uPointScale;
${WAKE_FIELD}
out float vLight;
out float vHeat;
const float TAU = 6.28318530718;
void main() {
	float radius = aSeed.x;
	float omega = sqrt(0.5 / (radius * radius * radius));
	float angle = aSeed.y - uSpin * omega * uTime;
	vec2 position = radius * vec2(cos(angle), sin(angle));
	vec4 wake = wakeAt(position);
	position += wake.xy;
	float heat = wake.z;
	radius = length(position);
	angle = atan(position.y, position.x);
	float wrap = float(gl_InstanceID) - 1.0;
	vec2 uv = vec2(fract(angle / TAU + 0.5) + wrap, (radius - 3.0) / 8.0);
	gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
	// Wider, softer splats overlap into gas instead of exposing individual grains.
	gl_PointSize = (4.0 + aSeed.z * 3.0) * uPointScale * (1.0 + heat * 0.18);
	vLight = (0.75 + aSeed.w * 0.25) * 0.2;
	vHeat = heat;
}`;

export const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in float vLight;
in float vHeat;
out vec4 outColor;
void main() {
	vec2 p = gl_PointCoord * 2.0 - 1.0;
	float spot = exp(-dot(p, p) * 4.0) * vLight;
	outColor = vec4(spot, spot * vHeat, 0.0, 1.0);
}`;

interface Stamp extends DiskHit {
  birth: number;
  strength: number;
  time: number;
}

/** Fixed GPU particles rendered into a polar atlas, then seen through the ray-traced disk's actual lens. */
export function createDiskParticles(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  wakeProgram: WebGLProgram
) {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  if (!(texture && framebuffer && buffer && vao)) {
    throw new Error("WebGL: no particle buffers");
  }
  const seeds = new Float32Array(HOLE_QUALITY.high.particles * 4);
  let seed = 73;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return seed / 4_294_967_296;
  };
  for (let i = 0; i < seeds.length; i += 4) {
    seeds[i] = 3.03 + random() ** 1.35 * 7.94;
    seeds[i + 1] = random() * Math.PI * 2;
    seeds[i + 2] = random();
    seeds[i + 3] = random();
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  const uniforms = {
    count: gl.getUniformLocation(program, "uTrailCount"),
    scale: gl.getUniformLocation(program, "uPointScale"),
    spin: gl.getUniformLocation(program, "uSpin"),
    time: gl.getUniformLocation(program, "uTime"),
    trails: gl.getUniformLocation(program, "uTrails[0]"),
  };
  const trailData = new Float32Array(MAX_TRAILS * 4);
  const wakeUniforms = {
    count: gl.getUniformLocation(wakeProgram, "uTrailCount"),
    trails: gl.getUniformLocation(wakeProgram, "uTrails[0]"),
  };
  let trails: Stamp[] = [];
  let lastStamp = 0;
  let quality: HoleQuality = "balanced";
  const setQuality = (next: HoleQuality) => {
    quality = next;
    const level = HOLE_QUALITY[next];
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // RGBA8 supports additive point blending on every WebGL 2 implementation, including mobile.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      level.atlasWidth,
      level.atlasHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );
  };
  setQuality(quality);
  return {
    clear() {
      trails = [];
      lastStamp = 0;
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
    draw(time: number, spin: number, hit: DiskHit | null, energy: number) {
      const now = performance.now();
      const level = HOLE_QUALITY[quality];
      trails = trails.filter((stamp) => now - stamp.birth < TRAIL_LIFE_MS);
      if (hit && now - lastStamp >= STAMP_INTERVAL_MS) {
        trails.push({
          ...hit,
          birth: now,
          strength: 0.85 + energy * 0.15,
          time,
        });
        lastStamp = now;
      }
      if (trails.length > level.trails) {
        trails.splice(0, trails.length - level.trails);
      }
      trailData.fill(0);
      for (const [i, stamp] of trails.entries()) {
        const age = (now - stamp.birth) / 1000;
        trailData[i * 4] = stamp.radius;
        trailData[i * 4 + 1] =
          stamp.angle -
          spin * Math.sqrt(0.5 / stamp.radius ** 3) * (time - stamp.time);
        trailData[i * 4 + 2] =
          stamp.strength * Math.exp(-age * 4.2) * Math.min(1, (2.4 - age) * 3);
        trailData[i * 4 + 3] = age;
      }
      // Keep the obstacle under the live cursor between stamps; only its wake advects.
      if (hit && trails.length > 0) {
        const offset = (trails.length - 1) * 4;
        trailData[offset] = hit.radius;
        trailData[offset + 1] = hit.angle;
        trailData[offset + 2] = 0.85 + energy * 0.15;
        trailData[offset + 3] = 0;
      }
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram is not a React hook
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, level.atlasWidth, level.atlasHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.spin, spin);
      gl.uniform1f(
        uniforms.scale,
        Math.sqrt(
          (level.atlasWidth * level.atlasHeight) / level.particles / 9.36
        )
      );
      gl.uniform4fv(uniforms.trails, trailData);
      gl.uniform1i(uniforms.count, trails.length);
      // The two adjacent copies preserve particles crossing the angular seam.
      gl.drawArraysInstanced(gl.POINTS, 0, level.particles, 3);
      // Bake the gap into the small atlas once, so all lensed disk images share it.
      // No additional wake loops in the expensive full-resolution ray tracer.
      if (trails.length > 0) {
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram is not a React hook
        gl.useProgram(wakeProgram);
        gl.uniform4fv(wakeUniforms.trails, trailData);
        gl.uniform1i(wakeUniforms.count, trails.length);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    },
    setQuality,
    texture,
  };
}
