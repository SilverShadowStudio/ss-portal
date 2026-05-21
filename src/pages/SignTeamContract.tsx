// Acceptance gate for a team engagement contract. Reached via the invite
// link (/sign-team-contract/:contract_id). Standalone route — does its own
// auth check and relies on the team_contracts SELECT RLS to gate the data, so
// the recipient isn't bounced through the client onboarding / agreement gates.

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BrandLoader } from "@/components/ui/BrandLoader";

const PAPER = "#EDE8E0";
const INK = "#1A1814";
const GOLD = "#B89A6A";

interface ContractRow {
  id: string;
  status: "draft" | "sent" | "signed" | "declined" | "cancelled";
  entity_type: "individual" | "company";
  individual_full_name: string | null;
  company_name: string | null;
  subject_line: string;
  fee_amount: number | string | null;
  fee_currency: string | null;
  signed_at: string | null;
  storage_path: string | null;
}

const fmtMoney = (amt: number | string | null, ccy: string | null) => {
  const n = typeof amt === "string" ? parseFloat(amt) : (amt ?? 0);
  return `${ccy ?? "EUR"} ${(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

export default function SignTeamContract() {
  const { contract_id } = useParams<{ contract_id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState<ContractRow | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [declineConfirm, setDeclineConfirm] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  // Auth: must be logged in.
  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { state: { from: { pathname: `/sign-team-contract/${contract_id}` } } });
  }, [authLoading, user, contract_id, navigate]);

  const party = (c: ContractRow) => (c.entity_type === "company" ? c.company_name : c.individual_full_name) || "—";

  async function loadContract() {
    if (!contract_id) return;
    setLoading(true);
    const { data } = await supabase
      .from("team_contracts")
      .select("id, status, entity_type, individual_full_name, company_name, subject_line, fee_amount, fee_currency, signed_at, storage_path")
      .eq("id", contract_id)
      .maybeSingle();
    setContract((data as ContractRow) ?? null);
    setLoading(false);
  }

  useEffect(() => { if (user && contract_id) void loadContract(); /* eslint-disable-next-line */ }, [user, contract_id]);

  // Load the PDF for review (sent → live preview) or the stored signed copy.
  useEffect(() => {
    if (!contract) return;
    let cancelled = false;
    (async () => {
      try {
        if (contract.status === "signed" && contract.storage_path) {
          const { data } = await supabase.storage.from("freelancer-documents").createSignedUrl(contract.storage_path, 600);
          if (!cancelled && data?.signedUrl) setPdfUrl(data.signedUrl);
          return;
        }
        if (contract.status === "sent") {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;
          const res = await fetch(`${SUPABASE_URL}/functions/v1/preview-team-contract-pdf`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ contract_id: contract.id }),
          });
          if (!res.ok || cancelled) return;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          if (!cancelled) setPdfUrl(url); else URL.revokeObjectURL(url);
        }
      } catch { /* preview is best-effort; controls still work */ }
    })();
    return () => {
      cancelled = true;
      if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    };
  }, [contract?.id, contract?.status]);

  async function postAction(action: "accept" | "decline") {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("No session");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/team-contract-accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ contract_id, action, typed_name: typedName.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  }

  async function handleAccept() {
    if (!typedName.trim()) return toast({ title: "Please type your name to sign", variant: "destructive" });
    if (!agreed) return toast({ title: "Please confirm you agree to the terms", variant: "destructive" });
    setBusy("accept");
    try {
      await postAction("accept");
      toast({ title: "Contract signed" });
      await loadContract();
    } catch (e: any) {
      toast({ title: "Could not sign", description: e?.message || "Unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  }

  async function handleDecline() {
    if (!declineConfirm) { setDeclineConfirm(true); return; }
    setBusy("decline");
    try {
      await postAction("decline");
      toast({ title: "Contract declined" });
      await loadContract();
    } catch (e: any) {
      toast({ title: "Could not decline", description: e?.message || "Unknown error", variant: "destructive" });
    } finally { setBusy(null); setDeclineConfirm(false); }
  }

  // ── Shell ──────────────────────────────────────────────────────────────────
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen w-full flex justify-center px-4 py-10" style={{ background: PAPER }}>
      <div className="w-full" style={{ maxWidth: 720 }}>{children}</div>
    </div>
  );

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: PAPER }}><BrandLoader size="lg" /></div>;
  }

  if (!contract) {
    return (
      <Shell>
        <p style={{ fontFamily: "Georgia, serif", color: INK }} className="text-center text-base py-20">
          This contract isn't available, or you don't have access to it.
        </p>
      </Shell>
    );
  }

  const pdfPane = pdfUrl ? (
    <div className="mb-7">
      <iframe title="Contract" src={pdfUrl} className="w-full rounded-sm border" style={{ height: "60vh", minHeight: 360, borderColor: "rgba(26,24,20,0.15)", background: "#fff" }} />
      <p className="mt-2 text-center">
        <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: GOLD, fontSize: 11, letterSpacing: "0.12em" }} className="uppercase">Open PDF in new tab</a>
      </p>
    </div>
  ) : (
    <div className="mb-7 flex items-center justify-center rounded-sm border" style={{ height: 200, borderColor: "rgba(26,24,20,0.15)" }}>
      <BrandLoader size="md" />
    </div>
  );

  const header = (
    <header className="mb-8 text-center">
      <p className="uppercase" style={{ color: GOLD, fontSize: 10, letterSpacing: "0.28em" }}>Silver Shadow Studio</p>
      <h1 style={{ fontFamily: "Georgia, serif", color: INK, fontSize: "1.9rem", lineHeight: 1.15 }} className="mt-3">{contract.subject_line}</h1>
      <p className="mt-3" style={{ fontFamily: "Georgia, serif", color: INK, opacity: 0.7, fontSize: 14 }}>
        {party(contract)} · {fmtMoney(contract.fee_amount, contract.fee_currency)}
      </p>
    </header>
  );

  return (
    <Shell>
      {header}
      {pdfPane}

      {contract.status === "sent" && (
        <div className="space-y-5">
          <div>
            <label className="block uppercase mb-2" style={{ color: INK, opacity: 0.6, fontSize: 10, letterSpacing: "0.16em" }}>Full name (your signature)</label>
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name"
              className="w-full px-3 py-2 rounded-sm border focus:outline-none"
              style={{ borderColor: "rgba(26,24,20,0.25)", background: "transparent", color: INK, fontFamily: "Georgia, serif", fontSize: 16 }}
            />
          </div>
          <label className="flex items-start gap-3 cursor-pointer" style={{ color: INK }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
            <span style={{ fontFamily: "Georgia, serif", fontSize: 14 }}>I have read and agree to the terms of this contract.</span>
          </label>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={handleAccept}
              disabled={busy !== null}
              className="flex-1 h-12 uppercase disabled:opacity-40"
              style={{ background: GOLD, color: "#fff", fontSize: 11, letterSpacing: "0.18em", borderRadius: 2 }}
            >
              {busy === "accept" ? "Signing…" : "Accept and sign"}
            </button>
            <button
              onClick={handleDecline}
              disabled={busy !== null}
              className="h-12 px-6 uppercase disabled:opacity-40"
              style={{ border: "1px solid rgba(26,24,20,0.3)", color: INK, opacity: 0.75, fontSize: 11, letterSpacing: "0.18em", borderRadius: 2, background: "transparent" }}
            >
              {busy === "decline" ? "Declining…" : declineConfirm ? "Confirm decline" : "Decline"}
            </button>
          </div>
        </div>
      )}

      {contract.status === "signed" && (
        <p className="text-center" style={{ fontFamily: "Georgia, serif", color: INK, fontSize: 15 }}>
          Signed{contract.signed_at ? ` on ${fmtDate(contract.signed_at)}` : ""}. A copy is shown above and saved to your portal.
        </p>
      )}

      {(contract.status === "declined" || contract.status === "cancelled") && (
        <p className="text-center" style={{ fontFamily: "Georgia, serif", color: INK, opacity: 0.7, fontSize: 15 }}>
          This contract has been {contract.status}. Please contact Silver Shadow Studio if this is unexpected.
        </p>
      )}
    </Shell>
  );
}
