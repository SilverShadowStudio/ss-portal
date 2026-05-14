// Stripe checkout session creator for invoices.
// Reads STRIPE_SECRET_KEY from environment. If not set, returns { pending: true } so the UI
// can render a graceful "coming soon" message until the key is configured.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
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

    // RLS on invoices ensures users only see invoices they have access to
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("id, invoice_number, reference_number, amount, currency, status, account_id")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (invoice.status === "paid") {
      return new Response(JSON.stringify({ error: "Invoice already paid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    console.log("Stripe key set:", !!stripeKey);
    if (!stripeKey) {
      // Graceful placeholder while Stripe is being configured.
      return new Response(JSON.stringify({ pending: true, message: "Stripe not configured yet" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lazy import Stripe only when key is present
    const Stripe = (await import("https://esm.sh/stripe@17.2.0?target=deno")).default;
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-10-28.acacia" });

    const origin = req.headers.get("origin") || "https://portal.silvershadowstudio.com";
    const number = invoice.invoice_number || invoice.reference_number || "Invoice";
    const currency = (invoice.currency || "EUR").toLowerCase();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: Math.round(Number(invoice.amount) * 100),
            product_data: { name: `Invoice ${number}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/invoices?paid=1&invoice=${invoice.id}`,
      cancel_url: `${origin}/invoices?canceled=1`,
      metadata: { invoice_id: invoice.id },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-invoice-checkout error:", (e as Error).message);
    console.error("Stack:", (e as Error).stack);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
