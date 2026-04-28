-- =========================================================
-- SECURITY FIX: Prevent Assignee IDOR (Insecure Direct Object Reference)
-- =========================================================

-- 1. Drop ALL existing UPDATE policies on tasks (old + any previously created by this migration)
DROP POLICY IF EXISTS "Operators, admins, or assignee can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Operators/admins can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Assignees can update their own tasks" ON public.tasks;

-- 2. Create a policy allowing Operators and Admins to update ANY field
CREATE POLICY "Operators/admins can update tasks" 
ON public.tasks 
FOR UPDATE TO authenticated 
USING (
  public.has_role(auth.uid(), 'operator') OR 
  public.has_role(auth.uid(), 'admin')
);

-- 3. Create a strict policy for Assignees
-- They can only update the task if they are the current assignee, 
-- AND the WITH CHECK clause ensures they cannot change the assignee_id to someone else.
CREATE POLICY "Assignees can update their own tasks" 
ON public.tasks 
FOR UPDATE TO authenticated 
USING (assignee_id = auth.uid()) 
WITH CHECK (assignee_id = auth.uid());
