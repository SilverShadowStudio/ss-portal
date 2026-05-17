import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import silvershadowLogo from "@/assets/silvershadow-logo.png";
import AuthThemeToggle from "@/components/AuthThemeToggle";
import { BrandLoader } from "@/components/ui/BrandLoader";

const passwordSchema = z
  .object({
    password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(100),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  useEffect(() => {
    let isMounted = true;

    const clearRecoveryParams = () => {
      const cleanUrl = `${window.location.origin}${window.location.pathname}`;
      window.history.replaceState({}, document.title, cleanUrl);
    };

    const initializeRecoverySession = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash") ?? hashParams.get("token_hash");
      const recoveryType = (searchParams.get("type") ?? hashParams.get("type")) as EmailOtpType | null;
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && recoveryType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: recoveryType,
          });
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        setHasSession(Boolean(session));

        if (session) {
          clearRecoveryParams();
        }
      } catch (err: any) {
        if (!isMounted) return;

        toast({
          title: "Invalid Reset Link",
          description: err?.message ?? "This password reset link is invalid or has expired.",
          variant: "destructive",
        });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || session) {
        setHasSession(Boolean(session));

        if (session) {
          clearRecoveryParams();
        }
      }
    });

    initializeRecoverySession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = passwordSchema.safeParse({ password, confirm });
    if (!result.success) {
      const fieldErrors: typeof errors = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as keyof typeof errors;
        fieldErrors[field] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast({
        title: "Password Updated",
        description: "Your password has been changed. Please sign in.",
      });

      await supabase.auth.signOut();
      navigate("/auth");
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message ?? "Could not update password.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <AuthThemeToggle />
      <div className="mb-10 animate-fade-in">
        <img
          src={silvershadowLogo}
          alt="Silvershadow Studio"
          className="h-10 w-auto brightness-0 invert-0 dark:invert md:h-12"
        />
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="text-center">
          <h1 className="text-label-gold mb-2">RESET PASSWORD</h1>
          <p className="text-sm text-muted-foreground">
            {hasSession ? "Choose a new password for your account." : "Validating reset link…"}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-label text-muted-foreground">NEW PASSWORD</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-smooth"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
        </div>

        <div className="space-y-2">
          <label className="text-label text-muted-foreground">CONFIRM PASSWORD</label>
          <input
            type={showPassword ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="auth-input"
            required
          />
          {errors.confirm && <p className="text-xs text-destructive">{errors.confirm}</p>}
        </div>

        <button
          type="submit"
          disabled={isLoading || !hasSession}
          className="auth-submit"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <BrandLoader size="sm" />
              UPDATING...
            </span>
          ) : (
            "UPDATE PASSWORD"
          )}
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="text-label text-muted-foreground transition-smooth hover:text-foreground"
          >
            BACK TO LOGIN
          </button>
        </div>
      </form>
    </div>
  );
}