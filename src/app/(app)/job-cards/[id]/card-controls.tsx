"use client";

import { useState, useTransition } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import type { MechanicOption } from "@/lib/job-cards/queries";
import { sendToWorkshop } from "@/app/(app)/vehicles/[plate]/review/actions";
import { assignMechanic, startJob } from "./actions";

export function StartJobButton({ jobCardId }: { jobCardId: string }) {
  const [starting, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2.5">
      {error && <span className="text-[12.5px] text-amber">{error}</span>}
      <Button
        disabled={starting}
        icon={<ArrowRightIcon size={15} />}
        onClick={() =>
          startTransition(async () => {
            const result = await startJob(jobCardId);
            setError(result.error ?? null);
          })
        }
      >
        {starting ? "Starting…" : "Start job"}
      </Button>
    </span>
  );
}

/** Pick another mechanic with the card's skill; busy ones are listed but can't be picked. */
export function MechanicPicker({ jobCardId, options }: { jobCardId: string; options: MechanicOption[] }) {
  const current = options.find((o) => o.current)?.id ?? "";
  const [selected, setSelected] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  if (options.length === 0) {
    return <p className="mt-3 text-[13px] text-amber">Nobody on the team has this skill.</p>;
  }

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-[13.5px]"
        >
          {!current && <option value="">Pick a mechanic…</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.free && !o.current}>
              {o.name} · level {o.level}
              {o.current ? " (on this job)" : o.free ? "" : " (busy)"}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={saving || !selected || selected === current}
          onClick={() =>
            startTransition(async () => {
              const result = await assignMechanic(jobCardId, selected);
              setError(result.error ?? null);
            })
          }
        >
          {saving ? "Saving…" : current ? "Reassign" : "Assign"}
        </Button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-amber">{error}</p>}
    </div>
  );
}

export function SendToWorkshopButton({ plate, count }: { plate: string; count: number }) {
  const [sending, startTransition] = useTransition();
  return (
    <Button variant="outline" disabled={sending} onClick={() => startTransition(() => sendToWorkshop(plate))}>
      {sending ? "Sending…" : `Send ${count} to workshop`}
    </Button>
  );
}
