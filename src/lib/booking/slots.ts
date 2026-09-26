// Workshop hours, in India time. How many cars fit in a slot depends on free mechanics
// (see lib/job-cards/plan.ts); a job of N hours takes N consecutive working hours.
export const WORKSHOP_TZ = "Asia/Kolkata";
const TZ_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SLOT_HOURS = [10, 11, 12, 14, 15, 16]; // 13:00 is lunch
const DAYS_AHEAD = 7;
const SUNDAY = 0;

/** Every slot offered from tomorrow for the next week, Monday to Saturday. */
export function upcomingSlots(now = new Date()): Date[] {
  const local = new Date(now.getTime() + TZ_OFFSET_MS);
  const [y, m, d] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
  const slots: Date[] = [];
  for (let day = 1; day <= DAYS_AHEAD; day++) {
    if (new Date(Date.UTC(y, m, d + day)).getUTCDay() === SUNDAY) continue;
    for (const hour of SLOT_HOURS) slots.push(new Date(Date.UTC(y, m, d + day, hour) - TZ_OFFSET_MS));
  }
  return slots;
}

export function isOfferedSlot(slot: Date) {
  return upcomingSlots().some((s) => +s === +slot);
}

/** India-time hour of a slot, or -1 when it isn't on the hour. */
function localHour(slot: Date) {
  const local = new Date(slot.getTime() + TZ_OFFSET_MS);
  return local.getUTCMinutes() || local.getUTCSeconds() || local.getUTCMilliseconds() ? -1 : local.getUTCHours();
}

/**
 * When a job of `hours` starting at `start` ends: after that many working hours, stepping over
 * lunch. Null when `start` isn't a slot or the job would run past closing.
 */
export function jobWindow(start: Date, hours: number): { startsAt: Date; endsAt: Date } | null {
  const first = SLOT_HOURS.indexOf(localHour(start));
  const last = SLOT_HOURS[first + hours - 1];
  if (first < 0 || last === undefined) return null;
  const endsAt = new Date(start.getTime() + (last + 1 - SLOT_HOURS[first]) * 60 * 60 * 1000);
  return { startsAt: start, endsAt };
}

export function formatSlot(value: Date | string) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: WORKSHOP_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "Tue, 30 Sept, 10:00–12:00": a job's time in the workshop. */
export function formatWindow(startsAt: Date | string, endsAt: Date | string) {
  const end = new Date(endsAt).toLocaleTimeString("en-GB", {
    timeZone: WORKSHOP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${formatSlot(startsAt)}–${end}`;
}

export type SlotDay = { day: string; slots: { iso: string; time: string }[] };

/** Slots grouped by India-time day, for the slot picker. */
export function groupSlotsByDay(slots: Date[]): SlotDay[] {
  const days = new Map<string, SlotDay>();
  for (const slot of slots) {
    const day = slot.toLocaleDateString("en-GB", {
      timeZone: WORKSHOP_TZ,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const time = slot.toLocaleTimeString("en-GB", { timeZone: WORKSHOP_TZ, hour: "2-digit", minute: "2-digit" });
    if (!days.has(day)) days.set(day, { day, slots: [] });
    days.get(day)!.slots.push({ iso: slot.toISOString(), time });
  }
  return [...days.values()];
}
