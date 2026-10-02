import { relativityAt, skyShiftAt } from "./relativity";

interface PhysicsFrame {
  artistic: boolean;
  pitch: number;
  radius: number;
  time: number;
  yaw: number;
}

const formatter = new Intl.NumberFormat("ru", { maximumSignificantDigits: 3 });
const factor = (value: number) => `${formatter.format(value)}×`;
const shift = (value: number | null) =>
  value === null ? "Нет внешнего луча" : factor(value);

/** Optional observations of the same ray model; no separate physical time or camera. */
export function createPhysicsPanel(onChange: () => void) {
  const panel = document.querySelector<HTMLElement>("#physics-panel");
  const toggle = document.querySelector<HTMLButtonElement>("#physics-toggle");
  const close = document.querySelector<HTMLButtonElement>("#physics-close");
  const spectralToggle =
    document.querySelector<HTMLButtonElement>("#spectral-toggle");
  const legend = document.querySelector<HTMLElement>("#spectrum-legend");
  const artNote = document.querySelector<HTMLElement>("#physics-art-note");
  const measurements = document.querySelector<HTMLElement>(
    "#physics-measurements"
  );
  const frameNote = document.querySelector<HTMLElement>("#physics-frame-note");
  const labels = new Map<string, HTMLElement>();
  for (const id of [
    "radius",
    "time",
    "speed",
    "lapse",
    "tides",
    "shadow",
    "forward",
    "side",
    "rear",
  ]) {
    const element = document.querySelector<HTMLElement>(`#physics-${id}`);
    if (element) {
      labels.set(id, element);
    }
  }
  let spectral = false;
  let artistic = false;
  let lastTime = -1;
  let lastFrame: PhysicsFrame | null = null;
  const text = (id: string, value: string) => {
    const element = labels.get(id);
    if (element && element.textContent !== value) {
      element.textContent = value;
    }
  };
  const update = (frame: PhysicsFrame, force = false) => {
    const changed =
      frame.radius !== lastFrame?.radius ||
      frame.yaw !== lastFrame.yaw ||
      frame.pitch !== lastFrame.pitch;
    lastFrame = frame;
    ({ artistic } = frame);
    if (
      !panel ||
      panel.hidden ||
      (!(force || changed) && frame.time - lastTime < 0.15)
    ) {
      return;
    }
    lastTime = frame.time;
    if (artNote && measurements) {
      artNote.hidden = !artistic;
      measurements.hidden = artistic;
    }
    const angle = Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          Math.cos((frame.yaw * Math.PI) / 180) *
            Math.cos((frame.pitch * Math.PI) / 180)
        )
      )
    );
    const physical = relativityAt(frame.radius, angle);
    text("radius", `${physical.radius.toFixed(3)} rₛ`);
    text("time", `${frame.time.toFixed(1)} rₛ/c`);
    text(
      "speed",
      physical.staticSpeed === null
        ? "Нет статической системы"
        : physical.staticSpeed.toFixed(3)
    );
    text(
      "lapse",
      physical.staticLapse === null
        ? "Неприменимо внутри"
        : physical.staticLapse.toFixed(3)
    );
    text("tides", factor(physical.tidalRatio));
    text("shadow", `${((physical.shadowAngle * 360) / Math.PI).toFixed(1)}°`);
    text("forward", shift(physical.forwardShift));
    text("side", shift(physical.sideShift));
    text("rear", shift(skyShiftAt(frame.radius, Math.PI)));
    if (frameNote) {
      frameNote.textContent = physical.insideHorizon
        ? "Начиная с горизонта нельзя удерживать радиус: статического наблюдателя нет. Приливной градиент сравнивается с начальной глубиной."
        : "Скорость — относительно местного статического наблюдателя. Его часы — относительно времени на бесконечности. Приливной градиент сравнивается с начальной глубиной.";
    }
  };
  const setOpen = (open: boolean) => {
    if (!panel) {
      return;
    }
    panel.hidden = !open;
    toggle?.setAttribute("aria-expanded", String(open));
    if (open) {
      if (lastFrame) {
        update(lastFrame, true);
      }
      close?.focus({ preventScroll: true });
    } else {
      toggle?.focus({ preventScroll: true });
    }
  };
  const toggleOpen = () => setOpen(panel?.hidden !== false);
  toggle?.addEventListener("click", toggleOpen);
  close?.addEventListener("click", () => setOpen(false));
  spectralToggle?.addEventListener("click", () => {
    spectral = !spectral;
    spectralToggle.setAttribute("aria-pressed", String(spectral));
    if (legend) {
      legend.hidden = !spectral;
    }
    onChange();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel && !panel.hidden) {
      event.preventDefault();
      setOpen(false);
    }
  });
  return {
    get spectral() {
      return spectral && !artistic;
    },
    toggle: toggleOpen,
    update,
  };
}
