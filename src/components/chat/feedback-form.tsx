"use client";

import { useState, useTransition } from "react";
import { StarIcon } from "@/components/icons";
import { FEEDBACK_COMMENT_MAX } from "@/lib/chat/constants";

const LABELS = ["Very poor", "Poor", "Okay", "Good", "Excellent"];

/** Five stars, amber up to `rating`. */
export function Stars({ rating, size = 20 }: { rating: number; size?: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          size={size}
          className={n <= rating ? "text-amber" : "text-idle"}
          fill={n <= rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

/**
 * The customer rates a finished visit: tap a star, optionally say why, send. Once sent (or for
 * advisors, who get no `rate`) it shows the rating read-only.
 */
export function FeedbackForm({
  rated,
  rate,
}: {
  rated: { rating: number; comment: string | null } | null;
  rate?: (rating: number, comment: string) => Promise<{ error?: string }>;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();

  if (rated) {
    return (
      <div className="mt-2 rounded-lg bg-black/[0.04] px-3 py-2.5">
        <Stars rating={rated.rating} size={18} />
        {rated.comment && <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-ink">“{rated.comment}”</p>}
      </div>
    );
  }
  if (!rate) return <p className="mt-2 rounded-lg bg-black/[0.04] px-3 py-2 text-[13px] text-muted">Not rated yet.</p>;

  const shown = hover || rating;
  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await rate(rating, comment.trim()).catch(() => ({ error: "Couldn’t send. Try again." }));
      if (result.error) setError(result.error);
    });

  return (
    <div className="mt-2 rounded-lg bg-black/[0.04] px-3 py-3">
      <div className="flex items-center gap-3" onMouseLeave={() => setHover(0)}>
        <span className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} ${n === 1 ? "star" : "stars"}, ${LABELS[n - 1]}`}
              disabled={sending}
              onMouseEnter={() => setHover(n)}
              onClick={() => setRating(n)}
              className="transition-transform hover:scale-110 disabled:opacity-50"
            >
              <StarIcon
                size={28}
                className={n <= shown ? "text-amber" : "text-idle"}
                fill={n <= shown ? "currentColor" : "none"}
              />
            </button>
          ))}
        </span>
        <span className="text-[12.5px] text-muted">{shown ? LABELS[shown - 1] : "Tap to rate"}</span>
      </div>

      {rating > 0 && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={FEEDBACK_COMMENT_MAX}
            disabled={sending}
            placeholder={
              rating >= 4 ? "What went well? (optional)" : "What could we have done better? (optional)"
            }
            aria-label="Comment"
            className="mt-3 w-full resize-none rounded-lg bg-white px-3 py-2 text-[13.5px] outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={submit}
            disabled={sending}
            className="mt-2 rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#34302a] disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send feedback"}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-[12.5px] text-amber">{error}</p>}
    </div>
  );
}
