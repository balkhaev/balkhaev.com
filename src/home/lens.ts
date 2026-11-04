/**
 * The homepage hero: a poster of giant type bent by a point-mass gravitational
 * lens centred on the black hole preview. The preview drifts towards the
 * pointer and the lens follows it.
 */

const VERTEX = `
attribute vec2 point;
varying vec2 uv;
void main() {
  uv = point * 0.5 + 0.5;
  gl_Position = vec4(point, 0.0, 1.0);
}`;

// Thin lens: an image at offset θ shows the source at β = θ − θE²/|θ|.
const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D poster;
uniform vec2 size;
uniform vec2 center;
uniform float einstein;
uniform float hole;
const vec3 background = vec3(0.043, 0.039, 0.035);
const vec3 gold = vec3(0.86, 0.70, 0.49);
void main() {
  vec2 pixel = vec2(uv.x, 1.0 - uv.y) * size;
  vec2 offset = pixel - center;
  float r = max(length(offset), 1.0);
  vec2 source = pixel - offset / r * (einstein * einstein / r);
  vec2 st = source / size;
  vec3 colour = texture2D(poster, st).rgb;
  if (st.x < 0.0 || st.y < 0.0 || st.x > 1.0 || st.y > 1.0) {
    colour = background;
  }
  float ring = exp(-pow((r - einstein) / (einstein * 0.05), 2.0));
  float halo = exp(-pow((r - hole) / (hole * 0.35), 2.0));
  colour += gold * (ring * 0.28 + halo * 0.12);
  colour *= smoothstep(hole * 0.96, hole * 1.12, r);
  gl_FragColor = vec4(colour, 1.0);
}`;

export const POSTER_ROWS = [
  { kind: "outline", text: "МИХАИЛ" },
  { kind: "solid", text: "БАЛЬХАЕВ" },
  { kind: "italic", text: "генеративный ai" },
  { kind: "outline", text: "ДИФФУЗИЯ" },
  { kind: "solid", text: "LLM-АГЕНТЫ" },
  { kind: "italic", text: "синтез речи" },
] as const;

const MAX_RATIO = 1.75;
const DRIFT = 0.09;
const DRIFT_LIMIT = 90;
const EASE = 0.06;

function compile(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) {
    return null;
  }
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) {
      return null;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** Fits each row's text to the full width; rows repeat until the poster is full. */
function paint(width: number, height: number, ratio: number) {
  const poster = document.createElement("canvas");
  poster.width = width;
  poster.height = height;
  const ctx = poster.getContext("2d");
  if (!ctx) {
    return poster;
  }
  ctx.fillStyle = "#0b0a09";
  ctx.fillRect(0, 0, width, height);
  // Spacetime grid: the lens shows its curvature.
  const step = 56 * ratio;
  ctx.strokeStyle = "rgba(239, 233, 223, 0.045)";
  ctx.lineWidth = ratio;
  ctx.beginPath();
  for (let x = (width / 2) % step; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = (height / 2) % step; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  // Stars from a fixed seed so every visit sees the same sky.
  let seed = 7;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let i = 0; i < (width * height) / (5200 * ratio * ratio); i += 1) {
    const size = random() ** 4 * 1.6 * ratio + 0.4 * ratio;
    ctx.fillStyle = `rgba(255, 244, 228, ${0.25 + random() * 0.6})`;
    ctx.fillRect(random() * width, random() * height, size, size);
  }
  const margin = Math.max(16 * ratio, width * 0.025);
  const usable = width - margin * 2;
  let y = margin * 0.6;
  let index = 0;
  ctx.textBaseline = "alphabetic";
  while (y < height + usable * 0.1) {
    const row = POSTER_ROWS[index % POSTER_ROWS.length];
    if (!row) {
      break;
    }
    const style = row.kind === "italic" ? "italic 400" : "600";
    ctx.font = `${style} 100px "Source Serif 4", Georgia, serif`;
    const measured = ctx.measureText(row.text).width;
    const size = Math.min((100 * usable) / measured, height * 0.42);
    ctx.font = `${style} ${size}px "Source Serif 4", Georgia, serif`;
    const advance = size * 0.82;
    y += advance;
    const x = margin + (usable - ctx.measureText(row.text).width) / 2;
    if (row.kind === "outline") {
      ctx.strokeStyle = "rgba(239, 233, 223, 0.42)";
      ctx.lineWidth = Math.max(1, size / 140);
      ctx.strokeText(row.text, x, y);
    } else if (row.kind === "italic") {
      ctx.fillStyle = "#dcb27c";
      ctx.fillText(row.text, x, y);
    } else {
      ctx.fillStyle = "#efe9df";
      ctx.fillText(row.text, x, y);
    }
    y += size * 0.06;
    index += 1;
  }
  return poster;
}

export function startLens(
  canvas: HTMLCanvasElement,
  hero: HTMLElement,
  anchor: HTMLElement,
  isActive: () => boolean
) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  const program = gl && compile(gl);
  if (!(gl && program)) {
    return null;
  }
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  const point = gl.getAttribLocation(program, "point");
  gl.enableVertexAttribArray(point);
  gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const sizeAt = uniform("size");
  const centerAt = uniform("center");
  const einsteinAt = uniform("einstein");
  const holeAt = uniform("hole");

  let ratio = 1;
  let frame = 0;
  let visible = true;
  let pointer: { x: number; y: number } | null = null;
  const drift = { x: 0, y: 0 };
  const started = performance.now();

  const draw = () => {
    const box = canvas.getBoundingClientRect();
    const hole = anchor.getBoundingClientRect();
    const radius = (hole.width / 2) * ratio;
    gl.uniform2f(
      centerAt,
      (hole.left + hole.width / 2 - box.left) * ratio,
      (hole.top + hole.height / 2 - box.top) * ratio
    );
    gl.uniform1f(holeAt, radius);
    gl.uniform1f(einsteinAt, radius * 1.32);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const fit = () => {
    const box = canvas.getBoundingClientRect();
    ratio = Math.min(devicePixelRatio || 1, MAX_RATIO);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(sizeAt, width, height);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      paint(width, height, ratio)
    );
    hero.classList.add("lensed");
    draw();
  };

  const tick = (now: number) => {
    frame = 0;
    if (!(visible && isActive()) || document.hidden) {
      return;
    }
    const box = hero.getBoundingClientRect();
    let target = { x: 0, y: 0 };
    if (pointer) {
      target = {
        x: (pointer.x - box.left - box.width / 2) * DRIFT,
        y: (pointer.y - box.top - box.height / 2) * DRIFT,
      };
    } else {
      const t = (now - started) / 1000;
      target = { x: Math.sin(t * 0.21) * 34, y: Math.sin(t * 0.13) * 20 };
    }
    target.x = Math.max(-DRIFT_LIMIT, Math.min(DRIFT_LIMIT, target.x));
    target.y = Math.max(-DRIFT_LIMIT, Math.min(DRIFT_LIMIT, target.y));
    drift.x += (target.x - drift.x) * EASE;
    drift.y += (target.y - drift.y) * EASE;
    anchor.style.translate = `${drift.x.toFixed(2)}px ${drift.y.toFixed(2)}px`;
    draw();
    frame = requestAnimationFrame(tick);
  };

  const resume = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (still.matches) {
      anchor.style.translate = "";
      draw();
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  hero.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") {
      pointer = { x: event.clientX, y: event.clientY };
    }
  });
  hero.addEventListener("pointerleave", () => {
    pointer = null;
  });
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    resume();
  }).observe(hero);
  new ResizeObserver(fit).observe(canvas);
  document.addEventListener("visibilitychange", resume);
  still.addEventListener("change", resume);
  Promise.all([
    document.fonts.load('600 100px "Source Serif 4"'),
    document.fonts.load('italic 400 100px "Source Serif 4"'),
  ])
    .then(fit)
    .catch(fit);
  return { resume };
}
