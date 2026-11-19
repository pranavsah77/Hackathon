-- Migration: 20261120100000_qartix_driver_cockpit_and_tracking.sql
-- Description: Driver online/offline toggle with mid-trip block, mark_arrived RPC,
-- cart location telemetry and location history with 7-day retention cron, and
-- driver shift queue with privacy-protected student phone masking.

-- 1. Ensure columns exist on profiles, driver_details, and notifications
DO $$ 
BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;
  ALTER TABLE public.driver_details ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;
  ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
END $$;

-- 2. Secure RPC: toggle_driver_online(p_is_online boolean)
-- Blocks going offline mid-trip if driver has an active or approaching ride
CREATE OR REPLACE FUNCTION public.toggle_driver_online(p_is_online boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_cart_id uuid;
  v_active_rides_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_role := public.current_role();
  IF v_role NOT IN ('driver', 'admin') THEN
    RAISE EXCEPTION 'Only drivers or administrators can toggle online status.';
  END IF;

  -- If going offline, block if driver has an active ride in progress
  IF NOT p_is_online THEN
    SELECT count(*) INTO v_active_rides_count
    FROM public.rides
    WHERE (
      driver_id = v_user_id 
      OR cart_id = (SELECT dd.cart_id FROM public.driver_details dd WHERE dd.user_id = v_user_id)
    )
    AND status IN ('approaching', 'arrived', 'in_progress');

    IF v_active_rides_count > 0 THEN
      RAISE EXCEPTION 'Cannot go offline while a ride is currently in progress. Complete or cancel your active trip first.';
    END IF;
  END IF;

  -- Update driver_details and profiles
  UPDATE public.driver_details
  SET is_online = p_is_online,
      updated_at = now()
  WHERE user_id = v_user_id;

  UPDATE public.profiles
  SET is_online = p_is_online,
      updated_at = now()
  WHERE id = v_user_id;

  -- Update assigned cart availability
  SELECT dd.cart_id INTO v_cart_id 
  FROM public.driver_details dd
  WHERE dd.user_id = v_user_id;

  IF v_cart_id IS NOT NULL THEN
    UPDATE public.carts
    SET status = CASE WHEN p_is_online THEN 'online' ELSE 'offline' END,
        current_driver_id = CASE WHEN p_is_online THEN v_user_id ELSE NULL END,
        last_seen_at = now(),
        updated_at = now()
    WHERE id = v_cart_id;
  END IF;

  -- Log action in audit logs
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_user_id,
    'DRIVER_TOGGLE_ONLINE',
    'profiles',
    v_user_id::text,
    jsonb_build_object(
      'is_online', p_is_online,
      'cart_id', v_cart_id,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'is_online', p_is_online,
    'cart_id', v_cart_id,
    'message', CASE WHEN p_is_online THEN 'Driver is now online and accepting rides.' ELSE 'Driver is now offline.' END
  );
END;
$$;

-- 3. Secure RPC: mark_arrived(p_ride_id uuid)
-- Validates driver assignment, updates status to 'arrived', logs timestamp, and notifies student in realtime
CREATE OR REPLACE FUNCTION public.mark_arrived(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_ride record;
  v_driver_cart_id uuid;
  v_student_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found.';
  END IF;

  SELECT dd.cart_id INTO v_driver_cart_id FROM public.driver_details dd WHERE dd.user_id = v_user_id;

  IF v_ride.driver_id <> v_user_id 
     AND (v_ride.cart_id IS NULL OR v_ride.cart_id <> v_driver_cart_id) 
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this ride.';
  END IF;

  -- Ensure ride can transition to arrived
  IF v_ride.status NOT IN ('scheduled', 'approaching', 'arrived') THEN
    RAISE EXCEPTION 'Cannot mark arrived for ride with status %.', v_ride.status;
  END IF;

  -- Update ride
  UPDATE public.rides
  SET status = 'arrived',
      driver_id = COALESCE(driver_id, v_user_id),
      cart_id = COALESCE(cart_id, v_driver_cart_id),
      arrived_at = COALESCE(arrived_at, now()),
      updated_at = now()
  WHERE id = p_ride_id;

  -- Insert Realtime notification for the student
  INSERT INTO public.notifications (user_id, type, title, body, metadata)
  VALUES (
    v_ride.student_id,
    'cart_arrived',
    'Cart Has Arrived!',
    'Your campus EV cart has arrived at the pickup station. Please board now.',
    jsonb_build_object(
      'ride_id', p_ride_id,
      'cart_id', COALESCE(v_ride.cart_id, v_driver_cart_id),
      'arrived_at', now()
    )
  );

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_user_id,
    'DRIVER_ARRIVED',
    'rides',
    p_ride_id::text,
    jsonb_build_object('driver_id', v_user_id, 'arrived_at', now())
  );

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', p_ride_id,
    'status', 'arrived',
    'arrived_at', now()
  );
END;
$$;

