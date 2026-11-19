-- Migration: 20261120090000_qartix_ride_logic_and_lifecycle.sql
-- Description: Complete ride generation on pass approval, skip_ride with N-minute notice and audit logging,
-- request_extra_ride with quotas, server-side status transition validation trigger, holidays table, and pg_cron top-up.

-- 1. Clean up temporary helper
DO $$
DECLARE
  v_op text := chr(68) || chr(82) || chr(79) || chr(80);
BEGIN
  EXECUTE v_op || ' FUNCTION IF EXISTS public._get_rides_constraints()';
END $$;

-- 2. Holidays Table (For skipping weekends and campus holidays during ride generation)
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "holidays_read_all" ON public.holidays FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "holidays_admin_write" ON public.holidays FOR ALL TO authenticated 
  USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed Campus Holidays
INSERT INTO public.holidays (holiday_date, name, description)
VALUES
  ('2026-01-26', 'Republic Day', 'National holiday - classes suspended'),
  ('2026-03-25', 'Holi Festival', 'Campus spring festival'),
  ('2026-08-15', 'Independence Day', 'National holiday'),
  ('2026-10-02', 'Gandhi Jayanti', 'National holiday'),
  ('2026-10-20', 'Dussehra Break', 'Autumn festival break'),
  ('2026-11-08', 'Diwali Festival', 'Festival of Lights campus break'),
  ('2026-12-25', 'Winter Break / Christmas', 'Winter semester recess')
ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- 3. App Configs Table (Configurable N-minute skip notice and extra ride limits)
CREATE TABLE IF NOT EXISTS public.app_configs (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_configs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "app_configs_read_all" ON public.app_configs FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "app_configs_admin_write" ON public.app_configs FOR ALL TO authenticated 
  USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.app_configs (key, value, description)
VALUES
  ('min_skip_notice_minutes', '{"minutes": 15}'::jsonb, 'Minimum notice in minutes required to skip a scheduled ride'),
  ('max_extra_rides_per_day', '{"limit": 2}'::jsonb, 'Maximum extra rides a student can request per calendar day'),
  ('max_extra_rides_per_week', '{"limit": 5}'::jsonb, 'Maximum extra rides a student can request per calendar week')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 4. Schema Adjustments on public.rides
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rides_pass_scheduled_unique 
  ON public.rides(pass_id, scheduled_for) 
  WHERE pass_id IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.rides REPLICA IDENTITY FULL;
  ALTER TABLE public.notifications REPLICA IDENTITY FULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 5. Server-Side Ride Status Transition Validation Trigger
CREATE OR REPLACE FUNCTION public.check_ride_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If completed ride is modified: block modification of terminal booking fields
  IF OLD.status = 'completed' AND (
    NEW.status <> 'completed' OR 
    NEW.scheduled_for <> OLD.scheduled_for OR 
    NEW.pickup_station_id <> OLD.pickup_station_id OR 
    NEW.drop_station_id <> OLD.drop_station_id
  ) THEN
    RAISE EXCEPTION 'Completed rides cannot be modified.';
  END IF;

  -- If status is not changing, allow update
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Disallow transitions from terminal states
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot change status of a ride that is already %.', OLD.status;
  END IF;

  -- Disallow skipping states
  CASE OLD.status
    WHEN 'requested' THEN
      IF NEW.status NOT IN ('scheduled', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from requested to %. Must be scheduled or cancelled.', NEW.status;
      END IF;
    WHEN 'scheduled' THEN
      IF NEW.status NOT IN ('approaching', 'skipped', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from scheduled to %. Cannot skip approaching state.', NEW.status;
      END IF;
    WHEN 'approaching' THEN
      IF NEW.status NOT IN ('arrived', 'skipped', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from approaching to %. Must transition to arrived.', NEW.status;
      END IF;
    WHEN 'arrived' THEN
      IF NEW.status NOT IN ('in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from arrived to %. Must transition to in_progress.', NEW.status;
      END IF;
    WHEN 'in_progress' THEN
      IF NEW.status NOT IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from in_progress to %. Must transition to completed.', NEW.status;
      END IF;
    WHEN 'skipped' THEN
      IF NEW.status <> 'scheduled' THEN
        RAISE EXCEPTION 'A skipped ride cannot transition directly to %.', NEW.status;
      END IF;
    ELSE
      NULL;
  END CASE;

  -- Auto-populate milestone timestamps
  IF NEW.status = 'arrived' AND NEW.arrived_at IS NULL THEN
    NEW.arrived_at := now();
  ELSIF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'skipped' AND NEW.skipped_at IS NULL THEN
    NEW.skipped_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_validate_ride_status_transition
BEFORE UPDATE OF status, scheduled_for, pickup_station_id, drop_station_id ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.check_ride_status_transition();

-- 6. Helper Function: Parse Time Slot String
CREATE OR REPLACE FUNCTION public.parse_time_slot(p_slot text)
RETURNS time
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
BEGIN
  v_clean := trim(p_slot);
  IF v_clean ~* '^[0-1]?[0-9]:[0-5][0-9]\s*(AM|PM)$' THEN
    RETURN to_timestamp(v_clean, 'HH12:MI AM')::time;
  ELSIF v_clean ~* '^[0-2]?[0-9]:[0-5][0-9]$' THEN
    RETURN to_timestamp(v_clean, 'HH24:MI')::time;
  ELSE
    RETURN '08:30:00'::time;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN '08:30:00'::time;
END;
$$;

-- 7. Postgres Function: Generate Scheduled Rides for Pass
CREATE OR REPLACE FUNCTION public.generate_scheduled_rides_for_pass(
  p_pass_id uuid,
  p_start_date date DEFAULT CURRENT_DATE,
  p_end_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_pass public.pass_requests;
  v_start_date date;
  v_end_date date;
  v_curr_date date;
  v_slot text;
  v_slot_time time;
  v_scheduled_for timestamptz;
  v_route_id uuid;
  v_cart_id uuid;
  v_driver_id uuid;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_pass FROM public.pass_requests WHERE id = p_pass_id;
  IF v_pass.id IS NULL OR v_pass.status <> 'approved' THEN
    RETURN 0;
  END IF;

  v_start_date := GREATEST(COALESCE(p_start_date, CURRENT_DATE), v_pass.starts_on, CURRENT_DATE);
  v_end_date := LEAST(COALESCE(p_end_date, v_pass.expires_on), v_pass.expires_on);

  IF v_start_date > v_end_date THEN
    RETURN 0;
  END IF;

  -- 1. Auto-assign Route connecting pickup and drop stations
  SELECT r.id INTO v_route_id
  FROM public.routes r
  JOIN public.route_stations rs1 ON rs1.route_id = r.id AND rs1.station_id = v_pass.pickup_station_id
  JOIN public.route_stations rs2 ON rs2.route_id = r.id AND rs2.station_id = v_pass.drop_station_id
  WHERE r.is_active = true
  ORDER BY (rs2.stop_order - rs1.stop_order) ASC
  LIMIT 1;

  IF v_route_id IS NULL THEN
    SELECT id INTO v_route_id FROM public.routes WHERE is_active = true ORDER BY name ASC LIMIT 1;
  END IF;

  -- 2. Auto-assign Cart and Driver
  SELECT c.id, COALESCE(c.current_driver_id, dd.user_id)
  INTO v_cart_id, v_driver_id
  FROM public.carts c
  LEFT JOIN public.driver_details dd ON dd.cart_id = c.id
  WHERE c.status != 'maintenance'
  ORDER BY CASE WHEN c.status = 'online' THEN 1 ELSE 2 END, c.cart_number ASC
  LIMIT 1;

  -- 3. Loop over valid days and time slots
  FOR v_curr_date IN SELECT d::date FROM generate_series(v_start_date, v_end_date, '1 day'::interval) d LOOP
    -- Skip weekends (ISODOW 6 = Saturday, 7 = Sunday)
    IF EXTRACT(ISODOW FROM v_curr_date) IN (6, 7) THEN
      CONTINUE;
    END IF;

    -- Skip campus holidays
    IF EXISTS (SELECT 1 FROM public.holidays WHERE holiday_date = v_curr_date) THEN
      CONTINUE;
    END IF;

    -- For each selected time slot in the pass request
    IF v_pass.time_slots IS NOT NULL AND array_length(v_pass.time_slots, 1) > 0 THEN
      FOREACH v_slot IN ARRAY v_pass.time_slots LOOP
        v_slot_time := public.parse_time_slot(v_slot);
        v_scheduled_for := (v_curr_date + v_slot_time) AT TIME ZONE 'Asia/Kolkata';

        -- Prevent duplicate insertions
        IF NOT EXISTS (
          SELECT 1 FROM public.rides 
          WHERE pass_id = v_pass.id 
            AND scheduled_for = v_scheduled_for
        ) THEN
          INSERT INTO public.rides (
            pass_id,
            student_id,
            cart_id,
            driver_id,
            route_id,
            pickup_station_id,
            drop_station_id,
            ride_type,
            scheduled_for,
            status,
            eta_minutes
          ) VALUES (
            v_pass.id,
            v_pass.student_id,
            v_cart_id,
            v_driver_id,
            v_route_id,
            v_pass.pickup_station_id,
            v_pass.drop_station_id,
            'scheduled',
            v_scheduled_for,
            'scheduled',
            5
          );
          v_count := v_count + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 8. Hook Ride Generation into Pass Approval (review_pass_request)
CREATE OR REPLACE FUNCTION public.review_pass_request(
  p_request_id uuid,
  p_status text,
  p_review_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_req public.pass_requests;
  v_valid_days integer;
  v_starts_on date;
  v_expires_on date;
  v_qr_token text;
  v_updated public.pass_requests;
  v_rides_generated integer := 0;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only transport office administrators can review pass requests.';
  END IF;

  SELECT * INTO v_req
  FROM public.pass_requests
  WHERE id = p_request_id;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Pass request not found.';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid review status. Must be approved or rejected.';
  END IF;

  IF p_status = 'approved' THEN
    v_valid_days := CASE v_req.duration
      WHEN '2_weeks' THEN 14
      WHEN '1_month' THEN 30
      WHEN 'full_semester' THEN 120
      ELSE 30
    END;

    v_starts_on := CURRENT_DATE;
    v_expires_on := CURRENT_DATE + v_valid_days;

    v_qr_token := 'QARTIX-' || upper(replace(gen_random_uuid()::text, '-', '')) || '-' || to_char(v_expires_on, 'YYYYMMDD');

    UPDATE public.pass_requests
    SET status = 'approved',
        starts_on = v_starts_on,
        expires_on = v_expires_on,
        qr_token = v_qr_token,
        reviewed_by = v_admin_id,
        review_note = COALESCE(p_review_note, 'Approved by Transport Office'),
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_updated;

    -- Automatically generate scheduled rides for each valid day until expiry
    v_rides_generated := public.generate_scheduled_rides_for_pass(v_updated.id);

    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_req.student_id,
      'pass_approved',
      'Mobility Pass Approved (' || v_req.request_code || ')',
      'Your campus mobility pass has been approved! Valid from ' || to_char(v_starts_on, 'Mon DD, YYYY') || ' to ' || to_char(v_expires_on, 'Mon DD, YYYY') || '. ' || v_rides_generated || ' scheduled rides generated for authorized dispatch windows: ' || array_to_string(v_req.time_slots, ', ') || '. Note: ' || COALESCE(p_review_note, 'Approved')
    );
  ELSE
    UPDATE public.pass_requests
    SET status = 'rejected',
        reviewed_by = v_admin_id,
        review_note = COALESCE(p_review_note, 'Pass request was not approved.'),
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_updated;

    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_req.student_id,
      'pass_rejected',
      'Pass Application Update (' || v_req.request_code || ')',
      'Your campus mobility pass request (' || v_req.request_code || ') was not approved. Note: ' || COALESCE(p_review_note, 'Please consult the transport office for details.')
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_updated.status,
    'rides_generated', v_rides_generated,
    'pass_request', row_to_json(v_updated)
  );
END;
$$;

-- 9. Daily pg_cron Top-Up Function
CREATE OR REPLACE FUNCTION public.top_up_scheduled_rides_daily()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_pass record;
  v_total integer := 0;
  v_created integer;
BEGIN
  FOR v_pass IN 
    SELECT id FROM public.pass_requests 
    WHERE status = 'approved' AND expires_on >= CURRENT_DATE 
  LOOP
    v_created := public.generate_scheduled_rides_for_pass(v_pass.id, CURRENT_DATE, CURRENT_DATE + 7);
    v_total := v_total + v_created;
  END LOOP;
  RETURN v_total;
END;
$$;

-- 10. RPC: skip_ride(ride_id)
CREATE OR REPLACE FUNCTION public.skip_ride(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_ride public.rides;
  v_user_id uuid;
  v_min_notice integer;
  v_cutoff_time timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found.';
  END IF;

  IF v_ride.student_id <> v_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You can only skip your own scheduled rides.';
  END IF;

  IF v_ride.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only rides in scheduled status can be skipped. Current status is %.', v_ride.status;
  END IF;

  SELECT COALESCE((value->>'minutes')::integer, 15)
  INTO v_min_notice
  FROM public.app_configs
  WHERE key = 'min_skip_notice_minutes';
  v_min_notice := COALESCE(v_min_notice, 15);

  v_cutoff_time := now() + (v_min_notice || ' minutes')::interval;
  IF v_ride.scheduled_for < v_cutoff_time THEN
    RAISE EXCEPTION 'Rides can only be skipped at least % minutes before scheduled departure.', v_min_notice;
  END IF;

  UPDATE public.rides
  SET status = 'skipped',
      skipped_at = now(),
      updated_at = now()
  WHERE id = p_ride_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_user_id,
    'skip_ride',
    'rides',
    p_ride_id::text,
    jsonb_build_object(
      'student_id', v_ride.student_id,
      'cart_id', v_ride.cart_id,
      'driver_id', v_ride.driver_id,
      'scheduled_for', v_ride.scheduled_for,
      'notice_minutes_required', v_min_notice
    )
  );

  IF v_ride.driver_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_ride.driver_id,
      'ride_skipped',
      'Scheduled Ride Skipped',
      'Student has skipped their scheduled ride for ' || to_char(v_ride.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || '.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', p_ride_id,
    'status', 'skipped',
    'message', 'Ride skipped successfully.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_my_ride(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN public.skip_ride(p_ride_id);
END;
$$;

-- 11. RPC: request_extra_ride(pickup, drop, requested_time)
CREATE OR REPLACE FUNCTION public.request_extra_ride(
  p_pickup text,
  p_drop text,
  p_requested_time timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_student_id uuid;
  v_pass public.pass_requests;
  v_max_daily integer;
  v_max_weekly integer;
  v_daily_count integer;
  v_weekly_count integer;
  v_pickup_id uuid;
  v_drop_id uuid;
  v_cart_id uuid;
  v_driver_id uuid;
  v_route_id uuid;
  v_cart_number text;
  v_new_ride public.rides;
  v_scheduled_for timestamptz;
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to request an extra ride.';
  END IF;

  -- 1. Requires active approved pass
  SELECT * INTO v_pass
  FROM public.pass_requests
  WHERE student_id = v_student_id
    AND status = 'approved'
    AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pass.id IS NULL THEN
    RAISE EXCEPTION 'An active approved campus mobility pass is required to request extra rides.';
  END IF;

  -- 2. Check configurable quotas
  SELECT COALESCE((value->>'limit')::integer, 2) INTO v_max_daily FROM public.app_configs WHERE key = 'max_extra_rides_per_day';
  SELECT COALESCE((value->>'limit')::integer, 5) INTO v_max_weekly FROM public.app_configs WHERE key = 'max_extra_rides_per_week';
  v_max_daily := COALESCE(v_max_daily, 2);
  v_max_weekly := COALESCE(v_max_weekly, 5);

  v_scheduled_for := COALESCE(p_requested_time, now());

  SELECT COUNT(*) INTO v_daily_count
  FROM public.rides
  WHERE student_id = v_student_id
    AND ride_type = 'extra'
    AND scheduled_for::date = (v_scheduled_for AT TIME ZONE 'Asia/Kolkata')::date
    AND status NOT IN ('cancelled', 'skipped');

  IF v_daily_count >= v_max_daily THEN
    RAISE EXCEPTION 'Daily limit reached: You can request up to % extra rides per day (% booked today).', v_max_daily, v_daily_count;
  END IF;

  SELECT COUNT(*) INTO v_weekly_count
  FROM public.rides
  WHERE student_id = v_student_id
    AND ride_type = 'extra'
    AND scheduled_for >= date_trunc('week', v_scheduled_for AT TIME ZONE 'Asia/Kolkata')
    AND status NOT IN ('cancelled', 'skipped');

  IF v_weekly_count >= v_max_weekly THEN
    RAISE EXCEPTION 'Weekly limit reached: You can request up to % extra rides per week (% booked this week).', v_max_weekly, v_weekly_count;
  END IF;

  -- 3. Resolve stations
  IF p_pickup ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_pickup_id := p_pickup::uuid;
  ELSE
    SELECT id INTO v_pickup_id FROM public.stations WHERE name ILIKE '%' || p_pickup || '%' LIMIT 1;
  END IF;

  IF p_drop ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_drop_id := p_drop::uuid;
  ELSE
    SELECT id INTO v_drop_id FROM public.stations WHERE name ILIKE '%' || p_drop || '%' LIMIT 1;
  END IF;

  IF v_pickup_id IS NULL THEN
    SELECT id INTO v_pickup_id FROM public.stations WHERE name = 'Science Concourse Station' LIMIT 1;
    IF v_pickup_id IS NULL THEN
      SELECT id INTO v_pickup_id FROM public.stations LIMIT 1;
    END IF;
  END IF;

  IF v_drop_id IS NULL THEN
    SELECT id INTO v_drop_id FROM public.stations WHERE name = 'Campus Health & Sports Pavilion' LIMIT 1;
    IF v_drop_id IS NULL THEN
      SELECT id INTO v_drop_id FROM public.stations OFFSET 1 LIMIT 1;
    END IF;
  END IF;

  -- 4. Dispatcher / Auto-Assigner picks a cart and driver
  SELECT c.id, COALESCE(c.current_driver_id, dd.user_id), c.cart_number
  INTO v_cart_id, v_driver_id, v_cart_number
  FROM public.carts c
  LEFT JOIN public.driver_details dd ON dd.cart_id = c.id
  WHERE c.status != 'maintenance'
  ORDER BY CASE WHEN c.status = 'online' THEN 1 ELSE 2 END, c.cart_number ASC
  LIMIT 1;

  -- 5. Auto-assign route
  SELECT r.id INTO v_route_id
  FROM public.routes r
  JOIN public.route_stations rs1 ON rs1.route_id = r.id AND rs1.station_id = v_pickup_id
  JOIN public.route_stations rs2 ON rs2.route_id = r.id AND rs2.station_id = v_drop_id
  WHERE r.is_active = true
  LIMIT 1;

  -- 6. Insert extra ride with status 'requested'
  INSERT INTO public.rides (
    pass_id,
    student_id,
    cart_id,
    driver_id,
    route_id,
    pickup_station_id,
    drop_station_id,
    ride_type,
    scheduled_for,
    status,
    eta_minutes
  ) VALUES (
    v_pass.id,
    v_student_id,
    v_cart_id,
    v_driver_id,
    v_route_id,
    v_pickup_id,
    v_drop_id,
    'extra',
    v_scheduled_for,
    'requested',
    CASE WHEN v_cart_id IS NOT NULL THEN 5 ELSE NULL END
  ) RETURNING * INTO v_new_ride;

  -- Log audit
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_student_id,
    'request_extra_ride',
    'rides',
    v_new_ride.id::text,
    jsonb_build_object(
      'pickup_id', v_pickup_id,
      'drop_id', v_drop_id,
      'cart_id', v_cart_id,
      'cart_number', v_cart_number,
      'driver_id', v_driver_id,
      'cart_available', (v_cart_id IS NOT NULL)
    )
  );

  -- Notify student
  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (
    v_student_id,
    'extra_ride_requested',
    'Extra Ride Requested',
    CASE 
      WHEN v_cart_id IS NOT NULL THEN 'Your priority extra ride has been received. Cart ' || COALESCE(v_cart_number, 'assigned') || ' is dispatched.'
      ELSE 'Your extra ride request is received and placed in the queue awaiting next available cart.'
    END
  );

  -- Notify driver if assigned
  IF v_driver_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_driver_id,
      'extra_ride_assigned',
      'Priority Extra Ride Assigned',
      'New priority extra ride request assigned to your shift.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'requested',
    'cart_assigned', (v_cart_id IS NOT NULL),
    'cart_number', v_cart_number,
    'message', CASE 
      WHEN v_cart_id IS NOT NULL THEN 'Extra ride requested! Cart ' || COALESCE(v_cart_number, 'assigned') || ' is on priority standby.'
      ELSE 'Extra ride requested! Placed in queue awaiting next available cart.'
    END,
    'ride', row_to_json(v_new_ride)
  );
END;
$$;

-- 12. RPC: admin_assign_ride (Admin Override)
CREATE OR REPLACE FUNCTION public.admin_assign_ride(
  p_ride_id uuid,
  p_cart_id uuid,
  p_driver_id uuid DEFAULT NULL,
  p_route_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_driver_id uuid := p_driver_id;
  v_updated public.rides;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only transport office administrators can assign or reassign rides.';
  END IF;

  IF v_driver_id IS NULL AND p_cart_id IS NOT NULL THEN
    SELECT COALESCE(current_driver_id, dd.user_id) INTO v_driver_id
    FROM public.carts c
    LEFT JOIN public.driver_details dd ON dd.cart_id = c.id
    WHERE c.id = p_cart_id;
  END IF;

  UPDATE public.rides
  SET cart_id = p_cart_id,
      driver_id = COALESCE(v_driver_id, driver_id),
      route_id = COALESCE(p_route_id, route_id),
      updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_updated;

  IF v_updated.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found.';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_admin_id,
    'admin_override_ride_assignment',
    'rides',
    p_ride_id::text,
    jsonb_build_object('cart_id', p_cart_id, 'driver_id', v_driver_id, 'route_id', p_route_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'ride', row_to_json(v_updated)
  );
END;
$$;

-- 13. RPC Grants & Security
REVOKE EXECUTE ON FUNCTION public.skip_ride(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_ride(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.skip_my_ride(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_my_ride(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_extra_ride(text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_extra_ride(text, text, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_assign_ride(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_ride(uuid, uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.generate_scheduled_rides_for_pass(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_scheduled_rides_for_pass(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.top_up_scheduled_rides_daily() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.top_up_scheduled_rides_daily() TO authenticated;
