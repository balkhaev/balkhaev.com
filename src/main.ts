import { startHomeMotion } from "./home/motion";
import {
  createHoleRenderer,
  type HoleRenderer,
  type HoleView,
} from "./lib/black-hole-gl";
import { createHoleQuality } from "./lib/black-hole-quality";
import { createFlight, END_PROGRESS, HORIZON_PROGRESS } from "./lib/flight";
import { createFlightAudio } from "./lib/flight-audio";
import { createObserverLook } from "./lib/observer-look";
import { createPhysicsPanel } from "./lib/physics-panel";
import { skyShiftAt } from "./lib/relativity";
import {
  CLOSE_MS,
  COMPACT_ZOOM,
  type DiveGeometry,
  diveKeyframes,
  diveStyles,
  OPEN_MS,
  zoomedFov,
} from "./lib/scene-dive";
import { OBSERVER_RADIUS, opticsAt } from "./lib/scene-geometry";
import { scenePreview, sceneTimeStep } from "./lib/scene-playback";
import { createMergerMode } from "./merger-mode";

const canvas = document.querySelector<HTMLCanvasElement>("#hole");
const control = document.querySelector<HTMLButtonElement>("#observer");
const hint = document.querySelector<HTMLElement>("#hint");
const scene = document.querySelector<HTMLElement>("#scene");
const SCENE_HASH = "#hole";
const rateFormat = new Intl.NumberFormat("ru", { maximumSignificantDigits: 3 });

function flightLabel(flight: ReturnType<typeof createFlight>) {
  if (!flight.active) {
    return "На краю тишины";
  }
  if (flight.playback === "rewinding") {
    return "К меньшей глубине";
  }
  if (flight.playback === "paused") {
    return flight.journey.phase > 0 ? flight.journey.stage : "Начало полёта";
  }
  return flight.journey.stage;
}

function flightInstruction(flight: ReturnType<typeof createFlight>) {
  if (!flight.active) {
    return "Дыра, её диск и звезда. Скоро придёт вторая.";
  }
  if (flight.playback === "rewinding") {
    return "Скролл ↓ — ближе · ↑ — дальше. Время идёт вперёд.";
  }
  return flight.journey.description;
}

function updateText(element: HTMLElement | null, value: string) {
  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

function travelAction(
  flight: ReturnType<typeof createFlight>,
  staticMotion: boolean
) {
  if (flight.journey.finished) {
    return "Граница расчёта";
  }
  if (staticMotion) {
    return "Ближе";
  }
  if (flight.playback === "playing") {
    return "Пауза";
  }
  return flight.active ? "Продолжить" : "Начать";
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * True on a CPU rasteriser (no GPU, or a blocked driver), where compiling the
 * shader and every frame stall the page for seconds. Probed on a throwaway canvas.
 */
function softwareRenderer() {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) {
    return false;
  }
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const software = Boolean(
    info && SOFTWARE_GL.test(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
  );
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return software;
}

/** Runs once the page has loaded and the main thread is idle. */
function afterLoad(run: () => void) {
  const idle = () => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 200);
    }
  };
  if (document.readyState === "complete") {
    idle();
  } else {
    window.addEventListener("load", idle, { once: true });
  }
}

/** Deterministic material-interaction frames for local visual review only. */
function previewEffect(renderer: HoleRenderer, time: number) {
  const params = new URLSearchParams(location.search);
  const effect = params.get("preview-effect");
  const requestedAge = Number(params.get("preview-age") ?? 3);
  const age = Number.isFinite(requestedAge)
    ? Math.max(0, Math.min(30, requestedAge))
    : 3;
  if (effect === "impact") {
    renderer.disturb(0.69, 0.57, time - age, 1.4, true);
  } else if (effect === "stream") {
    for (let i = 0; i < 12; i += 1) {
      renderer.disturb(
        0.58 + i * 0.014,
        0.57,
        time - age - (11 - i) * 0.18,
        0.8
      );
    }
  }
}

