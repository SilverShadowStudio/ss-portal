// Edge function: sign-freelancer-documents
// Generates the blended Freelance Services & Confidentiality Agreement (FSA-2.0)
// with embedded drawn signatures, uploads it, upserts the freelancer profile,
// inserts a freelancer_documents row, and writes to signatures_audit_log.

import { createClient } from 'npm:@supabase/supabase-js@2'
// @ts-ignore
import { jsPDF } from 'npm:jspdf@2.5.1'
import { SILVERSHADOW_LOGO_DATA_URL } from '../_shared/brandLogo.ts'
import { loadBrand, paintPageBackground } from '../_shared/brand.ts'
import { downscalePngToMax, pngBytesToDataUrl } from '../_shared/imageUtils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface SignPayload {
  firstName: string
  lastName: string
  email: string
  role: string
  rateAmount: number
  rateCurrency: string
  ratePeriod: string
  flatNumber?: string
  houseNumber: string
  streetName: string
  city: string
  postcode: string
  country: string
  bankName: string
  accountNumber: string
  sortCode: string
  accountHolder: string
  signature_image_base64?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'
  }
}

function formatOrdinalDate(d: Date): string {
  const day = d.getDate()
  const month = d.toLocaleDateString('en-GB', { month: 'long' })
  return `${day}${ordinalSuffix(day)} ${month} ${d.getFullYear()}`
}

function formatAddress(p: SignPayload): string {
  const flat = p.flatNumber?.trim() ? `Flat ${p.flatNumber.trim()}, ` : ''
  return `${flat}${p.houseNumber} ${p.streetName}, ${p.city}, ${p.postcode}, ${p.country}`
}

function base64ToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0')
  return out
}

function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown'
}

// ── PDF factory ────────────────────────────────────────────────────────────────

function makePdfDoc(backgroundHex: string) {
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth() as number
  const pageHeight = pdf.internal.pageSize.getHeight() as number
  const marginX = 34
  const marginTop = 42
  const marginBottom = 30
  const contentWidth = pageWidth - marginX * 2
  let y = marginTop

  paintPageBackground(pdf, backgroundHex)

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      pdf.addPage()
      paintPageBackground(pdf, backgroundHex)
      y = marginTop
    }
  }

  const writeBody = (text: string, opts?: { indent?: number; size?: number; lineGap?: number; afterGap?: number; color?: number }) => {
    const size = opts?.size ?? 10
    const indent = opts?.indent ?? 0
    const color = opts?.color ?? 75
    const lineGap = opts?.lineGap ?? size * 0.62
    const afterGap = opts?.afterGap ?? 3.6
    pdf.setFontSize(size); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(color, color, color)
    const lines = pdf.splitTextToSize(text, contentWidth - indent) as string[]
    for (const line of lines) { ensureSpace(lineGap); pdf.text(line, marginX + indent, y); y += lineGap }
    y += afterGap
  }

  const writeLabel = (text: string, afterGap = 6) => {
    pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(140, 140, 140)
    ensureSpace(5); pdf.text(text.toUpperCase().split('').join(' '), marginX, y); y += afterGap
  }

  const writeSectionHeading = (text: string) => {
    ensureSpace(20); y += 12
    pdf.setFontSize(8.5); pdf.setFont('times', 'bold'); pdf.setTextColor(50, 50, 50)
    pdf.text(text.toUpperCase().split('').join(' '), marginX, y); y += 8
  }

  const writeSubHeading = (text: string) => {
    ensureSpace(10); y += 4
    pdf.setFontSize(9.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(55, 55, 55)
    const lines = pdf.splitTextToSize(text, contentWidth) as string[]
    for (const line of lines) { ensureSpace(5.5); pdf.text(line, marginX, y); y += 5.5 }
    y += 2
  }

  const writeItem = (prefix: string, text: string) => {
    const indentMm = 6, prefixMm = 7, size = 10, lineH = 6.5, afterGap = 2
    pdf.setFontSize(size); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(70, 70, 70)
    const lines = pdf.splitTextToSize(text, contentWidth - indentMm - prefixMm) as string[]
    ensureSpace(lineH); pdf.text(prefix, marginX + indentMm, y)
    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lineH); pdf.text(lines[i], marginX + indentMm + prefixMm, y)
      if (i < lines.length - 1) y += lineH
    }
    y += lineH; y += afterGap
  }

  const addFooters = () => {
    const totalPages = (pdf as any).internal.pages.length - 1
    for (let pg = 1; pg <= totalPages; pg++) {
      pdf.setPage(pg)
      const fy = pageHeight - 8
      pdf.setFontSize(6); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(160, 160, 160)
      pdf.text('SILVERSHADOW STUDIO LIMITED  |  REGISTERED IN ENGLAND & WALES: 9178937  |  VAT NUMBER: GB 232 8467 02', pageWidth / 2, fy - 4, { align: 'center' })
      pdf.text('332 LADBROKE GROVE, LONDON, W10 5AD  |  +44(0)203 876 5980  |  SILVERSHADOWSTUDIO.COM', pageWidth / 2, fy, { align: 'center' })
    }
  }

  // Draw a signature block column: image (if provided) above a line, then name + date below
  const writeSigBlock = (x: number, baseY: number, name: string, subtitle: string | null, dateStr: string, imageDataUrl?: string) => {
    const colWidth = 65
    const imgH = 14, imgW = 50

    if (imageDataUrl) {
      try {
        pdf.addImage(imageDataUrl, 'PNG', x, baseY - imgH - 1, imgW, imgH)
      } catch { /* skip */ }
    }

    pdf.setDrawColor(100, 100, 100); pdf.setLineWidth(0.3)
    pdf.line(x, baseY, x + colWidth, baseY)

    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(40, 40, 40)
    pdf.text(name, x, baseY + 6)
    if (subtitle) {
      pdf.setFontSize(8.5); pdf.text(subtitle, x, baseY + 11)
      pdf.setFontSize(8); pdf.setTextColor(150, 150, 150); pdf.text(dateStr, x, baseY + 16)
    } else {
      pdf.setFontSize(8); pdf.setTextColor(150, 150, 150); pdf.text(dateStr, x, baseY + 11)
    }
  }

  return {
    pdf, pageWidth, pageHeight, marginX, marginBottom, contentWidth,
    getY: () => y, setY: (val: number) => { y = val },
    ensureSpace, writeBody, writeLabel, writeSectionHeading, writeSubHeading, writeItem,
    addFooters, writeSigBlock,
  }
}

