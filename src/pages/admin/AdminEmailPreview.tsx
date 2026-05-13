import { useState, useEffect, useRef, useCallback } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";

const DEFAULTS = {
  illustrationUrl:
    "https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/APP+Files/portal-invite-illustration.png",
  bodyCopy:
    "Your Silvershadow Studio portal is ready. Your projects, deliveries, and studio communications are now accessible in one place.",
  ctaLabel: "ACCESS YOUR PORTAL",
  ctaUrl: "https://portal.silvershadowstudio.com/set-password?token=PREVIEW",
  footerText: "silvershadowstudio.com",
  backgroundColor: "#EDE8E0",
};

type Config = typeof DEFAULTS;

const LABEL: React.CSSProperties = {
  display: "block",
  fontFamily: "Arial, sans-serif",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: "rgba(255,255,255,0.4)",
  marginBottom: 10,
};

const INPUT: React.CSSProperties = {
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

export default function AdminEmailPreview() {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [html, setHtml] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const isFirstRender = useRef(true);

  // Load session and stored config on mount
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
          if (stored && Object.keys(stored).length > 0) {
            setConfig((prev) => ({ ...prev, ...stored }));
          }
        }
      } catch { /* use defaults */ }
    });
  }, []);

  const fetchPreview = useCallback(async (tok: string, cfg: Config) => {
    const params = new URLSearchParams(cfg as Record<string, string>);
    params.set("template", "invite");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/preview-email?${params}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) setHtml(await res.text());
    } catch { /* ignore */ }
  }, []);

  // Fetch preview on token ready (immediate) and on subsequent config changes (debounced)
  useEffect(() => {
    if (!token) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      fetchPreview(token, config);
      return;
    }
    const tid = setTimeout(() => fetchPreview(token, config), 350);
    return () => clearTimeout(tid);
  }, [token, config, fetchPreview]);

  const update = (key: keyof Config, value: string) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-email-config`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(config),
      });
      setSaveMsg(res.ok ? "Saved." : "Failed to save.");
    } catch {
      setSaveMsg("Failed to save.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  return (
    <AdminLayout noPadding>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

        {/* ── Configurator ─────────────────────────────── */}
        <div
          style={{
            width: 320,
            flexShrink: 0,
            background: "#181614",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "32px 24px 0", flex: 1 }}>
            <p style={{ ...LABEL, marginBottom: 28, fontSize: 9, letterSpacing: "0.3em", opacity: 0.3 }}>
              CLIENT INVITATION
            </p>

            <div style={FIELD_WRAP}>
              <label style={LABEL}>Illustration URL</label>
              <input
                style={INPUT}
                value={config.illustrationUrl}
                onChange={(e) => update("illustrationUrl", e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = "#B89A6A")}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.12)")}
              />
            </div>

            <div style={FIELD_WRAP}>
              <label style={LABEL}>Body Copy</label>
              <textarea
                style={{ ...INPUT, resize: "vertical", minHeight: 80 }}
                value={config.bodyCopy}
                onChange={(e) => update("bodyCopy", e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = "#B89A6A")}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.12)")}
              />
            </div>

            <div style={FIELD_WRAP}>
              <label style={LABEL}>CTA Label</label>
              <input
                style={INPUT}
                value={config.ctaLabel}
                onChange={(e) => update("ctaLabel", e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = "#B89A6A")}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.12)")}
              />
            </div>

            <div style={FIELD_WRAP}>
              <label style={LABEL}>CTA URL</label>
              <input
                style={INPUT}
                value={config.ctaUrl}
                onChange={(e) => update("ctaUrl", e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = "#B89A6A")}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.12)")}
              />
            </div>

            <div style={FIELD_WRAP}>
              <label style={LABEL}>Footer Text</label>
              <input
                style={INPUT}
                value={config.footerText}
                onChange={(e) => update("footerText", e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = "#B89A6A")}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.12)")}
              />
            </div>

            <div style={FIELD_WRAP}>
              <label style={LABEL}>Background Colour</label>
              <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 2,
                    background: config.backgroundColor,
                    border: "1px solid rgba(255,255,255,0.15)",
                    flexShrink: 0,
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  <input
                    type="color"
                    value={config.backgroundColor}
                    onChange={(e) => update("backgroundColor", e.target.value)}
                    style={{
                      position: "absolute",
                      inset: 0,
                      opacity: 0,
                      width: "100%",
                      height: "100%",
                      cursor: "pointer",
                      border: "none",
                      padding: 0,
                    }}
                  />
                </div>
                <input
                  style={{ ...INPUT, flex: 1, borderBottom: "none", padding: "6px 0 0" }}
                  value={config.backgroundColor}
                  onChange={(e) => update("backgroundColor", e.target.value)}
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          {/* Save button */}
          <div style={{ padding: "24px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {saveMsg && (
              <p style={{ fontFamily: "Arial, sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center", marginBottom: 12, letterSpacing: "0.1em" }}>
                {saveMsg}
              </p>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: "block",
                width: "100%",
                height: 40,
                background: "transparent",
                border: "1px solid rgba(184,154,106,0.35)",
                color: "rgba(184,154,106,0.7)",
                fontFamily: "Arial, sans-serif",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.5 : 1,
                transition: "opacity 0.2s, border-color 0.2s, color 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!saving) {
                  e.currentTarget.style.borderColor = "rgba(184,154,106,0.7)";
                  e.currentTarget.style.color = "rgba(184,154,106,1)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(184,154,106,0.35)";
                e.currentTarget.style.color = "rgba(184,154,106,0.7)";
              }}
            >
              {saving ? "Saving…" : "Save as Default"}
            </button>
          </div>
        </div>

        {/* ── Preview iframe ───────────────────────────── */}
        <div style={{ flex: 1, background: "#0f0e0c", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {html ? (
            <iframe
              srcDoc={html}
              style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
              title="Email Preview"
            />
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px solid rgba(184,154,106,0.4)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            </div>
          )}
        </div>

      </div>
    </AdminLayout>
  );
}
