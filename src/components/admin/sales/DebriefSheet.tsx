import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, Check, Mic, MicOff } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useDictation } from "@/hooks/useDictation";

// The debrief must take ~15 seconds or the rep stops doing it. One tap for the
// common outcome + one sentence. Submitting shows the coach's reply IN PLACE —
// it never navigates away. Thumb-usable: debriefs happen between calls, on a phone.

const QUICK_OUTCOMES = [
  { key: "no_answer", label: "No answer" },
  { key: "left_message", label: "Left message" },
  { key: "spoke", label: "Spoke" },
  { key: "meeting_booked", label: "Meeting booked" },
  { key: "pushed", label: "Pushed" },
  { key: "dead", label: "Dead" },
] as const;

export interface DebriefResult {
  success: boolean;
  interaction_id: string | null;
  applied: {
    stage: string | null;
    outcome: string | null;
    lead_updates: Record<string, unknown>;
    commitments: number;
    commitments_resolved: number;
  };
  proposed: {
    stage_change?: { to: string; reason: string | null; evidence: string | null; confidence: number; blocked_by: string[] };
    outcome?: string;
    value_estimate?: number;
  };
  needs_review: boolean;
  review_reasons: string[];
  other_companies_mentioned: string[];
  confidence: number;
  summary: string | null;
  coach_reply: string;
}

interface Props {
  leadId: string;
  company: string;
  onClose: () => void;
}

