export const START_RADIUS = 12.5;
export const END_RADIUS = 0.02;
export const HORIZON_PROGRESS = Math.log(START_RADIUS);
export const END_PROGRESS = Math.log(START_RADIUS / END_RADIUS);
export const MODEL_END_PROGRESS = END_PROGRESS;
export const HORIZON_TIME = (2 / 3) * (START_RADIUS ** 1.5 - 1);
export const END_TIME = (2 / 3) * (START_RADIUS ** 1.5 - END_RADIUS ** 1.5);

const FRAME_LIMIT = 0.1;
const INTEGRATION_STEP = 1 / 120;
const SETTLE_EPSILON = 1e-7;

const CHAPTERS = [
  {
    description: "Свет огибает бездну. Диск медленно заполняет обзор.",
    id: "approach",
    radius: 3,
    title: "Погружение",
  },
  {
    description: "За внутренним краем плазма закручивается в падающие потоки.",
    id: "isco",
    radius: 1.5,
    title: "Под внутренним краем",
  },
  {
    description:
      "Свет делает обороты вокруг дыры. Знакомые звёзды появляются снова.",
    id: "photon-sphere",
    radius: 1.12,
    title: "Сфера света",
  },
  {
    description: "Здесь нет поверхности. Только свет и непрерывное падение.",
    id: "horizon",
    radius: 1,
    title: "Перед горизонтом",
  },
  {
    description:
      "Свет внешнего мира ещё достигает вас. Все будущие пути ведут глубже.",
    id: "interior",
    radius: 0.25,
    title: "За горизонтом событий",
  },
  {
    description:
      "Внешний мир сжимается в тонкую полосу. Оглянитесь — он ещё здесь.",
    id: "deep-interior",
    radius: END_RADIUS,
    title: "Внешнее небо",
  },
  {
    description:
      "Радиус 0.02 rₛ — граница модели. Свет внешнего мира всё ещё достигает наблюдателя.",
    id: "end",
    radius: 0,
    title: "Граница расчёта",
  },
] as const;

// Presentation pace changes smoothly; the sampled worldline and its proper clock do not.
const PACE_POINTS = [
  [0, 0.078],
  [Math.log(START_RADIUS / 3), 0.15],
  [Math.log(START_RADIUS / 1.5), 0.135],
  [HORIZON_PROGRESS, 0.048],
  [Math.log(START_RADIUS / 0.55), 0.13],
  [Math.log(START_RADIUS / 0.25), 0.18],
  [Math.log(START_RADIUS / 0.06), 0.19],
  [END_PROGRESS, 0.105],
] as const;

function playbackPace(phase: number) {
  let previous: readonly [number, number] = PACE_POINTS[0];
  for (const current of PACE_POINTS.slice(1)) {
    if (phase <= current[0]) {
      const fraction = Math.max(
        0,
        (phase - previous[0]) / (current[0] - previous[0])
      );
      const blend = fraction * fraction * (3 - 2 * fraction);
      return previous[1] + (current[1] - previous[1]) * blend;
    }
    previous = current;
  }
  return previous[1];
}

/** Radial rain geodesic: dr/dτ = -1/sqrt(r), dT_PG/dτ = 1. */
export const flightRadius = (properTime: number) =>
  Math.max(
    END_RADIUS,
    Math.max(0, START_RADIUS ** 1.5 - 1.5 * properTime) ** (2 / 3)
  );

/** Navigation samples a radial rain worldline up to the finite model boundary. */
export function journeyAt(progress: number) {
  const phase = Number.isNaN(progress)
    ? 0
    : Math.max(0, Math.min(END_PROGRESS, progress));
  const finished = phase >= END_PROGRESS;
  const radius = finished ? END_RADIUS : START_RADIUS * Math.exp(-phase);
  const chapter =
    (finished
      ? CHAPTERS[6]
      : CHAPTERS.find(
          (candidate) => phase < Math.log(START_RADIUS / candidate.radius)
        )) ?? CHAPTERS[6];
  const clock = finished
    ? END_TIME
    : (2 / 3) * (START_RADIUS ** 1.5 - radius ** 1.5);
  return {
    clock,
    completion: phase / END_PROGRESS,
    description: chapter.description,
    finished,
    phase,
    radius,
    remainingProperTime: Math.max(0, END_TIME - clock),
    stage: chapter.title,
    stageId: chapter.id,
  };
}

export function createFlight() {
  let progress = 0;
  let target = 0;
  let active = false;
  let playing = false;
  const properTime = () => journeyAt(progress).clock;
  const pause = () => {
    playing = false;
    target = progress;
  };
  const resume = () => {
    if (journeyAt(progress).finished) {
      return false;
    }
    active = true;
    target = progress;
    playing = true;
    return true;
  };
  return {
    get active() {
      return active;
    },
    advance(seconds: number, reducedMotion = false) {
      if (!(Number.isFinite(seconds) && seconds > 0) || reducedMotion) {
        return 0;
      }
      const previous = properTime();
      // A suspended tab must not skip a chapter on its first returning frame.
      let remaining = Math.min(seconds, FRAME_LIMIT);
      while (remaining > 1e-10) {
        const elapsed = Math.min(remaining, INTEGRATION_STEP);
        if (playing) {
          target = Math.min(
            END_PROGRESS,
            target + elapsed * playbackPace(progress)
          );
        }
        let step = (target - progress) * (1 - Math.exp(-elapsed * 7));
        const forwardRate = progress < HORIZON_PROGRESS ? 0.6 : 0.3;
        const limit = elapsed * (step < 0 ? 1.2 : forwardRate);
        step = Math.sign(step) * Math.min(Math.abs(step), limit);
        progress += step;
        if (Math.abs(target - progress) < SETTLE_EPSILON) {
          progress = target;
        }
        remaining -= elapsed;
      }
      return properTime() - previous;
    },
    get crossed() {
      return progress >= HORIZON_PROGRESS;
    },
    get journey() {
      return journeyAt(progress);
    },
    pause,
    get playback() {
      if (!active) {
        return "idle";
      }
      if (target < progress - SETTLE_EPSILON) {
        return "rewinding";
      }
      if (journeyAt(progress).finished) {
        return "ended";
      }
      return playing ? "playing" : "paused";
    },
    get radius() {
      return journeyAt(progress).radius;
    },
    resume,
    togglePlayback() {
      if (playing) {
        pause();
        return false;
      }
      return resume();
    },
    travel(amount: number, immediate = false, autoplay = true) {
      if (!Number.isFinite(amount) || amount === 0) {
        return 0;
      }
      active = true;
      // A direction change cancels the old queued motion and anchors the gesture to the visible frame.
      const anchor =
        amount < 0 ? Math.min(progress, target) : Math.max(progress, target);
      playing = amount > 0 && !immediate && autoplay;
      target = Math.min(END_PROGRESS, Math.max(0, anchor + amount));
      const previous = properTime();
      if (immediate) {
        progress = target;
      }
      return properTime() - previous;
    },
  };
}
