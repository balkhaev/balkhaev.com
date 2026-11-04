// src/schedule.ts
import { enqueue } from "./queue";

export type Schedule =
  | { kind: string; everyMinutes: number }
  | { kind: string; dailyAt: string }; // "09:00" in the server's TZ

export const schedules: Schedule[] = [
  { kind: "heartbeat", everyMinutes: 5 },
  { kind: "invoices.remind", dailyAt: "10:00" },
  { kind: "payments.reconcile", everyMinutes: 60 },
  { kind: "digest.daily", dailyAt: "09:00" },
  { kind: "alerts.check", everyMinutes: 15 },
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The current run slot of a schedule, or null if it is not due yet.
 * The slot becomes the job key, so each slot runs once no matter how many
 * workers check it or how often.
 */
export function slot(schedule: Schedule, now: Date): string | null {
  if ("everyMinutes" in schedule) {
    const ms = schedule.everyMinutes * 60_000;
    return new Date(Math.floor(now.getTime() / ms) * ms).toISOString();
  }
  const [hours, minutes] = schedule.dailyAt.split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes) {
    return null;
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function enqueueDue(now = new Date()) {
  for (const schedule of schedules) {
    const current = slot(schedule, now);
    if (current) {
      await enqueue({ kind: schedule.kind, key: `${schedule.kind}:${current}` });
    }
  }
}
