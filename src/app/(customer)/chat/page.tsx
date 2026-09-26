import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/chat/auto-refresh";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { ScrollToEnd } from "@/components/chat/scroll-to-end";
import { getCurrentCustomer } from "@/lib/auth/accounts";
import { bookingState, getThread } from "@/lib/chat/thread";
import { groupSlotsByDay, type SlotDay } from "@/lib/booking/slots";
import { getFreeSlots } from "@/lib/job-cards/plan";
import { answerChatQuestion, bookFromChat, sendMessage, skipChatBooking, skipChatQuestions } from "./actions";

export const metadata: Metadata = { title: "Messages · gear-ai" };

export default async function CustomerChatPage() {
  // Layouts and pages render in parallel, so the page checks too rather than trusting the layout.
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/session-expired");
  const thread = await getThread(customer.id);
  // Each open booking offers the slots where a mechanic who can do that job is free.
  const jobs = new Set(
    thread.filter((m) => m.kind === "BOOKING" && m.booking_job && bookingState(m).open).map((m) => m.booking_job!),
  );
  const slotsByJob = new Map<string, SlotDay[]>(
    await Promise.all([...jobs].map(async (job) => [job, groupSlotsByDay((await getFreeSlots(job)).slots)] as const)),
  );

  return (
    <>
      <AutoRefresh />
      <h1 className="text-[26px] font-bold italic leading-tight tracking-[-0.03em]">Messages</h1>
      <p className="mt-1 text-[13.5px] text-muted">Ask about your vehicle, tell us about a problem, or book a visit.</p>

      <div className="mt-6 flex-1">
        {thread.length === 0 ? (
          <p className="rounded-[18px] bg-white px-5 py-4 text-[14px] text-muted">
            Hi {customer.name.split(" ")[0]}, how can we help? Describe any problem with your vehicle, or say which
            service you’d like to book.
          </p>
        ) : (
          <MessageList
            thread={thread}
            viewer="CUSTOMER"
            slots={(m) => (m.booking_job && slotsByJob.get(m.booking_job)) || []}
            book={(id) => bookFromChat.bind(null, id)}
            answer={(id) => answerChatQuestion.bind(null, id)}
            skipQuestions={(id) => skipChatQuestions.bind(null, id)}
            skipBooking={(id) => skipChatBooking.bind(null, id)}
          />
        )}
        <ScrollToEnd count={thread.length} />
      </div>

      <div className="sticky bottom-0 mt-6 bg-canvas pb-2 pt-2">
        <Composer send={sendMessage} placeholder="Type a message…" />
      </div>
    </>
  );
}
