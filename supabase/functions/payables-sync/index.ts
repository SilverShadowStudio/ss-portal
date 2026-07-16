// payables-sync/index.ts
// Read-only Airtable → payables_snapshot sync + schema-guard.
//
// Auth (deployed with --no-verify-jwt so the platform doesn't validate ahead
// of us):
//   * Admin JWT (manual trigger from UI or console) — verify + role check.
//   * Service-role Bearer (pg_cron) — token equals SUPABASE_SERVICE_ROLE_KEY
//     env, bypasses admin check.
//
// Payables data flows one-way: Airtable → portal. This function never writes
// back to Airtable.
//
// Field IDs come from app_settings.airtable_payables_field_config. Airtable
// is queried with returnFieldsByFieldId=true so field-name drift is
// invisible to the portal; only true field deletions surface, and those
// land as admin_alerts rows via the schema-guard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PaidStatus = "paid" | "unpaid" | "partial" | "unknown";

interface SourceConfig {
  table_id: string;
  fields: Record<string, string>;
}
interface PayablesConfig {
  base_id: string;
  sources: Record<string, SourceConfig>;
}

interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

interface MetaField {
  id: string;
  name: string;
  type: string;
}
interface MetaTable {
  id: string;
  name: string;
  fields: MetaField[];
}

const SOURCE_KEYS = [
  "modeller_invoices",
  "scene_manager_invoice",
  "photographer_invoice",
  "partner_studios_monthly",
  "partner_studios_contract",
] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function firstOf<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] ?? null) as T | null;
  return (v ?? null) as T | null;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  if (typeof v === "string") {
    // Airtable currency fields SHOULD return raw numbers, but strip
    // symbols/commas defensively in case a configuration returns
    // formatted strings ("£1,500.00", "$0", etc.).
    const cleaned = v.replace(/[£$€,\s]/g, "");
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  if (Array.isArray(v) && v.length) return toNumber(v[0]);
  if (typeof v === "object") {
    // Airtable formula/rollup errors sometimes wrap in { specialValue: "NaN" }.
    const anyV = v as { specialValue?: unknown };
    if (anyV.specialValue != null) return null;
  }
  return null;
}

function normalizePaidStatus(value: unknown): PaidStatus {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "unknown";
  const v = raw.trim().toUpperCase();
  if (v.includes("PARTIAL")) return "partial";
  if (v.includes("YES")) return "paid";
  if (v.includes("NO")) return "unpaid";
  return "unknown";
}

function extractPeriod(
  source: string,
  fields: Record<string, unknown>,
  fm: Record<string, string>,
): { period_date: string | null; period_year: number | null; period_month: number | null } {
  const isoLike = (s: unknown): string | null =>
    typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

  const pdRaw = firstOf<unknown>(fields[fm.period_date]);
  const pdFormula = firstOf<unknown>(fields[fm.period_formula]);
  const dc = firstOf<unknown>(fields[fm.date_created]);

  let period_date =
    isoLike(pdRaw) ?? isoLike(pdFormula) ??
    (source === "partner_studios_contract" ? isoLike(dc) : null);

  const yRaw = firstOf<unknown>(fields[fm.period_year]);
  const mRaw = firstOf<unknown>(fields[fm.period_month]);

  const period_year =
    toNumber(yRaw) ?? (period_date ? Number(period_date.slice(0, 4)) : null);
  const period_month =
    toNumber(mRaw) ?? (period_date ? Number(period_date.slice(5, 7)) : null);

  return { period_date, period_year, period_month };
}

async function fetchAllRecords(
  baseId: string,
  tableId: string,
  fieldIds: string[],
  pat: string,
): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined = undefined;
  let pages = 0;
  do {
    const u = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
    u.searchParams.set("pageSize", "100");
    u.searchParams.set("returnFieldsByFieldId", "true");
    for (const f of fieldIds) if (f) u.searchParams.append("fields[]", f);
    if (offset) u.searchParams.set("offset", offset);

    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (!r.ok) {
      throw new Error(`Airtable ${r.status} on ${tableId}: ${await r.text()}`);
    }
    const j = (await r.json()) as { records: AirtableRecord[]; offset?: string };
    all.push(...j.records);
    offset = j.offset;
    pages++;
  } while (offset && pages < 50);
  return all;
}

