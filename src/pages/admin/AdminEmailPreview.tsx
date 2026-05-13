import { useState, useCallback } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";

const TEMPLATES = [
  { value: "invite", label: "Client Invitation" },
];

export default function AdminEmailPreview() {
  const [template, setTemplate] = useState("invite");
  const [inviteUrl, setInviteUrl] = useState("https://portal.silvershadowstudio.com/set-password?token=PREVIEW");
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("Not authenticated"); return; }

      const params = new URLSearchParams({ template, inviteUrl });
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/preview-email?${params}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) { setError(`Error ${res.status}`); return; }
      setHtml(await res.text());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [template, inviteUrl]);

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <p className="text-[10px] uppercase tracking-[0.24em] text-foreground/40 mb-8">Email Preview</p>

        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-foreground/40">Template</label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="bg-transparent border border-border/50 text-foreground/70 text-xs uppercase tracking-[0.12em] px-3 py-2 rounded-sm focus:outline-none focus:border-gold/40"
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 flex-1 min-w-[260px]">
            <label className="text-[10px] uppercase tracking-[0.18em] text-foreground/40">Invite URL</label>
            <input
              type="text"
              value={inviteUrl}
              onChange={(e) => setInviteUrl(e.target.value)}
              placeholder="https://portal.silvershadowstudio.com/set-password?token=..."
              className="bg-transparent border-b border-border/50 text-foreground/70 text-xs px-0 py-2 focus:outline-none focus:border-gold/40 w-full"
            />
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="border border-gold/40 text-gold/70 text-[10px] uppercase tracking-[0.18em] px-5 py-2 rounded-sm hover:bg-gold/5 disabled:opacity-40 transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && (
          <p className="text-[11px] text-red-400 mb-4">{error}</p>
        )}

        {html ? (
          <iframe
            srcDoc={html}
            className="w-full border border-border/30 rounded-sm"
            style={{ height: 600 }}
            title="Email Preview"
          />
        ) : (
          <div className="flex items-center justify-center border border-border/20 rounded-sm text-foreground/20 text-xs uppercase tracking-[0.18em]" style={{ height: 600 }}>
            Press Refresh to preview
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
