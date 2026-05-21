// Admin form to create a DRAFT team engagement contract (individual or
// company). Posts to the team-contract-create edge function, which inserts a
// team_contracts row with status='draft' and account_id/profile_id NULL.
// The freelancer profile + team account + invite are created later by the
// "Send to portal for signature" flow (Commit 5), when the auth user exists.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type EntityType = "individual" | "company";

/** A team_contracts row, as fetched when re-opening a draft to edit. */
export interface TeamContractRow {
  id: string;
  entity_type: EntityType;
  individual_full_name: string | null;
  individual_address: string | null;
  individual_nationality: string | null;
  individual_ni_number: string | null;
  company_name: string | null;
  company_registered_office: string | null;
  company_jurisdiction: string | null;
  company_registration_number: string | null;
  company_vat_number: string | null;
  company_director_name: string | null;
  company_director_title: string | null;
  recipient_email: string | null;
  subject_line: string | null;
  scope_description: string | null;
  project_reference: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  round_1_deadline: string | null;
  round_2_deadline: string | null;
  fee_amount: number | string | null;
  fee_currency: string | null;
  fee_scope_description: string | null;
  payment_milestone_1_pct: number | null;
  payment_milestone_2_pct: number | null;
  payment_milestone_3_pct: number | null;
}

interface TeamContractFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a draft is created/updated so the caller can refresh its list. */
  onSaved?: () => void;
  /** When set, the dialog opens pre-filled to edit this existing draft; every
   *  action then UPDATEs the row rather than INSERTing a new one. */
  existingContract?: TeamContractRow | null;
}

const DEFAULT_SCOPE =
  "The Contractor will provide bespoke 3D modelling and CGI production services " +
  "for the project referenced below, delivered to Silvershadow Studio specifications " +
  "across the agreed rounds. Deliverables include editable working files and final " +
  "rendered output at the resolution and format directed by the studio.";

const CURRENCIES = ["EUR", "GBP", "USD"] as const;

const orNull = (s: string) => (s.trim() ? s.trim() : null);

interface FormState {
  entityType: EntityType;
  // individual
  individualFullName: string;
  individualAddress: string;
  individualNationality: string;
  individualNiNumber: string;
  // company
  companyName: string;
  companyRegisteredOffice: string;
  companyJurisdiction: string;
  companyRegistrationNumber: string;
  companyVatNumber: string;
  companyDirectorName: string;
  companyDirectorTitle: string;
  // contact (persisted on draft; used to create the auth user at Send-to-portal)
  recipientEmail: string;
  // shared
  subjectLine: string;
  scopeDescription: string;
  projectReference: string;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  round1Deadline: string;
  round2Deadline: string;
  // fee
  feeAmount: string;
  feeCurrency: string;
  feeScopeDescription: string;
  milestone1: number;
  milestone2: number;
  milestone3: number;
}

const initialState: FormState = {
  entityType: "individual",
  individualFullName: "", individualAddress: "", individualNationality: "", individualNiNumber: "",
  companyName: "", companyRegisteredOffice: "", companyJurisdiction: "",
  companyRegistrationNumber: "", companyVatNumber: "", companyDirectorName: "", companyDirectorTitle: "Director",
  recipientEmail: "",
  subjectLine: "", scopeDescription: DEFAULT_SCOPE, projectReference: "",
  deliveryWindowStart: "", deliveryWindowEnd: "", round1Deadline: "", round2Deadline: "",
  feeAmount: "", feeCurrency: "EUR", feeScopeDescription: "",
  milestone1: 10, milestone2: 40, milestone3: 50,
};

function rowToFormState(r: TeamContractRow): FormState {
  return {
    entityType: r.entity_type,
    individualFullName: r.individual_full_name ?? "",
    individualAddress: r.individual_address ?? "",
    individualNationality: r.individual_nationality ?? "",
    individualNiNumber: r.individual_ni_number ?? "",
    companyName: r.company_name ?? "",
    companyRegisteredOffice: r.company_registered_office ?? "",
    companyJurisdiction: r.company_jurisdiction ?? "",
    companyRegistrationNumber: r.company_registration_number ?? "",
    companyVatNumber: r.company_vat_number ?? "",
    companyDirectorName: r.company_director_name ?? "",
    companyDirectorTitle: r.company_director_title ?? "Director",
    recipientEmail: r.recipient_email ?? "",
    subjectLine: r.subject_line ?? "",
    scopeDescription: r.scope_description ?? "",
    projectReference: r.project_reference ?? "",
    deliveryWindowStart: r.delivery_window_start ?? "",
    deliveryWindowEnd: r.delivery_window_end ?? "",
    round1Deadline: r.round_1_deadline ?? "",
    round2Deadline: r.round_2_deadline ?? "",
    feeAmount: r.fee_amount != null ? String(r.fee_amount) : "",
    feeCurrency: r.fee_currency ?? "EUR",
    feeScopeDescription: r.fee_scope_description ?? "",
    milestone1: r.payment_milestone_1_pct ?? 10,
    milestone2: r.payment_milestone_2_pct ?? 40,
    milestone3: r.payment_milestone_3_pct ?? 50,
  };
}

