-- Migration: 20261120110000_qartix_admin_management_and_audit.sql
-- Description: Driver approval and cart assignment RPC, audit log RPC and policy,
-- ensuring all admin actions write to audit_logs.

-- 1. Secure RPC: admin_manage_driver
CREATE OR REPLACE FUNCTION public.admin_manage_driver(
  p_driver_id uuid,
  p_status text,
  p_cart_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_action_name text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only transport office administrators can manage driver accounts.';
  END IF;

  IF p_status NOT IN ('active', 'suspended', 'pending_approval') THEN
    RAISE EXCEPTION 'Invalid driver status: %. Must be active, suspended, or pending_approval.', p_status;
  END IF;

  -- Update profiles status
  UPDATE public.profiles
  SET status = p_status,
      updated_at = now()
  WHERE id = p_driver_id AND role = 'driver';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver profile not found.';
  END IF;

  -- Update driver_details approved_by, approved_at, and cart_id
  UPDATE public.driver_details
  SET approved_by = CASE WHEN p_status = 'active' THEN v_admin_id ELSE approved_by END,
      approved_at = CASE WHEN p_status = 'active' THEN COALESCE(approved_at, now()) ELSE approved_at END,
      cart_id = CASE WHEN p_cart_id IS NOT NULL THEN p_cart_id ELSE cart_id END,
      updated_at = now()
  WHERE user_id = p_driver_id;

  -- Link cart if provided
  IF p_cart_id IS NOT NULL THEN
    UPDATE public.carts
    SET current_driver_id = p_driver_id,
        updated_at = now()
    WHERE id = p_cart_id;
  END IF;

  -- If suspending, take driver and cart offline
  IF p_status = 'suspended' THEN
    UPDATE public.driver_details SET is_online = false WHERE user_id = p_driver_id;
    UPDATE public.carts SET status = 'offline' WHERE current_driver_id = p_driver_id;
  END IF;

  v_action_name := CASE 
    WHEN p_status = 'active' THEN 'ADMIN_DRIVER_APPROVED'
    WHEN p_status = 'suspended' THEN 'ADMIN_DRIVER_SUSPENDED'
    ELSE 'ADMIN_DRIVER_STATUS_UPDATE'
  END;

  -- Write to audit_logs
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_admin_id,
    v_action_name,
    'profiles',
    p_driver_id::text,
    jsonb_build_object(
      'status', p_status,
      'cart_id', p_cart_id,
      'admin_id', v_admin_id,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'driver_id', p_driver_id,
    'status', p_status,
    'cart_id', p_cart_id,
    'action', v_action_name
  );
END;
$$;

-- 2. Secure RPC: get_admin_audit_logs
CREATE OR REPLACE FUNCTION public.get_admin_audit_logs(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text,
  entity text,
  entity_id text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only transport office administrators can view audit logs.';
  END IF;

  RETURN QUERY
  SELECT 
    a.id,
    a.created_at,
    a.actor_id,
    COALESCE(p.full_name, 'System / Automated Cron') AS actor_name,
    COALESCE(p.role, 'system') AS actor_role,
    a.action,
    a.entity,
    a.entity_id,
    a.metadata
  FROM public.audit_logs a
  LEFT JOIN public.profiles p ON a.actor_id = p.id
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(200, p_limit));
END;
$$;

-- 3. Policy: Admin can insert into audit_logs directly if needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'audit_logs' AND policyname = 'audit_logs_insert_admin'
  ) THEN
    CREATE POLICY "audit_logs_insert_admin" ON public.audit_logs
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.current_role()) = 'admin');
  END IF;
END $$;

-- 4. Permissions
REVOKE EXECUTE ON FUNCTION public.admin_manage_driver(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_audit_logs(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_manage_driver(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_logs(integer) TO authenticated;
