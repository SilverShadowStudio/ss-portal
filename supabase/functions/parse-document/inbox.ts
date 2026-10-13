// parse-document/inbox.ts — the Document Inbox.
//
// Drop any document on the admin dashboard; this reads it, works out what it
// is, names it, and files it into the studio Dropbox. Called as
// POST parse-document?action=inbox (it lives in parse-document only because
// the project is at its edge-function limit; it shares nothing with the
// parser above it except the deployment).
//
// Ops (multipart form field / JSON key `op`):
//   file  — form-data { file }        → classify + file one document
//   move  — JSON { id, path }         → re-file a document to a corrected path
//   tree  — JSON {}                   → folder list under ADMIN_ROOT (for Move)
//
// Auth: admin JWT (the dashboard), or cron secret / service role (testing).
//
// ── THE FILING STRATEGY ─────────────────────────────────────────────────────
// Every name follows the conventions already in the Dropbox: underscores
// between fields, hyphens inside them, no spaces. Paths are under
// /03_Portal_Admin_Docs. Nothing is ever written to /00_Production (that tree
// belongs to Kieran and the Dropbox webhook acts on files arriving there).
//
//   ar_invoice          03_Invoices/INV001_Receivable/Invoices-Outgoing_{YYYY-MM}_{Month}/
//                       {date}_AR_{CLIENT}_{InvoiceNo}_{AmountCCY}
//   ap_invoice          03_Invoices/INV002_Payable/02_Overheads/Overheads_{YYYY-MM}_{Month}/
//                       {date}_AP_{VENDOR}_{InvoiceNo}_{Description-MonYY}_{AmountCCY}
//   freelancer_invoice  03_Invoices/INV002_Payable/01_Freelancers/Freelancers_{YYYY-MM}_{Month}/
//                       Freelancer_Invoice_{First-Last}_{YYYY-MM}
//   quotation           02_Quotations/  {CLI}_Quotation_{QuoteNo}_{date}_{SENT|SIGNED}
//   client_project_agreement      01_Agreements/AGR001_Clients/CLI001_Project-Agreements/PRO{NNN}_{CLI}_{Client}/
//                                 {CLI}_Agreement-Project_{date}_{SENT|SIGNED}
//   client_partnership_agreement  01_Agreements/AGR001_Clients/CLI002_Partnership-Agreements/PAR{NNN}_{CLI}_{Client}/
//                                 {CLI}_Agreement-Partnership_{date}_{SENT|SIGNED}
//   employee_document   01_Agreements/AGR002_Employees/EMP{NNN}_{First-Last}/   {First-Last}_{Kind}_{date}[_SIGNED]
//   payslip             01_Agreements/AGR002_Employees/EMP{NNN}_{First-Last}/Payslips/  {First-Last}_Payslip_{YYYY-MM}
//   freelancer_document 01_Agreements/AGR003_Freelancers/FREE{NNN}_{First-Last}/ {First-Last}_{Kind}_{date}[_SIGNED]
//   intern_document     01_Agreements/AGR005_Interns/INT{NNN}_{First-Last}/      {First-Last}_{Kind}_{date}[_SIGNED]
//   supplier_agreement  01_Agreements/AGR004_Suppliers/SUP001_Vendor-Agreements/VEN{NNN}_{Name}/
//                       {Name}_Agreement-Supplier_{date}_{SENT|SIGNED}
//   agency_agreement    01_Agreements/AGR004_Suppliers/SUP002_Agency-Collaboration-Agreements/COL{NNN}_{Name}/
//                       {Name}_Agreement-Agency-Collaboration_{date}_{SENT|SIGNED}
//   contract_template   01_Agreements/AGR000_Templates/  SS-{Kind}
//   bank_document       04_Studio-Records/REC001_Banking/{YYYY}/      {date}_{Kind}_{ISSUER}
//   tax_document        04_Studio-Records/REC002_Tax-HMRC/{YYYY}/     {date}_{Kind}_{ISSUER}
//   company_document    04_Studio-Records/REC003_Company/             {date}_{Kind}_{ISSUER}
//   correspondence      04_Studio-Records/REC004_Correspondence/{YYYY}/ {date}_{Kind}_{ISSUER}
//   anything else, or not sure    00_To-Check/   {date}_{Kind}_{original-name}
//
// A numbered folder (PRO/PAR/EMP/FREE/INT/VEN/COL) is reused when one already
// matches the person or company, otherwise the next number is minted. A file
// never overwrites another (Dropbox autorename), and the same bytes dropped
// twice are recognised and not filed again.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2'
import { requireInternalOrAdmin } from '../_shared/cronAuth.ts'
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, SALES_MODEL, TRANSIENT_STATUSES } from '../_shared/anthropicModel.ts'

