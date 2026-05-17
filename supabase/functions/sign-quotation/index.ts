import { createClient } from 'npm:@supabase/supabase-js@2'
// @ts-ignore
import { jsPDF } from 'npm:jspdf@2.5.1'
import { SILVERSHADOW_LOGO_DATA_URL } from '../_shared/brandLogo.ts'
import { loadBrand, paintPageBackground } from '../_shared/brand.ts'

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

function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown'
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0')
  return out
}

function base64ToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function generateSigningCertificate(args: {
  quotationNumber: string
  signatoryName: string
  signatoryPosition: string
  signatoryEmail: string
  signedAt: string
  ipAddress: string
  userAgent: string
  accountId: string
  quotationId: string
  sigImageDataUrl?: string
  backgroundHex: string
}): Uint8Array {
  const {
    quotationNumber, signatoryName, signatoryPosition, signatoryEmail,
    signedAt, ipAddress, userAgent, accountId, quotationId, sigImageDataUrl, backgroundHex,
  } = args

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth() as number
  const marginX = 34
  const contentWidth = pageWidth - marginX * 2
  let y = 42

  paintPageBackground(pdf, backgroundHex)

  const writeLabel = (text: string, gap = 6) => {
    pdf.setFontSize(7)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(140, 140, 140)
    pdf.text(text.toUpperCase().split('').join(' '), marginX, y)
    y += gap
  }

  const writeRow = (label: string, value: string) => {
    pdf.setFontSize(8.5)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(120, 120, 120)
    pdf.text(label.toUpperCase().split('').join(' '), marginX, y)
    pdf.setTextColor(30, 30, 30)
    const lines = pdf.splitTextToSize(value, contentWidth - 55) as string[]
    pdf.text(lines, marginX + 55, y)
    y += 6 * Math.max(1, lines.length)
  }

  // Logo
  writeLabel('QUOTATION ACCEPTANCE CERTIFICATE', 14)
  try {
    const lw = 45, lh = lw * (91 / 600)
    pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, 'PNG', marginX, y - lh, lw, lh)
  } catch { /* logo optional */ }
  y += 10

  pdf.setFontSize(11)
  pdf.setFont('times', 'italic')
  pdf.setTextColor(125, 125, 125)
  pdf.text('Signing Certificate', marginX, y)
  y += 14

  // Signature image
  if (sigImageDataUrl) {
    try {
      const imgH = 20, imgW = 60
      pdf.addImage(sigImageDataUrl, 'PNG', marginX, y, imgW, imgH)
      y += imgH + 3
    } catch { /* skip if image fails */ }
  }

  // Divider
  pdf.setDrawColor(200, 200, 200)
  pdf.setLineWidth(0.3)
  pdf.line(marginX, y, marginX + contentWidth, y)
  y += 8

  writeLabel('Acceptance metadata', 10)

  const rows: [string, string][] = [
    ['Quotation', quotationNumber],
    ['Signed at', signedAt],
    ['Signatory', signatoryName],
    ['Position', signatoryPosition || '—'],
    ['Email', signatoryEmail],
    ['IP address', ipAddress],
    ['Account ID', accountId],
    ['Document ID', quotationId],
    ['User agent', userAgent],
  ]
  for (const [label, value] of rows) writeRow(label, value)

  y += 6
  pdf.setFontSize(7.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(160, 160, 160)
  const notice = 'By drawing their signature above and confirming, the signatory accepted the terms of the quotation referenced above. This certificate constitutes a binding record of that acceptance.'
  const noticeLines = pdf.splitTextToSize(notice, contentWidth) as string[]
  pdf.text(noticeLines, marginX, y)

  return new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer)
}

