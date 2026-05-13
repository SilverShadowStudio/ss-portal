import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import silvershadowLogo from "@/assets/silvershadow-logo.png";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      navigate("/sign-agreement");
    } catch (err: any) {
      setError(err.message || "Failed to set password. Please try again.");
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
              alt="Silvershadow Studio"
              className="h-7 w-auto brightness-0 invert-0 dark:invert"
            />
          </div>
          <div className="w-full animate-fade-in text-center" style={{ animationDelay: "0.05s" }}>
            <p className="text-sm text-muted-foreground leading-relaxed mb-8">
              {isExpired
                ? "This invitation link has expired. Please contact Silvershadow Studio to receive a new one."
                : "This link is invalid. Please contact Silvershadow Studio."}
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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-[360px] flex-col items-center">
      <div className="animate-fade-in" style={{ marginBottom: "64px" }}>
        <img
          src={silvershadowLogo}
          alt="Silvershadow Studio"
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
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
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
