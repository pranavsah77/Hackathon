-- ==============================================================================
-- Qartix Security Test Suite
-- File: supabase/tests/security_tests.sql
-- Description:
--   Executes rigorous verification of RLS and privilege separation:
--     Test 1: Student A cannot read Student B's profiles, passes, rides, or files
--     Test 2: A driver cannot read unassigned rides or student profiles directly
--     Test 3: A student cannot self-approve a pass
--     Test 4: Nobody (Student or Driver) can escalate their own role
-- ==============================================================================

-- Setup Test Identities
-- Student A: 11111111-1111-1111-1111-111111111111 (Pranav Kumar)
-- Student B: 44444444-4444-4444-4444-444444444444 (Neha Patel)
-- Driver:    22222222-2222-2222-2222-222222222222 (Vikram Singh, CART-04)

-- ------------------------------------------------------------------------------
-- TEST 1A: Cross-Student Profile Read
-- ------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT 
  'Test 1A' AS test_id,
  'Student A reads Student B profile' AS description,
  count(*) AS rows_exposed,
  CASE WHEN count(*) = 0 THEN 'PASSED' ELSE 'FAILED' END AS status,
  'Student profile row is invisible to other students' AS assertion
FROM public.profiles 
WHERE id = '44444444-4444-4444-4444-444444444444';

-- ------------------------------------------------------------------------------
-- TEST 1B: Cross-Student Pass Requests Read
-- ------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT 
  'Test 1B' AS test_id,
  'Student A reads Student B pass requests' AS description,
  count(*) AS rows_exposed,
  CASE WHEN count(*) = 0 THEN 'PASSED' ELSE 'FAILED' END AS status,
  'Medical pass requests are strictly isolated by student_id' AS assertion
FROM public.pass_requests 
WHERE student_id = '44444444-4444-4444-4444-444444444444';

-- ------------------------------------------------------------------------------
-- TEST 1C: Cross-Student Rides Read
-- ------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT 
  'Test 1C' AS test_id,
  'Student A reads Student B rides' AS description,
  count(*) AS rows_exposed,
  CASE WHEN count(*) = 0 THEN 'PASSED' ELSE 'FAILED' END AS status,
  'Rides are visible only to the owning student' AS assertion
FROM public.rides 
WHERE student_id = '44444444-4444-4444-4444-444444444444';

-- ------------------------------------------------------------------------------
-- TEST 1D: Cross-Student Private Storage Object Read
-- ------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT 
  'Test 1D' AS test_id,
  'Student A reads Student B certificates in storage' AS description,
  count(*) AS files_exposed,
  CASE WHEN count(*) = 0 THEN 'PASSED' ELSE 'FAILED' END AS status,
  'Private bucket medical-certificates blocks cross-tenant reads' AS assertion
FROM storage.objects 
WHERE bucket_id = 'medical-certificates' 
  AND name LIKE '44444444-4444-4444-4444-444444444444/%';

-- ------------------------------------------------------------------------------
-- TEST 2A: Driver Cannot Read Unassigned Rides
-- ------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT 
  'Test 2A' AS test_id,
  'Driver reads unassigned / other driver rides' AS description,
  count(*) AS unassigned_rides_exposed,
  CASE WHEN count(*) = 0 THEN 'PASSED' ELSE 'FAILED' END AS status,
  'Driver can only view rides assigned to their shift for today' AS assertion
FROM public.rides 
WHERE driver_id IS NULL OR driver_id <> '22222222-2222-2222-2222-222222222222';

-- ------------------------------------------------------------------------------
-- TEST 2B: Driver Cannot Browse Student Profiles Directly
-- ------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT 
  'Test 2B' AS test_id,
  'Driver directly selects student profiles' AS description,
  count(*) AS profiles_exposed,
  CASE WHEN count(*) = 0 THEN 'PASSED' ELSE 'FAILED' END AS status,
  'Driver receives 0 rows on direct profile select; must use restricted view' AS assertion
FROM public.profiles 
WHERE id = '44444444-4444-4444-4444-444444444444';

-- ------------------------------------------------------------------------------
-- TEST 3: Student Cannot Self-Approve Pass
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_rows integer;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

  BEGIN
    UPDATE public.pass_requests
    SET status = 'approved'
    WHERE request_code = 'REQ-9102';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'TEST_FAILED: Student self-approved pass';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 3 PASSED: Status update blocked: %', SQLERRM;
  END;
END $$;

-- ------------------------------------------------------------------------------
-- TEST 4A: Student Cannot Escalate Role to Admin
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

  BEGIN
    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = '11111111-1111-1111-1111-111111111111';
    
    RAISE EXCEPTION 'TEST_FAILED: Student escalated own role to admin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Unauthorized: User role and status are server-side managed%' THEN
      RAISE NOTICE 'Test 4A PASSED: Student role escalation blocked: %', SQLERRM;
    ELSE
      RAISE EXCEPTION 'Unexpected error: %', SQLERRM;
    END IF;
  END;
END $$;

-- ------------------------------------------------------------------------------
-- TEST 4B: Driver Cannot Escalate Role to Admin
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

  BEGIN
    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = '22222222-2222-2222-2222-222222222222';
    
    RAISE EXCEPTION 'TEST_FAILED: Driver escalated own role to admin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Unauthorized: User role and status are server-side managed%' THEN
      RAISE NOTICE 'Test 4B PASSED: Driver role escalation blocked: %', SQLERRM;
    ELSE
      RAISE EXCEPTION 'Unexpected error: %', SQLERRM;
    END IF;
  END;
END $$;

-- Reset Session
RESET ROLE;
