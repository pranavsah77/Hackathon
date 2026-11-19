-- Migration: 20261120120000_qartix_admin_audit_completeness.sql
-- Description: Ensure all admin pass approval and rejection actions are immutably recorded in audit_logs.

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

    -- Generate random 128-bit minimum cryptographically secure token (128-bit = 16 bytes = 32 hex chars)
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

    -- Immutable audit log entry
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (
      v_admin_id,
      'admin_approve_pass_request',
      'pass_requests',
      p_request_id::text,
      jsonb_build_object(
        'request_code', v_req.request_code,
        'student_id', v_req.student_id,
        'review_note', COALESCE(p_review_note, 'Approved by Transport Office'),
        'valid_days', v_valid_days,
        'starts_on', v_starts_on,
        'expires_on', v_expires_on
      )
    );

    -- Notify student of approval
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_req.student_id,
      'pass_approved',
      'Mobility Pass Approved (' || v_req.request_code || ')',
      'Your campus mobility pass has been approved! Valid from ' || to_char(v_starts_on, 'Mon DD, YYYY') || ' to ' || to_char(v_expires_on, 'Mon DD, YYYY') || '. Authorized dispatch windows: ' || array_to_string(v_req.time_slots, ', ') || '. Note: ' || COALESCE(p_review_note, 'Approved')
    );
  ELSE
    UPDATE public.pass_requests
    SET status = 'rejected',
        reviewed_by = v_admin_id,
        review_note = COALESCE(p_review_note, 'Pass request was not approved.'),
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_updated;

    -- Immutable audit log entry
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (
      v_admin_id,
      'admin_reject_pass_request',
      'pass_requests',
      p_request_id::text,
      jsonb_build_object(
        'request_code', v_req.request_code,
        'student_id', v_req.student_id,
        'review_note', COALESCE(p_review_note, 'Pass request was not approved.')
      )
    );

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

REVOKE EXECUTE ON FUNCTION public.review_pass_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_pass_request(uuid, text, text) TO authenticated;
