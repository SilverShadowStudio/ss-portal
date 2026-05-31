import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * PWA install plumbing.
 *
 * Captures the browser's `beforeinstallprompt` event globally and holds it
 * silently — the default browser/Chromium mini-infobar is suppressed in BOTH
 * portals. No floating prompt is ever shown. The captured event is exposed via
 * `usePWAInstall()` so the two deliberate entry points (the client onboarding
 * moment and the client Settings install section) can trigger it on the user's
 * terms. The studio portal simply never consumes it.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Already running as an installed standalone app. */
function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari exposes this non-standard flag when launched from home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

interface PWAInstallContextValue {
  /** A captured install prompt is available to trigger right now. */
  canInstall: boolean;
  /** The app is running as / has been installed as a standalone PWA. */
  isInstalled: boolean;
  /** Trigger the native install confirmation. Returns the user's choice, or
   *  null when no prompt was available. The prompt can only be used once. */
  promptInstall: () => Promise<"accepted" | "dismissed" | null>;
}

const PWAInstallContext = createContext<PWAInstallContextValue | undefined>(undefined);

export function PWAInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Stop the browser's default prompt; we surface install on our terms.
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
  }, []);

  const promptInstall = async (): Promise<"accepted" | "dismissed" | null> => {
    if (!deferredPrompt) return null;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The prompt can only be used once; drop it either way.
    setDeferredPrompt(null);
    return outcome;
  };

  return (
    <PWAInstallContext.Provider
      value={{ canInstall: deferredPrompt !== null && !installed, isInstalled: installed, promptInstall }}
    >
      {children}
    </PWAInstallContext.Provider>
  );
}

export function usePWAInstall(): PWAInstallContextValue {
  const ctx = useContext(PWAInstallContext);
  if (!ctx) {
    throw new Error("usePWAInstall must be used within a PWAInstallProvider");
  }
  return ctx;
}
