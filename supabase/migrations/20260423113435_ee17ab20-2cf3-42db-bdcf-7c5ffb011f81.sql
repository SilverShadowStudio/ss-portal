
ALTER TABLE public.profiles ADD COLUMN first_name text;
ALTER TABLE public.profiles ADD COLUMN last_name text;

-- Migrate existing data: split full_name into first/last
UPDATE public.profiles
SET first_name = split_part(full_name, ' ', 1),
    last_name = CASE WHEN position(' ' in full_name) > 0
      THEN substring(full_name from position(' ' in full_name) + 1)
      ELSE NULL END
WHERE full_name IS NOT NULL;
