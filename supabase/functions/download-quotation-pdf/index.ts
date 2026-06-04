// Server-side quotation PDF endpoint. Mirrors download-invoice-pdf's auth +
// enrichment plumbing, but returns the PDF as a direct application/pdf blob
// (no storage caching) rather than signed URLs. Replaces the client-side
// html2canvas rasteriser (generateInvoicePdf) for quotations.
//
// Auth is RLS-implicit: the quotation row is fetched via the user-scoped
// client, so a row the caller cannot see returns null → 404. Client/contact
// enrichment (address, contact name) is read via the service-role client,
// preferring the denormalised values stored on the row and falling back to
// the linked account/profile/project — mirroring QuotationViewer.tsx.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  generateQuotationPdf,
  type QuotationLineItem,
  type QuotationPdfInput,
} from "../_shared/documents/quotationPdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return jsonError("Unauthorized", 401);
    }

    const body = await req.json().catch(() => ({}));
    const quotationId = body?.quotation_id;
    if (!quotationId || typeof quotationId !== "string") {
      return jsonError("quotation_id required", 400);
    }

    // RLS-implicit: a quotation the caller cannot see resolves to null → 404.
    const { data: quotation, error: quotationError } = await userClient
      .from("quotation_documents")
      .select(
        "id, quotation_number, reference_number, project_id, project_name, issued_at, created_at, currency, account_id, client_company, client_address, client_country, client_registration, client_name, client_position, line_items, subtotal, vat_rate, vat_amount, amount, notes",
      )
      .eq("id", quotationId)
      .maybeSingle();

    if (quotationError || !quotation) {
      return jsonError("Quotation not found", 404);
    }

    let clientCompany: string | null = quotation.client_company ?? null;
    let clientAddress: string | null = quotation.client_address ?? null;
    let clientCountry: string | null = quotation.client_country ?? null;
    let clientRegistration: string | null = quotation.client_registration ?? null;
    let clientName: string | null = quotation.client_name ?? null;
    let clientPosition: string | null = quotation.client_position ?? null;
    let projectName: string | null = quotation.project_name ?? null;

    // Enrich missing fields from the linked account/profile (service-role).
    if (quotation.account_id) {
      const { data: account } = await admin
        .from("accounts")
        .select(
          "company_name, registration_number, street_name, building_number, city, postcode, country, owner_user_id",
        )
        .eq("id", quotation.account_id)
        .maybeSingle();
      if (account) {
        clientCompany = clientCompany || account.company_name || null;
        clientRegistration = clientRegistration || account.registration_number || null;
        clientCountry = clientCountry || account.country || null;
        if (!clientAddress) {
          const street = [account.building_number, account.street_name].filter(Boolean).join(" ");
          const cityLine = [account.postcode, account.city].filter(Boolean).join(" ");
          clientAddress = [street, cityLine].filter(Boolean).join("\n") || null;
        }
        if ((!clientName || !clientPosition) && account.owner_user_id) {
          const { data: profile } = await admin
            .from("profiles")
            .select("first_name, last_name, full_name, position")
            .eq("user_id", account.owner_user_id)
            .maybeSingle();
          if (profile) {
            clientName = clientName ||
              ([profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.full_name || null);
            clientPosition = clientPosition || profile.position || null;
          }
        }
      }
    }

    // Fall back to the linked project's name when the row has none.
    if (!projectName && quotation.project_id) {
      const { data: project } = await admin
        .from("projects")
        .select("name")
        .eq("id", quotation.project_id)
        .maybeSingle();
      projectName = project?.name ?? null;
    }

    const lineItems = Array.isArray(quotation.line_items)
      ? (quotation.line_items as QuotationLineItem[])
      : null;

    const input: QuotationPdfInput = {
      quotation_number: quotation.quotation_number || quotation.reference_number || "—",
      reference_number: quotation.reference_number,
      project_name: projectName,
      issued_at: quotation.issued_at,
      created_at: quotation.created_at,
      currency: quotation.currency,
      client_company: clientCompany,
      client_address: clientAddress,
      client_country: clientCountry,
      client_registration: clientRegistration,
      client_name: clientName,
      client_position: clientPosition,
      line_items: lineItems,
      subtotal: quotation.subtotal,
      vat_rate: quotation.vat_rate,
      vat_amount: quotation.vat_amount,
      amount: quotation.amount,
      notes: quotation.notes,
    };

    const pdfBytes = generateQuotationPdf(input);

    const safeNumber = String(quotation.quotation_number || quotation.reference_number || quotation.id)
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
    const fileName = `quotation-${safeNumber}.pdf`;

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
