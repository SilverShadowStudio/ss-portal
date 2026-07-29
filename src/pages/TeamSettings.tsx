import { useEffect, useState } from "react";
import { ClientLayout } from "@/components/ClientLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Profile {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  flat_number: string | null;
  house_number: string | null;
  street_name: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  bank_name: string | null;
  account_holder: string | null;
  sort_code: string | null;
  account_number: string | null;
}

const EMPTY: Profile = {
  first_name: null, last_name: null, email: null, phone: null,
  flat_number: null, house_number: null, street_name: null, city: null, postcode: null, country: null,
  bank_name: null, account_holder: null, sort_code: null, account_number: null,
};

function formatAddress(p: Profile): string {
  const flat = p.flat_number?.trim() ? `Flat ${p.flat_number.trim()}, ` : "";
  const parts = [p.house_number, p.street_name].filter(Boolean).join(" ");
  return `${flat}${parts}, ${p.city ?? ""}, ${p.postcode ?? ""}, ${p.country ?? ""}`.replace(/^,\s*|,\s*,/g, "").trim();
}

/**
 * Team member self-service settings — update contact, address and bank details,
 * and change password. RLS (fp_own_all) scopes every read/write to the signed-in
 * person's own freelancer_profiles row.
 */
export default function TeamSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [savingDetails, setSavingDetails] = useState(false);
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("freelancer_profiles")
        .select("first_name, last_name, email, phone, flat_number, house_number, street_name, city, postcode, country, bank_name, account_holder, sort_code, account_number")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setForm({ ...EMPTY, ...(data as Partial<Profile>) });
      setLoading(false);
    })();
  }, [user]);

  const set = <K extends keyof Profile>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const s = (v: string | null) => (v ?? "");

  async function saveDetails() {
    if (!user) return;
    setSavingDetails(true);
    const patch = {
      phone: s(form.phone).trim() || null,
      flat_number: s(form.flat_number).trim() || null,
      house_number: s(form.house_number).trim() || null,
      street_name: s(form.street_name).trim() || null,
      city: s(form.city).trim() || null,
      postcode: s(form.postcode).trim() || null,
      country: s(form.country).trim() || null,
      address: formatAddress(form) || null,
      bank_name: s(form.bank_name).trim() || null,
      account_holder: s(form.account_holder).trim() || null,
      sort_code: s(form.sort_code).trim() || null,
      account_number: s(form.account_number).trim() || null,
    };
    const { error } = await supabase.from("freelancer_profiles").update(patch).eq("user_id", user.id);
    setSavingDetails(false);
    if (error) { toast({ title: "Couldn't save your details", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Details saved" });
  }

  async function savePassword() {
    if (pw.next.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    if (pw.next !== pw.confirm) { toast({ title: "Passwords don't match", variant: "destructive" }); return; }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setSavingPw(false);
    if (error) { toast({ title: "Couldn't update password", description: error.message, variant: "destructive" }); return; }
    setPw({ next: "", confirm: "" });
    toast({ title: "Password updated" });
  }

  const displayName = [form.first_name, form.last_name].filter(Boolean).join(" ");

  const field = (label: string, key: keyof Profile, props: { type?: string; placeholder?: string; span2?: boolean } = {}) => (
    <div className={`space-y-1.5 ${props.span2 ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      <Input type={props.type ?? "text"} value={s(form[key] as string | null)} onChange={(e) => set(key, e.target.value)} placeholder={props.placeholder} className="rounded-sm" />
    </div>
  );

  return (
    <ClientLayout panel>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold">Settings</span>
        </div>
        <p className="mt-3 text-sm text-recessive">{displayName ? `${displayName} — your` : "Your"} contact, address, bank details and password</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><BrandLoader size="md" /></div>
      ) : (
        <div className="space-y-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {/* Contact & address */}
          <section className="ssr-zone">
            <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
              <div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Contact &amp; address</h2>
            </div>
            <div className="ssr-tile p-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("Phone", "phone", { type: "tel", placeholder: "+44 …" })}
              <div className="space-y-1.5"><Label>Email</Label><Input value={s(form.email)} readOnly className="rounded-sm opacity-50 cursor-default" /></div>
              {field("Flat / unit (optional)", "flat_number")}
              {field("House / building no.", "house_number")}
              {field("Street", "street_name", { span2: true })}
              {field("City", "city")}
              {field("Postcode", "postcode")}
              {field("Country", "country", { span2: true })}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={saveDetails} disabled={savingDetails} className="rounded-sm">{savingDetails ? "Saving…" : "Save details"}</Button>
            </div>
          </section>

          {/* Bank details */}
          <section className="ssr-zone">
            <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
              <div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Bank details</h2>
            </div>
            <div className="ssr-tile p-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("Bank name", "bank_name")}
              {field("Account holder", "account_holder")}
              {field("Sort code", "sort_code", { placeholder: "00-00-00" })}
              {field("Account number", "account_number")}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={saveDetails} disabled={savingDetails} className="rounded-sm">{savingDetails ? "Saving…" : "Save details"}</Button>
            </div>
          </section>

          {/* Password */}
          <section className="ssr-zone">
            <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
              <div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Password</h2>
            </div>
            <div className="ssr-tile p-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>New password</Label><Input type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} placeholder="At least 8 characters" className="rounded-sm" /></div>
              <div className="space-y-1.5"><Label>Confirm new password</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} className="rounded-sm" /></div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={savePassword} disabled={savingPw || !pw.next} className="rounded-sm">{savingPw ? "Updating…" : "Update password"}</Button>
            </div>
          </section>
        </div>
      )}
    </ClientLayout>
  );
}
