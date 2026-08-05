import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, MessageSquare } from "lucide-react";
import { DirectorChat } from "@/components/admin/sales/DirectorChat";

// The Director as a slide-over.
//
// It's most useful while you're looking at something else — a lead, a P&L, a
// team member — so it comes to you rather than making you leave the page to ask
// about the page. The full-page version still exists and holds the same
// conversation; "Open in full" hands off to it.

export function DirectorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Kept mounted through the closing animation so it slides out rather than
  // vanishing, and unmounted after so the chat isn't polling behind your back.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const t = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(t);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[160]" style={{ pointerEvents: "auto" }}>
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300"
        style={{ opacity: shown ? 1 : 0 }}
      />

      <aside
        role="dialog"
        aria-label="Sales Director"
        className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col ssr-panel ssr-panel--sales shadow-2xl transition-transform duration-300 ease-out"
        style={{
          transform: shown ? "translateX(0)" : "translateX(100%)",
          // A hairline of gold down the join, so the panel reads as arriving
          // over the page rather than being cut out of it.
          boxShadow: "inset 1px 0 0 rgba(201,169,106,0.22), -24px 0 60px -20px rgba(0,0,0,0.7)",
          borderRadius: 0,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close the Director"
          className="absolute right-5 top-5 z-10 text-white/35 transition-colors hover:text-white/80"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>

        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-6">
          <DirectorChat variant="sheet" onClose={onClose} />
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/** The way in, from anywhere in the portal. */
export function DirectorLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Ask the Director"
      className="group fixed bottom-6 right-6 z-[120] flex h-12 items-center gap-2.5 rounded-full border border-[#C9A96A]/30 bg-[#1e1419]/90 px-5 text-[10px] uppercase tracking-[0.18em] text-[#C9A96A] shadow-2xl backdrop-blur transition-all hover:border-[#C9A96A]/60 hover:text-[#ecd39c]"
      style={{ boxShadow: "0 18px 40px -14px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.02)" }}
    >
      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
      {/* The word appears on approach — at rest it's a mark, not a button
          shouting across every page in the portal. */}
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover:max-w-[90px] group-hover:opacity-100">
        Director
      </span>
    </button>
  );
}
