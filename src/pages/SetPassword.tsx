import { useState, useEffect, useRef } from "react";
import { OnboardingGuide, GUIDE_PASSWORD } from "@/components/OnboardingGuide";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import silvershadowLogo from "@/assets/silvershadow-logo.png";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { logActivity } from "@/lib/activityLog";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "Arial, sans-serif",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  opacity: 0.5,
  marginBottom: "16px",
};

export default function SetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  // Strict-mode-safe single-fire guard for the invite_opened activity event.
  const inviteOpenedLoggedRef = useRef(false);

  // Detect Supabase error params embedded in the URL hash (e.g. expired magic link).
  // Supabase appends these before the JS loads, so reading window.location.hash is safe.
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const urlErrorCode = hashParams.get("error_code");
  const urlError = hashParams.get("error");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setSessionReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Log invite_opened once per mount, after a session is established by the
  // magic-link verify. Best-effort — never blocks the form.
  useEffect(() => {
    if (!sessionReady || inviteOpenedLoggedRef.current) return;
    inviteOpenedLoggedRef.current = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, full_name")
          .eq("user_id", user.id)
          .maybeSingle();
        const name =
          [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
          profile?.full_name ||
          user.email ||
          "Client";
        await logActivity({
          action: "invite_opened",
          actorRole: "client",
          description: `${name} opened invitation link`,
        });
      } catch {
        // best-effort
      }
    })();
  }, [sessionReady]);

  // Only success was ever logged, so a person who bounced off this screen left
  // no trace of why — which is exactly what happened to the first freelancer to
  // hit it. Failures are now recorded with their reason.
  const logFailure = (reason: string) =>
    logActivity({ action: "password_set_failed", description: `Could not set password — ${reason}` })
      .catch(() => { /* best-effort; never block the form */ });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      logFailure("shorter than 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      logFailure("the two entries didn't match");
      return;
    }
    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await logActivity({ action: "password_set", description: "Set initial password" });

      // A team member has no agreement to sign — /sign-agreement renders them a
      // page saying it's for project and partnership clients. It only hasn't
      // stranded anyone because a downstream guard happens to bounce them to
      // /onboarding; that is working by accident, so send them there directly.
      const { data: { user } } = await supabase.auth.getUser();
      let isTeam = false;
      if (user) {
        const { data: member } = await supabase
          .from("account_members")
          .select("accounts(account_type)")
          .eq("user_id", user.id)
          .maybeSingle();
        isTeam = (member as { accounts?: { account_type?: string } } | null)?.accounts?.account_type === "team";
      }
      navigate(isTeam ? "/onboarding" : "/sign-agreement");
    } catch (err: any) {
      const reason = err?.message || "the server rejected it";
      setError(err.message || "Failed to set password. Please try again.");
      logFailure(reason);
    } finally {
      setIsLoading(false);
    }
  };

  // Show error immediately — no spinner, no blank screen
  if (urlError || urlErrorCode) {
    const isExpired = urlErrorCode === "otp_expired";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex w-full max-w-[360px] flex-col items-center">
          <div className="animate-fade-in" style={{ marginBottom: "64px" }}>
            <img
              src={silvershadowLogo}
              alt="Silver Shadow Studio"
              className="h-7 w-auto brightness-0 invert-0 dark:invert"
            />
          </div>
          <div className="w-full animate-fade-in text-center" style={{ animationDelay: "0.05s" }}>
            <p className="text-sm text-muted-foreground leading-relaxed mb-8">
              {isExpired
                ? "This invitation link has expired. Please contact Silver Shadow Studio to receive a new one."
                : "This link is invalid. Please contact Silver Shadow Studio."}
            </p>
            <button onClick={() => navigate("/")} className="sp-submit">
              Return to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <BrandLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {/* Only once the link has actually established a session — a guide over an
          expired-link error would be telling them to do something they can't. */}
      <OnboardingGuide copy={GUIDE_PASSWORD} when={sessionReady && !urlError && !urlErrorCode} />
      <div className="flex w-full max-w-[360px] flex-col items-center">
      <div className="animate-fade-in" style={{ marginBottom: "64px" }}>
        <img
          src={silvershadowLogo}
          alt="Silver Shadow Studio"
          className="h-7 w-auto brightness-0 invert-0 dark:invert"
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full animate-fade-in"
        style={{ animationDelay: "0.05s" }}
      >
        <div style={{ marginBottom: "32px" }}>
          <label style={labelStyle}>Set your password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="sp-input"
            required
          />
        </div>

        <div style={{ marginBottom: "32px" }}>
          <label style={labelStyle}>Confirm password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="sp-input"
            required
          />
        </div>

        {error && <p className="mb-4 text-xs text-destructive">{error}</p>}

        <button type="submit" disabled={isLoading} className="sp-submit">
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <BrandLoader size="sm" />
              SETTING UP...
            </span>
          ) : (
            "CONTINUE"
          )}
        </button>
      </form>
      </div>
    </div>
  );
}