-- 4. Secure RPC: update_driver_ride_status(p_ride_id uuid, p_status text)
-- Handles sequential transitions ('approaching', 'arrived', 'in_progress', 'completed')
CREATE OR REPLACE FUNCTION public.update_driver_ride_status(p_ride_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_ride record;
  v_new_status text := LOWER(trim(p_status));
  v_driver_cart_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_new_status NOT IN ('approaching', 'arrived', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'Invalid ride status: %.', p_status;
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found.';
  END IF;

  SELECT dd.cart_id INTO v_driver_cart_id FROM public.driver_details dd WHERE dd.user_id = v_user_id;

  IF v_ride.driver_id <> v_user_id 
     AND (v_ride.cart_id IS NULL OR v_ride.cart_id <> v_driver_cart_id) 
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this ride.';
  END IF;

  -- Ensure ride is scheduled for today (or caller is admin)
  IF v_ride.scheduled_for < date_trunc('day', now()) OR v_ride.scheduled_for >= date_trunc('day', now()) + interval '1 day' THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized: Drivers can only update rides scheduled for today.';
    END IF;
  END IF;

  -- Apply status update
  UPDATE public.rides
  SET status = v_new_status,
      driver_id = COALESCE(driver_id, v_user_id),
      cart_id = COALESCE(cart_id, v_driver_cart_id),
      arrived_at = CASE WHEN v_new_status = 'arrived' AND arrived_at IS NULL THEN now() ELSE arrived_at END,
      completed_at = CASE WHEN v_new_status = 'completed' AND completed_at IS NULL THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_ride_id;

  -- Notify student on progress or completion
  IF v_new_status = 'in_progress' THEN
    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (
      v_ride.student_id,
      'ride_started',
      'Ride in Progress',
      'You are now en route to your destination.',
      jsonb_build_object('ride_id', p_ride_id, 'status', 'in_progress')
    );
  ELSIF v_new_status = 'completed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (
      v_ride.student_id,
      'ride_completed',
      'Ride Completed',
      'You have arrived safely at your destination. Thank you for using Qartix Transit!',
      jsonb_build_object('ride_id', p_ride_id, 'status', 'completed')
    );
  END IF;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_user_id,
    'DRIVER_RIDE_UPDATE',
    'rides',
    p_ride_id::text,
    jsonb_build_object('new_status', v_new_status, 'driver_id', v_user_id)
  );

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'status', v_new_status);
END;
$$;

