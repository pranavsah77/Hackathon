-- ==============================================================================
-- Qartix Campus Transit System - Seed Data
-- File: supabase/seed.sql
-- Description: Seeds stations, routes, route_stations, carts, demo profiles/details,
--              approved & pending pass requests, scheduled rides, telemetry, and logs.
-- ==============================================================================

-- 1. STATIONS (Exact matching names from frontend UI)
INSERT INTO public.stations (name, type, lat, lng)
VALUES
  ('Block C - Oak Hall (Hostel)', 'hostel', 12.9712, 77.5930),
  ('Block A - Pine Hall (Hostel)', 'hostel', 12.9720, 77.5925),
  ('Block B - Maple Hall (Hostel)', 'hostel', 12.9715, 77.5928),
  ('Main Campus Gate (North)', 'gate', 12.9745, 77.5950),
  ('South Residence Plaza', 'hostel', 12.9698, 77.5935),
  ('Engineering Core (Hall 4)', 'academic', 12.9728, 77.5962),
  ('Science Concourse (Lab 2)', 'academic', 12.9735, 77.5970),
  ('Science Concourse Station', 'academic', 12.9736, 77.5971),
  ('Academic Block B', 'academic', 12.9730, 77.5958),
  ('Central Academic Quad', 'academic', 12.9722, 77.5952),
  ('Main Library & Computing Deck', 'library', 12.9718, 77.5965),
  ('Campus Health & Sports Pavilion', 'health', 12.9705, 77.5955)
ON CONFLICT (name) DO UPDATE SET
  type = EXCLUDED.type,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  updated_at = now();

-- 2. ROUTES
INSERT INTO public.routes (name, description, is_active)
VALUES
  ('Route 01', 'Hostel Block C to Engineering Core via Central Quad', true),
  ('Route 02', 'Main Campus Gate to Science Concourse & Library', true),
  ('Route 03', 'Hostel Block B to Main Library & Academic Deck', true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- 3. ROUTE STATIONS (Ordered stops for transit circuits)
DO $$
DECLARE
  r1 uuid;
  r2 uuid;
  r3 uuid;
  s_block_c uuid;
  s_quad uuid;
  s_eng uuid;
  s_gate uuid;
  s_sci uuid;
  s_lib uuid;
  s_block_b uuid;
BEGIN
  SELECT id INTO r1 FROM public.routes WHERE name = 'Route 01';
  SELECT id INTO r2 FROM public.routes WHERE name = 'Route 02';
  SELECT id INTO r3 FROM public.routes WHERE name = 'Route 03';

  SELECT id INTO s_block_c FROM public.stations WHERE name = 'Block C - Oak Hall (Hostel)';
  SELECT id INTO s_quad FROM public.stations WHERE name = 'Central Academic Quad';
  SELECT id INTO s_eng FROM public.stations WHERE name = 'Engineering Core (Hall 4)';
  SELECT id INTO s_gate FROM public.stations WHERE name = 'Main Campus Gate (North)';
  SELECT id INTO s_sci FROM public.stations WHERE name = 'Science Concourse (Lab 2)';
  SELECT id INTO s_lib FROM public.stations WHERE name = 'Main Library & Computing Deck';
  SELECT id INTO s_block_b FROM public.stations WHERE name = 'Block B - Maple Hall (Hostel)';

  -- Route 01 stops
  INSERT INTO public.route_stations (route_id, station_id, stop_order)
  VALUES
    (r1, s_block_c, 1),
    (r1, s_quad, 2),
    (r1, s_eng, 3)
  ON CONFLICT (route_id, stop_order) DO NOTHING;

  -- Route 02 stops
  INSERT INTO public.route_stations (route_id, station_id, stop_order)
  VALUES
    (r2, s_gate, 1),
    (r2, s_sci, 2),
    (r2, s_lib, 3)
  ON CONFLICT (route_id, stop_order) DO NOTHING;

  -- Route 03 stops
  INSERT INTO public.route_stations (route_id, station_id, stop_order)
  VALUES
    (r3, s_block_b, 1),
    (r3, s_lib, 2),
    (r3, s_eng, 3)
  ON CONFLICT (route_id, stop_order) DO NOTHING;
END $$;

-- 4. CARTS (Campus EV Fleet)
INSERT INTO public.carts (cart_number, status, lat, lng, speed_kmh, heading, last_seen_at)
VALUES
  ('CART-04', 'online', 12.9736, 77.5971, 14, 45, now()),
  ('CART-02', 'online', 12.9745, 77.5950, 12, 120, now()),
  ('CART-08', 'offline', 12.9710, 77.5940, 0, 0, now())
ON CONFLICT (cart_number) DO UPDATE SET
  status = EXCLUDED.status,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  speed_kmh = EXCLUDED.speed_kmh,
  heading = EXCLUDED.heading,
  last_seen_at = EXCLUDED.last_seen_at,
  updated_at = now();

-- 5. DEMO USER DETAILS (Student & Driver Specifics)
-- Student: Pranav Kumar (11111111-1111-1111-1111-111111111111)
INSERT INTO public.student_details (user_id, roll_no, hostel, department)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'STU-84920',
  'Block C - Oak Hall',
  'Engineering'
)
ON CONFLICT (user_id) DO UPDATE SET
  roll_no = EXCLUDED.roll_no,
  hostel = EXCLUDED.hostel,
  department = EXCLUDED.department,
  updated_at = now();

