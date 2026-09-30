export type HoleQuality = "low" | "balanced" | "high";

export const HOLE_QUALITY = {
  balanced: {
    atlasHeight: 192,
    atlasWidth: 768,
    bloom: 2,
    detail: 0.55,
    images: 3,
    particles: 12_000,
    trails: 9,
  },
  high: {
    atlasHeight: 256,
    atlasWidth: 1024,
    bloom: 3,
    detail: 1,
    images: 3,
    particles: 28_000,
    trails: 12,
  },
  low: {
    atlasHeight: 128,
    atlasWidth: 512,
    bloom: 1,
    detail: 0.25,
    images: 2,
    particles: 4500,
    trails: 6,
  },
} as const;

const LEVELS: HoleQuality[] = ["low", "balanced", "high"];

/** Sustained timings and a cooldown prevent quality from flickering between adjacent levels. */
export function createHoleQuality(
  modest = matchMedia("(pointer: coarse)").matches ||
    navigator.hardwareConcurrency <= 4
) {
  let level = modest ? 0 : 1;
  let slow = 0;
  let fast = 0;
  let cooldown = 0;
  return {
    get level(): HoleQuality {
      return LEVELS[level] ?? "low";
    },
    sample(seconds: number, gpuMs: number | null): boolean {
      if (seconds <= 0 || seconds > 1) {
        return false;
      }
      cooldown = Math.max(0, cooldown - seconds);
      const overloaded = seconds > 0.055 || (gpuMs !== null && gpuMs > 22);
      const headroom = seconds < 0.04 && gpuMs !== null && gpuMs < 9;
      slow = overloaded ? slow + seconds : Math.max(0, slow - seconds * 0.5);
      fast = headroom ? fast + seconds : 0;
      if (cooldown > 0) {
        return false;
      }
      const down = slow > 1.2 && level > 0;
      const up = fast > 8 && level < 2;
      if (!(down || up)) {
        return false;
      }
      level += down ? -1 : 1;
      slow = 0;
      fast = 0;
      cooldown = 6;
      return true;
    },
  };
}

/** Nonblocking GPU timestamps: never wait for a query or accumulate a queue of them. */
export function createGpuClock(gl: WebGL2RenderingContext) {
  const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  let query: WebGLQuery | null = null;
  let measuring = false;
  let milliseconds: number | null = null;
  return {
    begin() {
      if (!extension) {
        return;
      }
      if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        milliseconds = gl.getParameter(extension.GPU_DISJOINT_EXT)
          ? null
          : Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1_000_000;
        gl.deleteQuery(query);
        query = null;
      }
      if (!query) {
        query = gl.createQuery();
        if (query) {
          gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
          measuring = true;
        }
      }
    },
    dispose() {
      if (query) {
        gl.deleteQuery(query);
      }
    },
    end() {
      if (extension && measuring) {
        gl.endQuery(extension.TIME_ELAPSED_EXT);
        measuring = false;
      }
    },
    read: () => milliseconds,
  };
}
