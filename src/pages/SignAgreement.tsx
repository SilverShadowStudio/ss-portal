import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { BrandLoader } from "@/components/ui/BrandLoader";
import {
  AGREEMENT_SECTIONS,
  ACCEPTANCE_CHECKBOX_TEXT,
  CURRENT_AGREEMENT_VERSION,
} from "@/lib/agreementTerms";
import silvershadowLogo from "@/assets/silvershadow-logo.png";

export default function SignAgreement() {
  const navigate = useNavigate();
  const { user, loading, refreshAgreementStatus } = useAuth();
  const { toast } = useToast();

  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showError, setShowError] = useState(false);
  const checkboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });
  }, [user, loading, navigate]);

  // If already signed, redirect to dashboard
  useEffect(() => {
    if (!user) return;
    supabase
      .from("agreements")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) navigate("/", { replace: true });
      });
  }, [user, navigate]);

  const handleAccept = async () => {
    if (!accepted) {
      setShowError(true);
      checkboxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("accept-agreement", {
        body: {
          inviteMode: true,
          acceptance: {
            checkboxText: ACCEPTANCE_CHECKBOX_TEXT,
            versionCode: CURRENT_AGREEMENT_VERSION,
            acceptedAtClient: new Date().toISOString(),
          },
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Agreement could not be saved.");
      }

      toast({ title: "Agreement accepted", description: "Welcome to Silver Shadow Studio." });
      await refreshAgreementStatus();
      navigate("/");
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Please try again or contact Silver Shadow Studio.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <BrandLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <article
        className="mx-auto w-full px-6 animate-fade-in"
        style={{ maxWidth: "680px", paddingTop: "100px", paddingBottom: "180px" }}
      >

        {/* Title */}
        <header className="mb-12">
          <p
            className="uppercase text-foreground/50"
            style={{ fontSize: "10px", letterSpacing: "0.3em", marginBottom: "28px" }}
          >
            {CURRENT_AGREEMENT_VERSION}
          </p>
          <h1
            className="font-serif font-normal text-foreground/90"
            style={{ fontSize: "38px", letterSpacing: "-0.005em", lineHeight: 1.05 }}
          >
            Silver Shadow Studio Client Agreement
          </h1>
        </header>

        {/* Sections */}
        {AGREEMENT_SECTIONS.map((section) => (
          <section key={section.number} className="mb-10">
            <h2
              className="font-sans uppercase text-foreground/50"
              style={{ fontSize: "10px", letterSpacing: "0.22em", marginBottom: "10px" }}
            >
              {section.number}. {section.title}
            </h2>
            {section.body.map((para, i) => (
              <p
                key={i}
                className="font-sans text-foreground/80"
                style={{ fontSize: "14px", lineHeight: 1.7, marginBottom: "8px" }}
              >
                {para}
              </p>
            ))}
          </section>
        ))}

        {/* Acceptance */}
        <div
          className="mt-16 border-t border-border/30 pt-12 space-y-6"
          ref={(el) => { checkboxRef.current = el; }}
        >
          <div className="flex items-start gap-4">
            <Checkbox
              id="accept"
              checked={accepted}
              onCheckedChange={(v) => {
                setAccepted(!!v);
                if (v) setShowError(false);
              }}
              className="mt-0.5 shrink-0"
            />
            <label
              htmlFor="accept"
              className="font-sans text-foreground/70 cursor-pointer"
              style={{ fontSize: "13px", lineHeight: 1.65 }}
            >
              {ACCEPTANCE_CHECKBOX_TEXT}
            </label>
          </div>

          {showError && (
            <p className="text-xs text-destructive">
              Please confirm the checkbox above to continue.
            </p>
          )}

          <button
            onClick={handleAccept}
            disabled={submitting}
            className="auth-submit"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <BrandLoader size="sm" />
                SAVING...
              </span>
            ) : (
              "CONTINUE"
            )}
          </button>
        </div>
      </article>
    </div>
  );
}
