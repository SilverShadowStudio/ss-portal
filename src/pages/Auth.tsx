import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import silvershadowLogo from "@/assets/silvershadow-logo.png";
import LoginSplash from "@/components/LoginSplash";

const loginSchema = z.object({
  email: z.string().trim().email({ message: "Invalid email address" }).max(255),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(100),
});

const signUpSchema = loginSchema.extend({
  fullName: z.string().trim().max(100).optional(),
});

export default function Auth() {
  const location = useLocation();
  const prefillEmail = (location.state as { prefillEmail?: string } | null)?.prefillEmail;
  
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState(prefillEmail || "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; fullName?: string }>({});
  const [showSplash, setShowSplash] = useState(false);
  const [redirectPath, setRedirectPath] = useState("/portfolio");
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Check if user is admin and set redirect path
  const checkUserRole = async (userId: string) => {
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();

      if (data?.role === "admin") {
        setRedirectPath("/admin");
      } else {
        setRedirectPath("/portfolio");
      }
    } catch (error) {
      console.error("Error checking user role:", error);
      setRedirectPath("/portfolio");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsLoading(true);

    try {
      if (isForgotPassword) {
        const emailResult = z.string().trim().email().safeParse(email);
        if (!emailResult.success) {
          setErrors({ email: "Invalid email address" });
          setIsLoading(false);
          return;
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({
          title: "Reset Link Sent",
          description: "Check your email for a password reset link.",
        });
        setIsForgotPassword(false);
        return;
      }

      // Validate inputs
      const schema = isLogin ? loginSchema : signUpSchema;
      const validationResult = schema.safeParse({ email, password, fullName: isLogin ? undefined : fullName });
      
      if (!validationResult.success) {
        const fieldErrors: typeof errors = {};
        validationResult.error.errors.forEach((err) => {
          const field = err.path[0] as keyof typeof errors;
          fieldErrors[field] = err.message;
        });
        setErrors(fieldErrors);
        setIsLoading(false);
        return;
      }

      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: "Authentication Failed",
            description: error.message === "Invalid login credentials" 
              ? "Invalid email or password. Please try again." 
              : error.message,
            variant: "destructive",
          });
        } else {
          const { data: { user: loggedInUser } } = await supabase.auth.getUser();
          if (loggedInUser) {
            await checkUserRole(loggedInUser.id);
          }
          setShowSplash(true);
        }
      } else {
        const { error } = await signUp(email, password, fullName || undefined);
        if (error) {
          let message = error.message;
          if (error.message.includes("already registered")) {
            message = "This email is already registered. Please log in instead.";
          }
          toast({
            title: "Sign Up Failed",
            description: message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Account Created",
            description: "Welcome to Silvershadow Studio.",
          });
          navigate("/");
        }
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (showSplash) {
    return <LoginSplash onComplete={() => navigate(redirectPath)} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-[360px] flex-col items-center">
        {/* Logo */}
        <div className="animate-fade-in" style={{ marginBottom: "56px" }}>
          <img
            src={silvershadowLogo}
            alt="Silvershadow Studio"
            className="h-10 w-auto brightness-0 invert-0 dark:invert md:h-12"
          />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {!isLogin && (
            <div className="space-y-4">
              <label className="text-label text-muted-foreground">FULL NAME</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Dean"
                className="auth-input placeholder:text-muted-foreground/50"
              />
              {errors.fullName && (
                <p className="text-xs text-destructive">{errors.fullName}</p>
              )}
            </div>
          )}

          <div className="space-y-4">
            <label className="text-label text-muted-foreground">EMAIL</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              required
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          {!isForgotPassword && (
            <div className="space-y-4">
              <label className="text-label text-muted-foreground">PASSWORD</label>
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
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password}</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="auth-submit"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {isForgotPassword ? "SENDING..." : isLogin ? "SIGNING IN..." : "CREATING ACCOUNT..."}
              </span>
            ) : (
              isForgotPassword ? "SEND RESET LINK" : isLogin ? "LOGIN" : "CREATE ACCOUNT"
            )}
          </button>
        </form>

        {/* Forgot password / back */}
        <div className="mt-8 flex flex-col items-center gap-3 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          {isLogin && !isForgotPassword && (
            <button
              onClick={() => {
                setIsForgotPassword(true);
                setErrors({});
              }}
              className="transition-smooth hover:opacity-70"
              style={{ fontFamily: "Arial, sans-serif", fontSize: 11, opacity: 0.45, letterSpacing: 0 }}
            >
              Forgot password
            </button>
          )}
          {isForgotPassword && (
            <button
              onClick={() => {
                setIsForgotPassword(false);
                setErrors({});
              }}
              className="transition-smooth hover:opacity-70"
              style={{ fontFamily: "Arial, sans-serif", fontSize: 11, opacity: 0.45, letterSpacing: 0 }}
            >
              Back to login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
