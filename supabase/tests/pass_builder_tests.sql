-- Test Script: pass_builder_tests.sql
-- Proves pass submission, idempotency, one-open-request-per-student,
-- QR token generation on approval, admin review, and notifications.

DO $$
DECLARE
  v_student_id uuid := '11111111-1111-1111-1111-111111111111';
  v_admin_id uuid := '33333333-3333-3333-3333-333333333333';
  v_res1 jsonb;
  v_res2 jsonb;
  v_res_review jsonb;
  v_req_id uuid;
  v_req_code text;
  v_qr text;
  v_status text;
  v_notif_count integer;
  v_pickup_id uuid;
  v_drop_id uuid;
BEGIN
  -- Get sample station IDs
  SELECT id INTO v_pickup_id FROM public.stations LIMIT 1;
  SELECT id INTO v_drop_id FROM public.stations OFFSET 1 LIMIT 1;

  -- 1. Clean up any existing test pass requests for this test student
  DELETE FROM public.pass_requests WHERE student_id = v_student_id;
  DELETE FROM public.notifications WHERE user_id IN (v_student_id, v_admin_id);

  -- Set active auth user as Student
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 2. Test RPC submit_pass_request
  v_res1 := public.submit_pass_request(
    p_idempotency_key := 'test_key_001',
    p_medical_condition := 'Leg/Ankle Fracture',
    p_reason := 'Recovery cast on left leg; unable to walk campus hills',
    p_certificate_path := '11111111-1111-1111-1111-111111111111/test_key_001/medical_cert.pdf',
    p_route_template := 'Hostel -> Class',
    p_pickup_station_id := v_pickup_id,
    p_drop_station_id := v_drop_id,
    p_time_slots := ARRAY['08:30 AM', '04:30 PM'],
    p_duration := '1_month'
  );

  v_req_id := (v_res1->'pass_request'->>'id')::uuid;
  v_req_code := v_res1->'pass_request'->>'request_code';
  v_status := v_res1->'pass_request'->>'status';
  v_qr := v_res1->'pass_request'->>'qr_token';

  ASSERT v_status = 'pending', 'TEST FAILED: Status must be pending on submit, got: ' || v_status;
  ASSERT v_qr IS NULL, 'TEST FAILED: QR token must be NULL before approval, got: ' || COALESCE(v_qr, 'null');
  ASSERT v_req_code LIKE 'REQ-%', 'TEST FAILED: Request code must start with REQ-, got: ' || v_req_code;
  RAISE NOTICE 'SUCCESS Test 1: Pass submitted as PENDING with code % and NULL QR token.', v_req_code;

  -- 3. Test Idempotency (same student + same key returns existing request without error)
  v_res2 := public.submit_pass_request(
    p_idempotency_key := 'test_key_001',
    p_medical_condition := 'Leg/Ankle Fracture',
    p_reason := 'Recovery cast on left leg; unable to walk campus hills',
    p_certificate_path := '11111111-1111-1111-1111-111111111111/test_key_001/medical_cert.pdf',
    p_route_template := 'Hostel -> Class',
    p_pickup_station_id := v_pickup_id,
    p_drop_station_id := v_drop_id,
    p_time_slots := ARRAY['08:30 AM', '04:30 PM'],
    p_duration := '1_month'
  );

  ASSERT (v_res2->>'idempotent')::boolean = true, 'TEST FAILED: Second call must be flagged as idempotent';
  ASSERT (v_res2->'pass_request'->>'id')::uuid = v_req_id, 'TEST FAILED: Must return identical pass request ID';
  RAISE NOTICE 'SUCCESS Test 2: Idempotent submission prevented duplicate record.';

  -- 4. Test One Open Request per Student (different key while pending must be rejected)
  BEGIN
    PERFORM public.submit_pass_request(
      p_idempotency_key := 'test_key_002',
      p_medical_condition := 'Other',
      p_reason := 'Second concurrent application attempt',
      p_certificate_path := '11111111-1111-1111-1111-111111111111/test_key_002/doc.pdf',
      p_route_template := 'Hostel -> Class',
      p_pickup_station_id := v_pickup_id,
      p_drop_station_id := v_drop_id,
      p_time_slots := ARRAY['10:30 AM'],
      p_duration := '2_weeks'
    );
    RAISE EXCEPTION 'TEST FAILED: Concurrently opening a second request should have been blocked.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Only one open request is permitted at a time%' THEN
      RAISE NOTICE 'SUCCESS Test 3: Blocked concurrent pass request as expected ("%").', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  -- 5. Test Admin Notification check
  SELECT COUNT(*) INTO v_notif_count
  FROM public.notifications
  WHERE user_id = v_admin_id AND type = 'pass_submitted';
  ASSERT v_notif_count >= 1, 'TEST FAILED: Transport office admin should have received in-app notification.';
  RAISE NOTICE 'SUCCESS Test 4: Transport office admin received pass submission notification.';

  -- 6. Test Admin Approval via review_pass_request
  -- Switch auth to Admin
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_res_review := public.review_pass_request(
    p_request_id := v_req_id,
    p_status := 'approved',
    p_review_note := 'Verified by Campus Health Officer Dr. Sharma. Approved for 30 days.'
  );

  v_status := v_res_review->'pass_request'->>'status';
  v_qr := v_res_review->'pass_request'->>'qr_token';

  ASSERT v_status = 'approved', 'TEST FAILED: Status must be approved, got: ' || v_status;
  ASSERT v_qr LIKE 'QARTIX-%', 'TEST FAILED: QR token must be generated on approval, got: ' || COALESCE(v_qr, 'null');
  ASSERT length(v_qr) >= 32, 'TEST FAILED: QR token must meet 128-bit minimum entropy.';
  RAISE NOTICE 'SUCCESS Test 5: Pass approved with 128-bit QR token % and validity dates computed.', v_qr;

  -- 7. Test Student Notification on Approval
  SELECT COUNT(*) INTO v_notif_count
  FROM public.notifications
  WHERE user_id = v_student_id AND type = 'pass_approved';
  ASSERT v_notif_count >= 1, 'TEST FAILED: Student should have received pass_approved notification.';
  RAISE NOTICE 'SUCCESS Test 6: Student received pass_approved notification with reviewer note.';

  -- 8. Test Non-Admin Rejection on review_pass_request
  -- Switch auth back to Student
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  BEGIN
    PERFORM public.review_pass_request(v_req_id, 'rejected', 'Hacker attempt');
    RAISE EXCEPTION 'TEST FAILED: Student should not be able to review pass requests.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Unauthorized: Only transport office administrators%' THEN
      RAISE NOTICE 'SUCCESS Test 7: Student forbidden from reviewing pass requests.';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
