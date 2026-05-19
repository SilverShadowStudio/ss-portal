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

/**
 * Pre-flight: returns up to 5 Airtable Clients rows whose company name
 * matches the supplied query under a bidirectional, suffix-stripped
 * contains-rule. The admin Add Client dialog calls this on debounced
 * typing so the admin can link to an existing row rather than create a
 * duplicate.
 *
 * Match logic:
 *   - Strip trailing "Limited", "Ltd", "Inc", "LLC", "Studio(s)" from
 *     BOTH the query and each Airtable row's company name (case-insensitive).
 *   - Bidirectional contains-match: query ⊆ candidate OR candidate ⊆ query.
 *
 * Airtable narrowing: a coarse filterByFormula picks candidates via the
 * stripped query's first word OR the candidate-contained-in-query test.
 * Refinement happens in JS so suffix stripping works on both sides.
 */

const SUFFIX_PATTERNS: RegExp[] = [
  /\s+limited$/i,
  /\s+ltd\.?$/i,
  /\s+l\.t\.d\.?$/i,
  /\s+inc\.?$/i,
  /\s+llc$/i,
  /\s+studios?$/i,
]

function stripSuffix(name: string): string {
  let s = name.trim()
  for (let i = 0; i < 3; i++) {
    let changed = false
    for (const pat of SUFFIX_PATTERNS) {
      const next = s.replace(pat, '')
      if (next !== s) {
        s = next
        changed = true
      }
    }
    if (!changed) break
  }
  return s.trim()
}

function bidirectionalMatch(strippedQuery: string, candidateName: string): boolean {
  const c = stripSuffix(candidateName).toLowerCase()
  if (!c) return false
  return strippedQuery.includes(c) || c.includes(strippedQuery)
}

interface ContactConfig {
  base_id: string
  clients_table_id: string
  field_company_name: string
  table_id?: string                  // Users table id
  field_first_name?: string
  field_surname?: string
  field_client_representative?: string
  field_client_building_number?: string
  field_client_street_name?: string
  field_client_city?: string
  field_client_postcode?: string
  field_client_country?: string
}

