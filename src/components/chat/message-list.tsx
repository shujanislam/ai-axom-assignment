import type React from "react";
import { Streamdown } from "streamdown";
import { SlotPicker } from "@/components/slot-picker";
import { QuestionOptions } from "@/components/chat/question-options";
import { SkipLink } from "@/components/chat/skip-link";
import { humanize } from "@/lib/format";
import {
  answerableQuestionId,
  assistantTyping,
  bookingState,
  chosenOptions,
  type ChatMessage,
} from "@/lib/server/chat";
import { formatSlot, type SlotDay } from "@/lib/server/slots";

const TZ = "Asia/Kolkata";
const GROUP_GAP_MS = 5 * 60_000; // consecutive messages from one sender within this gap share a group

const clock = (d: Date) =>
  new Date(d).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayKey = (d: Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });

function dayLabel(d: Date) {
  const key = dayKey(d);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
}

/**
 * One thread, shared by the customer's chat and the advisor inbox, drawn like a messenger:
 * the viewer's side on the right in green, the other side on the left in white, with day
 * separators and grouped runs. Booking pickers, question options and skip links are only
 * interactive when their actions are given (the customer's view); advisors also see verdicts.
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
  // Who wrote it, shown at the top of a group. On the advisor side "mine" is two people.
  const author = (m: ChatMessage) =>
    m.sender === "ASSISTANT"
      ? "gear-ai assistant"
      : m.sender === "ADVISOR"
        ? (m.advisor_name ?? "Advisor")
        : viewer === "ADVISOR"
          ? "Customer"
          : null;

  return (
    <ol className="flex flex-col">
      {thread.map((m, i) => {
        const prev = thread[i - 1];
        const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
        const grouped =
          !newDay &&
          prev.sender === m.sender &&
          prev.advisor_name === m.advisor_name &&
          +new Date(m.created_at) - +new Date(prev.created_at) < GROUP_GAP_MS;
        const own = mine(m);
        const name = grouped ? null : author(m);
        const wide = m.kind === "BOOKING" || m.kind === "QUESTION";

        return (
          <li key={m.id} className="flex flex-col">
            {newDay && (
              <span className="my-3 self-center rounded-lg bg-white/90 px-3 py-1 text-[11.5px] font-medium text-muted shadow-sm">
                {dayLabel(m.created_at)}
              </span>
            )}
            <div className={`flex ${own ? "justify-end" : "justify-start"} ${grouped ? "mt-1" : "mt-3"}`}>
              <div
                className={`relative min-w-[88px] px-3 pb-1.5 pt-2 text-[14px] leading-relaxed text-ink shadow-[0_1px_0.5px_rgba(27,25,21,0.08)] ${
                  wide ? "w-full max-w-[560px]" : "max-w-[85%] sm:max-w-[72%]"
                } ${own ? "bg-leaf-soft" : "bg-white"} rounded-[12px] ${
                  // The first bubble of a group gets a squared corner, like a speech tail.
                  grouped ? "" : own ? "rounded-tr-[3px]" : "rounded-tl-[3px]"
                }`}
              >
                {name && (
                  <p
                    className={`mb-0.5 text-[12px] font-semibold ${
                      m.sender === "ASSISTANT"
                        ? "text-amber-ink"
                        : m.sender === "ADVISOR"
                          ? "text-[#4a7a2a]"
                          : "text-muted"
                    }`}
                  >
                    {name}
                  </p>
                )}
                {m.sender === "CUSTOMER" ? (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                ) : (
                  <Streamdown mode="static" controls={false} className="chat-md break-words">
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
                <p className="-mb-0.5 mt-0.5 text-right text-[10.5px] leading-none text-muted tabular">
                  {clock(m.created_at)}
                </p>
              </div>
            </div>

            {viewer === "ADVISOR" && m.verdict && (
              <span className={`mt-1.5 flex flex-wrap gap-1.5 ${own ? "justify-end" : ""}`}>
                <Chip>
                  {m.verdict.status === "CONSULT"
                    ? "Triage: consultation only"
                    : m.verdict.status === "SKIPPED"
                      ? "Triage: skipped by customer"
                      : "Triage: needs appointment"}
                </Chip>
                {m.verdict.fault && <Chip>Likely fault: {humanize(m.verdict.fault)}</Chip>}
                {m.verdict.fixable && <Chip>Fix: {humanize(m.verdict.fixable)}</Chip>}
              </span>
            )}
            {m.ai_status === "FAILED" && (
              <span className={`mt-1 text-[11.5px] text-amber-ink ${own ? "text-right" : ""}`}>
                The assistant couldn’t answer this one.
              </span>
            )}
          </li>
        );
      })}

      {assistantTyping(thread) && (
        <li className="mt-3 flex justify-start">
          <span
            className="flex items-center gap-1 rounded-[12px] rounded-tl-[3px] bg-white px-4 py-3 shadow-[0_1px_0.5px_rgba(27,25,21,0.08)]"
            aria-label="Assistant is typing"
          >
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="size-1.5 animate-bounce rounded-full bg-subtle"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
        </li>
      )}
    </ol>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-white/90 px-2 py-0.5 text-[11.5px] text-muted shadow-sm">{children}</span>;
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
  const note = "mt-2 rounded-lg bg-black/[0.04] px-3 py-2 text-[13px] text-muted";
  if (!state.open) {
    return (
      <p className={note}>
        {state.bookedAt
          ? `Booked for ${formatSlot(state.bookedAt)}.`
          : state.skipped
            ? "Booking skipped."
            : "This booking is no longer open."}
      </p>
    );
  }
  if (!book) return <p className={note}>Waiting for the customer to pick a slot.</p>;
  return (
    <div className="mt-1">
      <SlotPicker days={slots} book={book} submitLabel="Book" />
      {skip && <SkipLink label="Skip booking" skip={skip} />}
    </div>
  );
}
