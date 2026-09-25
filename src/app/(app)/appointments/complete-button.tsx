"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { completeAppointment, type CompleteResult } from "./actions";

export function CompleteButton({ appointmentId }: { appointmentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [completing, startTransition] = useTransition();
  const [result, setResult] = useState<CompleteResult | { error: string } | null>(null);

  if (result && "emailed" in result) {
    return result.emailed ? (
      <span className="text-[13px] text-muted">Invoice emailed</span>
    ) : (
      <span className="text-[13px] text-amber" title={result.reason}>
        Completed, invoice not sent
      </span>
    );
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {result && "error" in result && <span className="text-[12.5px] text-amber">{result.error}</span>}
      <Button
        variant="outline"
        disabled={completing}
        icon={confirming ? <CheckIcon size={13} /> : undefined}
        onBlur={() => !completing && setConfirming(false)}
        onClick={() => {
          if (!confirming) return setConfirming(true);
          startTransition(async () => {
            try {
              setResult(await completeAppointment(appointmentId));
            } catch (error) {
              setResult({ error: error instanceof Error ? error.message : "Could not complete" });
              setConfirming(false);
            }
          });
        }}
      >
        {completing ? "Completing…" : confirming ? "Confirm & send invoice" : "Complete"}
      </Button>
    </span>
  );
}
