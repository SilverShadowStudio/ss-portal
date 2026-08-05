import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// The instruction card that opens on landing, once per step.
//
// Shukrullo opened his invitation three times, never got past the password
// screen, and left no idea why. Every one of these screens assumed the person
// arriving already knew what it wanted from them. These say it plainly, before
// they start, and go away for good once clicked.

export interface GuideCopy {
  /** Stable key — one dismissal per person per step. */
  step: string;
  eyebrow: string;
  title: string;
  body: string;
  /** Short lines under the body. May contain <b> for emphasis. */
  points?: string[];
  note?: string;
  cta: string;
}

const seenKey = (userId: string | undefined, step: string) => `ssr:guide:${userId ?? "anon"}:${step}`;

export function OnboardingGuide({ copy, when = true }: { copy: GuideCopy; when?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!when) return;
    // Per device rather than per account: being reminded again on a new phone
    // is a small kindness, not a bug.
    try {
      if (localStorage.getItem(seenKey(user?.id, copy.step))) return;
    } catch { /* private browsing — show it, it's only a card */ }
    const t = setTimeout(() => setOpen(true), 260);   // let the page paint first
    return () => clearTimeout(t);
  }, [when, user?.id, copy.step]);

  function dismiss() {
    try { localStorage.setItem(seenKey(user?.id, copy.step), new Date().toISOString()); } catch { /* fine */ }
    setOpen(false);
  }

  if (!open) return null;

  return createPortal(
    // No click-outside and no ✕ — the button is the only way out, so it can't
    // be dismissed by accident before it's been read.
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-6" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-[3px] animate-in fade-in-0 duration-300" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`guide-${copy.step}`}
        className="relative w-full max-w-[440px] rounded-[14px] border border-[#C9A96A]/22 bg-[#1a1013] p-7 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-300"
        style={{ boxShadow: "0 30px 70px -24px rgba(0,0,0,0.85)" }}
      >
        <p className="mb-3 text-[9px] uppercase tracking-[0.22em] text-[#C9A96A]">{copy.eyebrow}</p>
        <h2 id={`guide-${copy.step}`} className="mb-3 text-xl font-normal leading-snug tracking-[-0.01em] text-strong">
          {copy.title}
        </h2>
        <p className="mb-4 text-[13.5px] leading-relaxed text-white/72" dangerouslySetInnerHTML={{ __html: copy.body }} />

        {copy.points && copy.points.length > 0 && (
          <ul className="mb-4 list-none border-l border-[#C9A96A]/28 p-0">
            {copy.points.map((pt) => (
              <li key={pt} className="pb-2.5 pl-3.5 text-[12.5px] leading-relaxed text-white/62 last:pb-0"
                  dangerouslySetInnerHTML={{ __html: pt }} />
            ))}
          </ul>
        )}

        {copy.note && <p className="mb-5 text-[11.5px] italic leading-relaxed text-white/34">{copy.note}</p>}

        <button
          onClick={dismiss}
          autoFocus
          className="w-full rounded-lg bg-[#C9A96A] py-3 text-[10px] font-medium uppercase tracking-[0.2em] text-[#1a1013] transition-colors hover:bg-[#ecd39c]"
        >
          {copy.cta}
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── The three, as signed off ────────────────────────────────────────────────

export const GUIDE_PASSWORD: GuideCopy = {
  step: "password",
  eyebrow: "Step 1 of 2",
  title: "Choose your password",
  body:
    "This is the only thing between you and your account. Pick a password of <b>six characters or more</b> — no symbols or capitals required — then type it twice and press Set password.",
  points: [
    "You'll sign in with this and your email address from now on.",
    "If the screen refuses you, your invitation link has expired — ask Fred for a new one rather than retrying.",
  ],
  note: "Takes under a minute.",
  cta: "Got it",
};

export const GUIDE_DETAILS: GuideCopy = {
  step: "details",
  eyebrow: "Step 2 of 2",
  title: "Tell us who you are",
  body: "About five minutes, once. This is what lets the studio pay you correctly and raise your invoices for you.",
  points: [
    "Your name and address",
    "The country you work from — this decides how VAT is handled",
    "Your day rate and the currency you're paid in",
    "The bank account we pay into",
    "The self-billing agreement, which is what lets us issue your invoices so you never have to",
  ],
  note: "Nothing here leaves the studio. You can change any of it later under Account.",
  cta: "Start",
};

/** Role-aware: a modeller's worked days aren't dateable in Airtable, so the
 *  calendar line would be a promise the portal can't keep. */
function welcomeGuide(firstName: string | null, role: string | null): GuideCopy {
  const isModeller = (role ?? "").toLowerCase().includes("model");
  return {
    step: "welcome",
    eyebrow: "You're in",
    title: firstName ? `Welcome, ${firstName}` : "Welcome",
    body:
      "Everything is on the left. Your work and money come straight from the studio's own records, so there's nothing for you to fill in.",
    points: [
      "<b>Earnings</b> — every month you've worked, what you were paid, and your invoices",
      isModeller
        ? "<b>Calendar</b> — mark yourself unavailable so we know when not to book you"
        : "<b>Calendar</b> — your days, and where you can mark yourself unavailable",
      "<b>Documents</b> — your agreement and anything else we've sent you",
    ],
    note: "If something looks missing or wrong, tell Fred — don't assume it'll correct itself.",
    cta: "Take a look",
  };
}

/** The welcome card, which needs to know who it's greeting. Fetches the
 *  profile itself so the layout mounting it doesn't have to care. */
export function WelcomeGuide() {
  const { user } = useAuth();
  const [who, setWho] = useState<{ first: string | null; role: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("freelancer_profiles")
      .select("first_name, role")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setWho({ first: data?.first_name ?? null, role: data?.role ?? null });
      });
    return () => { cancelled = true; };
  }, [user]);

  // Wait for the name: greeting someone by no name, then correcting it a beat
  // later, is worse than a short pause.
  if (!who) return null;
  return <OnboardingGuide copy={welcomeGuide(who.first, who.role)} />;
}
