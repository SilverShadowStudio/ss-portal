import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const AGREEMENT_TERMS = `FREELANCER SERVICES AGREEMENT

This Freelancer Services Agreement ("Agreement") is between Silvershadow Studio Limited, a company incorporated in England and Wales ("the Studio"), and the Freelancer whose details are set out below.

1. SERVICES
The Freelancer agrees to provide CGI production, architectural visualisation, or related creative services on a project-by-project basis as assigned by the Studio. The Studio makes no guarantee of minimum work volume.

2. DAY RATE AND PAYMENT
The agreed day rate is as specified below. The Studio will pay agreed invoices within 30 days of receipt, provided the Services have been delivered to the agreed standard.

3. INTELLECTUAL PROPERTY
All work product, deliverables, and creative output produced under this Agreement shall be the exclusive intellectual property of Silvershadow Studio Limited upon full payment. The Freelancer retains no licence to use, reproduce, or distribute work produced for the Studio without prior written consent.

4. CONFIDENTIALITY
The Freelancer agrees to keep strictly confidential all client identities, project details, business information, and technical processes belonging to the Studio and its clients. This obligation survives termination of this Agreement for a period of five years.

5. INDEPENDENT CONTRACTOR
The Freelancer is an independent contractor and not an employee of the Studio. The Freelancer is solely responsible for their own tax obligations, National Insurance contributions, and professional indemnity insurance.

6. TERMINATION
Either party may terminate this Agreement with 14 days' written notice. The Studio may terminate immediately for material breach, including non-delivery, breach of confidentiality, or misconduct.

7. GOVERNING LAW
This Agreement is governed by the laws of England and Wales. Both parties submit to the exclusive jurisdiction of the English courts.`;

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  dayRate: string;
  address: string;
  bankName: string;
  accountHolder: string;
  sortCode: string;
  accountNumber: string;
}

type Touched = Partial<Record<keyof FormData, boolean>>;

const REQUIRED_FIELDS: (keyof FormData)[] = [
  "firstName", "lastName", "email", "dayRate",
  "bankName", "accountHolder", "sortCode", "accountNumber",
];

const FIELD_LABELS: Record<keyof FormData, string> = {
  firstName:     "First name",
  lastName:      "Last name",
  email:         "Email address",
  role:          "Role / title",
  dayRate:       "Day rate (GBP)",
  address:       "Address",
  bankName:      "Bank name",
  accountHolder: "Account holder name",
  sortCode:      "Sort code",
  accountNumber: "Account number",
};

export default function Onboarding() {
  const navigate  = useNavigate();
  const { toast } = useToast();
  const { user, refreshProfileStatus } = useAuth();

  const [form, setForm]       = useState<FormData>({
    firstName: "", lastName: "", email: user?.email ?? "",
    role: "", dayRate: "", address: "",
    bankName: "", accountHolder: "", sortCode: "", accountNumber: "",
  });
  const [touched, setTouched] = useState<Touched>({});
  const [agreed, setAgreed]   = useState(false);
  const [signing, setSigning] = useState(false);

  // Pre-fill email from auth user.
  useEffect(() => {
    if (user?.email) setForm((p) => ({ ...p, email: user.email! }));
  }, [user?.email]);

  const showError = (field: keyof FormData) =>
    !!touched[field] && REQUIRED_FIELDS.includes(field) && !form[field].trim();

  const handleBlur = (field: keyof FormData) =>
    setTouched((p) => ({ ...p, [field]: true }));

  const handleChange = (field: keyof FormData, value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  async function handleSign() {
    // Mark all required fields as touched for validation display.
    const allTouched = REQUIRED_FIELDS.reduce((a, f) => ({ ...a, [f]: true }), {} as Touched);
    setTouched(allTouched);

    const missing = REQUIRED_FIELDS.filter((f) => !form[f].trim());
    if (missing.length > 0) {
      toast({ title: "Please complete all required fields", variant: "destructive" });
      const el = document.querySelector(`[data-field="${missing[0]}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el?.querySelector("input, textarea") as HTMLElement | null)?.focus?.();
      return;
    }

    const dayRateNum = parseFloat(form.dayRate.replace(/[^0-9.]/g, ""));
    if (isNaN(dayRateNum) || dayRateNum <= 0) {
      toast({ title: "Please enter a valid day rate", variant: "destructive" });
      return;
    }

    if (!agreed) {
      toast({ title: "Please confirm you have read and agree to the terms", variant: "destructive" });
      document.getElementById("agree-checkbox")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSigning(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke("sign-freelancer-agreement", {
        body: {
          firstName:     form.firstName.trim(),
          lastName:      form.lastName.trim(),
          email:         form.email.trim(),
          role:          form.role.trim(),
          dayRate:       dayRateNum,
          address:       form.address.trim(),
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

  const inputClass = (field: keyof FormData) =>
    `w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-colors ${
      showError(field)
        ? "border-destructive focus:border-destructive"
        : "border-border focus:border-gold"
    }`;

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

          {/* ── Section 01: Personal Details ─────────────────────────────── */}
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
                </div>
              ))}
            </div>
          </section>

          {/* ── Section 02: Rate ─────────────────────────────────────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                02 — Rate
              </span>
            </div>
            <div className="space-y-7">
              <div className="space-y-1.5" data-field="dayRate">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                  Day Rate (GBP) <span className="text-gold">*</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.dayRate}
                  onChange={(e) => handleChange("dayRate", e.target.value)}
                  onBlur={() => handleBlur("dayRate")}
                  placeholder="e.g. 350"
                  className={inputClass("dayRate")}
                />
              </div>
              <div className="space-y-1.5" data-field="address">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                  Address
                </label>
                <textarea
                  value={form.address}
                  onChange={(e) => handleChange("address", e.target.value)}
                  onBlur={() => handleBlur("address")}
                  rows={3}
                  className="w-full border-0 border-b border-border bg-transparent py-3 text-foreground focus:outline-none focus:border-gold transition-colors resize-none"
                />
              </div>
            </div>
          </section>

          {/* ── Section 03: Bank Details ─────────────────────────────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                03 — Bank Details
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
                </div>
              ))}
            </div>
          </section>

          {/* ── Section 04: Agreement ────────────────────────────────────── */}
          <section>
            <div className="border-b border-border pb-2 mb-8">
              <span className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                04 — Services Agreement
              </span>
            </div>

            <div
              className="h-72 overflow-y-auto border border-border/30 p-6 mb-8 font-sans text-foreground/50"
              style={{ fontSize: 11, lineHeight: 1.7, letterSpacing: "0.01em" }}
            >
              {AGREEMENT_TERMS.split("\n").map((line, i) => (
                <p key={i} className={line.trim() === "" ? "mt-3" : line.match(/^\d+\./) || line === line.toUpperCase() ? "mt-5 font-medium text-foreground/70" : ""}>
                  {line || <>&nbsp;</>}
                </p>
              ))}
            </div>

            <label id="agree-checkbox" className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 shrink-0 accent-gold"
              />
              <span className="font-sans text-foreground/60" style={{ fontSize: 12, lineHeight: 1.6 }}>
                I have read and agree to the Freelancer Services Agreement above. I understand that by clicking Sign Agreement, a PDF will be generated and stored as a record of my acceptance.
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
