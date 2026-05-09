-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'client');

-- Create user_roles table
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- RLS policies for user_roles
-- Admins can view all roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Users can view their own roles
CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Only admins can insert roles
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Only admins can update roles
CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.is_admin());

-- Only admins can delete roles
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.is_admin());

-- Add admin RLS policies to existing tables so admins can manage all data

-- Projects: Admins can view all projects
CREATE POLICY "Admins can view all projects"
ON public.projects
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Projects: Admins can insert projects for any user
CREATE POLICY "Admins can insert projects"
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Projects: Admins can update any project
CREATE POLICY "Admins can update all projects"
ON public.projects
FOR UPDATE
TO authenticated
USING (public.is_admin());

-- Scenes: Admins can view all scenes
CREATE POLICY "Admins can view all scenes"
ON public.scenes
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Scenes: Admins can insert scenes
CREATE POLICY "Admins can insert scenes"
ON public.scenes
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Scenes: Admins can update any scene
CREATE POLICY "Admins can update all scenes"
ON public.scenes
FOR UPDATE
TO authenticated
USING (public.is_admin());

-- Scene rounds: Admins can view all
CREATE POLICY "Admins can view all scene rounds"
ON public.scene_rounds
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Scene rounds: Admins can insert
CREATE POLICY "Admins can insert scene rounds"
ON public.scene_rounds
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Scene rounds: Admins can update any
CREATE POLICY "Admins can update all scene rounds"
ON public.scene_rounds
FOR UPDATE
TO authenticated
USING (public.is_admin());

-- Scene messages: Admins can view all
CREATE POLICY "Admins can view all scene messages"
ON public.scene_messages
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Scene messages: Admins can insert messages
CREATE POLICY "Admins can insert scene messages"
ON public.scene_messages
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Profiles: Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Profiles: Admins can update any profile
CREATE POLICY "Admins can update all profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_admin());

-- Invoices: Admins can view all
CREATE POLICY "Admins can view all invoices"
ON public.invoices
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Invoices: Admins can insert
CREATE POLICY "Admins can insert invoices"
ON public.invoices
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Invoices: Admins can update any
CREATE POLICY "Admins can update all invoices"
ON public.invoices
FOR UPDATE
TO authenticated
USING (public.is_admin());

-- Quotations: Admins can view all
CREATE POLICY "Admins can view all quotations"
ON public.quotations
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Quotations: Admins can insert
CREATE POLICY "Admins can insert quotations"
ON public.quotations
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Quotations: Admins can update any
CREATE POLICY "Admins can update all quotations"
ON public.quotations
FOR UPDATE
TO authenticated
USING (public.is_admin());