// deno-lint-ignore no-explicit-any
type SB = any

const ADMIN_ROOT = '/03_Portal_Admin_Docs'
const TO_CHECK = `${ADMIN_ROOT}/00_To-Check`
const AGREEMENTS = `${ADMIN_ROOT}/01_Agreements`
const INVOICES = `${ADMIN_ROOT}/03_Invoices`
const RECORDS = `${ADMIN_ROOT}/04_Studio-Records`

const INBOX_MODEL = 'claude-opus-5-5'
const CONFIDENCE_FLOOR = 0.6
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_PDF_BYTES = 30 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TEXT_CHARS = 120_000

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DOC_TYPES = [
  'ar_invoice', 'ap_invoice', 'freelancer_invoice', 'quotation',
  'client_project_agreement', 'client_partnership_agreement',
  'employee_document', 'payslip', 'freelancer_document', 'intern_document',
  'supplier_agreement', 'agency_agreement', 'contract_template',
  'bank_document', 'tax_document', 'company_document', 'correspondence',
  'project_material', 'other',
] as const
type DocType = typeof DOC_TYPES[number]

interface Classification {
  doc_type: DocType
  confidence: number
  summary: string
  reasoning: string
  document_date: string | null
  period: string | null
  kind: string | null
  counterparty_name: string | null
  client_code: string | null
  person_first_name: string | null
  person_last_name: string | null
  document_number: string | null
  description: string | null
  gross_amount: number | null
  currency: string | null
  signed: boolean | null
}

// ── Naming helpers ──────────────────────────────────────────────────────────

const deaccent = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** "Kieran Tait" → "Kieran-Tait"; keeps case, strips anything unsafe. */
function hyphenSlug(s: string | null | undefined, maxWords = 6): string {
  return deaccent(s ?? '').replace(/&/g, 'and').replace(/[^A-Za-z0-9]+/g, ' ').trim()
    .split(/\s+/).filter(Boolean).slice(0, maxWords).join('-').slice(0, 60)
}

const LEGAL_SUFFIX = /^(ltd|limited|llc|inc|plc|llp|sarl|sas|gmbh|bv|sa|co|company|studio|studios|the|uk|international)$/i

/** First 1–2 meaningful words, uppercased — the AR CLIENT token. */
function clientToken(name: string | null): string {
  const tokens = deaccent(name ?? '').replace(/\([^)]*\)/g, ' ').replace(/&/g, 'and').split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean).filter((t) => !LEGAL_SUFFIX.test(t))
  return tokens.slice(0, 2).join('-').toUpperCase() || 'CLIENT'
}

/** First meaningful word, uppercased — the AP VENDOR token. */
function vendorToken(name: string | null): string {
  const tokens = deaccent(name ?? '').replace(/&/g, 'and').trim().split(/\s+/).filter(Boolean)
  if (tokens.length > 1 && /^(the|le|la)$/i.test(tokens[0])) tokens.shift()
  return (tokens[0] ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 14) || 'VENDOR'
}

function numberToken(s: string | null): string {
  if (!s || !s.trim()) return 'NOINV'
  return s.replace(/[\s_/\\:*?"<>|]+/g, '-').replace(/[^A-Za-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'NOINV'
}

function amountToken(gross: number | null, currency: string | null): string {
  const n = (Number(gross) || 0).toFixed(2).replace('.', '-')
  const ccy = (currency || 'GBP').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'GBP'
  return `${n}${ccy}`
}

function isoDate(s: string | null): string | null {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const mo = +m[2], d = +m[3]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function yearMonth(s: string | null): string | null {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})/)
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}` : null
}

const monthFolder = (prefix: string, ym: string) => `${prefix}_${ym}_${MONTH_NAMES[+ym.slice(5, 7) - 1]}`
const monYY = (ym: string) => `${MONTH_ABBR[+ym.slice(5, 7) - 1]}${ym.slice(2, 4)}`

function extOf(filename: string): string {
  const m = filename.match(/\.([A-Za-z0-9]{1,8})$/)
  return m ? m[1].toLowerCase() : 'bin'
}

// ── Dropbox ─────────────────────────────────────────────────────────────────

interface Dbx { token: string; ns: string | null }

async function dropbox(sb: SB): Promise<Dbx> {
  const { data: conn } = await sb.from('dropbox_connections')
    .select('id, access_token, refresh_token, token_expires_at')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!conn) throw new Error('Dropbox is not connected')
  let token = conn.access_token as string
  if (conn.token_expires_at && new Date(conn.token_expires_at as string).getTime() < Date.now() + 60_000) {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${Deno.env.get('DROPBOX_APP_KEY')}:${Deno.env.get('DROPBOX_APP_SECRET')}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token as string }),
    })
    if (!res.ok) throw new Error('Dropbox token refresh failed')
    const d = await res.json()
    token = d.access_token
    await sb.from('dropbox_connections').update({
      access_token: d.access_token,
      token_expires_at: d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null,
    }).eq('id', conn.id)
  }
  const acct = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  const ns = acct.ok ? ((await acct.json())?.root_info?.root_namespace_id ?? null) : null
  return { token, ns }
}

function dbxHeaders(d: Dbx, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${d.token}`,
    ...(d.ns ? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: d.ns }) } : {}),
    ...extra,
  }
}

