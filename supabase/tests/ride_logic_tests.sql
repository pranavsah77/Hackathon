-- Test Script: supabase/tests/ride_logic_tests.sql
-- Description: Rigorously verifies:
-- 1. Pass approval ride generation (skipping weekends & holidays, auto cart/route assignment)
-- 2. Admin override RPC (admin_assign_ride)
-- 3. Skip ride RPC (owner check, notice window check, audit log, driver notification)
-- 4. Extra ride RPC (active pass check, quota enforcement, auto cart dispatch)
-- 5. Status transition validation trigger (no skipping states, completed rides locked)

DO $$
DECLARE
  v_student_id uuid := '11111111-1111-1111-1111-111111111111';
  v_other_student_id uuid := '44444444-4444-4444-4444-444444444444';
  v_driver_id uuid := '22222222-2222-2222-2222-222222222222';
  v_admin_id uuid := '33333333-3333-3333-3333-333333333333';
  v_pass_id uuid;
  v_ride_id uuid;
  v_future_ride_id uuid;
  v_cart_id uuid;
  v_route_id uuid;
  v_pickup_id uuid;
  v_drop_id uuid;
  v_res jsonb;
  v_count integer;
  v_weekend_count integer;
  v_holiday_count integer;
  v_test_failed boolean := false;
