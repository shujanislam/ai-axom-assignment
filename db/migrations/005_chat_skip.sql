-- Customers can skip the triage questions and skip a booking offer in the chat.
--
--   psql "$DATABASE_URL" -f db/migrations/005_chat_skip.sql

-- SKIPPED: the customer skipped the questions; the problem goes to an advisor for inspection.
ALTER TABLE triages DROP CONSTRAINT IF EXISTS triages_status_check;
ALTER TABLE triages ADD CONSTRAINT triages_status_check
    CHECK (status IN ('OPEN', 'CONSULT', 'APPOINTMENT', 'SKIPPED', 'ABANDONED'));

-- Set when the customer skips a BOOKING offer; the offer then no longer books anything.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;