/** Folder names (not paths) directly inside `path`; [] when it doesn't exist. */
async function listFolders(d: Dbx, path: string): Promise<string[]> {
  const names: string[] = []
  const headers = dbxHeaders(d, { 'Content-Type': 'application/json' })
  let r = await fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers, body: JSON.stringify({ path, limit: 2000 }) })
  if (!r.ok) return names
  let data = await r.json()
  for (;;) {
    for (const e of data.entries ?? []) if (e['.tag'] === 'folder') names.push(e.name)
    if (!data.has_more) break
    r = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', { method: 'POST', headers, body: JSON.stringify({ cursor: data.cursor }) })
    if (!r.ok) break
    data = await r.json()
  }
  return names
}

async function upload(d: Dbx, path: string, bytes: Uint8Array): Promise<string> {
  const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: dbxHeaders(d, {
      'Content-Type': 'application/octet-stream',
      // add + autorename: a name collision becomes "name (1).pdf", never an overwrite.
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'add', autorename: true, mute: true }),
    }),
    body: bytes as BodyInit,
  })
  if (!r.ok) throw new Error(`Dropbox upload ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return (await r.json()).path_display ?? path
}

async function move(d: Dbx, from: string, to: string): Promise<string> {
  const r = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
    method: 'POST',
    headers: dbxHeaders(d, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ from_path: from, to_path: to, autorename: true }),
  })
  if (!r.ok) throw new Error(`Dropbox move ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return (await r.json())?.metadata?.path_display ?? to
}

/**
 * Reuse the numbered folder whose name matches, else mint the next number.
 * `extraForNumbering` holds sibling folders (e.g. _Legacy) that count toward
 * the sequence but are never reused.
 */
function numberedFolder(existing: string[], prefix: string, nameSlug: string, matchKeys: string[], extraForNumbering: string[] = []): string {
  const re = new RegExp(`^${prefix}(\\d+)_`, 'i')
  const keys = matchKeys.map((k) => k.toLowerCase()).filter(Boolean)
  const tail = (f: string) => f.replace(re, '').toLowerCase()
  const exact = existing.find((f) => re.test(f) && keys.some((k) => tail(f) === k))
  if (exact) return exact
  const loose = existing.find((f) => re.test(f) && keys.some((k) => k.length >= 4 && (tail(f).includes(k) || tail(f).split('_').includes(k))))
  if (loose) return loose
  let max = 0
  for (const f of [...existing, ...extraForNumbering]) { const m = f.match(re); if (m) max = Math.max(max, +m[1]) }
  return `${prefix}${String(max + 1).padStart(3, '0')}_${nameSlug}`
}

// ── Reading the file ────────────────────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
const TEXT_EXT = new Set(['txt', 'csv', 'tsv', 'md', 'json', 'xml', 'html', 'htm', 'eml', 'rtf', 'ics', 'vcf', 'log'])

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const xmlText = (xml: string) => xml
  .replace(/<\/(w:p|a:p|row)>/g, '\n').replace(/<(w:tab|w:br)\/>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim()

/** Text out of Office Open XML (docx / xlsx / pptx). null when not readable. */
function officeText(bytes: Uint8Array, ext: string): string | null {
  try {
    const files = unzipSync(bytes, {
      filter: (f) => ext === 'docx' ? /^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name)
        : ext === 'xlsx' ? /^xl\/(sharedStrings|workbook)\.xml$/.test(f.name)
        : /^ppt\/slides\/slide\d+\.xml$/.test(f.name),
    })
    const names = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const text = names.map((n) => xmlText(strFromU8(files[n]))).join('\n\n')
    return text.trim() ? text : null
  } catch { return null }
}

