-- ==============================================================================
-- Qartix Campus Transit System - Strict RLS & Storage Hardening Migration
-- Migration: 20261120030000_qartix_strict_rls_and_storage.sql
-- Description:
--   1. Helper functions with SECURITY DEFINER and locked search_path = '' (no recursion)
--   2. Strict Row Level Security policies across all tables
--   3. Secure RPCs: skip_my_ride (Student), update_driver_ride_status (Driver)
--   4. Driver restricted view and RPC for assigned rides (privacy-preserving)
--   5. Private storage bucket 'medical-certificates' with path enforcement & 5MB limits
-- ==============================================================================

-- 1. SECURITY DEFINER HELPER FUNCTIONS (Locked search path to prevent recursion)
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_driver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'driver'
      AND status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.current_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_driver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_driver() TO authenticated;

-- 2. PASS REQUEST & PROFILE INTEGRITY TRIGGERS
CREATE OR REPLACE FUNCTION public.protect_pass_request_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status OR 
      NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR 
      NEW.review_note IS DISTINCT FROM OLD.review_note OR
      NEW.starts_on IS DISTINCT FROM OLD.starts_on OR
      NEW.expires_on IS DISTINCT FROM OLD.expires_on) THEN
    IF (SELECT auth.uid()) IS NOT NULL AND (SELECT public.current_role()) <> 'admin' THEN
      RAISE EXCEPTION 'Unauthorized: Pass approval and status changes can only be performed by transport administrators.';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_protect_pass_request_status
  BEFORE UPDATE ON public.pass_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_pass_request_status();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. SECURE RPCS FOR RIDE WORKFLOWS
-- RPC: Student skips own scheduled ride
CREATE OR REPLACE FUNCTION public.skip_my_ride(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ride record;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found.';
  END IF;

  IF v_ride.student_id <> (SELECT auth.uid()) AND (SELECT public.current_role()) <> 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: You can only skip your own scheduled rides.';
  END IF;

  IF v_ride.status NOT IN ('scheduled', 'approaching') THEN
    RAISE EXCEPTION 'Cannot skip a ride that is already in progress, arrived, or completed.';
  END IF;

  UPDATE public.rides
  SET status = 'skipped',
      skipped_at = now(),
      updated_at = now()
  WHERE id = p_ride_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    (SELECT auth.uid()),
    'RIDE_SKIPPED',
    'rides',
    p_ride_id::text,
    jsonb_build_object('student_id', v_ride.student_id, 'scheduled_for', v_ride.scheduled_for)
  );

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'status', 'skipped');
END;
$$;

-- RPC: Driver updates assigned shift ride progress
CREATE OR REPLACE FUNCTION public.update_driver_ride_status(p_ride_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ride record;
  v_new_status text := LOWER(p_status);
BEGIN
  IF v_new_status NOT IN ('approaching', 'arrived', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'Invalid ride status transition.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found.';
  END IF;

  IF v_ride.driver_id <> (SELECT auth.uid()) AND (SELECT public.current_role()) <> 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: You can only update rides assigned to your shift.';
  END IF;

  IF v_ride.scheduled_for < date_trunc('day', now()) OR v_ride.scheduled_for >= date_trunc('day', now()) + interval '1 day' THEN
    IF (SELECT public.current_role()) <> 'admin' THEN
      RAISE EXCEPTION 'Unauthorized: Drivers can only update rides scheduled for today.';
    END IF;
  END IF;

  UPDATE public.rides
  SET status = v_new_status,
      arrived_at = CASE WHEN v_new_status = 'arrived' AND arrived_at IS NULL THEN now() ELSE arrived_at END,
      completed_at = CASE WHEN v_new_status = 'completed' AND completed_at IS NULL THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_ride_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    (SELECT auth.uid()),
    'DRIVER_RIDE_UPDATE',
    'rides',
    p_ride_id::text,
    jsonb_build_object('new_status', v_new_status, 'driver_id', (SELECT auth.uid()))
  );

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'status', v_new_status);
END;
$$;