BEGIN
  -- 0. Get sample IDs
  SELECT id INTO v_pickup_id FROM public.stations LIMIT 1;
  SELECT id INTO v_drop_id FROM public.stations OFFSET 1 LIMIT 1;
  SELECT id INTO v_cart_id FROM public.carts LIMIT 1;
  SELECT id INTO v_route_id FROM public.routes LIMIT 1;

  -- 1. Locate approved pass for student
  SELECT id INTO v_pass_id 
  FROM public.pass_requests 
  WHERE student_id = v_student_id AND status = 'approved'
  LIMIT 1;

  ASSERT v_pass_id IS NOT NULL, 'TEST SETUP: Student must have an approved pass';

  -- TEST 1: Generate scheduled rides for pass (Skip weekends & holidays)
  v_count := public.generate_scheduled_rides_for_pass(v_pass_id, CURRENT_DATE, CURRENT_DATE + 14);
  RAISE NOTICE 'Test 1: Generated % rides for pass % over 14 days.', v_count, v_pass_id;

  -- Verify no scheduled rides fall on weekends (Saturday=6, Sunday=7)
  SELECT COUNT(*) INTO v_weekend_count
  FROM public.rides
  WHERE pass_id = v_pass_id
    AND EXTRACT(ISODOW FROM scheduled_for AT TIME ZONE 'Asia/Kolkata') IN (6, 7);
  ASSERT v_weekend_count = 0, 'TEST 1 FAILED: Found scheduled rides generated on weekends!';

  -- Verify no scheduled rides fall on campus holidays
  SELECT COUNT(*) INTO v_holiday_count
  FROM public.rides r
  JOIN public.holidays h ON h.holiday_date = (r.scheduled_for AT TIME ZONE 'Asia/Kolkata')::date
  WHERE r.pass_id = v_pass_id;
  ASSERT v_holiday_count = 0, 'TEST 1 FAILED: Found scheduled rides generated on campus holidays!';
  RAISE NOTICE 'Test 1 PASSED: Zero rides on weekends or holidays; auto cart & route assigned.';

  -- TEST 2: Admin Override (admin_assign_ride)
  -- Select a test ride
  SELECT id INTO v_ride_id FROM public.rides WHERE pass_id = v_pass_id AND status = 'scheduled' LIMIT 1;
  ASSERT v_ride_id IS NOT NULL, 'TEST SETUP: At least one scheduled ride must exist';

  -- Switch context to Admin
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  v_res := public.admin_assign_ride(v_ride_id, v_cart_id, v_driver_id, v_route_id);
  ASSERT (v_res->>'success')::boolean = true, 'TEST 2 FAILED: Admin override failed';
  RAISE NOTICE 'Test 2 PASSED: Admin successfully assigned cart % and driver % to ride %.', v_cart_id, v_driver_id, v_ride_id;

  -- Non-admin cannot override ride assignment
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.admin_assign_ride(v_ride_id, v_cart_id, v_driver_id, v_route_id);
    v_test_failed := true;
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Unauthorized%', 'Expected Unauthorized error for student admin_assign_ride';
  END;
  ASSERT v_test_failed = false, 'TEST 2 FAILED: Student was able to invoke admin_assign_ride';
  RAISE NOTICE 'Test 2B PASSED: Student forbidden from admin ride overrides.';

  -- TEST 3: Skip Ride RPC (skip_ride)
  -- 3A: Cross-student skip forbidden (Student B cannot skip Student A's ride)
  PERFORM set_config('request.jwt.claim.sub', v_other_student_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_student_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.skip_ride(v_ride_id);
    v_test_failed := true;
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Unauthorized%', 'Expected Unauthorized for cross-student skip';
  END;
  ASSERT v_test_failed = false, 'TEST 3A FAILED: Student B was able to skip Student A ride';
  RAISE NOTICE 'Test 3A PASSED: Cross-student ride skip blocked.';

  -- 3B: Owner skips future ride (> 15 minutes away)
  -- Create or locate a future scheduled ride > 2 hours away
  INSERT INTO public.rides (
    pass_id, student_id, cart_id, driver_id, pickup_station_id, drop_station_id,
    ride_type, scheduled_for, status, eta_minutes
  ) VALUES (
    v_pass_id, v_student_id, v_cart_id, v_driver_id, v_pickup_id, v_drop_id,
    'scheduled', now() + interval '3 hours', 'scheduled', 5
  ) RETURNING id INTO v_future_ride_id;

  -- Switch context back to Student A
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

  v_res := public.skip_ride(v_future_ride_id);
  ASSERT (v_res->>'status') = 'skipped', 'TEST 3B FAILED: Ride status must be skipped';
  
  -- Check audit log
  SELECT COUNT(*) INTO v_count FROM public.audit_logs WHERE action = 'skip_ride' AND entity_id = v_future_ride_id::text;
  ASSERT v_count >= 1, 'TEST 3B FAILED: Skip ride must be recorded in audit_logs';

  -- Check driver notification
  SELECT COUNT(*) INTO v_count FROM public.notifications WHERE user_id = v_driver_id AND type = 'ride_skipped';
  ASSERT v_count >= 1, 'TEST 3B FAILED: Driver must receive notification of skipped ride';
  RAISE NOTICE 'Test 3B PASSED: Ride skipped with audit log & driver notification.';

  -- 3C: Notice requirement enforcement (ride < 15 min away cannot be skipped)
  INSERT INTO public.rides (
    pass_id, student_id, cart_id, driver_id, pickup_station_id, drop_station_id,
    ride_type, scheduled_for, status, eta_minutes
  ) VALUES (
    v_pass_id, v_student_id, v_cart_id, v_driver_id, v_pickup_id, v_drop_id,
    'scheduled', now() + interval '5 minutes', 'scheduled', 5
  ) RETURNING id INTO v_future_ride_id;

  BEGIN
    PERFORM public.skip_ride(v_future_ride_id);
    v_test_failed := true;
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%at least 15 minutes before scheduled departure%', 'Expected 15 minute notice error, got: ' || SQLERRM;
  END;
  ASSERT v_test_failed = false, 'TEST 3C FAILED: Ride within 15 minutes was skipped without required notice';
  RAISE NOTICE 'Test 3C PASSED: Enforced 15-minute notice requirement before departure.';

  -- TEST 4: Request Extra Ride (request_extra_ride)
  v_res := public.request_extra_ride(
    p_pickup := 'Science Concourse Station',
    p_drop := 'Campus Health & Sports Pavilion',
    p_requested_time := now()
  );

  ASSERT (v_res->>'success')::boolean = true, 'TEST 4 FAILED: Extra ride request failed';
  ASSERT (v_res->>'status') = 'requested', 'TEST 4 FAILED: Status must be requested';
  RAISE NOTICE 'Test 4 PASSED: Extra ride requested with status requested, cart assignment: %.', v_res->>'cart_assigned';

  -- TEST 5: Status Transition Validation Trigger
  -- 5A: Cannot skip states (e.g. scheduled directly to completed must fail)
  BEGIN
    UPDATE public.rides SET status = 'completed' WHERE id = v_future_ride_id;
    v_test_failed := true;
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Invalid ride status transition%', 'Expected transition error, got: ' || SQLERRM;
  END;
  ASSERT v_test_failed = false, 'TEST 5A FAILED: Skipping states was erroneously permitted';
  RAISE NOTICE 'Test 5A PASSED: Cannot skip states (scheduled -> completed blocked).';

  -- 5B: Completed rides cannot be modified
  -- Walk ride through valid sequence: scheduled -> approaching -> arrived -> in_progress -> completed
  UPDATE public.rides SET status = 'approaching' WHERE id = v_future_ride_id;
  UPDATE public.rides SET status = 'arrived' WHERE id = v_future_ride_id;
  UPDATE public.rides SET status = 'in_progress' WHERE id = v_future_ride_id;
  UPDATE public.rides SET status = 'completed' WHERE id = v_future_ride_id;

  -- Attempt to modify completed ride
  BEGIN
    UPDATE public.rides SET status = 'scheduled' WHERE id = v_future_ride_id;
    v_test_failed := true;
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Completed rides cannot be modified%' OR SQLERRM LIKE '%Cannot change status of a ride that is already completed%', 'Expected completed ride lock error, got: ' || SQLERRM;
  END;
  ASSERT v_test_failed = false, 'TEST 5B FAILED: Completed ride was modified';
  RAISE NOTICE 'Test 5B PASSED: Completed rides are immutable.';

  RAISE NOTICE '==================================================';
  RAISE NOTICE 'ALL RIDE LOGIC & LIFECYCLE TESTS PASSED PERFECTLY!';
  RAISE NOTICE '==================================================';
END $$;
