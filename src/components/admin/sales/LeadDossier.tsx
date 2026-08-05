import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, Phone, Mail, Linkedin, Trash2 } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";

// Everything the studio knows about one lead, and everything that has happened
// to it.
//
// The pipeline had been accumulating history — hundreds of stage events, every
// logged call — with no way to read any of it back. This is that record.
//
// Built as a portal with its own backdrop rather than a Radix dialog: this sits
// over a table whose rows are themselves clickable, and Radix's outside-click
// handling has bitten this project before (see SendLaterDialog).

interface Lead {
  id: string; company: string;
  contact_name: string | null; role: string | null; email: string | null; phone: string | null;
  linkedin_url: string | null; website: string | null;
  sector: string | null; country: string | null; segment: string | null;
  status: string; stage: string; outcome: string | null;
  loss_reason: string | null; loss_reason_category: string | null; closed_at: string | null;
  value_estimate: number | null; expected_margin_pct: number | null; actual_margin_pct: number | null;
  notes: string | null; pitch_subject: string | null; pitch_draft: string | null; call_script: string | null;
  last_contacted_at: string | null; next_action_at: string | null; stalled_at: string | null;
  import_source: string | null; created_at: string; updated_at: string;
}
interface Interaction {
  id: string; type: string; direction: string | null; outcome: string | null;
  summary: string | null; raw_debrief: string | null; objection: string | null; occurred_at: string;
}
interface LeadEvent {
  id: string; event_type: string; from_value: string | null; to_value: string | null;
  source: string; created_at: string;
}
interface Call {
  id: string; occurred_at: string; source: string; consent_note: string | null;
  transcript: string; performance_score: number | null; win_probability: number | null;
  assessment: {
    read_of_them?: string; verdict?: string;
    did_well?: string[]; cost_you?: string[]; blockers?: string[];
    actions?: { what: string; by: string; why?: string }[];
  } | null;
}
interface Commitment {
  id: string; party: string; description: string; due_date: string;
  status: string; slip_count: number; original_due_date: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", engaged: "Engaged", qualified: "Qualified",
  proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost", dead: "Dead",
};
const SOURCE_LABEL: Record<string, string> = {
  ui: "you", coach: "the Director", import: "the import", migration: "a migration", system: "the system",
};
const TYPE_LABEL: Record<string, string> = {
  call: "Call", email: "Email", meeting: "Meeting", linkedin: "LinkedIn", whatsapp: "WhatsApp", other: "Note",
};

const money = (n: number | null) =>
  n == null ? "—" : "£" + new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(n);
const day = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const stamp = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Colour for a score. Bad numbers should look bad — a coach whose grades all
 *  read the same colour isn't grading. */
const probTone = (n: number) =>
  n >= 70 ? "text-[#8FD9A8]" : n >= 40 ? "text-[#ecd39c]" : "text-[#F0544C]";

