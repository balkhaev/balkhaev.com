import { HOLE_QUALITY, type HoleQuality } from "./black-hole-quality";

export const PARTICLE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 aSeed;
uniform float uTime;
uniform float uSpin;
uniform float uPointScale;
uniform vec2 uAtlasSize;
uniform float uWrap;
out float vLight;
out vec2 vLocal;
out float vSeed;
const float TAU = 6.28318530718;
const vec2 CORNERS[6] = vec2[6](vec2(-1.0,-1.0), vec2(1.0,-1.0), vec2(-1.0,1.0),
  vec2(-1.0,1.0), vec2(1.0,-1.0), vec2(1.0,1.0));
void main() {
  float radius = aSeed.x;
  float omega = sqrt(0.5 / (radius * radius * radius));
  vec2 corner = CORNERS[gl_VertexID];
  vLocal = corner * 0.5 + 0.5;
  float duration = 1.5 + aSeed.z * 2.5;
  float angle = aSeed.y - uSpin * omega * uTime;
  float arc = (1.0 - vLocal.x) * omega * duration / TAU;
  float halfWidth = max(1.0 / uAtlasSize.y, (0.025 + aSeed.w * 0.035) / 8.0) * uPointScale;
  vec2 uv = vec2(fract(angle / TAU + 0.5) + uWrap + uSpin * arc,
    (radius - 3.0) / 8.0 + corner.y * halfWidth);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vLight = (0.65 + aSeed.w * 0.35) * 0.16;
  vSeed = aSeed.w;
}`;

export const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in float vLight;
in vec2 vLocal;
in float vSeed;
out vec4 outColor;
void main() {
  float transverse = (vLocal.y - 0.5) / (0.12 + vLocal.x * 0.1);
  float tail = exp(-transverse * transverse) * smoothstep(0.0, 0.18, vLocal.x) * (1.0 - smoothstep(0.8, 1.0, vLocal.x));
  float head = exp(-pow((vLocal.x - 0.82) / 0.12, 2.0) - pow((vLocal.y - 0.5) / 0.23, 2.0));
  float density = (tail * 0.45 + head) * vLight;
  // A second channel preserves the resolved bright heads without colouring the gas in RGB.
  outColor = vec4(density, head * vLight * (0.4 + pow(vSeed, 3.0)), 0.0, 1.0);
}`;

/** Circular emissive filaments, sampled through the curved rays at each image's emission time. */
export function createDiskParticles(
  gl: WebGL2RenderingContext,
  program: WebGLProgram
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
  gl.vertexAttribDivisor(0, 1);
  const uniforms = {
    atlas: gl.getUniformLocation(program, "uAtlasSize"),
    scale: gl.getUniformLocation(program, "uPointScale"),
    spin: gl.getUniformLocation(program, "uSpin"),
    time: gl.getUniformLocation(program, "uTime"),
    wrap: gl.getUniformLocation(program, "uWrap"),
  };
  let quality: HoleQuality = "balanced";
  const setQuality = (next: HoleQuality) => {
    quality = next;
    const level = HOLE_QUALITY[next];
    gl.bindTexture(gl.TEXTURE_2D, texture);
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
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
    draw(time: number, spin: number) {
      const level = HOLE_QUALITY[quality];
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
      gl.uniform2f(uniforms.atlas, level.atlasWidth, level.atlasHeight);
      gl.uniform1f(
        uniforms.scale,
        Math.sqrt(
          (level.atlasWidth * level.atlasHeight) / level.particles / 9.36
        )
      );
      for (const wrap of [-1, 0, 1]) {
        gl.uniform1f(uniforms.wrap, wrap);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, level.particles);
      }
      gl.disable(gl.BLEND);
    },
    setQuality,
    texture,
  };
}
