// /contract — Client Agreement v3.0 acceptance gate.
//
// This is the only page in the portal that uses the document/paper visual
// world (cream surface, warm-black ink, gold accents). Sidebar and portal
// chrome are absent: the client is in a contractual moment, not a workspace.
//
// Behaviour:
//   - Fetches the client's account for the cover block + schedule choice.
//   - Renders the structured AgreementDocument from src/lib/agreements.
//   - Tracks scroll-to-end via IntersectionObserver, signature, name, position.
//   - Enables Accept only when all four conditions are met.
//   - Tracks time-on-page (paused while tab is hidden).
//   - Sends acceptance payload to `accept-agreement` edge function.
//   - On success → /  (the gate in App.tsx will then keep the client out
//     of /contract going forward).
//
// Naming reconciliation: the form fields are labelled "Full name" and
// "Position / Title" and persist into the existing DB columns
// `signatory_name` / `signatory_position`. We do not introduce
// `signed_by_*` aliases — the DB column names are kept everywhere.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import SignaturePad, { type SignaturePadRef } from "@/components/SignaturePad";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download } from "lucide-react";
import ssIcon from "@/assets/ss-icon.png";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { getAgreement } from "@/lib/agreements";
import type {
  AgreementDocument,
  Clause,
  NoticeItem,
  Paragraph,
  PartyBlock,
} from "@/lib/agreements/types";

// Document-world palette. Kept inline; deliberately not aliased to portal
// tokens so a future portal restyle does not bleed into the contract page.
const PAPER = "#EDE8E0";
const INK = "#1A1814";
const MUTED = "#8A8070";
const GOLD = "#B89A6A";
const RULE = "#C8BFB0";
const DARK_GROUND = "#0E0D0B";
const DEFINITION_RULE = "#D8D2C5";
const NOTICE_TINT = "#E5DFD4";
// "Headings are for convenience only…" was inline in clause 2's last
// paragraph (see _shared/agreements/project-v3.ts). The on-screen render
// filters it out of clause 2 and shows it instead in the document footer.
// We match on prefix rather than touching the shared content file.
const HEADINGS_PARAGRAPH_PREFIX = "Headings are for convenience only";
const HEADINGS_FOOTER_TEXT =
  "Headings are for convenience only. References to writing include email and portal confirmations. Words in the singular include the plural and vice versa.";

const BODY_STACK = "Georgia, 'Times New Roman', serif";
const META_STACK = "Arial, sans-serif";

interface AccountInfo {
  id: string;
  company_name: string;
  account_type: "project" | "partnership" | "team" | null;
  country: string | null;
  registration_number: string | null;
  building_number: string | null;
  street_name: string | null;
  city: string | null;
  postcode: string | null;
}

function joinAddress(a: AccountInfo): string | null {
  const parts = [a.building_number, a.street_name, a.postcode, a.city].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : null;
}

// ── Render helpers ──────────────────────────────────────────────────────────

function PartyLine({ block }: { block: PartyBlock }) {
  const segments = [
    block.legalName,
    block.country ? `Registered in ${block.country}` : null,
    block.registrationNumber || null,
    block.registeredAddress || null,
  ].filter(Boolean) as string[];
  return (
    <p style={{ fontFamily: BODY_STACK, fontSize: 15, color: INK, lineHeight: 1.7, margin: 0 }}>
      {segments.join(" · ")}
    </p>
  );
}

function EyebrowLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: META_STACK,
        fontSize: 10,
        letterSpacing: "0.28em",
        textTransform: "uppercase",
        color: MUTED,
        margin: "0 0 10px 0",
      }}
    >
      {children}
    </p>
  );
}