/** The content blocks Claude reads, plus a note on how much of the file it saw. */
function contentFor(bytes: Uint8Array, filename: string, mime: string): { blocks: unknown[]; seen: string } {
  const ext = extOf(filename)
  if ((mime === 'application/pdf' || ext === 'pdf') && bytes.length <= MAX_PDF_BYTES) {
    return { blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(bytes) } }], seen: 'the full PDF' }
  }
  if (IMAGE_MIME[ext] && bytes.length <= MAX_IMAGE_BYTES) {
    return { blocks: [{ type: 'image', source: { type: 'base64', media_type: IMAGE_MIME[ext], data: b64(bytes) } }], seen: 'the image' }
  }
  let text: string | null = null
  if (['docx', 'xlsx', 'pptx'].includes(ext)) text = officeText(bytes, ext)
  else if (TEXT_EXT.has(ext) || mime.startsWith('text/')) text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (text) {
    const clipped = text.length > MAX_TEXT_CHARS
    return {
      blocks: [{ type: 'text', text: `<document_text>\n${text.slice(0, MAX_TEXT_CHARS)}\n</document_text>` }],
      seen: clipped ? `the first ${MAX_TEXT_CHARS} characters of its text` : 'its full text',
    }
  }
  return { blocks: [], seen: 'only the filename and size (the contents could not be read)' }
}

// ── Classification ──────────────────────────────────────────────────────────

const nullable = (type: string) => ({ type: [type, 'null'] })
const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_type', 'confidence', 'summary', 'reasoning', 'document_date', 'period', 'kind', 'counterparty_name',
    'client_code', 'person_first_name', 'person_last_name', 'document_number', 'description', 'gross_amount', 'currency', 'signed'],
  properties: {
    doc_type: { type: 'string', enum: [...DOC_TYPES] },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    reasoning: { type: 'string' },
    document_date: nullable('string'),
    period: nullable('string'),
    kind: nullable('string'),
    counterparty_name: nullable('string'),
    client_code: nullable('string'),
    person_first_name: nullable('string'),
    person_last_name: nullable('string'),
    document_number: nullable('string'),
    description: nullable('string'),
    gross_amount: nullable('number'),
    currency: nullable('string'),
    signed: nullable('boolean'),
  },
}

function systemPrompt(ctx: { clients: string; team: string }): string {
  return `You file documents for Silver Shadow Studio (Silvershadow Studio Limited), a London CGI and architectural-visualisation studio. A director has dropped a document into the studio's inbox. Read it, decide what it is, and extract the fields its filename is built from. The filename and folder are built by code from your answer, so precision matters more than prose.

The studio's own name never appears as the counterparty. Direction matters: an invoice the studio ISSUED to a client is ar_invoice; an invoice or receipt the studio RECEIVED from a supplier is ap_invoice; an invoice from a freelance team member (modeller, scene manager, photographer, assistant) for their work is freelancer_invoice.

Document types:
- ar_invoice: invoice issued by the studio to a client. counterparty_name = client. document_number = invoice number.
- ap_invoice: supplier invoice, bill or receipt the studio pays (software, rent, food, accountant, hardware, travel). counterparty_name = supplier. description = what was bought in 2 to 5 words.
- freelancer_invoice: invoice from a freelancer to the studio. person = the freelancer. period = the month worked (YYYY-MM).
- quotation: a studio quotation or fee proposal / programme to a client. document_number = quotation number (e.g. ZAN003, MAY001-RCN02). signed = true only if the client has signed or accepted it.
- client_project_agreement / client_partnership_agreement: services agreement with a client, per-project or partnership/subscription.
- employee_document: anything about an EMPLOYEE (employment contract, variation letter, HMRC starter checklist, P45, P60, equipment loan, recommendation, termination or disciplinary letter). person = the employee.
- payslip: an employee's monthly payslip. person = the employee. period = pay month (YYYY-MM).
- freelancer_document: agreement, scope of work, letter or onboarding paper for a FREELANCER. person = the freelancer.
- intern_document: agreement or paper for an intern.
- supplier_agreement: contract with a supplier or vendor (accountant, landlord, software). agency_agreement: collaboration agreement with an agency or another studio.
- contract_template: a blank, unfilled template.
- bank_document: bank statements, bank letters. tax_document: HMRC, VAT, corporation tax, PAYE, Companies House filings about tax. company_document: incorporation, Companies House, insurance, leases, licences, registrations. correspondence: any other letter or email to the studio worth keeping.
- project_material: briefs, drawings, plans, mood boards, reference images or renders for a client project.
- other: none of the above.

Fields:
- kind: what the document is, in 1 to 4 Title-Case words joined by hyphens, in the studio's style: Agreement-Employment, Agreement-Freelance, Agreement-Internship, Variation-Letter, HMRC-Starter-Checklist, Equipment-Loan-Agreement, Letter-Termination, Letter-Recommendation, Scope-of-Work, P60, Bank-Statement, VAT-Return, Insurance-Certificate, Brief, Floor-Plan.
- document_date: the date on the document (issue / signing / statement date) as YYYY-MM-DD, or null if none.
- client_code: for client documents, the code of the matching client below; if the client is not listed, propose a three-letter code from their name.
- person_first_name / person_last_name: for people documents, as written on the document; match the team list below where it is clearly the same person.
- gross_amount + currency: total including VAT, as a number, with the ISO currency code.
- signed: true when the document carries the counterparty's signature (or is marked signed/accepted), false when it is unsigned or merely sent, null when not applicable.
- summary: one plain sentence a director would recognise, e.g. "Adobe Creative Cloud subscription for July 2026, £31.19."
- reasoning: one sentence on why this type.
- confidence: 0 to 1, how sure you are of the doc_type and the key fields together. Below 0.6 means a person should check it.

Known clients (name — code):
${ctx.clients || '(none)'}

Studio team (name — role):
${ctx.team || '(none)'}`
}