interface ProjectConfig {
  base_id: string
  table_id: string
  field_client_link: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) return json({ error: 'Forbidden — admin only' }, 403)

  let body: { company_name?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const companyName = body.company_name?.trim() ?? ''
  if (companyName.length < 3) return json({ matches: [] })

  const strippedQuery = stripSuffix(companyName).toLowerCase()
  if (strippedQuery.length < 2) return json({ matches: [] })

  const [{ data: contactRow }, { data: projectRow }] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'airtable_contact_field_config').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'airtable_project_field_config').maybeSingle(),
  ])
  const contactCfg = (contactRow?.value ?? {}) as Partial<ContactConfig>
  const projectCfg = (projectRow?.value ?? {}) as Partial<ProjectConfig>

  if (!contactCfg.clients_table_id || !contactCfg.field_company_name) {
    return json({ matches: [], warning: 'contact_config_incomplete' })
  }

  const airtableKey = Deno.env.get('AIRTABLE_PAT') || Deno.env.get('AIRTABLE_API_KEY')
  const baseId = Deno.env.get('AIRTABLE_BASE_ID') || contactCfg.base_id
  if (!airtableKey || !baseId) {
    return json({ matches: [], warning: 'airtable_unconfigured' })
  }

  const atHeaders: Record<string, string> = {
    Authorization: `Bearer ${airtableKey}`,
    'Content-Type': 'application/json',
  }

  // 1. Coarse Airtable filter: first-word match OR candidate ⊆ stripped query.
  //    The refinement in step 2 enforces the proper suffix-stripped
  //    bidirectional rule.
  const firstWord = strippedQuery.split(/\s+/)[0]
  const esc = (s: string) => s.replace(/"/g, '\\"')
  const nameField = contactCfg.field_company_name
  const formula =
    `OR(` +
    `FIND(LOWER("${esc(firstWord)}"), LOWER({${nameField}})),` +
    `FIND(LOWER({${nameField}}), LOWER("${esc(strippedQuery)}"))` +
    `)`

  const listUrl =
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(contactCfg.clients_table_id)}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50&pageSize=50`

  const listRes = await fetch(listUrl, { headers: atHeaders })
  if (!listRes.ok) {
    const errText = await listRes.text()
    console.warn('[airtable-find-matching-clients] Clients fetch failed:', errText)
    return json({ matches: [], warning: 'airtable_fetch_failed' })
  }
  const listData = await listRes.json() as {
    records: Array<{ id: string; fields: Record<string, unknown> }>
  }
  const candidates = listData.records ?? []

  // 2. JS-side bidirectional, suffix-stripped match. Top 5.
  const matched = candidates
    .filter((rec) => {
      const name = (rec.fields?.[nameField] as string) ?? ''
      return bidirectionalMatch(strippedQuery, name)
    })
    .slice(0, 5)

  if (matched.length === 0) return json({ matches: [] })

  // 3. Resolve Client Representative names (single batched fetch).
  const repField = contactCfg.field_client_representative ?? 'Client Representative'
  const repIds = new Set<string>()
  for (const rec of matched) {
    const ids = (rec.fields?.[repField] as string[] | undefined) ?? []
    for (const id of ids) repIds.add(id)
  }
  const repNames: Record<string, string> = {}
  if (repIds.size > 0 && contactCfg.table_id) {
    const orRep = [...repIds].map((id) => `RECORD_ID()="${id}"`).join(',')
    const repUrl =
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(contactCfg.table_id)}` +
      `?filterByFormula=${encodeURIComponent(`OR(${orRep})`)}&maxRecords=${repIds.size}&pageSize=100`
    const repRes = await fetch(repUrl, { headers: atHeaders })
    if (repRes.ok) {
      const repData = await repRes.json() as {
        records: Array<{ id: string; fields: Record<string, unknown> }>
      }
      const firstNameField = contactCfg.field_first_name ?? 'First Name'
      const surnameField = contactCfg.field_surname ?? 'Surname'
      for (const r of repData.records) {
        const fn = (r.fields[firstNameField] as string) ?? ''
        const sn = (r.fields[surnameField] as string) ?? ''
        const full = [fn, sn].filter(Boolean).join(' ').trim()
        if (full) repNames[r.id] = full
      }
    }
  }

  // 4. Count projects per matched client (single batched fetch).
  const projectCounts: Record<string, number> = {}
  if (projectCfg.table_id && projectCfg.field_client_link && matched.length > 0) {
    const matchedIds = matched.map((m) => m.id)
    const orProj = matchedIds
      .map((id) => `SEARCH("${id}", ARRAYJOIN({${projectCfg.field_client_link}}))`)
      .join(',')
    const projUrl =
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(projectCfg.table_id)}` +
      `?filterByFormula=${encodeURIComponent(`OR(${orProj})`)}&maxRecords=200&pageSize=100`
    const projRes = await fetch(projUrl, { headers: atHeaders })
    if (projRes.ok) {
      const projData = await projRes.json() as {
        records: Array<{ fields: Record<string, unknown> }>
      }
      for (const proj of projData.records) {
        const links = (proj.fields[projectCfg.field_client_link] as string[] | undefined) ?? []
        for (const cid of links) {
          if (matchedIds.includes(cid)) {
            projectCounts[cid] = (projectCounts[cid] ?? 0) + 1
          }
        }
      }
    }
  }

  // 5. Compose output. Address uses the same six fields the contact sync
  //    writes. Each part is joined with " · " to stay readable on one line.
  const matches = matched.map((rec) => {
    const f = rec.fields ?? {}
    const ids = (f[repField] as string[] | undefined) ?? []
    const repFullNames = ids.map((id) => repNames[id]).filter(Boolean) as string[]
    const addressParts: string[] = []
    const push = (key: string | undefined) => {
      if (!key) return
      const v = f[key]
      if (typeof v === 'string' && v.trim()) addressParts.push(v.trim())
    }
    push(contactCfg.field_client_building_number)
    push(contactCfg.field_client_street_name)
    push(contactCfg.field_client_city)
    push(contactCfg.field_client_postcode)
    push(contactCfg.field_client_country)
    return {
      record_id: rec.id,
      company_name: (f[nameField] as string) ?? '',
      address: addressParts.length ? addressParts.join(' · ') : null,
      client_representative: repFullNames.length ? repFullNames.join(', ') : null,
      has_projects: projectCounts[rec.id] ?? 0,
    }
  })

  return json({ matches })
})
