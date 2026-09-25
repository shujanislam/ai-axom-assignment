"use client";

import { useRef, useState, useTransition } from "react";
import { SendIcon } from "@/components/icons";

/** Message box. Enter sends, Shift+Enter adds a line. `send` is a bound server action. */
export function Composer({
  send,
  placeholder,
}: {
  send: (body: string) => Promise<{ error?: string }>;
  placeholder: string;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = body.trim();
    if (!text || sending) return;
    startTransition(async () => {
      setError(null);
      const result = await send(text).catch(() => ({ error: "Couldn’t send. Try again." }));
      if (result.error) return setError(result.error);
      setBody("");
      ref.current?.focus();
    });
  };

  return (
    <div>
      <div className="flex items-end gap-2 rounded-[20px] bg-white p-2 pl-4">
        <textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[14px] outline-none placeholder:text-subtle"
        />
        <button
          type="button"
          onClick={submit}
          disabled={sending || !body.trim()}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white transition-colors hover:bg-[#34302a] disabled:opacity-40"
        >
          <SendIcon size={16} />
        </button>
      </div>
      {error && <p className="mt-2 px-2 text-[12.5px] text-amber">{error}</p>}
    </div>
  );
}