async function classify(blocks: unknown[], filename: string, sizeBytes: number, seen: string, system: string): Promise<{ c: Classification; model: string }> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) throw new Error('Anthropic API key not configured')
  const content = [
    ...blocks,
    { type: 'text', text: `Filename: ${filename}\nSize: ${Math.round(sizeBytes / 1024)} KB\nYou can see ${seen}.\n\nClassify this document.` },
  ]
  // Primary: current Opus with server-side refusal fallback. If the key or the
  // beta rejects that request shape, retry on the model the rest of the
  // project has verified against this key.
  const attempts: { model: string; extra: Record<string, unknown>; beta?: string }[] = [
    { model: INBOX_MODEL, extra: { fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA } } }, beta: 'server-side-fallback-2026-07-01' },
    { model: SALES_MODEL, extra: { output_config: { format: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA } } } },
  ]
  let lastError = ''
  for (const a of attempts) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
          ...(a.beta ? { 'anthropic-beta': a.beta } : {}),
        },
        body: JSON.stringify({ model: a.model, max_tokens: 16000, system, messages: [{ role: 'user', content }], ...a.extra }),
      })
      const raw = await res.text()
      if (res.ok) {
        const data = JSON.parse(raw)
        if (data.stop_reason === 'refusal') { lastError = 'The model declined to read this document'; break }
        const text = (data.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
        return { c: JSON.parse(text) as Classification, model: data.model ?? a.model }
      }
      lastError = `Anthropic ${res.status}: ${raw.slice(0, 300)}`
      if (/credit balance is too low/i.test(raw)) throw new Error('Anthropic API credits are exhausted — top up in the Anthropic Console, then drop the file again.')
      if (!TRANSIENT_STATUSES.includes(res.status)) break
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw new Error(lastError || 'Classification failed')
}

// ── Path building (the strategy, in code) ───────────────────────────────────

interface Ctx { dbx: Dbx; clients: { name: string; code: string | null }[] }

const signedTag = (c: Classification) => (c.signed ? 'SIGNED' : 'SENT')

async function personFolder(ctx: Ctx, base: string, prefix: string, c: Classification): Promise<string | null> {
  const name = hyphenSlug([c.person_first_name, c.person_last_name].filter(Boolean).join(' '))
  if (!name) return null
  const existing = await listFolders(ctx.dbx, base)
  const last = hyphenSlug(c.person_last_name ?? '')
  return `${base}/${numberedFolder(existing, prefix, name, [name, last.length >= 4 ? last : ''])}`
}

