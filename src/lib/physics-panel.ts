import { createLocalLightClocks } from "./local-light-clocks";
import { relativityAt, skyShiftAt } from "./relativity";
import { CLOCK_RATE } from "./scene-geometry";

interface PhysicsFrame {
  pitch: number;
  radius: number;
  time: number;
  yaw: number;
}

const formatter = new Intl.NumberFormat("ru", { maximumSignificantDigits: 3 });
const factor = (value: number) => `${formatter.format(value)}×`;
const shift = (value: number | null) =>
  value === null ? "Нет внешнего луча" : factor(value);

type ClockSignals = ReturnType<
  ReturnType<typeof createLocalLightClocks>["advance"]
>;

function signalColour(rate: number | null) {
  if (rate !== null && rate > 1.001) {
    return "#91b9d6";
  }
  if (rate !== null && rate < 0.999) {
    return "#bc967e";
  }
  return "#cabca6";
}

function showSignal(
  row: HTMLElement,
  { phase, rate }: ClockSignals["forward"]
) {
  const output = row.querySelector("output");
  if (output) {
    output.textContent = rate === null ? "Нет внешнего луча" : factor(rate);
  }
  row.dataset.empty = String(rate === null);
  row.dataset.rate = rate === null ? "none" : rate.toFixed(4);
  row.style.setProperty("--signal-phase", phase.toFixed(4));
  row.style.setProperty("--signal-second", ((phase + 0.5) % 1).toFixed(4));
  row.style.setProperty("--signal-colour", signalColour(rate));
}

/** Optional observations of the same ray model; no separate physical time or camera. */
export function createPhysicsPanel(onChange: () => void) {
  const panel = document.querySelector<HTMLElement>("#physics-panel");
  const toggle = document.querySelector<HTMLButtonElement>("#physics-toggle");
  const close = document.querySelector<HTMLButtonElement>("#physics-close");
  const spectralToggle =
    document.querySelector<HTMLButtonElement>("#spectral-toggle");
  const legend = document.querySelector<HTMLElement>("#spectrum-legend");
  const frameNote = document.querySelector<HTMLElement>("#physics-frame-note");
  const clocks = createLocalLightClocks();
  const clockRows = ["local", "rim", "forward", "rear"].map((id) => ({
    id: id as keyof ClockSignals,
    row: document.querySelector<HTMLElement>(`[data-clock="${id}"]`),
  }));
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
  let lastTime = -1;
  let lastClockTime = 0;
  let lastFrame: PhysicsFrame | null = null;
  const text = (id: string, value: string) => {
    const element = labels.get(id);
    if (element && element.textContent !== value) {
      element.textContent = value;
    }
  };
  const updateClocks = (seconds: number, radius: number, angle: number) => {
    const signals = clocks.advance(seconds, radius, angle);
    for (const { id, row } of clockRows) {
      if (row) {
        showSignal(row, signals[id]);
      }
    }
  };
  const update = (frame: PhysicsFrame, force = false) => {
    const changed =
      frame.radius !== lastFrame?.radius ||
      frame.yaw !== lastFrame.yaw ||
      frame.pitch !== lastFrame.pitch;
    lastFrame = frame;
    const seconds = Math.max(
      0,
      Math.min(0.1, (frame.time - lastClockTime) / CLOCK_RATE)
    );
    lastClockTime = frame.time;
    if (!panel || panel.hidden) {
      return;
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
    updateClocks(seconds, frame.radius, angle);
    if (!(force || changed) && frame.time - lastTime < 0.15) {
      return;
    }
    lastTime = frame.time;
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
      return spectral;
    },
    toggle: toggleOpen,
    update,
  };
}
