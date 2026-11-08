import {
  holesAt,
  MERGE_TIME,
  MERGER_STAGES,
  massAt,
  mergerStageAt,
  PLUNGE_TIME,
  SEQUENCE_END,
  separationAt,
} from "./lib/binary-merger";
import {
  createMergerRenderer,
  type MergerRenderer,
  type MergerView,
} from "./lib/merger-gl";
import { advanceMerger } from "./lib/merger-playback";

export interface MergerText {
  action: string;
  note: string;
  playing: boolean;
  progress: number;
  readout: string;
  status: string;
  unit: string;
}

const DEFAULT_VIEW: MergerView = {
  azimuth: 18,
  distance: 30,
  elevation: 38,
  fov: 50,
};

/**
 * Second scene: two holes of half the mass each spiral together, merge and
 * ring down. Owns its own canvas and clock; the page's scene shell drives it.
 */
export function createMergerMode(canvas: HTMLCanvasElement) {
  let renderer: MergerRenderer | null = null;
  let failed = false;
  let time = 0;
  let playing = false;
  let size = { height: 1, ratio: 1, width: 1 };
  const view = { ...DEFAULT_VIEW };

  const ensure = () => {
    if (!(renderer || failed)) {
      renderer = createMergerRenderer(canvas);
      failed = renderer === null;
      renderer?.resize(size.width, size.height, size.ratio);
      renderer?.view(view);
    }
    return renderer;
  };

  return {
    advance(seconds: number) {
      if (!playing) {
        return;
      }
      time = advanceMerger(time, seconds);
      if (time >= SEQUENCE_END) {
        playing = false;
      }
    },
    get available() {
      return !failed;
    },
    dispose() {
      renderer?.dispose();
      renderer = null;
    },
    draw(waves = 1) {
      const active = ensure();
      if (!active) {
        return false;
      }
      const { positions } = holesAt(time);
      active.draw({
        holes: positions,
        mass: massAt(time) / 2,
        time,
        waves,
      });
      canvas.dataset.mergerTime = time.toFixed(3);
      canvas.dataset.mergerStage = mergerStageAt(time);
      return true;
    },
    pause() {
      playing = false;
    },
    get playing() {
      return playing;
    },
    resize(width: number, height: number, ratio: number) {
      size = { height, ratio, width };
      renderer?.resize(width, height, ratio);
    },
    seek(next: number) {
      time = Math.max(0, Math.min(SEQUENCE_END, next));
    },
    text(): MergerText {
      const stage = mergerStageAt(time);
      const { description, title } = MERGER_STAGES[stage];
      let action = "Пауза";
      if (!playing) {
        if (time >= SEQUENCE_END) {
          action = "Повторить";
        } else {
          action = time > 0 ? "Продолжить" : "Начать слияние";
        }
      }
      const merged = time > MERGE_TIME + PLUNGE_TIME;
      return {
        action,
        note: description,
        playing,
        progress: time / SEQUENCE_END,
        readout: merged
          ? massAt(time).toFixed(3)
          : separationAt(time).toFixed(2),
        status: title,
        unit: merged ? " M · масса" : " M · расстояние",
      };
    },
    get time() {
      return time;
    },
    togglePlayback() {
      if (time >= SEQUENCE_END) {
        time = 0;
      }
      playing = !playing;
    },
    turn(dx: number, dy: number) {
      view.azimuth = (view.azimuth + dx) % 360;
      view.elevation = Math.max(-80, Math.min(80, view.elevation + dy));
      renderer?.view(view);
    },
    zoom(amount: number) {
      view.distance = Math.max(
        14,
        Math.min(70, view.distance * Math.exp(-amount))
      );
      renderer?.view(view);
    },
  };
}

export type MergerMode = ReturnType<typeof createMergerMode>;
