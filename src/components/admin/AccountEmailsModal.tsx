import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";

interface EmailListRow {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event: string | null;
}
interface EmailDetail {
  id: string;
  to: string[];
  from: string | null;
  subject: string;
  html: string | null;
  text: string | null;
  created_at: string | null;
  last_event: string | null;
  events: Array<{ name: string; occurred_at: string | null }>;
}

function formatEmailTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${d.getFullYear()} ${hh}:${mm}`;
}

function eventToneClass(event: string | null | undefined): string {
  switch ((event || "").toLowerCase()) {
    case "delivered":
    case "opened":
    case "clicked":
      return "text-emerald-500/80";
    case "bounced":
    case "complained":
    case "failed":
      return "text-destructive";
    case "delivery_delayed":
      return "text-amber-500/80";
    default:
      return "text-muted-foreground";
  }
}

interface Props {
  accountId: string | null;
  accountName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Emails sent from the portal to an account, with per-email preview + delivery
 * status. Account-based (list-client-emails / get-client-email), so it works for
 * client AND team accounts. Opened from the account-card mail icon.
 */
export function AccountEmailsModal({ accountId, accountName, open, onOpenChange }: Props) {
  const [emails, setEmails] = useState<EmailListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmailListRow | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setWarning(null);
        const { data, error } = await supabase.functions.invoke("list-client-emails", { body: { account_id: accountId } });
        if (cancelled) return;
        if (error) throw error;
        setEmails(Array.isArray(data?.emails) ? data.emails : []);
        if (data?.warning) setWarning(String(data.warning));
      } catch (err: any) {
        if (cancelled) return;
        setEmails([]);
        setWarning(err?.message || "Failed to load emails");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, accountId]);

  async function openPreview(row: EmailListRow) {
    setSelected(row);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-client-email", { body: { email_id: row.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDetail(data as EmailDetail);
    } catch (err: any) {
      setDetailError(err?.message || "Failed to load email");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] overflow-hidden rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Portal emails{accountName ? ` · ${accountName}` : ""}</p>
            <DialogTitle className="font-serif font-normal text-2xl">Emails sent</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {loading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
                <BrandLoader size="sm" className="h-3.5 w-3.5" /> Loading email history…
              </div>
            ) : emails.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {warning ? `No emails sent to this account yet. (${warning})` : "No emails sent to this account yet."}
              </p>
            ) : (
              <div>
                {warning && <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 mb-3">{warning}</p>}
                {emails.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => openPreview(row)}
                    className="w-full text-left flex items-center gap-5 py-3 border-t border-border/30 hover:bg-muted/15 transition-colors"
                  >
                    <span className="shrink-0 font-sans tabular-nums text-foreground/70" style={{ fontSize: 11, minWidth: 130 }}>{formatEmailTimestamp(row.created_at)}</span>
                    <span className="shrink-0 font-sans text-foreground/60 truncate" style={{ fontSize: 11, minWidth: 160, maxWidth: 200 }}>{(row.to && row.to[0]) || "—"}</span>
                    <span className="flex-1 font-serif text-foreground truncate" style={{ fontSize: 13 }}>{row.subject || "(no subject)"}</span>
                    <span className={`shrink-0 font-sans uppercase ${eventToneClass(row.last_event)}`} style={{ fontSize: 9, letterSpacing: "0.18em", minWidth: 70 }}>{row.last_event || "sent"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Per-email preview */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setDetail(null); setDetailError(null); setDetailLoading(false); } }}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border/40">
            <DialogTitle className="font-serif text-base text-foreground truncate pr-8">{selected?.subject || "Email preview"}</DialogTitle>
            {selected && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                <span><span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">To</span>{(detail?.to ?? selected.to)?.join(", ") || "—"}</span>
                <span><span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">From</span>{detail?.from ?? selected.from ?? "—"}</span>
                <span><span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">Sent</span>{formatEmailTimestamp(detail?.created_at ?? selected.created_at)}</span>
                <span><span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">Status</span><span className={eventToneClass(detail?.last_event ?? selected.last_event)}>{detail?.last_event ?? selected.last_event ?? "sent"}</span></span>
              </div>
            )}
            {detail && detail.events.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">Events</span>
                {detail.events.map((e, i) => <span key={i} className="mr-3">{e.name}{e.occurred_at ? ` · ${formatEmailTimestamp(e.occurred_at)}` : ""}</span>)}
              </div>
            )}
          </DialogHeader>
          <div className="bg-muted/30" style={{ height: "70vh" }}>
            {detailLoading ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2"><BrandLoader size="sm" className="h-3.5 w-3.5" /> Loading email…</div>
            ) : detailError ? (
              <div className="flex items-center justify-center h-full text-sm text-destructive px-6">{detailError}</div>
            ) : detail?.html ? (
              <iframe title="Email preview" srcDoc={detail.html} sandbox="" className="w-full h-full bg-white" />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground px-6">{detail?.text || "No rendered HTML available for this email."}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
