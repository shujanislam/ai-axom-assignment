// What a customer can answer to "what got in the way?", shown as options on a REASON message.

export const REASONS = [
  { code: "TIMING", label: "Bad timing" },
  { code: "PRICE", label: "Too expensive" },
  { code: "ELSEWHERE", label: "Serviced elsewhere" },
  { code: "CAR_FINE", label: "Car seems fine" },
  { code: "UNHAPPY", label: "Not happy with last visit" },
] as const;

export type ReasonCode = (typeof REASONS)[number]["code"];
export type LapseKind = "MISSED" | "NO_REPLY" | "OVERDUE" | "SKIPPED";

export const reasonLabel = (code: string | null) => REASONS.find((r) => r.code === code)?.label ?? null;
export const reasonCode = (label: string) => REASONS.find((r) => r.label === label)?.code ?? null;

export const lapseLabel: Record<LapseKind, string> = {
  MISSED: "Missed their slot",
  NO_REPLY: "Didn’t book from the link",
  OVERDUE: "Service date passed",
  SKIPPED: "Skipped booking",
};