function normalizeRecord(
  source: string,
  fm: Record<string, string>,
  rec: AirtableRecord,
): Record<string, unknown> {
  const f = rec.fields;

  const payeeLinks = f[fm.payee];
  const payee_airtable_user_id =
    Array.isArray(payeeLinks) && payeeLinks.length
      ? String(payeeLinks[0])
      : null;

  const payee_name = firstOf<string>(f[fm.payee_name]);
  const payee_email = firstOf<string>(f[fm.payee_email]);
  const invoice_total = toNumber(f[fm.invoice_total]) ?? 0;
  const amount_paid = fm.amount_paid ? toNumber(f[fm.amount_paid]) : null;
  const balance_remaining = fm.balance ? toNumber(f[fm.balance]) : null;

  const { period_date, period_year, period_month } = extractPeriod(source, f, fm);
  const paid_status = normalizePaidStatus(f[fm.paid_status]);
  const payment_stage = fm.payment_stage ? firstOf<string>(f[fm.payment_stage]) : null;
  const invoice_number = fm.invoice_number
    ? String(firstOf<string | number>(f[fm.invoice_number]) ?? "") || null
    : null;

  return {
    airtable_record_id: rec.id,
    source_table: source,
    payee_airtable_user_id,
    payee_name,
    payee_email,
    invoice_total,
    amount_paid,
    balance_remaining,
    period_date,
    period_year,
    period_month,
    paid_status,
    payment_stage,
    invoice_number,
    raw: f,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const startedAt = new Date();
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Two accepted callers: pg_cron (service-role bearer) and admin JWT.
    const isCron = token === serviceRoleKey;
    if (!isCron) {
      const authed = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claims, error: claimsErr } = await authed.auth.getClaims(token);
      if (claimsErr || !claims?.claims?.sub) {
        return json({ error: "Unauthorized" }, 401);
      }
      const svc = createClient(supabaseUrl, serviceRoleKey);
      const { data: roleRow } = await svc
        .from("user_roles")
        .select("role")
        .eq("user_id", claims.claims.sub as string)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) return json({ error: "Forbidden: admins only" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: configRow, error: configErr } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "airtable_payables_field_config")
      .maybeSingle();
    if (configErr || !configRow?.value) {
      return json(
        { error: "Config missing: app_settings.airtable_payables_field_config" },
        500,
      );
    }
    const config = configRow.value as PayablesConfig;

    // Open a sync-log row; we UPDATE it with results at the end.
    const { data: logRow, error: logStartErr } = await admin
      .from("payables_sync_log")
      .insert({ started_at: startedAt.toISOString() })
      .select("id")
      .single();
    if (logStartErr || !logRow) {
      return json(
        { error: `Failed to open sync log: ${logStartErr?.message ?? "unknown"}` },
        500,
      );
    }
    const logId = logRow.id as string;

    const pat = Deno.env.get("AIRTABLE_PAT");
    if (!pat) {
      await admin
        .from("payables_sync_log")
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          errors: { fatal: "AIRTABLE_PAT not set" },
        })
        .eq("id", logId);
      return json({ error: "AIRTABLE_PAT not set" }, 500);
    }

    // Schema-guard: verify every mapped field ID still exists in Kieran's
    // base. Field renames are invisible (we key on ID); deletes are caught
    // here and raised as admin_alerts.
    const alerts: Array<{ kind: string; source: string; detail: unknown }> = [];
    const metaRes = await fetch(
      `https://api.airtable.com/v0/meta/bases/${config.base_id}/tables`,
      { headers: { Authorization: `Bearer ${pat}` } },
    );
    if (!metaRes.ok) {
      alerts.push({
        kind: "sync_failure",
        source: "airtable_payables",
        detail: {
          field_id: "metadata_fetch",
          message: `Metadata API ${metaRes.status}`,
        },
      });
    } else {
      const meta = (await metaRes.json()) as { tables: MetaTable[] };
      const byTable: Record<string, Set<string>> = {};
      for (const t of meta.tables) {
        byTable[t.id] = new Set(t.fields.map((x) => x.id));
      }
      for (const src of SOURCE_KEYS) {
        const cfg = config.sources[src];
        if (!cfg) continue;
        const present = byTable[cfg.table_id];
        if (!present) {
          alerts.push({
            kind: "schema_drift",
            source: "airtable_payables",
            detail: {
              field_id: cfg.table_id,
              source_table: src,
              message: `Table ${cfg.table_id} not found on base`,
            },
          });
          continue;
        }
        for (const [role, fldId] of Object.entries(cfg.fields)) {
          if (!fldId) continue;
          if (!present.has(fldId)) {
            alerts.push({
              kind: "schema_drift",
              source: "airtable_payables",
              detail: {
                field_id: fldId,
                source_table: src,
                role,
                message: `Field ${fldId} missing on ${cfg.table_id}`,
              },
            });
          }
        }
      }
    }

    // Per-source fetch, normalize, upsert. Per-source failures are logged
    // but never abort the whole run — one bad table shouldn't wipe the
    // others.
    const counts: Record<string, { fetched: number; upserted: number; deleted: number }> = {};
    const errors: Record<string, string> = {};
    // Diagnostic: one paid/partial row per source (falls back to first
    // record). Shows exactly what Airtable is returning for amount_paid /
    // balance so we can tell field-missing (data reality) from
    // normalization bug (code) at a glance.
    const debug: Record<string, unknown> = {};

    for (const source of SOURCE_KEYS) {
      const cfg = config.sources[source];
      if (!cfg) {
        errors[source] = "No config for source";
        continue;
      }
      counts[source] = { fetched: 0, upserted: 0, deleted: 0 };
      try {
        const records = await fetchAllRecords(
          config.base_id,
          cfg.table_id,
          Object.values(cfg.fields),
          pat,
        );
        counts[source].fetched = records.length;

        // Debug capture BEFORE upsert so we always have the raw signal.
        if (records.length) {
          const paidLike = records.find((r) => {
            const s = r.fields[cfg.fields.paid_status];
            const str = Array.isArray(s) ? s[0] : s;
            return (
              typeof str === "string" &&
              (str.includes("YES") || str.includes("PARTIAL"))
            );
          });
          const sample = paidLike ?? records[0];
          debug[source] = {
            record_id: sample.id,
            was_paid_like: !!paidLike,
            fields_present: Object.keys(sample.fields),
            paid_status_raw: sample.fields[cfg.fields.paid_status] ?? "ABSENT",
            invoice_total_raw: sample.fields[cfg.fields.invoice_total] ?? "ABSENT",
            amount_paid_raw: cfg.fields.amount_paid
              ? sample.fields[cfg.fields.amount_paid] ?? "ABSENT"
              : "NOT_MAPPED",
            balance_raw: cfg.fields.balance
              ? sample.fields[cfg.fields.balance] ?? "ABSENT"
              : "NOT_MAPPED",
          };
        }

        const rows = records.map((r) => normalizeRecord(source, cfg.fields, r));

        if (rows.length) {
          const { error: upErr } = await admin
            .from("payables_snapshot")
            .upsert(rows, { onConflict: "airtable_record_id" });
          if (upErr) {
            errors[source] = `Upsert failed: ${upErr.message}`;
            continue;
          }
          counts[source].upserted = rows.length;
        }

        // Delete-on-sync: fetch existing IDs for this source, diff, delete.
        // Set-diff avoids URL-length limits from long NOT-IN clauses.
        const { data: existing } = await admin
          .from("payables_snapshot")
          .select("airtable_record_id")
          .eq("source_table", source);
        const existingIds = new Set(
          (existing ?? []).map((r: { airtable_record_id: string }) => r.airtable_record_id),
        );
        const currentIds = new Set(rows.map((r) => r.airtable_record_id as string));
        const toDelete = [...existingIds].filter((id) => !currentIds.has(id));
        if (toDelete.length) {
          const { error: delErr } = await admin
            .from("payables_snapshot")
            .delete()
            .in("airtable_record_id", toDelete);
          if (delErr) errors[source] = `Delete pruning failed: ${delErr.message}`;
          else counts[source].deleted = toDelete.length;
        }
      } catch (e) {
        errors[source] = e instanceof Error ? e.message : String(e);
      }
    }

    // Persist alerts. Partial UNIQUE(kind, source, detail->>'field_id')
    // WHERE resolved_at IS NULL prevents duplicates across cycles; a
    // 23505 unique_violation is the expected no-op path.
    for (const a of alerts) {
      const { error } = await admin.from("admin_alerts").insert({
        kind: a.kind,
        source: a.source,
        detail: a.detail,
      });
      if (error && error.code !== "23505") {
        console.warn("[payables-sync] alert insert failed:", error.message);
      }
    }

    const totalUpserted = Object.values(counts).reduce((s, c) => s + c.upserted, 0);
    const totalDeleted = Object.values(counts).reduce((s, c) => s + c.deleted, 0);
    const ok = Object.keys(errors).length === 0;

    await admin
      .from("payables_sync_log")
      .update({
        finished_at: new Date().toISOString(),
        ok,
        records_upserted: totalUpserted,
        records_deleted: totalDeleted,
        errors: Object.keys(errors).length ? errors : null,
        alerts_raised: alerts.length,
      })
      .eq("id", logId);

    return json(
      {
        log_id: logId,
        ok,
        counts,
        errors,
        alerts_raised: alerts.length,
        duration_ms: Date.now() - startedAt.getTime(),
        debug,
      },
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[payables-sync]", msg);
    return json({ error: msg }, 500);
  }
});
