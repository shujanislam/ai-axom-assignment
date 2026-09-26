// Limits and fixed values shared by the chat and its assistant.

export const TITLE_MAX = 100; // becomes appointments.appointment_type, VARCHAR(100)
export const HISTORY = 20; // messages the assistant sees
export const COMPLAINT_TYPES = [
  "SERVICE_ISSUE",
  "VEHICLE_ISSUE",
  "STAFF_BEHAVIOR",
  "DELAY",
  "BILLING_ISSUE",
  "PARTS_ISSUE",
  "OTHER",
] as const;

/** Triage asks at least one and at most this many multiple-choice questions per problem. */
export const MAX_QUESTIONS = 5;
export const OPTION_MAX = 80;
export const FEEDBACK_COMMENT_MAX = 1000; // feedback.comment's CHECK
export const FAULTS = ["WORKSHOP", "CUSTOMER", "WEAR", "UNCLEAR"] as const;
export const FIXABLE = ["IN_HOUSE", "SPECIALIST", "DIY", "UNCLEAR"] as const;

export const TRIAGE_FALLBACK_REPLY =
  "Sorry, that took too long on our side. Please send your last answer again and we’ll carry on.";
export const FALLBACK_REPLY =
  "Sorry, I couldn’t process that just now. An advisor has your message and will reply here shortly.";