const ACCEPTANCE_TEXT =
  'By drawing my signature and clicking Confirm & sign, I confirm acceptance of the terms in this quotation. I understand a deposit invoice will be raised automatically.'

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
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401)
  const user = userData.user

  let body: {
    quotation_id: string
    signed_by_name: string
    signed_by_position?: string
    signature_image_base64?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { quotation_id, signed_by_name, signed_by_position, signature_image_base64 } = body
  if (!quotation_id || !signed_by_name?.trim()) {
    return json({ error: 'quotation_id and signed_by_name are required' }, 400)
  }

  const { data: quotation } = await userClient
    .from('quotation_documents')
    .select('id, status, account_id, user_id, amount, subtotal, vat_rate, vat_amount, deposit_percentage, gross_total, net_total, currency, quotation_number, reference_number')
    .eq('id', quotation_id)
    .eq('status', 'sent')
    .maybeSingle()

  if (!quotation) return json({ error: 'Quotation not found or not in sent status' }, 404)

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const signedAt = new Date().toISOString()
  const ipAddress = getClientIp(req)
  const userAgent = req.headers.get('user-agent') || 'unknown'

  // Upload signature image
  let signatureImagePath: string | null = null
  if (signature_image_base64) {
    try {
      await admin.storage.createBucket('signatures', { public: false }).catch(() => {})
      const sigBytes = base64ToBytes(signature_image_base64)
      const sigPath = `${quotation.account_id}/${quotation_id}_sig.png`
      const { error: sigUploadErr } = await admin.storage
        .from('signatures')
        .upload(sigPath, sigBytes, { contentType: 'image/png', upsert: true })
      if (!sigUploadErr) signatureImagePath = sigPath
    } catch (e) {
      console.warn('[sign-quotation] Signature image upload failed:', e)
    }
  }

  // Generate signing certificate PDF
  const brand = await loadBrand(admin)
  let pdfSha256: string | null = null
  let signedPdfPath: string | null = null
  try {
    const pdfBytes = generateSigningCertificate({
      quotationNumber: quotation.quotation_number || quotation.reference_number || '—',
      signatoryName: signed_by_name.trim(),
      signatoryPosition: signed_by_position?.trim() || '',
      signatoryEmail: user.email || '',
      signedAt,
      ipAddress,
      userAgent,
      accountId: quotation.account_id,
      quotationId: quotation_id,
      sigImageDataUrl: signature_image_base64 || undefined,
      backgroundHex: brand.background_color,
    })

    pdfSha256 = await sha256Hex(pdfBytes)
    const pdfPath = `${quotation.account_id}/quotation_${quotation_id}_${Date.now()}.pdf`
    const { error: pdfUploadErr } = await admin.storage
      .from('signatures')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: false })
    if (!pdfUploadErr) signedPdfPath = pdfPath
  } catch (e) {
    console.warn('[sign-quotation] Certificate PDF generation failed:', e)
  }

  const grossTotal = Number(quotation.gross_total ?? quotation.amount ?? 0)
  const depositPct = Number(quotation.deposit_percentage ?? 50)
  const depositAmount = +(grossTotal * depositPct / 100).toFixed(2)
  const vatRate = Number(quotation.vat_rate ?? 20)

  const { error: updateErr } = await admin
    .from('quotation_documents')
    .update({
      status: 'signed',
      signed_at: signedAt,
      signed_by_name: signed_by_name.trim(),
      signed_by_position: signed_by_position?.trim() ?? null,
      gross_total: grossTotal,
      deposit_amount: depositAmount,
      ip_address: ipAddress,
      user_agent: userAgent,
      pdf_sha256: pdfSha256,
      signature_image_path: signatureImagePath,
      signed_pdf_path: signedPdfPath,
    })
    .eq('id', quotation_id)

  if (updateErr) {
    console.error('Failed to update quotation', updateErr)
    return json({ error: updateErr.message }, 500)
  }

  // Insert into signatures_audit_log
  const { error: auditErr } = await admin.from('signatures_audit_log').insert({
    document_type: 'quotation',
    document_id: quotation_id,
    account_id: quotation.account_id,
    user_id: user.id,
    signatory_name: signed_by_name.trim(),
    signatory_position: signed_by_position?.trim() || null,
    signed_at: signedAt,
    ip_address: ipAddress,
    user_agent: userAgent,
    acceptance_text: ACCEPTANCE_TEXT,
    version_code: quotation.quotation_number || quotation.reference_number || null,
    pdf_sha256: pdfSha256,
    signature_image_path: signatureImagePath,
  })
  if (auditErr) console.warn('[sign-quotation] audit log failed:', auditErr)

  // Auto-create deposit invoice (due in 5 days)
  const quotationNumber = quotation.quotation_number || quotation.reference_number || ''
  const suffix = Date.now().toString(36).toUpperCase().slice(-4)
  const depositInvoiceNumber = `DEP-${quotationNumber}-${suffix}`
  const dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const depositSubtotal = +(depositAmount / (1 + vatRate / 100)).toFixed(2)

  const { data: invoice, error: invoiceErr } = await admin
    .from('invoices')
    .insert({
      account_id: quotation.account_id,
      user_id: quotation.user_id,
      invoice_number: depositInvoiceNumber,
      reference_number: depositInvoiceNumber,
      quotation_id: quotation_id,
      type: 'deposit',
      amount: depositAmount,
      subtotal: depositSubtotal,
      vat_rate: vatRate,
      vat_amount: +(depositAmount - depositSubtotal).toFixed(2),
      currency: quotation.currency ?? 'GBP',
      status: 'sent',
      due_date: dueDate,
      issued_at: signedAt,
      notes: `${depositPct}% deposit for quotation ${quotationNumber}`,
      line_items: [{ description: `${depositPct}% Deposit — ${quotationNumber}`, quantity: 1, unit_price: depositAmount }],
    })
    .select('id')
    .single()

  if (invoiceErr) console.error('Failed to create deposit invoice', invoiceErr)

  // Pre-generate Stripe checkout URL for the deposit invoice so the client
  // sees a working "Pay now" link immediately. Fails soft — signing must
  // succeed even if Stripe is misconfigured or unreachable.
  if (invoice?.id) {
    try {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
      if (stripeKey) {
        const Stripe = (await import('https://esm.sh/stripe@17.2.0?target=deno')).default
        const stripe = new Stripe(stripeKey, { apiVersion: '2024-10-28.acacia' })
        const origin = req.headers.get('origin') || 'https://portal.silvershadowstudio.com'
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: (quotation.currency ?? 'GBP').toLowerCase(),
              unit_amount: Math.round(depositAmount * 100),
              product_data: { name: `Invoice ${depositInvoiceNumber}` },
            },
            quantity: 1,
          }],
          success_url: `${origin}/invoices?paid=1&invoice=${invoice.id}`,
          cancel_url: `${origin}/invoices?canceled=1`,
          metadata: { invoice_id: invoice.id },
        })
        if (session.url) {
          await admin
            .from('invoices')
            .update({ stripe_checkout_url: session.url })
            .eq('id', invoice.id)
        }
      } else {
        console.warn('[sign-quotation] STRIPE_SECRET_KEY not set — skipping checkout pre-gen')
      }
    } catch (e) {
      console.warn('[sign-quotation] Stripe pre-gen failed (non-fatal):', (e as Error).message)
    }
  }

  if (invoice?.id) {
    fetch(`${supabaseUrl}/functions/v1/send-invoice-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ invoiceId: invoice.id }),
    }).catch((e: unknown) => console.warn('[sign-quotation] Invoice email failed:', e))
  }

  return json({ success: true, signedAt, depositAmount, invoiceId: invoice?.id ?? null })
})
