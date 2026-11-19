-- Qartix Campus Transit System Migration
-- Migration: 20261120000000_qartix_init.sql

-- 1. PROFILES TABLE (Server-Side Role Management)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'driver', 'admin')),
  student_id text,
  residency_status text CHECK (residency_status IN ('Hostler', 'Day Scholar')),
  hostel_block text DEFAULT 'Hostel Resident',
  driver_id text,
  driver_approved boolean NOT NULL DEFAULT false,
  is_online boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. HELPER FUNCTIONS (SECURITY INVOKER, Search Path Protected)
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
      AND driver_approved = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT role FROM public.profiles
  WHERE id = (SELECT auth.uid())
  LIMIT 1;
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can select own profile or admins and approved drivers"
ON public.profiles FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) = id
  OR (SELECT public.is_admin())
  OR (SELECT public.is_driver())
);

CREATE POLICY "Users can update own non-sensitive profile info"
ON public.profiles FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY "Admins can update any profile"
ON public.profiles FOR UPDATE
TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

-- Enforce server-side role lock: clients can NEVER change their role or self-approve
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role) OR (NEW.driver_approved IS DISTINCT FROM OLD.driver_approved) THEN
    IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.is_admin()) THEN
      RAISE EXCEPTION 'Unauthorized: User role and driver approval are server-side managed and can only be altered by transport administrators.';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();

-- Auto create profile on auth.users insert with server-side validation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req_role text;
  initial_approved boolean := false;
BEGIN
  req_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'role', 'student'));
  
  -- HARD RULE: Role is stored server-side. Admin cannot be self-assigned in sign-up.
  IF req_role NOT IN ('student', 'driver') THEN
    req_role := 'student';
  END IF;

  -- Drivers require admin approval before becoming active
  IF req_role = 'driver' THEN
    initial_approved := false;
  ELSE
    initial_approved := true;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    phone,
    role,
    student_id,
    residency_status,
    hostel_block,
    driver_id,
    driver_approved
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'fullName', NEW.raw_user_meta_data->>'full_name', 'Campus Rider'),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    req_role,
    COALESCE(NEW.raw_user_meta_data->>'studentId', NEW.raw_user_meta_data->>'identifier', ''),
    COALESCE(NEW.raw_user_meta_data->>'residencyStatus', 'Hostler'),
    COALESCE(NEW.raw_user_meta_data->>'hostelBlock', 'Hostel Resident'),
    COALESCE(NEW.raw_user_meta_data->>'driverId', ''),
    initial_approved
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- 3. CARTS TABLE (Fleet Telemetry)
CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline', 'in_transit', 'maintenance')),
  assigned_driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  current_station text NOT NULL DEFAULT 'Science Concourse Station',
  speed_kmh integer NOT NULL DEFAULT 14,
  eta_minutes integer NOT NULL DEFAULT 4,
  route_label text NOT NULL DEFAULT 'ROUTE 01 ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view carts"
ON public.carts FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Assigned drivers or admins can update carts"
ON public.carts FOR UPDATE
TO authenticated
USING (
  assigned_driver_id = (SELECT auth.uid())
  OR (SELECT public.is_admin())
)
WITH CHECK (
  assigned_driver_id = (SELECT auth.uid())
  OR (SELECT public.is_admin())
);

CREATE POLICY "Admins can insert carts"
ON public.carts FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.is_admin()));

