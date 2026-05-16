import { useRef, useState, useEffect } from "react";
import { Loader2, CheckCircle2, Upload } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { DropboxConnectionStatus } from "@/components/admin/DropboxConnectionStatus";
import { AirtableSyncPanel } from "@/components/admin/AirtableSyncPanel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const labelCls = "block text-[9px] uppercase tracking-[0.26em] text-foreground/40 mb-1.5";
const inputCls = "w-full bg-transparent border-b border-border/50 py-2 text-sm text-foreground focus:outline-none focus:border-gold transition-colors placeholder:text-foreground/25";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border/30 pt-10">
      <p className="text-[9px] uppercase tracking-[0.32em] text-foreground/35 font-sans mb-6">{title}</p>
      {children}
    </div>
  );
}

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Profile ──────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // ── Password ─────────────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // ── Studio Signature ──────────────────────────────────────────────────────
  const sigFileRef = useRef<HTMLInputElement>(null);
  const [savingSignature, setSavingSignature] = useState(false);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string | null>(null);

  // ── Airtable Contact Sync (Users + Clients tables) ────────────────────────
  const [contactBaseId, setContactBaseId] = useState("");
  const [contactTableId, setContactTableId] = useState("");
  const [contactFieldFirstName, setContactFieldFirstName] = useState("");
  const [contactFieldSurname, setContactFieldSurname] = useState("");
  const [contactFieldRole, setContactFieldRole] = useState("");
  const [contactFieldTypeOfClient, setContactFieldTypeOfClient] = useState("");
  const [contactFieldEmail, setContactFieldEmail] = useState("");
  const [contactFieldClientLink, setContactFieldClientLink] = useState("");
  const [contactFieldCompanyLink, setContactFieldCompanyLink] = useState("");
  const [contactClientsTableId, setContactClientsTableId] = useState("");
  const [contactFieldCompanyName, setContactFieldCompanyName] = useState("");
  const [contactFieldClientRepresentative, setContactFieldClientRepresentative] = useState("");
  const [savingContactConfig, setSavingContactConfig] = useState(false);

  // ── Airtable Project Sync ─────────────────────────────────────────────────
  const [projectBaseId, setProjectBaseId] = useState("");
  const [projectTableId, setProjectTableId] = useState("");
  const [projectFieldName, setProjectFieldName] = useState("");
  const [projectFieldClientFacingName, setProjectFieldClientFacingName] = useState("");
  const [projectFieldClientLink, setProjectFieldClientLink] = useState("");
  const [projectFieldProjectType, setProjectFieldProjectType] = useState("");
  const [projectFieldContractOrSubscription, setProjectFieldContractOrSubscription] = useState("");
  const [projectFieldStatus, setProjectFieldStatus] = useState("");
  const [savingProjectConfig, setSavingProjectConfig] = useState(false);

  useEffect(() => {
    supabase.storage.from("studio-assets").createSignedUrl("silvershadow-signature.png", 60)
      .then(({ data }) => { if (data?.signedUrl) setSignaturePreviewUrl(data.signedUrl); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          if (data.first_name || data.last_name) {
            setFirstName(data.first_name ?? "");
            setLastName(data.last_name ?? "");
          } else if (data.full_name) {
            const parts = data.full_name.trim().split(/\s+/);
            setFirstName(parts[0] ?? "");
            setLastName(parts.slice(1).join(" "));
          }
        }
      });
  }, [user]);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "airtable_contact_field_config")
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.value) return;
        const v = data.value as Record<string, string>;
        setContactBaseId(v.base_id ?? "");
        setContactTableId(v.table_id ?? "");
        setContactFieldFirstName(v.field_first_name ?? "");
        setContactFieldSurname(v.field_surname ?? "");
        setContactFieldRole(v.field_role ?? "");
        setContactFieldTypeOfClient(v.field_type_of_client ?? "");
        setContactFieldEmail(v.field_email ?? "");
        setContactFieldClientLink(v.field_client_link ?? "");
        setContactFieldCompanyLink(v.field_company_link ?? "");
        setContactClientsTableId(v.clients_table_id ?? "");
        setContactFieldCompanyName(v.field_company_name ?? "");
        setContactFieldClientRepresentative(v.field_client_representative ?? "");
      });
  }, []);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "airtable_project_field_config")
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.value) return;
        const v = data.value as Record<string, string>;
        setProjectBaseId(v.base_id ?? "");
        setProjectTableId(v.table_id ?? "");
        setProjectFieldName(v.field_project_name ?? "");
        setProjectFieldClientFacingName(v.field_client_facing_name ?? "");
        setProjectFieldClientLink(v.field_client_link ?? "");
        setProjectFieldProjectType(v.field_project_type ?? "");
        setProjectFieldContractOrSubscription(v.field_contract_or_subscription ?? "");
        setProjectFieldStatus(v.field_status ?? "");
      });
  }, []);

  async function saveContactConfig() {
    setSavingContactConfig(true);
    try {
      const { error } = await supabase.from("app_settings").upsert({
        key: "airtable_contact_field_config",
        value: {
          base_id: contactBaseId.trim(),
          table_id: contactTableId.trim(),
          field_first_name: contactFieldFirstName.trim(),
          field_surname: contactFieldSurname.trim(),
          field_role: contactFieldRole.trim(),
          field_type_of_client: contactFieldTypeOfClient.trim(),
          field_email: contactFieldEmail.trim(),
          field_client_link: contactFieldClientLink.trim(),
          field_company_link: contactFieldCompanyLink.trim(),
          clients_table_id: contactClientsTableId.trim(),
          field_company_name: contactFieldCompanyName.trim(),
          field_client_representative: contactFieldClientRepresentative.trim(),
        },
      }, { onConflict: "key" });
      if (error) throw error;
      toast({ title: "Contact sync config saved." });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    } finally {
      setSavingContactConfig(false);
    }
  }

  async function saveProjectConfig() {
    setSavingProjectConfig(true);
    try {
      const { error } = await supabase.from("app_settings").upsert({
        key: "airtable_project_field_config",
        value: {
          base_id: projectBaseId.trim(),
          table_id: projectTableId.trim(),
          field_project_name: projectFieldName.trim(),
          field_client_facing_name: projectFieldClientFacingName.trim(),
          field_client_link: projectFieldClientLink.trim(),
          field_project_type: projectFieldProjectType.trim(),
          field_contract_or_subscription: projectFieldContractOrSubscription.trim(),
          field_status: projectFieldStatus.trim(),
        },
      }, { onConflict: "key" });
      if (error) throw error;
      toast({ title: "Project sync config saved." });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    } finally {
      setSavingProjectConfig(false);
    }
  }

  async function uploadSignature(file: File) {
    setSavingSignature(true);
    try {
      // createBucket is a no-op if the bucket already exists
      await supabase.storage.createBucket("studio-assets", { public: false }).catch(() => {});
      const { error } = await supabase.storage
        .from("studio-assets")
        .upload("silvershadow-signature.png", file, { contentType: file.type, upsert: true });
      if (error) throw error;
      const { data } = await supabase.storage.from("studio-assets").createSignedUrl("silvershadow-signature.png", 60);
      if (data?.signedUrl) setSignaturePreviewUrl(data.signedUrl);
      toast({ title: "Signature saved." });
    } catch (e: any) {
      toast({ title: "Failed to save signature", description: e?.message, variant: "destructive" });
    } finally {
      setSavingSignature(false);
    }
  }

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true);
    try {
      const updates: Promise<any>[] = [
        (() => {
          const trimFirst = firstName.trim();
          const trimLast = lastName.trim();
          return supabase
            .from("profiles")
            .update({
              first_name: trimFirst || null,
              last_name: trimLast || null,
              full_name: [trimFirst, trimLast].filter(Boolean).join(" ") || null,
            })
            .eq("user_id", user.id)
            .then(({ error }) => { if (error) throw error; });
        })(),
      ];
      if (email !== user.email) {
        updates.push(
          supabase.auth.updateUser({ email }).then(({ error }) => { if (error) throw error; })
        );
      }
      await Promise.all(updates);
      toast({ title: "Profile saved." });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated." });
    } catch (e: any) {
      toast({ title: "Failed to update password", description: e?.message, variant: "destructive" });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <AdminLayout>
      <div className="max-w-2xl">
        <h1 className="font-serif text-2xl text-foreground mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground font-sans mb-10">
          Studio configuration, integrations, and your account.
        </p>

        {/* ── Profile ──────────────────────────────────────────────────── */}
        <Section title="Profile">
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <label className={labelCls}>First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Fred"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Colomb"
                className={inputCls}
              />
            </div>
          </div>
          <div className="mb-8">
            <label className={labelCls}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="fred@silvershadowstudio.com"
              className={inputCls}
            />
          </div>
          <SaveButton loading={savingProfile} onClick={saveProfile} label="Save profile" />
        </Section>

        {/* ── Password ─────────────────────────────────────────────────── */}
        <Section title="Password">
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div>
              <label className={labelCls}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className={inputCls}
              />
            </div>
          </div>
          <SaveButton loading={savingPassword} onClick={changePassword} label="Update password" disabled={!newPassword} />
        </Section>

        {/* ── Studio Signature ──────────────────────────────────────── */}
        <Section title="Studio Signature">
          <p className="text-[10px] font-sans text-foreground/35 mb-6 leading-relaxed">
            Fred's drawn signature PNG. Embedded in the Silvershadow signature block of every freelancer document PDF.
            Upload a PNG with a transparent or white background, ideally 600 × 150 px or similar landscape ratio.
          </p>
          {signaturePreviewUrl && (
            <div className="mb-6 border border-border/30 p-4 inline-block">
              <img src={signaturePreviewUrl} alt="Current studio signature" className="h-12 object-contain" />
            </div>
          )}
          <input
            ref={sigFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadSignature(file);
              e.target.value = "";
            }}
          />
          <div>
            <button
              onClick={() => sigFileRef.current?.click()}
              disabled={savingSignature}
              className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 disabled:opacity-40 transition-opacity"
              style={{ height: 36, paddingLeft: 20, paddingRight: 20, fontSize: 10, letterSpacing: "0.26em" }}
            >
              {savingSignature ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" strokeWidth={1.5} />}
              {signaturePreviewUrl ? "Replace signature" : "Upload signature"}
            </button>
          </div>
        </Section>

        {/* ── Dropbox ──────────────────────────────────────────────────── */}
        <Section title="Dropbox">
          <DropboxConnectionStatus />
        </Section>

        {/* ── Airtable ─────────────────────────────────────────────────── */}
        <Section title="Airtable">
          <AirtableSyncPanel />
        </Section>

        {/* ── Airtable Contact Sync ─────────────────────────────────── */}
        <Section title="Airtable Contact Sync">
          <p className="text-[10px] font-sans text-foreground/35 mb-6 leading-relaxed">
            Users table (one row per person) + Clients table (one row per company). Called when a new client is created.
          </p>
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="col-span-2">
              <label className={labelCls}>Base ID</label>
              <input
                type="text"
                value={contactBaseId}
                onChange={(e) => setContactBaseId(e.target.value)}
                placeholder="appXXXXXXXXXXXXXX"
                className={inputCls}
              />
            </div>

            {/* Users table */}
            <div className="col-span-2 mt-2">
              <p className="text-[9px] uppercase tracking-[0.24em] text-gold/70 mb-4">Users table (contacts)</p>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Users table ID</label>
              <input
                type="text"
                value={contactTableId}
                onChange={(e) => setContactTableId(e.target.value)}
                placeholder="tbl8V5Hd20UN9Jax6"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>First name field</label>
              <input
                type="text"
                value={contactFieldFirstName}
                onChange={(e) => setContactFieldFirstName(e.target.value)}
                placeholder="First Name"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Surname field</label>
              <input
                type="text"
                value={contactFieldSurname}
                onChange={(e) => setContactFieldSurname(e.target.value)}
                placeholder="Surname"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Role field (single select)</label>
              <input
                type="text"
                value={contactFieldRole}
                onChange={(e) => setContactFieldRole(e.target.value)}
                placeholder="Role"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Type of client field (multi select)</label>
              <input
                type="text"
                value={contactFieldTypeOfClient}
                onChange={(e) => setContactFieldTypeOfClient(e.target.value)}
                placeholder="Type of Client"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Email field</label>
              <input
                type="text"
                value={contactFieldEmail}
                onChange={(e) => setContactFieldEmail(e.target.value)}
                placeholder="Email"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Clients link field (primary)</label>
              <input
                type="text"
                value={contactFieldClientLink}
                onChange={(e) => setContactFieldClientLink(e.target.value)}
                placeholder="Clients"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Company link field (secondary)</label>
              <input
                type="text"
                value={contactFieldCompanyLink}
                onChange={(e) => setContactFieldCompanyLink(e.target.value)}
                placeholder="Company"
                className={inputCls}
              />
            </div>

            {/* Clients table */}
            <div className="col-span-2 mt-2">
              <p className="text-[9px] uppercase tracking-[0.24em] text-gold/70 mb-4">Clients table (companies)</p>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Clients table ID</label>
              <input
                type="text"
                value={contactClientsTableId}
                onChange={(e) => setContactClientsTableId(e.target.value)}
                placeholder="tblWDmSeRB4P88ALw"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Company name field</label>
              <input
                type="text"
                value={contactFieldCompanyName}
                onChange={(e) => setContactFieldCompanyName(e.target.value)}
                placeholder="Company name"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Client representative field</label>
              <input
                type="text"
                value={contactFieldClientRepresentative}
                onChange={(e) => setContactFieldClientRepresentative(e.target.value)}
                placeholder="Client Representative"
                className={inputCls}
              />
            </div>
          </div>
          <SaveButton loading={savingContactConfig} onClick={saveContactConfig} label="Save config" />
        </Section>

        {/* ── Airtable Project Sync ─────────────────────────────────── */}
        <Section title="Airtable Project Sync">
          <p className="text-[10px] font-sans text-foreground/35 mb-6 leading-relaxed">
            Projects table. Called when a new project is created. Auto-generates project code (CP or RUP prefix).
          </p>
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="col-span-2">
              <label className={labelCls}>Base ID</label>
              <input
                type="text"
                value={projectBaseId}
                onChange={(e) => setProjectBaseId(e.target.value)}
                placeholder="appXXXXXXXXXXXXXX"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Projects table ID</label>
              <input
                type="text"
                value={projectTableId}
                onChange={(e) => setProjectTableId(e.target.value)}
                placeholder="tblB4sEUfuFQOv2lA"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Project name field (auto-generated code)</label>
              <input
                type="text"
                value={projectFieldName}
                onChange={(e) => setProjectFieldName(e.target.value)}
                placeholder="Project name"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Client facing project name field</label>
              <input
                type="text"
                value={projectFieldClientFacingName}
                onChange={(e) => setProjectFieldClientFacingName(e.target.value)}
                placeholder="Client Facing Project Name"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Client link field (linked to Clients table)</label>
              <input
                type="text"
                value={projectFieldClientLink}
                onChange={(e) => setProjectFieldClientLink(e.target.value)}
                placeholder="Client"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Project type field (single select)</label>
              <input
                type="text"
                value={projectFieldProjectType}
                onChange={(e) => setProjectFieldProjectType(e.target.value)}
                placeholder="Project Type"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Contract or subscription field</label>
              <input
                type="text"
                value={projectFieldContractOrSubscription}
                onChange={(e) => setProjectFieldContractOrSubscription(e.target.value)}
                placeholder="Contract or Subscription"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Status field (single select)</label>
              <input
                type="text"
                value={projectFieldStatus}
                onChange={(e) => setProjectFieldStatus(e.target.value)}
                placeholder="Status"
                className={inputCls}
              />
            </div>
          </div>
          <SaveButton loading={savingProjectConfig} onClick={saveProjectConfig} label="Save config" />
        </Section>
      </div>
    </AdminLayout>
  );
}

function SaveButton({
  loading,
  onClick,
  label,
  disabled,
}: {
  loading: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 disabled:opacity-40 transition-opacity"
      style={{ height: 36, paddingLeft: 20, paddingRight: 20, fontSize: 10, letterSpacing: "0.26em" }}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
      )}
      {label}
    </button>
  );
}
