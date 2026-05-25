import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Share, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Branded "install to home screen" prompt for the PWA.
 *
 * Strictly additive UI chrome — renders nothing until the client is signed in,
 * has spent at least 30s in the portal, and the browser has signalled install
 * eligibility. Dismissal is sticky (localStorage) so the banner never nags.
 *
 * Two paths:
 * - Chromium/Edge/Android: captures the `beforeinstallprompt` event and offers
 *   a native [Install] button.
 * - iOS Safari: `beforeinstallprompt` is unsupported, so we show manual
 *   "Add to Home Screen" instructions instead.
 */

const DISMISS_KEY = "pwa-prompt-dismissed";
const SHOW_DELAY_MS = 30_000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Already running as an installed standalone app — never prompt. */
function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari exposes this non-standard flag when launched from home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS devices (no beforeinstallprompt support). */
function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(window.navigator.userAgent);
}

export function PWAInstallPrompt() {
  const { user } = useAuth();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [delayPassed, setDelayPassed] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [installed, setInstalled] = useState(() => isStandalone());

  // iOS Safari has no beforeinstallprompt — eligibility is purely heuristic.
  const iosEligible = isIOS() && !installed;

  // Capture the deferred install prompt and listen for completed installs.
  useEffect(() => {
    if (installed) return;

    const onBeforeInstall = (e: Event) => {
      // Stop Chrome's mini-infobar; we surface our own branded prompt instead.
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed]);

  // Start the 30s dwell timer only once the client is actually signed in.
  useEffect(() => {
    if (!user || dismissed || installed) return;
    const t = window.setTimeout(() => setDelayPassed(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [user, dismissed, installed]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The prompt can only be used once; drop it either way.
    setDeferredPrompt(null);
    if (outcome === "dismissed") handleDismiss();
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* localStorage unavailable — fall back to in-session dismissal */
    }
    setDismissed(true);
  };

  const visible =
    !!user &&
    !dismissed &&
    !installed &&
    delayPassed &&
    (deferredPrompt !== null || iosEligible);

  // iOS gets manual instructions; everyone else gets the native install button.
  const showIosVariant = iosEligible && !deferredPrompt;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 sm:inset-x-auto sm:right-0 sm:justify-end sm:px-6"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
          role="dialog"
          aria-label="Install Silvershadow portal"
        >
          <div
            className="glass-pill pointer-events-auto relative w-full max-w-sm p-5"
            style={{ borderRadius: 4, borderColor: "hsl(var(--gold) / 0.4)" }}
          >
            <button
              onClick={handleDismiss}
              aria-label="Dismiss"
              className="absolute right-3 top-3 text-foreground/40 transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>

            <div className="flex items-center gap-2 pr-6">
              {showIosVariant ? (
                <Share className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
              ) : (
                <Download className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
              )}
              <span className="font-sans text-[9px] uppercase tracking-[0.28em] text-foreground/40">
                Install
              </span>
            </div>

            {showIosVariant ? (
              <p className="mt-3 font-sans text-[13px] leading-relaxed text-foreground/85">
                Tap the share button
                <Share
                  className="mx-1 inline h-3.5 w-3.5 align-text-bottom text-foreground/60"
                  strokeWidth={1.75}
                />
                then choose “Add to Home Screen” for one-tap access.
              </p>
            ) : (
              <p className="mt-3 font-sans text-[13px] leading-relaxed text-foreground/85">
                Add Silvershadow to your home screen for one-tap access.
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={handleDismiss}
                className="font-sans text-[10px] uppercase tracking-[0.26em] text-foreground/40 transition-colors hover:text-foreground"
              >
                Not now
              </button>
              {!showIosVariant && (
                <button
                  onClick={handleInstall}
                  className="bg-gold px-5 py-2 font-sans text-[10px] uppercase tracking-[0.26em] text-background transition-opacity hover:opacity-80"
                  style={{ borderRadius: 2 }}
                >
                  Install
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
