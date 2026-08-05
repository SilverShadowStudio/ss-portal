import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, MessageSquare } from "lucide-react";
import { DirectorChat } from "@/components/admin/sales/DirectorChat";

// The Director as a slide-over.
//
// It's most useful while you're looking at something else — a lead, a P&L, a
// team member — so it comes to you rather than making you leave the page to ask
// about the page. The full-page version still exists and holds the same
// conversation; "Open in full" hands off to it.

/** How much room the layout gives up when the Director is open. */
export const DIRECTOR_WIDTH = 520;

// One opener for the whole portal, so any page can summon the panel without
// navigating away from itself — which was the point of having it.
const DirectorCtx = createContext<{ open: () => void; close: () => void; isOpen: boolean }>({
  open: () => {}, close: () => {}, isOpen: false,
});
export const useDirector = () => useContext(DirectorCtx);

export function DirectorProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);
  return <DirectorCtx.Provider value={value}>{children}</DirectorCtx.Provider>;
}

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
    // No backdrop and no full-screen wrapper: the page beside it stays live and
    // clickable. This is a panel the layout makes room for, not something
    // covering the page — so you can read a lead and ask about it at once.
    <aside
      role="complementary"
      aria-label="Sales Director"
      className="ssr-panel ssr-panel--sales fixed flex flex-col overflow-hidden"
      style={{
        // Fixed to the viewport, not the document: it ends before the bottom of
        // the screen and stays put while the page beside it scrolls.
        top: 16, bottom: 16, left: 0,
        width: DIRECTOR_WIDTH,
        maxWidth: "calc(100vw - 32px)",
        zIndex: 60,
        borderRadius: 22,
        transform: shown ? "translateX(0)" : "translateX(-100%)",
        opacity: shown ? 1 : 0,
        transition: "transform var(--duration-deliberate) var(--ease-signature), opacity 240ms ease",
        boxShadow: "inset -1px 0 0 rgba(201,169,106,0.20), 24px 0 60px -30px rgba(0,0,0,0.8)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 h-16 w-[3px] -translate-y-1/2 rounded-full"
        style={{ background: "linear-gradient(180deg, transparent, rgba(201,169,106,0.45), transparent)" }}
      />

      <button
        onClick={onClose}
        aria-label="Close the Director"
        className="absolute right-5 top-5 z-10 text-white/35 transition-colors hover:text-white/80"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-6">
        <DirectorChat variant="sheet" onClose={onClose} />
      </div>
    </aside>,
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