/** The client's folder, and the code to name files with (an existing folder's own code wins). */
async function clientFolder(ctx: Ctx, base: string, prefix: string, code: string, clientName: string): Promise<{ path: string; code: string }> {
  const existing = await listFolders(ctx.dbx, base)
  const legacy = await listFolders(ctx.dbx, `${base}/_Legacy`)
  // Folders read {PREFIX}{NNN}_{CODE}_{Client-Name}. The portal's code and the
  // Dropbox code can differ (Rose Uniacke is RUS in the portal, UNI here), so
  // a folder matches on either the code or the client's name.
  const nameKey = clientToken(clientName).toLowerCase()
  const re = new RegExp(`^${prefix}\\d+_([A-Za-z0-9]+)_(.+)$`, 'i')
  const match = existing.find((f) => { const m = f.match(re); return !!m && m[1].toUpperCase() === code })
    ?? existing.find((f) => { const m = f.match(re); return !!m && m[2].toLowerCase() === nameKey })
  if (match) return { path: `${base}/${match}`, code: match.match(re)![1].toUpperCase() }
  let max = 0
  for (const f of [...existing, ...legacy]) { const m = f.match(new RegExp(`^${prefix}(\\d+)_`, 'i')); if (m) max = Math.max(max, +m[1]) }
  const display = nameKey.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-') || code
  return { path: `${base}/${prefix}${String(max + 1).padStart(3, '0')}_${code}_${display}`, code }
}

async function supplierFolder(ctx: Ctx, base: string, prefix: string, name: string): Promise<string> {
  const existing = await listFolders(ctx.dbx, base)
  const slug = hyphenSlug(name, 3)
  return `${base}/${numberedFolder(existing, prefix, slug, [slug, hyphenSlug(name, 1)])}`
}

/** Resolve the client code: a listed client's code wins over the model's guess. */
function resolveClient(ctx: Ctx, c: Classification): { code: string; name: string } {
  const guess = (c.client_code ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  const byCode = ctx.clients.find((k) => k.code && k.code.toUpperCase() === guess)
  const key = clientToken(c.counterparty_name)
  const byName = ctx.clients.find((k) => clientToken(k.name) === key)
  const hit = byCode ?? byName
  const code = (hit?.code ?? guess).slice(0, 5) || clientToken(c.counterparty_name).replace(/-/g, '').slice(0, 3)
  return { code, name: c.counterparty_name ?? hit?.name ?? code }
}

/** Folder + filename stem (no extension). null → it goes to To-Check. */
async function planPath(ctx: Ctx, c: Classification, original: string): Promise<{ folder: string; stem: string } | null> {
  const today = new Date().toISOString().slice(0, 10)
  const date = isoDate(c.document_date)
  const d = date ?? today
  const ym = yearMonth(c.period) ?? yearMonth(date)
  const person = hyphenSlug([c.person_first_name, c.person_last_name].filter(Boolean).join(' '))
  const kind = hyphenSlug(c.kind, 4) || 'Document'
  const issuer = clientToken(c.counterparty_name)
  const personDoc = (folder: string | null, signedSuffix = true) =>
    folder && person ? { folder, stem: [person, kind, date, signedSuffix && c.signed ? 'SIGNED' : null].filter(Boolean).join('_') } : null

  switch (c.doc_type) {
    case 'ar_invoice':
      if (!ym || !c.counterparty_name) return null
      return {
        folder: `${INVOICES}/INV001_Receivable/${monthFolder('Invoices-Outgoing', ym)}`,
        stem: [d, 'AR', clientToken(c.counterparty_name), numberToken(c.document_number), amountToken(c.gross_amount, c.currency)].join('_'),
      }
    case 'ap_invoice':
      if (!ym || !c.counterparty_name) return null
      return {
        folder: `${INVOICES}/INV002_Payable/02_Overheads/${monthFolder('Overheads', ym)}`,
        stem: [d, 'AP', vendorToken(c.counterparty_name), numberToken(c.document_number),
          [hyphenSlug(c.description, 5) || 'Expense', monYY(ym)].join('-'), amountToken(c.gross_amount, c.currency)].join('_'),
      }
    case 'freelancer_invoice':
      if (!ym || !person) return null
      return { folder: `${INVOICES}/INV002_Payable/01_Freelancers/${monthFolder('Freelancers', ym)}`, stem: `Freelancer_Invoice_${person}_${ym}` }
    case 'quotation': {
      if (!c.document_number) return null
      const { code } = resolveClient(ctx, c)
      return { folder: `${ADMIN_ROOT}/02_Quotations`, stem: [code || 'SilverShadowStudio', 'Quotation', numberToken(c.document_number), d, signedTag(c)].join('_') }
    }
    case 'client_project_agreement':
    case 'client_partnership_agreement': {
      if (!c.counterparty_name) return null
      const client = resolveClient(ctx, c)
      const project = c.doc_type === 'client_project_agreement'
      const base = `${AGREEMENTS}/AGR001_Clients/${project ? 'CLI001_Project-Agreements' : 'CLI002_Partnership-Agreements'}`
      const { path, code } = await clientFolder(ctx, base, project ? 'PRO' : 'PAR', client.code, client.name)
      return { folder: path, stem: [code, project ? 'Agreement-Project' : 'Agreement-Partnership', d, signedTag(c)].join('_') }
    }
    case 'payslip': {
      if (!ym) return null
      const f = await personFolder(ctx, `${AGREEMENTS}/AGR002_Employees`, 'EMP', c)
      return f && person ? { folder: `${f}/Payslips`, stem: `${person}_Payslip_${ym}` } : null
    }
    case 'employee_document':
      return personDoc(await personFolder(ctx, `${AGREEMENTS}/AGR002_Employees`, 'EMP', c))
    case 'freelancer_document':
      return personDoc(await personFolder(ctx, `${AGREEMENTS}/AGR003_Freelancers`, 'FREE', c))
    case 'intern_document':
      return personDoc(await personFolder(ctx, `${AGREEMENTS}/AGR005_Interns`, 'INT', c))
    case 'supplier_agreement':
    case 'agency_agreement': {
      if (!c.counterparty_name) return null
      const vendor = c.doc_type === 'supplier_agreement'
      const base = `${AGREEMENTS}/AGR004_Suppliers/${vendor ? 'SUP001_Vendor-Agreements' : 'SUP002_Agency-Collaboration-Agreements'}`
      const name = hyphenSlug(c.counterparty_name, 3)
      return {
        folder: await supplierFolder(ctx, base, vendor ? 'VEN' : 'COL', c.counterparty_name),
        stem: [name, vendor ? 'Agreement-Supplier' : 'Agreement-Agency-Collaboration', d, signedTag(c)].join('_'),
      }
    }
    case 'contract_template':
      return { folder: `${AGREEMENTS}/AGR000_Templates`, stem: `SS-${kind}` }
    case 'bank_document':
      return { folder: `${RECORDS}/REC001_Banking/${d.slice(0, 4)}`, stem: [d, kind, issuer].join('_') }
    case 'tax_document':
      return { folder: `${RECORDS}/REC002_Tax-HMRC/${d.slice(0, 4)}`, stem: [d, kind, issuer].join('_') }
    case 'company_document':
      return { folder: `${RECORDS}/REC003_Company`, stem: [d, kind, issuer].join('_') }
    case 'correspondence':
      return { folder: `${RECORDS}/REC004_Correspondence/${d.slice(0, 4)}`, stem: [d, kind, issuer].join('_') }
    default:
      return null
  }
}

function toCheckStem(c: Classification | null, original: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const base = hyphenSlug(original.replace(/\.[^.]+$/, ''), 8) || 'Document'
  const kind = c ? hyphenSlug(c.kind, 4) : ''
  return [isoDate(c?.document_date ?? null) ?? today, kind, base].filter(Boolean).join('_')
}

// ── Handler ─────────────────────────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function callerId(req: Request, sb: SB): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return null
  const { data } = await sb.auth.getUser(token)
  return data?.user?.id ?? null
}

