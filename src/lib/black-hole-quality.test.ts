import { expect, test } from "bun:test";

import { createHoleQuality } from "./black-hole-quality";

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
