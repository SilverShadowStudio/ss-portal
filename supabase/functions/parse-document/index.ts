import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png']
// Primary model with PDF/image document support; fall back to the alias proven
// in parse-signature if the primary errors.
const PRIMARY_MODEL = 'claude-sonnet-4-6'
const FALLBACK_MODEL = 'claude-sonnet-4-5'

const INVOICE_SCHEMA = `{
  "client_name": "string",
  "client_company": "string",
  "client_address": "string",
  "client_contact_name": "string",
  "project_code": "string",
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "line_items": [ { "description": "string", "amount_net": number } ],
  "net_total": number,
  "vat_rate": number,
  "vat_amount": number,
  "gross_total": number,
  "currency": "GBP" | "EUR" | "USD",
  "downpayment_percent": number | null,
  "downpayment_amount": number | null,
  "invoice_kind": "deposit" | "balance" | "standalone"
}`

const QUOTATION_SCHEMA = `{
  "client_name": "string",
  "client_company": "string",
  "client_address": "string",
  "client_contact_name": "string",
  "client_company_number": "string",
  "project_code": "string",
  "quotation_number": "string",
  "quotation_date": "YYYY-MM-DD",
  "scope_groups": [ { "label": "string", "unit_price": number, "unit_count": number, "scenes": ["string"] } ],
  "net_total": number,
  "vat_rate": number,
  "vat_amount": number,
  "gross_total": number,
  "currency": "GBP" | "EUR" | "USD"
}`

// Overhead = an invoice RECEIVED by the studio (an expense we pay). Different
// role from invoice/quotation, which are outbound documents we send.
const OVERHEAD_SCHEMA = `{
  "supplier_name": "string",
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD" | null,
  "description": "string" | null,
  "net_total": number,
  "vat_amount": number,
  "gross_total": number,
  "currency": "GBP" | "EUR" | "USD",
  "already_paid": boolean | null,
  "payment_date": "YYYY-MM-DD" | null,
  "category_code": "string" | null
}`

// Employment / freelance engagement contract → personal details to pre-fill a
// new team member's onboarding. Contracts carry name/role/pay/dates but usually
// NOT home address or bank details, so those default to null.
const AGREEMENT_SCHEMA = `{
  "first_name": "string" | null,
  "last_name": "string" | null,
  "position": "string" | null,
  "employment_type": "employee" | "freelancer" | null,
  "salary_amount": number | null,
  "salary_period": "annual" | "monthly" | "daily" | "hourly" | null,
  "salary_currency": "GBP" | "EUR" | "USD" | null,
  "gross_salary_annual": number | null,
  "start_date": "YYYY-MM-DD" | null,
  "signing_date": "YYYY-MM-DD" | null,
  "email": "string" | null,
  "phone": "string" | null,
  "address": "string" | null
}`

// Monthly PAYE payslip → the actual net pay and employer cost, to true-up the
// salary forecast. Employer NI / employer pension may not appear on every
// payslip (they're sometimes only on the employer's payroll report).
const PAYSLIP_SCHEMA = `{
  "employee_name": "string" | null,
  "period_label": "string" | null,
  "period_end": "YYYY-MM-DD" | null,
  "gross": number | null,
  "income_tax": number | null,
  "employee_ni": number | null,
  "student_loan": number | null,
  "employee_pension": number | null,
  "net": number | null,
  "employer_ni": number | null,
  "employer_pension": number | null
}`

interface CategoryChoice { code: string; name: string }

type DocumentType = 'invoice' | 'quotation' | 'overhead' | 'agreement' | 'payslip'

function formatCategoryList(categories: CategoryChoice[]): string {
  return categories
    .map((c) => `  ${c.code}: ${c.name}`)
    .join('\n')
}

