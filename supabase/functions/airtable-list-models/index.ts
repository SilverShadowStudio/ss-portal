import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  if (v && typeof v === "object" && "name" in (v as Record<string, unknown>)) {
    const name = (v as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }
  return null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

function normalize(rec: AirtableRecord) {
  const f = rec.fields;
  return {
    id: rec.id,
    modelName: pickString(f["Model Name"]),
    modeller: pickString(f["Modeller"]),
    status: pickString(f["Status"]),
    approvalStatus: pickString(f["Approval Status"]),
    instructions: pickString(f["Instructions"]),
    deadline: pickString(f["Deadline"]),
    modelCost: pickNumber(f["Model Cost"]),
    budgetedHours: pickNumber(f["Budgeted Hours"]),
    clientFacingStatus: pickString(f["Client Facing Status"]),
    referenceFolderUrl: pickString(f["Reference Folder Link"]),
    productUrl: pickString(f["Product Link"]),
  };
}

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authedClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await authedClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;
    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roleRow } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admins only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("force_refresh") === "true";

    const pat = Deno.env.get("AIRTABLE_PAT");
    const baseId = Deno.env.get("AIRTABLE_BASE_ID");
    const tableId = Deno.env.get("AIRTABLE_TABLE_ID");
    if (!pat || !baseId || !tableId) {
      return new Response(
        JSON.stringify({ error: "Airtable secrets not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cacheKey = `${baseId}:${tableId}`;
    const now = Date.now();
    if (!forceRefresh) {
      const hit = cache.get(cacheKey);
      if (hit && hit.expiresAt > now) {
        return new Response(JSON.stringify(hit.data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const all: AirtableRecord[] = [];
    let offset: string | undefined = undefined;
    let pages = 0;
    do {
      const u = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
      u.searchParams.set("pageSize", "100");
      if (offset) u.searchParams.set("offset", offset);
      const r: Response = await fetch(u.toString(), {
        headers: { Authorization: `Bearer ${pat}` },
      });
      if (!r.ok) {
        const txt = await r.text();
        return new Response(
          JSON.stringify({ error: `Airtable API ${r.status}: ${txt}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const j = (await r.json()) as { records: AirtableRecord[]; offset?: string };
      all.push(...j.records);
      offset = j.offset;
      pages++;
    } while (offset && pages < 10);

    const payload = {
      records: all.map(normalize),
      cachedAt: new Date(now).toISOString(),
      count: all.length,
    };
    cache.set(cacheKey, { data: payload, expiresAt: now + CACHE_TTL_MS });

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[airtable-list-models]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});