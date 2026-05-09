
DO $$
DECLARE
  v_user uuid := 'b1c1d3ad-1039-4d4b-8b36-bb9dd461df4f';
  v_account uuid := '6864f7af-1fbd-48e2-8d82-177765db0b21';
BEGIN
  -- Asset-level children (scoped via project)
  DELETE FROM asset_pin_messages WHERE pin_id IN (
    SELECT ap.id FROM asset_pins ap
    JOIN round_assets ra ON ra.id = ap.asset_id
    JOIN scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN scenes s ON s.id = sr.scene_id
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM asset_pins WHERE asset_id IN (
    SELECT ra.id FROM round_assets ra
    JOIN scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN scenes s ON s.id = sr.scene_id
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM asset_drawings WHERE asset_id IN (
    SELECT ra.id FROM round_assets ra
    JOIN scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN scenes s ON s.id = sr.scene_id
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM asset_comments WHERE asset_id IN (
    SELECT ra.id FROM round_assets ra
    JOIN scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN scenes s ON s.id = sr.scene_id
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM asset_approvals WHERE asset_id IN (
    SELECT ra.id FROM round_assets ra
    JOIN scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN scenes s ON s.id = sr.scene_id
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM round_assets WHERE scene_round_id IN (
    SELECT sr.id FROM scene_rounds sr
    JOIN scenes s ON s.id = sr.scene_id
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM round_uploads WHERE scene_id IN (
    SELECT s.id FROM scenes s
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM scene_messages WHERE scene_id IN (
    SELECT s.id FROM scenes s
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM scene_rounds WHERE scene_id IN (
    SELECT s.id FROM scenes s
    WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
  );
  DELETE FROM folder_mappings WHERE project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user)
    OR scene_id IN (SELECT s.id FROM scenes s WHERE s.project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user));
  DELETE FROM scenes WHERE project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user);

  -- Anything tied to user or account directly
  DELETE FROM amount_adjustments WHERE user_id = v_user;
  DELETE FROM invoices WHERE user_id = v_user OR project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user);
  DELETE FROM quotations WHERE user_id = v_user OR project_id IN (SELECT id FROM projects WHERE account_id = v_account OR user_id = v_user);
  DELETE FROM projects WHERE account_id = v_account OR user_id = v_user;

  DELETE FROM dropbox_connections WHERE user_id = v_user;
  DELETE FROM agreement_audit_log WHERE user_id = v_user OR account_id = v_account;
  DELETE FROM agreements WHERE user_id = v_user OR account_id = v_account;
  DELETE FROM notification_preferences WHERE user_id = v_user;
  DELETE FROM activity_log_dismissals WHERE user_id = v_user;
  DELETE FROM activity_log WHERE actor_user_id = v_user;
  DELETE FROM account_invitations WHERE account_id = v_account OR invited_by = v_user OR accepted_user_id = v_user;
  DELETE FROM account_user_audit WHERE account_id = v_account OR actor_user_id = v_user OR target_user_id = v_user;
  DELETE FROM account_members WHERE account_id = v_account OR user_id = v_user;
  DELETE FROM accounts WHERE id = v_account OR owner_user_id = v_user;
  DELETE FROM user_roles WHERE user_id = v_user;
  DELETE FROM profiles WHERE user_id = v_user;

  -- Finally remove the auth account
  DELETE FROM auth.users WHERE id = v_user;
END $$;
