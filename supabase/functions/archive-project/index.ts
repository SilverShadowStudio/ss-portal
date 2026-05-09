import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Remove files from a public/private bucket in batches of 100. */
// deno-lint-ignore no-explicit-any
async function removeFiles(
  admin: any,
  bucket: string,
  paths: string[],
): Promise<number> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  let removed = 0
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const { data, error } = await admin.storage.from(bucket).remove(chunk)
    if (error) {
      console.warn(`storage.remove ${bucket} failed`, error.message)
      continue
    }
    removed += data?.length ?? chunk.length
  }
  return removed
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'You must be signed in' }, 401)
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'You must be signed in' }, 401)
  }
  const user = userData.user

  // Admin gate via SECURITY DEFINER helper.
  const { data: isAdminData, error: isAdminError } = await userClient.rpc(
    'is_admin',
  )
  if (isAdminError || isAdminData !== true) {
    return json({ error: 'Admin access required' }, 403)
  }

  // Parse + validate body.
  let body: {
    project_id?: string
    typed_name?: string
    typed_confirm?: string
    archive_reason?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const projectId = body.project_id?.trim()
  const typedName = body.typed_name ?? ''
  const typedConfirm = body.typed_confirm ?? ''
  if (!projectId || !UUID_RE.test(projectId)) {
    return json({ error: 'Valid project_id is required' }, 400)
  }
  if (typedConfirm !== 'Delete') {
    return json({ error: 'Confirmation word does not match' }, 400)
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, name, archived_at')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError || !project) {
    return json({ error: 'Project not found' }, 404)
  }
  if (project.archived_at) {
    return json({ error: 'Project is already archived' }, 409)
  }
  if (typedName !== project.name) {
    return json({ error: 'Typed project name does not match' }, 400)
  }

  // Collect storage paths owned by the project.
  const { data: scenes } = await admin
    .from('scenes')
    .select('id')
    .eq('project_id', projectId)
  const sceneIds = (scenes ?? []).map((s: { id: string }) => s.id)

  let roundIds: string[] = []
  if (sceneIds.length) {
    const { data: rounds } = await admin
      .from('scene_rounds')
      .select('id')
      .in('scene_id', sceneIds)
    roundIds = (rounds ?? []).map((r: { id: string }) => r.id)
  }

  // scene-assets: round_assets uploaded files
  let sceneAssetPaths: string[] = []
  let assetIds: string[] = []
  if (roundIds.length) {
    const { data: assets } = await admin
      .from('round_assets')
      .select('id, storage_path, source')
      .in('scene_round_id', roundIds)
    for (const a of assets ?? []) {
      assetIds.push((a as { id: string }).id)
      const path = (a as { storage_path: string | null }).storage_path
      const source = (a as { source: string }).source
      if (path && source === 'upload') sceneAssetPaths.push(path)
    }
  }

  // round-uploads
  let roundUploadPaths: string[] = []
  if (sceneIds.length) {
    const { data: uploads } = await admin
      .from('round_uploads')
      .select('storage_path')
      .in('scene_id', sceneIds)
    roundUploadPaths = (uploads ?? [])
      .map((u: { storage_path: string }) => u.storage_path)
      .filter(Boolean)
  }

  // pin-attachments: from asset_pin_messages.attachments[*].path
  let pinAttachmentPaths: string[] = []
  if (assetIds.length) {
    const { data: pins } = await admin
      .from('asset_pins')
      .select('id')
      .in('asset_id', assetIds)
    const pinIds = (pins ?? []).map((p: { id: string }) => p.id)
    if (pinIds.length) {
      const { data: messages } = await admin
        .from('asset_pin_messages')
        .select('attachments')
        .in('pin_id', pinIds)
      for (const m of messages ?? []) {
        const atts = (m as { attachments: unknown }).attachments
        if (Array.isArray(atts)) {
          for (const a of atts) {
            const p = (a as { path?: string })?.path
            if (typeof p === 'string' && p) pinAttachmentPaths.push(p)
          }
        }
      }
    }
  }

  // Delete from storage (best-effort).
  const [n1, n2, n3] = await Promise.all([
    removeFiles(admin, 'scene-assets', sceneAssetPaths),
    removeFiles(admin, 'round-uploads', roundUploadPaths),
    removeFiles(admin, 'pin-attachments', pinAttachmentPaths),
  ])
  const filesDeleted = n1 + n2 + n3

  // Stamp the project as archived.
  const { error: updateError } = await admin
    .from('projects')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user.id,
      archive_reason: body.archive_reason ?? null,
    })
    .eq('id', projectId)
  if (updateError) {
    return json({ error: `Failed to archive project: ${updateError.message}` }, 500)
  }

  // Activity log entry (best-effort).
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('first_name, last_name, full_name')
      .eq('user_id', user.id)
      .maybeSingle()
    const actorName =
      [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
      profile?.full_name ||
      user.email ||
      null
    await admin.from('activity_log').insert({
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: 'admin',
      action: 'project_archived',
      description: `Archived project "${project.name}" — ${filesDeleted} file${filesDeleted === 1 ? '' : 's'} removed`,
      entity_type: 'project',
      entity_id: project.id,
      project_id: project.id,
      project_name: project.name,
      metadata: { files_deleted: filesDeleted },
    })
  } catch (err) {
    console.warn('activity_log insert failed', err)
  }

  return json({ ok: true, files_deleted: filesDeleted })
})