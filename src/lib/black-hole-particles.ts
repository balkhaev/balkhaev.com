import { HOLE_QUALITY, type HoleQuality } from "./black-hole-quality";

export const PARTICLE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 aSeed;
uniform float uTime;
uniform float uSpin;
uniform float uPointScale;
out float vLight;
const float TAU = 6.28318530718;
void main() {
  float radius = aSeed.x;
  float omega = sqrt(0.5 / (radius * radius * radius));
  float angle = aSeed.y - uSpin * omega * uTime;
  float wrap = float(gl_InstanceID) - 1.0;
  vec2 uv = vec2(fract(angle / TAU + 0.5) + wrap, (radius - 3.0) / 8.0);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (4.0 + aSeed.z * 3.0) * uPointScale;
  vLight = (0.75 + aSeed.w * 0.25) * 0.2;
}`;

export const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in float vLight;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float spot = exp(-dot(p, p) * 4.0) * vLight;
  outColor = vec4(spot, 0.0, 0.0, 1.0);
}`;

/** Passive circular tracers; cursor pressure packets modulate the rendered disk layer separately. */
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
  const uniforms = {
    scale: gl.getUniformLocation(program, "uPointScale"),
    spin: gl.getUniformLocation(program, "uSpin"),
    time: gl.getUniformLocation(program, "uTime"),
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
      gl.uniform1f(
        uniforms.scale,
        Math.sqrt(
          (level.atlasWidth * level.atlasHeight) / level.particles / 9.36
        )
      );
      gl.drawArraysInstanced(gl.POINTS, 0, level.particles, 3);
      gl.disable(gl.BLEND);
    },
    setQuality,
    texture,
  };
}
