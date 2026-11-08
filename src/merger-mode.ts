import {
  APPROACH_END,
  gasAt,
  holesAt,
  MERGE_TIME,
  MERGER_STAGES,
  massAt,
  mergerStageAt,
  PLUNGE_TIME,
  REMNANT_MASS,
  refillAt,
  SEQUENCE_END,
  separationAt,
} from "./lib/binary-merger";
import {
  createMergerRenderer,
  type MergerRenderer,
  type MergerView,
} from "./lib/merger-gl";
import { advanceMerger } from "./lib/merger-playback";
import { OBSERVER_RADIUS } from "./lib/scene-geometry";

export interface MergerText {
  note: string;
  progress: number;
  readout: string;
  status: string;
  unit: string;
}

/** The main scene's framing: 12.5 r_s from the hole, 6° above its disk. */
const SCENE_ELEVATION = 6;
// Wider than the main lens: its infalling observer sees an aberrated, wider sky.
const SCENE_FOV = 84;
const SCENE_AZIMUTH = 180;

function ease(x: number) {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
}

function mix(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

/**
 * Scripted camera: it starts exactly where the main scene's observer is
 * (around the first hole), rises to watch the whole pair while the companion
 * arrives, and returns to the main scene's framing of the remnant, scaled by
 * its larger horizon, so the fall into it can continue without a cut.
 */
export function storyCamera(
  t: number,
  turn = { azimuth: 0, elevation: 0 }
): MergerView {
  const [hole = [0, 0, 0]] = holesAt(t).positions;
  const rise = ease(t / (APPROACH_END * 0.55));
  const back = refillAt(t);
  const a = separationAt(t);
  const wideDistance = 18 + 1.5 * a;
  const target = hole.map((value) => value * (1 - rise)) as [
    number,
    number,
    number,
  ];
  const near = OBSERVER_RADIUS;
  const remnant = OBSERVER_RADIUS * 2 * REMNANT_MASS;
  const free = 1 - back;
  return {
    azimuth:
      mix(mix(SCENE_AZIMUTH, 205, rise), SCENE_AZIMUTH, back) +
      turn.azimuth * free,
    distance: Math.exp(
      mix(
        mix(Math.log(near), Math.log(wideDistance), rise),
        Math.log(remnant),
        back
      )
    ),
    elevation: Math.max(
      -80,
      Math.min(
        80,
        mix(mix(SCENE_ELEVATION, 28, rise), SCENE_ELEVATION, back) +
          turn.elevation * free
      )
    ),
    fov: mix(mix(SCENE_FOV, 56, rise), SCENE_FOV, back),
    target,
  };
}

function velocityAt(t: number): [number, number, number] {
  const dt = 0.05;
  const [a = [0, 0, 0]] = holesAt(t - dt).positions;
  const [b = [0, 0, 0]] = holesAt(t + dt).positions;
  return [
    (b[0] - a[0]) / (2 * dt),
    (b[1] - a[1]) / (2 * dt),
    (b[2] - a[2]) / (2 * dt),
  ];
}

/**
 * The binary chapter of the scene: the companion arrives, the pair merges,
 * rings down and the remnant's disk refills. Owns its canvas and clock.
 */
export function createMergerMode(canvas: HTMLCanvasElement) {
  let renderer: MergerRenderer | null = null;
  let failed = false;
  let time = 0;
  let playing = false;
  let size = { height: 1, ratio: 1, width: 1 };
  const turn = { azimuth: 0, elevation: 0 };

  const ensure = () => {
    if (!(renderer || failed)) {
      renderer = createMergerRenderer(canvas);
      failed = renderer === null;
      renderer?.resize(size.width, size.height, size.ratio);
    }
    return renderer;
  };

  return {
    advance(seconds: number) {
      if (playing) {
        time = advanceMerger(time, seconds);
      }
      return time >= SEQUENCE_END;
    },
    get available() {
      ensure();
      return !failed;
    },
    dispose() {
      renderer?.dispose();
      renderer = null;
    },
    draw() {
      const active = ensure();
      if (!active) {
        return false;
      }
      const { positions } = holesAt(time);
      active.view(storyCamera(time, turn));
      active.draw({
        gas: gasAt(time),
        holes: positions,
        mass: massAt(time) / 2,
        time,
        velocity: velocityAt(time),
        // The wave map fades in as the companion arrives.
        waves: ease(time / (APPROACH_END * 0.4)),
      });
      canvas.dataset.mergerTime = time.toFixed(3);
      canvas.dataset.mergerStage = mergerStageAt(time);
      return true;
    },
    get finished() {
      return time >= SEQUENCE_END;
    },
    pause() {
      playing = false;
    },
    play() {
      playing = true;
    },
    get playing() {
      return playing;
    },
    resize(width: number, height: number, ratio: number) {
      size = { height, ratio, width };
      renderer?.resize(width, height, ratio);
    },
    /** Moves through the story by wall-clock seconds of playback. */
    scrub(seconds: number) {
      time = advanceMerger(time, seconds);
    },
    seek(next: number) {
      time = Math.max(0, Math.min(SEQUENCE_END, next));
    },
    text(): MergerText {
      const { description, title } = MERGER_STAGES[mergerStageAt(time)];
      const merged = time > MERGE_TIME + PLUNGE_TIME;
      const view = storyCamera(time);
      return {
        note: description,
        progress: time / SEQUENCE_END,
        // r_s of one starting hole is the scene's unit; after the merger, the
        // camera's distance in the remnant's r_s carries on into the fall.
        readout: merged
          ? (view.distance / (2 * REMNANT_MASS)).toFixed(2)
          : separationAt(time).toFixed(2),
        status: title,
        unit: merged ? "rₛ" : "rₛ между дырами",
      };
    },
    get time() {
      return time;
    },
    togglePlayback() {
      playing = !playing;
    },
    turn(dx: number, dy: number) {
      turn.azimuth = (turn.azimuth + dx) % 360;
      turn.elevation = Math.max(-60, Math.min(60, turn.elevation + dy));
    },
  };
}

export type MergerMode = ReturnType<typeof createMergerMode>;
