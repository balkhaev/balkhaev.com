import { expect, test } from "bun:test";

import {
  createHoleQuality,
  drawingSize,
  HOLE_QUALITY,
} from "./black-hole-quality";

test("Full HD stays native even in the lowest quality tier", () => {
  expect(drawingSize(1920, 1080, 1, "low")).toEqual({
    height: 1080,
    width: 1920,
  });
  expect(drawingSize(1920, 1080, 1.25, "balanced")).toEqual({
    height: 1350,
    width: 2400,
  });
  expect(drawingSize(2560, 1440, 1, "balanced")).toEqual({
    height: 1440,
    width: 2560,
  });
});

test("Retina mobile and 4K retain their device-pixel detail within the budget", () => {
  expect(drawingSize(390, 844, 2, "low")).toEqual({ height: 1688, width: 780 });
  expect(drawingSize(390, 844, 3, "balanced")).toEqual({
    height: 2532,
    width: 1170,
  });
  expect(drawingSize(3840, 2160, 1, "high")).toEqual({
    height: 2160,
    width: 3840,
  });
});

test("large displays stay inside the GPU budget without changing aspect ratio", () => {
  for (const level of ["low", "balanced", "high"] as const) {
    const size = drawingSize(5120, 2880, 2, level);
    expect(size.width * size.height).toBeLessThanOrEqual(
      HOLE_QUALITY[level].pixels
    );
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  }
});

test("sustained slow frames lower detail even without GPU timestamps", () => {
  const quality = createHoleQuality(false);
  quality.sample(0.3, null);
  expect(quality.level).toBe("balanced");
  for (let i = 0; i < 6; i += 1) {
    quality.sample(0.3, null);
  }
  expect(quality.level).toBe("low");
});

test("long tab pauses do not lower quality", () => {
  const quality = createHoleQuality(false);
  quality.sample(30, 40);
  expect(quality.level).toBe("balanced");
});

test("fast CPU frames alone cannot promote a potentially overloaded GPU", () => {
  const quality = createHoleQuality(true);
  for (let i = 0; i < 600; i += 1) {
    quality.sample(1 / 30, null);
  }
  expect(quality.level).toBe("low");
});

test("promotion requires sustained GPU headroom and cannot immediately reverse", () => {
  const quality = createHoleQuality(false);
  for (let i = 0; i < 250; i += 1) {
    quality.sample(1 / 30, 5);
  }
  expect(quality.level).toBe("high");
  for (let i = 0; i < 30; i += 1) {
    quality.sample(0.06, 30);
  }
  expect(quality.level).toBe("high");
  for (let i = 0; i < 80; i += 1) {
    quality.sample(0.06, 30);
  }
  expect(quality.level).toBe("balanced");
});