-- 4. PASS REQUESTS TABLE (Medical Verification & Mobility Passes)
CREATE TABLE IF NOT EXISTS public.pass_requests (
  id text PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_code text NOT NULL,
  residency_type text NOT NULL DEFAULT 'Hostler',
  mobile text NOT NULL DEFAULT '',
  pickup text NOT NULL,
  drop_station text NOT NULL,
  route text NOT NULL,
  time_slots text[] NOT NULL DEFAULT '{}',
  duration text NOT NULL DEFAULT '1 Month',
  validity_days integer NOT NULL DEFAULT 30,
  medical_condition text NOT NULL,
  reason text NOT NULL,
  certificate_name text NOT NULL DEFAULT '',
  certificate_url text,
  certificate_size text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes text DEFAULT '',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pass_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own pass requests, admins can view all"
ON public.pass_requests FOR SELECT
TO authenticated
USING (
  student_id = (SELECT auth.uid())
  OR (SELECT public.is_admin())
);

CREATE POLICY "Students can submit pass requests"
ON public.pass_requests FOR INSERT
TO authenticated
WITH CHECK (
  student_id = (SELECT auth.uid())
  AND status = 'pending'
);

CREATE POLICY "Admins can update pass requests"
ON public.pass_requests FOR UPDATE
TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

-- 5. RIDES TABLE (Shift Queue & Schedule)
CREATE TABLE IF NOT EXISTS public.rides (
  id text PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_code text NOT NULL,
  student_phone text NOT NULL DEFAULT '',
  hostel text NOT NULL DEFAULT '',
  driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cart_id uuid REFERENCES public.carts(id) ON DELETE SET NULL,
  scheduled_time text NOT NULL,
  pickup text NOT NULL,
  drop_station text NOT NULL,
  route text NOT NULL,
  pickup_badge text NOT NULL DEFAULT 'PICKUP IN 5 MIN',
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'skipped')),
  is_extra_ride boolean NOT NULL DEFAULT false,
  arrived boolean NOT NULL DEFAULT false,
  student_boarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rides select policy"
ON public.rides FOR SELECT
TO authenticated
USING (
  student_id = (SELECT auth.uid())
  OR (SELECT public.is_driver())
  OR (SELECT public.is_admin())
);

CREATE POLICY "Students can request extra rides"
ON public.rides FOR INSERT
TO authenticated
WITH CHECK (
  student_id = (SELECT auth.uid())
);

CREATE POLICY "Students can skip or reactivate own rides"
ON public.rides FOR UPDATE
TO authenticated
USING (student_id = (SELECT auth.uid()))
WITH CHECK (student_id = (SELECT auth.uid()));

CREATE POLICY "Drivers and admins can update ride progress"
ON public.rides FOR UPDATE
TO authenticated
USING (
  (SELECT public.is_driver())
  OR (SELECT public.is_admin())
)
WITH CHECK (
  (SELECT public.is_driver())
  OR (SELECT public.is_admin())
);

CREATE POLICY "Admins can insert scheduled rides"
ON public.rides FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.is_admin()));

-- 6. STORAGE BUCKET FOR MEDICAL CERTIFICATES
INSERT INTO storage.buckets (id, name, public)
VALUES ('medical-certificates', 'medical-certificates', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload own medical certificate"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'medical-certificates'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

CREATE POLICY "Users can select own certificate and admins can select all"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'medical-certificates'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR (SELECT public.is_admin())
  )
);

CREATE POLICY "Users can update own certificate"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'medical-certificates'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
)
WITH CHECK (
  bucket_id = 'medical-certificates'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

-- 7. PERFORMANCE INDEXES (Supabase Best Practices)
CREATE INDEX IF NOT EXISTS idx_carts_driver ON public.carts(assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_student ON public.pass_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_status ON public.pass_requests(status);
CREATE INDEX IF NOT EXISTS idx_rides_student ON public.rides(student_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON public.rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_cart ON public.rides(cart_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON public.rides(status);

-- 8. INITIAL SEED DATA FOR CARTS & DEFAULT FLEET
INSERT INTO public.carts (cart_number, status, current_station, speed_kmh, eta_minutes, route_label)
VALUES 
  ('CART-04', 'online', 'Science Concourse Station', 14, 4, 'ROUTE 01 ACTIVE'),
  ('CART-02', 'online', 'Main Campus Gate (North)', 12, 8, 'ROUTE 02 ACTIVE'),
  ('CART-08', 'offline', 'Central Depot', 0, 0, 'STANDBY')
ON CONFLICT (cart_number) DO NOTHING;

-- 9. SECURITY HARDENING (Revoke execute on internal triggers from public)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_driver() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_driver() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
