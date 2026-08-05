import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUp, Check, X, Plus, MessageSquare, Brain, Link as LinkIcon, Mic, MicOff } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// The Sales Director.
//
// It reads the pipeline and writes to it. Creating a lead, logging a call and
// setting a commitment happen the moment it says so; stage, value, outcome and
// owner come back as a card that Fred has to click. That split is enforced in
// SQL — this page only renders the consequence of it.

interface Citation { url?: string; title?: string; cited_text?: string }
interface Block { type: string; text?: string; name?: string; citations?: Citation[]; [k: string]: unknown }
interface Source { url: string; title: string }
interface Msg { id: string; role: "user" | "assistant"; body: string | null; blocks: Block[] | null; created_at: string }
interface Action {
  id: string; lead_id: string; kind: string;
  from_value: string | null; to_value: string; reason: string | null;
  status: string; created_at: string;
}
interface Thread { id: string; title: string | null; last_message_at: string }

const KIND_LABEL: Record<string, string> = {
  stage_change: "Stage", value_change: "Value", outcome_set: "Outcome", owner_change: "Owner",
};
const TOOL_LABEL: Record<string, string> = {
  search_pipeline: "searched the pipeline",
  get_lead: "read the lead",
  pipeline_summary: "totalled the pipeline",
  create_lead: "created a lead",
  log_interaction: "logged it",
  set_commitment: "set a commitment",
  list_commitments: "checked what's promised",
  update_lead: "updated the lead",
  web_search: "searched the web",
  web_fetch: "read the page",
};
const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", engaged: "Engaged", qualified: "Qualified",
  proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost", dead: "Dead",
};

const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const prettyValue = (kind: string, v: string | null) => {
  if (v == null || v === "") return "—";
  if (kind === "stage_change") return STAGE_LABEL[v] ?? v;
  if (kind === "value_change") return money(Number(v));
  if (kind === "outcome_set") return v.charAt(0).toUpperCase() + v.slice(1);
  return v;
};

/** Walk stored messages into display items. Tool-result turns are stored as
 *  role:'user' with no body — they're wire traffic, not conversation. */
function toItems(msgs: Msg[]) {
  return msgs.flatMap((m) => {
    if (m.role === "user") {
      return m.body ? [{ id: m.id, who: "user" as const, text: m.body, tools: [] as string[], sources: [] as Source[] }] : [];
    }
    const blocks = m.blocks ?? [];
    // server_tool_use is web search/fetch — run by Anthropic, but it's still
    // work the Director did and Fred should see it happen.
    const tools = blocks
      .filter((b) => b.type === "tool_use" || b.type === "server_tool_use")
      .map((b) => String(b.name));

    // Citations ride on the text blocks. Dedupe by URL — one page cited six
    // times is one source, not six.
    const seen = new Set<string>();
    const sources: Source[] = [];
    for (const b of blocks) {
      for (const c of b.citations ?? []) {
        if (!c.url || seen.has(c.url)) continue;
        seen.add(c.url);
        sources.push({ url: c.url, title: c.title || new URL(c.url).hostname.replace(/^www\./, "") });
      }
    }

    const text = m.body ?? "";
    if (!text && !tools.length) return [];
    return [{ id: m.id, who: "director" as const, text, tools, sources }];
  });
}

// ── Voice ────────────────────────────────────────────────────────────────────
// Browser SpeechRecognition. Free, no key, no per-minute cost — but Chrome and
// Edge are where it's good, Safari is patchy and iOS weaker still. When it
// isn't available we hide the button rather than showing one that fails:
// macOS Fn-dictation types into the same box and works everywhere.

interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SRInstance {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SRInstance;

const SpeechCtor: SRCtor | undefined =
  (window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition;

const SPEECH_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it for this site in your browser settings.",
  "service-not-allowed": "Your browser refused the speech service.",
  "audio-capture": "No microphone found.",
  network: "The speech service couldn't be reached.",
};

export default function AdminSalesDirector() {
  const { toast } = useToast();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [leadNames, setLeadNames] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [booting, setBooting] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [picker, setPicker] = useState(false);
  // The standing brief — what the Director carries between conversations.
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [briefMeta, setBriefMeta] = useState<{ edited_by_user: boolean; updated_at: string | null } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<SRInstance | null>(null);
  // Chrome ends a "continuous" session after a pause. This tracks whether Fred
  // still means to be dictating, so a natural pause resumes instead of stopping.
  const wantVoice = useRef(false);

  const items = useMemo(() => toItems(msgs), [msgs]);
  const pending = actions.filter((a) => a.status === "pending");

  const scroll = (behavior: ScrollBehavior = "smooth") =>
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior, block: "end" }));

  async function loadThreads() {
    const { data } = await supabase.functions.invoke("sales-coach-chat", { body: { list_threads: true } });
    setThreads((data?.threads ?? []) as Thread[]);
    return (data?.threads ?? []) as Thread[];
  }

  async function loadThread(id: string) {
    const { data } = await supabase.functions.invoke("sales-coach-chat", { body: { thread_id: id, history: true } });
    setMsgs((data?.messages ?? []) as Msg[]);
    setActions((data?.actions ?? []) as Action[]);
    setThreadId(id);
    scroll("auto");
  }

  useEffect(() => {
    (async () => {
      const t = await loadThreads();
      if (t.length) await loadThread(t[0].id);
      setBooting(false);
      scroll("auto");
    })();
  }, []);

  // The messages paint after booting flips; land on the newest once they exist.
  useEffect(() => {
    if (!booting && items.length) scroll("auto");
  }, [booting, items.length]);

  // Company names for the confirmation cards — the model works in ids, Fred doesn't.
  useEffect(() => {
    const missing = [...new Set(actions.map((a) => a.lead_id))].filter((id) => !leadNames[id]);
    if (!missing.length) return;
    supabase.from("leads").select("id, company").in("id", missing).then(({ data }) => {
      if (data?.length) setLeadNames((p) => ({ ...p, ...Object.fromEntries(data.map((l) => [l.id, l.company])) }));
    });
  }, [actions, leadNames]);

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    if (listening) stopVoice();
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";

    // Optimistic echo so the message appears the instant it's sent.
    const temp: Msg = { id: `tmp-${Date.now()}`, role: "user", body: text, blocks: null, created_at: new Date().toISOString() };
    setMsgs((p) => [...p, temp]);
    setThinking(true);
    scroll();

    const { data, error } = await supabase.functions.invoke("sales-coach-chat", {
      body: { message: text, thread_id: threadId },
    });
    setThinking(false);

    if (error || data?.error) {
      setMsgs((p) => p.filter((m) => m.id !== temp.id));
      setInput(text);
      toast({ title: "The Director didn't answer", description: data?.error ?? error?.message, variant: "destructive" });
      return;
    }

    // Re-read the thread rather than splicing: the server is the record of
    // what was actually said and done, including any tool rounds.
    await loadThread(data.thread_id);
    if (!threadId) loadThreads();
    scroll();
  }

  async function resolve(a: Action, decision: "confirm" | "decline") {
    setActions((p) => p.map((x) => (x.id === a.id ? { ...x, status: decision === "confirm" ? "confirmed" : "declined" } : x)));
    const { data, error } = await supabase.functions.invoke("sales-coach-chat", { body: { action_id: a.id, decision } });
    if (error || data?.error) {
      setActions((p) => p.map((x) => (x.id === a.id ? { ...x, status: "pending" } : x)));
      toast({ title: "Couldn't apply that", description: data?.error ?? error?.message, variant: "destructive" });
      return;
    }
    toast({
      title: decision === "confirm" ? "Applied" : "Dismissed",
      description: decision === "confirm"
        ? `${leadNames[a.lead_id] ?? "Lead"} — ${KIND_LABEL[a.kind]} set to ${prettyValue(a.kind, a.to_value)}.`
        : "Nothing changed.",
    });
  }

  function stopVoice() {
    wantVoice.current = false;
    setListening(false);
    setInterim("");
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    recRef.current = null;
  }

  function startVoice() {
    if (!SpeechCtor) return;
    if (listening) { stopVoice(); return; }

    const rec = new SpeechCtor();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let done = "", live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) done += r[0].transcript;
        else live += r[0].transcript;
      }
      if (done.trim()) {
        // Append with one space, never doubling one Fred already typed.
        setInput((p) => (p.trim() ? `${p.replace(/\s+$/, "")} ` : "") + done.trim());
      }
      setInterim(live);
    };

    rec.onerror = (e) => {
      // Silence isn't a failure — it's a pause. Everything else is worth saying.
      if (e.error === "no-speech" || e.error === "aborted") return;
      wantVoice.current = false;
      setListening(false);
      toast({ title: "Dictation stopped", description: SPEECH_ERRORS[e.error] ?? e.error, variant: "destructive" });
    };

    rec.onend = () => {
      setInterim("");
      // A pause ends the session; resume it unless Fred actually stopped.
      if (wantVoice.current) { try { rec.start(); return; } catch { /* fall through */ } }
      setListening(false);
    };

    try {
      rec.start();
      recRef.current = rec;
      wantVoice.current = true;
      setListening(true);
      taRef.current?.focus();
    } catch {
      toast({ title: "Couldn't start dictation", variant: "destructive" });
    }
  }

  // Never leave the mic live on a page the user has left.
  useEffect(() => () => { wantVoice.current = false; try { recRef.current?.stop(); } catch { /* gone */ } }, []);

  // The textarea also grows when text arrives by voice, not just by typing.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  async function openBrief() {
    setBriefOpen(true); setBriefBusy(true);
    const { data } = await supabase.functions.invoke("sales-coach-chat", { body: { get_brief: true } });
    setBrief(data?.brief ?? "");
    setBriefMeta({ edited_by_user: !!data?.edited_by_user, updated_at: data?.updated_at ?? null });
    setBriefBusy(false);
  }

  async function saveBrief() {
    setBriefBusy(true);
    const { data, error } = await supabase.functions.invoke("sales-coach-chat", { body: { set_brief: brief } });
    setBriefBusy(false);
    if (error || data?.error) {
      toast({ title: "Couldn't save the brief", description: data?.error ?? error?.message, variant: "destructive" });
      return;
    }
    setBriefOpen(false);
    toast({ title: "Brief saved", description: "The Director will use this from its next reply." });
  }

  function newThread() {
    setThreadId(null); setMsgs([]); setActions([]); setPicker(false);
    taRef.current?.focus();
  }

  return (
    <AdminLayout panel panelClassName="ssr-panel--sales">
      <div className="mb-8">
        <Link to="/admin/sales" className="inline-flex items-center gap-2 text-xs text-white/40 hover:text-[#ecd39c]">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />Sales
        </Link>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold text-[#ecd39c]">Director</span>
          </div>
          <div className="relative flex items-center gap-5">
            <button onClick={openBrief} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c]">
              <Brain className="h-3 w-3" strokeWidth={1.5} />Brief
            </button>
            {threads.length > 0 && (
              <button onClick={() => setPicker((p) => !p)} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c]">
                <MessageSquare className="h-3 w-3" strokeWidth={1.5} />History
              </button>
            )}
            <button onClick={newThread} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
              <Plus className="h-3 w-3" strokeWidth={1.5} />New
            </button>
            {picker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPicker(false)} />
                <div className="absolute right-0 top-7 z-50 w-72 overflow-hidden rounded-md border border-white/10 bg-[#1a1013] shadow-2xl">
                  {threads.map((t) => (
                    <button key={t.id} onClick={() => { loadThread(t.id); setPicker(false); }}
                      className={`block w-full truncate px-4 py-2.5 text-left text-xs hover:bg-white/[0.05] ${t.id === threadId ? "text-[#ecd39c]" : "text-white/60"}`}>
                      {t.title || "Untitled"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm text-recessive">
          Ask it anything about the pipeline, or point it at a company to research. It logs calls and adds prospects on its own — stage, value and outcome come back for you to confirm.
        </p>
      </div>

      <section className="ssr-zone mb-4">
        {/* Bounded to the viewport rather than growing with the conversation:
            the message list scrolls inside, so the composer is always on screen
            and the page itself never scrolls away from it. */}
        <div className="ssr-tile flex h-[calc(100vh-236px)] min-h-[420px] flex-col">
          {/* ── Conversation ─────────────────────────────────────────────── */}
          <div className="flex-1 space-y-7 overflow-y-auto px-6 py-7">
            {booting ? (
              <div className="flex justify-center py-16"><BrandLoader size="sm" /></div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center">
                <p className="font-serif text-lg text-white/70">What are we working on?</p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {["What's gone cold?", "How's the pipeline?", "What should I do today?", "Research a prospect for me"].map((s) => (
                    <button key={s} onClick={() => { setInput(s); taRef.current?.focus(); }}
                      className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-white/50 hover:border-[#C9A96A]/40 hover:text-[#ecd39c]">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              items.map((it) =>
                it.who === "user" ? (
                  <div key={it.id} className="flex justify-end">
                    <p className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-white/[0.06] px-4 py-2.5 text-sm text-strong">
                      {it.text}
                    </p>
                  </div>
                ) : (
                  <div key={it.id} className="max-w-[85%]">
                    {it.tools.length > 0 && (
                      <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-white/25">
                        {[...new Set(it.tools)].map((t) => TOOL_LABEL[t] ?? t).join(" · ")}
                      </p>
                    )}
                    {it.text && (
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-strong">{it.text}</p>
                    )}
                    {it.sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <span className="text-[10px] uppercase tracking-[0.16em] text-white/25">From the web</span>
                        {it.sources.map((sc) => (
                          <a key={sc.url} href={sc.url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex max-w-[280px] items-center gap-1 truncate text-xs text-white/40 underline decoration-white/15 underline-offset-2 hover:text-[#ecd39c]">
                            <LinkIcon className="h-3 w-3 shrink-0" strokeWidth={1.5} />{sc.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )
            )}

            {thinking && (
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/30">
                <span className="h-1 w-1 animate-pulse rounded-full bg-[#C9A96A]" />Thinking
              </div>
            )}

            {/* ── Gated changes: the only way stage/value/outcome ever moves ── */}
            {pending.map((a) => (
              <div key={a.id} className="rounded-lg border border-[#C9A96A]/25 bg-[#C9A96A]/[0.04] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#C9A96A]">Needs your confirmation</p>
                <p className="mt-2 text-sm text-strong">
                  <span className="font-medium">{leadNames[a.lead_id] ?? "Lead"}</span>
                  <span className="text-white/40"> — {KIND_LABEL[a.kind] ?? a.kind}</span>
                </p>
                <p className="mt-1 text-sm tabular-nums text-white/70">
                  {prettyValue(a.kind, a.from_value)}
                  <span className="mx-2 text-white/30">→</span>
                  <span className="text-[#ecd39c]">{prettyValue(a.kind, a.to_value)}</span>
                </p>
                {a.reason && <p className="mt-2 text-xs italic text-recessive">{a.reason}</p>}
                <div className="mt-4 flex items-center gap-5">
                  <button onClick={() => resolve(a, "confirm")}
                    className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
                    <Check className="h-3 w-3" strokeWidth={2} />Confirm
                  </button>
                  <button onClick={() => resolve(a, "decline")}
                    className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/35 hover:text-white/70">
                    <X className="h-3 w-3" strokeWidth={2} />Dismiss
                  </button>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* ── Composer ───────────────────────────────────────────────────── */}
          <div className="border-t border-white/[0.07] px-6 py-4">
            <div className="flex items-end gap-3">
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Just had a call with…"
                className="max-h-[200px] flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-strong placeholder:text-white/25 focus:outline-none"
              />
              {SpeechCtor && (
                <button
                  onClick={startVoice}
                  aria-label={listening ? "Stop dictating" : "Dictate"}
                  aria-pressed={listening}
                  title={listening ? "Stop dictating" : "Dictate"}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    listening
                      ? "border-[#F0544C]/50 bg-[#F0544C]/10 text-[#F0544C]"
                      : "border-white/10 text-white/40 hover:border-[#C9A96A]/40 hover:text-[#ecd39c]"
                  }`}
                >
                  {listening && <span className="absolute inset-0 animate-ping rounded-full bg-[#F0544C]/15" />}
                  {listening ? <MicOff className="relative h-4 w-4" strokeWidth={1.75} /> : <Mic className="relative h-4 w-4" strokeWidth={1.75} />}
                </button>
              )}
              <button
                onClick={send}
                disabled={!input.trim() || thinking}
                aria-label="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C9A96A] text-[#1a1013] transition-opacity disabled:opacity-25"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            {listening && (
              <p className="mt-2 text-xs italic text-white/30">
                {interim || "Listening…"}
              </p>
            )}
            <p className="mt-2 text-[10px] text-white/20">
              {listening
                ? "Speak — it types as you go. Tap the mic to stop, Enter to send."
                : "Enter to send · Shift + Enter for a new line"}
            </p>
          </div>
        </div>
      </section>
      {/* ── Standing brief ─────────────────────────────────────────────────
          What the Director carries between conversations. Visible and editable
          on purpose: memory that shapes every future answer shouldn't be
          something Fred can only infer from behaviour. */}
      {briefOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6" style={{ pointerEvents: "auto" }}>
          <div className="absolute inset-0 bg-black/70" onClick={() => setBriefOpen(false)} />
          <div className="relative w-full max-w-2xl overflow-hidden rounded-lg border border-white/10 bg-[#1a1013] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-px w-6 bg-gold-muted" />
                <h2 className="text-label">What the Director knows</h2>
              </div>
              <button onClick={() => setBriefOpen(false)} className="text-white/35 hover:text-white/70"><X className="h-4 w-4" strokeWidth={1.5} /></button>
            </div>

            <div className="px-6 py-5">
              <p className="mb-4 text-xs leading-relaxed text-recessive">
                Carried into every conversation. It writes this itself as you talk, and you can correct it —
                anything you change here is treated as deliberate. It holds no stages, values or totals:
                those are read live each time, so they can never go stale here.
              </p>
              {briefBusy && !brief ? (
                <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
              ) : (
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value.slice(0, 2400))}
                  rows={14}
                  placeholder="Nothing yet — it fills in as you use it."
                  className="w-full resize-none rounded-md border border-white/10 bg-black/25 px-4 py-3 text-sm leading-relaxed text-strong placeholder:text-white/25 focus:border-[#C9A96A]/40 focus:outline-none"
                />
              )}
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[10px] text-white/25">
                  {brief.length}/2400{briefMeta?.edited_by_user ? " · edited by you" : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-5 border-t border-white/[0.07] px-6 py-4">
              <button onClick={() => setBriefOpen(false)} className="text-[10px] uppercase tracking-[0.16em] text-white/35 hover:text-white/70">Cancel</button>
              <button onClick={saveBrief} disabled={briefBusy}
                className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c] disabled:opacity-40">
                <Check className="h-3 w-3" strokeWidth={2} />Save
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