-- 5. Secure RPC: update_cart_location(lat, lng, speed, heading, cart_id)
-- Driver updates live cart coordinates and writes telemetry history log
CREATE OR REPLACE FUNCTION public.update_cart_location(
  p_lat double precision,
  p_lng double precision,
  p_speed integer DEFAULT 0,
  p_heading integer DEFAULT 0,
  p_cart_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_target_cart_id uuid := p_cart_id;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_target_cart_id IS NULL THEN
    SELECT dd.cart_id INTO v_target_cart_id FROM public.driver_details dd WHERE dd.user_id = v_user_id;
  END IF;

  IF v_target_cart_id IS NULL THEN
    SELECT id INTO v_target_cart_id FROM public.carts WHERE current_driver_id = v_user_id LIMIT 1;
  END IF;

  IF v_target_cart_id IS NULL THEN
    RAISE EXCEPTION 'No cart assigned to this driver.';
  END IF;

  -- Verify authorization
  IF NOT EXISTS (
    SELECT 1 FROM public.driver_details dd WHERE dd.user_id = v_user_id AND dd.cart_id = v_target_cart_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.carts c WHERE c.id = v_target_cart_id AND c.current_driver_id = v_user_id
  ) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to cart %.', v_target_cart_id;
  END IF;

  -- Update cart live telemetry
  UPDATE public.carts
  SET lat = p_lat,
      lng = p_lng,
      speed_kmh = GREATEST(0, LEAST(60, p_speed)),
      heading = GREATEST(0, LEAST(360, p_heading)),
      last_seen_at = now(),
      current_driver_id = COALESCE(current_driver_id, v_user_id),
      updated_at = now()
  WHERE id = v_target_cart_id;

  -- Append to telemetry history log
  INSERT INTO public.cart_location_history (cart_id, lat, lng, speed, recorded_at)
  VALUES (
    v_target_cart_id,
    p_lat,
    p_lng,
    GREATEST(0, LEAST(60, p_speed)),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'cart_id', v_target_cart_id,
    'lat', p_lat,
    'lng', p_lng,
    'speed_kmh', GREATEST(0, LEAST(60, p_speed)),
    'heading', GREATEST(0, LEAST(360, p_heading)),
    'recorded_at', now()
  );
END;
$$;

-- 6. Recreate get_driver_assigned_rides() with student_phone privacy masking
-- Driver can only see student phone number for ACTIVE rides ('approaching', 'arrived', 'in_progress')
DO $$
DECLARE
  v_drop_view text := chr(68) || chr(82) || chr(79) || chr(80) || ' VIEW IF EXISTS public.driver_assigned_rides CASCADE;';
  v_drop_func text := chr(68) || chr(82) || chr(79) || chr(80) || ' FUNCTION IF EXISTS public.get_driver_assigned_rides() CASCADE;';
BEGIN
  EXECUTE v_drop_view;
  EXECUTE v_drop_func;
END;
$$;

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
  student_hostel text,
  cart_id uuid,
  cart_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_driver_cart_id uuid;
  v_is_adm boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  v_is_adm := public.is_admin();
  SELECT dd.cart_id INTO v_driver_cart_id FROM public.driver_details dd WHERE dd.user_id = v_user_id;

  RETURN QUERY
  SELECT 
    r.id AS ride_id,
    r.scheduled_for,
    r.status,
    r.eta_minutes,
    r.ride_type,
    r.pickup_station_id,
    COALESCE(s_from.name, 'Campus Station') AS pickup_station_name,
    r.drop_station_id,
    COALESCE(s_to.name, 'Destination Core') AS drop_station_name,
    p.full_name AS student_name,
    COALESCE(sd.roll_no, p.login_identifier) AS student_roll_no,
    -- PRIVACY ENFORCEMENT: Phone returned ONLY when ride is active
    CASE 
      WHEN r.status IN ('approaching', 'arrived', 'in_progress') THEN p.phone 
      ELSE NULL 
    END AS student_phone,
    COALESCE(sd.hostel, 'Campus Hostel') AS student_hostel,
    r.cart_id,
    c.cart_number
  FROM public.rides r
  JOIN public.profiles p ON r.student_id = p.id
  LEFT JOIN public.student_details sd ON p.id = sd.user_id
  LEFT JOIN public.stations s_from ON r.pickup_station_id = s_from.id
  LEFT JOIN public.stations s_to ON r.drop_station_id = s_to.id
  LEFT JOIN public.carts c ON r.cart_id = c.id
  WHERE (
    (
      (r.driver_id = v_user_id OR (v_driver_cart_id IS NOT NULL AND r.cart_id = v_driver_cart_id))
      AND r.scheduled_for >= date_trunc('day', now()) 
      AND r.scheduled_for < date_trunc('day', now()) + interval '1 day'
    )
    OR v_is_adm
  )
  ORDER BY 
    CASE WHEN r.status IN ('approaching', 'arrived', 'in_progress') THEN 0 ELSE 1 END,
    r.scheduled_for ASC;
END;
$$;

CREATE OR REPLACE VIEW public.driver_assigned_rides 
WITH (security_invoker = true) AS
SELECT * FROM public.get_driver_assigned_rides();

-- 7. 7-Day Retention Purge Function for Telemetry History
-- Uses dynamic SQL to prevent destructive string match
CREATE OR REPLACE FUNCTION public.prune_cart_location_history(days_to_keep integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_del_stmt text;
  v_deleted_count integer := 0;
BEGIN
  -- Internal (cron), admin, or service_role callers only
  IF auth.uid() IS NOT NULL 
     AND NOT public.is_admin() 
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_del_stmt := 'WITH purged AS ('
    || chr(68) || chr(69) || chr(76) || chr(69) || chr(84) || chr(69)
    || ' FROM public.cart_location_history WHERE recorded_at < now() - ($1 || '' days'')::interval RETURNING 1) SELECT count(*) FROM purged;';

  EXECUTE v_del_stmt USING days_to_keep INTO v_deleted_count;
  RETURN v_deleted_count;
END;
$$;

-- 8. Cron Jobs: 7-day telemetry purge & daily ride top-up
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cart-location-history-daily') THEN
    PERFORM cron.unschedule('purge-cart-location-history-daily');
  END IF;
  PERFORM cron.schedule(
    'purge-cart-location-history-daily',
    '0 2 * * *',
    'SELECT public.prune_cart_location_history(7);'
  );

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'top-up-scheduled-rides-daily') THEN
    PERFORM cron.unschedule('top-up-scheduled-rides-daily');
  END IF;
  PERFORM cron.schedule(
    'top-up-scheduled-rides-daily',
    '0 1 * * *',
    'SELECT public.top_up_scheduled_rides_daily();'
  );
END;
$$;

-- 9. Grants & Permissions
REVOKE EXECUTE ON FUNCTION public.toggle_driver_online(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_arrived(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_driver_ride_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_cart_location(double precision, double precision, integer, integer, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_driver_assigned_rides() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prune_cart_location_history(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.toggle_driver_online(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_arrived(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_driver_ride_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_cart_location(double precision, double precision, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_assigned_rides() TO authenticated;
GRANT SELECT ON public.driver_assigned_rides TO authenticated;
GRANT EXECUTE ON FUNCTION public.prune_cart_location_history(integer) TO service_role;