// ── FSA generator ──────────────────────────────────────────────────────────────

function buildFsaClauses(rateStr: string): Array<{ title: string; body: string }> {
  return [
    { title: '1. Nature of Engagement', body: 'The Contractor is engaged by the Client as an independent contractor to provide freelance services. Nothing in this Agreement shall be deemed to create an employment relationship, joint venture, agency or partnership. The Contractor is solely responsible for all taxes, national insurance, and any other statutory payments.' },
    { title: '2. Scope of Services', body: 'The Contractor shall provide CGI production services including 3D modelling, texturing, lighting, rendering, and post-production as directed per project brief. The Contractor shall report directly to the Production Director. Work is delivered via agreed file transfer to studio specifications. The Contractor is responsible for meeting agreed deadlines and quality standards. The Contractor shall deliver services with due care, skill and diligence and may not subcontract or substitute another party to perform the Services without prior written consent of the Client.' },
    { title: '3. Term', body: 'This Agreement shall commence on the date first above written and shall continue on a rolling monthly basis unless terminated earlier in accordance with the Termination clause.' },
    { title: '4. Compensation', body: `The Contractor shall be paid ${rateStr}. The Contractor shall invoice the Client monthly in arrears. Payment will be made by bank transfer within 30 days of receipt of a valid invoice. If the Client disputes any portion of an invoice, the Client shall pay the undisputed portion and notify the Contractor in writing. The disputed portion shall be paid within 30 days of dispute resolution.` },
    { title: '5. VAT and Self-Billing', body: "Where the Client operates a self-billing arrangement for the Contractor's fees, this clause constitutes a self-billing agreement between the Parties. The Client will issue self-billed invoices for the fees due to the Contractor, and the Contractor will accept them; the Contractor will not issue its own invoice for those fees, and the requirement in clause 4 for the Contractor to invoice is satisfied by the Client's self-billed invoice. The Contractor will notify the Client without delay if it becomes or ceases to be registered for VAT, if its VAT registration number changes, or if the country in which it is established changes. This self-billing arrangement takes effect on the date of this Agreement and expires on the earlier of the end of the engagement or twelve months from that date, and may be renewed by agreement. VAT is applied according to the Contractor's country of establishment and VAT status as recorded in the Contractor's profile: (a) where the Contractor is established in the United Kingdom and registered for VAT, self-billed invoices show UK VAT at the prevailing rate and carry the statement 'The VAT shown is your output tax due to HMRC', that VAT being the Contractor's output tax for which the Contractor remains responsible to HM Revenue and Customs; (b) where the Contractor is established in the United Kingdom and not registered for VAT, no UK VAT is shown; and (c) where the Contractor is established outside the United Kingdom, the Contractor's supplies are treated as outside the scope of UK VAT for the Contractor and, where the reverse charge applies, the Client accounts for any UK VAT due, so the Contractor does not charge UK VAT and remains responsible for any tax arising in its own country." },
    { title: '6. Confidentiality', body: "In this Agreement \"Confidential Information\" means any non-public information disclosed by or on behalf of the Client to the Contractor, in any form and whether before or after the date of this Agreement, that is either marked or identified as confidential or would reasonably be understood to be confidential given its nature or the circumstances of disclosure. It includes, without limitation, business plans, client identities, project briefs, designs, renders, drawings, models, technical methods, pricing, financial information, software, source files, and any analyses or derivatives prepared by the Contractor that contain or reflect such information. The Contractor shall (a) keep all Confidential Information strictly confidential; (b) use it solely to provide the Services; (c) protect it using at least a reasonable standard of care; (d) not copy or reduce it to writing except as reasonably necessary for the Services; and (e) disclose it only to those of its advisers or sub-contractors who need it for the Services and are bound by confidentiality obligations no less protective than these, remaining liable for their compliance. The Contractor shall promptly notify the Client on becoming aware of any unauthorised disclosure, loss or misuse of Confidential Information. These obligations do not apply to information the Contractor can demonstrate was lawfully in its possession before disclosure free of any obligation of confidence, is or becomes publicly available through no act or omission of the Contractor, is lawfully obtained from a third party not bound by any obligation of confidence, or is independently developed by the Contractor without reference to the Confidential Information; nor do they prevent disclosure required by law, regulation or court order, provided that the Contractor (where lawful and practicable) first notifies the Client. On termination of this Agreement, or on the Client's written request, the Contractor shall promptly return or destroy all Confidential Information in its possession or control and confirm compliance in writing, save that the Contractor may retain one copy solely for legal or regulatory compliance and copies held in routine electronic backups that are not practicable to delete, in each case subject to continuing confidentiality. The obligations in this clause survive termination and continue for five years from the date of disclosure of each item of Confidential Information, and for as long as the relevant information remains a trade secret." },
    { title: '7. Marketing and Portfolio Rights', body: "Neither Party shall use the name, trademarks, or logos of the other Party, or refer publicly to the existence or subject matter of the engagement, without the other Party's prior written consent, such consent not to be unreasonably withheld or delayed. In particular, the Contractor shall not display, publish or otherwise use any Deliverables or project materials in any portfolio, showreel, website or social media without the Client's prior written consent, given that such materials comprise the confidential work of the Client and its clients." },
    { title: '8. Data Protection', body: 'The Contractor agrees to comply with all applicable UK data protection laws, including the UK GDPR. The Contractor must implement adequate measures to safeguard personal data and shall not share any such data with third parties.' },
    { title: '9. Intellectual Property', body: 'The Contractor assigns by present assignment of future rights all Intellectual Property Rights in the Deliverables to the Client with full title guarantee, including any renewals, reversions, extensions or revivals and including the right to take action for past acts of infringement. The Contractor unconditionally and irrevocably waives all moral rights in relation to the Deliverables. The Contractor agrees not to use, replicate, or derive from any proprietary internal tools, systems, or processes developed by the Client, including any elements of the Silvershadow Proprietary App System, either during or after the term of this Agreement.' },
    { title: '10. Non-Solicitation', body: 'The Contractor agrees not to directly solicit or accept work from any Client of Silvershadow Studio Limited or freelance contributor introduced by the Client for a period of 24 months following termination, without prior written consent.' },
    { title: '11. Non-Disparagement', body: 'The Contractor agrees not to make or publish any disparaging, defamatory, or negative statements about the Client, its directors, employees, services, or clients, whether during or after the term of this Agreement.' },
    { title: '12. Termination', body: "This Agreement may be terminated by either party with 7 days' written notice. The Client may terminate the agreement immediately if the Contractor breaches confidentiality, fails to perform services to a reasonable standard, or acts in a manner that brings the Client into disrepute. Upon termination, the Contractor shall be entitled to payment for all approved work completed up to the termination date." },
    { title: '13. Entire Agreement', body: 'This Agreement constitutes the entire agreement between the Parties and supersedes all prior oral or written understandings, including any prior non-disclosure or confidentiality agreement between the Parties relating to the same subject matter. Any changes must be made in writing and signed by both Parties.' },
    { title: '14. Governing Law', body: 'This Agreement shall be governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England.' },
    { title: '15. Signatures', body: 'IN WITNESS WHEREOF, the parties have executed this Agreement on the date first above written.' },
  ]
}

