-- When a service is completed, its invoice is posted in the customer's chat as a PDF attachment.
--
--   psql "$DATABASE_URL" -f db/migrations/007_invoice_messages.sql

-- kind = INVOICE  links invoice_id; the chat shows it as a downloadable PDF.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- Skipped when a later migration is already in effect (the list allows INVOICE, or rows use kinds
-- this list doesn't have), so re-running this file never narrows the list or fails on newer rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_kind_check' AND pg_get_constraintdef(oid) LIKE '%''INVOICE''%'
    ) AND NOT EXISTS (
        SELECT 1 FROM messages WHERE kind NOT IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE')
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
        ALTER TABLE messages ADD CONSTRAINT messages_kind_check
            CHECK (kind IN ('TEXT', 'BOOKING', 'QUESTION', 'INVOICE'));
    END IF;
END $$;
