import { expect, test } from "bun:test";
import {
  COMPACT_ZOOM,
  diveFrame,
  diveKeyframes,
  easeDive,
  zoomedFov,
} from "./scene-dive";

const geo = { cx: 1138, cy: 202, d: 184, h: 900, w: 1440 };

test("the first frame is the dot", () => {
  const frame = diveFrame(0, geo);
  // The short side of the scene shrinks to the dot's diameter...
  expect(frame.scale * geo.h).toBeCloseTo(geo.d);
  // ...centred on the dot...
  expect(geo.w / 2 + frame.x).toBeCloseTo(geo.cx);
  expect(geo.h / 2 + frame.y).toBeCloseTo(geo.cy);
  // ...and clipped to a circle on that side, drawn with the page's lens.
  expect(frame.clip).toEqual({ r: geo.h / 2, x: (geo.w - geo.h) / 2, y: 0 });
  expect(frame.zoom).toBe(COMPACT_ZOOM);
  expect(frame.pageScale).toBe(1);
  expect(frame.pageOpacity).toBe(1);
});

test("the last frame is the full scene", () => {
  const frame = diveFrame(1, geo);
  expect(frame.scale).toBe(1);
  expect(frame.x).toBeCloseTo(0);
  expect(frame.y).toBeCloseTo(0);
  expect(frame.clip).toEqual({ r: 0, x: 0, y: 0 });
  expect(frame.zoom).toBe(1);
  expect(frame.pageOpacity).toBe(0);
});

test("the dive only ever moves forward", () => {
  let previous = diveFrame(0, geo);
  for (let i = 1; i <= 100; i += 1) {
    const frame = diveFrame(i / 100, geo);
    expect(frame.scale).toBeGreaterThanOrEqual(previous.scale);
    expect(frame.clip.x).toBeLessThanOrEqual(previous.clip.x);
    expect(frame.zoom).toBeLessThanOrEqual(previous.zoom);
    previous = frame;
  }
  expect(easeDive(0)).toBe(0);
  expect(easeDive(1)).toBe(1);
});

test("keyframes span the whole dive", () => {
  const { page, scene } = diveKeyframes(geo, 10);
  expect(scene).toHaveLength(11);
  expect(page.at(-1)?.opacity).toBe("0");
  expect(scene.at(-1)?.clipPath).toBe("inset(0.00px 0.00px round 0.00px)");
});

test("zooming the lens narrows the field of view", () => {
  expect(zoomedFov(64, 1)).toBeCloseTo(64);
  expect(zoomedFov(64, 2)).toBeLessThan(40);
});
