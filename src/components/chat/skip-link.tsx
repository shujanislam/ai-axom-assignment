"use client";

import { useState, useTransition } from "react";

/** A quiet text button under a question or a booking offer, e.g. "Skip the questions". */
export function SkipLink({ label, skip }: { label: string; skip: () => Promise<{ error?: string }> }) {
  const [skipping, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <p className="mt-2.5 text-[12.5px]">
      <button
        type="button"
        disabled={skipping}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await skip().catch(() => ({ error: "Couldn’t skip. Try again." }));
            if (result.error) setError(result.error);
          })
        }
        className="text-muted underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50"
      >
        {skipping ? "Skipping…" : label}
      </button>
      {error && <span className="ml-2 text-amber">{error}</span>}
    </p>
  );
}
