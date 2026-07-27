// send-overhead-reminder/index.ts
//
// Daily reminder emails for unpaid overheads. Called by pg_cron once a day
// at 07:00 UTC (via migration 20260724000001_overhead_reminders.sql). Also
// safe to invoke manually — same body ({}), same behaviour, returns
// per-row detail so a human can verify from the response.
//
// Scan buckets:
//   • due_date = today                  → "today"   subject: "Payment due — {supplier}"
//   • due_date = today + 7              → "in_7d"   subject: "Payment due — {supplier}"
//   • due_date < today                  → "overdue" subject: "Overdue — {supplier}"
//
// Idempotence guards, checked per row before send:
//   • today / in_7d — skip if last_reminder_sent_at::date >= today
//                     (same-day duplicate protection)
//   • overdue       — skip if last_reminder_sent_at > now() - 7 days
//                     (weekly nudge cadence)
//
// Recipients from app_settings.overhead_reminder_config:
//   { enabled, default_recipient, additional_recipients }
// All emails go to the union of default + additional (deduped, lowercased).
//
// Callers: pg_cron (X-Cron-Secret header) or an admin JWT for a manual run.
// Anything else is refused — this function sends real email and stamps the
// idempotence guard, so it must not be reachable with the public anon key.
//
// Required Supabase secrets:
//   RESEND_API_KEY, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrand } from "../_shared/brand.ts";
import { requireCronOrAdmin } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOGO_URL =
  "https://portal.silvershadowstudio.com/email-assets/silvershadow-wordmark.png";
const FROM_ADDRESS = "Silver Shadow Studio <portal@silvershadowstudio.com>";
// Expenses were merged into P&L (Money out); the old /finance/expenses path
// still redirects, but link straight to the live P&L page.
const PORTAL_EXPENSES_URL =
  "https://portal.silvershadowstudio.com/admin/finance/pnl";

type Bucket = "today" | "in_7d" | "overdue";

interface OverheadRow {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  due_date: string; // YYYY-MM-DD
  gross_amount: string; // numeric arrives as string via PostgREST
  currency: string;
  last_reminder_sent_at: string | null;
}

