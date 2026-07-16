import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/finance";

interface AdminAlert {
  id: string;
  kind: string;
  source: string;
  detail: Record<string, unknown>;
  raised_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/**
 * Query for unresolved admin_alerts. RLS on admin_alerts restricts SELECT
 * to admins via public.is_admin() — non-admin sessions naturally get zero
 * rows, so the banner never renders for clients.
 */
export function useUnresolvedAdminAlerts() {
  return useQuery({
    queryKey: ["admin_alerts_unresolved"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_alerts" as any)
        .select("*")
        .is("resolved_at", null)
        .order("raised_at", { ascending: false });
      if (error) return [] as AdminAlert[];
      return (data ?? []) as AdminAlert[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

interface AdminAlertBannerProps {
  /** px offset from viewport top (nonzero when GhostModeBanner is above). */
  offsetTop: number;
}

const KIND_LABELS: Record<string, string> = {
  schema_drift: "Schema drift",
  sync_failure: "Sync failure",
};

const SOURCE_LABELS: Record<string, string> = {
  airtable_payables: "payables",
};

export function AdminAlertBanner({ offsetTop }: AdminAlertBannerProps) {
  const { data: alerts } = useUnresolvedAdminAlerts();
  const [detailOpen, setDetailOpen] = useState(false);
  const [acking, setAcking] = useState(false);
  const qc = useQueryClient();

  if (!alerts || alerts.length === 0) return null;

  const first = alerts[0];
  const detail = (first.detail ?? {}) as Record<string, unknown>;
  const roleOrField =
    (detail.role as string | undefined) ??
    (detail.field_id as string | undefined) ??
    "";
  const kindLabel = KIND_LABELS[first.kind] ?? first.kind;
  const sourceLabel = SOURCE_LABELS[first.source] ?? first.source;

  const handleAckAll = async () => {
    setAcking(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    await supabase
      .from("admin_alerts" as any)
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
      })
      .is("resolved_at", null);
    setAcking(false);
    qc.invalidateQueries({ queryKey: ["admin_alerts_unresolved"] });
  };

  return (
    <>
      <div
        className="fixed inset-x-0 z-[95] h-10 border-b border-divider bg-background/95 backdrop-blur"
        style={{ top: offsetTop }}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-[9px] uppercase tracking-[0.28em] text-gold shrink-0">
              {kindLabel}
            </span>
            <span className="text-xs text-standard truncate">
              on <span className="text-strong">{sourceLabel}</span>
              {roleOrField && (
                <span className="text-recessive"> · {roleOrField}</span>
              )}
              {alerts.length > 1 && (
                <span className="text-recessive"> · +{alerts.length - 1} more</span>
              )}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-6">
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="text-xs text-recessive hover:text-standard transition-colors"
            >
              Details
            </button>
            <button
              type="button"
              onClick={handleAckAll}
              disabled={acking}
              className="text-xs text-gold hover:underline underline-offset-4 disabled:opacity-50"
            >
              {acking ? "Acknowledging…" : "Acknowledge all"}
            </button>
          </div>
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent
          className="max-w-2xl max-h-[80vh] rounded-sm border-divider bg-background"
          hideClose
        >
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
              Unresolved alerts
            </p>
            <DialogTitle className="font-serif font-normal text-2xl">
              {alerts.length} unresolved
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 overflow-y-auto">
            {alerts.map((a) => (
              <div key={a.id} className="border border-divider rounded-sm p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-[0.28em] text-gold">
                    {a.kind}
                  </span>
                  <span className="text-xs text-recessive">
                    {formatDate(a.raised_at)}
                  </span>
                </div>
                <p className="text-sm text-standard mb-2">
                  Source: <span className="text-strong">{a.source}</span>
                </p>
                <pre className="text-xs text-recessive whitespace-pre-wrap break-all bg-foreground/[0.03] p-3 rounded-sm">
                  {JSON.stringify(a.detail, null, 2)}
                </pre>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-6 border-t border-divider pt-4">
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className="text-sm text-recessive hover:text-standard transition-colors"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
