"use client";

import { useState, useTransition } from "react";
import { SparkIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { reevaluateServiceDue, type ReevaluateResult } from "./actions";

export function ReevaluateButton() {
  const [running, startTransition] = useTransition();
  const [result, setResult] = useState<ReevaluateResult | null>(null);

  const label = running
    ? "Re-evaluating…"
    : result === null
      ? "Re-evaluate"
      : !result.ok
        ? "Failed, retry"
        : `${result.added === 0 ? "Nothing new" : `${result.added} added`}${result.aiQueued ? " · AI checking notes" : ""}`;

  return (
    <Button
      variant="secondary"
      className="flex-row-reverse"
      disabled={running}
      title="Adds services due by interval right away; the AI then reviews visit notes in the background (reload to see its findings)."
      onClick={() =>
        startTransition(async () => {
          setResult(await reevaluateServiceDue().catch(() => ({ ok: false }) as const));
        })
      }
    >
      {label}
      <SparkIcon size={15} />
    </Button>
  );
}
