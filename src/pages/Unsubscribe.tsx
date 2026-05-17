import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/ui/BrandLoader";

type Status = "loading" | "ready" | "already" | "invalid" | "submitting" | "done" | "error";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const supabaseUrl = "https://oodhsoiwnqxcimzmzick.supabase.co";
  const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I";

  useEffect(() => {
    async function validate() {
      if (!token) {
        setStatus("invalid");
        setErrorMsg("Missing token.");
        return;
      }
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: supabaseAnonKey } },
        );
        const data = await res.json();
        if (!res.ok) {
          setStatus("invalid");
          setErrorMsg(data?.error || "Invalid or expired link.");
          return;
        }
        if (data?.reason === "already_unsubscribed") {
          setStatus("already");
          return;
        }
        setStatus("ready");
      } catch {
        setStatus("error");
        setErrorMsg("Could not reach the server. Please try again.");
      }
    }
    validate();
  }, [token, supabaseUrl, supabaseAnonKey]);

  const handleConfirm = async () => {
    if (!token) return;
    setStatus("submitting");
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/handle-email-unsubscribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
          body: JSON.stringify({ token }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data?.error || "Failed to unsubscribe.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setErrorMsg("Could not reach the server. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md card-elevated p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-px w-8 bg-gold-muted" />
          <span className="text-label-gold">Email preferences</span>
        </div>

        {status === "loading" && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <BrandLoader size="sm" />
            <span className="text-sm">Verifying link…</span>
          </div>
        )}

        {status === "ready" && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">Unsubscribe</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Click the button below to stop receiving emails from us at this address.
            </p>
            <Button
              onClick={handleConfirm}
              className="w-full border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
            >
              CONFIRM UNSUBSCRIBE
            </Button>
          </>
        )}

        {status === "submitting" && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <BrandLoader size="sm" />
            <span className="text-sm">Updating preferences…</span>
          </div>
        )}

        {status === "already" && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">Already unsubscribed</h1>
            <p className="text-sm text-muted-foreground">
              This email address is already unsubscribed from our emails.
            </p>
          </>
        )}

        {status === "done" && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">Unsubscribed</h1>
            <p className="text-sm text-muted-foreground">
              You won't receive any further emails from us at this address.
            </p>
          </>
        )}

        {(status === "invalid" || status === "error") && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">
              {status === "invalid" ? "Invalid link" : "Something went wrong"}
            </h1>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </>
        )}
      </div>
    </div>
  );
}