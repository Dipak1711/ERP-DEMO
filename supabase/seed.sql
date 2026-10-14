-- Master data only (src/store/seed.ts, materials.ts, hardnessSpecs.ts).
-- No stock, no jobs, no dies — same as the app's “Clear all data” state. Safe to re-run.

insert into material_master (material, family, grade, density, default_od) values
  ('EN8 Steel Round Bar',             'Carbon Steel',    'EN8 / 080M40 (C45 equivalent)',          7.85, 50),
  ('EN9 Steel Round Bar',             'Carbon Steel',    'EN9 / 070M55 (C55 equivalent)',          7.85, 50),
  ('EN3 Mild Steel Round Bar',        'Carbon Steel',    'EN3 / 080M15 (SAE 1018 equivalent)',     7.85, 40),
  ('EN19 Alloy Steel Round Bar',      'Alloy Steel',     'EN19 / 42CrMo4 (SAE 4140)',              7.85, 60),
  ('EN24 Alloy Steel Round Bar',      'Alloy Steel',     'EN24 / 34CrNiMo6 (SAE 4340)',            7.85, 60),
  ('20MnCr5 Alloy Steel Round Bar',   'Alloy Steel',     '20MnCr5 (case-hardening)',               7.85, 40),
  ('SS304 Stainless Steel Round Bar', 'Stainless Steel', 'AISI 304 / 1.4301',                      7.93, 40),
  ('SS316 Stainless Steel Round Bar', 'Stainless Steel', 'AISI 316 / 1.4401',                      7.98, 40),
  ('SS410 Stainless Steel Round Bar', 'Stainless Steel', 'AISI 410 / 1.4006',                      7.75, 40),
  ('Brass Round Bar',                 'Brass',           'CW614N / CuZn39Pb3 (free-cutting brass)',8.47, 45),
  ('Forging Brass Round Bar',         'Brass',           'CW617N / CuZn40Pb2 (hot-stamping brass)',8.43, 45),
  ('Copper Round Bar',                'Copper',          'ETP Copper C11000 / Cu-ETP',             8.94, 30),
  ('OFHC Copper Round Bar',           'Copper',          'Oxygen-free Copper C10200 / Cu-OF',      8.94, 30),
  ('Aluminium Round Bar',             'Aluminium',       'AA 6061-T6',                             2.70, 25),
  ('Aluminium 6082 Round Bar',        'Aluminium',       'AA 6082-T6',                             2.71, 25),
  ('Aluminium 2014 Round Bar',        'Aluminium',       'AA 2014 (forging alloy)',                2.80, 25)
on conflict (material) do update
  set family = excluded.family, grade = excluded.grade, density = excluded.density, default_od = excluded.default_od;

-- AA 6082-T6 (80–90 HRB) comes from the client's sheet; the rest are placeholders — confirm with the client.
insert into hardness_specs (material, min_hardness, max_hardness, scale) values
  ('Aluminium Round Bar',      55, 65, 'HRB'),
  ('Aluminium 6082 Round Bar', 80, 90, 'HRB'),
  ('Aluminium 2014 Round Bar', 70, 80, 'HRB'),
  ('Brass Round Bar',          60, 80, 'HRB'),
  ('Forging Brass Round Bar',  55, 75, 'HRB'),
  ('Copper Round Bar',         35, 55, 'HRB'),
  ('OFHC Copper Round Bar',    30, 50, 'HRB')
on conflict (material) do update
  set min_hardness = excluded.min_hardness, max_hardness = excluded.max_hardness, scale = excluded.scale;

insert into products (id, code, name, material, od, cutting_length, finished_weight, ht_temperature, ht_soak_minutes,
                      ht_process, ht_quench, die_no, default_customer) values
  ('P-9084', '9084',  '9084 Flange',                 'EN8 Steel Round Bar', 50, 62, 0.2469, 850, 60, 'Normalising',             'Still air',    'D-9084-01', 'ABC Industries'),
  ('P-BB45', 'BB-45', 'Brass Bush',                  'Brass Round Bar',     45, 38, 0.1050, 550, 45, 'Stress-relief annealing', 'Still air',    'D-BB45-02', 'Sigma Valves Pvt. Ltd.'),
  ('P-CU30', 'CU-30', 'Copper Component',            'Copper Round Bar',    30, 45, 0.2620, 600, 40, 'Annealing',               'Water quench', 'D-CU30-03', 'Metro Electricals'),
  ('P-AL25', 'AL-25', 'Aluminium Forged Component',  'Aluminium Round Bar', 25, 70, 0.0860, 530, 60, 'Solution treatment (T6)', 'Water quench', 'D-AL25-04', 'Apex Auto Components')
on conflict (id) do update
  set code = excluded.code, name = excluded.name, material = excluded.material, od = excluded.od,
      cutting_length = excluded.cutting_length, finished_weight = excluded.finished_weight,
      ht_temperature = excluded.ht_temperature, ht_soak_minutes = excluded.ht_soak_minutes,
      ht_process = excluded.ht_process, ht_quench = excluded.ht_quench, die_no = excluded.die_no,
      default_customer = excluded.default_customer;

insert into customers (name) values
  ('ABC Industries'), ('Sigma Valves Pvt. Ltd.'), ('Metro Electricals'), ('Apex Auto Components'), ('Nova Hydraulics')
on conflict (name) do nothing;

insert into suppliers (name) values
  ('ABC Metals'), ('XYZ Metals'), ('PQR Industries'), ('Shree Steel Traders'), ('Mahalaxmi Alloys'),
  ('Shakti Stainless Traders'), ('Om Alloys & Metals')
on conflict (name) do nothing;

insert into machines (name, stage) values
  ('Bandsaw BS-01', 'cutting'), ('Bandsaw BS-02', 'cutting'), ('Circular Saw CS-01', 'cutting'),
  ('Friction Screw Press FP-400T', 'forging'), ('Hydraulic Press HP-250T', 'forging'), ('Power Hammer PH-01', 'forging'),
  ('Trim Press TP-01', 'trimming'), ('Trim Press TP-02', 'trimming'),
  ('Furnace F-01 (Box)', 'heatTreatment'), ('Furnace F-02 (Pit)', 'heatTreatment'), ('Continuous Furnace CF-01', 'heatTreatment')
on conflict (name) do nothing;

insert into operators (name) values
  ('Ramesh Patil'), ('Suresh Jadhav'), ('Imran Shaikh'), ('Vijay Pawar'), ('Anil More'), ('Kiran Desai')
on conflict (name) do nothing;

insert into inspectors (name) values
  ('Priya Kulkarni (QA)'), ('Rahul Deshmukh (QA)')
on conflict (name) do nothing;
