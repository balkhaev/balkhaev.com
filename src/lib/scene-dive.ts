/**
 * The dive from the black hole on the page into the full-screen scene.
 *
 * The canvas goes full screen at once and is drawn at full size, then CSS
 * shrinks it back onto the dot: scaled so that the shorter side of the
 * viewport (the one the lens is measured against) equals the dot, and
 * clipped to a circle on that side. The first frame is therefore the same
 * picture as the dot. The dive then relaxes the scale while the circle
 * opens into the full rectangle, with no canvas resize in between. The
 * page around it zooms into the dot and fades out, as if the camera flew
 * through it.
 */

/** Magnification of the lens on the page; 1 is the full scene's view. */
export const COMPACT_ZOOM = 1.55;
export const OPEN_MS = 1150;
export const CLOSE_MS = 850;
/** How much the page grows around the dot by the end of the dive. */
const PAGE_ZOOM = 2.6;

export interface DiveGeometry {
  /** Dot centre and diameter, in viewport pixels. */
  cx: number;
  cy: number;
  d: number;
  /** Viewport size. */
  h: number;
  w: number;
}

export interface DiveFrame {
  /** The scene's clip, `inset(y x round r)`, in the canvas's own pixels. */
  clip: { r: number; x: number; y: number };
  pageOpacity: number;
  pageScale: number;
  /** Uniform scale and offset of the full-screen scene. */
  scale: number;
  x: number;
  y: number;
  /** Lens magnification to draw this frame with. */
  zoom: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Slow start, long glide: the pull of the hole, then the arrival. */
export const easeDive = (t: number) => {
  const p = clamp01(t);
  return p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2;
};

const easeIn = (t: number) => clamp01(t) ** 2.4;

/** The scene and the page at progress `t` from 0 (on the page) to 1 (open). */
export function diveFrame(t: number, geo: DiveGeometry): DiveFrame {
  const short = Math.max(1, Math.min(geo.w, geo.h));
  const start = geo.d / short;
  const q = easeDive(t);
  const scale = start + (1 - start) * q;
  const open = easeIn(t);
  return {
    clip: {
      r: (short / 2) * (1 - open),
      x: ((geo.w - short) / 2) * (1 - open),
      y: ((geo.h - short) / 2) * (1 - open),
    },
    pageOpacity: 1 - clamp01(t * 1.6),
    pageScale: 1 + (PAGE_ZOOM - 1) * easeIn(t * 1.1),
    scale,
    x: (geo.cx - geo.w / 2) * (1 - q),
    y: (geo.cy - geo.h / 2) * (1 - q),
    zoom: COMPACT_ZOOM + (1 - COMPACT_ZOOM) * q,
  };
}

/** Field of view, in degrees, with the lens magnified `zoom` times. */
export const zoomedFov = (fov: number, zoom: number) =>
  (2 * Math.atan(Math.tan((fov * Math.PI) / 360) / zoom) * 180) / Math.PI;

/** CSS for one frame of the scene and of the page around it. */
export function diveStyles(t: number, geo: DiveGeometry) {
  const frame = diveFrame(t, geo);
  const { r, x, y } = frame.clip;
  return {
    page: {
      opacity: String(frame.pageOpacity),
      transform: `scale(${frame.pageScale.toFixed(4)})`,
    },
    scene: {
      clipPath: `inset(${y.toFixed(2)}px ${x.toFixed(2)}px round ${Math.max(0, r).toFixed(2)}px)`,
      transform: `translate(${frame.x.toFixed(2)}px, ${frame.y.toFixed(2)}px) scale(${frame.scale.toFixed(5)})`,
    },
    zoom: frame.zoom,
  };
}

/** Keyframes for the Web Animations API: enough samples to hide the steps. */
export function diveKeyframes(geo: DiveGeometry, samples = 40) {
  const scene: Keyframe[] = [];
  const page: Keyframe[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const offset = i / samples;
    const styles = diveStyles(offset, geo);
    scene.push({ ...styles.scene, offset });
    page.push({ ...styles.page, offset });
  }
  return { page, scene };
}
