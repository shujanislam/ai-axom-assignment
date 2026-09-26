// The model reads a customer's comment for what it was about: the work, the mechanic, the price,
// the wait, how we kept them posted. Low ratings are also logged as complaints for advisors.
import { aiClient, aiModel, parseJsonObject } from "@/lib/ai";
import { COMPLAINT_TYPES } from "@/lib/chat/constants";
import { sql } from "@/lib/db";

export const TOPICS = ["WORK_QUALITY", "MECHANIC", "PRICE", "TIMELINESS", "COMMUNICATION", "FACILITY"] as const;
export const SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE"] as const;

type Sentiment = (typeof SENTIMENTS)[number];
export type FeedbackTopic = { topic: (typeof TOPICS)[number]; sentiment: Sentiment };

/** A rating of 2 or less is a complaint an advisor should follow up. */
const COMPLAINT_BELOW = 3;

const SYSTEM_PROMPT = `You read customer feedback for a car workshop in India. You get the service
that was done, the mechanic, the invoice total, the star rating (1-5) and the customer's comment.

Reply with JSON only, no prose, exactly:
{"sentiment":"...","topics":[{"topic":"...","sentiment":"..."}],"summary":"...","complaint_type":null}

- "sentiment": the overall feeling, one of ${SENTIMENTS.join(", ")}. Trust the comment over the stars.
- "topics": only what the comment actually mentions, each with its own sentiment. topic is one of:
  WORK_QUALITY (the repair itself, whether the problem is fixed), MECHANIC (the person who did the
  job), PRICE, TIMELINESS (waiting, delays, ready on time), COMMUNICATION (updates, explanations,
  the advisor), FACILITY (cleanliness, the waiting area, the car returned dirty or damaged).
- "summary": one sentence in English for the advisor, e.g. "Happy with the brakes, but waited
  2 hours past the promised time." Keep names and specifics.
- "complaint_type": if the customer is unhappy about something the workshop should act on, one of
  ${COMPLAINT_TYPES.join(", ")}; otherwise null.`;

type Reading = {
  sentiment: Sentiment;
  topics: FeedbackTopic[];
  summary: string | null;
  complaint_type: (typeof COMPLAINT_TYPES)[number] | null;
};

type Claimed = {
  id: string;
  customer_id: string;
  vehicle_id: string;
  rating: number;
  comment: string | null;
  service: string;
  mechanic_name: string | null;
  invoice_total: number | null;
};

const fromRating = (rating: number): Sentiment => (rating >= 4 ? "POSITIVE" : rating === 3 ? "NEUTRAL" : "NEGATIVE");

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null;

async function askModel(f: Claimed & { comment: string }): Promise<Reading> {
  const client = aiClient();
  if (!client) throw new Error("GEMINI_API_KEY is not set");
  const completion = await client.chat.completions.create({
    model: aiModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          service: f.service,
          mechanic: f.mechanic_name,
          invoice_total_rupees: f.invoice_total,
          rating: f.rating,
          comment: f.comment,
        }),
      },
    ],
  });
  const raw = parseJsonObject<{ sentiment?: unknown; topics?: unknown; summary?: unknown; complaint_type?: unknown }>(
    completion.choices[0]?.message?.content ?? "",
  );

  const topics = new Map<string, FeedbackTopic>();
  for (const t of Array.isArray(raw.topics) ? raw.topics : []) {
    const topic = oneOf(t?.topic, TOPICS);
    const sentiment = oneOf(t?.sentiment, SENTIMENTS);
    if (topic && sentiment) topics.set(topic, { topic, sentiment });
  }
  return {
    sentiment: oneOf(raw.sentiment, SENTIMENTS) ?? fromRating(f.rating),
    topics: [...topics.values()],
    summary:
      String(raw.summary ?? "")
        .trim()
        .slice(0, 300) || null,
    complaint_type: oneOf(raw.complaint_type, COMPLAINT_TYPES),
  };
}

/**
 * Reads a saved feedback once. The rating's sentiment is written first and doubles as the claim,
 * so overlapping runs don't log two complaints; it stays when there is no comment or the model fails.
 */
export async function reviewFeedback(feedbackId: string) {
  const [f] = (await sql`
    WITH claimed AS (
      UPDATE feedback
      SET sentiment = CASE WHEN rating >= 4 THEN 'POSITIVE' WHEN rating = 3 THEN 'NEUTRAL' ELSE 'NEGATIVE' END
      WHERE id = ${feedbackId} AND sentiment IS NULL
      RETURNING id, customer_id, appointment_id, rating, comment, mechanic_id
    )
    SELECT c.id, c.customer_id, a.vehicle_id, c.rating, c.comment, a.appointment_type AS service,
      m.name AS mechanic_name,
      (SELECT (i.cost->>'total')::int FROM invoices i
        WHERE i.appointment_id = a.id ORDER BY i.created_at DESC LIMIT 1) AS invoice_total
    FROM claimed c
    JOIN appointments a ON a.id = c.appointment_id
    LEFT JOIN mechanics m ON m.id = c.mechanic_id`) as Claimed[];
  if (!f) return;

  const started = Date.now();
  let reading: Reading = { sentiment: fromRating(f.rating), topics: [], summary: null, complaint_type: null };
  let failed = false;
  if (f.comment) {
    try {
      reading = await askModel({ ...f, comment: f.comment });
      console.log(`[feedback] read ${f.id} in ${Date.now() - started}ms`);
    } catch (error) {
      failed = true;
      console.error(`[feedback] reading ${f.id} failed after ${Date.now() - started}ms:`, error);
    }
  }

  await sql`
    UPDATE feedback SET sentiment = ${reading.sentiment}, topics = ${JSON.stringify(reading.topics)}::jsonb,
      summary = ${reading.summary}, ai_status = ${failed ? "FAILED" : f.comment ? "DONE" : "SKIPPED"}
    WHERE id = ${f.id}`;

  if (f.rating < COMPLAINT_BELOW || reading.complaint_type) {
    await sql`
      INSERT INTO complaints (customer_id, vehicle_id, complaint_type)
      VALUES (${f.customer_id}, ${f.vehicle_id}, ${reading.complaint_type ?? "SERVICE_ISSUE"}::complaint_type)`;
  }
}
