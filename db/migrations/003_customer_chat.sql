-- Customer sign-in and the customer <-> workshop conversation.
--
--   psql "$DATABASE_URL" -f db/migrations/003_customer_chat.sql

-- Customers sign in with their email and this password (plain text or "scrypt$<salt>$<hex>",
-- same as advisors). NULL means the customer cannot sign in.
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS password VARCHAR(255);

-- One thread per customer.
--   kind = TEXT     a normal message
--   kind = BOOKING  a slot picker; books appointment_id (a DUE appointment) or, when that is
--                   NULL, creates an appointment from recommendation_id
-- ai_status is set on CUSTOMER messages only: PENDING until the assistant has replied.
CREATE TABLE IF NOT EXISTS messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    sender            VARCHAR(10) NOT NULL CHECK (sender IN ('CUSTOMER', 'ADVISOR', 'ASSISTANT')),
    advisor_id        UUID REFERENCES advisors(id) ON DELETE SET NULL,
    kind              VARCHAR(10) NOT NULL DEFAULT 'TEXT' CHECK (kind IN ('TEXT', 'BOOKING')),
    body              TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    recommendation_id UUID REFERENCES recommendations(id) ON DELETE SET NULL,
    appointment_id    UUID REFERENCES appointments(id) ON DELETE SET NULL,
    ai_status         VARCHAR(10) CHECK (ai_status IN ('PENDING', 'DONE', 'FAILED')),
    created_at        TIMESTAMP NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (customer_id, created_at);
CREATE INDEX IF NOT EXISTS messages_ai_pending_idx ON messages (customer_id) WHERE ai_status = 'PENDING';
