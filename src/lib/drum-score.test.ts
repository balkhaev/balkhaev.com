import { expect, test } from "bun:test";
import { DRUM_CENTER, DRUM_STRIKES, drummerPose, scoreAt } from "./drum-score";

const distance = (a: number[], b: number[]) =>
  Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));

test("the articulated arm preserves both bone lengths throughout all four strokes", () => {
  for (let time = -5; time <= 90; time += 0.2) {
    const pose = drummerPose(time);
    expect(distance(pose.shoulder, pose.elbow)).toBeCloseTo(0.68, 8);
    expect(distance(pose.elbow, pose.grip)).toBeCloseTo(0.66, 8);
  }
});

test("the padded head contacts the membrane at the same instants that launch light and sound", () => {
  for (const [index, time] of DRUM_STRIKES.entries()) {
    const pose = drummerPose(time);
    expect(distance(pose.head, [...DRUM_CENTER])).toBeLessThan(1e-10);
    expect(scoreAt(time - 1e-5).index).toBe(index - 1);
    expect(scoreAt(time).index).toBe(index);
    expect(scoreAt(time).impulse).toBeGreaterThanOrEqual(1);
  }
});

test("wind-up, contact, rebound and recovery connect without pose jumps", () => {
  for (const time of DRUM_STRIKES) {
    for (const offset of [-9, -2.5, 0, 0.7, 1.2, 6]) {
      const a = drummerPose(time + offset - 1e-5);
      const b = drummerPose(time + offset + 1e-5);
      expect(distance(a.grip, b.grip)).toBeLessThan(0.0001);
      expect(distance(a.head, b.head)).toBeLessThan(0.0001);
      expect(distance(a.elbow, b.elbow)).toBeLessThan(0.0001);
    }
  }
});

test("the score stays quiet before the first stroke and reserves the strongest impulse for release", () => {
  expect(scoreAt(-5).index).toBe(-1);
  expect(scoreAt(0).impulse).toBe(0);
  expect(scoreAt(DRUM_STRIKES[3]).impulse).toBeGreaterThan(
    scoreAt(DRUM_STRIKES[0]).impulse
  );
  expect(scoreAt(DRUM_STRIKES[3] - 0.1).release).toBe(0);
});
