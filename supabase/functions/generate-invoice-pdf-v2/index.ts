import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  generateInvoicePdfV2,
  type InvoicePdfInput,
} from "../_shared/documents/invoicePdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Admin-gated one-off invoice PDF generator. Takes a raw InvoicePdfInput body
// (no DB lookup, no persistence) and returns the rendered PDF inline. Used by
// the Generator tab's 2027 flow, which POSTs the on-screen form values directly.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonError("Unauthorized", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user?.id) return jsonError("Unauthorized", 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return jsonError("Forbidden", 403);

    const body = (await req.json().catch(() => null)) as InvoicePdfInput | null;
    if (!body || typeof body !== "object") return jsonError("Invalid JSON body", 400);
    if (!Array.isArray(body.line_items)) body.line_items = [];

    const pdfBytes = generateInvoicePdfV2(body);

    const safeNumber = String(body.invoice_number || body.reference_number || "invoice").replace(
      /[^a-zA-Z0-9._-]+/g,
      "-",
    );
    const fileName = `invoice-${safeNumber}.pdf`;

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return jsonError((error as Error).message || "Unexpected error", 500);
  }
});
