-- ============================================================
-- DEMO MECHANICS AND PARTS for job cards (run after 006_job_cards.sql)
-- Additive only: skips mechanics when any exist; parts upsert by sku.
--
--   psql "$DATABASE_URL" -f db/seed-job-cards.sql
-- ============================================================

INSERT INTO parts (sku, name, unit_price, stock_qty) VALUES
    ('ENG-OIL-4L',  'Engine oil (4 L)',              2200, 12),
    ('FLT-OIL',     'Oil filter',                     350, 20),
    ('FLT-AIR',     'Air filter',                     450, 15),
    ('FLT-CABIN',   'Cabin filter',                   550,  8),
    ('AC-GAS',      'Refrigerant gas top-up',        1200,  5),
    ('BRK-PAD-F',   'Front brake pads (set)',        1800,  4),
    ('BRK-FLUID',   'Brake fluid (500 ml)',           450, 10),
    ('BAT-TERM',    'Battery terminal kit',           250,  6),
    ('FUSE-KIT',    'Fuse kit',                       150, 20),
    ('SPARK-PLUG',  'Spark plug',                     300, 16),
    ('COOLANT-1L',  'Coolant (1 L)',                  400, 10),
    ('GASKET-SET',  'Gasket and seal set',            900,  2),
    ('SHOCK-F',     'Front shock absorber',          3200,  0),
    ('WHL-WEIGHT',  'Wheel balancing weights',        150, 30),
    ('TYRE-VALVE',  'Tyre valve',                      80, 40),
    ('PAINT-TOUCH', 'Paint touch-up kit',             600,  3)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO service_parts (skill, part_id, qty)
SELECT x.skill, p.id, x.qty
FROM (VALUES
    ('PERIODIC',   'ENG-OIL-4L',  1),
    ('PERIODIC',   'FLT-OIL',     1),
    ('PERIODIC',   'FLT-AIR',     1),
    ('AC',         'AC-GAS',      1),
    ('AC',         'FLT-CABIN',   1),
    ('BRAKES',     'BRK-PAD-F',   1),
    ('BRAKES',     'BRK-FLUID',   1),
    ('ELECTRICAL', 'BAT-TERM',    1),
    ('ELECTRICAL', 'FUSE-KIT',    1),
    ('ENGINE',     'SPARK-PLUG',  4),
    ('ENGINE',     'COOLANT-1L',  1),
    ('ENGINE',     'GASKET-SET',  1),
    ('SUSPENSION', 'SHOCK-F',     2),
    ('TYRES',      'WHL-WEIGHT',  1),
    ('TYRES',      'TYRE-VALVE',  4),
    ('BODY',       'PAINT-TOUCH', 1)
) AS x(skill, sku, qty)
JOIN parts p ON p.sku = x.sku
ON CONFLICT (skill, part_id) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM mechanics) THEN
        RAISE NOTICE 'mechanics already present, skipping';
        RETURN;
    END IF;

    INSERT INTO mechanics (name, phone_number) VALUES
        ('Ranjit Bora',   '+91 94350 11201'),
        ('Pallavi Das',   '+91 94350 11202'),
        ('Bikash Kalita', '+91 94350 11203'),
        ('Mridul Saikia', '+91 94350 11204'),
        ('Anjali Gogoi',  '+91 94350 11205'),
        ('Rahul Deka',    '+91 94350 11206');

    -- Everyone can do a general inspection.
    INSERT INTO mechanic_skills (mechanic_id, skill, level)
    SELECT m.id, x.skill, x.level
    FROM (VALUES
        ('Ranjit Bora',   'PERIODIC',   3), ('Ranjit Bora',   'ENGINE',     3), ('Ranjit Bora',   'GENERAL', 3),
        ('Pallavi Das',   'AC',         3), ('Pallavi Das',   'ELECTRICAL', 3), ('Pallavi Das',   'GENERAL', 2),
        ('Bikash Kalita', 'BRAKES',     3), ('Bikash Kalita', 'SUSPENSION', 2), ('Bikash Kalita', 'TYRES',   3),
        ('Bikash Kalita', 'GENERAL',    2),
        ('Mridul Saikia', 'ENGINE',     2), ('Mridul Saikia', 'PERIODIC',   2), ('Mridul Saikia', 'ELECTRICAL', 1),
        ('Mridul Saikia', 'GENERAL',    2),
        ('Anjali Gogoi',  'BODY',       3), ('Anjali Gogoi',  'GENERAL',    1),
        ('Rahul Deka',    'TYRES',      2), ('Rahul Deka',    'PERIODIC',   1), ('Rahul Deka',    'BRAKES',  1),
        ('Rahul Deka',    'SUSPENSION', 1), ('Rahul Deka',    'GENERAL',    1)
    ) AS x(name, skill, level)
    JOIN mechanics m ON m.name = x.name;
END $$;
