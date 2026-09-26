import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/chat/auto-refresh";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { ScrollToEnd } from "@/components/chat/scroll-to-end";
import { ArrowLeftIcon } from "@/components/icons";
import { initials } from "@/lib/format";
import { getConversations, getThread, type Conversation } from "@/lib/chat/thread";
import { replyToCustomer } from "./actions";
import { ConversationList, type ConversationItem } from "./conversation-list";

export const metadata: Metadata = { title: "Messages · gear-ai" };

const TZ = "Asia/Kolkata";
const dayKey = (d: Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });

/** Messenger-style list time: 14:05 today, "Yesterday", weekday this week, else a date. */
function listTime(d: Date) {
  const key = dayKey(d);
  if (key === dayKey(new Date()))
    return new Date(d).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  if (key === dayKey(new Date(Date.now() - 86_400_000))) return "Yesterday";
  if (Date.now() - +new Date(d) < 6 * 86_400_000)
    return new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long" });
  return new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" });
}

function preview(c: Conversation) {
  const text = c.last_body
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const who = c.last_sender === "ASSISTANT" ? "Assistant: " : c.last_sender === "ADVISOR" ? "Advisor: " : "";
  const what = c.last_kind === "QUESTION" ? "Question: " : c.last_kind === "BOOKING" ? "Booking: " : "";
  return `${who}${what}${text}`;
}

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const conversations = await getConversations();
  const { c } = await searchParams;
  // On phones a thread only opens when picked; on laptops the newest chat is open by default.
  const picked = conversations.find((x) => x.customer_id === c) ?? null;
  const active = picked ?? conversations[0] ?? null;
  const thread = active ? await getThread(active.customer_id) : [];

  const items: ConversationItem[] = conversations.map((x) => ({
    id: x.customer_id,
    name: x.customer_name,
    initials: initials(x.customer_name),
    preview: preview(x),
    time: listTime(x.last_at),
    unanswered: x.unanswered,
    search: [x.customer_name, x.phone_number, ...x.vehicles].join(" ").toLowerCase(),
  }));
  const waiting = conversations.filter((x) => x.unanswered > 0).length;

  return (
    <>
      <AutoRefresh />
      <div className="lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(290px,360px)_1fr] lg:overflow-hidden lg:rounded-[20px] lg:bg-white">
        {/* Chat list: the whole screen on phones, the left pane on laptops. */}
        <section
          className={`${picked ? "hidden lg:flex" : "flex"} min-h-0 flex-col overflow-hidden rounded-[20px] bg-white lg:rounded-none lg:border-r lg:border-line`}
        >
          <header className="px-4 pb-3 pt-5">
            <h1 className="text-[24px] font-bold italic leading-tight tracking-[-0.03em]">Messages</h1>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {conversations.length} chats{waiting > 0 && ` · ${waiting} waiting for a reply`}
            </p>
          </header>
          {conversations.length === 0 ? (
            <p className="px-4 pb-10 pt-6 text-center text-[13.5px] text-muted">
              No conversations yet. They start when a follow-up is approved or a customer writes in.
            </p>
          ) : (
            <ConversationList items={items} activeId={active?.customer_id ?? null} picked={picked !== null} />
          )}
        </section>

        {/* Thread: full screen on phones (with a back arrow), the right pane on laptops. */}
        {active ? (
          <section
            className={`${picked ? "fixed inset-0 z-40 flex" : "hidden lg:flex"} min-h-0 flex-col bg-white lg:static lg:z-auto`}
          >
            <header className="flex items-center gap-3 border-b border-line bg-white px-3 py-2.5 sm:px-4">
              <Link
                href="/messages"
                aria-label="Back to chats"
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-well hover:text-ink lg:hidden"
              >
                <ArrowLeftIcon size={18} />
              </Link>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e6e4df] text-[13px] font-semibold text-[#55514b]">
                {initials(active.customer_name)}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[15px] font-medium">{active.customer_name}</span>
                <span className="mt-0.5 block truncate text-[12px] text-muted">
                  <a href={`tel:${active.phone_number.replace(/\s+/g, "")}`} className="hover:text-ink hover:underline">
                    {active.phone_number}
                  </a>
                  {active.vehicles.map((plate) => (
                    <span key={plate}>
                      {" · "}
                      <Link href={`/vehicles/${plate}`} className="hover:text-ink hover:underline">
                        {plate}
                      </Link>
                    </span>
                  ))}
                </span>
              </span>
            </header>

            <div className="chat-wallpaper min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1 sm:px-6 lg:px-10">
              <div className="mx-auto max-w-[860px]">
                <MessageList thread={thread} viewer="ADVISOR" />
                <ScrollToEnd count={thread.length} />
              </div>
            </div>

            <footer className="border-t border-line bg-well px-2 py-2 sm:px-4 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-[860px]">
                <Composer
                  send={replyToCustomer.bind(null, active.customer_id)}
                  placeholder={`Message ${active.customer_name.split(" ")[0]}…`}
                />
              </div>
            </footer>
          </section>
        ) : (
          <section className="hidden place-items-center bg-well text-[14px] text-muted lg:grid">
            Pick a chat to read it.
          </section>
        )}
      </div>
    </>
  );
}
