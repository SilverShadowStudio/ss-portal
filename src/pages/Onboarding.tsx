import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ── Agreement helpers (mirrors edge function logic) ────────────────────────────

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function formatOrdinalDate(d: Date): string {
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${day}${ordinalSuffix(day)} ${month} ${d.getFullYear()}`;
}

function buildClauses(rateStr: string): Array<{ title: string; body: string }> {
  return [
    {
      title: "1. Nature of Engagement",
      body: "The Contractor is engaged by the Client as an independent contractor to provide freelance services. Nothing in this Agreement shall be deemed to create an employment relationship, joint venture, agency or partnership. The Contractor is solely responsible for all taxes, national insurance, and any other statutory payments.",
    },
    {
      title: "2. Scope of Services",
      body: "The Contractor shall provide CGI production services including 3D modelling, texturing, lighting, rendering, and post-production as directed per project brief. The Contractor shall report directly to the Production Director. Work is delivered via agreed file transfer to studio specifications. The Contractor is responsible for meeting agreed deadlines and quality standards. The Contractor shall deliver services with due care, skill and diligence and may not subcontract or substitute another party to perform the Services without prior written consent of the Client.",
    },
    {
      title: "3. Term",
      body: "This Agreement shall commence on the date first above written and shall continue on a rolling monthly basis unless terminated earlier in accordance with Clause 11.",
    },
    {
      title: "4. Compensation",
      body: `The Contractor shall be paid ${rateStr}. The Contractor shall invoice the Client monthly in arrears. Payment will be made by bank transfer within 30 days of receipt of a valid invoice. If the Client disputes any portion of an invoice, the Client shall pay the undisputed portion and notify the Contractor in writing. The disputed portion shall be paid within 30 days of dispute resolution.`,
    },
    {
      title: "5. VAT",
      body: "The Contractor shall notify the Client immediately upon VAT registration. Where applicable, VAT will be added to invoices at the prevailing rate.",
    },
    {
      title: "6. Confidentiality",
      body: "The Contractor agrees to keep confidential any information relating to the Client's business, finances, clients, systems, employees, or partners that is not publicly available. This obligation shall survive termination of this Agreement. Upon termination or on request, the Contractor shall return or delete all confidential information held in any format and confirm compliance in writing.",
    },
    {
      title: "7. Data Protection",
      body: "The Contractor agrees to comply with all applicable UK data protection laws, including the UK GDPR. The Contractor must implement adequate measures to safeguard personal data and shall not share any such data with third parties.",
    },
    {
      title: "8. Intellectual Property",
      body: "The Contractor assigns by present assignment of future rights all Intellectual Property Rights in the Deliverables to the Client with full title guarantee, including any renewals, reversions, extensions or revivals and including the right to take action for past acts of infringement. The Contractor unconditionally and irrevocably waives all moral rights in relation to the Deliverables. The Contractor agrees not to use, replicate, or derive from any proprietary internal tools, systems, or processes developed by the Client, including any elements of the Silvershadow Proprietary App System, either during or after the term of this Agreement.",
    },
    {
      title: "9. Non-Solicitation",
      body: "The Contractor agrees not to directly solicit or accept work from any Client of Silvershadow Studio Limited or freelance contributor introduced by the Client for a period of 24 months following termination, without prior written consent.",
    },
    {
      title: "10. Non-Disparagement",
      body: "The Contractor agrees not to make or publish any disparaging, defamatory, or negative statements about the Client, its directors, employees, services, or clients, whether during or after the term of this Agreement.",
    },
    {
      title: "11. Termination",
      body: "This Agreement may be terminated by either party with 7 days' written notice. The Client may terminate the agreement immediately if the Contractor breaches confidentiality, fails to perform services to a reasonable standard, or acts in a manner that brings the Client into disrepute. Upon termination, the Contractor shall be entitled to payment for all approved work completed up to the termination date.",
    },
    {
      title: "12. Bank Holidays and Weekends",
      body: "The Contractor is not required to work on weekends or during the eight standard UK Bank Holidays: New Year's Day, Good Friday, Easter Monday, Early May Bank Holiday, Spring Bank Holiday, Summer Bank Holiday, Christmas Day, Boxing Day.",
    },
    {
      title: "13. Entire Agreement",
      body: "This Agreement constitutes the entire agreement between the Parties and supersedes all prior oral or written understandings. Any changes must be made in writing and signed by both Parties.",
    },
    {
      title: "14. Governing Law",
      body: "This Agreement shall be governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England.",
    },
    {
      title: "15. Signatures",
      body: "IN WITNESS WHEREOF, the parties have executed this Agreement on the date first above written.",
    },
  ];
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  flatNumber: string;
  houseNumber: string;
  streetName: string;
  city: string;
  postcode: string;
  country: string;
  rateAmount: string;
  rateCurrency: string;
  ratePeriod: string;
  bankName: string;
  accountHolder: string;
  sortCode: string;
  accountNumber: string;
}

type Touched = Partial<Record<keyof FormData, boolean>>;

const REQUIRED_FIELDS: (keyof FormData)[] = [
  "firstName", "lastName", "email",
  "houseNumber", "streetName", "city", "postcode", "country",
  "rateAmount",
  "bankName", "accountHolder", "sortCode", "accountNumber",
];

const FIELD_LABELS: Record<keyof FormData, string> = {
  firstName:     "First name",
  lastName:      "Last name",
  email:         "Email address",
  role:          "Role / title",
  flatNumber:    "Flat / apartment number",
  houseNumber:   "House / building number",
  streetName:    "Street name",
  city:          "City",
  postcode:      "Postcode",
  country:       "Country",
  rateAmount:    "Rate amount",
  rateCurrency:  "Currency",
  ratePeriod:    "Period",
  bankName:      "Bank name",
  accountHolder: "Account holder name",
  sortCode:      "Sort code",
  accountNumber: "Account number",
};

// ── Agreement preview component ────────────────────────────────────────────────

function AgreementPreview({ form, today }: { form: FormData; today: Date }) {
  const fullName = [form.firstName, form.lastName].filter(Boolean).join(" ") || "—";

  const addressParts: string[] = [];
  const flatPart = form.flatNumber.trim() ? `Flat ${form.flatNumber.trim()}` : "";
  const streetLine = [flatPart, `${form.houseNumber} ${form.streetName}`.trim()].filter(Boolean).join(", ").trim();
  if (streetLine && streetLine !== " ") addressParts.push(streetLine);
  if (form.city.trim()) addressParts.push(form.city.trim());
  if (form.postcode.trim()) addressParts.push(form.postcode.trim());
  if (form.country.trim()) addressParts.push(form.country.trim());
  const address = addressParts.length > 0 ? addressParts.join(", ") : "—";

  const dateStr = formatOrdinalDate(today);

  const rateNum = parseFloat(form.rateAmount.replace(/[^0-9.]/g, ""));
  const rateStr = !isNaN(rateNum) && rateNum > 0
    ? `${rateNum.toFixed(2)} ${form.rateCurrency} per ${form.ratePeriod.toLowerCase()}`
    : "— per —";

  const clauses = buildClauses(rateStr);

  return (
    <div
      className="border border-border/30 font-sans text-foreground/70"
      style={{ fontSize: 11, lineHeight: 1.8, padding: "48px 52px" }}
    >
      {/* Doc ref */}
      <p className="text-foreground/25 uppercase tracking-[0.4em] mb-10" style={{ fontSize: 7 }}>FSA-1.0</p>

      {/* Title block */}
      <div className="mb-10">
        <p className="italic text-foreground/40 mb-1" style={{ fontSize: 11 }}>Freelance Service Agreement</p>
        <p className="text-foreground/80" style={{ fontSize: 10.5 }}>{fullName}</p>
        <p className="text-foreground/30 uppercase tracking-[0.28em] mt-3" style={{ fontSize: 7 }}>{dateStr}</p>
      </div>

      {/* Preamble */}
      <div className="space-y-3 mb-8" style={{ fontSize: 10.5 }}>
        <p className="text-foreground/55">
          This Freelance Services Agreement ("Agreement") is made and entered into on {dateStr} by and between:
        </p>
        <div className="mt-2">
          <p className="text-foreground/75">Client:&nbsp; Silvershadow Studio Limited</p>
          <p className="text-foreground/45" style={{ fontSize: 9.5 }}>332 Ladbroke Grove, London, W10 5AD</p>
          <p className="text-foreground/45" style={{ fontSize: 9.5 }}>Company No: 9178937</p>
          <p className="text-foreground/45" style={{ fontSize: 9.5 }}>VAT Number: GB 232 8467 02</p>
          <p className="text-foreground/45 mt-0.5" style={{ fontSize: 9.5 }}>("Client")</p>
        </div>
        <p className="text-foreground/35 py-1">and</p>
        <div>
          <p className="text-foreground/75">Contractor:&nbsp; {fullName}</p>
          <p className="text-foreground/45 mt-0.5" style={{ fontSize: 9.5 }}>{address}</p>
          <p className="text-foreground/45 mt-0.5" style={{ fontSize: 9.5 }}>("Contractor")</p>
        </div>
        <p className="text-foreground/55 mt-2">
          The Client and the Contractor (collectively, the "Parties") agree as follows:
        </p>
      </div>

      {/* Clauses */}
      <div className="space-y-7 mt-10">
        {clauses.map((clause) => (
          <div key={clause.title}>
            <p
              className="uppercase text-foreground/45 mb-2"
              style={{ fontSize: 8.5, letterSpacing: "0.24em", fontWeight: 600 }}
            >
              {clause.title}
            </p>
            {clause.title !== "15. Signatures" && (
              <p className="text-foreground/60" style={{ fontSize: 10.5 }}>{clause.body}</p>
            )}
          </div>
        ))}
      </div>

      {/* Signature block */}
      <div className="grid grid-cols-2 gap-12 mt-14">
        <div>
          <div className="mt-10 pt-3 border-t border-foreground/15">
            <p className="text-foreground/70" style={{ fontSize: 9 }}>{fullName}</p>
            <p className="text-foreground/30 mt-1" style={{ fontSize: 8 }}>{dateStr}</p>
          </div>
        </div>
        <div>
          <div className="mt-10 pt-3 border-t border-foreground/15">
            <p className="text-foreground/70" style={{ fontSize: 9 }}>Silvershadow Studio Limited</p>
            <p className="text-foreground/50 mt-0.5" style={{ fontSize: 8.5 }}>Fred Colomb — Director</p>
            <p className="text-foreground/30 mt-0.5" style={{ fontSize: 8 }}>{dateStr}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="mt-10 pt-4 border-t border-border/20 text-center text-foreground/20 uppercase space-y-1"
        style={{ fontSize: 6, letterSpacing: "0.18em" }}
      >
        <p>SILVERSHADOW STUDIO LIMITED  |  REGISTERED IN ENGLAND &amp; WALES: 9178937  |  VAT NUMBER: GB 232 8467 02</p>
        <p>332 LADBROKE GROVE, LONDON, W10 5AD  |  +44(0)203 876 5980  |  SILVERSHADOWSTUDIO.COM</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Onboarding() {
  const navigate  = useNavigate();
  const { toast } = useToast();
  const { user, refreshProfileStatus } = useAuth();

  const today = useMemo(() => new Date(), []);

  const [form, setForm] = useState<FormData>({
    firstName: "", lastName: "", email: user?.email ?? "",
    role: "",
    flatNumber: "", houseNumber: "", streetName: "", city: "", postcode: "", country: "",
    rateAmount: "", rateCurrency: "GBP", ratePeriod: "day",
    bankName: "", accountHolder: "", sortCode: "", accountNumber: "",
  });
  const [touched, setTouched] = useState<Touched>({});
  const [agreed, setAgreed]   = useState(false);
  const [signing, setSigning] = useState(false);

  const showError = (field: keyof FormData) =>
    !!touched[field] && REQUIRED_FIELDS.includes(field) && !form[field].trim();

  const handleBlur = (field: keyof FormData) =>
    setTouched((p) => ({ ...p, [field]: true }));

  const handleChange = (field: keyof FormData, value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  const inputClass = (field: keyof FormData) =>
    `w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-colors ${
      showError(field)
        ? "border-destructive focus:border-destructive"
        : "border-border focus:border-gold"
    }`;

  const selectClass = (field: keyof FormData) =>
    `w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-colors appearance-none cursor-pointer ${
      showError(field)
        ? "border-destructive focus:border-destructive"
        : "border-border focus:border-gold"
    }`;

  async function handleSign() {
    const allTouched = REQUIRED_FIELDS.reduce((a, f) => ({ ...a, [f]: true }), {} as Touched);
    setTouched(allTouched);

    const missing = REQUIRED_FIELDS.filter((f) => !form[f].trim());
    if (missing.length > 0) {
      toast({ title: "Please complete all required fields", variant: "destructive" });
      const el = document.querySelector(`[data-field="${missing[0]}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el?.querySelector("input, select") as HTMLElement | null)?.focus?.();
      return;
    }

    const rateNum = parseFloat(form.rateAmount.replace(/[^0-9.]/g, ""));
    if (isNaN(rateNum) || rateNum <= 0) {
      toast({ title: "Please enter a valid rate amount", variant: "destructive" });
      return;
    }

    if (!agreed) {
      toast({ title: "Please confirm you have read and agree to the terms", variant: "destructive" });
      document.getElementById("agree-checkbox")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSigning(true);
    try {
      const { error } = await supabase.functions.invoke("sign-freelancer-agreement", {
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

  return (
    <div className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="mb-14 animate-fade-in">
          <div className="flex items-start gap-4">
            <div className="w-0.5 self-stretch bg-gold" style={{ opacity: 0.4 }} />
            <div>
              <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground">
                Freelancer Onboarding
              </h1>
              <p className="mt-3 font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.24em" }}>
                Complete your details to sign your services agreement
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-14 animate-fade-in" style={{ animationDelay: "0.1s" }}>

          {/* ── Section 01: Personal Details ──────────────────────────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                01 — Personal Details
              </span>
            </div>
            <div className="space-y-7">
              {(["firstName", "lastName", "email", "role"] as const).map((field) => (
                <div key={field} className="space-y-1.5" data-field={field}>
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && <span className="ml-1 text-gold">*</span>}
                  </label>
                  <input
                    type={field === "email" ? "email" : "text"}
                    value={form[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    onBlur={() => handleBlur(field)}
                    readOnly={field === "email"}
                    className={inputClass(field) + (field === "email" ? " opacity-50 cursor-default" : "")}
                  />
                  {showError(field) && (
                    <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Section 02: Address ───────────────────────────────────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                02 — Address
              </span>
            </div>
            <div className="space-y-7">
              {(["flatNumber", "houseNumber", "streetName", "city", "postcode", "country"] as const).map((field) => (
                <div key={field} className="space-y-1.5" data-field={field}>
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && <span className="ml-1 text-gold">*</span>}
                  </label>
                  <input
                    type="text"
                    value={form[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    onBlur={() => handleBlur(field)}
                    className={inputClass(field)}
                  />
                  {showError(field) && (
                    <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Section 03: Rate ──────────────────────────────────────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                03 — Rate
              </span>
            </div>
            <div className="space-y-7">
              <div className="space-y-1.5" data-field="rateAmount">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                  {FIELD_LABELS.rateAmount} <span className="text-gold">*</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.rateAmount}
                  onChange={(e) => handleChange("rateAmount", e.target.value)}
                  onBlur={() => handleBlur("rateAmount")}
                  placeholder="e.g. 350"
                  className={inputClass("rateAmount")}
                />
                {showError("rateAmount") && (
                  <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5" data-field="rateCurrency">
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {FIELD_LABELS.rateCurrency}
                  </label>
                  <select
                    value={form.rateCurrency}
                    onChange={(e) => handleChange("rateCurrency", e.target.value)}
                    className={selectClass("rateCurrency")}
                  >
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="space-y-1.5" data-field="ratePeriod">
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {FIELD_LABELS.ratePeriod}
                  </label>
                  <select
                    value={form.ratePeriod}
                    onChange={(e) => handleChange("ratePeriod", e.target.value)}
                    className={selectClass("ratePeriod")}
                  >
                    <option value="day">Per day</option>
                    <option value="week">Per week</option>
                    <option value="month">Per month</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* ── Section 04: Bank Details ──────────────────────────────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                04 — Bank Details
              </span>
            </div>
            <div className="space-y-7">
              {(["bankName", "accountHolder", "sortCode", "accountNumber"] as const).map((field) => (
                <div key={field} className="space-y-1.5" data-field={field}>
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {FIELD_LABELS[field]} <span className="text-gold">*</span>
                  </label>
                  <input
                    type="text"
                    value={form[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    onBlur={() => handleBlur(field)}
                    className={inputClass(field)}
                  />
                  {showError(field) && (
                    <p className="font-sans text-destructive" style={{ fontSize: 10 }}>Required</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Section 05: Services Agreement (inline preview) ───────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                05 — Services Agreement
              </span>
            </div>

            <AgreementPreview form={form} today={today} />

            <label id="agree-checkbox" className="flex items-start gap-3 cursor-pointer mt-8">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 shrink-0 accent-gold"
              />
              <span className="font-sans text-foreground/60" style={{ fontSize: 12, lineHeight: 1.6 }}>
                I have read and agree to the Freelance Service Agreement above. I understand that by clicking Sign Agreement, a PDF will be generated and stored as a record of my acceptance.
              </span>
            </label>
          </section>

          {/* ── Sign button ───────────────────────────────────────────────── */}
          <button
            onClick={handleSign}
            disabled={signing}
            className="w-full flex items-center justify-center gap-2 bg-foreground text-background py-4 font-sans uppercase hover:bg-foreground/90 transition-colors disabled:opacity-50"
            style={{ fontSize: 10, letterSpacing: "0.22em" }}
          >
            {signing && <Loader2 className="h-4 w-4 animate-spin" />}
            {signing ? "Signing..." : "Sign Agreement"}
          </button>

        </div>
      </div>
    </div>
  );
}
