function normalizeTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return "12:00";
  }

  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizeSchedule(input = {}) {
  return {
    enabled: Boolean(input.enabled),
    time: normalizeTime(input.time || "12:00"),
    timezone: String(input.timezone || "Europe/Moscow").trim() || "Europe/Moscow",
    days: Math.max(1, Number(input.days || 1)),
    lastTriggeredSlot: input.lastTriggeredSlot || null,
    lastTriggeredAt: input.lastTriggeredAt || null
  };
}

export function getCurrentZonedParts(timezone, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

export function getCurrentScheduleSlot(schedule, now = new Date()) {
  const normalized = normalizeSchedule(schedule);
  const zoned = getCurrentZonedParts(normalized.timezone, now);
  return `${zoned.date}T${normalized.time}@${normalized.timezone}`;
}

export function isScheduleDue(schedule, now = new Date()) {
  const normalized = normalizeSchedule(schedule);
  if (!normalized.enabled) {
    return false;
  }

  const zoned = getCurrentZonedParts(normalized.timezone, now);
  const slot = `${zoned.date}T${normalized.time}@${normalized.timezone}`;
  return zoned.time === normalized.time && slot !== normalized.lastTriggeredSlot;
}