async function fileOne(req: Request, sb: SB): Promise<Record<string, unknown>> {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'No file in the upload' }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: `${file.name} is over ${MAX_FILE_BYTES / 1024 / 1024} MB` }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const filename = file.name || 'document'
  const mime = file.type || 'application/octet-stream'
  const hash = await sha256Hex(bytes)
  const createdBy = await callerId(req, sb)
  // dry_run=1 (service callers only): classify and plan, write nothing anywhere.
  const dryRun = form.get('dry_run') === '1' && createdBy === null

  // Same bytes already filed → don't file twice; point at the existing copy.
  const { data: prior } = dryRun ? { data: null } : await sb.from('document_inbox').select('id, dropbox_path')
    .eq('sha256', hash).in('status', ['filed', 'to_check']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (prior) {
    const { data: row } = await sb.from('document_inbox').insert({
      created_by: createdBy, original_filename: filename, mime_type: mime, size_bytes: bytes.length, sha256: hash,
      status: 'duplicate', dropbox_path: prior.dropbox_path, summary: 'Already filed — this exact file was dropped before.',
    }).select().single()
    return { ok: true, row }
  }

  const { data: row, error: insErr } = dryRun ? { data: { id: 'dry-run' }, error: null } : await sb.from('document_inbox').insert({
    created_by: createdBy, original_filename: filename, mime_type: mime, size_bytes: bytes.length, sha256: hash, status: 'processing',
  }).select('id').single()
  if (insErr || !row) return { ok: false, error: `Could not record the upload: ${insErr?.message}` }
  const finish = async (fields: Record<string, unknown>) => {
    if (dryRun) return { ok: fields.status !== 'failed', row: fields, error: fields.error_text }
    const { data } = await sb.from('document_inbox').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', row.id).select().single()
    return { ok: fields.status !== 'failed', row: data, error: fields.error_text }
  }

  try {
    const [dbx, clientsRes, teamRes] = await Promise.all([
      dropbox(sb),
      sb.from('accounts').select('company_name, client_code, account_type').neq('account_type', 'team').is('archived_at', null),
      sb.from('accounts').select('company_name, employment_type, position').eq('account_type', 'team'),
    ])
    const clients: { name: string; code: string | null }[] = (clientsRes.data ?? []).map((a: Record<string, unknown>) => ({ name: a.company_name as string, code: (a.client_code as string | null) ?? null }))
    const system = systemPrompt({
      clients: clients.map((k) => `${k.name} — ${k.code ?? 'no code'}`).join('\n'),
      team: (teamRes.data ?? []).map((t: Record<string, unknown>) => `${t.company_name} — ${t.employment_type ?? 'team'}${t.position ? `, ${t.position}` : ''}`).join('\n'),
    })

    const { blocks, seen } = contentFor(bytes, filename, mime)
    const { c, model } = await classify(blocks, filename, bytes.length, seen, system)
    const ext = extOf(filename)

    const confident = c.confidence >= CONFIDENCE_FLOOR
    const plan = confident ? await planPath({ dbx, clients }, c, filename) : null
    const target = plan ? `${plan.folder}/${plan.stem}.${ext}` : `${TO_CHECK}/${toCheckStem(c, filename)}.${ext}`
    const path = dryRun ? target : await upload(dbx, target, bytes)
    return await finish({
      status: plan ? 'filed' : 'to_check', doc_type: c.doc_type, confidence: c.confidence, summary: c.summary,
      reasoning: plan ? c.reasoning : `${c.reasoning} ${confident ? 'Missing a detail its filename needs' : 'Not confident enough to file it'} — parked in To-Check.`,
      extracted: c, dropbox_path: path, model,
    })
  } catch (err) {
    return await finish({ status: 'failed', error_text: err instanceof Error ? err.message : String(err) })
  }
}

