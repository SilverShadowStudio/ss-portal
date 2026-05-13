import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Download, Eye, FileText, Loader2, Search } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AgreementViewer, type AgreementViewerData } from "@/components/agreements/AgreementViewer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgreementRow {
  id: string;
  user_id: string;
  company_name: string;
  signatory_name: string | null;
  signatory_position: string | null;
  accepted_by_name: string | null;
  accepted_by_email: string | null;
  agreement_version: string;
  agreement_uid: string | null;
  accepted_at: string | null;
  signed_at: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  ip_address: string | null;
}

interface DocumentDesignConfig {
  background_color: string;
  warm_black: string;
  warm_grey: string;
  gold: string;
  body_font: string;
  heading_font: string;
  meta_font: string;
  logo_width: number;
  margin_left: number;
  margin_right: number;
  margin_top: number;
  margin_bottom: number;
}

const DESIGN_DEFAULTS: DocumentDesignConfig = {
  background_color: "#EDE8E0",
  warm_black: "#1A1814",
  warm_grey: "#8A8070",
  gold: "#B89A6A",
  body_font: "Times-Roman",
  heading_font: "Helvetica-Bold",
  meta_font: "Helvetica",
  logo_width: 180,
  margin_left: 72,
  margin_right: 72,
  margin_top: 64,
  margin_bottom: 80,
};

interface EmailConfig {
  subject: string;
  illustrationUrl: string;
  bodyCopy: string;
  ctaLabel: string;
  ctaUrl: string;
  footerText: string;
  backgroundColor: string;
}

const EMAIL_DEFAULTS: EmailConfig = {
  subject: "Your Silvershadow Studio portal is ready.",
  illustrationUrl:
    "https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/APP+Files/portal-invite-illustration.png",
  bodyCopy:
    "Your Silvershadow Studio portal is ready. Your projects, deliveries, and studio communications are now accessible in one place.",
  ctaLabel: "ACCESS YOUR PORTAL",
  ctaUrl: "https://portal.silvershadowstudio.com/set-password?token=PREVIEW",
  footerText: "silvershadowstudio.com",
  backgroundColor: "#EDE8E0",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

// ─── Shared panel styles (dark config panel) ──────────────────────────────────

const PANEL_LABEL: React.CSSProperties = {
  display: "block",
  fontFamily: "Arial, sans-serif",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: "rgba(255,255,255,0.4)",
  marginBottom: 10,
};

const PANEL_INPUT: React.CSSProperties = {
  display: "block",
  width: "100%",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  outline: "none",
  color: "rgba(255,255,255,0.75)",
  fontSize: 13,
  padding: "6px 0 8px",
  fontFamily: "Arial, sans-serif",
  lineHeight: 1.5,
};

const FIELD_WRAP: React.CSSProperties = { marginBottom: 28 };

function focusGold(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderBottomColor = "#B89A6A";
}
function blurDefault(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.12)";
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={FIELD_WRAP}>
      <label style={PANEL_LABEL}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ width: 24, height: 24, borderRadius: 2, background: value, border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0, overflow: "hidden", position: "relative" }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
        </div>
        <input style={{ ...PANEL_INPUT, flex: 1, borderBottom: "none", padding: "0" }}
          value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={FIELD_WRAP}>
      <label style={PANEL_LABEL}>{label}</label>
      <input type="number" style={PANEL_INPUT} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onFocus={focusGold} onBlur={blurDefault} />
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={FIELD_WRAP}>
      <label style={PANEL_LABEL}>{label}</label>
      <input style={PANEL_INPUT} value={value} onChange={(e) => onChange(e.target.value)}
        onFocus={focusGold} onBlur={blurDefault} />
    </div>
  );
}

