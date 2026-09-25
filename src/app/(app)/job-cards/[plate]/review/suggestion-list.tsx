"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { ArrowRightIcon, CheckIcon, DiscIcon, OilIcon, PlusIcon, SnowIcon, SparkIcon } from "@/components/icons";
import { Button, ButtonLink, Card, PageHeader, Row, SectionLabel, Tag } from "@/components/ui";
import {
  actionLabel,
  humanize,
  priorities,
  priorityLevel,
  recommendationTypes,
  type AdvisorAction,
  type Priority,
} from "@/lib/format";
import {
  addObservation,
  setRecommendationAction,
  skipAllPending,
  updateWording,
  type ObservationState,
} from "../actions";

export type SuggestionItem = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  priority: Priority;
  action: AdvisorAction;
  advisorName: string | null;
  createdAt: string;
};

function RecommendationIcon({ title }: { title: string }) {
  if (/brake/i.test(title)) return <DiscIcon size={16} />;
  if (/\bac\b|air.?con|refrigerant/i.test(title)) return <SnowIcon size={16} />;
  if (/oil/i.test(title)) return <OilIcon size={16} />;
  return <SparkIcon size={16} />;
}

export function SuggestionList({
  plate,
  subtitle,
  recommendations,
  aside,
}: {
  plate: string;
  subtitle: string;
  recommendations: SuggestionItem[];
  aside: ReactNode;
}) {
  const [busy, startTransition] = useTransition();
  const pending = recommendations.filter((r) => r.action === "PENDING").length;

  return (
    <>
      <PageHeader
        title="Suggestions"
        subtitle={subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={busy || pending === 0}
              onClick={() => startTransition(() => skipAllPending(plate))}
            >
              Skip all
            </Button>
            <ButtonLink href={`/job-cards/${plate}`} icon={<ArrowRightIcon size={15} />}>
              Create job card
            </ButtonLink>
          </>
        }
      />

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-3.5">
          <SectionLabel count={pending}>To review</SectionLabel>
          {recommendations.length === 0 && (
            <Card className="grid min-h-[200px] place-items-center p-10 text-[14px] text-muted">
              No recommendations for this vehicle yet.
            </Card>
          )}
          {recommendations.map((r) => (
            <SuggestionCard key={r.id} plate={plate} item={r} />
          ))}
        </div>

        {aside}
      </div>
    </>
  );
}

