import assert from "node:assert/strict";
import { isScheduleDue, normalizeSchedule } from "../src/services/project-schedule.js";

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

runTest("normalizes default schedule", () => {
  const schedule = normalizeSchedule({});
  assert.equal(schedule.enabled, false);
  assert.equal(schedule.time, "12:00");
  assert.equal(schedule.timezone, "Europe/Moscow");
});

runTest("detects due slot in Moscow time", () => {
  const schedule = normalizeSchedule({
    enabled: true,
    time: "12:00",
    timezone: "Europe/Moscow"
  });

  assert.equal(isScheduleDue(schedule, new Date("2026-03-10T09:00:05.000Z")), true);
  assert.equal(isScheduleDue({
    ...schedule,
    lastTriggeredSlot: "2026-03-10T12:00@Europe/Moscow"
  }, new Date("2026-03-10T09:00:20.000Z")), false);
});