function SaveButton({ onClick, saving, msg }: { onClick: () => void; saving: boolean; msg: string | null }) {
  return (
    <div style={{ padding: "20px 24px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      {msg && (
        <p style={{ fontFamily: "Arial", fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center", marginBottom: 12, letterSpacing: "0.1em" }}>
          {msg}
        </p>
      )}
      <button onClick={onClick} disabled={saving}
        style={{ display: "block", width: "100%", height: 40, background: "transparent", border: "1px solid rgba(184,154,106,0.35)", color: "rgba(184,154,106,0.7)", fontFamily: "Arial", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.2em", cursor: saving ? "default" : "pointer", opacity: saving ? 0.5 : 1, transition: "opacity 0.2s" }}
        onMouseEnter={(e) => { if (!saving) { e.currentTarget.style.borderColor = "rgba(184,154,106,0.7)"; e.currentTarget.style.color = "rgba(184,154,106,1)"; } }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(184,154,106,0.35)"; e.currentTarget.style.color = "rgba(184,154,106,0.7)"; }}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// ─── Document preview card ────────────────────────────────────────────────────

function DocPreviewCard({ title, config }: { title: string; config: DocumentDesignConfig }) {
  return (
    <div style={{ background: config.background_color, borderRadius: 4, padding: "16px 20px", flex: 1, minWidth: 160 }}>
      <div style={{ height: 6, width: 48, background: config.gold, borderRadius: 1, marginBottom: 10 }} />
      <div style={{ fontFamily: "Arial", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.18em", color: config.warm_grey, marginBottom: 6 }}>{title}</div>
      {[1, 0.6, 0.4].map((op, i) => (
        <div key={i} style={{ height: 4, background: config.warm_black, opacity: op, borderRadius: 1, marginBottom: 5, width: i === 0 ? "80%" : i === 1 ? "60%" : "40%" }} />
      ))}
      <div style={{ marginTop: 12, borderTop: `1px solid ${config.warm_grey}40`, paddingTop: 8 }}>
        {[1, 2].map((i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ height: 3, width: "50%", background: config.warm_black, opacity: 0.4, borderRadius: 1 }} />
            <div style={{ height: 3, width: "20%", background: config.warm_black, opacity: 0.6, borderRadius: 1 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Agreements tab ───────────────────────────────────────────────────────────

function AgreementsTab() {
  const { toast } = useToast();
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [previewing, setPreviewing] = useState<AgreementViewerData | null>(null);

  useEffect(() => { void fetchAgreements(); }, []);

  async function fetchAgreements() {
    try {
      const { data, error } = await supabase
        .from("agreements")
        .select("id, user_id, company_name, signatory_name, signatory_position, accepted_by_name, accepted_by_email, agreement_version, agreement_uid, accepted_at, signed_at, storage_path, file_name, file_size, ip_address")
        .order("accepted_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      setAgreements((data as AgreementRow[]) || []);
    } catch (err) {
      console.error(err);
      toast({ title: "Could not load agreements", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const handleDownload = async (a: AgreementRow) => {
    setDownloadingId(a.id);
    try {
      const { data, error } = await supabase.storage.from("agreements").download(a.storage_path);
      if (error || !data) throw error || new Error("No file");
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url; link.download = a.file_name;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Could not download agreement", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agreements;
    return agreements.filter((a) =>
      [a.company_name, a.signatory_name, a.accepted_by_name, a.accepted_by_email, a.agreement_version]
        .filter(Boolean).some((v) => v!.toLowerCase().includes(q))
    );
  }, [agreements, search]);

  return (
    <div>
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by company, contact, version…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {search ? "No agreements match your search." : "No agreements have been accepted yet."}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            <div className="hidden md:grid grid-cols-[1.4fr_1.2fr_0.8fr_1fr_120px] gap-4 px-6 py-3 bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>Client / Company</span><span>Contact</span><span>Version</span><span>Accepted</span>
              <span className="text-right">Action</span>
            </div>
            {filtered.map((a) => (
              <div key={a.id} className="grid grid-cols-1 md:grid-cols-[1.4fr_1.2fr_0.8fr_1fr_120px] gap-3 md:gap-4 px-6 py-4 items-center hover:bg-muted/20 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 text-gold shrink-0">
                    <FileText className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-serif text-sm text-foreground truncate">{a.company_name}</p>
                    <span className="mt-0.5 inline-block rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.18em] text-emerald-600 dark:text-emerald-400">ACCEPTED</span>
                  </div>
                </div>
                <div className="text-xs">
                  <p className="text-foreground truncate">{a.accepted_by_name || a.signatory_name || "—"}</p>
                  <p className="text-muted-foreground truncate">{a.accepted_by_email || "—"}</p>
                </div>
                <div className="text-xs text-muted-foreground tracking-wide">{a.agreement_version}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(a.accepted_at || a.signed_at)}
                  {a.ip_address && <span className="block text-[10px] text-muted-foreground/60 mt-0.5">IP {a.ip_address}</span>}
                </div>
                <div className="md:text-right">
                  <div className="inline-flex items-center gap-4">
                    <button onClick={() => setPreviewing({ id: a.id, storage_path: a.storage_path, file_name: a.file_name, company_name: a.company_name, agreement_version: a.agreement_version })}
                      className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground transition-smooth hover:text-gold">
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />Preview
                    </button>
                    <button onClick={() => handleDownload(a)} disabled={downloadingId === a.id}
                      className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground transition-smooth hover:text-gold disabled:opacity-50">
                      {downloadingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" strokeWidth={1.5} />}PDF
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AgreementViewer agreement={previewing} open={!!previewing} onOpenChange={(o) => { if (!o) setPreviewing(null); }} />
    </div>
  );
}

// ─── Design tab ───────────────────────────────────────────────────────────────

function DesignTab() {
  const [config, setConfig] = useState<DocumentDesignConfig>(DESIGN_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      setToken(session.access_token);
      try {
        const { data } = await supabase.from("app_settings").select("value").eq("key", "document_design_config").maybeSingle();
        if (data?.value) setConfig((prev) => ({ ...prev, ...(data.value as DocumentDesignConfig) }));
      } catch { /* use defaults */ }
    });
  }, []);

  const update = <K extends keyof DocumentDesignConfig>(key: K, value: DocumentDesignConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!token) return;
    setSaving(true); setSaveMsg(null);
    try {
      const { error } = await supabase.from("app_settings")
        .upsert({ key: "document_design_config", value: config as unknown as Record<string, unknown> }, { onConflict: "key" });
      setSaveMsg(error ? "Failed to save." : "Saved.");
    } catch { setSaveMsg("Failed to save."); } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 560, borderRadius: 12, overflow: "hidden", border: "1px solid hsl(var(--border))" }}>
      {/* Config panel */}
      <div style={{ width: 280, flexShrink: 0, background: "#181614", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "28px 24px 0", flex: 1 }}>
          <p style={{ ...PANEL_LABEL, marginBottom: 24, fontSize: 9, letterSpacing: "0.3em", opacity: 0.3 }}>DOCUMENT DESIGN</p>

          <ColorField label="Background" value={config.background_color} onChange={(v) => update("background_color", v)} />
          <ColorField label="Ink (warm black)" value={config.warm_black} onChange={(v) => update("warm_black", v)} />
          <ColorField label="Muted (warm grey)" value={config.warm_grey} onChange={(v) => update("warm_grey", v)} />
          <ColorField label="Gold accent" value={config.gold} onChange={(v) => update("gold", v)} />

          <TextField label="Body font" value={config.body_font} onChange={(v) => update("body_font", v)} />
          <TextField label="Heading font" value={config.heading_font} onChange={(v) => update("heading_font", v)} />
          <TextField label="Meta font" value={config.meta_font} onChange={(v) => update("meta_font", v)} />

          <NumberField label="Logo width (pt)" value={config.logo_width} onChange={(v) => update("logo_width", v)} />
          <NumberField label="Margin left (pt)" value={config.margin_left} onChange={(v) => update("margin_left", v)} />
          <NumberField label="Margin right (pt)" value={config.margin_right} onChange={(v) => update("margin_right", v)} />
          <NumberField label="Margin top (pt)" value={config.margin_top} onChange={(v) => update("margin_top", v)} />
          <NumberField label="Margin bottom (pt)" value={config.margin_bottom} onChange={(v) => update("margin_bottom", v)} />
        </div>
        <SaveButton onClick={handleSave} saving={saving} msg={saveMsg} />
      </div>

      {/* Preview area */}
      <div style={{ flex: 1, background: "#0f0e0c", display: "flex", flexDirection: "column", padding: "28px 24px" }}>
        <p style={{ ...PANEL_LABEL, marginBottom: 20, fontSize: 9, letterSpacing: "0.3em", opacity: 0.3 }}>PREVIEW</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <DocPreviewCard title="Quotation" config={config} />
          <DocPreviewCard title="Invoice" config={config} />
          <DocPreviewCard title="Round Instructions" config={config} />
        </div>
        <p style={{ marginTop: 20, fontFamily: "Arial", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em" }}>
          These values are read by the PDF generation edge functions. Existing documents are unaffected.
        </p>
      </div>
    </div>
  );
}

// ─── Email tab ────────────────────────────────────────────────────────────────

function EmailTab() {
  const [config, setConfig] = useState<EmailConfig>(EMAIL_DEFAULTS);
  const [html, setHtml] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      setToken(session.access_token);
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/update-email-config`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const { config: stored } = await res.json();
          if (stored && Object.keys(stored).length > 0) setConfig((prev) => ({ ...prev, ...stored }));
        }
      } catch { /* use defaults */ }
    });
  }, []);

  const fetchPreview = useCallback(async (tok: string, cfg: EmailConfig) => {
    const params = new URLSearchParams(cfg as unknown as Record<string, string>);
    params.set("template", "invite");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/preview-email?${params}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) setHtml(await res.text());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!token) return;
    if (isFirstRender.current) { isFirstRender.current = false; fetchPreview(token, config); return; }
    const tid = setTimeout(() => fetchPreview(token, config), 350);
    return () => clearTimeout(tid);
  }, [token, config, fetchPreview]);

  const update = (key: keyof EmailConfig, value: string) => setConfig((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!token) return;
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-email-config`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setSaveMsg(res.ok ? "Saved." : "Failed to save.");
    } catch { setSaveMsg("Failed to save."); } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 560, borderRadius: 12, overflow: "hidden", border: "1px solid hsl(var(--border))" }}>
      {/* Config panel */}
      <div style={{ width: 320, flexShrink: 0, background: "#181614", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "28px 24px 0", flex: 1 }}>
          <p style={{ ...PANEL_LABEL, marginBottom: 24, fontSize: 9, letterSpacing: "0.3em", opacity: 0.3 }}>CLIENT INVITATION EMAIL</p>

          <div style={FIELD_WRAP}>
            <label style={PANEL_LABEL}>Email subject</label>
            <input style={PANEL_INPUT} value={config.subject}
              onChange={(e) => update("subject", e.target.value)}
              onFocus={focusGold} onBlur={blurDefault} />
          </div>

          <div style={FIELD_WRAP}>
            <label style={PANEL_LABEL}>Illustration URL</label>
            <input style={PANEL_INPUT} value={config.illustrationUrl}
              onChange={(e) => update("illustrationUrl", e.target.value)}
              onFocus={focusGold} onBlur={blurDefault} />
          </div>

          <div style={FIELD_WRAP}>
            <label style={PANEL_LABEL}>Body Copy</label>
            <textarea style={{ ...PANEL_INPUT, resize: "vertical", minHeight: 80 }} value={config.bodyCopy}
              onChange={(e) => update("bodyCopy", e.target.value)}
              onFocus={focusGold} onBlur={blurDefault} />
          </div>

          <div style={FIELD_WRAP}>
            <label style={PANEL_LABEL}>CTA Label</label>
            <input style={PANEL_INPUT} value={config.ctaLabel}
              onChange={(e) => update("ctaLabel", e.target.value)}
              onFocus={focusGold} onBlur={blurDefault} />
          </div>

          <div style={FIELD_WRAP}>
            <label style={PANEL_LABEL}>CTA URL</label>
            <input style={PANEL_INPUT} value={config.ctaUrl}
              onChange={(e) => update("ctaUrl", e.target.value)}
              onFocus={focusGold} onBlur={blurDefault} />
          </div>

          <div style={FIELD_WRAP}>
            <label style={PANEL_LABEL}>Footer Text</label>
            <input style={PANEL_INPUT} value={config.footerText}
              onChange={(e) => update("footerText", e.target.value)}
              onFocus={focusGold} onBlur={blurDefault} />
          </div>

          <div style={FIELD_WRAP}>
            <label style={PANEL_LABEL}>Background Colour</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ width: 28, height: 28, borderRadius: 2, background: config.backgroundColor, border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0, overflow: "hidden", position: "relative" }}>
                <input type="color" value={config.backgroundColor} onChange={(e) => update("backgroundColor", e.target.value)}
                  style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
              </div>
              <input style={{ ...PANEL_INPUT, flex: 1, borderBottom: "none", padding: "6px 0 0" }}
                value={config.backgroundColor} onChange={(e) => update("backgroundColor", e.target.value)} maxLength={7} />
            </div>
          </div>
        </div>
        <SaveButton onClick={handleSave} saving={saving} msg={saveMsg} />
      </div>

      {/* Preview */}
      <div style={{ flex: 1, background: "#0f0e0c", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {html ? (
          <iframe srcDoc={html} style={{ flex: 1, border: "none", width: "100%", height: "100%" }} title="Email Preview" />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px solid rgba(184,154,106,0.4)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDocuments() {
  return (
    <AdminLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold">Document Management</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          DOCUMENTS
        </h1>
      </div>

      <Tabs defaultValue="agreements" className="w-full animate-fade-in" style={{ animationDelay: "0.05s" }}>
        <TabsList className="mb-8">
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
        </TabsList>

        <TabsContent value="agreements">
          <AgreementsTab />
        </TabsContent>

        <TabsContent value="design">
          <DesignTab />
        </TabsContent>

        <TabsContent value="email">
          <EmailTab />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
