import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Mic, MicOff, ArrowUp, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDictation } from "@/hooks/useDictation";

// The assistant, such as it is.
//
// Deliberately not a chat: no thread, no history, nothing to come back to. Tap,
// say one line, press enter, forget it. The reminder is the whole artefact —
// giving it a conversation would make it something you have to tend.

interface Reminder { id: string; body: string; due_at: string }

/** Capture. Opens on the bubble, closes the moment it's taken. */
function CaptureSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Reminder | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const dictation = useDictation({
    onPhrase: (p) => setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")} ` : "") + p),
    onError: setError,
  });

  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    dictation.stop();
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke("pa-capture", {
      body: { text: t, now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    setBusy(false);
    if (err || data?.error) { setError(data?.error ?? err?.message ?? "Couldn't take that."); return; }
    // Confirm briefly, then get out of the way — this is fire-and-forget.
    setSaved(data as Reminder);
    setTimeout(onClose, 1400);
  }

  const when = saved
    ? new Date(saved.due_at).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : null;

  return createPortal(
    <div className="fixed inset-0 z-[190] flex items-end justify-end p-6" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in-0 duration-150" onClick={onClose} />

      <div className="relative mb-16 w-full max-w-[420px] rounded-xl border border-[#C9A96A]/22 bg-[#1a1013] p-5 shadow-2xl animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
        {saved ? (
          <div className="flex items-start gap-3 py-1">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8FD9A8]" strokeWidth={2} />
            <div className="min-w-0">
              <p className="text-sm text-strong">{saved.body}</p>
              <p className="mt-1 text-xs text-white/40">{when}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <textarea
                ref={taRef}
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Remind me tomorrow at 9:45 — did the mike@ email bounce back"
                className="max-h-[140px] flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-strong placeholder:text-white/25 focus:outline-none"
              />
              {dictation.supported && (
                <button
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? "Stop" : "Dictate"}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    dictation.listening
                      ? "border-[#F0544C]/50 bg-[#F0544C]/10 text-[#F0544C]"
                      : "border-white/12 text-white/40 hover:border-[#C9A96A]/40 hover:text-[#ecd39c]"
                  }`}
                >
                  {dictation.listening && <span className="absolute inset-0 animate-ping rounded-full bg-[#F0544C]/15" />}
                  {dictation.listening ? <MicOff className="relative h-3.5 w-3.5" strokeWidth={1.75} /> : <Mic className="relative h-3.5 w-3.5" strokeWidth={1.75} />}
                </button>
              )}
              <button
                onClick={send}
                disabled={!text.trim() || busy}
                aria-label="Remember this"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C9A96A] text-[#1a1013] transition-opacity disabled:opacity-25"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>

            {dictation.listening && (
              <p className="mt-2 text-xs italic text-white/30">{dictation.interim || "Listening…"}</p>
            )}
            {error && <p className="mt-2 text-xs text-[#F0544C]">{error}</p>}
            <p className="mt-2 text-[10px] text-white/20">Enter to save · it closes itself</p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The alarm. Fills the screen and only the acknowledgement stops it. */
function ReminderAlarm({ reminder, onAck }: { reminder: Reminder; onAck: () => void }) {
  const due = new Date(reminder.due_at).toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit" });
  return createPortal(
    // No backdrop click, no Escape, no cross. Fred asked for something that
    // doesn't go until he clicks the one place — a reminder you can wave away
    // by accident is a reminder you'll miss.
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-6" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md animate-in fade-in-0 duration-300" />
      <div className="relative w-full max-w-xl rounded-2xl border border-[#C9A96A]/30 bg-[#1a1013] px-10 py-12 text-center shadow-2xl animate-in fade-in-0 zoom-in-95 duration-300">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[#C9A96A]">{due}</p>
        <p className="mx-auto mt-6 max-w-lg text-2xl font-normal leading-snug text-strong">{reminder.body}</p>
        <button
          onClick={onAck}
          autoFocus
          className="mt-10 rounded-lg bg-[#C9A96A] px-10 py-3.5 text-[10px] font-medium uppercase tracking-[0.22em] text-[#1a1013] transition-colors hover:bg-[#ecd39c]"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function PocketAssistant() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState<Reminder | null>(null);

  const poll = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("reminders")
      .select("id, body, due_at")
      .lte("due_at", new Date().toISOString())
      .is("acknowledged_at", null)
      .is("cancelled_at", null)
      .order("due_at")
      .limit(1);
    setDue((data?.[0] as Reminder) ?? null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    poll();
    // Half a minute: fine enough that 9:45 feels like 9:45, cheap enough to
    // leave running all day.
    const t = setInterval(poll, 30_000);
    return () => clearInterval(t);
  }, [user, poll]);

  async function acknowledge() {
    if (!due) return;
    await supabase.from("reminders").update({ acknowledged_at: new Date().toISOString() }).eq("id", due.id);
    setDue(null);
    poll();   // another may be waiting behind it
  }

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Remember something"
        aria-label="Remember something"
        className="fixed bottom-6 right-6 z-[120] flex h-12 w-12 items-center justify-center rounded-full border border-[#C9A96A]/30 bg-[#1e1419]/90 text-[#C9A96A] shadow-2xl backdrop-blur transition-all hover:border-[#C9A96A]/60 hover:text-[#ecd39c]"
        style={{ boxShadow: "0 18px 40px -14px rgba(0,0,0,0.75)" }}
      >
        <MessageSquare className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {open && <CaptureSheet onClose={() => setOpen(false)} />}
      {due && <ReminderAlarm reminder={due} onAck={acknowledge} />}
    </>
  );
}
