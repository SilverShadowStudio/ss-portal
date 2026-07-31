import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type InvoiceLineItem,
} from "../_shared/documents/invoicePdf.ts";
import { generateInvoicePdfV3 } from "../_shared/documents/invoicePdfV3.ts";
import { ensurePaymentLink } from "../_shared/revolutMerchant.ts";

// Bump when the invoice template design changes so cached PDFs are regenerated.
const TEMPLATE_VERSION = "tmpl-v9-ebgaramond";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const invoiceId = body?.invoice_id;
    if (!invoiceId || typeof invoiceId !== "string") {
      return new Response(JSON.stringify({ error: "invoice_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invoice, error: invoiceError } = await userClient
      .from("invoices")
      .select(
        "id, invoice_number, reference_number, amount, currency, status, due_date, issued_at, created_at, updated_at, paid_at, notes, line_items, subtotal, vat_rate, vat_amount, account_id, bank_account, stripe_checkout_url, revolut_order_id, revolut_checkout_url, project_id, quotation_id",
      )
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let clientCompany: string | null = null;
    let clientAddress: string | null = null;
    let clientCountry: string | null = null;
    let clientRegistration: string | null = null;
    let clientName: string | null = null;
    let clientPosition: string | null = null;
    let clientEmail: string | null = null;

    if (invoice.account_id) {
      const { data: account } = await admin
        .from("accounts")
        .select(
          "company_name, registration_number, street_name, building_number, city, postcode, country, owner_user_id",
        )
        .eq("id", invoice.account_id)
        .maybeSingle();
      if (account) {
        clientCompany = account.company_name ?? null;
        clientRegistration = account.registration_number ?? null;
        clientCountry = account.country ?? null;
        const street = [account.building_number, account.street_name].filter(Boolean).join(" ");
        const cityLine = [account.postcode, account.city].filter(Boolean).join(" ");
        clientAddress = [street, cityLine].filter(Boolean).join("\n") || null;

        if (account.owner_user_id) {
          const { data: profile } = await admin
            .from("profiles")
            .select("first_name, last_name, full_name, position")
            .eq("user_id", account.owner_user_id)
            .maybeSingle();
          if (profile) {
            clientName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.full_name || null;
            clientPosition = profile.position ?? null;
          }
          const { data: authUser } = await admin.auth.admin.getUserById(account.owner_user_id);
          clientEmail = authUser?.user?.email ?? null;
        }
      }
    }

    // Project: prefer the direct link, else derive it from the quote.
    let projectName: string | null = null;
    let projId: string | null = (invoice as any).project_id ?? null;
    if (!projId && (invoice as any).quotation_id) {
      const { data: q } = await admin
        .from("quotation_documents").select("project_id").eq("id", (invoice as any).quotation_id).maybeSingle();
      projId = (q as any)?.project_id ?? null;
    }
    if (projId) {
      const { data: project } = await admin
        .from("projects").select("name").eq("id", projId).maybeSingle();
      projectName = project?.name ?? null;
    }

    const items = Array.isArray(invoice.line_items) ? (invoice.line_items as InvoiceLineItem[]) : [];

    // Payment link — ensure a live Revolut link for unpaid invoices so the PDF's
    // "PAY ONLINE" button always works (Stripe retired). Falls back to any cached
    // url; best-effort — on failure the PDF still renders without the button.
    let payUrl: string | null = (invoice as any).revolut_checkout_url ?? (invoice as any).stripe_checkout_url ?? null;
    if (invoice.status !== "paid" && !payUrl) {
      try {
        payUrl = (await ensurePaymentLink(admin, invoice as any)).checkout_url;
      } catch (e) {
        console.warn("[invoice-pdf] payment link generation failed:", (e as Error).message);
      }
    }

    const safeNumber = String(invoice.invoice_number || invoice.reference_number || invoice.id).replace(
      /[^a-zA-Z0-9._-]+/g,
      "-",
    );
    const fileName = `invoice-${safeNumber}.pdf`;
    const storagePath = `invoice-pdfs/${invoice.id}/latest.pdf`;
    const fingerprintPath = `invoice-pdfs/${invoice.id}/fingerprint.txt`;

    // Cache check — only regenerate if the invoice has changed since last generation.
    // Fingerprint is: updated_at (or created_at) + amount + status concatenated.
    const invoiceFingerprint = `${(invoice as any).updated_at ?? invoice.created_at}|${invoice.amount}|${invoice.status}|${(invoice as any).bank_account ?? ""}|${payUrl ?? ""}|${TEMPLATE_VERSION}`;
    let needsRegeneration = true;

    try {
      const { data: fpData } = await admin.storage.from("agreements").download(fingerprintPath);
      if (fpData) {
        const storedFingerprint = await fpData.text();
        if (storedFingerprint.trim() === invoiceFingerprint) {
          needsRegeneration = false;
          console.info("[invoice-pdf] Cache hit — serving existing PDF", { invoiceId });
        } else {
          console.info("[invoice-pdf] Cache miss — fingerprint changed, regenerating", { invoiceId });
        }
      }
    } catch {
      console.info("[invoice-pdf] No cached PDF — generating for the first time", { invoiceId });
    }

    if (needsRegeneration) {
      const pdfBytes = generateInvoicePdfV3({
        invoice_number: invoice.invoice_number,
        reference_number: invoice.reference_number,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        status: invoice.status,
        due_date: invoice.due_date,
        issued_at: invoice.issued_at,
        created_at: invoice.created_at,
        paid_at: (invoice as any).paid_at ?? null,
        notes: invoice.notes,
        line_items: items,
        client_company: clientCompany,
        client_name: clientName,
        client_address: clientAddress,
        client_country: clientCountry,
        client_registration: clientRegistration,
        client_email: clientEmail,
        client_position: clientPosition,
        subtotal: invoice.subtotal,
        vat_rate: invoice.vat_rate,
        vat_amount: invoice.vat_amount,
        bank_account: (invoice as any).bank_account,
        project_name: projectName,
        stripe_url: payUrl,
      });

      const { error: uploadError } = await admin.storage.from("agreements").upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

      if (uploadError) {
        return new Response(JSON.stringify({ error: uploadError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store the new fingerprint
      await admin.storage
        .from("agreements")
        .upload(fingerprintPath, new TextEncoder().encode(invoiceFingerprint), {
          contentType: "text/plain",
          upsert: true,
        });
    }

    const { data: previewSigned, error: previewError } = await admin.storage
      .from("agreements")
      .createSignedUrl(storagePath, 60);

    if (previewError || !previewSigned?.signedUrl) {
      return new Response(JSON.stringify({ error: previewError?.message || "Could not sign preview URL" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: downloadSigned, error: downloadError } = await admin.storage
      .from("agreements")
      .createSignedUrl(storagePath, 60, { download: fileName });

    if (downloadError || !downloadSigned?.signedUrl) {
      return new Response(JSON.stringify({ error: downloadError?.message || "Could not sign download URL" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ url: previewSigned.signedUrl, downloadUrl: downloadSigned.signedUrl, fileName }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
