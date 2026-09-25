import { sql } from "./db";

// Workshop hours, in India time. One car per slot (enforced by a unique index on scheduled_at).
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

/** Offered slots nobody has booked yet. */
export async function getFreeSlots() {
  const slots = upcomingSlots();
  const taken = (await sql`
    SELECT scheduled_at FROM appointments
    WHERE status = 'SCHEDULED' AND scheduled_at >= ${slots[0]?.toISOString() ?? new Date().toISOString()}`) as {
    scheduled_at: Date;
  }[];
  const takenSet = new Set(taken.map((t) => +new Date(t.scheduled_at)));
  return slots.filter((s) => !takenSet.has(+s));
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
