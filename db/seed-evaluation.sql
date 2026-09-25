-- ============================================================
-- EVALUATION DATA for Re-evaluate / the follow-up cron
-- Adds COMPLETED appointments (plus the matching services record) so the
-- model has finished visits to judge. Dates are fixed around Sept 2026 and
-- mix overdue, due-soon and recently-serviced vehicles.
-- Additive and safe to re-run: existing customers, vehicles and visits are skipped.
-- New customers use @example.com so no test email can reach a real inbox.
--
--   psql "$DATABASE_URL" -f db/seed-evaluation.sql
-- ============================================================

BEGIN;

INSERT INTO customers (name, email, phone_number, preferred_language) VALUES
    ('Rupjyoti Saikia',  'rupjyoti.saikia@example.com',  '+91 90000 00101', 'Assamese'),
    ('Mousumi Deka',     'mousumi.deka@example.com',     '+91 90000 00102', 'Assamese'),
    ('Abdul Rahman',     'abdul.rahman@example.com',     '+91 90000 00103', 'Hindi'),
    ('Kaberi Choudhury', 'kaberi.choudhury@example.com', '+91 90000 00104', 'Bengali'),
    ('Hiren Talukdar',   'hiren.talukdar@example.com',   '+91 90000 00105', 'English')
ON CONFLICT (email) DO NOTHING;

INSERT INTO vehicles (vehicle_number, vehicle_type, fuel_type, registration_number) VALUES
    ('AS01VW4521', 'Sedan',     'Diesel', 'REG-AS01VW4521'),
    ('AS02XY7730', 'Hatchback', 'CNG',    'REG-AS02XY7730'),
    ('AS01ZA1188', 'SUV',       'Petrol', 'REG-AS01ZA1188'),
    ('AS03BC9054', 'Sedan',     'Petrol', 'REG-AS03BC9054'),
    ('AS01DE3367', 'SUV',       'Diesel', 'REG-AS01DE3367')
ON CONFLICT (vehicle_number) DO NOTHING;

WITH visit (customer, plate, appointment_type, work_done, at) AS (VALUES
    -- Existing customers
    ('Dipankar Nath',    'AS07RS8815', 'Periodic service',     'Periodic service · engine oil, oil filter, air filter',                              timestamp '2025-07-10 10:30'),
    ('Bhaskar Gogoi',    'AS09MN3340', 'Periodic service',     'Periodic service · engine oil, fuel filter; rear brake shoes ~30% left, recheck in 6 months', timestamp '2025-11-05 11:15'),
    ('Imran Hussain',    'AS23FG0912', 'Periodic service',     'Periodic service · engine oil, oil filter, wheel balancing',                         timestamp '2026-06-20 09:45'),
    ('Sanjay Kalita',    'AS01TU6098', 'Battery health check', 'Battery health check · state of health 88%, cooling fan noisy, review in 12 months', timestamp '2025-08-18 14:00'),
    -- New customers
    ('Rupjyoti Saikia',  'AS01VW4521', 'AC service',           'AC service · gas top-up, cabin filter replaced',                                     timestamp '2024-05-10 12:00'),
    ('Rupjyoti Saikia',  'AS01VW4521', 'Periodic service',     'Periodic service · engine oil, fuel filter, coolant top-up',                        timestamp '2025-03-02 10:00'),
    ('Mousumi Deka',     'AS02XY7730', 'Periodic service',     'Periodic service · engine oil, spark plugs; CNG kit leak test advised within 6 months', timestamp '2026-02-14 16:20'),
    ('Abdul Rahman',     'AS01ZA1188', 'Periodic service',     'Periodic service · engine oil, oil filter, tyre rotation',                           timestamp '2026-08-30 11:00'),
    ('Kaberi Choudhury', 'AS03BC9054', 'Brake inspection',     'Brake service · front pads replaced, rear pads ~40% left',                           timestamp '2025-09-01 15:10'),
    ('Kaberi Choudhury', 'AS03BC9054', 'Periodic service',     'Periodic service · engine oil, oil filter, air filter',                              timestamp '2025-09-01 15:40'),
    ('Hiren Talukdar',   'AS01DE3367', 'Periodic service',     'Periodic service · engine oil; clutch slipping slightly, customer declined repair', timestamp '2025-12-20 13:30')
), resolved AS (
    SELECT c.id AS customer_id, v.id AS vehicle_id, x.appointment_type, x.work_done, x.at
    FROM visit x
    JOIN customers c ON c.name = x.customer
    JOIN vehicles  v ON v.vehicle_number = x.plate
    WHERE NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.vehicle_id = v.id AND a.status = 'COMPLETED' AND a.created_at = x.at
    )
), appt AS (
    INSERT INTO appointments (customer_id, vehicle_id, appointment_type, status, assigned_to, created_at)
    SELECT r.customer_id, r.vehicle_id, r.appointment_type, 'COMPLETED',
        (SELECT id FROM advisors ORDER BY created_at LIMIT 1), r.at
    FROM resolved r
    RETURNING id, customer_id, vehicle_id, created_at
)
INSERT INTO services (customer_id, vehicle_id, service_type, appointment_id, created_at)
SELECT a.customer_id, a.vehicle_id, r.work_done, a.id, a.created_at
FROM appt a
JOIN resolved r ON r.vehicle_id = a.vehicle_id AND r.at = a.created_at;

COMMIT;
