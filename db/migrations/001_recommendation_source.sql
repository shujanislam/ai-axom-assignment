-- Where a recommendation came from:
--   WORKSHOP  raised on a job card during a visit (existing rows)
--   FOLLOW_UP raised by the Re-evaluate job from completed visits; shown on /service-due
--
--   psql "$DATABASE_URL" -f db/migrations/001_recommendation_source.sql
ALTER TABLE recommendations
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'WORKSHOP';

CREATE INDEX IF NOT EXISTS recommendations_source_action_idx
    ON recommendations (source, advisor_action);
