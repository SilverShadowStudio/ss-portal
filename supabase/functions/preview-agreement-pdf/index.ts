// preview-agreement-pdf
//
// Returns a watermarked PDF preview of the v3 Services Agreement for the
// authenticated user's account. The preview is byte-aligned with what the
// signed copy will look like (same library, same generator) — the only
// differences are:
//   - PREVIEW — NOT YET SIGNED watermark on every page (low-opacity diagonal)
//   - No embedded drawn signature
//   - Certificate page shows "(unsigned preview)" for the signed-by row
//
// No audit log entry is written — preview downloads are not legally
// significant. The client-side `pdf_downloaded_before_signing` boolean on
// the eventual acceptance payload captures whether this button was clicked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAgreement } from "../_shared/agreements/index.ts";
import { loadDesignConfig } from "../_shared/pdfUtils.ts";
import { generateAgreementPdfV3 } from "../_shared/agreementPdfV3.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Fetch account via account_members
  const { data: membership } = await admin
    .from("account_members")
    .select("account_id, accounts(id, company_name, account_type, country, registration_number, building_number, street, city, postcode)")
    .eq("user_id", user.id)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const acct = (membership as any)?.accounts as {
    id: string;
    company_name: string;
    account_type: string | null;
    country: string | null;
    registration_number: string | null;
    building_number: string | null;
    street: string | null;
    city: string | null;
    postcode: string | null;
  } | null;
  if (!acct) {
    return new Response(JSON.stringify({ error: "No account membership found" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (acct.account_type !== "project" && acct.account_type !== "partnership") {
    return new Response(JSON.stringify({ error: "Preview is for project or partnership clients only" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const registeredAddress = [acct.building_number, acct.street, acct.postcode, acct.city]
    .filter(Boolean).join(", ") || null;
  const now = new Date();
  const doc = getAgreement({
    schedule: acct.account_type,
    client: {
      legalName: acct.company_name,
      country: acct.country,
      registrationNumber: acct.registration_number,
      registeredAddress,
    },
    effectiveDate: now.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    }),
  });
  if (!doc) {
    return new Response(JSON.stringify({ error: "Agreement schedule not yet supported" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const design = await loadDesignConfig(admin);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = generateAgreementPdfV3({
      doc,
      signaturePngDataUrl: "",
      signatoryName: "",
      signatoryPosition: "",
      acceptedAt: now.toISOString(),
      agreementUid: crypto.randomUUID(),
      accountId: acct.id,
      ipAddress: getClientIp(req),
      userAgent: req.headers.get("user-agent") ?? "unknown",
      scrolledToEndAt: "",
      timeOnPageSeconds: 0,
      pdfDownloadedBeforeSigning: false,
      design,
    }, { watermark: true });
  } catch (e) {
    console.error("[preview-agreement-pdf] generation failed:", e);
    return new Response(JSON.stringify({ error: "Failed to generate preview PDF" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Silvershadow_Services_Agreement_Preview.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});