const Label = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
    {children}{required && " *"}
  </label>
);

export function TeamContractFormDialog({ open, onOpenChange, onSaved, existingContract }: TeamContractFormDialogProps) {
  const { toast } = useToast();
  const [f, setF] = useState<FormState>(initialState);
  const [busy, setBusy] = useState<null | "generate" | "save">(null);
  // The saved draft id. Set when editing an existing draft, or after the first
  // create — so every later action UPDATEs the same row rather than INSERTing.
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

  // Pre-fill from an existing draft (edit) or reset to a blank form (new) each
  // time the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (existingContract) {
      setF(rowToFormState(existingContract));
      setLastCreatedId(existingContract.id);
    } else {
      setF(initialState);
      setLastCreatedId(null);
    }
  }, [open, existingContract?.id]);

  const up = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const milestoneSum = f.milestone1 + f.milestone2 + f.milestone3;

  const reset = () => { setF(initialState); setLastCreatedId(null); };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // Validate the form; returns the parsed fee on success, or null (with a toast).
  function validate(): number | null {
    if (f.entityType === "individual") {
      if (!f.individualFullName.trim()) { toast({ title: "Full name is required", variant: "destructive" }); return null; }
      if (!f.individualAddress.trim()) { toast({ title: "Address is required", variant: "destructive" }); return null; }
    } else {
      const reqd: Array<[keyof FormState, string]> = [
        ["companyName", "Company name"], ["companyRegisteredOffice", "Registered office"],
        ["companyJurisdiction", "Jurisdiction"], ["companyRegistrationNumber", "Registration number"],
        ["companyDirectorName", "Director name"],
      ];
      for (const [k, label] of reqd) {
        if (!String(f[k]).trim()) { toast({ title: `${label} is required`, variant: "destructive" }); return null; }
      }
    }
    if (!f.recipientEmail.trim()) { toast({ title: "Recipient email is required", variant: "destructive" }); return null; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.recipientEmail.trim())) {
      toast({ title: "Recipient email is not a valid email address", variant: "destructive" }); return null;
    }
    if (!f.subjectLine.trim()) { toast({ title: "Subject line is required", variant: "destructive" }); return null; }
    if (!f.scopeDescription.trim()) { toast({ title: "Scope description is required", variant: "destructive" }); return null; }
    const fee = parseFloat(f.feeAmount);
    if (Number.isNaN(fee) || fee < 0) { toast({ title: "A valid fee amount is required", variant: "destructive" }); return null; }
    if (milestoneSum !== 100) {
      toast({ title: "Payment milestones must sum to 100%", description: `Currently ${milestoneSum}%`, variant: "destructive" }); return null;
    }
    return fee;
  }

  // Create the draft contract; returns the new id, or null on failure (toasts).
  async function createDraft(fee: number): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast({ title: "No session", variant: "destructive" }); return null; }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/team-contract-create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        entity_type: f.entityType,
        recipient_email: f.recipientEmail.trim(),
        individual_full_name: f.individualFullName,
        individual_address: f.individualAddress,
        individual_nationality: f.individualNationality,
        individual_ni_number: f.individualNiNumber,
        company_name: f.companyName,
        company_registered_office: f.companyRegisteredOffice,
        company_jurisdiction: f.companyJurisdiction,
        company_registration_number: f.companyRegistrationNumber,
        company_vat_number: f.companyVatNumber,
        company_director_name: f.companyDirectorName,
        company_director_title: f.companyDirectorTitle,
        subject_line: f.subjectLine,
        scope_description: f.scopeDescription,
        project_reference: f.projectReference,
        delivery_window_start: f.deliveryWindowStart || null,
        delivery_window_end: f.deliveryWindowEnd || null,
        round_1_deadline: f.round1Deadline || null,
        round_2_deadline: f.round2Deadline || null,
        fee_amount: fee,
        fee_currency: f.feeCurrency,
        fee_scope_description: f.feeScopeDescription,
        payment_milestone_1_pct: f.milestone1,
        payment_milestone_2_pct: f.milestone2,
        payment_milestone_3_pct: f.milestone3,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Could not create contract", description: data?.error || `Request failed (${res.status})`, variant: "destructive" });
      return null;
    }
    return data?.contract?.id ?? null;
  }

  // Subsequent saves UPDATE the existing draft directly (admin RLS permits it),
  // so iterating doesn't create duplicate rows. The INSERT-only edge function
  // is unchanged.
  async function updateDraft(id: string, fee: number): Promise<boolean> {
    const { error } = await supabase
      .from("team_contracts")
      .update({
        entity_type: f.entityType,
        recipient_email: f.recipientEmail.trim(),
        individual_full_name: orNull(f.individualFullName),
        individual_address: orNull(f.individualAddress),
        individual_nationality: orNull(f.individualNationality),
        individual_ni_number: orNull(f.individualNiNumber),
        company_name: orNull(f.companyName),
        company_registered_office: orNull(f.companyRegisteredOffice),
        company_jurisdiction: orNull(f.companyJurisdiction),
        company_registration_number: orNull(f.companyRegistrationNumber),
        company_vat_number: orNull(f.companyVatNumber),
        company_director_name: orNull(f.companyDirectorName),
        company_director_title: orNull(f.companyDirectorTitle) ?? "Director",
        subject_line: f.subjectLine.trim(),
        scope_description: f.scopeDescription.trim(),
        project_reference: orNull(f.projectReference),
        delivery_window_start: f.deliveryWindowStart || null,
        delivery_window_end: f.deliveryWindowEnd || null,
        round_1_deadline: f.round1Deadline || null,
        round_2_deadline: f.round2Deadline || null,
        fee_amount: fee,
        fee_currency: f.feeCurrency,
        fee_scope_description: orNull(f.feeScopeDescription),
        payment_milestone_1_pct: f.milestone1,
        payment_milestone_2_pct: f.milestone2,
        payment_milestone_3_pct: f.milestone3,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      toast({ title: "Could not update draft", description: error.message, variant: "destructive" });
      return false;
    }
    return true;
  }

  async function downloadContractPdf(contractId: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("No session");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/preview-team-contract-pdf`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contract_id: contractId }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error || `PDF generation failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Silvershadow_Engagement_Contract.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // First click INSERTs the draft (via the edge function); subsequent clicks
  // UPDATE the same row so the admin can iterate. The dialog stays open with
  // all fields preserved until explicit Cancel / Close / X — only then is the
  // form (and the saved id) reset.
  async function handleGenerateAndDownload() {
    const fee = validate();
    if (fee === null) return;
    setBusy("generate");
    try {
      let id = lastCreatedId;
      if (!id) {
        id = await createDraft(fee);
        if (!id) return;
        setLastCreatedId(id);
      } else {
        const ok = await updateDraft(id, fee);
        if (!ok) return;
      }
      await downloadContractPdf(id);
      toast({ title: "Contract PDF downloaded — draft saved" });
      onSaved?.();
    } catch (err: any) {
      toast({ title: "Could not generate PDF", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  // "Save for later": persist what's typed (INSERT new, or UPDATE the existing
  // draft) and close. No PDF generated.
  async function handleSaveForLater() {
    const fee = validate();
    if (fee === null) return;
    setBusy("save");
    try {
      let id = lastCreatedId;
      if (!id) {
        id = await createDraft(fee);
        if (!id) return;
      } else {
        const ok = await updateDraft(id, fee);
        if (!ok) return;
      }
      toast({ title: "Draft saved" });
      reset();
      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      toast({ title: "Could not save draft", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const inputCls = "h-9";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existingContract ? "Edit engagement contract" : "New engagement contract"}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Saved as a draft. The contractor's profile, account and invite are created later when you send it for signature.
        </p>

        <div className="space-y-6 pt-2">
          {/* Entity toggle */}
          <div className="flex gap-2">
            {(["individual", "company"] as EntityType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => up("entityType", t)}
                className={`flex-1 h-10 text-[11px] uppercase tracking-[0.16em] border rounded-sm transition-colors ${
                  f.entityType === t
                    ? "border-gold text-gold bg-gold/5"
                    : "border-input text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
              >
                {t === "individual" ? "Individual" : "Company"}
              </button>
            ))}
          </div>

          {/* Party fields */}
          {f.entityType === "individual" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <Label required>Full name</Label>
                <Input className={inputCls} value={f.individualFullName} onChange={(e) => up("individualFullName", e.target.value)} />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label required>Address</Label>
                <Input className={inputCls} value={f.individualAddress} onChange={(e) => up("individualAddress", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Nationality</Label>
                <Input className={inputCls} value={f.individualNationality} onChange={(e) => up("individualNationality", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>NI / national ID</Label>
                <Input className={inputCls} value={f.individualNiNumber} onChange={(e) => up("individualNiNumber", e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <Label required>Company name</Label>
                <Input className={inputCls} value={f.companyName} onChange={(e) => up("companyName", e.target.value)} />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label required>Registered office address</Label>
                <Input className={inputCls} value={f.companyRegisteredOffice} onChange={(e) => up("companyRegisteredOffice", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label required>Jurisdiction</Label>
                <Input className={inputCls} placeholder="Bosnia and Herzegovina" value={f.companyJurisdiction} onChange={(e) => up("companyJurisdiction", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label required>Registration number</Label>
                <Input className={inputCls} value={f.companyRegistrationNumber} onChange={(e) => up("companyRegistrationNumber", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>VAT number</Label>
                <Input className={inputCls} value={f.companyVatNumber} onChange={(e) => up("companyVatNumber", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label required>Director name</Label>
                <Input className={inputCls} value={f.companyDirectorName} onChange={(e) => up("companyDirectorName", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Director title</Label>
                <Input className={inputCls} value={f.companyDirectorTitle} onChange={(e) => up("companyDirectorTitle", e.target.value)} />
              </div>
            </div>
          )}

          {/* Recipient email */}
          <div className="space-y-1 border-t border-border/50 pt-4">
            <Label required>Recipient email</Label>
            <Input className={inputCls} type="email" value={f.recipientEmail} onChange={(e) => up("recipientEmail", e.target.value)} placeholder="contact@studio.com" />
            <p className="text-[11px] text-muted-foreground/60">Used to invite them to sign when you send the contract for signature.</p>
          </div>

          {/* Scope */}
          <div className="space-y-3 border-t border-border/50 pt-4">
            <div className="space-y-1">
              <Label required>Subject line</Label>
              <Input className={inputCls} placeholder="Subcontractor engagement: bespoke 3D modelling, June 2026" value={f.subjectLine} onChange={(e) => up("subjectLine", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label required>Scope description</Label>
              <textarea
                value={f.scopeDescription}
                onChange={(e) => up("scopeDescription", e.target.value)}
                rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
            <div className="space-y-1">
              <Label>Project reference</Label>
              <Input className={inputCls} placeholder="CP107 — Charles Street" value={f.projectReference} onChange={(e) => up("projectReference", e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Delivery window start</Label>
                <Input className={inputCls} type="date" value={f.deliveryWindowStart} onChange={(e) => up("deliveryWindowStart", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Delivery window end</Label>
                <Input className={inputCls} type="date" value={f.deliveryWindowEnd} onChange={(e) => up("deliveryWindowEnd", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Round 1 deadline</Label>
                <Input className={inputCls} type="date" value={f.round1Deadline} onChange={(e) => up("round1Deadline", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Round 2 deadline</Label>
                <Input className={inputCls} type="date" value={f.round2Deadline} onChange={(e) => up("round2Deadline", e.target.value)} />
              </div>
            </div>
          </div>

          {/* Fee */}
          <div className="space-y-3 border-t border-border/50 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <Label required>Fee amount</Label>
                <Input className={inputCls} type="number" min={0} step="0.01" value={f.feeAmount} onChange={(e) => up("feeAmount", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <select
                  value={f.feeCurrency}
                  onChange={(e) => up("feeCurrency", e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Fee scope note</Label>
              <Input className={inputCls} placeholder="e.g. fixed fee for two rounds of revisions" value={f.feeScopeDescription} onChange={(e) => up("feeScopeDescription", e.target.value)} />
            </div>
            <div>
              <Label>Payment milestones (%)</Label>
              <div className="grid grid-cols-3 gap-3 mt-1">
                {([["milestone1", "On signature"], ["milestone2", "On Round 1"], ["milestone3", "On completion"]] as const).map(([k, lbl]) => (
                  <div key={k} className="space-y-1">
                    <Input
                      className={inputCls}
                      type="number" min={0} max={100}
                      value={f[k]}
                      onChange={(e) => up(k, Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
                    />
                    <span className="block text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">{lbl}</span>
                  </div>
                ))}
              </div>
              <p className={`mt-2 text-[11px] ${milestoneSum === 100 ? "text-muted-foreground/60" : "text-destructive"}`}>
                Total: {milestoneSum}%{milestoneSum !== 100 ? " — must equal 100%" : ""}
              </p>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            {/* Top row: Cancel + primary "Generate and download PDF" */}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => close(false)} disabled={busy !== null} className="text-muted-foreground">
                Cancel
              </Button>
              <Button onClick={handleGenerateAndDownload} disabled={busy !== null} className="flex-1">
                {busy === "generate" ? "Generating…" : "Generate and download PDF"}
              </Button>
            </div>
            {/* Middle row: tertiary "park this" action — neutral, not gold */}
            <Button variant="secondary" onClick={handleSaveForLater} disabled={busy !== null} className="w-full">
              {busy === "save" ? "Saving…" : "Save for later"}
            </Button>
            {/* Bottom row: second primary, enabled in Commit 5 */}
            <div>
              <Button disabled variant="outline" className="w-full">
                Send to portal for signature
              </Button>
              <p className="text-[11px] text-muted-foreground/60 text-center mt-1">Coming next</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
