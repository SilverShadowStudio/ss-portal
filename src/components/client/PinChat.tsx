import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Paperclip, X, FileText, CheckCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  fetchAccountPinColourMap,
  ACCOUNT_PIN_FALLBACK_COLOUR,
} from "@/lib/accountPinColours";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Per-pin chat panel.
 *
 * Designed to feel like a refined Miro/WhatsApp hybrid: bubbles, enter-to-send,
 * shift+enter for newline, paperclip for files/images. Lives over the lightbox
 * as a dark glass column anchored to the right edge.
 */

interface Attachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}

interface PinMessage {
  id: string;
  pin_id: string;
  user_id: string;
  body: string | null;
  attachments: Attachment[];
  created_at: string;
}

interface PinChatProps {
  pinId: string;
  pinNumber: number;
  currentUserId: string | null;
  onClose: () => void;
  onResolve?: () => void;
  canResolve?: boolean;
  onDelete?: () => void | Promise<void>;
  canDelete?: boolean;
  /** Re-anchor the delete-confirm AlertDialog portal to the lightbox /
   *  fullscreen container; defaults to document.body via Radix if unset. */
  portalContainer?: HTMLElement | null;
}

export function PinChat({
  pinId,
  pinNumber,
  currentUserId,
  onClose,
  onResolve,
  canResolve,
  onDelete,
  canDelete,
  portalContainer,
}: PinChatProps) {
  const [messages, setMessages] = useState<PinMessage[]>([]);
  // Per-author initials + assigned colour (Manager gold, Invitee palette),
  // matching the pin/stroke colours on the image.
  const [authorMeta, setAuthorMeta] = useState<
    Record<string, { initials: string; colour: string }>
  >({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  // Autofocus the message input on mount so the user can type immediately
  // when a chat opens (whether just-placed or opening an existing pin).
  // The lightbox's space-to-pan keydown handler has a textarea bail at the
  // top, so typing space here still inserts a space (doesn't arm pan).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from("asset_pin_messages")
      .select("*")
      .eq("pin_id", pinId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Pin messages fetch error:", error);
      return;
    }
    setMessages(
      (data || []).map((m: any) => ({
        ...m,
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
      }))
    );
  }, [pinId]);

  useEffect(() => {
    fetchMessages();
    // Light realtime: subscribe to inserts on this pin so both sides see live updates.
    const channel = supabase
      .channel(`pin-${pinId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "asset_pin_messages",
          filter: `pin_id=eq.${pinId}`,
        },
        () => fetchMessages()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pinId, fetchMessages]);

  // Auto-scroll to bottom whenever messages change.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Resolve initials (profiles) + colour (per-account member ORDER, the same
  // scheme as the on-image pins/strokes) for each message author so the thread
  // mirrors the pin colours exactly.
  useEffect(() => {
    const ids = Array.from(new Set(messages.map((m) => m.user_id))).filter(
      (id) => id && !(id in authorMeta),
    );
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const [{ data: profs }, colourById] = await Promise.all([
        supabase.from("profiles").select("user_id, first_name, last_name, full_name").in("user_id", ids),
        fetchAccountPinColourMap(ids),
      ]);
      if (cancelled) return;
      setAuthorMeta((prev) => {
        const next = { ...prev };
        for (const r of (profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null; full_name: string | null }[]) {
          const first = r.first_name?.trim() ?? "";
          const last = r.last_name?.trim() ?? "";
          let initials = first || last
            ? `${first[0] ?? ""}${last[0] ?? ""}`
            : (r.full_name?.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("") ?? "");
          next[r.user_id] = { initials: (initials || "?").toUpperCase(), colour: colourById[r.user_id] ?? ACCOUNT_PIN_FALLBACK_COLOUR };
        }
        for (const id of ids) if (!(id in next)) next[id] = { initials: "?", colour: colourById[id] ?? ACCOUNT_PIN_FALLBACK_COLOUR };
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [messages, authorMeta]);

  async function uploadAttachments(files: File[]): Promise<Attachment[]> {
    if (!currentUserId || files.length === 0) return [];
    const uploaded: Attachment[] = [];
    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${currentUserId}/${pinId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage
        .from("pin-attachments")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });
      if (error) {
        toast({
          title: "Upload failed",
          description: `${file.name}: ${error.message}`,
          variant: "destructive",
        });
        continue;
      }
      uploaded.push({
        path,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      });
    }
    return uploaded;
  }

  async function handleSend() {
    if (sending) return;
    const body = draft.trim();
    if (!body && pending.length === 0) return;
    if (!currentUserId) return;
    setSending(true);
    try {
      const attachments = await uploadAttachments(pending);
      const { error } = await supabase.from("asset_pin_messages").insert({
        pin_id: pinId,
        user_id: currentUserId,
        body: body || null,
        attachments: attachments as any,
      });
      if (error) throw error;
      setDraft("");
      setPending([]);
      // Realtime will refetch, but call once for instant feedback in case the
      // websocket round-trip is slow.
      fetchMessages();
    } catch (err: any) {
      console.error("Send error:", err);
      toast({
        title: "Couldn't send",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function publicUrlFor(path: string) {
    return supabase.storage.from("pin-attachments").getPublicUrl(path).data
      .publicUrl;
  }

  return (
    <div
      // Stop pointer events from bubbling into the lightbox (no zoom/pan triggers from the panel).
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="flex w-[260px] max-w-[80vw] flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/5 shadow-2xl backdrop-blur-2xl animate-fade-in ring-1 ring-white/5"
      style={{
        // Subtle inner highlight reinforces the glass feel over varied imagery.
        boxShadow:
          "0 12px 40px -12px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1C1A17] text-[10px] font-medium text-gold border border-gold/30">
            {pinNumber}
          </div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-sans">
            {messages.length} msg{messages.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {canResolve && onResolve && (
            <button
              type="button"
              onClick={onResolve}
              className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-gold transition-colors"
              aria-label="Resolve pin"
              title="Resolve pin"
            >
              <CheckCheck size={13} />
            </button>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-rose-400 transition-colors"
              aria-label="Delete pin"
              title="Delete pin"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="max-h-[260px] overflow-y-auto scrollbar-thin px-2.5 py-2 space-y-1.5"
      >
        {messages.length === 0 && (
          <p className="text-center text-[11px] text-white/40 font-sans py-2">
            Start the conversation.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.user_id === currentUserId;
          return (
            <div
              key={m.id}
              className={cn(
                "flex w-full items-end gap-1.5",
                mine ? "justify-end" : "justify-start"
              )}
            >
              {!mine && (
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-medium font-sans text-white"
                  style={{ backgroundColor: authorMeta[m.user_id]?.colour ?? "#B89A6A" }}
                >
                  {authorMeta[m.user_id]?.initials ?? "?"}
                </span>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-xl px-2.5 py-1.5 text-[12px] leading-snug font-sans shadow-sm",
                  mine
                    ? "bg-[#1C1A17] text-gold border border-gold/40 rounded-br-sm"
                    : "bg-white/10 text-white/90 rounded-bl-sm border border-white/10"
                )}
              >
                {m.attachments.length > 0 && (
                  <div className="mb-1 space-y-1">
                    {m.attachments.map((a, i) => {
                      const url = publicUrlFor(a.path);
                      const isImage = a.mime.startsWith("image/");
                      return isImage ? (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-md"
                        >
                          <img
                            src={url}
                            alt={a.name}
                            className="max-h-32 w-auto rounded-md"
                          />
                        </a>
                      ) : (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px]",
                            mine
                              ? "bg-black/15 hover:bg-black/25"
                              : "bg-white/5 hover:bg-white/10"
                          )}
                        >
                          <FileText size={12} className="shrink-0" />
                          <span className="truncate">{a.name}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
                {m.body && (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                )}
                <p
                  className={cn(
                    "mt-0.5 text-[9px] font-sans",
                    mine ? "text-[#1a1308]/55 text-right" : "text-white/35"
                  )}
                >
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              {mine && (
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-medium font-sans text-white"
                  style={{ backgroundColor: authorMeta[m.user_id]?.colour ?? "#B89A6A" }}
                >
                  {authorMeta[m.user_id]?.initials ?? "?"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pending attachments preview */}
      {pending.length > 0 && (
        <div className="border-t border-white/10 px-2 py-1.5 flex flex-wrap gap-1.5">
          {pending.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80 font-sans"
            >
              <FileText size={10} />
              <span className="max-w-[100px] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() =>
                  setPending((prev) => prev.filter((_, j) => j !== i))
                }
                className="rounded-full p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label="Remove attachment"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-white/10 p-1.5">
        <div className="flex items-end gap-1.5 rounded-lg bg-white/[0.06] border border-white/10 px-1.5 py-1 focus-within:border-gold/40 transition-colors">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Attach files"
          >
            <Paperclip size={13} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) setPending((prev) => [...prev, ...files]);
              e.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message"
            rows={1}
            className="flex-1 resize-none bg-transparent py-0.5 text-[12px] text-white/90 placeholder:text-white/30 outline-none font-sans max-h-24"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || (!draft.trim() && pending.length === 0)}
            className={cn(
              "rounded-full p-1 transition-colors",
              draft.trim() || pending.length > 0
                ? "border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
                : "text-white/30"
            )}
            aria-label="Send"
          >
            <Send size={12} />
          </button>
        </div>
      </div>

      {/* Custom delete confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent container={portalContainer ?? undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pin?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete pin #{pinNumber} and its entire
              conversation
              {messages.length > 0
                ? ` (${messages.length} message${messages.length === 1 ? "" : "s"})`
                : ""}
              . This cannot be undone from here, but you'll have a brief
              moment to undo right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                if (!onDelete) return;
                setDeleting(true);
                try {
                  await onDelete();
                  setConfirmOpen(false);
                } finally {
                  setDeleting(false);
                }
              }}
              className="bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500"
            >
              {deleting ? "Deleting…" : "Delete pin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}