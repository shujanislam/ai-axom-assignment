"use client";

import { useTransition } from "react";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { sendToWorkshop } from "./actions";

export function JobCardActions({ plate, toSend }: { plate: string; toSend: number }) {
  const [sending, startTransition] = useTransition();

  return (
    <>
      <Button variant="secondary" onClick={() => window.print()}>
        Print
      </Button>
      <Button
        onClick={() => startTransition(() => sendToWorkshop(plate))}
        disabled={sending || toSend === 0}
        icon={toSend === 0 ? <CheckIcon size={15} /> : <ArrowRightIcon size={15} />}
      >
        {sending ? "Sending…" : toSend === 0 ? "Nothing new to send" : `Send ${toSend} to workshop`}
      </Button>
    </>
  );
}
