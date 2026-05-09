-- Set start/end dates for all 660 Madison Avenue round 1 scenes
UPDATE public.scene_rounds sr
SET start_date = '2025-09-15 00:00:00+00',
    end_date   = '2025-09-22 00:00:00+00',
    delivered_at = CASE
      WHEN sr.status IN ('delivered','approved') THEN '2025-09-22 00:00:00+00'::timestamptz
      ELSE sr.delivered_at
    END
FROM public.scenes s
JOIN public.projects p ON p.id = s.project_id
WHERE sr.scene_id = s.id
  AND sr.round_number = 1
  AND p.name ILIKE '%660 Madison%';