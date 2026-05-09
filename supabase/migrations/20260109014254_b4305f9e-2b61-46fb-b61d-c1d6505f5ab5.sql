
-- Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scenes table
CREATE TABLE public.scenes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 1,
  paid_rounds INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'pending_instruction' CHECK (status IN ('pending_instruction', 'in_production', 'delivered', 'approved')),
  next_delivery_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scene_rounds table (tracks each round delivery)
CREATE TABLE public.scene_rounds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_production', 'delivered', 'approved')),
  delivered_at TIMESTAMP WITH TIME ZONE,
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scene_messages table
CREATE TABLE public.scene_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('client', 'studio')),
  user_id UUID,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  parent_message_id UUID REFERENCES public.scene_messages(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create quotations table
CREATE TABLE public.quotations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  reference_number TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  signed_at TIMESTAMP WITH TIME ZONE
);

-- Create invoices table
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  reference_number TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE
);

-- Create amount_adjustments table (for notifications of increased amounts)
CREATE TABLE public.amount_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  quotation_id UUID REFERENCES public.quotations(id) ON DELETE CASCADE,
  previous_amount DECIMAL(10,2) NOT NULL,
  new_amount DECIMAL(10,2) NOT NULL,
  reason TEXT,
  is_acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amount_adjustments ENABLE ROW LEVEL SECURITY;

-- RLS policies for projects
CREATE POLICY "Users can view their own projects" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);

-- RLS policies for scenes (via project ownership)
CREATE POLICY "Users can view scenes of their projects" ON public.scenes FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = scenes.project_id AND projects.user_id = auth.uid()));
CREATE POLICY "Users can insert scenes to their projects" ON public.scenes FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = scenes.project_id AND projects.user_id = auth.uid()));
CREATE POLICY "Users can update scenes of their projects" ON public.scenes FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = scenes.project_id AND projects.user_id = auth.uid()));

-- RLS policies for scene_rounds
CREATE POLICY "Users can view rounds of their scenes" ON public.scene_rounds FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.scenes JOIN public.projects ON scenes.project_id = projects.id WHERE scenes.id = scene_rounds.scene_id AND projects.user_id = auth.uid()));
CREATE POLICY "Users can update rounds of their scenes" ON public.scene_rounds FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.scenes JOIN public.projects ON scenes.project_id = projects.id WHERE scenes.id = scene_rounds.scene_id AND projects.user_id = auth.uid()));

-- RLS policies for scene_messages
CREATE POLICY "Users can view messages of their scenes" ON public.scene_messages FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.scenes JOIN public.projects ON scenes.project_id = projects.id WHERE scenes.id = scene_messages.scene_id AND projects.user_id = auth.uid()));
CREATE POLICY "Users can insert messages to their scenes" ON public.scene_messages FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.scenes JOIN public.projects ON scenes.project_id = projects.id WHERE scenes.id = scene_messages.scene_id AND projects.user_id = auth.uid()));

-- RLS policies for quotations
CREATE POLICY "Users can view their own quotations" ON public.quotations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own quotations" ON public.quotations FOR UPDATE USING (auth.uid() = user_id);

-- RLS policies for invoices
CREATE POLICY "Users can view their own invoices" ON public.invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own invoices" ON public.invoices FOR UPDATE USING (auth.uid() = user_id);

-- RLS policies for amount_adjustments
CREATE POLICY "Users can view their own amount adjustments" ON public.amount_adjustments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own amount adjustments" ON public.amount_adjustments FOR UPDATE USING (auth.uid() = user_id);

-- Create triggers for updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scenes_updated_at BEFORE UPDATE ON public.scenes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scene_rounds_updated_at BEFORE UPDATE ON public.scene_rounds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