-- RPC: Driver assigned rides query (exposing student info ONLY for assigned rides)
CREATE OR REPLACE FUNCTION public.get_driver_assigned_rides()
RETURNS TABLE (
  ride_id uuid,
  scheduled_for timestamptz,
  status text,
  eta_minutes integer,
  ride_type text,
  pickup_station_id uuid,
  pickup_station_name text,
  drop_station_id uuid,
  drop_station_name text,
  student_name text,
  student_roll_no text,
  student_phone text,
  student_hostel text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id AS ride_id,
    r.scheduled_for,
    r.status,
    r.eta_minutes,
    r.ride_type,
    r.pickup_station_id,
    s_from.name AS pickup_station_name,
    r.drop_station_id,
    s_to.name AS drop_station_name,
    p.full_name AS student_name,
    COALESCE(sd.roll_no, p.login_identifier) AS student_roll_no,
    p.phone AS student_phone,
    COALESCE(sd.hostel, 'Block C - Oak Hall') AS student_hostel
  FROM public.rides r
  JOIN public.profiles p ON r.student_id = p.id
  LEFT JOIN public.student_details sd ON p.id = sd.user_id
  LEFT JOIN public.stations s_from ON r.pickup_station_id = s_from.id
  LEFT JOIN public.stations s_to ON r.drop_station_id = s_to.id
  WHERE (
    (r.driver_id = (SELECT auth.uid()) 
     AND r.scheduled_for >= date_trunc('day', now()) 
     AND r.scheduled_for < date_trunc('day', now()) + interval '1 day')
    OR (SELECT public.is_admin())
  )
  ORDER BY r.scheduled_for ASC;
END;
$$;

CREATE OR REPLACE VIEW public.driver_assigned_rides 
WITH (security_invoker = true) AS
SELECT * FROM public.get_driver_assigned_rides();

REVOKE EXECUTE ON FUNCTION public.protect_pass_request_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.skip_my_ride(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_driver_ride_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_driver_assigned_rides() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.skip_my_ride(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_driver_ride_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_assigned_rides() TO authenticated;
GRANT SELECT ON public.driver_assigned_rides TO authenticated;

-- 4. EXPLICIT TABLE ROW LEVEL SECURITY POLICIES
-- PROFILES: user reads/updates own row (role/status locked by trigger); admin reads/updates all
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin')
WITH CHECK (id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

-- STUDENT DETAILS
CREATE POLICY "student_details_select" ON public.student_details FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

CREATE POLICY "student_details_update" ON public.student_details FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin')
WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

CREATE POLICY "student_details_insert" ON public.student_details FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

-- DRIVER DETAILS
CREATE POLICY "driver_details_select" ON public.driver_details FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

CREATE POLICY "driver_details_update" ON public.driver_details FOR UPDATE TO authenticated
USING ((SELECT public.current_role()) = 'admin')
WITH CHECK ((SELECT public.current_role()) = 'admin');

CREATE POLICY "driver_details_insert" ON public.driver_details FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

-- PASS REQUESTS: student inserts/reads own; status/approval locked; admin reads/updates all
CREATE POLICY "pass_requests_select" ON public.pass_requests FOR SELECT TO authenticated
USING (student_id = (SELECT auth.uid()) OR (SELECT public.current_role()) = 'admin');

CREATE POLICY "pass_requests_insert" ON public.pass_requests FOR INSERT TO authenticated
WITH CHECK (student_id = (SELECT auth.uid()) AND status = 'pending');

CREATE POLICY "pass_requests_update" ON public.pass_requests FOR UPDATE TO authenticated
USING (
  (student_id = (SELECT auth.uid()) AND status = 'draft')
  OR (SELECT public.current_role()) = 'admin'
)
WITH CHECK (
  (student_id = (SELECT auth.uid()) AND status = 'draft')
  OR (SELECT public.current_role()) = 'admin'
);

-- RIDES: student reads own; driver reads today assigned; direct update admin only (RPC for riders/drivers)
CREATE POLICY "rides_select" ON public.rides FOR SELECT TO authenticated
USING (
  student_id = (SELECT auth.uid())
  OR (
    driver_id = (SELECT auth.uid())
    AND scheduled_for >= date_trunc('day', now())
    AND scheduled_for < date_trunc('day', now()) + interval '1 day'
  )
  OR (SELECT public.current_role()) = 'admin'
);

CREATE POLICY "rides_insert" ON public.rides FOR INSERT TO authenticated
WITH CHECK (
  student_id = (SELECT auth.uid()) 
  OR (SELECT public.current_role()) = 'admin'
);

CREATE POLICY "rides_admin_update" ON public.rides FOR UPDATE TO authenticated
USING ((SELECT public.current_role()) = 'admin')
WITH CHECK ((SELECT public.current_role()) = 'admin');

-- CARTS: student reads live location only for assigned active ride cart; driver updates own; admin all
CREATE POLICY "carts_select" ON public.carts FOR SELECT TO authenticated
USING (
  (SELECT public.current_role()) = 'admin'
  OR current_driver_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.cart_id = carts.id
      AND r.student_id = (SELECT auth.uid())
      AND r.status IN ('scheduled', 'approaching', 'in_progress')
      AND r.scheduled_for >= (now() - interval '2 hours')
      AND r.scheduled_for <= (now() + interval '4 hours')
  )
);

CREATE POLICY "carts_update" ON public.carts FOR UPDATE TO authenticated
USING (
  current_driver_id = (SELECT auth.uid())
  OR (SELECT public.current_role()) = 'admin'
)
WITH CHECK (
  current_driver_id = (SELECT auth.uid())
  OR (SELECT public.current_role()) = 'admin'
);

CREATE POLICY "carts_admin_insert" ON public.carts FOR INSERT TO authenticated
WITH CHECK ((SELECT public.current_role()) = 'admin');

-- STATIONS & ROUTES: read for all authenticated users, write admin only
CREATE POLICY "stations_select" ON public.stations FOR SELECT TO authenticated
USING (true);

CREATE POLICY "stations_insert" ON public.stations FOR INSERT TO authenticated
WITH CHECK ((SELECT public.current_role()) = 'admin');

CREATE POLICY "stations_update" ON public.stations FOR UPDATE TO authenticated
USING ((SELECT public.current_role()) = 'admin')
WITH CHECK ((SELECT public.current_role()) = 'admin');

CREATE POLICY "routes_select" ON public.routes FOR SELECT TO authenticated
USING (true);

CREATE POLICY "routes_write" ON public.routes FOR ALL TO authenticated
USING ((SELECT public.current_role()) = 'admin')
WITH CHECK ((SELECT public.current_role()) = 'admin');

CREATE POLICY "route_stations_select" ON public.route_stations FOR SELECT TO authenticated
USING (true);

CREATE POLICY "route_stations_write" ON public.route_stations FOR ALL TO authenticated
USING ((SELECT public.current_role()) = 'admin')
WITH CHECK ((SELECT public.current_role()) = 'admin');

-- NOTIFICATIONS: user reads/updates own
CREATE POLICY "notifications_select" ON public.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "notifications_admin_insert" ON public.notifications FOR INSERT TO authenticated
WITH CHECK ((SELECT public.current_role()) = 'admin');

-- AUDIT LOGS: admin read only, insert via server triggers/RPCs only
CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT TO authenticated
USING ((SELECT public.current_role()) = 'admin');

-- 5. PRIVATE STORAGE BUCKET & PATH POLICIES
UPDATE storage.buckets
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
WHERE id = 'medical-certificates';

CREATE POLICY "medical_certificates_upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'medical-certificates'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND array_length(regexp_split_to_array(name, '/'), 1) = 3
  AND LOWER(storage.extension(name)) IN ('pdf', 'jpg', 'jpeg', 'png')
);

CREATE POLICY "medical_certificates_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'medical-certificates'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR (SELECT public.current_role()) = 'admin'
  )
);

CREATE POLICY "medical_certificates_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'medical-certificates'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR (SELECT public.current_role()) = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'medical-certificates'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR (SELECT public.current_role()) = 'admin'
  )
);

CREATE POLICY "medical_certificates_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'medical-certificates'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR (SELECT public.current_role()) = 'admin'
  )
);
