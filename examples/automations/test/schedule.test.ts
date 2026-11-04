// test/schedule.test.ts
import { expect, test } from "bun:test";
import { slot } from "../src/schedule";

test("hourly slot is the start of the hour", () => {
  const now = new Date("2026-11-04T10:42:00Z");
  expect(slot({ kind: "x", everyMinutes: 60 }, now)).toBe("2026-11-04T10:00:00.000Z");
});

test("daily slot appears only after the time", () => {
  const schedule = { kind: "digest", dailyAt: "09:00" };
  expect(slot(schedule, new Date(2026, 10, 4, 8, 59))).toBeNull();
  expect(slot(schedule, new Date(2026, 10, 4, 9, 0))).toBe("2026-11-04");
  expect(slot(schedule, new Date(2026, 10, 4, 23, 0))).toBe("2026-11-04");
});