function generateFsaPdf(p: SignPayload, now: Date, backgroundHex: string, contractorSigDataUrl?: string, studioSigDataUrl?: string): Uint8Array {
  const ordDate = formatOrdinalDate(now)
  const address = formatAddress(p)
  const fullName = `${p.firstName} ${p.lastName}`
  const rateStr = `${Number(p.rateAmount).toFixed(2)} ${p.rateCurrency} per ${p.ratePeriod.toLowerCase()}`
  const clauses = buildFsaClauses(rateStr)

  const doc = makePdfDoc(backgroundHex)
  const { pdf, pageWidth, marginX, contentWidth, getY, setY, ensureSpace, writeBody, writeLabel, writeSectionHeading, addFooters, writeSigBlock } = doc

  writeLabel('FSA-2.0', 14)
  try { const lw = 45, lh = lw * (91 / 600); pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, 'PNG', marginX, getY() - lh, lw, lh) } catch { /* logo optional */ }
  setY(getY() + 10)

  pdf.setFontSize(11); pdf.setFont('times', 'italic'); pdf.setTextColor(125, 125, 125)
  pdf.text('Freelance Services & Confidentiality Agreement', marginX, getY()); setY(getY() + 6)
  pdf.setFontSize(10.5); pdf.setFont('times', 'normal'); pdf.setTextColor(50, 50, 50)
  pdf.text(fullName, marginX, getY()); setY(getY() + 8)
  pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(150, 150, 150)
  pdf.text(ordDate.toUpperCase().split('').join(' '), marginX, getY()); setY(getY() + 16)

  writeBody(`This Freelance Services Agreement ("Agreement") is made and entered into on ${ordDate} by and between:`, { color: 60, afterGap: 8 })
  writeBody('Client:  Silvershadow Studio Limited', { color: 45 })
  writeBody('332 Ladbroke Grove, London, W10 5AD', { color: 75, size: 9.5, afterGap: 1.6 })
  writeBody('Company No: 9178937', { color: 75, size: 9.5, afterGap: 1.6 })
  writeBody('VAT Number: GB 232 8467 02', { color: 75, size: 9.5, afterGap: 1.6 })
  writeBody('("Client")', { color: 75, size: 9.5, afterGap: 8 })
  writeBody('and', { color: 100, afterGap: 8 })
  writeBody(`Contractor:  ${fullName}`, { color: 45 })
  writeBody(address, { color: 75, size: 9.5, afterGap: 1.6 })
  writeBody('("Contractor")', { color: 75, size: 9.5, afterGap: 10 })
  writeBody('The Client and the Contractor (collectively, the "Parties") agree as follows:', { color: 60, afterGap: 4 })

  for (const clause of clauses) {
    writeSectionHeading(clause.title)
    if (clause.title !== '15. Signatures') writeBody(clause.body, { color: 70 })
  }

  // Signature block
  ensureSpace(100)
  setY(getY() + 4)
  const sigBaseY = getY()
  const sigColLeft = marginX
  const sigColRight = marginX + contentWidth / 2 + 10

  // Left: Contractor (drawn signature)
  writeSigBlock(sigColLeft, sigBaseY, fullName, null, ordDate, contractorSigDataUrl)
  // Right: Studio (Fred's signature)
  writeSigBlock(sigColRight, sigBaseY, 'Silvershadow Studio Limited', 'Fred Colomb — Director', ordDate, studioSigDataUrl)

  setY(sigBaseY + 30)

  // Footer on every page
  const totalPages = (pdf as any).internal.pages.length - 1
  for (let pg = 1; pg <= totalPages; pg++) {
    pdf.setPage(pg)
    const pageHeight = pdf.internal.pageSize.getHeight() as number
    const fy = pageHeight - 8
    pdf.setFontSize(6); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(160, 160, 160)
    pdf.text('SILVERSHADOW STUDIO LIMITED  |  REGISTERED IN ENGLAND & WALES: 9178937  |  VAT NUMBER: GB 232 8467 02', pageWidth / 2, fy - 4, { align: 'center' })
    pdf.text('332 LADBROKE GROVE, LONDON, W10 5AD  |  +44(0)203 876 5980  |  SILVERSHADOWSTUDIO.COM', pageWidth / 2, fy, { align: 'center' })
  }

  return new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer)
}

