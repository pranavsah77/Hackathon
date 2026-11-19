-- Qartix Campus Transit System - Core Architecture Migration
-- Migration: 20261120020000_qartix_core_schema.sql

-- 1. HELPER EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 3. ROLE HELPER FUNCTIONS (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
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
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'driver'
      AND status = 'active'
  );
$$;

-- 4. EVOLVE PROFILES TABLE
-- Ensure profiles has login_identifier, status, role
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'driver', 'admin')),
  full_name text NOT NULL DEFAULT '',
  login_identifier text UNIQUE,
  phone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_approval', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add missing columns if profiles already existed
DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_identifier text UNIQUE;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_approval', 'suspended'));
EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 5. STUDENT DETAILS TABLE
CREATE TABLE IF NOT EXISTS public.student_details (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  roll_no text NOT NULL UNIQUE,
  hostel text NOT NULL DEFAULT 'Block C - Oak Hall',
  department text NOT NULL DEFAULT 'Engineering',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_details ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER trg_student_details_updated_at
BEFORE UPDATE ON public.student_details
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 6. STATIONS TABLE
CREATE TABLE IF NOT EXISTS public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('hostel', 'gate', 'academic', 'library', 'health')),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER trg_stations_updated_at
BEFORE UPDATE ON public.stations
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 7. ROUTES & ROUTE STATIONS TABLES
CREATE TABLE IF NOT EXISTS public.routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER trg_routes_updated_at
BEFORE UPDATE ON public.routes
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();

CREATE TABLE IF NOT EXISTS public.route_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  stop_order integer NOT NULL CHECK (stop_order >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_route_stop_order UNIQUE (route_id, stop_order),
  CONSTRAINT uq_route_station UNIQUE (route_id, station_id)
);

ALTER TABLE public.route_stations ENABLE ROW LEVEL SECURITY;

-- 8. CARTS TABLE
CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'in_transit', 'maintenance')),
  current_driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lat double precision NOT NULL DEFAULT 12.9716,
  lng double precision NOT NULL DEFAULT 77.5946,
  speed_kmh integer NOT NULL DEFAULT 0 CHECK (speed_kmh >= 0 AND speed_kmh <= 60),
  heading integer NOT NULL DEFAULT 0 CHECK (heading >= 0 AND heading <= 360),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS current_driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS lat double precision NOT NULL DEFAULT 12.9716;
  ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS lng double precision NOT NULL DEFAULT 77.5946;
  ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS heading integer NOT NULL DEFAULT 0;
  ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER trg_carts_updated_at