/** A labelled fact. Renders nothing when there's nothing to say, so the grid
 *  never fills with dashes on a thin lead. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "" || children === "—") return null;
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/30">{label}</p>
      <div className="mt-1 text-sm text-strong">{children}</div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] px-7 py-6">
      <div className="mb-4 flex items-baseline gap-3">
        <div className="h-px w-5 bg-gold-muted" />
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-white/60">{title}</h3>
        {count != null && <span className="text-[10px] tabular-nums text-white/25">{count}</span>}
      </div>
      {children}
    </section>
  );
}

export function LeadDossier({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [capture, setCapture] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [consent, setConsent] = useState("Announced at the start of the call");
  const [assessing, setAssessing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  /** Take a wrong entry back out. Only Fred does this — the Director writes
   *  history, it never edits it — and the removal itself is recorded. */
  async function remove(kind: "interaction" | "commitment", id: string) {
    setRemoving(id);
    const { error } = await supabase.rpc("sales_delete_entry", { p_kind: kind, p_id: id });
    setRemoving(null);
    if (error) { setCaptureError(error.message); return; }
    if (kind === "interaction") setInteractions((p) => p.filter((x) => x.id !== id));
    else setCommitments((p) => p.filter((x) => x.id !== id));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [l, i, e, c, k] = await Promise.all([
        supabase.from("leads").select("*").eq("id", leadId).maybeSingle(),
        supabase.from("interactions").select("id, type, direction, outcome, summary, raw_debrief, objection, occurred_at")
          .eq("lead_id", leadId).order("occurred_at", { ascending: false }),
        supabase.from("lead_events").select("id, event_type, from_value, to_value, source, created_at")
          .eq("lead_id", leadId).order("created_at", { ascending: false }),
        supabase.from("commitments").select("id, party, description, due_date, status, slip_count, original_due_date")
          .eq("lead_id", leadId).order("due_date"),
        supabase.from("lead_calls")
          .select("id, occurred_at, source, consent_note, transcript, performance_score, win_probability, assessment")
          .eq("lead_id", leadId).order("occurred_at", { ascending: false }),
      ]);
      setLead((l.data ?? null) as Lead | null);
      setInteractions((i.data ?? []) as Interaction[]);
      setEvents((e.data ?? []) as LeadEvent[]);
      setCommitments((c.data ?? []) as Commitment[]);
      setCalls((k.data ?? []) as Call[]);
      setLoading(false);
    })();
  }, [leadId]);

  async function assess() {
    const text = transcript.trim();
    if (text.length < 40) { setCaptureError("That's too short to judge — paste the whole call."); return; }
    setAssessing(true); setCaptureError(null);
    const { data, error } = await supabase.functions.invoke("sales-call-assess", {
      body: { lead_id: leadId, transcript: text, consent_note: consent.trim() || null, source: "recording" },
    });
    setAssessing(false);
    if (error || data?.error) { setCaptureError(data?.error ?? error?.message ?? "Couldn't assess it."); return; }
    setTranscript(""); setCapture(false);
    const [k, l, c] = await Promise.all([
      supabase.from("lead_calls")
        .select("id, occurred_at, source, consent_note, transcript, performance_score, win_probability, assessment")
        .eq("lead_id", leadId).order("occurred_at", { ascending: false }),
      supabase.from("leads").select("*").eq("id", leadId).maybeSingle(),
      supabase.from("commitments").select("id, party, description, due_date, status, slip_count, original_due_date")
        .eq("lead_id", leadId).order("due_date"),
    ]);
    setCalls((k.data ?? []) as Call[]);
    if (l.data) setLead(l.data as Lead);
    setCommitments((c.data ?? []) as Commitment[]);
  }

  // One timeline. A stage change and a phone call are both "what happened",
  // and splitting them into two lists makes the story impossible to follow.
  const timeline = [
    ...interactions.map((x) => ({ at: x.occurred_at, kind: "interaction" as const, x })),
    ...events.map((x) => ({ at: x.created_at, kind: "event" as const, x })),
    // Oldest first: the story reads top to bottom, and the newest thing sits
    // where you finish rather than where you start.
  ].sort((a, b) => a.at.localeCompare(b.at));

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto p-6" style={{ pointerEvents: "auto" }}>
      <div className="fixed inset-0 bg-black/75 backdrop-blur-[3px] animate-in fade-in-0 duration-200" onClick={onClose} />

      <div className="relative my-auto w-full max-w-3xl overflow-hidden rounded-xl border border-[#C9A96A]/20 bg-[#1a1013] shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
        {loading || !lead ? (
          <div className="flex justify-center py-24"><BrandLoader size="sm" /></div>
        ) : (
          <>
            {/* ── Header ───────────────────────────────────────────────── */}
            <div className="px-7 pb-6 pt-7">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="mb-2.5 flex items-center gap-3">
                    <div className="h-px w-8 bg-gold-muted" />
                    <span className="text-[10px] uppercase tracking-[0.22em] text-[#ecd39c]">
                      {STAGE_LABEL[lead.stage] ?? lead.stage}
                    </span>
                    {lead.outcome && (
                      <span className={`text-[10px] uppercase tracking-[0.18em] ${lead.outcome === "won" ? "text-emerald-400" : "text-white/35"}`}>
                        · {lead.outcome}
                      </span>
                    )}
                  </div>
                  <h2 className="truncate text-2xl text-strong">{lead.company}</h2>
                  {(lead.contact_name || lead.role) && (
                    <p className="mt-1 text-sm text-white/55">
                      {lead.contact_name}{lead.role ? ` — ${lead.role}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-start gap-5">
                  {(lead as Lead & { win_probability?: number | null }).win_probability != null && (
                    <div className="text-right">
                      <p className="text-[9px] uppercase tracking-[0.2em] text-white/30">Chance of signing</p>
                      <p className={`ssr-figure-sm mt-1 ${probTone((lead as Lead & { win_probability?: number | null }).win_probability!)}`}>
                        {(lead as Lead & { win_probability?: number | null }).win_probability}%
                      </p>
                    </div>
                  )}
                  <button onClick={onClose} className="text-white/35 hover:text-white/80" aria-label="Close">
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              {/* Every way to reach them, on one line. */}
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-[#ecd39c]">
                    <Mail className="h-3 w-3" strokeWidth={1.5} />{lead.email}
                  </a>
                )}
                {lead.phone && (
                  <a href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1.5 text-xs text-[#C9A96A] hover:text-[#ecd39c]">
                    <Phone className="h-3 w-3" strokeWidth={1.5} />{lead.phone}
                  </a>
                )}
                {lead.linkedin_url && (
                  <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 text-xs text-[#70B5F9] hover:underline">
                    <Linkedin className="h-3 w-3" strokeWidth={1.5} />LinkedIn
                  </a>
                )}
                {lead.website && (
                  <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                     target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-[#ecd39c]">
                    <ExternalLink className="h-3 w-3" strokeWidth={1.5} />{lead.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            </div>

            {/* ── The facts ────────────────────────────────────────────── */}
            <Section title="Where it stands">
              <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
                <Fact label="Value">{lead.value_estimate != null ? money(lead.value_estimate) : "—"}</Fact>
                <Fact label="Next chase">{day(lead.next_action_at)}</Fact>
                <Fact label="Last contacted">{day(lead.last_contacted_at)}</Fact>
                <Fact label="Sector">{lead.sector}</Fact>
                <Fact label="Country">{lead.country}</Fact>
                <Fact label="Segment">{lead.segment}</Fact>
                <Fact label="Expected margin">{lead.expected_margin_pct != null ? `${lead.expected_margin_pct}%` : "—"}</Fact>
                <Fact label="Actual margin">{lead.actual_margin_pct != null ? `${lead.actual_margin_pct}%` : "—"}</Fact>
                <Fact label="Closed">{day(lead.closed_at)}</Fact>
                <Fact label="Lost because">{lead.loss_reason ?? lead.loss_reason_category}</Fact>
                <Fact label="Gone quiet since">{day(lead.stalled_at)}</Fact>
                <Fact label="Came from">{lead.import_source}</Fact>
                <Fact label="Added">{day(lead.created_at)}</Fact>
              </div>
            </Section>

            {lead.notes && (
              <Section title="Notes">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{lead.notes}</p>
              </Section>
            )}

            {/* ── Promises ─────────────────────────────────────────────── */}
            {commitments.length > 0 && (
              <Section title="Promised" count={commitments.length}>
                <div className="space-y-3">
                  {commitments.map((c) => (
                    <div key={c.id} className="flex items-baseline justify-between gap-4">
                      <p className="text-sm text-white/75">
                        <span className={c.party === "us" ? "text-[#C9A96A]" : "text-white/45"}>
                          {c.party === "us" ? "You" : "They"}
                        </span>{" "}
                        {c.description}
                      </p>
                      <p className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-white/40">
                        {day(c.due_date)}
                        {c.slip_count > 0 && <span className="text-[#F0544C]">slipped {c.slip_count}×</span>}
                        <span className="text-white/25">{c.status}</span>
                        <button
                          onClick={() => remove("commitment", c.id)}
                          disabled={removing === c.id}
                          title="Remove this — it shouldn't be here"
                          className="text-white/20 transition-colors hover:text-[#F0544C] disabled:opacity-30"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Calls, and what the Director made of them ─────────────── */}
            <Section title="Calls" count={calls.length || undefined}>
              {calls.length === 0 && !capture && (
                <p className="mb-4 text-sm text-recessive">No call transcripts yet.</p>
              )}

              <div className="space-y-5">
                {calls.map((c) => (
                  <div key={c.id} className="rounded-lg border border-white/[0.07] p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">
                        {stamp(c.occurred_at)}{c.consent_note ? ` · ${c.consent_note}` : ""}
                      </p>
                      {c.performance_score != null && (
                        <div className="flex items-baseline gap-5 text-xs">
                          <span className="text-white/35">
                            You <span className={`ml-1.5 tabular-nums ${probTone(c.performance_score)}`}>{c.performance_score}%</span>
                          </span>
                          <span className="text-white/35">
                            Chance <span className={`ml-1.5 tabular-nums ${probTone(c.win_probability ?? 0)}`}>{c.win_probability}%</span>
                          </span>
                        </div>
                      )}
                    </div>

                    {c.assessment?.verdict && (
                      <p className="mt-2.5 text-sm leading-relaxed text-strong">{c.assessment.verdict}</p>
                    )}
                    {c.assessment?.read_of_them && (
                      <p className="mt-2 text-sm leading-relaxed text-white/60">
                        <span className="text-white/30">Them — </span>{c.assessment.read_of_them}
                      </p>
                    )}

                    {(c.assessment?.did_well?.length || c.assessment?.cost_you?.length) && (
                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        {!!c.assessment?.did_well?.length && (
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-[#8FD9A8]/70">Played well</p>
                            <ul className="mt-1.5 space-y-1">
                              {c.assessment.did_well.map((x) => <li key={x} className="text-xs leading-relaxed text-white/55">{x}</li>)}
                            </ul>
                          </div>
                        )}
                        {!!c.assessment?.cost_you?.length && (
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-[#F0544C]/70">Cost you</p>
                            <ul className="mt-1.5 space-y-1">
                              {c.assessment.cost_you.map((x) => <li key={x} className="text-xs leading-relaxed text-white/55">{x}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {!!c.assessment?.actions?.length && (
                      <div className="mt-3 border-t border-white/[0.06] pt-3">
                        <p className="text-[9px] uppercase tracking-[0.18em] text-white/30">To move it</p>
                        {c.assessment.actions.map((a) => (
                          <p key={a.what} className="mt-1.5 text-xs leading-relaxed text-white/65">
                            {a.what} <span className="tabular-nums text-[#ecd39c]">· by {day(a.by)}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    <details className="mt-3">
                      <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-white/25 hover:text-white/50">
                        Transcript
                      </summary>
                      <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-white/45">
                        {c.transcript}
                      </p>
                    </details>
                  </div>
                ))}
              </div>

              {capture ? (
                <div className="mt-4 rounded-lg border border-[#C9A96A]/25 p-4">
                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    rows={7}
                    autoFocus
                    placeholder="Paste the call transcript here."
                    className="w-full rounded-md border border-white/10 bg-black/25 p-3 text-sm text-standard placeholder:text-white/25 focus:border-[#C9A96A]/50 focus:outline-none"
                  />
                  {/* Recorded, not assumed: France, Italy and Monaco are stricter
                      than the UK, and this is the field that can answer for it. */}
                  <input
                    value={consent}
                    onChange={(e) => setConsent(e.target.value)}
                    placeholder="How consent was handled"
                    className="mt-2.5 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/70 placeholder:text-white/25 focus:border-[#C9A96A]/50 focus:outline-none"
                  />
                  {captureError && <p className="mt-2 text-xs text-[#F0544C]">{captureError}</p>}
                  <div className="mt-3 flex items-center gap-5">
                    <button onClick={assess} disabled={assessing}
                      className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c] disabled:opacity-40">
                      {assessing ? <><BrandLoader size="sm" className="h-3 w-3" />Assessing…</> : "Assess this call"}
                    </button>
                    <button onClick={() => { setCapture(false); setCaptureError(null); }}
                      className="text-[10px] uppercase tracking-[0.16em] text-white/30 hover:text-white/60">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setCapture(true)}
                  className="mt-4 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
                  + Add a call transcript
                </button>
              )}
            </Section>

            {/* ── The whole history ────────────────────────────────────── */}
            <Section title="History" count={timeline.length}>
              {timeline.length === 0 ? (
                <p className="text-sm text-recessive">Nothing has happened on this lead yet.</p>
              ) : (
                <ol className="relative space-y-5 border-l border-white/[0.07] pl-5">
                  {timeline.map((row) => (
                    <li key={`${row.kind}-${row.kind === "interaction" ? row.x.id : row.x.id}`} className="relative">
                      <span className="absolute -left-[23px] top-[6px] h-1.5 w-1.5 rounded-full bg-[#C9A96A]/60" />
                      {row.kind === "interaction" ? (
                        <div className="group/entry">
                          <button
                            onClick={() => remove("interaction", row.x.id)}
                            disabled={removing === row.x.id}
                            title="Remove this entry"
                            className="float-right text-white/25 transition-colors hover:text-[#F0544C] disabled:opacity-30"
                          >
                            <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                          </button>
                          <p className="text-sm text-strong">
                            {TYPE_LABEL[row.x.type] ?? row.x.type}
                            {row.x.direction && <span className="text-white/35"> · {row.x.direction}</span>}
                            {row.x.outcome && <span className="text-[#ecd39c]"> · {row.x.outcome.replace(/_/g, " ")}</span>}
                          </p>
                          {row.x.summary && <p className="mt-1 text-sm text-white/60">{row.x.summary}</p>}
                          {row.x.objection && (
                            <p className="mt-1 text-xs italic text-[#F0544C]/80">Objection: {row.x.objection}</p>
                          )}
                          {/* Fred's own words, kept verbatim — the summary is a
                              normalisation of them, not a replacement. */}
                          {row.x.raw_debrief && (
                            <p className="mt-1.5 border-l border-white/10 pl-3 text-xs italic text-white/35">
                              “{row.x.raw_debrief}”
                            </p>
                          )}
                          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/25">{stamp(row.x.occurred_at)}</p>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-white/70">
                            {row.x.event_type === "entry_removed"
                              ? <>Removed a {row.x.from_value ?? "entry"} — <span className="text-white/40">“{row.x.to_value}”</span></>
                              : row.x.event_type === "created"
                              ? "Added to the pipeline"
                              : row.x.event_type === "stage_change"
                              ? <>Moved <span className="text-white/40">{STAGE_LABEL[row.x.from_value ?? ""] ?? row.x.from_value ?? "—"}</span> → <span className="text-[#ecd39c]">{STAGE_LABEL[row.x.to_value ?? ""] ?? row.x.to_value}</span></>
                              : row.x.event_type === "value_change"
                              ? <>Value {money(Number(row.x.from_value))} → <span className="text-[#ecd39c]">{money(Number(row.x.to_value))}</span></>
                              : row.x.event_type.replace(/_/g, " ")}
                          </p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/25">
                            {stamp(row.x.created_at)} · by {SOURCE_LABEL[row.x.source] ?? row.x.source}
                          </p>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            {/* ── What we've written ───────────────────────────────────── */}
            {(lead.pitch_draft || lead.call_script) && (
              <Section title="Drafted">
                {lead.pitch_draft && (
                  <div className="mb-5">
                    {lead.pitch_subject && (
                      <p className="mb-1.5 text-xs text-white/45">Subject: <span className="text-white/70">{lead.pitch_subject}</span></p>
                    )}
                    <p className="whitespace-pre-wrap rounded-md bg-black/25 p-4 text-sm leading-relaxed text-white/65">{lead.pitch_draft}</p>
                  </div>
                )}
                {lead.call_script && (
                  <p className="whitespace-pre-wrap rounded-md bg-black/25 p-4 text-sm leading-relaxed text-white/65">{lead.call_script}</p>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