function SuggestionCard({ plate, item }: { plate: string; item: SuggestionItem }) {
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ignored = item.action === "REJECTED";
  const accepted = item.action !== "PENDING" && !ignored;
  const locked = item.action !== "PENDING" && item.action !== "APPROVED" && !ignored;

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  return (
    <Card className={`p-6 transition-opacity ${ignored ? "opacity-50" : ""} ${busy ? "cursor-progress" : ""}`}>
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-well text-ink">
          <RecommendationIcon title={item.title} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] font-semibold tracking-[-0.01em]">{item.title}</h3>
          {item.description && <p className="mt-0.5 text-[13.5px] leading-[1.55] text-muted">{item.description}</p>}
        </div>
        <Tag className="shrink-0">{actionLabel[item.action]}</Tag>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div className="h-[3px] flex-1 rounded-full bg-line">
          <div className="h-full rounded-full bg-amber" style={{ width: `${priorityLevel[item.priority]}%` }} />
        </div>
        <span className="shrink-0 text-[12px] text-muted">{humanize(item.priority)} priority</span>
      </div>

      <dl className="mt-2.5 border-b border-line pb-3">
        <Row label="Type" value={humanize(item.type)} dense />
        <Row label="Raised" value={item.createdAt} dense />
        <Row label="Reviewed by" value={item.advisorName ?? "Not yet"} dense />
      </dl>

      {editing && (
        <form
          className="mt-4 space-y-2"
          action={(fd) =>
            run(async () => {
              await updateWording(plate, item.id, String(fd.get("title")), String(fd.get("description")));
              setEditing(false);
            })
          }
        >
          <input
            name="title"
            defaultValue={item.title}
            required
            maxLength={255}
            aria-label="Title"
            className="w-full rounded-xl bg-well px-4 py-2.5 text-[14px] font-medium outline-none focus:ring-1 focus:ring-ink"
          />
          <textarea
            name="description"
            defaultValue={item.description ?? ""}
            rows={3}
            aria-label="Description"
            className="w-full resize-none rounded-xl bg-well px-4 py-3 text-[13.5px] outline-none focus:ring-1 focus:ring-ink"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="outline" type="submit" disabled={busy}>
              Save wording
            </Button>
          </div>
        </form>
      )}

      {error && <p className="mt-3 text-[12.5px] text-amber-ink">{error}</p>}

      <div className="mt-4 flex items-center gap-4 text-[13.5px]">
        {!locked && (
          <button
            disabled={busy}
            className="text-muted hover:text-ink disabled:opacity-50"
            onClick={() => run(() => setRecommendationAction(plate, item.id, ignored ? "PENDING" : "REJECTED"))}
          >
            {ignored ? "Restore" : "Ignore"}
          </button>
        )}
        {!editing && (
          <button disabled={busy} className="text-muted hover:text-ink disabled:opacity-50" onClick={() => setEditing(true)}>
            Edit wording
          </button>
        )}
        {!locked && (
          <Button
            variant="outline"
            className="ml-auto"
            disabled={busy || ignored}
            onClick={() => run(() => setRecommendationAction(plate, item.id, accepted ? "PENDING" : "APPROVED"))}
            icon={accepted ? <CheckIcon size={14} /> : <ArrowRightIcon size={14} />}
          >
            {accepted ? "Accepted" : "Accept"}
          </Button>
        )}
      </div>
    </Card>
  );
}

const selectClass =
  "h-10 w-full rounded-xl bg-white px-3 text-[13.5px] outline-none focus:ring-1 focus:ring-ink";

export function AddObservation({ plate }: { plate: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, saving] = useActionState<ObservationState, FormData>(async (prev, formData) => {
    const next = await addObservation(plate, prev, formData);
    if (next.ok) setOpen(false);
    return next;
  }, {});

  return (
    <div className="rounded-[20px] border border-dashed border-[#dcd9d3] p-6">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-4 text-left">
        <span className="grid size-10 place-items-center rounded-xl bg-white text-muted">
          <PlusIcon size={16} />
        </span>
        <span>
          <span className="block text-[14.5px] font-semibold">Add your own observation</span>
          <span className="block text-[12.5px] text-muted">Anything the records would not show</span>
        </span>
      </button>

      {state.ok && !open && (
        <p className="mt-4 text-[12.5px] text-muted">Added to the job card.</p>
      )}

      {open && (
        <form action={formAction} className="mt-4 space-y-2">
          <input
            name="title"
            required
            maxLength={255}
            placeholder="e.g. Rear suspension bushes — check for play"
            aria-label="Title"
            className="h-10 w-full rounded-xl bg-white px-4 text-[13.5px] outline-none placeholder:text-subtle focus:ring-1 focus:ring-ink"
          />
          <textarea
            name="description"
            rows={3}
            placeholder="What you saw or heard, and where"
            aria-label="Description"
            className="w-full resize-none rounded-xl bg-white px-4 py-3 text-[13.5px] outline-none placeholder:text-subtle focus:ring-1 focus:ring-ink"
          />
          <div className="grid grid-cols-2 gap-2">
            <select name="type" defaultValue="INSPECTION" aria-label="Type" className={selectClass}>
              {recommendationTypes.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            <select name="priority" defaultValue="MEDIUM" aria-label="Priority" className={selectClass}>
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)} priority
                </option>
              ))}
            </select>
          </div>
          {state.error && <p className="text-[12.5px] text-amber-ink">{state.error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add to job card"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
