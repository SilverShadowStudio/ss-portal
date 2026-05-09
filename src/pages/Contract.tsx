import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  AGREEMENT_SECTIONS,
  ACCEPTANCE_CHECKBOX_TEXT,
  CURRENT_AGREEMENT_VERSION,
} from "@/lib/agreementTerms";

interface FormData {
  companyName: string;
  country: string;
  registrationNumber: string;
  streetName: string;
  buildingNumber: string;
  city: string;
  postcode: string;
  firstName: string;
  familyName: string;
  position: string;
  emailAddress: string;
  password: string;
}

export default function Contract() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const formData = location.state?.formData as FormData | undefined;

  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showError, setShowError] = useState(false);
  const checkboxRef = useRef<HTMLDivElement | null>(null);

  const partyLine = useMemo(() => {
    if (!formData) return "";
    const fullAddress = `${formData.buildingNumber} ${formData.streetName}, ${formData.city}, ${formData.postcode}`;
    return `${formData.companyName}, incorporated or registered in ${formData.country} with registration number ${formData.registrationNumber}, whose registered address is ${fullAddress}.`;
  }, [formData]);

  useEffect(() => {
    // Scroll to top whenever the page loads.
    window.scrollTo({ top: 0 });
  }, []);

  if (!formData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No registration data found.</p>
          <button
            onClick={() => navigate("/onboarding")}
            className="text-label-gold transition-smooth hover:opacity-80"
          >
            RETURN TO REGISTRATION
          </button>
        </div>
      </div>
    );
  }

  const currentDate = format(new Date(), "d MMMM yyyy");

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
          formData,
          acceptance: {
            checkboxText: ACCEPTANCE_CHECKBOX_TEXT,
            versionCode: CURRENT_AGREEMENT_VERSION,
            acceptedAtClient: new Date().toISOString(),
          },
        },
      });

      if (error || !data?.success) {
        const message =
          data?.error ||
          error?.message ||
          "Account creation could not be completed. Please contact Silver Shadow Studio.";
        toast({
          title: "Account creation failed",
          description: message,
          variant: "destructive",
        });
        return;
      }

      // Sign the user in by setting the session returned from the edge function.
      if (data.session?.access_token && data.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }

      toast({
        title: "Agreement accepted",
        description: "Your account is active and the signed agreement has been saved to Documents.",
      });
      navigate("/");
    } catch (err) {
      console.error("accept-agreement failed", err);
      toast({
        title: "Account creation failed",
        description:
          "Account creation could not be completed. Please contact Silver Shadow Studio.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <article
        className="mx-auto w-full px-6 animate-fade-in"
        style={{ maxWidth: "680px", paddingTop: "160px", paddingBottom: "180px" }}
      >
        {/* Title block */}
        <header>
          <p
            className="uppercase text-foreground/50"
            style={{ fontSize: "10px", letterSpacing: "0.3em", marginBottom: "40px" }}
          >
            {CURRENT_AGREEMENT_VERSION}
          </p>
          <h1
            className="font-serif font-normal text-foreground/90"
            style={{ fontSize: "46px", letterSpacing: "-0.005em", lineHeight: 1.05 }}
          >
            SilverShadow Studio Limited
          </h1>
          <h2
            className="font-serif font-normal italic text-foreground/55"
            style={{ fontSize: "17px", letterSpacing: "0.01em", marginTop: "20px", lineHeight: 1.4 }}
          >
            Client Agreement
          </h2>
          <p
            className="uppercase text-foreground/45"
            style={{ fontSize: "10px", letterSpacing: "0.3em", marginTop: "40px" }}
          >
            {currentDate}
          </p>
        </header>

        {/* Personalised party line — no box, no border */}
        <section style={{ marginTop: "72px" }}>
          <p
            className="uppercase text-foreground/45"
            style={{ fontSize: "10px", letterSpacing: "0.3em", marginBottom: "22px" }}
          >
            Client identified during registration
          </p>
          <p className="text-foreground/85" style={{ fontSize: "15px", lineHeight: 1.9 }}>
            {partyLine}
          </p>
          <p
            className="text-foreground/45"
            style={{ fontSize: "13.5px", lineHeight: 1.85, marginTop: "20px" }}
          >
            Authorised contact:&nbsp;{formData.firstName}&nbsp;{formData.familyName}&nbsp;—&nbsp;{formData.position}&nbsp;—&nbsp;{formData.emailAddress}
          </p>
        </section>

        {/* Sections — strict editorial rhythm */}
        <div>
          {AGREEMENT_SECTIONS.map((section) => (
            <section key={section.number} style={{ marginTop: "64px" }}>
              <h3
                className="font-sans uppercase text-foreground/75"
                style={{ fontSize: "12px", letterSpacing: "0.22em", fontWeight: 500, marginBottom: "24px" }}
              >
                {section.number}. {section.title}
              </h3>
              <div className="text-foreground/70" style={{ fontSize: "15px", lineHeight: 1.9 }}>
                {section.body.map((line, i) => {
                  const isBullet = line.startsWith("\u2022");
                  const text = isBullet ? line.replace(/^\u2022\s*/, "") : line;
                  return (
                    <p
                      key={i}
                      style={{
                        marginBottom: isBullet ? "8px" : "20px",
                        paddingLeft: isBullet ? "22px" : 0,
                        textIndent: isBullet ? "-22px" : 0,
                      }}
                    >
                      {isBullet ? `—\u00A0\u00A0${text}` : text}
                    </p>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Acceptance — quiet, separated, no accent */}
        <div style={{ marginTop: "128px" }}>
          <div className="h-px w-full bg-foreground/[0.06]" />

          <div ref={checkboxRef} style={{ marginTop: "64px" }}>
            <label className="flex items-start gap-5 cursor-pointer">
              <Checkbox
                checked={accepted}
                onCheckedChange={(v) => {
                  setAccepted(v === true);
                  if (v === true) setShowError(false);
                }}
                className="mt-[6px] h-[14px] w-[14px] shrink-0 rounded-none border-foreground/40 data-[state=checked]:bg-foreground/85 data-[state=checked]:border-foreground/85 data-[state=checked]:text-background"
              />
              <span className="text-foreground/85" style={{ fontSize: "15px", lineHeight: 1.75 }}>
                {ACCEPTANCE_CHECKBOX_TEXT}
              </span>
            </label>
            {showError && !accepted && (
              <p
                className="text-foreground/55 uppercase"
                style={{ fontSize: "10px", letterSpacing: "0.22em", marginTop: "18px", marginLeft: "34px" }}
              >
                Acceptance is required to activate the account.
              </p>
            )}
          </div>

          <div style={{ marginTop: "56px" }}>
            <button
              onClick={handleAccept}
              disabled={submitting}
              className="font-sans uppercase text-background bg-foreground/85 hover:bg-foreground rounded-none disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-opacity duration-300"
              style={{
                fontSize: "11px",
                letterSpacing: "0.28em",
                fontWeight: 500,
                height: "46px",
                paddingLeft: "40px",
                paddingRight: "40px",
              }}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-2" />
                  Activating account…
                </>
              ) : (
                "Accept Agreement"
              )}
            </button>

            <p
              className="text-foreground/45"
              style={{ marginTop: "32px", fontSize: "12px", lineHeight: 1.75, maxWidth: "52ch" }}
            >
              On acceptance, a binding PDF record of this Agreement will be generated,
              timestamped and stored in your Documents. The Agreement is legally binding
              from this moment.
            </p>
          </div>

          <div style={{ marginTop: "64px" }}>
            <button
              onClick={() => navigate("/onboarding", { state: { formData } })}
              disabled={submitting}
              className="uppercase text-foreground/45 hover:text-foreground/75 transition-opacity duration-300 disabled:opacity-50"
              style={{ fontSize: "10px", letterSpacing: "0.3em" }}
            >
              Back to registration
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}