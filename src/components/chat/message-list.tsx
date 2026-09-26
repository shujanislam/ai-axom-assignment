import { Streamdown } from "streamdown";
import { SlotPicker } from "@/components/slot-picker";
import { QuestionOptions } from "@/components/chat/question-options";
import { SkipLink } from "@/components/chat/skip-link";
import { Tag } from "@/components/ui";
import { humanize } from "@/lib/format";
import {
  answerableQuestionId,
  assistantTyping,
  bookingState,
  chosenOptions,
  type ChatMessage,
} from "@/lib/server/chat";
import { formatSlot, type SlotDay } from "@/lib/server/slots";

const time = (d: Date) =>
  new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * One thread, shared by the customer's chat and the advisor inbox. `viewer` decides which side
 * is "mine". Booking pickers, question options and the skip links are only interactive when their
 * actions are given (the customer's view); advisors also see each triage's verdict.
 */
export function MessageList({
  thread,
  viewer,
  slots,
  book,
  answer,
  skipQuestions,
  skipBooking,
}: {
  thread: ChatMessage[];
  viewer: "CUSTOMER" | "ADVISOR";
  slots: SlotDay[];
  book?: (messageId: string) => (slotIso: string) => Promise<{ error?: string }>;
  answer?: (messageId: string) => (option: string) => Promise<{ error?: string }>;
  skipQuestions?: (messageId: string) => () => Promise<{ error?: string }>;
  skipBooking?: (messageId: string) => () => Promise<{ error?: string }>;
}) {
  const answerable = answerableQuestionId(thread);
  const chosen = chosenOptions(thread);
  const mine = (m: ChatMessage) => (viewer === "CUSTOMER" ? m.sender === "CUSTOMER" : m.sender !== "CUSTOMER");

  return (
    <ol className="space-y-4">
      {thread.map((m) => {
        const own = mine(m);
        const who =
          m.sender === "CUSTOMER"
            ? viewer === "CUSTOMER"
              ? "You"
              : "Customer"
            : m.sender === "ADVISOR"
              ? (m.advisor_name ?? "Advisor")
              : "gear-ai assistant";
        return (
          <li key={m.id} className={`flex flex-col ${own ? "items-end" : "items-start"}`}>
            <span className="mb-1 px-1 text-[11.5px] text-muted">
              {who} · {time(m.created_at)}
            </span>
            <div
              className={`max-w-[85%] rounded-[18px] px-4 py-3 text-[14px] leading-relaxed ${
                // Only plain-text customer messages go dark; Markdown stays on a light background.
                own ? (m.sender === "CUSTOMER" ? "bg-ink text-white" : "bg-[#e9e7e2] text-ink") : "bg-white text-ink"
              }`}
            >
              {m.sender === "CUSTOMER" ? (
                <p className="whitespace-pre-wrap">{m.body}</p>
              ) : (
                <Streamdown mode="static" controls={false} className="chat-md">
                  {m.body}
                </Streamdown>
              )}
              {m.kind === "BOOKING" && (
                <BookingBlock message={m} slots={slots} book={book?.(m.id)} skip={skipBooking?.(m.id)} />
              )}
              {m.kind === "QUESTION" && m.options && (
                <QuestionOptions
                  options={m.options}
                  chosen={chosen.get(m.id) ?? null}
                  answer={m.id === answerable ? answer?.(m.id) : undefined}
                />
              )}
              {m.kind === "QUESTION" && m.id === answerable && skipQuestions && (
                <SkipLink label="Skip the questions" skip={skipQuestions(m.id)} />
              )}
            </div>
            {viewer === "ADVISOR" && m.verdict && (
              <span className="mt-1.5 flex flex-wrap gap-1.5 px-1">
                <Tag>
                  {m.verdict.status === "CONSULT"
                    ? "Triage: consultation only"
                    : m.verdict.status === "SKIPPED"
                      ? "Triage: skipped by customer"
                      : "Triage: needs appointment"}
                </Tag>
                {m.verdict.fault && <Tag>Likely fault: {humanize(m.verdict.fault)}</Tag>}
                {m.verdict.fixable && <Tag>Fix: {humanize(m.verdict.fixable)}</Tag>}
              </span>
            )}
            {m.ai_status === "FAILED" && (
              <span className="mt-1 px-1 text-[11.5px] text-amber">The assistant couldn’t answer this one.</span>
            )}
          </li>
        );
      })}
      {assistantTyping(thread) && (
        <li className="flex items-start">
          <span className="rounded-[18px] bg-white px-4 py-3 text-[13.5px] text-muted">Assistant is typing…</span>
        </li>
      )}
    </ol>
  );
}

function BookingBlock({
  message,
  slots,
  book,
  skip,
}: {
  message: ChatMessage;
  slots: SlotDay[];
  book?: (slotIso: string) => Promise<{ error?: string }>;
  skip?: () => Promise<{ error?: string }>;
}) {
  const state = bookingState(message);
  if (!state.open) {
    return (
      <p className="mt-3 rounded-xl bg-well px-3 py-2 text-[13px] text-muted">
        {state.bookedAt
          ? `Booked for ${formatSlot(state.bookedAt)}.`
          : state.skipped
            ? "Booking skipped."
            : "This booking is no longer open."}
      </p>
    );
  }
  if (!book)
    return (
      <p className="mt-3 rounded-xl bg-well px-3 py-2 text-[13px] text-muted">
        Waiting for the customer to pick a slot.
      </p>
    );
  return (
    <div className="-mx-1 mt-1">
      <SlotPicker days={slots} book={book} submitLabel="Book" />
      {skip && <SkipLink label="Skip booking" skip={skip} />}
    </div>
  );
}
