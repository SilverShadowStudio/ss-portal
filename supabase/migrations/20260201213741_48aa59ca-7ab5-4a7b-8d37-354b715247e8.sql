-- Create table for admin Dropbox connections (only admins can connect)
CREATE TABLE public.dropbox_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamp with time zone,
  account_id text,
  cursor text, -- Dropbox delta cursor for polling
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.dropbox_connections ENABLE ROW LEVEL SECURITY;

-- Only admins can manage Dropbox connections
CREATE POLICY "Admins can view Dropbox connections" ON public.dropbox_connections
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can insert Dropbox connections" ON public.dropbox_connections
  FOR INSERT WITH CHECK (is_admin() AND auth.uid() = user_id);

CREATE POLICY "Admins can update Dropbox connections" ON public.dropbox_connections
  FOR UPDATE USING (is_admin() AND auth.uid() = user_id);

CREATE POLICY "Admins can delete Dropbox connections" ON public.dropbox_connections
  FOR DELETE USING (is_admin() AND auth.uid() = user_id);

-- Create round_assets table to track files from Dropbox
CREATE TABLE public.round_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_round_id uuid NOT NULL REFERENCES public.scene_rounds(id) ON DELETE CASCADE,
  dropbox_file_id text NOT NULL, -- Dropbox's unique file ID
  dropbox_path text NOT NULL, -- Path in Dropbox
  filename text NOT NULL,
  file_size bigint,
  content_hash text, -- Dropbox content hash for change detection
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  thumbnail_url text, -- Cached thumbnail URL (temporary)
  thumbnail_expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.round_assets ENABLE ROW LEVEL SECURITY;

-- Admins can manage all assets
CREATE POLICY "Admins can view all round assets" ON public.round_assets
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can insert round assets" ON public.round_assets
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Admins can update round assets" ON public.round_assets
  FOR UPDATE USING (is_admin());

CREATE POLICY "Admins can delete round assets" ON public.round_assets
  FOR DELETE USING (is_admin());

-- Clients can view assets for their scenes
CREATE POLICY "Users can view assets of their scenes" ON public.round_assets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM scene_rounds sr
      JOIN scenes s ON sr.scene_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE sr.id = round_assets.scene_round_id
      AND p.user_id = auth.uid()
    )
  );

-- Create asset_comments table for feedback
CREATE TABLE public.asset_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.round_assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  message text NOT NULL,
  parent_comment_id uuid REFERENCES public.asset_comments(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.asset_comments ENABLE ROW LEVEL SECURITY;

-- Admins can view/manage all comments
CREATE POLICY "Admins can view all asset comments" ON public.asset_comments
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can insert asset comments" ON public.asset_comments
  FOR INSERT WITH CHECK (is_admin());

-- Users can view/add comments on their assets
CREATE POLICY "Users can view comments on their assets" ON public.asset_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM round_assets ra
      JOIN scene_rounds sr ON ra.id = asset_comments.asset_id AND sr.id = ra.scene_round_id
      JOIN scenes s ON sr.scene_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert comments on their assets" ON public.asset_comments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM round_assets ra
      JOIN scene_rounds sr ON ra.id = asset_id AND sr.id = ra.scene_round_id
      JOIN scenes s ON sr.scene_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

-- Create asset_approvals table
CREATE TABLE public.asset_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.round_assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revision_requested')),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(asset_id, user_id)
);

-- Enable RLS
ALTER TABLE public.asset_approvals ENABLE ROW LEVEL SECURITY;

-- Admins can view all approvals
CREATE POLICY "Admins can view all asset approvals" ON public.asset_approvals
  FOR SELECT USING (is_admin());

-- Users can view/manage approvals on their assets
CREATE POLICY "Users can view approvals on their assets" ON public.asset_approvals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM round_assets ra
      JOIN scene_rounds sr ON ra.id = asset_approvals.asset_id AND sr.id = ra.scene_round_id
      JOIN scenes s ON sr.scene_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert approvals on their assets" ON public.asset_approvals
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM round_assets ra
      JOIN scene_rounds sr ON ra.id = asset_id AND sr.id = ra.scene_round_id
      JOIN scenes s ON sr.scene_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own approvals" ON public.asset_approvals
  FOR UPDATE USING (auth.uid() = user_id);

-- Create folder_mappings table to link Dropbox folders to projects/scenes
CREATE TABLE public.folder_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES public.scenes(id) ON DELETE CASCADE,
  dropbox_folder_path text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT folder_mapping_target CHECK (
    (project_id IS NOT NULL AND scene_id IS NULL) OR
    (project_id IS NULL AND scene_id IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE public.folder_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage folder mappings" ON public.folder_mappings
  FOR ALL USING (is_admin());

-- Add updated_at triggers
CREATE TRIGGER update_dropbox_connections_updated_at
  BEFORE UPDATE ON public.dropbox_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_round_assets_updated_at
  BEFORE UPDATE ON public.round_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_asset_approvals_updated_at
  BEFORE UPDATE ON public.asset_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Remove the old image_url column from scene_rounds (keep for now, deprecate)
-- We'll add a comment to mark it deprecated
COMMENT ON COLUMN public.scene_rounds.image_url IS 'DEPRECATED: Use round_assets table instead';