function start(surface: HTMLCanvasElement, input: HTMLButtonElement) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const preview = scenePreview(location.hostname, location.search);
  const previewStill = preview.still;
  const view: HoleView = {
    distance: OBSERVER_RADIUS,
    fov: 64,
    pitch: 0,
    roll: 0,
    spin: -1,
    stars: 0.25,
    x: 0.5,
    y: 0.5,
    yaw: 0,
  };
  const quality = createHoleQuality();
  const flight = createFlight();
  const look = createObserverLook();
  const audio = createFlightAudio();
  if (preview.phase !== null && preview.phase > 0) {
    flight.travel(preview.phase, true, false);
    hint?.classList.add("dismissed");
  }
  const flightStatus = document.querySelector<HTMLElement>("#flight-status");
  const flightNote = document.querySelector<HTMLElement>("#flight-note");
  const travelToggle =
    document.querySelector<HTMLButtonElement>("#travel-toggle");
  const travelLabel = document.querySelector<HTMLElement>("#travel-label");
  const gazeToggle = document.querySelector<HTMLButtonElement>("#gaze-toggle");
  const soundToggle =
    document.querySelector<HTMLButtonElement>("#sound-toggle");
  const fullscreenToggle =
    document.querySelector<HTMLButtonElement>("#fullscreen-toggle");
  const radiusLabel = document.querySelector<HTMLElement>("#journey-radius");
  const signalLabel = document.querySelector<HTMLElement>("#journey-signal");
  const horizonTick = document.querySelector<HTMLElement>(".horizon-tick");
  if (horizonTick) {
    // The bar holds the whole story: the merger, then the fall.
    horizonTick.style.left = `${50 + (HORIZON_PROGRESS / END_PROGRESS) * 50}%`;
  }
  const journeyProgress =
    document.querySelector<HTMLElement>("#journey-progress");
  if (soundToggle) {
    soundToggle.disabled = !audio.available;
  }
  if (fullscreenToggle) {
    fullscreenToggle.hidden = !document.fullscreenEnabled;
  }
  let renderer: HoleRenderer | null = null;
  let mounting = false;
  let attempted = false;
  let software = false;
  // The scene starts as a small preview on the page and opens to full screen.
  let expanded = false;
  // Lens magnification: the dot on the page looks closer than the full scene.
  let lensZoom = COMPACT_ZOOM;
  let visible = true;
  let frame = 0;
  let last = 0;
  let time = 0;
  const physics = createPhysicsPanel(() => redraw());
  const mergerCanvas = document.querySelector<HTMLCanvasElement>("#merger");
  const unitLabel = document.querySelector<HTMLElement>("#journey-unit");
  const merger = mergerCanvas ? createMergerMode(mergerCanvas) : null;
  // The story: the first hole alone, the companion and the merger, then the
  // fall into the remnant. `mergerDone` marks that the fall chapter follows.
  let mergerOn = false;
  let mergerDone = false;
  let fadeTimer = 0;
  let noteStage = "";
  let noteTimer = 0;
  const showNote = (stage: string) => {
    if (stage === noteStage || !flightNote) {
      return;
    }
    noteStage = stage;
    flightNote.classList.remove("faded");
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(
      () => flightNote.classList.add("faded"),
      6500
    );
  };
  let pointer: { x: number; y: number; at: number } | null = null;
  let lastImpulse = 0;
  const touches = new Map<number, { x: number; y: number }>();
  let gesture: {
    x: number;
    y: number;
    distance: number;
    dragged: boolean;
  } | null = null;

  const storyProgress = (share: number) => {
    if (journeyProgress) {
      journeyProgress.style.transform = `scaleX(${share})`;
    }
  };
  const frameView = () => {
    const { journey } = flight;
    view.distance = journey.radius;
    Object.assign(view, opticsAt(journey.radius));
    Object.assign(view, look.advance(0, still.matches || previewStill));
    view.fov = zoomedFov(view.fov, lensZoom);
    view.x = 0.5;
    view.y = 0.5;
    surface.dataset.observerRadius = view.distance.toFixed(4);
    surface.dataset.horizon = String(flight.crossed);
    surface.dataset.journeyStage = flight.active ? journey.stage : "Обзор";
    surface.dataset.journeyPhase = journey.phase.toFixed(3);
    surface.dataset.playback = flight.playback;
    surface.dataset.sceneTime = time.toFixed(4);
    surface.dataset.gaze = look.guided ? "guided" : "free";
    surface.dataset.gazeYaw = view.yaw.toFixed(4);
    surface.dataset.gazePitch = view.pitch.toFixed(4);
    updateText(flightStatus, flightLabel(flight));
    updateText(flightNote, flightInstruction(flight));
    showNote(flightNote?.textContent ?? "");
    updateText(radiusLabel, journey.radius.toFixed(2));
    const skyAngle = Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          Math.cos((view.yaw * Math.PI) / 180) *
            Math.cos((view.pitch * Math.PI) / 180)
        )
      )
    );
    const skyRate = skyShiftAt(journey.radius, skyAngle);
    surface.dataset.skyRate = skyRate === null ? "none" : skyRate.toFixed(4);
    if (signalLabel) {
      signalLabel.hidden = !flight.active || skyRate === null;
      if (skyRate !== null) {
        updateText(signalLabel, `Свет извне · ${rateFormat.format(skyRate)}×`);
      }
    }
    storyProgress(mergerDone ? 0.5 + 0.5 * journey.completion : 0);
    const playing = flight.playback === "playing";
    if (travelToggle) {
      travelToggle.toggleAttribute("data-playing", playing);
      travelToggle.disabled = journey.finished;
    }
    updateText(
      travelLabel,
      travelAction(flight, still.matches || previewStill)
    );
    gazeToggle?.setAttribute("aria-pressed", String(look.guided));
    audio.update({
      finished: journey.finished,
      playing,
      radius: journey.radius,
      yaw: view.yaw,
    });
    physics.update({
      pitch: view.pitch,
      radius: journey.radius,
      time,
      yaw: view.yaw,
    });
    renderer?.view(view);
  };

  const frameMerger = () => {
    if (!merger) {
      return;
    }
    const text = merger.text();
    updateText(flightStatus, text.status);
    updateText(flightNote, text.note);
    showNote(text.note);
    updateText(radiusLabel, text.readout);
    updateText(unitLabel, text.unit);
    let action = merger.playing ? "Пауза" : "Продолжить";
    if (still.matches || previewStill) {
      action = "Дальше";
    }
    updateText(travelLabel, action);
    travelToggle?.toggleAttribute("data-playing", merger.playing);
    if (travelToggle) {
      travelToggle.disabled = false;
    }
    storyProgress(0.5 * text.progress);
  };
  const draw = () => {
    if (mergerOn && merger) {
      diveZoom();
      frameMerger();
      merger.draw();
      return;
    }
    if (!renderer) {
      return;
    }
    diveZoom();
    frameView();
    renderer.draw({
      accretion: 1,
      spectral: physics.spectral,
      time,
    });
    document.documentElement.classList.add("rendered");
  };
  const redraw = () => {
    // Animated input is collected by the next frame; static modes draw explicitly.
    if (!frame || still.matches || previewStill) {
      draw();
    }
  };

  const fit = () => {
    // Layout size, not the on-screen box: the dive scales the scene with CSS.
    renderer?.resize(
      surface.clientWidth,
      surface.clientHeight,
      devicePixelRatio || 1
    );
    merger?.resize(
      surface.clientWidth,
      surface.clientHeight,
      devicePixelRatio || 1
    );
    draw();
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / 60 - 1) {
      return;
    }
    const elapsed = last ? (now - last) / 1000 : 0;
    const seconds = Math.min(0.1, elapsed);
    last = now;
    if (mergerOn && merger) {
      const { playing } = merger;
      if (merger.advance(seconds) && playing) {
        handoff(true);
        return;
      }
      draw();
      return;
    }
    flight.advance(seconds);
    time += sceneTimeStep(seconds);
    Object.assign(view, look.advance(seconds));
    if (quality.sample(elapsed, renderer?.gpuTime() ?? null)) {
      renderer?.quality(quality.level);
      fit();
      return;
    }
    draw();
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };
  const resume = () => {
    stop();
    audio.setAudible(
      !document.hidden && Boolean(renderer) && expanded && !mergerOn
    );
    if (!(renderer || attempted) && expanded) {
      // Opened before the deferred start: build the scene now.
      mount();
    }
    if (document.hidden || !renderer || !(expanded || visible)) {
      return;
    }
    draw();
    // A software rasteriser animates only the open scene: the dot stays a still.
    if (!(still.matches || previewStill || (software && !expanded))) {
      frame = requestAnimationFrame(tick);
    }
  };
  const mount = async () => {
    if (mounting) {
      return;
    }
    mounting = true;
    attempted = true;
    const made = await createHoleRenderer(surface, view);
    mounting = false;
    if (renderer) {
      made?.dispose();
      return;
    }
    renderer = made;
    if (!renderer) {
      audio.setAudible(false);
      return;
    }
    renderer.quality(quality.level);
    fit();
    if (previewStill) {
      previewEffect(renderer, time);
    }
    resume();
  };
  const dismissHint = () => {
    hint?.classList.add("dismissed");
  };
  // Scroll and keys move along the whole story, in seconds of playback.
  const STORY_SCRUB = 6;
  const travel = (amount: number) => {
    if (mergerOn && merger) {
      merger.scrub(amount * STORY_SCRUB);
      if (merger.finished && amount > 0) {
        handoff(false);
      }
      return;
    }
    const canStart = merger?.available && !flight.active && amount > 0;
    if (!mergerDone && canStart && merger) {
      setMerger(true);
      merger.scrub(amount * STORY_SCRUB);
      return;
    }
    if (mergerDone && merger && amount < 0 && flight.journey.phase <= 0) {
      setMerger(true);
      merger.scrub(amount * STORY_SCRUB);
      return;
    }
    flight.travel(amount, still.matches || previewStill, false);
  };
  const turn = (dx: number, dy: number) => {
    if (mergerOn && merger) {
      merger.turn(dx * 1.5, -dy * 1.5);
      return;
    }
    look.turn(dx, dy, still.matches || previewStill);
  };
  // The two renderers cross-fade: each keeps its last frame while the other
  // fades over it, and both frame the same view at the hand-over.
  const setMerger = (on: boolean) => {
    if (!merger || on === mergerOn) {
      return;
    }
    mergerOn = on;
    clearTimeout(fadeTimer);
    noteStage = "";
    if (on) {
      flight.pause();
      audio.setAudible(false);
      if (mergerCanvas) {
        mergerCanvas.hidden = false;
      }
      fit();
      requestAnimationFrame(() => {
        if (mergerOn && scene) {
          scene.dataset.mode = "merger";
        }
      });
      return;
    }
    merger.pause();
    updateText(unitLabel, "rₛ");
    audio.setAudible(!document.hidden && Boolean(renderer) && expanded);
    if (scene) {
      delete scene.dataset.mode;
    }
    fadeTimer = window.setTimeout(() => {
      if (!mergerOn && mergerCanvas) {
        mergerCanvas.hidden = true;
      }
    }, 1400);
    fit();
  };
  // The merger has played out: the fall into the remnant takes over.
  function handoff(autoplay: boolean) {
    mergerDone = true;
    setMerger(false);
    if (autoplay && flight.playback !== "playing") {
      flight.togglePlayback();
    }
    redraw();
  }
  const toggleTravel = () => {
    dismissHint();
    if (mergerOn && merger) {
      if (still.matches || previewStill) {
        travel(0.24);
      } else {
        merger.togglePlayback();
      }
      redraw();
      return;
    }
    if (!(mergerDone || flight.active) && merger?.available) {
      setMerger(true);
      if (still.matches || previewStill) {
        travel(0.24);
      } else {
        merger.play();
      }
      redraw();
      return;
    }
    if (still.matches || previewStill) {
      travel(0.24);
    } else {
      flight.togglePlayback();
    }
    redraw();
  };
  const toggleSound = async () => {
    if (!soundToggle || soundToggle.disabled) {
      return;
    }
    soundToggle.disabled = true;
    const enabled = await audio.setEnabled(!audio.enabled);
    soundToggle.setAttribute("aria-pressed", String(enabled));
    soundToggle.title = enabled
      ? "Выключить звуковую атмосферу · M"
      : "Включить звуковую атмосферу · M";
    soundToggle.disabled = !audio.available;
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.fullscreenEnabled) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // The scene remains interactive when the browser declines fullscreen.
    }
  };
  travelToggle?.addEventListener("click", toggleTravel);
  soundToggle?.addEventListener("click", toggleSound);
  fullscreenToggle?.addEventListener("click", toggleFullscreen);
  gazeToggle?.addEventListener("click", () => {
    look.setGuided(!look.guided);
    redraw();
  });
  document.addEventListener("fullscreenchange", () => {
    fullscreenToggle?.setAttribute(
      "aria-pressed",
      String(Boolean(document.fullscreenElement))
    );
    fit();
  });

  const disturb = (event: PointerEvent, tap = false) => {
    if (mergerOn) {
      return;
    }
    const now = event.timeStamp;
    const box = surface.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    const speed = pointer
      ? Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) /
        Math.max(16, now - pointer.at)
      : 0.3;
    pointer = { at: now, x: event.clientX, y: event.clientY };
    if (!tap && (now - lastImpulse < 50 || speed < 0.035)) {
      return;
    }
    if (
      renderer?.disturb(
        x,
        y,
        time,
        tap ? 1.4 : 0.55 + Math.min(0.8, speed * 0.55),
        tap
      )
    ) {
      lastImpulse = now;
      if (still.matches || previewStill) {
        draw();
      }
    }
  };

  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    dismissHint();
    input.dataset.pointerFocused = "true";
    disturb(event, true);
    input.focus({ preventScroll: true });
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    input.setPointerCapture(event.pointerId);
    const points = [...touches.values()];
    const [a, b] = points;
    gesture = {
      distance: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      dragged: points.length > 1,
      x: event.clientX,
      y: event.clientY,
    };
    input.dataset.dragging = "true";
  });
  input.addEventListener("pointermove", (event) => {
    if (!gesture && event.pointerType === "mouse") {
      disturb(event);
    }
  });
  input.addEventListener("pointermove", (event) => {
    if (gesture && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...touches.values()];
      const [a, b] = points;
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.distance > 0) {
          travel(Math.log(distance / gesture.distance) * 0.8);
        }
        gesture.distance = distance;
        gesture.dragged = true;
      } else {
        const dx = event.clientX - gesture.x,
          dy = event.clientY - gesture.y;
        if (Math.hypot(dx, dy) > 3 || gesture.dragged) {
          gesture.dragged = true;
          turn(-dx * 0.15, dy * 0.15);
          gesture.x = event.clientX;
          gesture.y = event.clientY;
        }
      }
    }
    redraw();
  });
  input.addEventListener("pointerleave", () => {
    pointer = null;
  });
  const release = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (input.hasPointerCapture(event.pointerId)) {
      input.releasePointerCapture(event.pointerId);
    }
    const [remaining] = [...touches.values()];
    gesture = remaining ? { ...remaining, distance: 0, dragged: true } : null;
    if (!gesture) {
      delete input.dataset.dragging;
    }
  };
  input.addEventListener("pointerup", release);
  input.addEventListener("pointercancel", release);
  input.addEventListener("lostpointercapture", (event) => {
    if (touches.has(event.pointerId)) {
      release(event);
    }
  });
  input.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      dismissHint();
      let unit = 1;
      if (event.deltaMode === 1) {
        unit = 16;
      } else if (event.deltaMode === 2) {
        unit = surface.clientHeight;
      }
      travel(event.deltaY * unit * 0.002);
      redraw();
    },
    { passive: false }
  );
  const keyActions: Record<string, () => void> = {
    " ": toggleTravel,
    "-": () => travel(-0.24),
    "+": () => travel(0.24),
    "=": () => travel(0.24),
    ArrowDown: () => turn(0, -4),
    ArrowLeft: () => turn(-4, 0),
    ArrowRight: () => turn(4, 0),
    ArrowUp: () => turn(0, 4),
  };
  input.addEventListener("keydown", (event) => {
    delete input.dataset.pointerFocused;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const action = keyActions[key];
    if (!action || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    if (event.repeat && key === " ") {
      return;
    }
    action();
    dismissHint();
    redraw();
  });
  const sceneKeys: Record<string, () => void> = {
    " ": toggleTravel,
    escape: () => openScene(false),
    f: toggleFullscreen,
    m: toggleSound,
    p: physics.toggle,
  };
  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable]")) {
      return;
    }
    if (!expanded) {
      return;
    }
    const key = event.key.toLowerCase();
    const action =
      key === " " && target?.closest("button, a") ? undefined : sceneKeys[key];
    if (!action) {
      return;
    }
    event.preventDefault();
    if (!event.repeat) {
      action();
    }
  });
  const openButton = document.querySelector<HTMLButtonElement>("#scene-open");
  const closeButton = document.querySelector<HTMLButtonElement>("#scene-close");
  let hintTimer = 0;
  const applyScene = (open: boolean) => {
    expanded = open;
    clearTimeout(hintTimer);
    if (open) {
      hintTimer = window.setTimeout(dismissHint, 7000);
    }
    lensZoom = open ? 1 : COMPACT_ZOOM;
    if (scene) {
      scene.dataset.state = open ? "expanded" : "compact";
    }
    document.documentElement.classList.toggle("scene-expanded", open);
    openButton?.setAttribute("aria-expanded", String(open));
    if (!open) {
      flight.pause();
      merger?.pause();
      gesture = null;
      touches.clear();
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    }
    fit();
    resume();
  };

  // The dive: see lib/scene-dive.ts. The compositor runs the CSS side; each
  // drawn frame reads the animation's clock for the matching lens zoom.
  const page = [
    ...document.querySelectorAll<HTMLElement>(
      ".topbar, .masthead h1, .lead, .columns, .news-side, .contacts, .site-foot"
    ),
  ];
  let dive: {
    animations: Animation[];
    done: () => void;
    geo: DiveGeometry;
    open: boolean;
  } | null = null;
  const diveGeometry = (): DiveGeometry => {
    const anchor = (scene?.parentElement ?? scene)?.getBoundingClientRect();
    const screen = scene?.getBoundingClientRect();
    const w = screen?.width ?? innerWidth;
    const h = screen?.height ?? innerHeight;
    if (!anchor || anchor.bottom < 0 || anchor.top > h) {
      return { cx: w / 2, cy: h / 2, d: Math.min(w, h) * 0.2, h, w };
    }
    return {
      cx: anchor.left + anchor.width / 2,
      cy: anchor.top + anchor.height / 2,
      d: anchor.width,
      h,
      w,
    };
  };
  const diveZoom = () => {
    const animation = dive?.animations[0];
    if (!(dive && animation)) {
      return;
    }
    const duration = dive.open ? OPEN_MS : CLOSE_MS;
    const at = Math.min(1, Number(animation.currentTime ?? 0) / duration);
    lensZoom = diveStyles(dive.open ? at : 1 - at, dive.geo).zoom;
  };
  const settle = () => {
    document.documentElement.classList.remove("scene-diving");
    for (const animation of dive?.animations ?? []) {
      animation.cancel();
    }
    for (const element of page) {
      element.style.transformOrigin = "";
    }
    dive = null;
  };
  const animateDive = (open: boolean, done: () => void) => {
    const geo = diveGeometry();
    for (const element of page) {
      const box = element.getBoundingClientRect();
      element.style.transformOrigin = `${geo.cx - box.left}px ${geo.cy - box.top}px`;
    }
    document.documentElement.classList.add("scene-diving");
    const frames = diveKeyframes(geo);
    const timing: KeyframeAnimationOptions = {
      direction: open ? "normal" : "reverse",
      duration: open ? OPEN_MS : CLOSE_MS,
      fill: "both",
    };
    const animations = [
      ...(scene ? [scene.animate(frames.scene, timing)] : []),
      ...page.map((element) => element.animate(frames.page, timing)),
    ];
    dive = { animations, done, geo, open };
    diveZoom();
    draw();
    const finish = () => {
      // A newer dive has already cancelled this one and called its `done`.
      if (dive?.animations !== animations) {
        return;
      }
      settle();
      done();
      redraw();
    };
    animations[0]?.finished.then(finish).catch(() => undefined);
    // The timeline can stall in a background tab; the page must still settle.
    setTimeout(finish, Number(timing.duration) + 150);
  };
  const transition = (open: boolean) => {
    const running = dive;
    if (running) {
      settle();
      running.done();
    }
    if (open === expanded) {
      return;
    }
    const focus = () =>
      (open ? input : openButton)?.focus({ preventScroll: true });
    if (still.matches || !renderer) {
      applyScene(open);
      focus();
      return;
    }
    if (open) {
      // Full screen first, drawn at full size under the first dive frame.
      applyScene(true);
      animateDive(true, () => {
        lensZoom = 1;
      });
      focus();
      return;
    }
    flight.pause();
    animateDive(false, () => {
      applyScene(false);
      focus();
    });
  };
  function openScene(open: boolean) {
    if (open === expanded) {
      return;
    }
    if (open) {
      history.pushState({ scene: true }, "", SCENE_HASH);
    } else if (history.state?.scene) {
      // Going back keeps the browser's Back button in step with the overlay.
      history.back();
      return;
    } else {
      history.replaceState(null, "", location.pathname + location.search);
    }
    transition(open);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "#scene-open, [data-open-scene]"
  )) {
    button.addEventListener("click", () => openScene(true));
  }
  closeButton?.addEventListener("click", () => openScene(false));
  window.addEventListener("popstate", () => {
    transition(location.hash === SCENE_HASH);
  });
  if (scene) {
    new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      resume();
    }).observe(scene);
  }
  const resize = new ResizeObserver(fit);
  resize.observe(surface);
  still.addEventListener("change", () => {
    if (still.matches) {
      flight.pause();
    }
    resume();
  });
  document.addEventListener("visibilitychange", resume);
  surface.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop();
    audio.setAudible(false);
    renderer?.dispose();
    renderer = null;
    document.documentElement.classList.remove("rendered");
  });
  surface.addEventListener("webglcontextrestored", mount);
  window.addEventListener("pagehide", (event) => {
    stop();
    audio.setAudible(false);
    if (!event.persisted) {
      resize.disconnect();
      audio.dispose();
      renderer?.dispose();
      renderer = null;
    }
  });
  window.addEventListener("pageshow", resume);
  window.addEventListener("blur", () => {
    gesture = null;
    touches.clear();
    pointer = null;
    delete input.dataset.dragging;
  });
  expanded =
    location.hash === SCENE_HASH || preview.phase !== null || previewStill;
  applyScene(expanded);
  if (expanded) {
    mount();
  } else {
    // The dot is decoration: let the page paint and settle before the GPU work.
    // A software rasteriser keeps the drawn fallback until the scene is opened.
    afterLoad(() => {
      software = softwareRenderer();
      if (!(software || attempted)) {
        mount();
      }
    });
  }
  // Local visual review of the merger at a fixed time: ?preview-merger=<M>.
  const mergerPreview = previewStill
    ? new URLSearchParams(location.search).get("preview-merger")
    : null;
  if (mergerPreview !== null && merger) {
    merger.seek(Number(mergerPreview) || 0);
    setMerger(true);
  }
}

startHomeMotion();
if (canvas && control) {
  start(canvas, control);
}