export async function handleInbox(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  const auth = await requireInternalOrAdmin(req, { corsHeaders })
  if (!auth.ok) return auth.response
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      return json(await fileOne(req, sb))
    }
    const body = await req.json().catch(() => ({})) as { op?: string; id?: string; path?: string }

    if (body.op === 'tree') {
      const dbx = await dropbox(sb)
      const out: string[] = []
      const headers = dbxHeaders(dbx, { 'Content-Type': 'application/json' })
      let r = await fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers, body: JSON.stringify({ path: ADMIN_ROOT, recursive: true, limit: 2000 }) })
      let d = r.ok ? await r.json() : { entries: [] }
      for (;;) {
        for (const e of d.entries ?? []) if (e['.tag'] === 'folder') out.push(e.path_display)
        if (!d.has_more || out.length > 5000) break
        r = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', { method: 'POST', headers, body: JSON.stringify({ cursor: d.cursor }) })
        if (!r.ok) break
        d = await r.json()
      }
      return json({ ok: true, folders: out.sort() })
    }

    if (body.op === 'move') {
      const to = (body.path ?? '').trim().replace(/\/+/g, '/')
      if (!body.id || !to) return json({ ok: false, error: 'id and path required' }, 400)
      if (!to.toLowerCase().startsWith(ADMIN_ROOT.toLowerCase() + '/') || to.includes('..')) {
        return json({ ok: false, error: `Documents can only be filed under ${ADMIN_ROOT}` }, 400)
      }
      const { data: row } = await sb.from('document_inbox').select('id, dropbox_path, moved_from').eq('id', body.id).maybeSingle()
      if (!row?.dropbox_path) return json({ ok: false, error: 'Nothing filed for that document' }, 404)
      const dbx = await dropbox(sb)
      const path = await move(dbx, row.dropbox_path as string, to)
      const { data } = await sb.from('document_inbox').update({
        dropbox_path: path, moved_from: row.moved_from ?? row.dropbox_path, status: 'filed', updated_at: new Date().toISOString(),
      }).eq('id', row.id).select().single()
      return json({ ok: true, row: data })
    }

    return json({ ok: false, error: 'Unknown op' }, 400)
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
}
