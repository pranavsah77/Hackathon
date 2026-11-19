-- Migration: 20261120050000_qartix_monthly_pass_builder_rpc.sql
-- Description: Implement pass request submission RPC, review RPC, QR token generation on approval,
-- one-open-request-per-student constraint, idempotency, admin/student notifications, and daily expiry cron.

-- 1. Ensure pg_cron is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Modify qr_token column on pass_requests so it is NULL while pending
ALTER TABLE public.pass_requests ALTER COLUMN qr_token DROP NOT NULL;
ALTER TABLE public.pass_requests ALTER COLUMN qr_token DROP DEFAULT;

-- Drop existing unique constraint if present and create partial unique index
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'pass_requests_qr_token_key' 
      AND conrelid = 'public.pass_requests'::regclass
  ) THEN
    ALTER TABLE public.pass_requests DROP CONSTRAINT pass_requests_qr_token_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pass_requests_qr_token_unique 
ON public.pass_requests(qr_token) 
WHERE qr_token IS NOT NULL;

-- 3. Add idempotency_key to pass_requests
ALTER TABLE public.pass_requests ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pass_requests_idempotency_unique 
ON public.pass_requests(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 4. RPC: submit_pass_request
-- Inserts a pass request in one transaction with status 'pending'
-- Enforces one open request per student and idempotency
CREATE OR REPLACE FUNCTION public.submit_pass_request(
  p_idempotency_key text,
  p_medical_condition text,
  p_reason text,
  p_certificate_path text,
  p_route_template text,
  p_pickup_station_id uuid,
  p_drop_station_id uuid,
  p_time_slots text[],
  p_duration text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id uuid;
  v_student_name text;
  v_student_ident text;
  v_existing_id uuid;
  v_existing_code text;
  v_existing_status text;
  v_request_code text;
  v_clean_condition text;
  v_clean_duration text;
  v_new_request public.pass_requests;
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit a pass request.';
  END IF;

  -- Verify user is a student or rider
  SELECT full_name, login_identifier INTO v_student_name, v_student_ident
  FROM public.profiles
  WHERE id = v_student_id;

  v_student_name := COALESCE(v_student_name, 'Campus Student');
  v_student_ident := COALESCE(v_student_ident, 'STUDENT');

  -- Idempotency check: if request with this idempotency key already exists for this student, return it
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_new_request
    FROM public.pass_requests
    WHERE student_id = v_student_id AND idempotency_key = p_idempotency_key;

    IF v_new_request.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'pass_request', row_to_json(v_new_request)
      );
    END IF;
  END IF;

  -- One open request per student check
  SELECT id, request_code, status 
  INTO v_existing_id, v_existing_code, v_existing_status
  FROM public.pass_requests
  WHERE student_id = v_student_id
    AND status IN ('pending', 'approved')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'pending' THEN
      RAISE EXCEPTION 'You already have an active pending request (%) awaiting transport office review. Only one open request is permitted at a time.', v_existing_code;
    ELSIF v_existing_status = 'approved' THEN
      -- Check if it is currently not expired
      IF EXISTS (
        SELECT 1 FROM public.pass_requests 
        WHERE id = v_existing_id AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
      ) THEN
        RAISE EXCEPTION 'You already have an active approved mobility pass (%). New requests can only be filed once your active pass expires.', v_existing_code;
      END IF;
    END IF;
  END IF;

  -- Sanitize condition
  v_clean_condition := CASE 
    WHEN p_medical_condition IN ('Leg/Ankle Fracture', 'Ligament Tear / Sprain', 'Post-Surgery Recovery', 'Chronic Mobility Condition') 
    THEN p_medical_condition 
    ELSE 'Other' 
  END;

  -- Sanitize duration
  v_clean_duration := CASE 
    WHEN p_duration IN ('14d', '2_weeks', '14 days', '2 Weeks (14 Days)') THEN '2_weeks'
    WHEN p_duration IN ('sem', 'full_semester', '120 days', 'Full Semester (120 Days)') THEN 'full_semester'
    ELSE '1_month'
  END;

  -- Generate unique request_code e.g. REQ-8492
  LOOP
    v_request_code := 'REQ-' || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.pass_requests WHERE request_code = v_request_code);
  END LOOP;

  -- Insert pass request with status 'pending' and NULL qr_token
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
    qr_token,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    v_request_code,
    v_student_id,
    v_clean_condition,
    trim(COALESCE(p_reason, 'Campus medical mobility request')),
    p_certificate_path,
    COALESCE(p_route_template, 'Hostel -> Class'),
    p_pickup_station_id,
    p_drop_station_id,
    COALESCE(p_time_slots, ARRAY['08:30 AM', '04:30 PM']),
    v_clean_duration,
    'pending',
    NULL,
    p_idempotency_key,
    now(),
    now()
  )
  RETURNING * INTO v_new_request;

  -- Notify transport office admins in-app
  INSERT INTO public.notifications (user_id, type, title, body)
  SELECT 
    id,
    'pass_submitted',
    'New Mobility Pass Request ' || v_request_code,
    v_student_name || ' (' || v_student_ident || ') submitted a mobility pass request for ' || v_clean_condition || '.'
  FROM public.profiles
  WHERE role = 'admin';

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'pass_request', row_to_json(v_new_request)
  );
END;
$$;

-- 5. RPC: review_pass_request (Admin Approval / Rejection)
CREATE OR REPLACE FUNCTION public.review_pass_request(
  p_request_id uuid,
  p_status text,
  p_review_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_req public.pass_requests;
  v_valid_days integer;
  v_starts_on date;
  v_expires_on date;
  v_qr_token text;
  v_updated public.pass_requests;
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

    -- Generate random 128-bit minimum cryptographically secure token (16 bytes = 128 bits)
    v_qr_token := 'QARTIX-' || encode(gen_random_bytes(16), 'hex') || '-' || to_char(v_expires_on, 'YYYYMMDD');

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

    -- Notify student of approval
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_req.student_id,
      'pass_approved',
      'Mobility Pass Approved (' || v_req.request_code || ')',
      'Your campus mobility pass has been approved! Valid from ' || to_char(v_starts_on, 'Mon DD, YYYY') || ' to ' || to_char(v_expires_on, 'Mon DD, YYYY') || '. Authorized dispatch windows: ' || array_to_string(v_req.time_slots, ', ') || '. Note: ' || COALESCE(p_review_note, 'Approved')
    );

  ELSE
    -- Rejected
    UPDATE public.pass_requests
    SET status = 'rejected',
        reviewed_by = v_admin_id,
        review_note = COALESCE(p_review_note, 'Application did not meet verification criteria'),
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_updated;

    -- Notify student of rejection
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
    'pass_request', row_to_json(v_updated)
  );
END;
$$;

-- 6. Permissions for RPCs
REVOKE EXECUTE ON FUNCTION public.submit_pass_request FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_pass_request TO authenticated;

REVOKE EXECUTE ON FUNCTION public.review_pass_request FROM anon;
GRANT EXECUTE ON FUNCTION public.review_pass_request TO authenticated;

-- 7. Daily cron schedule for marking expired passes
DO $$
BEGIN
  PERFORM cron.unschedule('mark-expired-passes-daily') 
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mark-expired-passes-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'mark-expired-passes-daily',
  '0 0 * * *',
  $$UPDATE public.pass_requests SET status = 'expired', updated_at = now() WHERE status = 'approved' AND expires_on < CURRENT_DATE$$
);
