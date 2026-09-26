-- Job cards: when an appointment is booked, a job card is created for it with a mechanic who has
-- the skill and is free for the whole job, the parts the job needs and a price estimate.
--
--   psql "$DATABASE_URL" -f db/migrations/006_job_cards.sql
--   psql "$DATABASE_URL" -f db/seed-job-cards.sql   -- demo mechanics and parts

-- Lets one exclusion constraint compare mechanic ids (=) and time ranges (&&) together.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- What the workshop does, one row per skill. A job's text (appointment type or recommendation
-- title) is matched against match_pattern (case-insensitive regex) in sort_order; GENERAL has no
-- pattern and is the fallback. labour_hours is how long the mechanic is booked, in whole slots.
CREATE TABLE IF NOT EXISTS service_catalog (
    skill         VARCHAR(20) PRIMARY KEY,
    label         VARCHAR(100) NOT NULL,
    labour_hours  INT NOT NULL CHECK (labour_hours BETWEEN 1 AND 6),
    labour_price  INT NOT NULL CHECK (labour_price >= 0),
    match_pattern TEXT,
    sort_order    INT NOT NULL
);

INSERT INTO service_catalog (skill, label, labour_hours, labour_price, match_pattern, sort_order) VALUES
    ('AC',         'AC service',              2, 1800, '\mac\M|air.?con|refrigerant|cooling',                      10),
    ('BRAKES',     'Brake work',              1,  800, 'brak|\mpads?\M|\mdiscs?\M|rotor',                          20),
    ('SUSPENSION', 'Suspension and steering', 2, 1400, 'suspension|steering|shock|strut|alignment|wobbl|vibrat',   30),
    ('TYRES',      'Tyres and wheels',        1,  500, 'tyre|tire|wheel|puncture|balanc',                          40),
    ('ELECTRICAL', 'Electrical diagnosis',    1,  700, 'batter|electric|wiring|alternator|starter|light|fuse',     50),
    ('BODY',       'Body and paint',          3, 2500, 'dent|scratch|paint|\mbody\M|bumper|glass|windshield',      60),
    ('ENGINE',     'Engine and fuel system',  2, 1200, 'engine|misfire|overheat|\mcng\M|fuel|leak|exhaust|smoke|clutch|gearbox|noise', 70),
    ('PERIODIC',   'Periodic service',        2, 1500, 'periodic|oil change|full service|general service',         80),
    ('GENERAL',    'Inspection',              1,  800, NULL,                                                       999)
ON CONFLICT (skill) DO NOTHING;

CREATE TABLE IF NOT EXISTS mechanics (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    active       BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMP NOT NULL DEFAULT clock_timestamp()
);

-- level 3 is the most experienced; the most experienced free mechanic gets the job.
CREATE TABLE IF NOT EXISTS mechanic_skills (
    mechanic_id UUID NOT NULL REFERENCES mechanics(id) ON DELETE CASCADE,
    skill       VARCHAR(20) NOT NULL REFERENCES service_catalog(skill),
    level       SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
    PRIMARY KEY (mechanic_id, skill)
);

CREATE TABLE IF NOT EXISTS mechanic_time_off (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mechanic_id UUID NOT NULL REFERENCES mechanics(id) ON DELETE CASCADE,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
    reason      VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS mechanic_time_off_idx ON mechanic_time_off (mechanic_id, starts_at);

CREATE TABLE IF NOT EXISTS parts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku        VARCHAR(40) NOT NULL UNIQUE,
    name       VARCHAR(100) NOT NULL,
    unit_price INT NOT NULL CHECK (unit_price >= 0),
    stock_qty  INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0)
);

-- The parts a job of this skill is estimated to need.
CREATE TABLE IF NOT EXISTS service_parts (
    skill   VARCHAR(20) NOT NULL REFERENCES service_catalog(skill) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    qty     INT NOT NULL CHECK (qty > 0),
    PRIMARY KEY (skill, part_id)
);

-- One job card per appointment.
--   DRAFT        no mechanic could be assigned; an advisor picks one
--   ASSIGNED     a mechanic is booked for [starts_at, ends_at)
--   IN_PROGRESS  the mechanic has started
--   COMPLETED    set when the appointment is completed; its estimate becomes the invoice
--   CANCELLED
-- parts and estimate are snapshots taken when the card was created, so later price changes
-- don't change a card. estimate has the same shape as invoices.cost.
CREATE TABLE IF NOT EXISTS job_cards (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id     UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    skill          VARCHAR(20) NOT NULL REFERENCES service_catalog(skill),
    title          VARCHAR(255) NOT NULL,
    mechanic_id    UUID REFERENCES mechanics(id),
    starts_at      TIMESTAMPTZ NOT NULL,
    ends_at        TIMESTAMPTZ NOT NULL,
    status         VARCHAR(12) NOT NULL DEFAULT 'ASSIGNED'
                   CHECK (status IN ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    parts          JSONB NOT NULL DEFAULT '[]',
    parts_short    BOOLEAN NOT NULL DEFAULT false,
    estimate       JSONB NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    updated_at     TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    CHECK (ends_at > starts_at),
    CHECK (status NOT IN ('ASSIGNED', 'IN_PROGRESS') OR mechanic_id IS NOT NULL),
    -- A mechanic can't be on two active jobs at once. This is what stops double booking.
    CONSTRAINT job_cards_mechanic_overlap EXCLUDE USING gist (
        mechanic_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status IN ('ASSIGNED', 'IN_PROGRESS'))
);

CREATE INDEX IF NOT EXISTS job_cards_starts_idx ON job_cards (starts_at);
CREATE INDEX IF NOT EXISTS job_cards_vehicle_idx ON job_cards (vehicle_id, created_at);

-- Capacity is now per mechanic (above), not one car per slot for the whole workshop.
DROP INDEX IF EXISTS appointments_scheduled_slot_idx;
