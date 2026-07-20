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
  "downpayment_amount": number | null
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
  "payment_date": "YYYY-MM-DD" | null
}`

type DocumentType = 'invoice' | 'quotation' | 'overhead'

function systemPrompt(documentType: DocumentType): string {
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
      `- If the document contains MULTIPLE totals — for example an order/delivery receipt where ` +
      `only a service fee or delivery portion is VATable, or a document showing both a headline ` +
      `"order total" and a separate "tax invoice" — extract net_total, vat_amount, and gross_total ` +
      `from the TAX INVOICE section (the figures on which VAT is actually accounted), NOT from ` +
      `the headline order total. The three numbers must be internally consistent ` +
      `(net_total + vat_amount = gross_total, allowing 1p rounding).\n` +
      `- If the document clearly shows it has been PAID (words like "PAID", "SETTLED", "RECEIPT", ` +
      `explicit payment date, zero balance due), set already_paid=true and payment_date to the ` +
      `visible payment date. If paid but no payment date is visible, set already_paid=true and ` +
      `payment_date=null.\n` +
      `- If the document has a future due date and no payment indicator, set already_paid=false ` +
      `and payment_date=null.\n` +
      `- Return null for any field that cannot be determined from the document.\n\n` +
      `Return ONLY valid JSON matching this exact schema. No markdown, no explanation. ` +
      `Numbers as JSON numbers, not strings. Dates as ISO YYYY-MM-DD.`
    )
  }
  const schema = documentType === 'invoice' ? INVOICE_SCHEMA : QUOTATION_SCHEMA
  return (
    `You are a data extractor for a CGI / architectural-visualisation studio. ` +
    `Read the attached ${documentType} document and extract its fields into JSON matching EXACTLY this schema:\n` +
    `${schema}\n\n` +
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
      max_tokens: 2048,
      system: systemPrompt(documentType),
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
  let body: { document_type?: string; file_data_base64?: string; file_mime_type?: string }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400)
  }
  const documentType = body.document_type
  const base64 = body.file_data_base64
  const mime = body.file_mime_type
  if (documentType !== 'invoice' && documentType !== 'quotation' && documentType !== 'overhead') {
    return json({ success: false, error: 'document_type must be invoice, quotation, or overhead' }, 400)
  }
  if (!base64 || typeof base64 !== 'string') {
    return json({ success: false, error: 'file_data_base64 is required' }, 400)
  }
  if (!mime || !ALLOWED_MIME.includes(mime)) {
    return json({ success: false, error: 'Unsupported file type (PDF, JPEG, or PNG only)' }, 400)
  }

  // Call Claude — primary model, then fallback on any non-OK response.
  const dt = documentType as DocumentType
  let res = await callAnthropic(anthropicKey, PRIMARY_MODEL, dt, mime, base64)
  if (!res.ok) {
    const primaryErr = await res.text()
    console.error(`Anthropic primary (${PRIMARY_MODEL}) error:`, primaryErr)
    res = await callAnthropic(anthropicKey, FALLBACK_MODEL, dt, mime, base64)
    if (!res.ok) {
      console.error(`Anthropic fallback (${FALLBACK_MODEL}) error:`, await res.text())
      return json({ success: false, error: 'Could not read the document' }, 502)
    }
  }

  const anthropicData = await res.json()
  const text: string = anthropicData.content?.[0]?.text ?? ''
  const raw = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('Could not parse Anthropic response as JSON:', text)
    return json({ success: false, error: 'Could not parse the extracted data' }, 200)
  }

  return json({ success: true, data: parsed })
})