function systemPrompt(documentType: DocumentType, categories?: CategoryChoice[]): string {
  if (documentType === 'overhead') {
    return (
      `You are a data extractor for INVOICES RECEIVED by a CGI / architectural-visualisation studio. ` +
      `These are expense/overhead documents — bills, receipts, or invoices ISSUED BY suppliers TO the studio. ` +
      `Extract fields into JSON matching EXACTLY this schema:\n` +
      `${OVERHEAD_SCHEMA}\n\n` +
      `Field semantics:\n` +
      `- supplier_name = the entity that ISSUED the invoice (the vendor/supplier), NOT the recipient. ` +
      `On a document billed to a studio, the supplier is whoever's name or logo is at the top ` +
      `(e.g. Adobe Inc, Uber, an accountant, a freelancer).\n` +
      `- gross_total = the FULL HEADLINE AMOUNT the studio paid on this invoice (the total ` +
      `spend, including any zero-rated / VAT-exempt items). On a delivery receipt where food ` +
      `is zero-rated and only a service fee is standard-rated, gross_total is the WHOLE order ` +
      `total (e.g. £21.09), NOT just the tax-invoice slice (£2.09).\n` +
      `- vat_amount = the ACTUAL VAT CHARGED on the invoice. On mixed-VAT documents, read this ` +
      `from the TAX INVOICE / VAT BREAKDOWN section — it is often much smaller than ` +
      `gross_total × 20% because part of the order is zero-rated (e.g. £0.35 on a £21.09 ` +
      `Deliveroo order where only the £1.74 service fee is VATable at 20%).\n` +
      `- net_total = gross_total − vat_amount. Compute this yourself; do not read it from the ` +
      `document if there's any ambiguity. This is the studio's spend excluding claimable VAT.\n` +
      `- If the document clearly shows it has been PAID (words like "PAID", "SETTLED", "RECEIPT", ` +
      `explicit payment date, zero balance due), set already_paid=true and payment_date to the ` +
      `visible payment date. If paid but no payment date is visible, set already_paid=true and ` +
      `payment_date=null.\n` +
      `- If the document has a future due date and no payment indicator, set already_paid=false ` +
      `and payment_date=null.\n` +
      (categories && categories.length > 0
        ? `- category_code = the SINGLE BEST-FIT code from the list below, chosen based on the ` +
          `supplier and any visible line items. Return the exact code string (e.g. "429"), not the ` +
          `name. Common mappings: food or drink delivery → Entertainment (or the closest food/staff ` +
          `catering category); rent / workspace / office lease → Rent; cloud services, SaaS, ` +
          `software subscriptions → Computer Software; internet or phone → Telecommunications; ` +
          `office supplies / stationery → Office Expenses; travel (Uber, trains, flights) → ` +
          `Travel; accountant, lawyer, consultant → Professional Fees. If nothing clearly fits, ` +
          `return null. Available categories:\n${formatCategoryList(categories)}\n`
        : ``) +
      `- Return null for any field that cannot be determined from the document.\n\n` +
      `Return ONLY valid JSON matching this exact schema. No markdown, no explanation. ` +
      `Numbers as JSON numbers, not strings. Dates as ISO YYYY-MM-DD.`
    )
  }
  if (documentType === 'agreement') {
    return (
      `You are a data extractor for EMPLOYMENT and FREELANCE engagement CONTRACTS at a CGI / ` +
      `architectural-visualisation studio. Read the attached signed agreement and extract the ` +
      `contracted person's details into JSON matching EXACTLY this schema:\n` +
      `${AGREEMENT_SCHEMA}\n\n` +
      `Field semantics:\n` +
      `- first_name / last_name = the individual being engaged (the employee or contractor), NOT ` +
      `the studio, a director, or a witness.\n` +
      `- position = their job title or role (e.g. "Production Director", "Scene Manager").\n` +
      `- employment_type = "employee" if it is a contract/statement of employment (salary, PAYE, ` +
      `holiday, notice period); "freelancer" if it is a contractor/services agreement (fees, ` +
      `self-employed, invoices). Infer from the document's nature.\n` +
      `- salary_amount = the headline pay figure stated, as a number. salary_period = its cadence ` +
      `("annual" for "per annum", else "monthly" / "daily" / "hourly"). Salaries are GROSS.\n` +
      `- gross_salary_annual = the annual gross figure. If pay is stated per annum, copy it here. ` +
      `If stated monthly, multiply by 12. Only set this for employees; leave null for freelancers ` +
      `paid per work. If a contract states an initial rate then a later increase, use the LATER ` +
      `(ongoing) figure.\n` +
      `- start_date = commencement / engagement start date. signing_date = the date the agreement ` +
      `was signed (may differ from start_date).\n` +
      `- email / phone / address = the person's contact details ONLY if explicitly present. ` +
      `Contracts usually do NOT include a home address or bank details — return null when absent; ` +
      `never guess.\n` +
      `- Return null for any field that cannot be determined from the document.\n\n` +
      `Return ONLY valid JSON matching this exact schema. No markdown, no explanation. ` +
      `Numbers as JSON numbers, not strings. Dates as ISO YYYY-MM-DD.`
    )
  }
  if (documentType === 'payslip') {
    return (
      `You are a data extractor for UK PAYE PAYSLIPS. Read the attached payslip for a SINGLE pay ` +
      `period and extract its figures into JSON matching EXACTLY this schema:\n` +
      `${PAYSLIP_SCHEMA}\n\n` +
      `Field semantics (all amounts are for THIS period, not year-to-date):\n` +
      `- gross = gross pay for the period (before deductions).\n` +
      `- income_tax = PAYE income tax deducted. employee_ni = employee National Insurance ` +
      `deducted. student_loan = student loan deduction (0/null if none). employee_pension = ` +
      `the employee's pension contribution deducted.\n` +
      `- employee_name = the person the payslip is for. A "Payroll Summary" (multiple people, ` +
      `YTD columns) is NOT an individual payslip — set employee_name and net to null for those.\n` +
      `- net = net / take-home pay for the period (what the employee actually receives).\n` +
      `- employer_ni / employer_pension = the EMPLOYER's contributions, ONLY if the payslip shows ` +
      `them (often labelled "Employer NI", "Employer's NIC", "Employer Pension"). Many payslips ` +
      `do not — return null when absent, never guess.\n` +
      `- period_label = a human label for the period (e.g. "August 2025", "Month 5"). period_end = ` +
      `the pay date or period end date.\n` +
      `- Read the CURRENT-PERIOD column, not the year-to-date (YTD) column.\n` +
      `- Return null for any field that cannot be determined.\n\n` +
      `Return ONLY valid JSON matching this exact schema. No markdown, no explanation. ` +
      `Numbers as JSON numbers, not strings. Dates as ISO YYYY-MM-DD.`
    )
  }
  if (documentType === 'invoice') {
    return (
      `You are a data extractor for the SALES invoices a CGI / architectural-visualisation studio ` +
      `raises to its clients. Read the attached invoice and extract its fields into JSON matching ` +
      `EXACTLY this schema:\n${INVOICE_SCHEMA}\n\n` +
      `Field semantics:\n` +
      `- client_company / client_name = the CLIENT being billed (the recipient), NOT the studio ` +
      `(Silver Shadow Studio) which issued it.\n` +
      `- net_total / vat_amount / gross_total = the amounts on THIS invoice. gross_total is the ` +
      `headline amount due on this invoice.\n` +
      `- invoice_kind = which stage of billing this invoice is. Decide from the document's own ` +
      `wording and structure, then the numbering:\n` +
      `    • "deposit" — an upfront / advance / down-payment invoice for PART of the project value ` +
      `(look for "Deposit", "Downpayment", "Advance", "Payment on account", "50% to commence", or ` +
      `a stated downpayment_percent/amount). A balance is expected to follow.\n` +
      `    • "balance" — the remaining / final payment (look for "Balance", "Balance due", "Final ` +
      `invoice", "Remaining 50%", or text referencing a deposit already paid / less deposit).\n` +
      `    • "standalone" — a single invoice for the full amount with no deposit/balance split.\n` +
      `  Numbering convention as a secondary signal: a trailing "-A" (e.g. KAT025-A) is usually the ` +
      `deposit and "-B"/"-C" (KAT025-B) the balance. Prefer the document's wording; use the suffix ` +
      `only to break ties. If genuinely unclear, return "standalone".\n` +
      `- downpayment_percent / downpayment_amount = the deposit proportion/amount if the invoice ` +
      `states or implies one; else null.\n` +
      `- Return null for any other field that cannot be determined.\n\n` +
      `Return ONLY valid JSON matching this exact schema. No markdown, no explanation. ` +
      `Numbers as JSON numbers, not strings. Dates as ISO YYYY-MM-DD.`
    )
  }
  return (
    `You are a data extractor for a CGI / architectural-visualisation studio. ` +
    `Read the attached ${documentType} document and extract its fields into JSON matching EXACTLY this schema:\n` +
    `${QUOTATION_SCHEMA}\n\n` +
    `Return ONLY valid JSON matching this exact schema. Do not include any explanation, markdown, or commentary. ` +
    `If a field cannot be determined from the document, return null for that field. ` +
    `Numbers must be returned as JSON numbers, not strings. Dates must be ISO format (YYYY-MM-DD).`
  )
}

