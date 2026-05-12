import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import silvershadowLogo from "@/assets/silvershadow-logo.png";

export default function SetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

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

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-10 animate-fade-in">
        <img
          src={silvershadowLogo}
          alt="Silvershadow Studio"
          className="h-10 w-auto brightness-0 invert-0 dark:invert md:h-12"
        />
      </div>

      <h1
        className="font-serif text-foreground/90 mb-10 text-center animate-fade-in"
        style={{ fontSize: "28px", letterSpacing: "-0.01em", animationDelay: "0.05s" }}
      >
        Welcome to Silvershadow Studio
      </h1>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 animate-fade-in"
        style={{ animationDelay: "0.1s" }}
      >
        <div className="space-y-2">
          <label className="text-label text-muted-foreground">SET YOUR PASSWORD</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-label text-muted-foreground">CONFIRM PASSWORD</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="auth-input"
            required
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button type="submit" disabled={isLoading} className="auth-submit">
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              SETTING UP...
            </span>
          ) : (
            "CONTINUE"
          )}
        </button>
      </form>
    </div>
  );
}
