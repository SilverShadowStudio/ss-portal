-- Allow any signed-in user to read minimal identity fields from profiles
-- (first/last/full name, avatar). Needed so collaborators (e.g. pin authors)
-- can be displayed by name alongside content the viewer is already allowed
-- to see, such as pins on their assets.
CREATE POLICY "Authenticated users can view profile names"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);