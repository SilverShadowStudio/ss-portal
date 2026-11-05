import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Log a contact by hand: one call, email, message or meeting, in a few clicks.
//
// The debrief and the Director both log through the AI, which is right for a
// real conversation and slow for "sent the follow-up email". This writes the
// same interactions row directly, so it counts in the KPIs exactly the same.
// Direction and outcome are what the KPIs read: outbound = outreach,
// inbound = a reply, outcome "meeting booked" = a meeting.

const TYPES = [
  { value: "email", label: "Email" },
  { value: "call", label: "Call" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];
const OUTCOMES = [
  { value: "none", label: "No outcome yet" },
  { value: "spoke", label: "Spoke" },
  { value: "no_answer", label: "No answer" },
  { value: "left_message", label: "Left a message" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "pushed", label: "Pushed back (later)" },
  { value: "objection", label: "Objection" },
  { value: "dead", label: "Not interested" },
  { value: "other", label: "Other" },
];

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Props {
  lead: { id: string; company: string } | null;
  onClose: () => void;
  onLogged?: () => void;
}

export function LogContactDialog({ lead, onClose, onLogged }: Props) {
  const { toast } = useToast();
  const [type, setType] = useState("email");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [outcome, setOutcome] = useState("none");
  const [date, setDate] = useState(todayLocal());
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);

  // Fresh form for each lead it opens on. Gated on the lead id, not on any
  // state this effect writes.
  useEffect(() => {
    if (!lead) return;
    setType("email"); setDirection("outbound"); setOutcome("none"); setDate(todayLocal()); setSummary("");
  }, [lead?.id]);

  async function save() {
    if (!lead) return;
    setSaving(true);
    const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
    // A date picked today keeps the current time; a past date is logged at midday,
    // so it can never fall into the wrong month at a timezone edge.
    const occurred = date === todayLocal() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString();
    const { error } = await (supabase as unknown as {
      from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<{ error: { message: string } | null }> };
    }).from("interactions").insert({
      lead_id: lead.id,
      type,
      direction,
      outcome: outcome === "none" ? null : outcome,
      summary: summary.trim() || null,
      raw_debrief: summary.trim() || null,
      occurred_at: occurred,
      created_by: uid,
    });
    setSaving(false);
    if (error) { toast({ title: "Couldn't log it", description: error.message, variant: "destructive" }); return; }
    onLogged?.();
    onClose();
  }

  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md rounded-sm border-divider bg-background">
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Sales · {lead?.company}</p>
          <DialogTitle className="font-serif font-normal text-2xl">Log a contact</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5"><Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Direction</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "outbound" | "inbound")}>
              <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outbound">We contacted them</SelectItem>
                <SelectItem value="inbound">They replied or got in touch</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Date</Label>
            <Input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value || todayLocal())} className="rounded-sm" />
          </div>
          <div className="col-span-2 space-y-1.5"><Label>Note (optional)</Label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="What was said or sent, in a line or two" className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm resize-none" />
          </div>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="text-sm text-recessive hover:text-standard">Cancel</button>
          <Button onClick={save} disabled={saving} className="rounded-sm">{saving ? "Logging…" : "Log it"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