BEFORE UPDATE ON public.carts
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 9. DRIVER DETAILS TABLE
CREATE TABLE IF NOT EXISTS public.driver_details (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  driver_code text NOT NULL UNIQUE,
  cart_id uuid REFERENCES public.carts(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_details ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER trg_driver_details_updated_at
BEFORE UPDATE ON public.driver_details
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 10. ARCHIVE & MIGRATE PASS_REQUESTS & RIDES (Preserving data, implementing UUID PKs)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'pass_requests' AND data_type = 'text' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.pass_requests RENAME TO pass_requests_v1;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'rides' AND data_type = 'text' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.rides RENAME TO rides_v1;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

-- 11. PASS REQUESTS TABLE (UUID PK, request_code, enums, FKs)
CREATE TABLE IF NOT EXISTS public.pass_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code text NOT NULL UNIQUE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  medical_condition text NOT NULL CHECK (medical_condition IN ('Leg/Ankle Fracture', 'Ligament Tear / Sprain', 'Post-Surgery Recovery', 'Chronic Mobility Condition', 'Other')),
  reason text NOT NULL,
  certificate_path text,
  route_template text NOT NULL DEFAULT 'Hostel -> Class',
  pickup_station_id uuid REFERENCES public.stations(id) ON DELETE RESTRICT,
  drop_station_id uuid REFERENCES public.stations(id) ON DELETE RESTRICT,
  time_slots text[] NOT NULL DEFAULT '{}',
  duration text NOT NULL DEFAULT '1_month' CHECK (duration IN ('2_weeks', '1_month', 'full_semester')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'expired')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note text NOT NULL DEFAULT '',
  starts_on date,
  expires_on date,
  qr_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pass_dates CHECK (expires_on IS NULL OR starts_on IS NULL OR expires_on >= starts_on)
);

ALTER TABLE public.pass_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER trg_pass_requests_updated_at
BEFORE UPDATE ON public.pass_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 12. RIDES TABLE (UUID PK, FKs, scheduled_for, ride_type, status)
CREATE TABLE IF NOT EXISTS public.rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id uuid REFERENCES public.pass_requests(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cart_id uuid REFERENCES public.carts(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  pickup_station_id uuid REFERENCES public.stations(id) ON DELETE RESTRICT,
  drop_station_id uuid REFERENCES public.stations(id) ON DELETE RESTRICT,
  ride_type text NOT NULL DEFAULT 'scheduled' CHECK (ride_type IN ('scheduled', 'extra')),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'approaching', 'arrived', 'in_progress', 'completed', 'skipped', 'cancelled')),
  eta_minutes integer DEFAULT 5 CHECK (eta_minutes >= 0),
  arrived_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ride_completion_time CHECK (completed_at IS NULL OR arrived_at IS NULL OR completed_at >= arrived_at)
);

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER trg_rides_updated_at
BEFORE UPDATE ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 13. CART LOCATION HISTORY TABLE (Telemetry Log)
CREATE TABLE IF NOT EXISTS public.cart_location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed integer NOT NULL DEFAULT 0 CHECK (speed >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cart_location_history ENABLE ROW LEVEL SECURITY;

-- Retention Policy function (prunes location logs older than 7 days)
CREATE OR REPLACE FUNCTION public.prune_cart_location_history(days_to_keep integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_rows integer;
BEGIN
  -- Only internal/admin callers can prune
  IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH deleted AS (
    DELETE FROM public.cart_location_history
    WHERE recorded_at < now() - (days_to_keep || ' days')::interval
    RETURNING 1
  )
  SELECT count(*) INTO deleted_rows FROM deleted;
  RETURN deleted_rows;
END;
$$;

-- 14. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 15. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 16. INDEXES ON ALL FOREIGN KEYS & COMPOSITE ACCESS PATTERNS
-- Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_student_details_user ON public.student_details(user_id);
CREATE INDEX IF NOT EXISTS idx_driver_details_user ON public.driver_details(user_id);
CREATE INDEX IF NOT EXISTS idx_driver_details_cart ON public.driver_details(cart_id);
CREATE INDEX IF NOT EXISTS idx_driver_details_approved_by ON public.driver_details(approved_by);

CREATE INDEX IF NOT EXISTS idx_route_stations_route ON public.route_stations(route_id);
CREATE INDEX IF NOT EXISTS idx_route_stations_station ON public.route_stations(station_id);

CREATE INDEX IF NOT EXISTS idx_carts_current_driver ON public.carts(current_driver_id);

CREATE INDEX IF NOT EXISTS idx_pass_requests_student ON public.pass_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_pickup ON public.pass_requests(pickup_station_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_drop ON public.pass_requests(drop_station_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_reviewed_by ON public.pass_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_pass_requests_status ON public.pass_requests(status);

CREATE INDEX IF NOT EXISTS idx_rides_pass ON public.rides(pass_id);
CREATE INDEX IF NOT EXISTS idx_rides_student ON public.rides(student_id);
CREATE INDEX IF NOT EXISTS idx_rides_cart ON public.rides(cart_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON public.rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_pickup ON public.rides(pickup_station_id);
CREATE INDEX IF NOT EXISTS idx_rides_drop ON public.rides(drop_station_id);

CREATE INDEX IF NOT EXISTS idx_cart_location_history_cart ON public.cart_location_history(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_location_history_time ON public.cart_location_history(recorded_at);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity, entity_id);

-- User-Required Specific Composite Indexes
CREATE INDEX IF NOT EXISTS idx_rides_student_scheduled ON public.rides(student_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_rides_driver_scheduled ON public.rides(driver_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_carts_cart_status ON public.carts(id, status);
CREATE INDEX IF NOT EXISTS idx_rides_status_scheduled ON public.rides(status, scheduled_for);

-- 17. ROW LEVEL SECURITY (RLS) POLICIES ON EVERY TABLE

-- PROFILES POLICIES
CREATE POLICY "profiles_select_policy" ON public.profiles FOR SELECT TO authenticated
USING (
  (SELECT auth.uid()) = id 
  OR (SELECT public.is_admin()) 
  OR (SELECT public.is_driver())
);

CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY "profiles_admin_update" ON public.profiles FOR UPDATE TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

-- STUDENT DETAILS POLICIES
CREATE POLICY "student_details_select" ON public.student_details FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid()) 
  OR (SELECT public.is_admin()) 
  OR (SELECT public.is_driver())
);

CREATE POLICY "student_details_update" ON public.student_details FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

CREATE POLICY "student_details_insert" ON public.student_details FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

-- DRIVER DETAILS POLICIES
CREATE POLICY "driver_details_select" ON public.driver_details FOR SELECT TO authenticated
USING (true);

CREATE POLICY "driver_details_admin_insert" ON public.driver_details FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_admin()) OR user_id = (SELECT auth.uid()));

CREATE POLICY "driver_details_admin_update" ON public.driver_details FOR UPDATE TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

-- STATIONS POLICIES
CREATE POLICY "stations_select" ON public.stations FOR SELECT TO authenticated
USING (true);

CREATE POLICY "stations_admin_insert" ON public.stations FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "stations_admin_update" ON public.stations FOR UPDATE TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

-- ROUTES POLICIES
CREATE POLICY "routes_select" ON public.routes FOR SELECT TO authenticated
USING (true);

CREATE POLICY "routes_admin_all" ON public.routes FOR ALL TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

-- ROUTE STATIONS POLICIES
CREATE POLICY "route_stations_select" ON public.route_stations FOR SELECT TO authenticated
USING (true);

CREATE POLICY "route_stations_admin_all" ON public.route_stations FOR ALL TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

-- CARTS POLICIES
CREATE POLICY "carts_select" ON public.carts FOR SELECT TO authenticated
USING (true);

CREATE POLICY "carts_update" ON public.carts FOR UPDATE TO authenticated
USING (
  current_driver_id = (SELECT auth.uid()) 
  OR (SELECT public.is_admin())
)
WITH CHECK (
  current_driver_id = (SELECT auth.uid()) 
  OR (SELECT public.is_admin())
);

CREATE POLICY "carts_admin_insert" ON public.carts FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_admin()));

-- PASS REQUESTS POLICIES
CREATE POLICY "pass_requests_select" ON public.pass_requests FOR SELECT TO authenticated
USING (
  student_id = (SELECT auth.uid()) 
  OR (SELECT public.is_admin())
);

CREATE POLICY "pass_requests_insert" ON public.pass_requests FOR INSERT TO authenticated
WITH CHECK (
  student_id = (SELECT auth.uid())
);

CREATE POLICY "pass_requests_update" ON public.pass_requests FOR UPDATE TO authenticated
USING (
  (student_id = (SELECT auth.uid()) AND status = 'draft')
  OR (SELECT public.is_admin())
)
WITH CHECK (
  (student_id = (SELECT auth.uid()) AND status = 'draft')
  OR (SELECT public.is_admin())
);

-- RIDES POLICIES
CREATE POLICY "rides_select" ON public.rides FOR SELECT TO authenticated
USING (
  student_id = (SELECT auth.uid()) 
  OR driver_id = (SELECT auth.uid())
  OR (SELECT public.is_driver()) 
  OR (SELECT public.is_admin())
);

CREATE POLICY "rides_student_insert" ON public.rides FOR INSERT TO authenticated
WITH CHECK (
  student_id = (SELECT auth.uid()) 
  OR (SELECT public.is_admin())
);

CREATE POLICY "rides_student_update" ON public.rides FOR UPDATE TO authenticated
USING (
  student_id = (SELECT auth.uid())
  OR driver_id = (SELECT auth.uid())
  OR (SELECT public.is_driver())
  OR (SELECT public.is_admin())
)
WITH CHECK (
  student_id = (SELECT auth.uid())
  OR driver_id = (SELECT auth.uid())
  OR (SELECT public.is_driver())
  OR (SELECT public.is_admin())
);

-- CART LOCATION HISTORY POLICIES
CREATE POLICY "cart_location_history_select" ON public.cart_location_history FOR SELECT TO authenticated
USING (true);

CREATE POLICY "cart_location_history_insert" ON public.cart_location_history FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_driver()) 
  OR (SELECT public.is_admin())
);

