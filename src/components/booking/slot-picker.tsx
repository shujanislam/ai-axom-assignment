"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui";

import type { SlotDay } from "@/lib/booking/slots";

export type { SlotDay };

/** Free slots grouped by day. `book` is a server action bound to what is being booked. */
export function SlotPicker({
  days,
  book,
  submitLabel = "Confirm slot",
}: {
  days: SlotDay[];
  book: (slotIso: string) => Promise<{ error?: string }>;
  submitLabel?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, startTransition] = useTransition();

  if (days.length === 0) {
    return <p className="mt-6 text-[14px] text-muted">No free slots this week. Please call the workshop to book.</p>;
  }

  return (
    <div className="mt-6">
      <div className="space-y-5">
        {days.map((d) => (
          <fieldset key={d.day}>
            <legend className="text-[13px] text-muted">{d.day}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {d.slots.map((s) => (
                <button
                  key={s.iso}
                  type="button"
                  aria-pressed={selected === s.iso}
                  onClick={() => setSelected(s.iso)}
                  className={`h-9 rounded-full px-4 text-[13.5px] tabular transition-colors ${
                    selected === s.iso ? "bg-ink text-white" : "bg-well text-ink hover:bg-line"
                  }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <Button
        className="mt-7 w-full"
        disabled={!selected || booking}
        icon={<CheckIcon size={15} />}
        onClick={() =>
          selected &&
          startTransition(async () => {
            setError(null);
            const result = await book(selected);
            if (result.error) {
              setError(result.error);
              setSelected(null);
            }
          })
        }
      >
        {booking ? "Booking…" : submitLabel}
      </Button>
      {error && <p className="mt-3 text-center text-[13px] text-amber">{error}</p>}
    </div>
  );
}
