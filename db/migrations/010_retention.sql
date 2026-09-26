-- Retention: the scheduled job notices customers slipping away (a missed slot, a booking link left
-- unanswered, a service date gone by, a skipped booking offer), asks them in the chat what got in
-- the way, acts on the answer, and tells the workshop owner.
--
--   psql "$DATABASE_URL" -f db/migrations/010_retention.sql

-- One row per lapse.
--   kind      MISSED    a SCHEDULED slot passed without the car coming in (appointment -> MISSED)
--             NO_REPLY  a DUE appointment's booking link went unanswered (appointment -> NO_REPLY)
--             OVERDUE   the next service date set at the last visit went by with nothing booked
--             SKIPPED   the customer tapped "Skip booking" on a slot picker in the chat
--   ref_id    what lapsed: the appointment (MISSED, NO_REPLY), the visit that set the date
--             (OVERDUE) or the BOOKING message (SKIPPED); with lapsed_at it makes a lapse unique,
--             so a slot rebooked and missed again is a second lapse
--   appointment_id, recommendation_id  what the customer can still book, if anything
--   reason    the customer's answer to "what got in the way?"
--   customer_notified_at  when we asked them; NULL when held back (asked recently, or mid-triage)
--   owner_notified_at     when the workshop owner was told
CREATE TABLE IF NOT EXISTS retention_events (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id          UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id           UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    kind                 VARCHAR(10) NOT NULL CHECK (kind IN ('MISSED', 'NO_REPLY', 'OVERDUE', 'SKIPPED')),
    ref_id               UUID NOT NULL,
    lapsed_at            TIMESTAMPTZ NOT NULL,
    service              VARCHAR(100) NOT NULL,
    appointment_id       UUID REFERENCES appointments(id) ON DELETE SET NULL,
    recommendation_id    UUID REFERENCES recommendations(id) ON DELETE SET NULL,
    reason               VARCHAR(10) CHECK (reason IN ('TIMING', 'PRICE', 'ELSEWHERE', 'CAR_FINE', 'UNHAPPY')),
    answered_at          TIMESTAMPTZ,
    customer_notified_at TIMESTAMPTZ,
    owner_notified_at    TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (kind, ref_id, lapsed_at)
);

CREATE INDEX IF NOT EXISTS retention_events_customer_idx ON retention_events (customer_id, created_at);
CREATE INDEX IF NOT EXISTS retention_events_owner_idx ON retention_events (created_at) WHERE owner_notified_at IS NULL;

-- kind = REASON  asks "what got in the way?" for retention_event_id; options are the reasons.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS retention_event_id UUID REFERENCES retention_events(id) ON DELETE SET NULL;

-- Skipped when a later migration is already in effect (the list allows REASON, or rows use kinds
-- this list doesn't have), so re-running this file never narrows the list or fails on newer rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_kind_check' AND pg_get_constraintdef(oid) LIKE '%''REASON''%'
    ) AND NOT EXISTS (
        SELECT 1 FROM messages WHERE kind NOT IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE', 'APPROVAL', 'FEEDBACK', 'REASON')
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
        ALTER TABLE messages ADD CONSTRAINT messages_kind_check
            CHECK (kind IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE', 'APPROVAL', 'FEEDBACK', 'REASON'));
    END IF;
END $$;
