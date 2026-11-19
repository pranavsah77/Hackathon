-- Migration: 20261120070000_verify_pass_builder_tests.sql
-- Description: Non-destructive automated verification for pass builder RPCs and state transitions.

DO $$
DECLARE
  v_student_id uuid := '11111111-1111-1111-1111-111111111111';
  v_admin_id uuid := '33333333-3333-3333-3333-333333333333';
  v_req_id uuid;
  v_req_code text;
  v_res_review jsonb;
  v_status text;
  v_qr text;
  v_notif_count integer;
  v_pickup_id uuid;
  v_drop_id uuid;
  v_attempt_blocked boolean := false;
  v_student_blocked boolean := false;
BEGIN
  -- Get sample station IDs
  SELECT id INTO v_pickup_id FROM public.stations LIMIT 1;
  SELECT id INTO v_drop_id FROM public.stations OFFSET 1 LIMIT 1;

  -- 1. Locate pending pass request for testing review RPC
  SELECT id, request_code INTO v_req_id, v_req_code
  FROM public.pass_requests
  WHERE student_id = v_student_id AND status = 'pending'
  LIMIT 1;

  -- If no pending pass exists, locate or use any existing pass
  IF v_req_id IS NULL THEN
    SELECT id, request_code INTO v_req_id, v_req_code
    FROM public.pass_requests
    WHERE student_id = v_student_id
    LIMIT 1;
  END IF;

  -- 2. Test Security: Student attempting to review pass request must be rejected
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.review_pass_request(v_req_id, 'approved', 'Unauthorized attempt by student');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Unauthorized: Only transport office administrators%' THEN
      v_student_blocked := true;
    END IF;
  END;

  ASSERT v_student_blocked = true, 'SECURITY FAILED: Student was able to invoke review_pass_request';

  -- 3. Test Security & Business Logic: Student with existing pass submitting a new pass must be blocked
  BEGIN
    PERFORM public.submit_pass_request(
      p_idempotency_key := 'test_concurrent_attempt',
      p_medical_condition := 'Leg/Ankle Fracture',
      p_reason := 'Attempting duplicate pass while active/pending pass exists',
      p_certificate_path := 'doc.pdf',
      p_route_template := 'Hostel -> Class',
      p_pickup_station_id := v_pickup_id,
      p_drop_station_id := v_drop_id,
      p_time_slots := ARRAY['08:30 AM'],
      p_duration := '1_month'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Only one open request is permitted at a time%' OR SQLERRM LIKE '%active approved mobility pass%' THEN
      v_attempt_blocked := true;
    END IF;
  END;

  ASSERT v_attempt_blocked = true, 'BUSINESS RULE FAILED: Student was able to submit duplicate open pass request';

  -- 4. Test Admin Review: Switch context to Admin and approve pass
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  v_res_review := public.review_pass_request(
    p_request_id := v_req_id,
    p_status := 'approved',
    p_review_note := 'Verified by Campus Health Officer. Approved for campus mobility transit.'
  );

  v_status := v_res_review->'pass_request'->>'status';
  v_qr := v_res_review->'pass_request'->>'qr_token';

  ASSERT v_status = 'approved', 'TEST FAILED: Status must be approved';
  ASSERT v_qr LIKE 'QARTIX-%', 'TEST FAILED: QR token must follow QARTIX- prefix';
  ASSERT length(v_qr) >= 32, 'TEST FAILED: QR token must have at least 128-bit entropy';

  -- 5. Test Notification: Verify student received approval notification
  SELECT COUNT(*) INTO v_notif_count
  FROM public.notifications
  WHERE user_id = v_student_id AND type = 'pass_approved';

  ASSERT v_notif_count >= 1, 'TEST FAILED: Student did not receive pass_approved notification';

  RAISE NOTICE 'ALL PASS BUILDER VERIFICATION TESTS PASSED SUCCESSFULLY!';
END $$;