function ParagraphView({ p }: { p: Paragraph }) {
  if (p.type === "prose") {
    return (
      <p
        style={{
          fontFamily: BODY_STACK,
          fontSize: 15,
          color: INK,
          lineHeight: 1.7,
          margin: "0 0 24px 0",
        }}
      >
        {p.text}
      </p>
    );
  }
  if (p.type === "bullet_list") {
    return (
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px 0" }}>
        {p.items.map((item, i) => (
          <li
            key={i}
            style={{
              fontFamily: BODY_STACK,
              fontSize: 15,
              color: INK,
              lineHeight: 1.7,
              paddingLeft: 28,
              textIndent: "-16px",
              marginBottom: i < p.items.length - 1 ? 12 : 0,
            }}
          >
            <span style={{ color: GOLD, marginRight: 12 }}>·</span>
            {item}
          </li>
        ))}
      </ul>
    );
  }
  if (p.type === "definition") {
    return (
      <p
        style={{
          fontFamily: BODY_STACK,
          fontSize: 15,
          color: INK,
          lineHeight: 1.7,
          margin: "0 0 24px 0",
        }}
      >
        <strong style={{ fontWeight: 600 }}>{p.term}</strong>
        <span> — {p.text}</span>
      </p>
    );
  }
  // note
  return (
    <p
      style={{
        fontFamily: BODY_STACK,
        fontSize: 15,
        color: INK,
        opacity: 0.9,
        fontStyle: "italic",
        lineHeight: 1.7,
        margin: "0 0 24px 0",
      }}
    >
      {p.text}
    </p>
  );
}