-- NOTIFICATIONS POLICIES
CREATE POLICY "notifications_select" ON public.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_admin()));

-- AUDIT LOGS POLICIES
CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT TO authenticated
USING ((SELECT public.is_admin()));

CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (true);

-- 18. ROLE PROTECTION & NEW USER TRIGGERS
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role) OR (NEW.status IS DISTINCT FROM OLD.status) THEN
    IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.is_admin()) THEN
      RAISE EXCEPTION 'Unauthorized: User role and status are server-side managed and can only be altered by transport administrators.';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_protect_profile_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();

-- Auto create profile and details on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req_role text;
  init_status text;
  clean_ident text;
BEGIN
  req_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'role', 'student'));
  
  -- Role defaults to student and cannot be set to admin at signup
  IF req_role NOT IN ('student', 'driver') THEN
    req_role := 'student';
  END IF;

  IF req_role = 'driver' THEN
    init_status := 'pending_approval';
    clean_ident := UPPER(COALESCE(NEW.raw_user_meta_data->>'driverId', NEW.raw_user_meta_data->>'driver_code', 'DRV-' || SUBSTRING(NEW.id::text, 1, 6)));
  ELSE
    init_status := 'active';
    clean_ident := UPPER(COALESCE(NEW.raw_user_meta_data->>'studentId', NEW.raw_user_meta_data->>'roll_no', NEW.raw_user_meta_data->>'identifier', 'STU-' || SUBSTRING(NEW.id::text, 1, 6)));
  END IF;

  INSERT INTO public.profiles (
    id,
    role,
    full_name,
    login_identifier,
    phone,
    status
  ) VALUES (
    NEW.id,
    req_role,
    COALESCE(NEW.raw_user_meta_data->>'fullName', NEW.raw_user_meta_data->>'full_name', 'Campus Rider'),
    clean_ident,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    init_status
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    updated_at = now();

  IF req_role = 'student' THEN
    INSERT INTO public.student_details (user_id, roll_no, hostel, department)
    VALUES (
      NEW.id,
      clean_ident,
      COALESCE(NEW.raw_user_meta_data->>'hostel', 'Block C - Oak Hall'),
      COALESCE(NEW.raw_user_meta_data->>'department', 'Engineering')
    ) ON CONFLICT (user_id) DO NOTHING;
  ELSIF req_role = 'driver' THEN
    INSERT INTO public.driver_details (user_id, driver_code)
    VALUES (
      NEW.id,
      clean_ident
    ) ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- 19. REVOKE EXECUTE ON INTERNAL TRIGGERS
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_current_timestamp_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_cart_location_history(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_driver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_driver() TO authenticated;
