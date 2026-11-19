-- Migration: 20261120130000_qartix_medical_retention_and_security.sql
-- Description: Medical data privacy retention policy, certificate purge automation, and telemetry rate limiting.

-- 1. Rate Limiting for Telemetry Location Updates (Throttle to 1 update per 2 seconds per cart)
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
  v_last_seen timestamptz;
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

  -- Rate limit check: throttle if last update was less than 1.5 seconds ago
  SELECT last_seen_at INTO v_last_seen FROM public.carts WHERE id = v_target_cart_id;
  IF v_last_seen IS NOT NULL AND v_last_seen > (now() - interval '1.5 seconds') THEN
    -- Return current state without error to avoid client thrashing
    RETURN jsonb_build_object(
      'throttled', true,
      'cart_id', v_target_cart_id,
      'message', 'Location update throttled (max 1 request per 1.5s)'
    );
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

-- 2. Medical Data Privacy: Purge Expired Medical Certificates Function
-- Minimizes data retention by deleting medical documents N days after pass expiration (default 30 days)
CREATE OR REPLACE FUNCTION public.purge_expired_medical_records(
  p_retention_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, extensions, pg_temp
AS $$
DECLARE
  v_cutoff_date date;
  v_purged_count integer := 0;
  r RECORD;
BEGIN
  -- Security check: must be admin or service_role / cron
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: Only administrators or system maintenance can purge medical records.';
  END IF;

  v_cutoff_date := CURRENT_DATE - (GREATEST(1, p_retention_days) || ' days')::interval;

  FOR r IN
    SELECT id, request_code, student_id, certificate_path
    FROM public.pass_requests
    WHERE certificate_path IS NOT NULL
      AND (
        (status = 'expired' AND expires_on < v_cutoff_date) OR
        (status = 'rejected' AND created_at < (now() - (p_retention_days || ' days')::interval)) OR
        (status = 'approved' AND expires_on < v_cutoff_date)
      )
  LOOP
    -- Clean storage object if exists
    DELETE FROM storage.objects
    WHERE bucket_id = 'medical-certificates'
      AND (name = r.certificate_path OR name = replace(r.certificate_path, 'medical-certificates/', ''));

    -- Zero-out certificate reference in pass_requests to preserve data minimization
    UPDATE public.pass_requests
    SET certificate_path = NULL,
        updated_at = now()
    WHERE id = r.id;

    v_purged_count := v_purged_count + 1;
  END LOOP;

  -- Record audit log entry
  IF v_purged_count > 0 THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, metadata)
    VALUES (
      auth.uid(),
      'PURGE_EXPIRED_MEDICAL_RECORDS',
      'pass_requests',
      jsonb_build_object(
        'purged_count', v_purged_count,
        'retention_days', p_retention_days,
        'cutoff_date', v_cutoff_date
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'purged_count', v_purged_count,
    'cutoff_date', v_cutoff_date
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_medical_records(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_medical_records(integer) TO authenticated;

-- Schedule Daily pg_cron retention job if pg_cron is enabled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('qartix_medical_retention_purge');
    PERFORM cron.schedule(
      'qartix_medical_retention_purge',
      '15 3 * * *', -- Daily at 03:15 UTC
      'SELECT public.purge_expired_medical_records(30);'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
