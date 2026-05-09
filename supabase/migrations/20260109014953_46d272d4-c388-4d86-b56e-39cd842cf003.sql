
-- Add position field to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS position TEXT;

-- Create notification_preferences table
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  notify_new_round_delivered BOOLEAN NOT NULL DEFAULT false,
  notify_feedback_reminder BOOLEAN NOT NULL DEFAULT false,
  notify_new_review_item BOOLEAN NOT NULL DEFAULT false,
  notify_daily_summary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- RLS policies for notification_preferences
CREATE POLICY "Users can view their own notification preferences" 
ON public.notification_preferences FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification preferences" 
ON public.notification_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification preferences" 
ON public.notification_preferences FOR UPDATE USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_notification_preferences_updated_at 
BEFORE UPDATE ON public.notification_preferences 
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
