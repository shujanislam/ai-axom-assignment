-- Customer feedback: when a service is completed, the chat asks the customer to rate the visit
-- (1-5 stars and an optional comment). The model reads each comment for what it was about; the
-- ratings feed the assistant's picture of the customer and the choice of mechanic for new jobs.
--
--   psql "$DATABASE_URL" -f db/migrations/009_feedback.sql

-- One per completed visit. job_card_id and mechanic_id are snapshots of who did the job.
--   ai_status  PENDING until the comment has been read; DONE, FAILED (read from the rating
--              alone), or SKIPPED when there was no comment to read
--   sentiment  from the model, or from the rating when there is no comment
--   topics     what the customer talked about: [{"topic":"MECHANIC","sentiment":"NEGATIVE"}, ...]
--   summary    one line for advisors and the assistant
CREATE TABLE IF NOT EXISTS feedback (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    job_card_id    UUID REFERENCES job_cards(id) ON DELETE SET NULL,
    mechanic_id    UUID REFERENCES mechanics(id) ON DELETE SET NULL,
    rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT CHECK (length(comment) BETWEEN 1 AND 1000),
    ai_status      VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                   CHECK (ai_status IN ('PENDING', 'DONE', 'FAILED', 'SKIPPED')),
    sentiment      VARCHAR(10) CHECK (sentiment IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE')),
    topics         JSONB NOT NULL DEFAULT '[]',
    summary        TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS feedback_customer_idx ON feedback (customer_id, created_at);
CREATE INDEX IF NOT EXISTS feedback_mechanic_idx ON feedback (mechanic_id) WHERE mechanic_id IS NOT NULL;

-- kind = FEEDBACK  asks the customer to rate appointment_id; answered by the feedback row for it.
-- Skipped when a later migration is already in effect (the list allows FEEDBACK, or rows use kinds
-- this list doesn't have), so re-running this file never narrows the list or fails on newer rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_kind_check' AND pg_get_constraintdef(oid) LIKE '%''FEEDBACK''%'
    ) AND NOT EXISTS (
        SELECT 1 FROM messages WHERE kind NOT IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE', 'APPROVAL', 'FEEDBACK')
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
        ALTER TABLE messages ADD CONSTRAINT messages_kind_check
            CHECK (kind IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE', 'APPROVAL', 'FEEDBACK'));
    END IF;
END $$;
