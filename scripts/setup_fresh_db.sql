-- ==============================================================================
-- QARTIX TRANSIT PLATFORM: COMPLETE CONSOLIDATED FRESH DATABASE SCHEMA
-- File: scripts/setup_fresh_db.sql
-- Description: Applies the complete production schema, RLS policies, storage bucket,
--              RPCs, triggers, and demo seed data to any fresh Supabase project.
-- ==============================================================================

-- 1. EXTENSIONS
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

-- 3. PROFILES TABLE (Server-Side Role & Identity Management)
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
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. SECURITY DEFINER HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = (SELECT auth.uid()) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_driver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'driver' AND status = 'active'
  );
$$;

-- 5. CARTS & STATIONS
CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline', 'in_transit', 'maintenance')),
  current_driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  current_station text NOT NULL DEFAULT 'Science Concourse Station',
  lat double precision NOT NULL DEFAULT 12.9716,
  lng double precision NOT NULL DEFAULT 77.5946,
  speed_kmh integer NOT NULL DEFAULT 0,
  heading integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('hostel', 'gate', 'academic', 'library', 'health', 'hub')),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.student_details (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  roll_no text UNIQUE,
  hostel text,
  department text,
  residency_status text DEFAULT 'Hostler',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.student_details ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.driver_details (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  driver_code text UNIQUE,
  cart_id uuid REFERENCES public.carts(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  is_online boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_details ENABLE ROW LEVEL SECURITY;

-- 6. PASS REQUESTS & RIDES
CREATE TABLE IF NOT EXISTS public.pass_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code text UNIQUE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  medical_condition text NOT NULL,
  reason text NOT NULL,
  certificate_path text,
  route_template text NOT NULL,
  pickup_station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  drop_station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  time_slots text[] NOT NULL DEFAULT '{}',
  duration text NOT NULL DEFAULT '1_month' CHECK (duration IN ('2_weeks', '1_month', 'full_semester')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note text DEFAULT '',
  starts_on date,
  expires_on date,
  qr_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pass_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id uuid REFERENCES public.pass_requests(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cart_id uuid REFERENCES public.carts(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  pickup_station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  drop_station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  scheduled_for timestamptz NOT NULL,
  arrived_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'approaching', 'arrived', 'in_progress', 'completed', 'skipped', 'cancelled', 'requested')),
  ride_type text NOT NULL DEFAULT 'pass_schedule' CHECK (ride_type IN ('pass_schedule', 'extra')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.app_configs (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.app_configs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cart_location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed integer NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cart_location_history ENABLE ROW LEVEL SECURITY;

-- 7. STORAGE BUCKET FOR MEDICAL CERTIFICATES
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-certificates',
  'medical-certificates',
  false,
  5242880,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png'];

-- 8. CORE RLS POLICIES
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "pass_requests_select" ON public.pass_requests FOR SELECT TO authenticated
USING (student_id = auth.uid() OR public.is_admin());

CREATE POLICY "pass_requests_insert_student" ON public.pass_requests FOR INSERT TO authenticated
WITH CHECK (student_id = auth.uid() AND status = 'pending');

CREATE POLICY "rides_select" ON public.rides FOR SELECT TO authenticated
USING (student_id = auth.uid() OR driver_id = auth.uid() OR public.is_admin());

CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "audit_logs_select_admin" ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_admin());

CREATE POLICY "storage_medical_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'medical-certificates'
  AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
);

CREATE POLICY "storage_medical_upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'medical-certificates'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND array_length(regexp_split_to_array(name, '/'), 1) = 3
);

-- 9. SEED CAMPUS FLEET & STATIONS
INSERT INTO public.stations (name, type, lat, lng) VALUES
  ('Block C - Oak Hall (Hostel)', 'hostel', 12.9716, 77.5946),
  ('Block A - Pine Hall (Hostel)', 'hostel', 12.9722, 77.5950),
  ('Engineering Core (Hall 4)', 'academic', 12.9735, 77.5975),
  ('Science Concourse Station', 'academic', 12.9740, 77.5982),
  ('Main Campus Gate (North)', 'gate', 12.9705, 77.5930),
  ('Central Library Hub', 'library', 12.9728, 77.5960)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.carts (cart_number, status, current_station, speed_kmh, lat, lng) VALUES
  ('CART-04', 'online', 'Science Concourse Station', 14, 12.9716, 77.5946),
  ('CART-02', 'online', 'Main Campus Gate (North)', 12, 12.9722, 77.5950),
  ('CART-08', 'offline', 'Central Depot', 0, 12.9705, 77.5930)
ON CONFLICT (cart_number) DO NOTHING;

INSERT INTO public.app_configs (key, value, description) VALUES
  ('max_extra_rides_per_day', '{"limit": 2}'::jsonb, 'Max extra rides per student per day'),
  ('max_extra_rides_per_week', '{"limit": 5}'::jsonb, 'Max extra rides per student per week'),
  ('skip_cutoff_minutes', '{"minutes": 15}'::jsonb, 'Cutoff time to skip a ride')
ON CONFLICT (key) DO NOTHING;
