"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { completeAppointment, type CompleteResult } from "./actions";

/** Stays mounted when the row flips to COMPLETED, so the email outcome survives the page refresh. */
export function CompleteButton({
  appointmentId,
  invoiceId,
  canComplete,
}: {
  appointmentId: string;
  invoiceId: string | null;
  canComplete: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [completing, startTransition] = useTransition();
  const [result, setResult] = useState<CompleteResult | { error: string } | null>(null);

  if (result && "emailed" in result) {
    return (
      <Link
        href={`/invoices/${result.invoiceId}`}
        className={`text-[13px] hover:underline ${result.emailed ? "text-muted" : "text-amber"}`}
        title={result.emailed ? undefined : result.reason}
      >
        {result.emailed ? "Invoice emailed" : "Invoice saved, email not sent"}
      </Link>
    );
  }

  if (invoiceId) {
    return (
      <Link href={`/invoices/${invoiceId}`} className="text-[13px] text-muted hover:underline">
        View invoice
      </Link>
    );
  }
  if (!canComplete) return null;

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
