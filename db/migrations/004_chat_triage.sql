-- Problem triage in the customer chat: when a customer reports a problem, the assistant asks
-- 1-5 multiple-choice questions, then decides between a consultation (advice only) and an
-- appointment (recommendation + slot picker).
--
--   psql "$DATABASE_URL" -f db/migrations/004_chat_triage.sql

CREATE TABLE IF NOT EXISTS triages (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id          UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id           UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    summary              TEXT NOT NULL,
    status               VARCHAR(12) NOT NULL DEFAULT 'OPEN'
                         CHECK (status IN ('OPEN', 'CONSULT', 'APPOINTMENT', 'ABANDONED')),
    fault                VARCHAR(10) CHECK (fault IN ('WORKSHOP', 'CUSTOMER', 'WEAR', 'UNCLEAR')),
    fixable              VARCHAR(10) CHECK (fixable IN ('IN_HOUSE', 'SPECIALIST', 'DIY', 'UNCLEAR')),
    recommendation_id    UUID REFERENCES recommendations(id) ON DELETE SET NULL,
    concluded_message_id UUID,
    created_at           TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    closed_at            TIMESTAMP
);

-- At most one problem being triaged per customer at a time.
CREATE UNIQUE INDEX IF NOT EXISTS triages_one_open_idx ON triages (customer_id) WHERE status = 'OPEN';

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS triage_id UUID REFERENCES triages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS options JSONB;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('TEXT', 'BOOKING', 'QUESTION'));

-- A question always carries 2-5 options.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_question_options_check;
ALTER TABLE messages ADD CONSTRAINT messages_question_options_check CHECK (
    kind <> 'QUESTION' OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 5)
);

CREATE INDEX IF NOT EXISTS messages_triage_idx ON messages (triage_id) WHERE triage_id IS NOT NULL;
