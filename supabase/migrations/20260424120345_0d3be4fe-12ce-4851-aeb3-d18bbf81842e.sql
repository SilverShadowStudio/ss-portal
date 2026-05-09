DO $$
DECLARE
  r RECORD;
  new_account_id uuid;
BEGIN
  FOR r IN
    SELECT p.user_id, p.company, p.first_name, p.last_name
    FROM public.profiles p
    LEFT JOIN public.account_members am ON am.user_id = p.user_id
    WHERE am.account_id IS NULL
  LOOP
    -- 1. Create company account
    INSERT INTO public.accounts (company_name, owner_user_id)
    VALUES (
      COALESCE(NULLIF(TRIM(r.company), ''), 'My Company'),
      r.user_id
    )
    RETURNING id INTO new_account_id;

    -- 2. Add user as Owner
    INSERT INTO public.account_members (account_id, user_id, role, joined_at)
    VALUES (new_account_id, r.user_id, 'owner', now())
    ON CONFLICT DO NOTHING;

    -- 3. Link profile to the new account
    UPDATE public.profiles
    SET account_id = new_account_id
    WHERE user_id = r.user_id AND account_id IS NULL;

    -- 4. Adopt any orphaned projects this user owns
    UPDATE public.projects
    SET account_id = new_account_id
    WHERE user_id = r.user_id AND account_id IS NULL;
  END LOOP;
END
$$;