interface ReminderConfig {
  enabled?: boolean;
  default_recipient?: string;
  additional_recipients?: string[];
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAmount(gross: string, currency: string): string {
  const n = Number(gross);
  const symbol =
    currency === "GBP"
      ? "£"
      : currency === "USD"
      ? "$"
      : currency === "EUR"
      ? "€"
      : `${currency} `;
  return `${symbol}${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function subjectFor(bucket: Bucket, supplier: string): string {
  return bucket === "overdue"
    ? `Overdue — ${supplier}`
    : `Payment due — ${supplier}`;
}

function bucketLabel(bucket: Bucket, dueDate: string): string {
  if (bucket === "today") return "Due today";
  if (bucket === "in_7d") return "Due in 7 days";
  return `Overdue since ${formatDate(dueDate)}`;
}

function shouldSkip(
  row: OverheadRow,
  bucket: Bucket,
  todayIso: string,
  nowMs: number,
): boolean {
  if (!row.last_reminder_sent_at) return false;
  if (bucket === "overdue") {
    const sentMs = Date.parse(row.last_reminder_sent_at);
    return sentMs > nowMs - 7 * 86400_000;
  }
  const sentDate = row.last_reminder_sent_at.slice(0, 10);
  return sentDate >= todayIso;
}

function buildEmailHtml(
  row: OverheadRow,
  bucket: Bucket,
  backgroundColor: string,
): string {
  const heading = row.supplier_name;
  const subhead = row.invoice_number || "";
  const subheadLine = subhead
    ? `<p style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#1A1814;opacity:0.55;line-height:1.5;text-align:center;margin:8px auto 0;max-width:360px;letter-spacing:0.03em;">${escapeHtml(
        subhead,
      )}</p>`
    : "";

  const label = bucketLabel(bucket, row.due_date);
  // Overdue: uppercase gold eyebrow. Today / 7-days: warm serif line.
  const labelStyle =
    bucket === "overdue"
      ? `font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#B89A6A;`
      : `font-family:Georgia,'Times New Roman',serif;font-size:14px;color:#1A1814;opacity:0.75;`;

  const amount = formatAmount(row.gross_amount, row.currency);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:${backgroundColor};">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${backgroundColor};">
    <tr>
      <td align="center" valign="top">
        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">
          <tr>
            <td style="font-family:Arial,sans-serif;padding:48px 40px;">

              <div style="text-align:center;margin-bottom:44px;">
                <img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none;">
              </div>

              <p style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;color:#1A1814;line-height:1.15;text-align:center;margin:0 auto;letter-spacing:0.01em;">
                ${escapeHtml(heading)}
              </p>
              ${subheadLine}

              <div style="width:36px;height:1px;background:#B89A6A;margin:22px auto 32px;"></div>

              <p style="${labelStyle}line-height:1.7;text-align:center;margin:0 auto 6px;max-width:360px;">
                ${escapeHtml(label)}
              </p>

              <p style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#1A1814;line-height:1.4;text-align:center;margin:0 auto 18px;max-width:360px;letter-spacing:0.01em;">
                ${escapeHtml(amount)}
              </p>

              <p style="text-align:center;margin:32px 0;">
                <a href="${PORTAL_EXPENSES_URL}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A;">
                  Open in Portal
                </a>
              </p>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function dedupeLower(list: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const v = (s ?? "").trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireCronOrAdmin(req, {
    secretEnvVar: "CRON_SECRET",
    corsHeaders,
  });
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Config
    const { data: configRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "overhead_reminder_config")
      .maybeSingle();
    const cfg = (configRow?.value ?? {}) as ReminderConfig;
    if (cfg.enabled === false) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const recipients = dedupeLower([
      cfg.default_recipient,
      ...(cfg.additional_recipients ?? []),
    ]);
    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "no_recipients" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Scan
    const now = new Date();
    const nowMs = now.getTime();
    const todayIso = now.toISOString().slice(0, 10);
    const in7dIso = new Date(nowMs + 7 * 86400_000).toISOString().slice(0, 10);

    const { data: rows, error: scanErr } = await supabase
      .from("overheads")
      .select(
        "id, supplier_name, invoice_number, due_date, gross_amount, currency, last_reminder_sent_at",
      )
      .eq("payment_status", "unpaid")
      .or(
        `due_date.eq.${todayIso},due_date.eq.${in7dIso},due_date.lt.${todayIso}`,
      );
    if (scanErr) throw new Error(`scan failed: ${scanErr.message}`);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not set");

    const brand = await loadBrand(supabase);

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const details: unknown[] = [];

    for (const raw of rows ?? []) {
      const row = raw as OverheadRow;
      const bucket: Bucket =
        row.due_date === todayIso
          ? "today"
          : row.due_date === in7dIso
          ? "in_7d"
          : "overdue";

      if (shouldSkip(row, bucket, todayIso, nowMs)) {
        skipped++;
        details.push({
          id: row.id,
          supplier: row.supplier_name,
          bucket,
          skipped: "guard",
          last_reminder_sent_at: row.last_reminder_sent_at,
        });
        continue;
      }

      try {
        const html = buildEmailHtml(row, bucket, brand.background_color);
        const subject = subjectFor(bucket, row.supplier_name);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: recipients,
            subject,
            html,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Resend ${res.status}: ${err}`);
        }
        const resendData = await res.json();

        const { error: upErr } = await supabase
          .from("overheads")
          .update({ last_reminder_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        if (upErr) throw new Error(`stamp failed: ${upErr.message}`);

        sent++;
        details.push({
          id: row.id,
          supplier: row.supplier_name,
          invoice_number: row.invoice_number,
          bucket,
          to: recipients,
          resend_id: (resendData as { id?: string }).id ?? null,
        });
        console.log(
          `[send-overhead-reminder] sent ${bucket} ${row.supplier_name}/${
            row.invoice_number ?? "—"
          } to ${recipients.join(", ")}`,
        );
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        details.push({
          id: row.id,
          supplier: row.supplier_name,
          bucket,
          failed: message,
        });
        console.error(
          `[send-overhead-reminder] failed ${row.supplier_name}: ${message}`,
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        today: todayIso,
        in_7d: in7dIso,
        recipients,
        total: (rows ?? []).length,
        sent,
        skipped,
        failed,
        details,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[send-overhead-reminder]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