// ── Main handler ───────────────────────────────────────────────────────────────

const FSA_ACCEPTANCE_TEXT = 'I have read and agree to the Freelance Services & Confidentiality Agreement above. I understand that by clicking Sign Agreement, a PDF of the signed agreement will be generated and stored as a record of my acceptance.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const p: SignPayload = await req.json()
    const now = new Date()
    const ipAddress = getClientIp(req)
    const userAgent = req.headers.get('user-agent') || 'unknown'

    // Upload contractor's drawn signature
    let signatureImagePath: string | null = null
    if (p.signature_image_base64) {
      try {
        await admin.storage.createBucket('signatures', { public: false }).catch(() => {})
        const sigBytes = base64ToBytes(p.signature_image_base64)
        const sigPath = `${user.id}/freelancer_${now.getTime()}.png`
        const { error: sigErr } = await admin.storage
          .from('signatures')
          .upload(sigPath, sigBytes, { contentType: 'image/png', upsert: false })
        if (!sigErr) signatureImagePath = sigPath
      } catch (e) {
        console.warn('[sign-freelancer-documents] Signature upload failed:', e)
      }
    }

    // Load Fred's signature from studio-assets and downscale before embedding.
    // jsPDF inflates PNGs to raw RGB + alpha, so a 2000×1592 source PNG would
    // add ~13 MB of uncompressed pixel data per embed. Cap at 600×400 — well
    // above the ~50 mm × 14 mm print size at 300 dpi — for a ~30× reduction.
    // The original file in storage is left untouched.
    let studioSigDataUrl: string | undefined
    try {
      const { data: sigBlob } = await admin.storage.from('studio-assets').download('silvershadow-signature.png')
      if (sigBlob) {
        const arrayBuf = await sigBlob.arrayBuffer()
        const raw = new Uint8Array(arrayBuf)
        const resized = await downscalePngToMax(raw, 600, 400)
        studioSigDataUrl = pngBytesToDataUrl(resized)
      }
    } catch { /* no studio signature uploaded yet — fall back to text */ }

    const brand = await loadBrand(admin)
    // Single blended document (FSA-2.0) — confidentiality is now folded into the FSA.
    const fsaBytes = generateFsaPdf(p, now, brand.background_color, p.signature_image_base64 || undefined, studioSigDataUrl)

    const fsaSha256 = await sha256Hex(fsaBytes)

    await admin.storage.createBucket('freelancer-documents', { public: false }).catch(() => {})

    const ts = Date.now()
    const fsaPath = `${user.id}/FSA-${ts + 1}.pdf`

    const { error: fsaErr } = await admin.storage.from('freelancer-documents').upload(fsaPath, fsaBytes, { contentType: 'application/pdf', upsert: false })
    if (fsaErr) throw fsaErr

    const address = formatAddress(p)

    const { data: profile, error: profileErr } = await admin
      .from('freelancer_profiles')
      .upsert({
        user_id: user.id,
        first_name: p.firstName, last_name: p.lastName, email: p.email,
        role: p.role || null, day_rate: p.rateAmount || null,
        rate_currency: p.rateCurrency || 'GBP', rate_period: p.ratePeriod || 'day',
        flat_number: p.flatNumber || null, house_number: p.houseNumber || null,
        street_name: p.streetName || null, city: p.city || null,
        postcode: p.postcode || null, country: p.country || null,
        address, bank_name: p.bankName || null, account_number: p.accountNumber || null,
        sort_code: p.sortCode || null, account_holder: p.accountHolder || null,
        updated_at: now.toISOString(),
      }, { onConflict: 'user_id' })
      .select('id')
      .single()
    if (profileErr) throw profileErr

    const { data: membership } = await admin.from('account_members').select('account_id').eq('user_id', user.id).maybeSingle()
    const accountId = membership?.account_id ?? null

    const signedAt = now.toISOString()
    const fullName = `${p.firstName} ${p.lastName}`

    const { error: docsErr } = await admin.from('freelancer_documents').insert([
      {
        account_id: accountId, profile_id: profile?.id ?? null,
        document_type: 'service_agreement', signed_at: signedAt, signed_by_name: fullName,
        pdf_url: fsaPath, ip_address: ipAddress, user_agent: userAgent,
        pdf_sha256: fsaSha256, signature_image_path: signatureImagePath,
      },
    ])
    if (docsErr) throw docsErr

    // Audit log entry for the single blended agreement
    const { error: auditErr } = await admin.from('signatures_audit_log').insert([
      {
        document_type: 'service_agreement', document_id: null, account_id: accountId,
        user_id: user.id, signatory_name: fullName,
        signed_at: signedAt, ip_address: ipAddress, user_agent: userAgent,
        acceptance_text: FSA_ACCEPTANCE_TEXT, version_code: 'FSA-2.0',
        pdf_sha256: fsaSha256, signature_image_path: signatureImagePath,
      },
    ])
    if (auditErr) console.warn('[sign-freelancer-documents] audit log failed:', auditErr)

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('sign-freelancer-documents error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
