"use client";

import { useState, useTransition } from "react";

/**
 * A triage question's options. Tappable only for the customer while it is the newest question;
 * otherwise read-only, with the picked option highlighted.
 */
export function QuestionOptions({
  options,
  chosen,
  answer,
}: {
  options: string[];
  chosen: string | null;
  answer?: (option: string) => Promise<{ error?: string }>;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const selected = chosen ?? picked;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected === option;
          return (
            <button
              key={option}
              type="button"
              disabled={!answer || sending || selected !== null}
              aria-pressed={isSelected}
              onClick={() =>
                answer &&
                startTransition(async () => {
                  setError(null);
                  setPicked(option);
                  const result = await answer(option).catch(() => ({ error: "Couldn’t send. Try again." }));
                  if (result.error) {
                    setError(result.error);
                    setPicked(null);
                  }
                })
              }
              className={`rounded-full px-3.5 py-2 text-left text-[13.5px] transition-colors ${
                isSelected
                  ? "bg-ink text-white"
                  : answer && selected === null
                    ? "bg-well text-ink hover:bg-line"
                    : "bg-well text-muted"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {answer && selected === null && (
        <p className="mt-2 text-[12px] text-muted">Tap an option, or type your own answer below.</p>
      )}
      {error && <p className="mt-2 text-[12.5px] text-amber">{error}</p>}
    </div>
  );
}
