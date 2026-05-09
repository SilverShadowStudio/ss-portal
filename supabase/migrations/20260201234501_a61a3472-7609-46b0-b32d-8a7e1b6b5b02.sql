-- ============================================================
-- SECURITY: Make Dropbox tokens service-role only
-- ============================================================
-- 
-- RATIONALE:
-- - Dropping the broad "Admins can view Dropbox connections" policy
-- - Tokens should ONLY be accessible via Edge Functions (service_role)
-- - UI can use the existing `connection-status` Edge Function action
--   which returns status without exposing actual tokens
-- 
-- RESULT:
-- - No RLS policy allows SELECT on dropbox_connections
-- - service_role bypasses RLS, so Edge Functions still work
-- - Frontend uses edge function, not direct table access
-- ============================================================

-- Drop the overly broad SELECT policy
DROP POLICY IF EXISTS "Admins can view Dropbox connections" ON public.dropbox_connections;

-- Verify remaining policies are properly scoped (INSERT/UPDATE/DELETE require is_admin() AND auth.uid() = user_id)
-- These already exist and are correct - no changes needed