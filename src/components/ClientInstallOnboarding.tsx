import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePWAInstall } from "@/components/PWAInstallPrompt";

/**
 * First-login install moment for the client portal.
 *
 * A single, ceremonial, full-screen step shown once — after a real client
 * login, on top of the dashboard — offering a deliberate install on the
 * user's terms. Desktop only (mobile users discover install through native
 * browser affordances and the Settings page).
 *
 * Gated to show only when: the user is a genuine client (accountType set, not
 * an admin, not ghosting), a real install prompt is available, the app isn't
 * already installed, the viewport is >= 640px, and the client hasn't been
 * onboarded before. The onboarded flag is set the moment the screen appears,
 * so it never returns regardless of which CTA is chosen.
 */

const ONBOARDED_KEY = "silvershadow.client.onboarded";
const GROUND = "#F5F0E8";
const GOLD = "#B89A6A";

function alreadyOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function ClientInstallOnboarding() {
  const { accountType, isGhostMode } = useAuth();
  const { canInstall, isInstalled, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [onboarded, setOnboarded] = useState(() => alreadyOnboarded());
  const [wideEnough, setWideEnough] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 640,
  );

  useEffect(() => {
    const onResize = () => setWideEnough(window.innerWidth >= 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A genuine client login (admins have accountType null; ghosting admins are
  // impersonating and must not trip the client's onboarding flag).
  const isClient = accountType !== null && !isGhostMode;

  const visible =
    isClient && canInstall && !isInstalled && wideEnough && !onboarded && !dismissed;

  // Mark onboarded as soon as the screen is shown — it appears at most once.
  useEffect(() => {
    if (!visible) return;
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* localStorage unavailable — fall back to in-session suppression */
    }
    setOnboarded(true);
  }, [visible]);

  if (!visible) return null;

  const advance = () => setDismissed(true);

  const handleInstall = async () => {
    await promptInstall();
    // Whether accepted or dismissed at the native confirmation, advance.
    advance();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-6"
      style={{ background: GROUND }}
      role="dialog"
      aria-label="Install Silver Shadow Studio portal"
    >
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        <img
          src="/email-assets/silvershadow-wordmark.png"
          alt="Silver Shadow Studio"
          style={{ height: 28, filter: "brightness(0)" }}
        />
        <img
          src="/email-assets/portal-invite-illustration.png"
          alt=""
          aria-hidden="true"
          style={{ height: 160 }}
          className="mt-10"
        />
        <h1
          className="mt-10 font-serif font-normal"
          style={{ fontSize: 28, color: "#1A1814" }}
        >
          Welcome to your portal.
        </h1>
        <p
          className="mt-5 font-serif"
          style={{ fontSize: 15, lineHeight: 1.7, color: "#3A352E" }}
        >
          This portal can be installed on your device for direct access without
          a browser. You can do this now, or later from Settings.
        </p>

        <div className="mt-10 flex flex-col items-center gap-6">
          <button
            type="button"
            onClick={handleInstall}
            className="font-sans uppercase"
            style={{
              fontSize: 11,
              letterSpacing: "0.22em",
              color: "#1A1814",
              paddingBottom: 4,
              borderBottom: `1px solid ${GOLD}`,
            }}
          >
            Install Application
          </button>
          <button
            type="button"
            onClick={advance}
            className="font-sans uppercase"
            style={{ fontSize: 11, letterSpacing: "0.22em", color: "#8A8070" }}
          >
            Continue to Portal
          </button>
        </div>
      </div>
    </div>
  );
}
