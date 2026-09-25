-- The slot a customer picked from the booking link (/<appointment id>).
-- One scheduled appointment per slot; the unique index makes double booking impossible.
--
--   psql "$DATABASE_URL" -f db/migrations/002_appointment_slot.sql
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_scheduled_slot_idx
    ON appointments (scheduled_at) WHERE status = 'SCHEDULED';
