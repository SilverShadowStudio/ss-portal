import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BrandLoader } from "@/components/ui/BrandLoader";

type Status =
  | "loading"
  | "needs_auth"
  | "ready"
  | "accepting"
  | "success"
  | "error";

interface InviteInfo {
  id: string;
  email: string;
  company_name: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState<Status>("loading");
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    async function load() {
      if (!token) {
        setErrorMsg("Missing invitation token.");
        setStatus("error");
        return;
      }
      const { data, error } = await supabase.rpc("get_invitation_by_token", {
        _token: token,
      });
      if (error || !data || data.length === 0) {
        setErrorMsg("This invitation could not be found.");
        setStatus("error");
        return;
      }
      const row = data[0] as InviteInfo;
      setInvite(row);

      if (row.revoked_at) {
        setErrorMsg("This invitation has been revoked.");
        setStatus("error");
        return;
      }
      if (row.accepted_at) {
        setErrorMsg("This invitation has already been accepted.");
        setStatus("error");
        return;
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        setErrorMsg("This invitation has expired.");
        setStatus("error");
        return;
      }

      if (authLoading) return;

      if (!user) {
        setStatus("needs_auth");
        return;
      }

      if ((user.email || "").toLowerCase() !== row.email.toLowerCase()) {
        setErrorMsg(
          `This invitation was sent to ${row.email}. Please sign in with that email address.`,
        );
        setStatus("error");
        return;
      }

      setStatus("ready");
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, authLoading]);

  const handleAccept = async () => {
    if (!token) return;
    setStatus("accepting");
    try {
      const { data, error } = await supabase.functions.invoke(
        "accept-invitation",
        { body: { token } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Welcome to the team");
      setStatus("success");
      setTimeout(() => navigate("/"), 1500);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to accept invitation");
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md card-elevated p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-px w-8 bg-gold-muted" />
          <span className="text-label-gold">Team invitation</span>
        </div>

        {status === "loading" && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <BrandLoader size="sm" />
            <span className="text-sm">Loading invitation…</span>
          </div>
        )}

        {status === "needs_auth" && invite && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              You've been invited to join{" "}
              <strong className="text-foreground">{invite.company_name}</strong>.
              Please sign in or create an account using{" "}
              <strong className="text-foreground">{invite.email}</strong> to
              accept this invitation.
            </p>
            <Link to={`/auth?next=/accept-invite?token=${token}`}>
              <Button className="w-full border border-gold bg-transparent text-gold hover:bg-[#1C1A17]">
                SIGN IN OR CREATE ACCOUNT
              </Button>
            </Link>
          </>
        )}

        {status === "ready" && invite && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">
              Join {invite.company_name}
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              Accepting this invitation will give you shared access to the
              team's projects and documents.
            </p>
            <Button
              onClick={handleAccept}
              className="w-full border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
            >
              ACCEPT INVITATION
            </Button>
          </>
        )}

        {status === "accepting" && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <BrandLoader size="sm" />
            <span className="text-sm">Adding you to the team…</span>
          </div>
        )}

        {status === "success" && invite && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">
              You're in
            </h1>
            <p className="text-sm text-muted-foreground">
              Welcome to {invite.company_name}. Redirecting…
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className="font-serif text-3xl text-foreground mb-3">
              Invitation unavailable
            </h1>
            <p className="text-sm text-muted-foreground mb-6">{errorMsg}</p>
            <Link to="/">
              <Button
                variant="outline"
                className="w-full border-border text-foreground"
              >
                BACK TO HOME
              </Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}