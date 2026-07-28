import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import SignaturePad, { type SignaturePadRef } from "@/components/SignaturePad";

// ── Date helpers ───────────────────────────────────────────────────────────────

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) { case 1: return "st"; case 2: return "nd"; case 3: return "rd"; default: return "th"; }
}
function formatOrdinalDate(d: Date): string {
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${day}${ordinalSuffix(day)} ${month} ${d.getFullYear()}`;
}

// ── FSA clause builder ─────────────────────────────────────────────────────────

function buildFsaClauses(rateStr: string): Array<{ title: string; body: string }> {
  return [
    { title: "1. Nature of Engagement", body: "The Contractor is engaged by the Client as an independent contractor to provide freelance services. Nothing in this Agreement shall be deemed to create an employment relationship, joint venture, agency or partnership. The Contractor is solely responsible for all taxes, national insurance, and any other statutory payments." },
    { title: "2. Scope of Services", body: "The Contractor shall provide CGI production services including 3D modelling, texturing, lighting, rendering, and post-production as directed per project brief. The Contractor shall report directly to the Production Director. Work is delivered via agreed file transfer to studio specifications. The Contractor is responsible for meeting agreed deadlines and quality standards. The Contractor shall deliver services with due care, skill and diligence and may not subcontract or substitute another party to perform the Services without prior written consent of the Client." },
    { title: "3. Term", body: "This Agreement shall commence on the date first above written and shall continue on a rolling monthly basis unless terminated earlier in accordance with the Termination clause." },
    { title: "4. Compensation", body: `The Contractor shall be paid ${rateStr}. The Contractor shall invoice the Client monthly in arrears. Payment will be made by bank transfer within 30 days of receipt of a valid invoice. If the Client disputes any portion of an invoice, the Client shall pay the undisputed portion and notify the Contractor in writing. The disputed portion shall be paid within 30 days of dispute resolution.` },
    { title: "5. VAT and Self-Billing", body: "Where the Client operates a self-billing arrangement for the Contractor's fees, this clause constitutes a self-billing agreement between the Parties. The Client will issue self-billed invoices for the fees due to the Contractor, and the Contractor will accept them; the Contractor will not issue its own invoice for those fees, and the requirement in clause 4 for the Contractor to invoice is satisfied by the Client's self-billed invoice. The Contractor will notify the Client without delay if it becomes or ceases to be registered for VAT, if its VAT registration number changes, or if the country in which it is established changes. This self-billing arrangement takes effect on the date of this Agreement and expires on the earlier of the end of the engagement or twelve months from that date, and may be renewed by agreement. VAT is applied according to the Contractor's country of establishment and VAT status as recorded in the Contractor's profile: (a) where the Contractor is established in the United Kingdom and registered for VAT, self-billed invoices show UK VAT at the prevailing rate and carry the statement 'The VAT shown is your output tax due to HMRC', that VAT being the Contractor's output tax for which the Contractor remains responsible to HM Revenue and Customs; (b) where the Contractor is established in the United Kingdom and not registered for VAT, no UK VAT is shown; and (c) where the Contractor is established outside the United Kingdom, the Contractor's supplies are treated as outside the scope of UK VAT for the Contractor and, where the reverse charge applies, the Client accounts for any UK VAT due, so the Contractor does not charge UK VAT and remains responsible for any tax arising in its own country." },
    { title: "6. Confidentiality", body: "In this Agreement \"Confidential Information\" means any non-public information disclosed by or on behalf of the Client to the Contractor, in any form and whether before or after the date of this Agreement, that is either marked or identified as confidential or would reasonably be understood to be confidential given its nature or the circumstances of disclosure. It includes, without limitation, business plans, client identities, project briefs, designs, renders, drawings, models, technical methods, pricing, financial information, software, source files, and any analyses or derivatives prepared by the Contractor that contain or reflect such information. The Contractor shall (a) keep all Confidential Information strictly confidential; (b) use it solely to provide the Services; (c) protect it using at least a reasonable standard of care; (d) not copy or reduce it to writing except as reasonably necessary for the Services; and (e) disclose it only to those of its advisers or sub-contractors who need it for the Services and are bound by confidentiality obligations no less protective than these, remaining liable for their compliance. The Contractor shall promptly notify the Client on becoming aware of any unauthorised disclosure, loss or misuse of Confidential Information. These obligations do not apply to information the Contractor can demonstrate was lawfully in its possession before disclosure free of any obligation of confidence, is or becomes publicly available through no act or omission of the Contractor, is lawfully obtained from a third party not bound by any obligation of confidence, or is independently developed by the Contractor without reference to the Confidential Information; nor do they prevent disclosure required by law, regulation or court order, provided that the Contractor (where lawful and practicable) first notifies the Client. On termination of this Agreement, or on the Client's written request, the Contractor shall promptly return or destroy all Confidential Information in its possession or control and confirm compliance in writing, save that the Contractor may retain one copy solely for legal or regulatory compliance and copies held in routine electronic backups that are not practicable to delete, in each case subject to continuing confidentiality. The obligations in this clause survive termination and continue for five years from the date of disclosure of each item of Confidential Information, and for as long as the relevant information remains a trade secret." },
    { title: "7. Marketing and Portfolio Rights", body: "Neither Party shall use the name, trademarks, or logos of the other Party, or refer publicly to the existence or subject matter of the engagement, without the other Party's prior written consent, such consent not to be unreasonably withheld or delayed. In particular, the Contractor shall not display, publish or otherwise use any Deliverables or project materials in any portfolio, showreel, website or social media without the Client's prior written consent, given that such materials comprise the confidential work of the Client and its clients." },
    { title: "8. Data Protection", body: "The Contractor agrees to comply with all applicable UK data protection laws, including the UK GDPR. The Contractor must implement adequate measures to safeguard personal data and shall not share any such data with third parties." },
    { title: "9. Intellectual Property", body: "The Contractor assigns by present assignment of future rights all Intellectual Property Rights in the Deliverables to the Client with full title guarantee, including any renewals, reversions, extensions or revivals and including the right to take action for past acts of infringement. The Contractor unconditionally and irrevocably waives all moral rights in relation to the Deliverables. The Contractor agrees not to use, replicate, or derive from any proprietary internal tools, systems, or processes developed by the Client, including any elements of the Silvershadow Proprietary App System, either during or after the term of this Agreement." },
    { title: "10. Non-Solicitation", body: "The Contractor agrees not to directly solicit or accept work from any Client of Silvershadow Studio Limited or freelance contributor introduced by the Client for a period of 24 months following termination, without prior written consent." },
    { title: "11. Non-Disparagement", body: "The Contractor agrees not to make or publish any disparaging, defamatory, or negative statements about the Client, its directors, employees, services, or clients, whether during or after the term of this Agreement." },
    { title: "12. Termination", body: "This Agreement may be terminated by either party with 7 days' written notice. The Client may terminate the agreement immediately if the Contractor breaches confidentiality, fails to perform services to a reasonable standard, or acts in a manner that brings the Client into disrepute. Upon termination, the Contractor shall be entitled to payment for all approved work completed up to the termination date." },
    { title: "13. Entire Agreement", body: "This Agreement constitutes the entire agreement between the Parties and supersedes all prior oral or written understandings, including any prior non-disclosure or confidentiality agreement between the Parties relating to the same subject matter. Any changes must be made in writing and signed by both Parties." },
    { title: "14. Governing Law", body: "This Agreement shall be governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England." },
    { title: "15. Signatures", body: "IN WITNESS WHEREOF, the parties have executed this Agreement on the date first above written." },
  ];
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface FormData {
  firstName: string; lastName: string; email: string; role: string;
  flatNumber: string; houseNumber: string; streetName: string;
  city: string; postcode: string; country: string;
  rateAmount: string; rateCurrency: string; ratePeriod: string;
  bankName: string; accountHolder: string; sortCode: string; accountNumber: string;
}

type Touched = Partial<Record<keyof FormData, boolean>>;

const REQUIRED_FIELDS: (keyof FormData)[] = [
  "firstName", "lastName", "email",
  "houseNumber", "streetName", "city", "postcode", "country",
  "rateAmount",
  "bankName", "accountHolder", "sortCode", "accountNumber",
];

const FIELD_LABELS: Record<keyof FormData, string> = {
  firstName: "First name", lastName: "Last name", email: "Email address", role: "Role / title",
  flatNumber: "Flat / apartment number", houseNumber: "House / building number",
  streetName: "Street name", city: "City", postcode: "Postcode", country: "Country",
  rateAmount: "Rate amount", rateCurrency: "Currency", ratePeriod: "Period",
  bankName: "Bank name", accountHolder: "Account holder name",
  sortCode: "Sort code", accountNumber: "Account number",
};

// ── Address builder ────────────────────────────────────────────────────────────

function buildAddress(form: FormData): string {
  const flat   = form.flatNumber.trim() ? `Flat ${form.flatNumber.trim()}` : "";
  const street = [flat, `${form.houseNumber} ${form.streetName}`.trim()].filter(Boolean).join(", ");
  const parts  = [street, form.city.trim(), form.postcode.trim(), form.country.trim()].filter(Boolean);
  return parts.length > 1 ? parts.join(", ") : "—";
}

// ── Countries ──────────────────────────────────────────────────────────────────

const COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia",
  "Austria","Azerbaijan","Bahrain","Bangladesh","Belarus","Belgium","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Bulgaria","Cambodia","Cameroon","Canada",
  "Chile","China","Colombia","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic",
  "Denmark","Dominican Republic","Ecuador","Egypt","Estonia","Ethiopia","Finland","France",
  "Georgia","Germany","Ghana","Greece","Guatemala","Hungary","Iceland","India","Indonesia",
  "Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya",
  "Kuwait","Latvia","Lebanon","Libya","Lithuania","Luxembourg","Malaysia","Malta","Mexico",
  "Moldova","Monaco","Morocco","Netherlands","New Zealand","Nigeria","North Macedonia",
  "Norway","Oman","Pakistan","Panama","Peru","Philippines","Poland","Portugal","Qatar",
  "Romania","Russia","Saudi Arabia","Serbia","Singapore","Slovakia","Slovenia",
  "South Africa","South Korea","Spain","Sri Lanka","Sweden","Switzerland","Taiwan",
  "Tanzania","Thailand","Tunisia","Turkey","Ukraine","United Arab Emirates",
  "United Kingdom","United States","Uruguay","Venezuela","Vietnam","Zimbabwe",
];

// ── Country combobox ───────────────────────────────────────────────────────────

function CountryCombobox({ value, onChange, onBlur, hasError }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; hasError: boolean;
}) {
  const [query, setQuery]   = useState(value);
  const [open, setOpen]     = useState(false);

  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.toLowerCase().includes(q));
  }, [query]);

  const handleSelect = (country: string) => { onChange(country); setQuery(country); setOpen(false); onBlur(); };
  const handleInputBlur = () => {
    setTimeout(() => {
      setOpen(false);
      if (!COUNTRIES.includes(query)) setQuery(value);
      onBlur();
    }, 150);
  };

  const borderClass = hasError ? "border-destructive focus:border-destructive" : "border-border focus:border-gold";

  return (
    <div className="relative">
      <input
        type="text" value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); if (!e.target.value) onChange(""); setOpen(true); }}
        onBlur={handleInputBlur}
        placeholder="Search country…" autoComplete="off"
        className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-colors text-sm ${borderClass}`}
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-52 overflow-y-auto border border-border bg-background">
          {filtered.map((country) => (
            <button
              key={country} type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(country); }}
              className={`w-full text-left px-4 py-2 font-sans transition-colors hover:bg-muted/30 ${country === value ? "text-gold" : "text-foreground/70 hover:text-foreground"}`}
              style={{ fontSize: 12 }}
            >
              {country}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FSA page ───────────────────────────────────────────────────────────────────

function FsaPage({ form, today, onBack, signing, onSign }: {
  form: FormData; today: Date; onBack: () => void; signing: boolean;
  onSign: (sigDataUrl: string) => void;
}) {
  const [accepted, setAccepted]   = useState(false);
  const [showError, setShowError] = useState(false);
  const [sigEmpty, setSigEmpty]   = useState(true);
  const [showSigError, setShowSigError] = useState(false);
  const checkboxRef = useRef<HTMLDivElement>(null);
  const sigPadRef   = useRef<SignaturePadRef>(null);
  const fullName = [form.firstName, form.lastName].filter(Boolean).join(" ") || "—";
  const address  = buildAddress(form);
  const dateStr  = formatOrdinalDate(today);
  const rateNum  = parseFloat(form.rateAmount.replace(/[^0-9.]/g, ""));
  const rateStr  = !isNaN(rateNum) && rateNum > 0 ? `${rateNum.toFixed(2)} ${form.rateCurrency} per ${form.ratePeriod.toLowerCase()}` : "— per —";
  const clauses  = buildFsaClauses(rateStr);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }, []);

  const handleSign = () => {
    let hasError = false;
    if (!accepted) { setShowError(true); checkboxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); hasError = true; }
    if (sigEmpty) { setShowSigError(true); hasError = true; }
    if (hasError) return;
    onSign(sigPadRef.current?.toDataURL() ?? "");
  };

  return (
    <div className="min-h-screen bg-background">
      <article className="mx-auto w-full px-6 animate-fade-in" style={{ maxWidth: "680px", paddingTop: "160px", paddingBottom: "180px" }}>
        <header>
          <p className="uppercase text-foreground/50" style={{ fontSize: "10px", letterSpacing: "0.3em", marginBottom: "40px" }}>FSA-2.0</p>
          <h1 className="font-serif font-normal text-foreground/90" style={{ fontSize: "46px", letterSpacing: "-0.005em", lineHeight: 1.05 }}>Freelance Services &amp; Confidentiality Agreement</h1>
          <p className="uppercase text-foreground/45" style={{ fontSize: "10px", letterSpacing: "0.3em", marginTop: "40px" }}>{dateStr}</p>
        </header>
        <section style={{ marginTop: "72px" }}>
          <p className="uppercase text-foreground/45" style={{ fontSize: "10px", letterSpacing: "0.3em", marginBottom: "22px" }}>Parties</p>
          <div className="text-foreground/85" style={{ fontSize: "15px", lineHeight: 1.9 }}>
            <p style={{ marginBottom: "20px" }}>This Freelance Services Agreement is made on {dateStr} by and between:</p>
            <p style={{ marginBottom: "8px" }}><span className="text-foreground/55">Client:</span> Silvershadow Studio Limited, 332 Ladbroke Grove, London, W10 5AD. Company No: 9178937. VAT Number: GB 232 8467 02. ("Client")</p>
            <p style={{ marginBottom: "8px" }} className="text-foreground/45">and</p>
            <p><span className="text-foreground/55">Contractor:</span> {fullName}, {address}. ("Contractor")</p>
          </div>
        </section>
        {clauses.map((clause) => (
          <section key={clause.title} style={{ marginTop: "64px" }}>
            <h3 className="font-sans uppercase text-foreground/75" style={{ fontSize: "12px", letterSpacing: "0.22em", fontWeight: 500, marginBottom: "24px" }}>{clause.title}</h3>
            {clause.title !== "15. Signatures" && (
              <p className="text-foreground/70" style={{ fontSize: "15px", lineHeight: 1.9 }}>{clause.body}</p>
            )}
          </section>
        ))}

        <div style={{ marginTop: "128px" }}>
          <div className="h-px w-full bg-foreground/[0.06]" />

          {/* Signature pad */}
          <div style={{ marginTop: "64px" }}>
            <p className="uppercase text-foreground/45" style={{ fontSize: "10px", letterSpacing: "0.3em", marginBottom: "16px" }}>Your signature *</p>
            <SignaturePad
              ref={sigPadRef}
              onEnd={() => { setSigEmpty(sigPadRef.current?.isEmpty() ?? true); setShowSigError(false); }}
            />
            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={() => { sigPadRef.current?.clear(); setSigEmpty(true); }}
                className="text-[10px] uppercase tracking-[0.18em] text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                Clear
              </button>
              {showSigError && sigEmpty && (
                <p className="text-foreground/55 uppercase" style={{ fontSize: "10px", letterSpacing: "0.22em" }}>Signature is required.</p>
              )}
            </div>
          </div>

          <div ref={checkboxRef} style={{ marginTop: "40px" }}>
            <label className="flex items-start gap-5 cursor-pointer">
              <Checkbox
                checked={accepted}
                onCheckedChange={(v) => { setAccepted(v === true); if (v === true) setShowError(false); }}
                className="mt-[6px] h-[14px] w-[14px] shrink-0 rounded-none border-foreground/40 data-[state=checked]:bg-foreground/85 data-[state=checked]:border-foreground/85 data-[state=checked]:text-background"
              />
              <span className="text-foreground/85" style={{ fontSize: "15px", lineHeight: 1.75 }}>
                I have read and agree to the Freelance Services & Confidentiality Agreement above. I understand that by clicking Sign Agreement, a PDF of the signed agreement will be generated and stored as a record of my acceptance.
              </span>
            </label>
            {showError && !accepted && (
              <p className="text-foreground/55 uppercase" style={{ fontSize: "10px", letterSpacing: "0.22em", marginTop: "18px", marginLeft: "34px" }}>Acceptance is required to proceed.</p>
            )}
          </div>

          <div style={{ marginTop: "56px" }}>
            <button onClick={handleSign} disabled={signing} className={SIGN_BTN} style={SIGN_BTN_STYLE}>
              {signing ? <><BrandLoader size="sm" className="h-3 w-3 mr-2" />Signing…</> : "Sign Agreement"}
            </button>
            <p className="text-foreground/45" style={{ marginTop: "32px", fontSize: "12px", lineHeight: 1.75, maxWidth: "52ch" }}>
              On acceptance, a binding PDF of the agreement will be generated, timestamped, and stored in your Documents.
            </p>
          </div>
          <div style={{ marginTop: "64px" }}>
            <button onClick={onBack} className={BACK_BTN} style={BACK_BTN_STYLE}>Back to details</button>
          </div>
        </div>
      </article>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Onboarding() {
  const navigate  = useNavigate();
  const { toast } = useToast();
  const { user, refreshProfileStatus } = useAuth();
  const today = useMemo(() => new Date(), []);

  const [page, setPage]       = useState<1 | 2>(1);
  const [signing, setSigning] = useState(false);

  const [form, setForm] = useState<FormData>({
    firstName: "", lastName: "", email: user?.email ?? "",
    role: "",
    flatNumber: "", houseNumber: "", streetName: "", city: "", postcode: "", country: "",
    rateAmount: "", rateCurrency: "GBP", ratePeriod: "day",
    bankName: "", accountHolder: "", sortCode: "", accountNumber: "",
  });
  const [touched, setTouched] = useState<Touched>({});

  const showError = (field: keyof FormData) =>
    !!touched[field] && REQUIRED_FIELDS.includes(field) && !form[field].trim();

  const handleBlur   = (field: keyof FormData) => setTouched((p) => ({ ...p, [field]: true }));
  const handleChange = (field: keyof FormData, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const borderFor = (field: keyof FormData) =>
    showError(field) ? "border-destructive focus:border-destructive" : "border-border focus:border-gold";

  const inputClass  = (field: keyof FormData) => `w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-colors text-sm ${borderFor(field)}`;
  const selectClass = (field: keyof FormData) => `w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-colors appearance-none cursor-pointer text-sm ${borderFor(field)}`;

  function handleNext() {
    const allTouched = REQUIRED_FIELDS.reduce((a, f) => ({ ...a, [f]: true }), {} as Touched);
    setTouched(allTouched);
    const missing = REQUIRED_FIELDS.filter((f) => !form[f].trim());
    if (missing.length > 0) {
      toast({ title: "Please complete all required fields", variant: "destructive" });
      const el = document.querySelector(`[data-field="${missing[0]}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const rateNum = parseFloat(form.rateAmount.replace(/[^0-9.]/g, ""));
    if (isNaN(rateNum) || rateNum <= 0) { toast({ title: "Please enter a valid rate amount", variant: "destructive" }); return; }
    setPage(2);
  }

  async function handleSign(sigDataUrl: string) {
    setSigning(true);
    try {
      const rateNum = parseFloat(form.rateAmount.replace(/[^0-9.]/g, ""));
      const { error } = await supabase.functions.invoke("sign-freelancer-documents", {
        body: {
          firstName:     form.firstName.trim(),
          lastName:      form.lastName.trim(),
          email:         form.email.trim(),
          role:          form.role.trim(),
          rateAmount:    rateNum,
          rateCurrency:  form.rateCurrency,
          ratePeriod:    form.ratePeriod,
          flatNumber:    form.flatNumber.trim() || undefined,
          houseNumber:   form.houseNumber.trim(),
          streetName:    form.streetName.trim(),
          city:          form.city.trim(),
          postcode:      form.postcode.trim(),
          country:       form.country.trim(),
          bankName:      form.bankName.trim(),
          accountHolder: form.accountHolder.trim(),
          sortCode:      form.sortCode.trim(),
          accountNumber: form.accountNumber.trim(),
          signature_image_base64: sigDataUrl || undefined,
        },
      });
      if (error) throw error;
      await refreshProfileStatus();
      toast({ title: "Agreement signed" });
      navigate("/documents");
    } catch (err: any) {
      toast({ title: "Signing failed", description: err.message, variant: "destructive" });
    } finally {
      setSigning(false);
    }
  }

  if (page === 2) return <FsaPage form={form} today={today} onBack={() => setPage(1)} signing={signing} onSign={handleSign} />;

  // ── Page 1: form ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-14 animate-fade-in">
          <div className="flex items-start gap-4">
            <div className="w-0.5 self-stretch bg-gold" style={{ opacity: 0.4 }} />
            <div>
              <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground">Join the Studio</h1>
              <p className="mt-3 font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.24em" }}>Complete your details to sign your agreements</p>
            </div>
          </div>
        </div>

        <div className="space-y-14 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {/* 01 Personal Details */}
          <section>
            <div className="border-b border-border pb-2 mb-8"><span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>01 — Personal Details</span></div>
            <div className="space-y-7">
              {(["firstName", "lastName", "email", "role"] as const).map((field) => (
                <div key={field} className="space-y-1.5" data-field={field}>
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {FIELD_LABELS[field]}{REQUIRED_FIELDS.includes(field) && <span className="ml-1 text-gold">*</span>}
                  </label>
                  <input
                    type={field === "email" ? "email" : "text"} value={form[field]}
                    onChange={(e) => handleChange(field, e.target.value)} onBlur={() => handleBlur(field)}
                    readOnly={field === "email"}
                    className={inputClass(field) + (field === "email" ? " opacity-50 cursor-default" : "")}
                  />
                  {showError(field) && <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>}
                </div>
              ))}
            </div>
          </section>

          {/* 02 Address */}
          <section>
            <div className="border-b border-border pb-2 mb-8"><span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>02 — Address</span></div>
            <div className="space-y-7">
              {(["flatNumber", "houseNumber", "streetName", "city", "postcode"] as const).map((field) => (
                <div key={field} className="space-y-1.5" data-field={field}>
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {FIELD_LABELS[field]}{REQUIRED_FIELDS.includes(field) && <span className="ml-1 text-gold">*</span>}
                  </label>
                  <input type="text" value={form[field]} onChange={(e) => handleChange(field, e.target.value)} onBlur={() => handleBlur(field)} className={inputClass(field)} />
                  {showError(field) && <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>}
                </div>
              ))}
              <div className="space-y-1.5" data-field="country">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>{FIELD_LABELS.country} <span className="text-gold">*</span></label>
                <CountryCombobox value={form.country} onChange={(v) => handleChange("country", v)} onBlur={() => handleBlur("country")} hasError={showError("country")} />
                {showError("country") && <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>}
              </div>
            </div>
          </section>

          {/* 03 Rate */}
          <section>
            <div className="border-b border-border pb-2 mb-8"><span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>03 — Rate</span></div>
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-1.5" data-field="rateAmount">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>{FIELD_LABELS.rateAmount} <span className="text-gold">*</span></label>
                <input type="text" inputMode="decimal" value={form.rateAmount} onChange={(e) => handleChange("rateAmount", e.target.value)} onBlur={() => handleBlur("rateAmount")} placeholder="100" className={inputClass("rateAmount")} />
                {showError("rateAmount") && <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>}
              </div>
              <div className="space-y-1.5">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>{FIELD_LABELS.rateCurrency}</label>
                <select value={form.rateCurrency} onChange={(e) => handleChange("rateCurrency", e.target.value)} className={selectClass("rateCurrency")}>
                  <option value="GBP">GBP</option><option value="EUR">EUR</option><option value="USD">USD</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>{FIELD_LABELS.ratePeriod}</label>
                <select value={form.ratePeriod} onChange={(e) => handleChange("ratePeriod", e.target.value)} className={selectClass("ratePeriod")}>
                  <option value="day">Per day</option><option value="week">Per week</option><option value="month">Per month</option>
                </select>
              </div>
            </div>
          </section>

          {/* 04 Bank Details */}
          <section>
            <div className="border-b border-border pb-2 mb-8"><span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>04 — Bank Details</span></div>
            <div className="space-y-7">
              {(["bankName", "accountHolder", "sortCode", "accountNumber"] as const).map((field) => (
                <div key={field} className="space-y-1.5" data-field={field}>
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>{FIELD_LABELS[field]} <span className="text-gold">*</span></label>
                  <input type="text" value={form[field]} onChange={(e) => handleChange(field, e.target.value)} onBlur={() => handleBlur(field)} className={inputClass(field)} />
                  {showError(field) && <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>}
                </div>
              ))}
            </div>
          </section>

          <button onClick={handleNext} className="w-full flex items-center justify-center gap-2 bg-foreground text-background py-4 font-sans uppercase hover:bg-foreground/90 transition-colors" style={{ fontSize: 10, letterSpacing: "0.22em" }}>
            Next — Review Agreements
          </button>
        </div>
      </div>
    </div>
  );
}
