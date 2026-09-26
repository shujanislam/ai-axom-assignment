"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createAppointmentJobCard } from "./actions";

/** For appointments booked before job cards existed: plans the card and opens it. */
export function CreateJobCardButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const [creating, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      type="button"
      disabled={creating}
      title={error ?? undefined}
      className={`text-[13px] hover:underline disabled:opacity-50 ${error ? "text-amber" : "text-ink"}`}
      onClick={() =>
        startTransition(async () => {
          const result = await createAppointmentJobCard(appointmentId);
          if (result.jobCardId) router.push(`/job-cards/${result.jobCardId}`);
          else setError(result.error ?? "Could not create the job card");
        })
      }
    >
      {creating ? "Creating…" : error ? "Couldn’t create" : "Create job card"}
    </button>
  );
}
