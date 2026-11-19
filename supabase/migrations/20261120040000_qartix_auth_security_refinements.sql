-- Migration: 20261120040000_qartix_auth_security_refinements.sql
-- Description: Revoke authenticated RPC access to internal rate limit functions;
-- enforce service_role execution only.

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.record_rate_limit_attempt(text, boolean, integer, integer) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_rate_limit_attempt(text, boolean, integer, integer) TO service_role;
