import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/chat/auto-refresh";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { ScrollToEnd } from "@/components/chat/scroll-to-end";
import { Card, Dot, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getConversations, getThread } from "@/lib/server/chat";
import { replyToCustomer } from "./actions";

export const metadata: Metadata = { title: "Messages · Servicedesk" };

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const conversations = await getConversations();
  const { c } = await searchParams;
  const selected = conversations.find((x) => x.customer_id === c) ?? conversations[0];
  const thread = selected ? await getThread(selected.customer_id) : [];

  return (
    <>
      <AutoRefresh />
      <PageHeader title="Messages" subtitle="Customer conversations, with the assistant’s replies and bookings" />

      {conversations.length === 0 ? (
        <Card className="mt-6 grid min-h-[320px] place-items-center p-10 text-center text-[14px] text-muted">
          No conversations yet. They start when a follow-up is approved or a customer writes in.
        </Card>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit overflow-hidden">
            <ul>
              {conversations.map((x) => {
                const active = x.customer_id === selected?.customer_id;
                return (
                  <li key={x.customer_id} className="border-b border-line last:border-0">
                    <Link
                      href={`/messages?c=${x.customer_id}`}
                      aria-current={active ? "page" : undefined}
                      className={`block px-5 py-4 hover:bg-well/60 ${active ? "bg-well/60" : ""}`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-[14px] font-medium">
                          {x.last_sender === "CUSTOMER" && <Dot tone="amber" />}
                          {x.customer_name}
                        </span>
                        <span className="shrink-0 text-[11.5px] text-muted tabular">{formatDateTime(x.last_at)}</span>
                      </span>
                      <span className="mt-1 block truncate text-[13px] text-muted">{x.last_body}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          {selected && (
            <div className="flex min-w-0 flex-col">
              <MessageList thread={thread} viewer="ADVISOR" slots={[]} />
              <ScrollToEnd count={thread.length} />
              <div className="sticky bottom-0 mt-6 bg-canvas pb-2 pt-2">
                <Composer
                  send={replyToCustomer.bind(null, selected.customer_id)}
                  placeholder={`Reply to ${selected.customer_name}…`}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
