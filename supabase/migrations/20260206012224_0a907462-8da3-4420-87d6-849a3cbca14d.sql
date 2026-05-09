-- Add review_deadline column to scenes table
ALTER TABLE public.scenes 
ADD COLUMN review_deadline timestamp with time zone;