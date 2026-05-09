-- Admins can delete accounts (clients)
CREATE POLICY "Admins can delete accounts"
ON public.accounts
FOR DELETE
TO authenticated
USING (public.is_admin());

-- Admins can delete projects
CREATE POLICY "Admins can delete projects"
ON public.projects
FOR DELETE
TO authenticated
USING (public.is_admin());

-- Admins can delete scenes
CREATE POLICY "Admins can delete scenes"
ON public.scenes
FOR DELETE
TO authenticated
USING (public.is_admin());

-- Admins can delete scene rounds (production/review rounds)
CREATE POLICY "Admins can delete scene rounds"
ON public.scene_rounds
FOR DELETE
TO authenticated
USING (public.is_admin());