export function DebriefSheet({ leadId, company, onClose }: Props) {
  const qc = useQueryClient();
  const [quick, setQuick] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<DebriefResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sales-coach-debrief", {
        body: { lead_id: leadId, raw_text: text, quick_outcome: quick },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as DebriefResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setErrorMsg(null);
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  // Confirming a proposal is a second, explicit action — the coach never applies
  // a stage it couldn't justify with a verbatim quote.
  const confirmStage = useMutation({
    mutationFn: async (to: string) => {
      const { error } = await supabase.from("leads").update({ stage: to }).eq("id", leadId);
      if (error) throw new Error(error.message);
      return to;
    },
    onSuccess: (to) => {
      setResult((r) => r && ({ ...r, applied: { ...r.applied, stage: to }, proposed: { ...r.proposed, stage_change: undefined } }));
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const busy = submit.isPending;
  // Append with one space, never doubling one that's already there.
  const dictation = useDictation({
    onPhrase: (phrase) => setText((p) => (p.trim() ? `${p.replace(/\s+$/, "")} ` : "") + phrase),
    onError: (m) => setErrorMsg(m),
  });

  const canSubmit = (!!quick || text.trim().length > 0) && !busy;

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        // The sales panel gradient, so a debrief looks like it belongs to the
        // pipeline rather than to a generic dialog.
        className="ssr-panel ssr-panel--sales w-full sm:max-w-[560px] max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 sm:p-6"
        style={{ border: "1px solid rgba(201,169,106,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-sans uppercase text-[#C9A96A]" style={{ fontSize: 10, letterSpacing: "0.18em" }}>Debrief</p>
            <p className="mt-1 truncate text-sm font-medium text-strong">{company}</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-white/50 hover:text-white transition-colors" aria-label="Close">
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>

        {!result ? (
          <>
            {/* Quick outcome — one tap for the common case. */}
            <div className="mb-4 flex flex-wrap gap-2">
              {QUICK_OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setQuick(quick === o.key ? null : o.key)}
                  className={`rounded-lg border px-3.5 py-2.5 text-xs transition-colors ${
                    quick === o.key
                      ? "border-[#C9A96A]/70 bg-[#C9A96A]/15 text-[#ecd39c]"
                      : "border-white/10 text-white/70 hover:border-white/25"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                autoFocus
                placeholder="What happened? One sentence is enough — who you spoke to, what they said, what you agreed and when. Or press the mic and just say it."
                className="w-full rounded-lg border border-white/10 bg-black/25 p-3.5 pr-14 text-sm text-standard placeholder:text-white/30 focus:border-[#C9A96A]/50 focus:outline-none"
              />

              {/* Speaking a debrief between calls is the whole point — typing one
                  up afterwards is the tax nobody keeps paying. */}
              {dictation.supported && (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? "Stop dictating" : "Dictate the debrief"}
                  aria-pressed={dictation.listening}
                  title={dictation.listening ? "Stop dictating" : "Speak it instead"}
                  className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                    dictation.listening
                      ? "border-[#F0544C]/50 bg-[#F0544C]/10 text-[#F0544C]"
                      : "border-white/12 text-white/40 hover:border-[#C9A96A]/40 hover:text-[#ecd39c]"
                  }`}
                >
                  {dictation.listening && <span className="absolute inset-0 animate-ping rounded-full bg-[#F0544C]/15" />}
                  {dictation.listening
                    ? <MicOff className="relative h-4 w-4" strokeWidth={1.75} />
                    : <Mic className="relative h-4 w-4" strokeWidth={1.75} />}
                </button>
              )}
            </div>

            {dictation.listening && (
              <p className="mt-2 text-xs italic text-white/35">{dictation.interim || "Listening — speak as you would to a colleague."}</p>
            )}

            {errorMsg && (
              <p className="mt-3 text-xs text-[#FF6B5A]">{errorMsg}</p>
            )}

            <button
              onClick={() => { dictation.stop(); submit.mutate(); }}
              disabled={!canSubmit}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#C9A96A] text-sm font-medium text-[#211a0f] transition-opacity disabled:opacity-40"
            >
              {busy ? <BrandLoader size="sm" className="h-4 w-4" /> : "Save debrief"}
            </button>
          </>
        ) : (
          <>
            {/* The coach's reply, in place. */}
            <div className={`rounded-lg border p-4 ${result.needs_review ? "border-[#E4B95B]/40 bg-[#E4B95B]/[0.07]" : "border-white/10 bg-white/[0.03]"}`}>
              {result.needs_review && (
                <div className="mb-2 flex items-center gap-2 text-[#E4B95B]">
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.7} />
                  <span className="font-sans uppercase" style={{ fontSize: 9, letterSpacing: "0.18em" }}>Needs your eye</span>
                </div>
              )}
              <p className="text-sm leading-relaxed text-standard">{result.coach_reply}</p>
            </div>

            {/* What was actually written. */}
            <div className="mt-4 space-y-1.5 text-xs text-recessive">
              {result.summary && <p className="text-standard">{result.summary}</p>}
              {result.applied.stage && (
                <p className="flex items-center gap-1.5 text-[#6FBE8A]"><Check className="h-3 w-3" /> Stage → {result.applied.stage}</p>
              )}
              {result.applied.outcome && (
                <p className="flex items-center gap-1.5 text-[#6FBE8A]"><Check className="h-3 w-3" /> Outcome → {result.applied.outcome}</p>
              )}
              {result.applied.commitments > 0 && (
                <p className="flex items-center gap-1.5 text-[#6FBE8A]"><Check className="h-3 w-3" /> {result.applied.commitments} commitment{result.applied.commitments === 1 ? "" : "s"} logged</p>
              )}
              {result.applied.commitments_resolved > 0 && (
                <p className="flex items-center gap-1.5 text-[#6FBE8A]"><Check className="h-3 w-3" /> {result.applied.commitments_resolved} resolved</p>
              )}
              {result.other_companies_mentioned.length > 0 && (
                <p>Also mentioned: {result.other_companies_mentioned.join(", ")}</p>
              )}
            </div>

            {/* A stage the coach could NOT justify — explicit confirm only. */}
            {result.proposed.stage_change && (
              <div className="mt-4 rounded-lg border border-white/12 p-4">
                <p className="text-sm text-standard">
                  I read this as <span className="text-[#ecd39c]">{result.proposed.stage_change.to}</span> — but I&rsquo;m not applying it.
                </p>
                {result.proposed.stage_change.evidence && (
                  <p className="mt-1.5 text-xs italic text-recessive">&ldquo;{result.proposed.stage_change.evidence}&rdquo;</p>
                )}
                <p className="mt-1.5 font-sans uppercase text-white/40" style={{ fontSize: 9, letterSpacing: "0.14em" }}>
                  {result.proposed.stage_change.blocked_by.join(" · ")}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => confirmStage.mutate(result.proposed.stage_change!.to)}
                    disabled={confirmStage.isPending}
                    className="rounded-lg border border-[#C9A96A]/50 px-3.5 py-2 text-xs text-[#ecd39c] hover:bg-[#C9A96A]/10 transition-colors"
                  >
                    Apply {result.proposed.stage_change.to}
                  </button>
                  <button
                    onClick={() => setResult((r) => r && ({ ...r, proposed: { ...r.proposed, stage_change: undefined } }))}
                    className="rounded-lg px-3.5 py-2 text-xs text-white/50 hover:text-white/80 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {errorMsg && <p className="mt-3 text-xs text-[#FF6B5A]">{errorMsg}</p>}

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => { setResult(null); setText(""); setQuick(null); }}
                className="h-11 flex-1 rounded-lg border border-white/12 text-xs text-white/70 hover:border-white/25 transition-colors"
              >
                Another debrief
              </button>
              <button onClick={onClose} className="h-11 flex-1 rounded-lg bg-[#C9A96A] text-xs font-medium text-[#211a0f]">
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
