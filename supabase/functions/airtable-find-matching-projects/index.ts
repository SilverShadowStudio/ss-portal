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
 * Pre-flight: returns up to 5 Airtable Projects rows whose name fuzzy-matches
 * the supplied query. Called by the admin New Project modal on debounced typing
 * so the admin can link to an existing row rather than create a duplicate.
 *
 * Match logic:
 *   - Normalise both sides: lowercase, replace dashes/underscores with spaces,
 *     collapse whitespace. "660 Madison" matches "660-Madison", etc.
 *   - Bidirectional substring: query ⊆ candidate OR candidate ⊆ query.
 *   - Also matches directly against the project code field (field_project_name),
 *     so typing "CP107" surfaces that record even if field_client_facing_name is
 *     empty (pre-portal records that haven't been given a client-facing name yet).
 *
 * Config read from app_settings:
 *   airtable_project_field_config — base_id, table_id, field_project_name,
 *     field_client_facing_name, field_client_link, clients_table_id?,
 *     field_company_name?
 *   airtable_contact_field_config — fallback for clients_table_id +
 *     field_company_name when not set in project config.
 */

function normalise(s: string): string {
  return s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function fuzzyMatch(query: string, candidate: string): boolean {
  const q = normalise(query)
  const c = normalise(candidate)
  if (!q || !c) return false
  return q.includes(c) || c.includes(q)
}

interface ProjectConfig {
  base_id: string
  table_id: string
  field_project_name: string        // code field, e.g. "Project name" → "CP107"
  field_client_facing_name: string  // human-readable, e.g. "Client Facing Project Name"
  field_client_link: string         // linked Clients record, e.g. "Client"
  clients_table_id?: string
  field_company_name?: string
}

interface ContactConfig {
  clients_table_id?: string
  field_company_name?: string
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

  let body: { query?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const query = body.query?.trim() ?? ''
  if (query.length < 2) return json({ matches: [] })

  const [{ data: projRow }, { data: contactRow }] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'airtable_project_field_config').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'airtable_contact_field_config').maybeSingle(),
  ])
  const projCfg = (projRow?.value ?? {}) as Partial<ProjectConfig>
  const contactCfg = (contactRow?.value ?? {}) as Partial<ContactConfig>

  if (
    !projCfg.base_id ||
    !projCfg.table_id ||
    !projCfg.field_project_name ||
    !projCfg.field_client_facing_name
  ) {
    return json({ matches: [], warning: 'project_config_incomplete' })
  }

  const airtableKey = Deno.env.get('AIRTABLE_PAT') || Deno.env.get('AIRTABLE_API_KEY')
  if (!airtableKey) return json({ matches: [], warning: 'airtable_unconfigured' })

  const atHeaders: Record<string, string> = {
    Authorization: `Bearer ${airtableKey}`,
    'Content-Type': 'application/json',
  }

  const normQuery = normalise(query)
  const firstWord = normQuery.split(' ')[0]
  const esc = (s: string) => s.replace(/"/g, '\\"')
  const nameField = projCfg.field_client_facing_name
  const codeField = projCfg.field_project_name

  // Coarse Airtable filter: first-word hit on the client-facing name field, OR
  // direct substring hit on the code field (handles "CP107" lookups).
  const formula =
    `OR(` +
    `FIND(LOWER("${esc(firstWord)}"), LOWER({${nameField}})),` +
    `FIND(LOWER({${nameField}}), LOWER("${esc(normQuery)}")),` +
    `FIND(LOWER("${esc(query)}"), LOWER({${codeField}}))` +
    `)`

  const listUrl =
    `https://api.airtable.com/v0/${projCfg.base_id}/${encodeURIComponent(projCfg.table_id)}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50&pageSize=50`

  const listRes = await fetch(listUrl, { headers: atHeaders })
  if (!listRes.ok) {
    const errText = await listRes.text()
    console.warn('[airtable-find-matching-projects] fetch failed:', errText)
    return json({ matches: [], warning: 'airtable_fetch_failed' })
  }
  const listData = await listRes.json() as {
    records: Array<{ id: string; fields: Record<string, unknown> }>
  }
  const candidates = listData.records ?? []

  // JS-side: normalised fuzzy match against client-facing name, OR
  // substring match against the code (case-insensitive, no normalisation needed).
  const matched = candidates
    .filter((rec) => {
      const name = (rec.fields?.[nameField] as string) ?? ''
      const code = (rec.fields?.[codeField] as string) ?? ''
      return (
        fuzzyMatch(query, name) ||
        code.toLowerCase().includes(query.toLowerCase())
      )
    })
    .slice(0, 5)

  if (matched.length === 0) return json({ matches: [] })

  // Resolve company names from linked Client records (single batched fetch).
  const clientLinkField = projCfg.field_client_link
  const clientsTableId = projCfg.clients_table_id ?? contactCfg.clients_table_id
  const companyNameField = projCfg.field_company_name ?? contactCfg.field_company_name ?? 'Company name'

  const companyById: Record<string, { name: string; id: string }> = {}
  const clientIdSet = new Set<string>()
  for (const rec of matched) {
    const links = (rec.fields?.[clientLinkField] as string[] | undefined) ?? []
    for (const id of links) clientIdSet.add(id)
  }

  if (clientIdSet.size > 0 && clientsTableId) {
    const orIds = [...clientIdSet].map((id) => `RECORD_ID()="${id}"`).join(',')
    const clientUrl =
      `https://api.airtable.com/v0/${projCfg.base_id}/${encodeURIComponent(clientsTableId)}` +
      `?filterByFormula=${encodeURIComponent(`OR(${orIds})`)}&maxRecords=${clientIdSet.size}&pageSize=100`
    const clientRes = await fetch(clientUrl, { headers: atHeaders })
    if (clientRes.ok) {
      const clientData = await clientRes.json() as {
        records: Array<{ id: string; fields: Record<string, unknown> }>
      }
      for (const r of clientData.records) {
        const name = (r.fields[companyNameField] as string) ?? ''
        if (name) companyById[r.id] = { name, id: r.id }
      }
    }
  }

  const matches = matched.map((rec) => {
    const f = rec.fields ?? {}
    const links = (f[clientLinkField] as string[] | undefined) ?? []
    const firstClientId = links[0]
    const company = firstClientId ? companyById[firstClientId] : undefined
    return {
      airtable_project_id: rec.id,
      project_name: (f[nameField] as string) ?? '',
      project_code: (f[codeField] as string) ?? '',
      account_name: company?.name,
      account_airtable_id: company?.id,
    }
  })

  return json({ matches })
})
