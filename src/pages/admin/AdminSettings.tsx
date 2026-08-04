import { useRef, useState, useEffect } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AdminLayout } from "@/components/AdminLayout";
import { DropboxConnectionStatus } from "@/components/admin/DropboxConnectionStatus";
import { AirtableSyncPanel } from "@/components/admin/AirtableSyncPanel";
import { HolidayImportPanel } from "@/components/admin/HolidayImportPanel";
import { AccordionHeader, AccordionPanel } from "@/components/ui/SectionAccordion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const labelCls = "block text-[9px] uppercase tracking-[0.26em] text-foreground/40 mb-1.5";
const inputCls = "w-full bg-transparent border-b border-border/50 py-2 text-sm text-foreground focus:outline-none focus:border-gold transition-colors placeholder:text-foreground/25";

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Accordion — only one section open at a time. Null until the first effect
  // picks the default (profile). Same pattern as Documents.tsx / Account.tsx.
  type SectionKey =
    | "profile"
    | "password"
    | "brand"
    | "signature"
    | "dropbox"
    | "airtable"
    | "airtable_contact_sync"
    | "airtable_project_sync"
    | "holiday_import"
    | null;
  const [openSection, setOpenSection] = useState<SectionKey>(null);
  const [defaultPicked, setDefaultPicked] = useState(false);

  const toggleSection = (key: Exclude<SectionKey, null>) =>
    setOpenSection((cur) => (cur === key ? null : key));

  // First-load default: profile. Admin will reach for whatever they need;
  // profile is the safest landing section.
  useEffect(() => {
    if (defaultPicked) return;
    setOpenSection("profile");
    setDefaultPicked(true);
  }, [defaultPicked]);

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

  // ── Brand colours ──────────────────────────────────────────────────────────
  const [brandBg, setBrandBg] = useState("#EDE8E0");
  const [brandDarkBg, setBrandDarkBg] = useState("#131210");
  const [brandDarkSurface, setBrandDarkSurface] = useState("#181614");
  const [brandDarkElevated, setBrandDarkElevated] = useState("#1E1C18");
  const [brandGold, setBrandGold] = useState("#B89A6A");
  const [brandText, setBrandText] = useState("#1A1814");
  const [brandFontFamily, setBrandFontFamily] = useState("Montserrat");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);

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
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "document_design_config")
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.value) return;
        const v = data.value as Record<string, string>;
        if (v.background_color) setBrandBg(v.background_color);
        if (v.dark_background_color) setBrandDarkBg(v.dark_background_color);
        if (v.dark_surface_primary) setBrandDarkSurface(v.dark_surface_primary);
        if (v.dark_surface_elevated) setBrandDarkElevated(v.dark_surface_elevated);
        if (v.gold_color) setBrandGold(v.gold_color);
        if (v.text_color) setBrandText(v.text_color);
        if (v.font_family) setBrandFontFamily(v.font_family);
        if (v.logo_url !== undefined) setBrandLogoUrl(v.logo_url);
      });
  }, []);

  async function saveBrand() {
    setSavingBrand(true);
    try {
      const { data: existing } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "document_design_config")
        .maybeSingle();
      const prev = (existing?.value as Record<string, unknown> | null) ?? {};
      const merged = {
        ...prev,
        background_color: brandBg,
        dark_background_color: brandDarkBg,
        dark_surface_primary: brandDarkSurface,
        dark_surface_elevated: brandDarkElevated,
        gold_color: brandGold,
        text_color: brandText,
        font_family: brandFontFamily,
        logo_url: brandLogoUrl,
      };
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "document_design_config", value: merged }, { onConflict: "key" });
      if (error) throw error;
      toast({ title: "Brand saved", description: "Changes apply to new PDFs, new emails, and on next page reload." });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingBrand(false);
    }
  }

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
        <section className={cn(openSection === "profile" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Profile"
            isOpen={openSection === "profile"}
            onToggle={() => toggleSection("profile")}
          />
          <AccordionPanel isOpen={openSection === "profile"}>
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
          </AccordionPanel>
        </section>

        {/* ── Password ─────────────────────────────────────────────────── */}
        <section className={cn(openSection === "password" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Password"
            isOpen={openSection === "password"}
            onToggle={() => toggleSection("password")}
          />
          <AccordionPanel isOpen={openSection === "password"}>
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
          </AccordionPanel>
        </section>

        {/* ── Brand ─────────────────────────────────────────────────── */}
        <section className={cn(openSection === "brand" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Brand"
            isOpen={openSection === "brand"}
            onToggle={() => toggleSection("brand")}
          />
          <AccordionPanel isOpen={openSection === "brand"}>
          <p className="text-[10px] font-sans text-foreground/35 mb-6 leading-relaxed">
            Single source of truth for the studio's brand colours. Used by every PDF (background), every email (background and accents), and the portal itself (dark mode page surface, card surfaces, gold accents). Changes apply to new PDFs/emails immediately and to the portal on next page reload.
          </p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 mb-8">
            <ColourField label="Background (light surface / PDFs / client emails)" value={brandBg} onChange={setBrandBg} />
            <ColourField label="Gold accent (buttons, links, dark-mode gold)" value={brandGold} onChange={setBrandGold} />
            <ColourField label="Dark background (portal page ground)" value={brandDarkBg} onChange={setBrandDarkBg} />
            <ColourField label="Dark surface — primary (cards)" value={brandDarkSurface} onChange={setBrandDarkSurface} />
            <ColourField label="Dark surface — elevated (modals, popovers)" value={brandDarkElevated} onChange={setBrandDarkElevated} />
            <ColourField label="Text colour" value={brandText} onChange={setBrandText} />
            <div>
              <label className={labelCls}>Font family</label>
              <input type="text" value={brandFontFamily} onChange={(e) => setBrandFontFamily(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Logo URL</label>
              <input type="text" value={brandLogoUrl} onChange={(e) => setBrandLogoUrl(e.target.value)} className={inputCls} placeholder="https://…" />
            </div>
          </div>
          <SaveButton loading={savingBrand} onClick={saveBrand} label="Save brand" />
          </AccordionPanel>
        </section>

        {/* ── Studio Signature ──────────────────────────────────────── */}
        <section className={cn(openSection === "signature" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Studio Signature"
            isOpen={openSection === "signature"}
            onToggle={() => toggleSection("signature")}
          />
          <AccordionPanel isOpen={openSection === "signature"}>
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
              {savingSignature ? <BrandLoader size="sm" className="h-3 w-3" /> : <Upload className="h-3 w-3" strokeWidth={1.5} />}
              {signaturePreviewUrl ? "Replace signature" : "Upload signature"}
            </button>
          </div>
          </AccordionPanel>
        </section>

        {/* ── Dropbox ──────────────────────────────────────────────────── */}
        <section className={cn(openSection === "dropbox" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Dropbox"
            isOpen={openSection === "dropbox"}
            onToggle={() => toggleSection("dropbox")}
          />
          <AccordionPanel isOpen={openSection === "dropbox"}>
            <DropboxConnectionStatus />
          </AccordionPanel>
        </section>

        {/* ── Airtable ─────────────────────────────────────────────────── */}
        <section className={cn(openSection === "airtable" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Airtable"
            isOpen={openSection === "airtable"}
            onToggle={() => toggleSection("airtable")}
          />
          <AccordionPanel isOpen={openSection === "airtable"}>
            <AirtableSyncPanel />
          </AccordionPanel>
        </section>

        {/* ── Airtable Contact Sync ─────────────────────────────────── */}
        <section className={cn(openSection === "airtable_contact_sync" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Airtable Contact Sync"
            isOpen={openSection === "airtable_contact_sync"}
            onToggle={() => toggleSection("airtable_contact_sync")}
          />
          <AccordionPanel isOpen={openSection === "airtable_contact_sync"}>
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
          </AccordionPanel>
        </section>

        {/* ── Airtable → portal holiday import (one-off migration) ───── */}
        <section className={cn(openSection === "holiday_import" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Import Airtable Holidays"
            isOpen={openSection === "holiday_import"}
            onToggle={() => toggleSection("holiday_import")}
          />
          <AccordionPanel isOpen={openSection === "holiday_import"}>
            <HolidayImportPanel />
          </AccordionPanel>
        </section>

        {/* ── Airtable Project Sync ─────────────────────────────────── */}
        <section className={cn(openSection === "airtable_project_sync" ? "mb-12" : "mb-6", "last:mb-0")}>
          <AccordionHeader
            label="Airtable Project Sync"
            isOpen={openSection === "airtable_project_sync"}
            onToggle={() => toggleSection("airtable_project_sync")}
          />
          <AccordionPanel isOpen={openSection === "airtable_project_sync"}>
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
          </AccordionPanel>
        </section>
      </div>
    </AdminLayout>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-8 h-8 border border-border/40 bg-transparent cursor-pointer"
          style={{ padding: 0 }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls + " flex-1 font-mono"}
          placeholder="#000000"
        />
      </div>
    </div>
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
        <BrandLoader size="sm" className="h-3 w-3" />
      ) : (
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
      )}
      {label}
    </button>
  );
}
