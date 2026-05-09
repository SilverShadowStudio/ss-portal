CREATE POLICY "Users can insert rounds to their scenes"
ON public.scene_rounds
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.scenes
    JOIN public.projects ON scenes.project_id = projects.id
    WHERE scenes.id = scene_rounds.scene_id
      AND projects.user_id = auth.uid()
  )
);