async function callAnthropic(
  apiKey: string,
  model: string,
  documentType: DocumentType,
  mime: string,
  base64: string,
  categories?: CategoryChoice[],
): Promise<Response> {
  const block = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mime, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      // Generous ceiling — a detailed invoice with many line items can exceed
      // 2048 tokens of JSON, which truncates the output into unparseable JSON.
      max_tokens: 4096,
      system: systemPrompt(documentType, categories),
      messages: [
        {
          role: 'user',
          content: [
            block,
            { type: 'text', text: `Extract this ${documentType}'s fields as JSON per the schema.` },
          ],
        },
      ],
    }),
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return json({ success: false, error: 'Anthropic API key not configured' }, 500)

  // Auth — caller must be a logged-in admin (mirror of parse-signature).
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'Unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return json({ success: false, error: 'Unauthorized' }, 401)
  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) return json({ success: false, error: 'Forbidden' }, 403)

  // Parse + validate body.
  let body: {
    document_type?: string
    file_data_base64?: string
    file_mime_type?: string
    categories?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400)
  }
  const documentType = body.document_type
  const base64 = body.file_data_base64
  const mime = body.file_mime_type
  if (documentType !== 'invoice' && documentType !== 'quotation' && documentType !== 'overhead' && documentType !== 'agreement' && documentType !== 'payslip') {
    return json({ success: false, error: 'document_type must be invoice, quotation, overhead, agreement, or payslip' }, 400)
  }
  if (!base64 || typeof base64 !== 'string') {
    return json({ success: false, error: 'file_data_base64 is required' }, 400)
  }
  if (!mime || !ALLOWED_MIME.includes(mime)) {
    return json({ success: false, error: 'Unsupported file type (PDF, JPEG, or PNG only)' }, 400)
  }

  // Optional category list — currently used by the 'overhead' path so Claude
  // can pick the single best-fit category directly. Defensively coerced.
  let categories: CategoryChoice[] | undefined
  if (Array.isArray(body.categories)) {
    categories = body.categories
      .filter((c): c is CategoryChoice =>
        !!c && typeof c === 'object' &&
        typeof (c as CategoryChoice).code === 'string' &&
        typeof (c as CategoryChoice).name === 'string')
      .map((c) => ({ code: c.code, name: c.name }))
  }

  // Call Claude — primary model, then fallback on any non-OK response.
  const dt = documentType as DocumentType
  let res = await callAnthropic(anthropicKey, PRIMARY_MODEL, dt, mime, base64, categories)
  if (!res.ok) {
    const primaryErr = await res.text()
    console.error(`Anthropic primary (${PRIMARY_MODEL}) error:`, primaryErr)
    res = await callAnthropic(anthropicKey, FALLBACK_MODEL, dt, mime, base64, categories)
    if (!res.ok) {
      console.error(`Anthropic fallback (${FALLBACK_MODEL}) error:`, await res.text())
      return json({ success: false, error: 'Could not read the document' }, 502)
    }
  }

  const anthropicData = await res.json()
  // Guard against a truncated response (hit max_tokens) — its JSON is incomplete.
  const stopReason: string | undefined = anthropicData.stop_reason
  const text: string = anthropicData.content?.[0]?.text ?? ''
  const raw = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim()

  // Parse defensively: direct parse, then the outermost {...} block in case the
  // model wrapped the JSON in any prose despite instructions.
  function tryParse(s: string): Record<string, unknown> | null {
    try { return JSON.parse(s); } catch { /* fall through */ }
    const first = s.indexOf('{'), last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(s.slice(first, last + 1)); } catch { /* nope */ }
    }
    return null;
  }
  const parsed = tryParse(raw);
  if (!parsed) {
    console.error(`Could not parse Anthropic response as JSON (stop_reason=${stopReason}):`, text.slice(0, 500))
    const hint = stopReason === 'max_tokens'
      ? 'The document was too long to read in one pass.'
      : 'The extracted data was not valid.'
    return json({ success: false, error: `Could not read the document — ${hint}` }, 200)
  }

  return json({ success: true, data: parsed })
})
