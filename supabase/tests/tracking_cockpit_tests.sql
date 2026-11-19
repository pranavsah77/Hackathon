-- Test Suite: Tracking and Driver Cockpit Logic Verification
-- Verifies toggle_driver_online, mark_arrived, student_phone privacy masking,
-- update_cart_location telemetry history, and mid-trip offline guard.

DO $$
DECLARE
  v_student_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  v_driver_id uuid := 'c20fda15-e1f2-48ad-b22f-b43269924dbd'::uuid;
  v_cart_id uuid;
  v_pickup_id uuid;
  v_drop_id uuid;
  v_ride_id uuid;
  v_result jsonb;
  v_rides_rec record;
  v_history_count integer;
  v_error_caught boolean := false;
BEGIN
  -- 1. Setup Test Carts and Stations
  SELECT id INTO v_pickup_id FROM public.stations LIMIT 1;
  SELECT id INTO v_drop_id FROM public.stations OFFSET 1 LIMIT 1;

  INSERT INTO public.carts (cart_number, status, lat, lng, speed_kmh, heading)
  VALUES ('TEST-CART-COCKPIT-02', 'offline', 12.9716, 77.5946, 0, 0)
  ON CONFLICT (cart_number) DO UPDATE SET status = 'offline'
  RETURNING id INTO v_cart_id;

  INSERT INTO public.driver_details (user_id, driver_code, cart_id)
  VALUES (v_driver_id, 'DRV-TEST-COCKPIT', v_cart_id)
  ON CONFLICT (user_id) DO UPDATE SET cart_id = v_cart_id;

  -- Ensure student has a phone number
  UPDATE public.profiles SET phone = '+91 98450 12345' WHERE id = v_student_id;

  -- Impersonate driver
  PERFORM set_config('request.jwt.claim.sub', v_driver_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- TEST 1: Driver goes online
  v_result := public.toggle_driver_online(true);
  IF (v_result->>'success')::boolean IS NOT TRUE OR (v_result->>'is_online')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 1 FAILED: toggle_driver_online(true) returned %', v_result;
  END IF;

  -- Verify cart became online
  IF NOT EXISTS (SELECT 1 FROM public.carts WHERE id = v_cart_id AND status = 'online' AND current_driver_id = v_driver_id) THEN
    RAISE EXCEPTION 'TEST 1 FAILED: cart status not updated to online';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: Driver online toggle works.';

  -- TEST 2: Update Cart Location Telemetry & Location History Ping
  v_result := public.update_cart_location(12.9750, 77.5990, 18, 90, v_cart_id);
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 2 FAILED: update_cart_location returned %', v_result;
  END IF;

  SELECT count(*) INTO v_history_count 
  FROM public.cart_location_history 
  WHERE cart_id = v_cart_id AND speed = 18;

  IF v_history_count < 1 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: telemetry ping not written to cart_location_history';
  END IF;
  RAISE NOTICE 'TEST 2 PASSED: Cart telemetry and location history logging works.';

  -- TEST 3: Create a ride scheduled for today assigned to this driver/cart
  INSERT INTO public.rides (
    student_id, cart_id, driver_id, pickup_station_id, drop_station_id,
    ride_type, scheduled_for, status, eta_minutes
  )
  VALUES (
    v_student_id, v_cart_id, v_driver_id, v_pickup_id, v_drop_id,
    'scheduled', now() + interval '10 minutes', 'scheduled', 5
  )
  RETURNING id INTO v_ride_id;

  -- Test privacy masking in get_driver_assigned_rides while scheduled
  SELECT * INTO v_rides_rec FROM public.get_driver_assigned_rides() WHERE ride_id = v_ride_id;
  IF v_rides_rec.student_phone IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 3 FAILED: student phone was NOT masked for scheduled ride (got %)', v_rides_rec.student_phone;
  END IF;
  RAISE NOTICE 'TEST 3 PASSED: Student phone is correctly masked while ride is scheduled.';

  -- TEST 4: Mark Arrived RPC
  -- Transition ride: scheduled -> approaching -> arrived
  UPDATE public.rides SET status = 'approaching' WHERE id = v_ride_id;
  v_result := public.mark_arrived(v_ride_id);
  IF (v_result->>'success')::boolean IS NOT TRUE OR (v_result->>'status') <> 'arrived' THEN
    RAISE EXCEPTION 'TEST 4 FAILED: mark_arrived returned %', v_result;
  END IF;

  -- Verify student phone is now UNMASKED for the active ride
  SELECT * INTO v_rides_rec FROM public.get_driver_assigned_rides() WHERE ride_id = v_ride_id;
  IF v_rides_rec.student_phone IS NULL THEN
    RAISE EXCEPTION 'TEST 4 FAILED: student phone should be visible during active/arrived ride, but got NULL';
  END IF;

  -- Verify notification was created for student
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications 
    WHERE user_id = v_student_id AND type = 'cart_arrived' AND (metadata->>'ride_id')::uuid = v_ride_id
  ) THEN
    RAISE EXCEPTION 'TEST 4 FAILED: student notification cart_arrived was not created';
  END IF;
  RAISE NOTICE 'TEST 4 PASSED: mark_arrived sets status, student notification, and unmasks phone for active ride.';

  -- TEST 5: Guard against going offline mid-trip
  v_error_caught := false;
  BEGIN
    PERFORM public.toggle_driver_online(false);
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
    RAISE NOTICE 'Caught expected offline block during active trip: %', SQLERRM;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'TEST 5 FAILED: driver was allowed to go offline while ride was arrived/in_progress!';
  END IF;
  RAISE NOTICE 'TEST 5 PASSED: Going offline mid-trip is strictly blocked.';

  -- TEST 6: Complete the ride and then verify going offline succeeds
  v_result := public.update_driver_ride_status(v_ride_id, 'in_progress');
  v_result := public.update_driver_ride_status(v_ride_id, 'completed');

  v_result := public.toggle_driver_online(false);
  IF (v_result->>'success')::boolean IS NOT TRUE OR (v_result->>'is_online')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST 6 FAILED: toggle_driver_online(false) failed after completing ride: %', v_result;
  END IF;
  RAISE NOTICE 'TEST 6 PASSED: Driver successfully toggles offline after ride completion.';

  -- TEST 7: Prune Telemetry History (as internal / service_role)
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.prune_cart_location_history(7);
  RAISE NOTICE 'TEST 7 PASSED: Telemetry history retention prune executed smoothly.';

  RAISE NOTICE 'ALL 7 TESTS PASSED SUCCESSFULLY!';
END;
$$;
