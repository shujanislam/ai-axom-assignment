-- ============================================================
-- DEMO DATA for gear-ai
-- Additive only: never drops or updates existing rows, and leaves the
-- advisors table alone (appointments are assigned to existing advisors).
-- Skips itself entirely when appointments already exist.
--
--   psql "$DATABASE_URL" -f db/seed.sql
-- ============================================================

DO $$
DECLARE
    adv_owner UUID;
    adv_admin UUID;
    adv_sales UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM appointments) THEN
        RAISE NOTICE 'appointments already present, skipping seed';
        RETURN;
    END IF;

    SELECT id INTO adv_owner FROM advisors WHERE role = 'OWNER' ORDER BY created_at LIMIT 1;
    SELECT id INTO adv_admin FROM advisors WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1;
    SELECT id INTO adv_sales FROM advisors WHERE role = 'SALES' ORDER BY created_at LIMIT 1;

    INSERT INTO customers (name, email, phone_number, preferred_language) VALUES
        ('Ramesh Baruah',  'ramesh.baruah@mail.com',  '+91 98640 21142', 'Hinglish'),
        ('Nilakshi Das',   'nilakshi.das@mail.com',   '+91 94350 11873', 'Assamese'),
        ('Imran Hussain',  'imran.hussain@mail.com',  '+91 70020 55410', 'Hindi'),
        ('Priya Sharma',   'priya.sharma@mail.com',   '+91 98540 33071', 'English'),
        ('Bhaskar Gogoi',  'bhaskar.gogoi@mail.com',  '+91 60010 92218', 'Assamese'),
        ('Ankita Bora',    'ankita.bora@mail.com',    '+91 88110 45502', 'English'),
        ('Dipankar Nath',  'dipankar.nath@mail.com',  '+91 97060 18834', 'Bengali'),
        ('Sanjay Kalita',  'sanjay.kalita@mail.com',  '+91 90850 67129', 'Assamese')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO vehicles (vehicle_number, vehicle_type, fuel_type, registration_number) VALUES
        ('AS01AB1234', 'Sedan',     'Petrol', 'REG-AS01AB1234'),
        ('AS01CD5567', 'SUV',       'Diesel', 'REG-AS01CD5567'),
        ('AS23FG0912', 'Hatchback', 'Petrol', 'REG-AS23FG0912'),
        ('AS01KL7781', 'Sedan',     'CNG',    'REG-AS01KL7781'),
        ('AS09MN3340', 'SUV',       'Diesel', 'REG-AS09MN3340'),
        ('AS01PQ2204', 'Hatchback', 'Petrol', 'REG-AS01PQ2204'),
        ('AS07RS8815', 'Sedan',     'Petrol', 'REG-AS07RS8815'),
        ('AS01TU6098', 'SUV',       'Electric', 'REG-AS01TU6098')
    ON CONFLICT (vehicle_number) DO NOTHING;

    -- One open appointment per vehicle; status drives the Service due list.
    INSERT INTO appointments (customer_id, vehicle_id, appointment_type, status, assigned_to, created_at)
    SELECT c.id, v.id, x.appointment_type, x.status, x.assigned_to, now() - x.age
    FROM (VALUES
        ('Ramesh Baruah', 'AS01AB1234', 'Periodic service',   'CHECKED_IN', adv_owner, interval '4 days'),
        ('Nilakshi Das',  'AS01CD5567', 'Periodic service',   'OVERDUE',    adv_sales, interval '41 days'),
        ('Imran Hussain', 'AS23FG0912', 'Periodic service',   'NO_REPLY',   adv_sales, interval '6 days'),
        ('Priya Sharma',  'AS01KL7781', 'Brake inspection',   'MISSED',     adv_admin, interval '9 days'),
        ('Bhaskar Gogoi', 'AS09MN3340', 'Periodic service',   'PAUSED',     adv_sales, interval '12 days'),
        ('Ankita Bora',   'AS01PQ2204', 'AC service',         'SCHEDULED',  adv_owner, interval '2 days'),
        ('Dipankar Nath', 'AS07RS8815', 'Periodic service',   'DECLINED',   adv_sales, interval '15 days'),
        ('Sanjay Kalita', 'AS01TU6098', 'Battery health check','DUE',       NULL,      interval '1 day')
    ) AS x(customer, plate, appointment_type, status, assigned_to, age)
    JOIN customers c ON c.name = x.customer
    JOIN vehicles  v ON v.vehicle_number = x.plate;

    -- Past visits for the vehicle on arrival (AS01AB1234) and a couple of others.
    INSERT INTO services (customer_id, vehicle_id, service_type, created_at)
    SELECT c.id, v.id, x.service_type, x.at
    FROM (VALUES
        ('Ramesh Baruah', 'AS01AB1234', 'AC service · refrigerant topped up, cabin filter replaced', timestamp '2026-03-14 11:20'),
        ('Ramesh Baruah', 'AS01AB1234', 'Periodic service · engine oil, air filter, wheel alignment', timestamp '2025-08-02 10:05'),
        ('Ramesh Baruah', 'AS01AB1234', 'Brake inspection · front pads approx. 50% left, not replaced', timestamp '2024-11-19 15:40'),
        ('Ramesh Baruah', 'AS01AB1234', 'Periodic service · engine oil, oil filter, brake cleaning', timestamp '2024-02-08 09:30'),
        ('Nilakshi Das',  'AS01CD5567', 'Periodic service · engine oil, fuel filter',               timestamp '2025-06-21 12:10'),
        ('Priya Sharma',  'AS01KL7781', 'Periodic service · engine oil, spark plugs',               timestamp '2025-09-03 16:45'),
        ('Ankita Bora',   'AS01PQ2204', 'AC service · gas top-up',                                   timestamp '2025-12-11 10:15')
    ) AS x(customer, plate, service_type, at)
    JOIN customers c ON c.name = x.customer
    JOIN vehicles  v ON v.vehicle_number = x.plate;

    INSERT INTO complaints (customer_id, vehicle_id, complaint_type, created_at)
    SELECT c.id, v.id, x.kind::complaint_type, now() - x.age
    FROM (VALUES
        ('Ramesh Baruah', 'AS01AB1234', 'VEHICLE_ISSUE', interval '4 days'),
        ('Ramesh Baruah', 'AS01AB1234', 'SERVICE_ISSUE', interval '4 days'),
        ('Priya Sharma',  'AS01KL7781', 'DELAY',         interval '9 days')
    ) AS x(customer, plate, kind, age)
    JOIN customers c ON c.name = x.customer
    JOIN vehicles  v ON v.vehicle_number = x.plate;

    INSERT INTO recommendations (customer_id, vehicle_id, recommendation_type, title, description, priority, created_at)
    SELECT c.id, v.id, x.kind::recommendation_type, x.title, x.description, x.priority::recommendation_priority, now() - x.age
    FROM (VALUES
        ('Ramesh Baruah', 'AS01AB1234', 'INSPECTION', 'Front brake assembly — measure and report',
         'Pad thickness left and right, disc runout and thickness, caliper slides, hardware and shims. Record the measured values before any replacement.',
         'HIGH', interval '4 days'),
        ('Ramesh Baruah', 'AS01AB1234', 'INSPECTION', 'AC circuit — leak test before any top-up',
         'Leak trace, high and low side pressures, compressor clutch, condenser, evaporator drain, cabin filter. Do not recharge until the result is logged.',
         'HIGH', interval '4 days'),
        ('Ramesh Baruah', 'AS01AB1234', 'SERVICE', 'Engine oil and filter',
         'Due with this periodic service. Replace engine oil and oil filter.',
         'MEDIUM', interval '4 days'),
        ('Priya Sharma',  'AS01KL7781', 'INSPECTION', 'Brake fluid moisture test',
         'Test fluid moisture content and top up or flush as measured.',
         'MEDIUM', interval '9 days'),
        ('Ankita Bora',   'AS01PQ2204', 'MAINTENANCE', 'Cabin filter replacement',
         'Filter last replaced over a year ago.',
         'LOW', interval '2 days')
    ) AS x(customer, plate, kind, title, description, priority, age)
    JOIN customers c ON c.name = x.customer
    JOIN vehicles  v ON v.vehicle_number = x.plate;
END $$;
