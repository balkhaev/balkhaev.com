import { createHoleDrag } from "./lib/black-hole-drag";
import {
  createHoleRenderer,
  type HoleRenderer,
  type HoleView,
} from "./lib/black-hole-gl";
import { createHoleInteraction } from "./lib/black-hole-interaction";
import { createHoleQuality, HOLE_QUALITY } from "./lib/black-hole-quality";

const VIEW: HoleView = {
  inclination: 84,
  roll: 0,
  size: 0.2,
  spin: -1,
  stars: 0,
  x: 0.5,
  y: 0.5,
};
const SVG_NS = "http://www.w3.org/2000/svg";
const STAR_COLORS = ["#e8efff", "#fff1d9", "#ffffff"] as const;

function fillSky() {
  const group = document.getElementById("montage-stars");
  if (!group) {
    return;
  }
  const fragment = document.createDocumentFragment();
  for (let id = 0; id < 360; id += 1) {
    const random = (salt: number) => {
      const value = Math.sin(id * 127.1 + salt * 311.7) * 43_758.5453;
      return value - Math.floor(value);
    };
    const star = document.createElementNS(SVG_NS, "circle");
    star.setAttribute("cx", String(random(1) * 1440));
    star.setAttribute("cy", String(random(2) * 1000));
    star.setAttribute("r", String(0.35 + random(4) ** 4 * 0.85));
    star.setAttribute("opacity", String(0.16 + random(3) ** 3 * 0.55));
    star.setAttribute("fill", STAR_COLORS[id % STAR_COLORS.length] ?? "#fff");
    fragment.append(star);
  }
  group.append(fragment);
}

function animateHole(
  canvas: HTMLCanvasElement,
  renderer: HoleRenderer,
  glow: HTMLDivElement
) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const interaction = createHoleInteraction(
    canvas,
    document.body,
    still,
    () => glow,
    () => VIEW
  );
  const quality = createHoleQuality();
  renderer.quality(quality.level);
  let frame = 0;
  let last = 0;
  let time = 1200;

  const draw = (seconds = 0) => {
    renderer.draw({
      accretion: 1,
      pointer: interaction.update(seconds, false),
      time,
    });
    canvas.classList.add("ready");
    canvas.parentElement?.classList.add("rendered");
  };
  const fit = () => {
    const box = canvas.getBoundingClientRect();
    renderer.resize(
      box.width,
      box.height,
      Math.min(devicePixelRatio || 1, 2),
      HOLE_QUALITY[quality.level].detail
    );
    draw();
  };
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / 30 - 1) {
      return;
    }
    const gap = last ? (now - last) / 1000 : 0;
    last = now;
    if (quality.sample(gap, renderer.gpuTime())) {
      renderer.quality(quality.level);
      fit();
    }
    const seconds = Math.min(0.1, gap);
    time += seconds * 3.8;
    draw(seconds);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    interaction.reset();
    renderer.clearTrail();
  };
  const resume = () => {
    stop();
    if (document.hidden) {
      return;
    }
    draw();
    if (!still.matches) {
      frame = requestAnimationFrame(tick);
    }
  };
  const observer = new ResizeObserver(fit);
  observer.observe(canvas);
  still.addEventListener("change", resume);
  document.addEventListener("visibilitychange", resume);
  fit();
  resume();
  return () => {
    stop();
    observer.disconnect();
    interaction.dispose();
    renderer.dispose();
    still.removeEventListener("change", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}

function start() {
  const canvas = document.getElementById("hole");
  const handle = document.getElementById("grab");
  const scene = document.querySelector("[data-gravity-source]");
  const glow = document.querySelector("[data-disk-glow]");
  if (
    !(
      canvas instanceof HTMLCanvasElement &&
      handle instanceof HTMLButtonElement &&
      scene instanceof HTMLDivElement &&
      glow instanceof HTMLDivElement
    )
  ) {
    return;
  }
  fillSky();
  const disposeDrag = createHoleDrag(scene, handle, VIEW.size);
  let disposeRenderer: () => void = () => undefined;
  const mount = () => {
    const renderer = createHoleRenderer(canvas, VIEW);
    if (renderer) {
      disposeRenderer = animateHole(canvas, renderer, glow);
    }
  };
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    disposeRenderer();
    canvas.classList.remove("ready");
    scene.classList.remove("rendered");
  });
  canvas.addEventListener("webglcontextrestored", mount);
  // BFCache restores this document and its animation; only dispose when it is really leaving.
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      disposeRenderer();
      disposeDrag();
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  mount();
}

start();