function ClauseView({ clause }: { clause: Clause }) {
  const isDefinitionsClause = clause.number === "2";
  // Filter out the closing "Headings are for convenience only" line from
  // clause 2. It is rendered in the document footer instead. This keeps
  // the shared agreement content file untouched.
  const paragraphs = isDefinitionsClause
    ? clause.paragraphs.filter(
        (p) => !(p.type === "prose" && p.text.startsWith(HEADINGS_PARAGRAPH_PREFIX)),
      )
    : clause.paragraphs;

  return (
    <section style={{ marginTop: 32 }}>
      <h3
        style={{
          fontFamily: BODY_STACK,
          fontSize: 18,
          fontWeight: 600,
          color: INK,
          margin: "0 0 16px 0",
          lineHeight: 1.3,
        }}
      >
        <span style={{ color: GOLD, marginRight: 10 }}>{clause.number}.</span>
        {clause.title}
      </h3>
      {paragraphs.map((p, i) => {
        const next = paragraphs[i + 1];
        // In the Definitions clause, render a 1px rule between consecutive
        // definitions (but not after the final definition).
        const hasFollowingDefinition =
          isDefinitionsClause && p.type === "definition" && next?.type === "definition";
        if (hasFollowingDefinition) {
          return (
            <div
              key={i}
              style={{
                paddingBottom: 16,
                marginBottom: 16,
                borderBottom: `1px solid ${DEFINITION_RULE}`,
              }}
            >
              <p
                style={{
                  fontFamily: BODY_STACK,
                  fontSize: 15,
                  color: INK,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                <strong style={{ fontWeight: 600 }}>{p.term}</strong>
                <span> — {p.text}</span>
              </p>
            </div>
          );
        }
        return <ParagraphView key={i} p={p} />;
      })}
    </section>
  );
}

function NoticeBlockView({ notice }: { notice: AgreementDocument["notice"] }) {
  return (
    <section
      style={{
        marginTop: 48,
        padding: 24,
        background: NOTICE_TINT,
        borderTop: `1px solid ${GOLD}`,
        borderBottom: `1px solid ${GOLD}`,
      }}
    >
      <EyebrowLabel>{notice.heading}</EyebrowLabel>
      <p style={{ fontFamily: BODY_STACK, fontSize: 15, color: INK, lineHeight: 1.7, margin: "0 0 18px 0" }}>
        {notice.intro}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {notice.items.map((item: NoticeItem) => (
          <li
            key={item.clauseRef}
            style={{
              fontFamily: BODY_STACK,
              fontSize: 15,
              color: INK,
              lineHeight: 1.7,
              padding: "6px 0",
            }}
          >
            <span style={{ color: GOLD, fontWeight: 600, marginRight: 8 }}>
              Clause {item.clauseRef} —
            </span>
            {item.text}
          </li>
        ))}
      </ul>
      <p style={{ fontFamily: BODY_STACK, fontSize: 15, color: INK, lineHeight: 1.7, margin: "18px 0 0 0" }}>
        {notice.closing}
      </p>
    </section>
  );
}

function CoverBlock({ cover }: { cover: AgreementDocument["cover"] }) {
  return (
    <section>
      <h1
        style={{
          fontFamily: "Cinzel, Georgia, serif",
          fontSize: 28,
          fontWeight: 400,
          color: INK,
          letterSpacing: "0.06em",
          textAlign: "center",
          margin: "0 0 48px 0",
        }}
      >
        SILVERSHADOW STUDIO
      </h1>
      <div style={{ marginBottom: 28 }}>
        <EyebrowLabel>Studio</EyebrowLabel>
        <PartyLine block={cover.studio} />
      </div>
      <div style={{ marginBottom: 28 }}>
        <EyebrowLabel>Client</EyebrowLabel>
        <PartyLine block={cover.client} />
      </div>
      {/* Two-column meta grid. The internal "Agreement Version" pill is
          hidden from clients here and rendered in the document footer
          instead — see the document-footer block in the main render. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 48, rowGap: 24, marginBottom: 28 }}>
        <div>
          <EyebrowLabel>Effective Date</EyebrowLabel>
          <p style={{ fontFamily: BODY_STACK, fontSize: 15, color: INK, lineHeight: 1.6, margin: 0 }}>
            {cover.effectiveDate}
          </p>
        </div>
        <div>
          <EyebrowLabel>Engagement Model</EyebrowLabel>
          <p style={{ fontFamily: BODY_STACK, fontSize: 15, color: INK, lineHeight: 1.6, margin: 0 }}>
            {cover.engagementModel}
          </p>
        </div>
      </div>
      <p
        style={{
          fontFamily: BODY_STACK,
          fontSize: 13,
          fontStyle: "italic",
          color: MUTED,
          lineHeight: 1.6,
          margin: 0,
          paddingTop: 20,
          borderTop: `1px solid ${RULE}`,
        }}
      >
        {cover.footer}
      </p>
    </section>
  );
}

function ExecutionBlockView({ execution }: { execution: AgreementDocument["execution"] }) {
  return (
    <section style={{ marginTop: 48 }}>
      <EyebrowLabel>Execution</EyebrowLabel>
      <p style={{ fontFamily: BODY_STACK, fontSize: 15, color: INK, lineHeight: 1.7, margin: "0 0 12px 0" }}>
        {execution.intro}
      </p>
      <p style={{ fontFamily: BODY_STACK, fontSize: 15, color: INK, lineHeight: 1.7, margin: 0 }}>
        {execution.confirmation}
      </p>
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Contract() {
  const navigate = useNavigate();
  const { user, refreshAgreementStatus } = useAuth();

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountState, setAccountState] = useState<"loading" | "ready" | "error" | "no_account">("loading");

  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryPosition, setSignatoryPosition] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [scrolledToEndAt, setScrolledToEndAt] = useState<string | null>(null);
  const [pdfDownloadedBefore, setPdfDownloadedBefore] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const sigPadRef = useRef<SignaturePadRef | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // The document frame (#EDE8E0 article) is the scrollable container. The
  // IntersectionObserver below uses it as its root so the scroll-to-end
  // sentinel fires when the user scrolls the frame's content, not when the
  // window scrolls (the window does not scroll in this layout).
  const frameRef = useRef<HTMLElement | null>(null);

  // Time-on-page tracking. The active segment runs from `segmentStartRef` to
  // now; when the tab hides we add the segment to `accumulatedRef` and stop;
  // when it shows again, a new segment starts.
  const segmentStartRef = useRef<number>(Date.now());
  const accumulatedRef = useRef<number>(0);

  // ── Fetch account ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setAccountState("loading");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: membership, error: mErr } = await supabase
          .from("account_members")
          .select("account_id, accounts(id, company_name, account_type, country, registration_number, building_number, street_name, city, postcode)")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        if (mErr) throw mErr;
        const acct = (membership as any)?.accounts as AccountInfo | null;
        if (!acct) {
          setAccountState("no_account");
          return;
        }
        setAccount(acct);
        setAccountState("ready");
      } catch (e) {
        console.error("[Contract] account fetch failed:", e);
        if (!cancelled) setAccountState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ── Time-on-page (visibility-aware) ──────────────────────────────────────
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        accumulatedRef.current += (Date.now() - segmentStartRef.current) / 1000;
      } else {
        segmentStartRef.current = Date.now();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const computeTimeOnPageSeconds = useCallback((): number => {
    const liveSegment = document.hidden ? 0 : (Date.now() - segmentStartRef.current) / 1000;
    return Math.round(accumulatedRef.current + liveSegment);
  }, []);

  // ── IntersectionObserver for scroll-to-end ───────────────────────────────
  useEffect(() => {
    if (accountState !== "ready") return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.intersectionRatio >= 0.9) {
            setScrolledToEndAt((cur) => cur ?? new Date().toISOString());
          }
        }
      },
      { root: frameRef.current ?? null, threshold: [0.9] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [accountState]);

  // ── Build the agreement document ─────────────────────────────────────────
  const document_: AgreementDocument | null = useMemo(() => {
    if (!account || accountState !== "ready") return null;
    if (account.account_type !== "project" && account.account_type !== "partnership") {
      return null;
    }
    return getAgreement({
      schedule: account.account_type,
      client: {
        legalName: account.company_name,
        country: account.country,
        registrationNumber: account.registration_number,
        registeredAddress: joinAddress(account),
      },
      effectiveDate: format(new Date(), "d MMMM yyyy"),
    });
  }, [account, accountState]);

  // ── Accept gating ────────────────────────────────────────────────────────
  const canAccept =
    !!scrolledToEndAt &&
    hasSignature &&
    signatoryName.trim().length > 0 &&
    signatoryPosition.trim().length > 0 &&
    !submitting;

  // ── Download as PDF ──────────────────────────────────────────────────────
  // Marks `pdf_downloaded_before_signing = true` client-side regardless of
  // whether the network call succeeds. The preview function (section 6)
  // streams a watermarked PDF; before it's deployed, the click is still
  // recorded as intent but the actual download will fail.
  const handleDownloadPreview = useCallback(async () => {
    setPdfDownloadedBefore(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/preview-agreement-pdf`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`Preview returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = "Silvershadow_Services_Agreement_Preview.pdf";
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("[Contract] preview download failed:", err);
      // Stay silent on failure — the click intent is recorded.
    }
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleAccept = useCallback(async () => {
    if (!canAccept || !document_ || !account) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const signaturePng = sigPadRef.current?.toDataURL() ?? "";
      const payload = {
        agreement_version: document_.version,
        schedule_type: document_.schedule,
        signatory_name: signatoryName.trim(),
        signatory_position: signatoryPosition.trim(),
        signature_png_base64: signaturePng,
        scrolled_to_end_at: scrolledToEndAt,
        time_on_page_seconds: computeTimeOnPageSeconds(),
        pdf_downloaded_before_signing: pdfDownloadedBefore,
        client_timestamp: new Date().toISOString(),
      };
      const { data, error } = await supabase.functions.invoke("accept-agreement", {
        body: payload,
      });
      if (error) {
        const real = (data as any)?.error || error.message || "Acceptance failed.";
        throw new Error(real);
      }
      if (!data?.success) {
        throw new Error((data as any)?.error || "Acceptance failed.");
      }
      // Refresh AuthContext's cached `hasSignedAgreement` before navigating
      // away. ProtectedRoute reads that cached boolean; without the refresh
      // the next route would redirect right back to /sign-agreement and
      // produce a loop until the next full page reload.
      try { await refreshAgreementStatus(); } catch { /* best-effort */ }
      navigate("/");
    } catch (e: any) {
      console.error("[Contract] accept failed:", e);
      setSubmitError(e?.message || "Acceptance failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [
    canAccept, document_, account, signatoryName, signatoryPosition,
    scrolledToEndAt, pdfDownloadedBefore, computeTimeOnPageSeconds, navigate,
    refreshAgreementStatus,
  ]);

  // ── Page-level loading / error states ────────────────────────────────────

  const pageShell = (children: React.ReactNode) => (
    <div style={{ background: DARK_GROUND, minHeight: "100vh", color: PAPER }}>{children}</div>
  );

  // Reusable tinted pulsing SS icon for the dark ground. The shared
  // BrandLoader renders black-on-light and would be invisible here.
  const tintedSsIcon = (size: number, tint: string) => (
    <span
      aria-hidden
      className="animate-brand-pulse"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: tint,
        WebkitMaskImage: `url(${ssIcon})`,
        maskImage: `url(${ssIcon})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );

  if (accountState === "loading") {
    return pageShell(
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        {tintedSsIcon(24, MUTED)}
      </div>,
    );
  }

  if (accountState === "no_account" || accountState === "error") {
    return pageShell(
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "120px 32px", fontFamily: BODY_STACK, color: PAPER }}>
        <EyebrowLabel>Silver Shadow Studio</EyebrowLabel>
        <p style={{ fontSize: 15, lineHeight: 1.7 }}>
          We couldn't load your account. Please contact{" "}
          <a href="mailto:fred@silvershadowstudio.com" style={{ color: GOLD }}>fred@silvershadowstudio.com</a>{" "}
          for assistance.
        </p>
      </div>,
    );
  }

  // Partnership client whose v3.0 schedule isn't yet written, or a non-client
  // (team / admin) hitting this route. Polite placeholder; no signing UI.
  if (!document_) {
    const isPartnership = account?.account_type === "partnership";
    return pageShell(
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "120px 32px", fontFamily: BODY_STACK, color: PAPER }}>
        <EyebrowLabel>Silver Shadow Studio</EyebrowLabel>
        {isPartnership ? (
          <p style={{ fontSize: 15, lineHeight: 1.7 }}>
            Your Partnership Agreement is being finalised. We will contact you when it is ready to review and sign.
            For any urgent questions please contact{" "}
            <a href="mailto:fred@silvershadowstudio.com" style={{ color: GOLD }}>fred@silvershadowstudio.com</a>.
          </p>
        ) : (
          <p style={{ fontSize: 15, lineHeight: 1.7 }}>
            This page is for project and partnership clients of Silver Shadow Studio. If you reached it in error,
            please return to your <a href="/" style={{ color: GOLD }}>dashboard</a>.
          </p>
        )}
      </div>,
    );
  }

  // ── Loading overlay while submitting ─────────────────────────────────────
  // The pulsing SS icon is tinted to MUTED (#8A8070) via CSS mask so it
  // matches the "Signing your agreement" eyebrow above. The shared
  // BrandLoader bakes a black tint in and isn't easily recolourable, so
  // this one place inlines its own version.
  if (submitting) {
    return pageShell(
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 18 }}>
        <p style={{ fontFamily: META_STACK, fontSize: 10, letterSpacing: "0.28em", color: MUTED, textTransform: "uppercase" }}>
          Signing your agreement
        </p>
        <span
          aria-hidden
          className="animate-brand-pulse"
          style={{
            display: "inline-block",
            width: 24,
            height: 24,
            backgroundColor: MUTED,
            WebkitMaskImage: `url(${ssIcon})`,
            maskImage: `url(${ssIcon})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      </div>,
    );
  }

  // ── Full page render ─────────────────────────────────────────────────────
  // Layout: dimmed dark ground with a centred cream document frame. The
  // top bar (title left, download icon right) sits on the dark ground
  // above the frame. The frame itself is the scrollable container — the
  // window does not scroll. The IntersectionObserver above uses the frame
  // as its root.
  return pageShell(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        padding: 40,
        boxSizing: "border-box",
      }}
    >
      {/* Top bar — on the dark ground, above the frame */}
      <div
        style={{
          maxWidth: 880,
          width: "100%",
          margin: "0 auto 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <p
          style={{
            fontFamily: META_STACK,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: GOLD,
            opacity: 0.8,
            margin: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          Services Agreement — {account!.company_name}
        </p>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Download"
                onClick={handleDownloadPreview}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  width: 28,
                  height: 28,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: PAPER,
                  opacity: 0.35,
                  cursor: "pointer",
                  transition: "opacity 200ms ease",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.35"; }}
              >
                <Download className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>Download</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Document frame — cream, max 880px, fills remaining viewport,
          scrolls internally. */}
      <article
        ref={frameRef}
        style={{
          maxWidth: 880,
          width: "100%",
          margin: "0 auto",
          background: PAPER,
          color: INK,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "48px 56px 96px",
        }}
      >
        <CoverBlock cover={document_.cover} />
        <NoticeBlockView notice={document_.notice} />

        <div style={{ marginTop: 16 }}>
          {document_.clauses.map((c) => (
            <ClauseView key={c.number} clause={c} />
          ))}
        </div>

        <ExecutionBlockView execution={document_.execution} />

        {/* Document footer — small meta-legal note on the left + internal
            version reference on the right. Both sit below the execution
            block, above the signature area. */}
        <footer
          style={{
            marginTop: 48,
            paddingTop: 24,
            borderTop: `1px solid ${RULE}`,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <p
            style={{
              fontFamily: BODY_STACK,
              fontSize: 10,
              fontStyle: "italic",
              color: INK,
              opacity: 0.45,
              lineHeight: 1.6,
              margin: 0,
              flex: 1,
            }}
          >
            {HEADINGS_FOOTER_TEXT}
          </p>
          <p
            style={{
              fontFamily: META_STACK,
              fontSize: 8,
              color: INK,
              opacity: 0.35,
              margin: 0,
              textAlign: "right",
              whiteSpace: "nowrap",
            }}
          >
            {document_.version}
          </p>
        </footer>

        {/* Scroll sentinel — IntersectionObserver fires when this enters the
            viewport at ≥90% visibility. Placed below the document footer so
            scrolling past everything (including the footer) opens the gate. */}
        <div ref={sentinelRef} style={{ height: 1, width: "100%" }} aria-hidden />

        {/* Signature pad area */}
        <section
          style={{
            marginTop: 64,
            padding: "32px 24px",
            borderTop: `1px solid ${GOLD}`,
            borderBottom: `1px solid ${GOLD}`,
          }}
        >
          <EyebrowLabel>Sign here</EyebrowLabel>
          <div style={{ background: "#F2EDE5", border: `1px solid ${RULE}`, marginBottom: 6 }}>
            <SignaturePad
              ref={sigPadRef}
              penColor={INK}
              containerClassName="signature-canvas-paper"
              onEnd={() => {
                const empty = sigPadRef.current?.isEmpty() ?? true;
                setHasSignature(!empty);
              }}
            />
          </div>
          <div style={{ textAlign: "right" }}>
            <button
              type="button"
              onClick={() => {
                sigPadRef.current?.clear();
                setHasSignature(false);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: MUTED,
                opacity: 0.45,
                fontFamily: META_STACK,
                fontSize: 10,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                cursor: "pointer",
                padding: "4px 0",
                transition: "opacity 200ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.45"; }}
            >
              Clear signature
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginTop: 24 }}>
            <div>
              <label htmlFor="signatory-name" style={{ display: "block" }}>
                <EyebrowLabel>Full name</EyebrowLabel>
              </label>
              <input
                id="signatory-name"
                type="text"
                value={signatoryName}
                onChange={(e) => setSignatoryName(e.target.value)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${RULE}`,
                  outline: "none",
                  fontFamily: BODY_STACK,
                  fontSize: 15,
                  color: INK,
                  padding: "6px 0",
                }}
                onFocus={(e) => { e.currentTarget.style.borderBottomColor = GOLD; }}
                onBlur={(e) => { e.currentTarget.style.borderBottomColor = RULE; }}
              />
            </div>
            <div>
              <label htmlFor="signatory-position" style={{ display: "block" }}>
                <EyebrowLabel>Position / Title</EyebrowLabel>
              </label>
              <input
                id="signatory-position"
                type="text"
                value={signatoryPosition}
                onChange={(e) => setSignatoryPosition(e.target.value)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${RULE}`,
                  outline: "none",
                  fontFamily: BODY_STACK,
                  fontSize: 15,
                  color: INK,
                  padding: "6px 0",
                }}
                onFocus={(e) => { e.currentTarget.style.borderBottomColor = GOLD; }}
                onBlur={(e) => { e.currentTarget.style.borderBottomColor = RULE; }}
              />
            </div>
          </div>
        </section>

        {/* Confirmation paragraph — plain prose, not a checkbox */}
        <p
          style={{
            fontFamily: BODY_STACK,
            fontStyle: "italic",
            fontSize: 14,
            color: INK,
            lineHeight: 1.7,
            margin: "40px 0 0 0",
          }}
        >
          By signing above I confirm that I am duly authorised to bind {account!.company_name} and to accept these terms on the Client's behalf. I have read this agreement, including the matters specifically drawn to my attention at the top of this document, and understand that any confirmation, approval, or instruction I give through the portal is legally binding under clause 10.
        </p>

        {submitError && (
          <p
            style={{
              fontFamily: BODY_STACK,
              fontSize: 14,
              color: INK,
              margin: "32px 0 16px 0",
              padding: "12px 16px",
              border: `1px solid ${INK}`,
              background: "#F6EFE2",
            }}
          >
            {submitError}
          </p>
        )}

        {/* Accept button */}
        <div style={{ marginTop: 40 }}>
          <button
            type="button"
            disabled={!canAccept}
            onClick={handleAccept}
            style={{
              background: "transparent",
              border: `1px solid ${GOLD}`,
              color: canAccept ? GOLD : MUTED,
              fontFamily: META_STACK,
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              height: 48,
              padding: "0 32px",
              cursor: canAccept ? "pointer" : "default",
              opacity: canAccept ? 1 : 0.4,
              transition: "opacity 320ms ease, color 320ms ease",
            }}
          >
            Accept and enter the portal
          </button>
        </div>
      </article>
    </div>,
  );
}
