-- Extra work found during a job: the workshop adds it to the job card, the customer approves or
-- declines it in the chat, and approved work is added to the invoice.
--
--   psql "$DATABASE_URL" -f db/migrations/008_extra_work.sql

-- cost is priced when the work is added (same shape as invoices.cost) and never changes; the
-- card's own estimate stays as booked, and approved extras are added on top of it.
--   PENDING    waiting for the customer
--   APPROVED   goes on the invoice
--   DECLINED   the customer said no
--   CANCELLED  withdrawn by the workshop, or still pending when the job was completed
CREATE TABLE IF NOT EXISTS job_card_extras (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_card_id UUID NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
    title       VARCHAR(120) NOT NULL,
    note        TEXT,
    part_id     UUID REFERENCES parts(id) ON DELETE SET NULL,
    part_qty    INT CHECK (part_qty > 0),
    parts_short BOOLEAN NOT NULL DEFAULT false,
    cost        JSONB NOT NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED')),
    advisor_id  UUID REFERENCES advisors(id) ON DELETE SET NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    decided_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS job_card_extras_card_idx ON job_card_extras (job_card_id, created_at);

-- kind = APPROVAL  asks the customer to approve extra_id.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS extra_id UUID REFERENCES job_card_extras(id) ON DELETE SET NULL;

-- Skipped when a later migration is already in effect (the list allows APPROVAL, or rows use kinds
-- this list doesn't have), so re-running this file never narrows the list or fails on newer rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_kind_check' AND pg_get_constraintdef(oid) LIKE '%''APPROVAL''%'
    ) AND NOT EXISTS (
        SELECT 1 FROM messages WHERE kind NOT IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE', 'APPROVAL')
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
        ALTER TABLE messages ADD CONSTRAINT messages_kind_check
            CHECK (kind IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE', 'APPROVAL'));
    END IF;
END $$;
