// The customer's answer to a FEEDBACK message: saves the rating and thanks them in the chat.
import { sql } from "@/lib/db";
import { postAssistantMessage } from "@/lib/chat/messages";

/**
 * Saves the rating for the visit the FEEDBACK message asks about, with a snapshot of the job card
 * and mechanic. Only one rating per visit: returns the new feedback's id, or null if the message
 * isn't this customer's or the visit was already rated.
 */
export async function saveFeedback(customerId: string, messageId: string, rating: number, comment: string | null) {
  const [row] = (await sql`
    WITH ask AS (
      SELECT m.customer_id, m.appointment_id FROM messages m
      WHERE m.id = ${messageId} AND m.customer_id = ${customerId} AND m.kind = 'FEEDBACK'
    )
    INSERT INTO feedback (customer_id, appointment_id, job_card_id, mechanic_id, rating, comment, ai_status)
    SELECT ask.customer_id, ask.appointment_id, j.id, j.mechanic_id, ${rating}, ${comment},
      ${comment ? "PENDING" : "SKIPPED"}
    FROM ask
    LEFT JOIN job_cards j ON j.appointment_id = ask.appointment_id AND j.status <> 'CANCELLED'
    ON CONFLICT (appointment_id) DO NOTHING
    RETURNING id`) as { id: string }[];
  if (!row) return null;

  await postAssistantMessage(
    customerId,
    rating >= 4
      ? "Thank you! We’re glad it went well. See you at your next service."
      : rating === 3
        ? "Thanks for telling us. We’ll look at what we could have done better."
        : "We’re sorry the visit didn’t go well. An advisor will look into it and get back to you here.",
  );
  return row.id;
}