-- Driver: Vikram Singh (22222222-2222-2222-2222-222222222222)
DO $$
DECLARE
  v_cart_04_id uuid;
BEGIN
  SELECT id INTO v_cart_04_id FROM public.carts WHERE cart_number = 'CART-04';

  INSERT INTO public.driver_details (user_id, driver_code, cart_id, approved_by, approved_at)
  VALUES (
    '22222222-2222-2222-2222-222222222222',
    'CART-04',
    v_cart_04_id,
    '33333333-3333-3333-3333-333333333333',
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    driver_code = EXCLUDED.driver_code,
    cart_id = EXCLUDED.cart_id,
    approved_by = EXCLUDED.approved_by,
    approved_at = EXCLUDED.approved_at,
    updated_at = now();

  -- Associate CART-04 with driver Vikram Singh
  UPDATE public.carts
  SET current_driver_id = '22222222-2222-2222-2222-222222222222'
  WHERE id = v_cart_04_id;
END $$;

-- 6. PASS REQUESTS (Active Approved Pass + Pending Approval Pass)
DO $$
DECLARE
  s_pickup uuid;
  s_drop uuid;
  s_pickup2 uuid;
  s_drop2 uuid;
  pass_req_id uuid;
BEGIN
  SELECT id INTO s_pickup FROM public.stations WHERE name = 'Block C - Oak Hall (Hostel)';
  SELECT id INTO s_drop FROM public.stations WHERE name = 'Engineering Core (Hall 4)';
  SELECT id INTO s_pickup2 FROM public.stations WHERE name = 'Block B - Maple Hall (Hostel)';
  SELECT id INTO s_drop2 FROM public.stations WHERE name = 'Science Concourse (Lab 2)';

  -- REQ-8492: Approved Pass for Pranav Kumar
  INSERT INTO public.pass_requests (
    request_code,
    student_id,
    medical_condition,
    reason,
    certificate_path,
    route_template,
    pickup_station_id,
    drop_station_id,
    time_slots,
    duration,
    status,
    reviewed_by,
    review_note,
    starts_on,
    expires_on,
    qr_token
  ) VALUES (
    'REQ-8492',
    '11111111-1111-1111-1111-111111111111',
    'Leg/Ankle Fracture',
    'Fractured right fibula with plaster cast; unable to walk long distances between hostel and campus lecture halls.',
    'medical-certificates/orthopedic_clinic_referral.pdf',
    'Hostel -> Class',
    s_pickup,
    s_drop,
    ARRAY['08:30 AM', '04:30 PM'],
    '1_month',
    'approved',
    '33333333-3333-3333-3333-333333333333',
    'Verified with campus health clinic. Orthopedic cast confirmed.',
    CURRENT_DATE,
    CURRENT_DATE + 30,
    'QARTIX-PASS-REQ8492-VALID'
  )
  ON CONFLICT (request_code) DO UPDATE SET
    medical_condition = EXCLUDED.medical_condition,
    reason = EXCLUDED.reason,
    status = EXCLUDED.status,
    starts_on = EXCLUDED.starts_on,
    expires_on = EXCLUDED.expires_on,
    updated_at = now()
  RETURNING id INTO pass_req_id;

  -- REQ-9102: Pending Review Pass
  INSERT INTO public.pass_requests (
    request_code,
    student_id,
    medical_condition,
    reason,
    certificate_path,
    route_template,
    pickup_station_id,
    drop_station_id,
    time_slots,
    duration,
    status,
    review_note,
    starts_on,
    expires_on,
    qr_token
  ) VALUES (
    'REQ-9102',
    '11111111-1111-1111-1111-111111111111',
    'Ligament Tear / Sprain',
    'Grade 2 ACL tear requiring knee brace and crutches for 4 weeks.',
    'medical-certificates/clinic_discharge_aarav.pdf',
    'Hostel -> Class',
    s_pickup2,
    s_drop2,
    ARRAY['10:30 AM', '01:30 PM'],
    '1_month',
    'pending',
    'Awaiting health centre verification.',
    CURRENT_DATE,
    CURRENT_DATE + 30,
    'QARTIX-PASS-REQ9102-PENDING'
  )
  ON CONFLICT (request_code) DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = now();
END $$;

-- 7. RIDES (Scheduled Shifts & Live Trips)
DO $$
DECLARE
  v_pass_id uuid;
  v_student_id uuid := '11111111-1111-1111-1111-111111111111';
  v_driver_id uuid := '22222222-2222-2222-2222-222222222222';
  v_cart_04_id uuid;
  s_block_c uuid;
  s_eng uuid;
  s_quad uuid;
  s_gate uuid;
  s_acad_b uuid;
BEGIN
  SELECT id INTO v_pass_id FROM public.pass_requests WHERE request_code = 'REQ-8492';
  SELECT id INTO v_cart_04_id FROM public.carts WHERE cart_number = 'CART-04';

  SELECT id INTO s_block_c FROM public.stations WHERE name = 'Block C - Oak Hall (Hostel)';
  SELECT id INTO s_eng FROM public.stations WHERE name = 'Engineering Core (Hall 4)';
  SELECT id INTO s_quad FROM public.stations WHERE name = 'Central Academic Quad';
  SELECT id INTO s_gate FROM public.stations WHERE name = 'Main Campus Gate (North)';
  SELECT id INTO s_acad_b FROM public.stations WHERE name = 'Academic Block B';

  -- Ride 1: Morning active pickup for Pranav Kumar (Approaching)
  INSERT INTO public.rides (
    pass_id,
    student_id,
    cart_id,
    driver_id,
    pickup_station_id,
    drop_station_id,
    ride_type,
    scheduled_for,
    status,
    eta_minutes
  ) VALUES (
    v_pass_id,
    v_student_id,
    v_cart_04_id,
    v_driver_id,
    s_block_c,
    s_eng,
    'scheduled',
    date_trunc('day', now()) + interval '8 hours 30 minutes',
    'approaching',
    4
  );

  -- Ride 2: Afternoon scheduled return for Pranav Kumar
  INSERT INTO public.rides (
    pass_id,
    student_id,
    cart_id,
    driver_id,
    pickup_station_id,
    drop_station_id,
    ride_type,
    scheduled_for,
    status,
    eta_minutes
  ) VALUES (
    v_pass_id,
    v_student_id,
    v_cart_04_id,
    v_driver_id,
    s_eng,
    s_quad,
    'scheduled',
    date_trunc('day', now()) + interval '16 hours 30 minutes',
    'scheduled',
    45
  );

  -- Ride 3: Driver shift ride from Main Gate to Academic Block B
  INSERT INTO public.rides (
    student_id,
    cart_id,
    driver_id,
    pickup_station_id,
    drop_station_id,
    ride_type,
    scheduled_for,
    status,
    eta_minutes
  ) VALUES (
    v_student_id,
    v_cart_04_id,
    v_driver_id,
    s_gate,
    s_acad_b,
    'extra',
    date_trunc('day', now()) + interval '9 hours 15 minutes',
    'scheduled',
    12
  );

  -- Ride 4: Skipped ride example
  INSERT INTO public.rides (
    student_id,
    cart_id,
    driver_id,
    pickup_station_id,
    drop_station_id,
    ride_type,
    scheduled_for,
    status,
    eta_minutes,
    skipped_at
  ) VALUES (
    v_student_id,
    v_cart_04_id,
    v_driver_id,
    s_quad,
    s_eng,
    'scheduled',
    date_trunc('day', now()) + interval '11 hours 00 minutes',
    'skipped',
    0,
    now()
  );
END $$;

-- 8. CART LOCATION HISTORY (Telemetry Trail for CART-04)
DO $$
DECLARE
  v_cart_04_id uuid;
BEGIN
  SELECT id INTO v_cart_04_id FROM public.carts WHERE cart_number = 'CART-04';

  INSERT INTO public.cart_location_history (cart_id, lat, lng, speed, recorded_at)
  VALUES
    (v_cart_04_id, 12.9712, 77.5930, 0, now() - interval '10 minutes'),
    (v_cart_04_id, 12.9720, 77.5940, 12, now() - interval '7 minutes'),
    (v_cart_04_id, 12.9728, 77.5955, 15, now() - interval '4 minutes'),
    (v_cart_04_id, 12.9736, 77.5971, 14, now() - interval '1 minute');
END $$;

-- 9. NOTIFICATIONS
INSERT INTO public.notifications (user_id, type, title, body)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'pass_approved',
    'Monthly Pass Approved',
    'Your mobility transit pass REQ-8492 has been approved by the Transport Office. Valid for 30 days.'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'cart_approaching',
    'CART-04 is Approaching',
    'Driver Vikram Singh is 4 minutes away from Block C - Oak Hall.'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'shift_assigned',
    'Shift Assigned: CART-04',
    'You are assigned to CART-04 for Route 01 morning transit.'
  );

-- 10. AUDIT LOGS
INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
VALUES
  (
    '33333333-3333-3333-3333-333333333333',
    'PASS_APPROVAL',
    'pass_requests',
    'REQ-8492',
    '{"verified_condition": "Leg/Ankle Fracture", "duration": "1_month"}'::jsonb
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'DRIVER_APPROVAL',
    'driver_details',
    'CART-04',
    '{"driver_user_id": "22222222-2222-2222-2222-222222222222", "assigned_cart": "CART-04"}'::jsonb
  );
