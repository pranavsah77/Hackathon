-- Migration: 20261120060000_qartix_pass_rpc_grants_fix.sql
-- Description: Revoke EXECUTE from PUBLIC and anon for pass management RPCs to address Supabase Security Advisor warnings.

REVOKE EXECUTE ON FUNCTION public.submit_pass_request(text, text, text, text, text, uuid, uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_pass_request(text, text, text, text, text, uuid, uuid, text[], text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.review_pass_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_pass_request(uuid, text, text) TO authenticated;
