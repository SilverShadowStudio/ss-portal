import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Cache ────────────────────────────────────────────────────────────────────
type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Manager colours ──────────────────────────────────────────────────────────
// Design-spec fixed colours for known managers (first-name match, case-insensitive).
const NAMED_COLORS: Record<string, string> = {
  katerina: "#8a76ad",
  fiodor:   "#4f9aa3",
  may:      "#b0604f",
};

// Fallback palette — luminance-bumped for readability as a 7 px dot on #14110d.
const FALLBACK_PALETTE = [
  "#8a70c0", // violet
  "#45b08a", // teal
  "#c07845", // amber
  "#6a8fc0", // steel blue
  "#c09a50", // warm gold
  "#70b070", // sage
  "#c05580", // rose
];

function resolveManagerColor(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().toLowerCase().split(/\s+/)[0];
  if (NAMED_COLORS[first]) return NAMED_COLORS[first];
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return FALLBACK_PALETTE[sum % FALLBACK_PALETTE.length];
}

// ─── Field helpers ────────────────────────────────────────────────────────────
function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  if (v && typeof v === "object" && "name" in (v as Record<string, unknown>)) {
    const n = (v as Record<string, unknown>).name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return null;
}

// Try common Airtable name-field patterns, then fall back to first non-empty string.
function resolveUserName(fields: Record<string, unknown>): string | null {
  for (const key of ["Name", "Full name", "Full Name", "name"]) {
    const v = pickString(fields[key]);
    if (v) return v;
  }
  const first = pickString(fields["First name"] ?? fields["First Name"]);
  const last  = pickString(fields["Last name"]  ?? fields["Last Name"]);
  if (first || last) return `${first ?? ""} ${last ?? ""}`.trim();
  for (const v of Object.values(fields)) {
    const s = pickString(v);
    if (s) return s;
  }
  return null;
}

// ─── Airtable pagination ──────────────────────────────────────────────────────
type AirtableRecord = { id: string; fields: Record<string, unknown> };

async function paginatedList(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;
  let pages = 0;
  do {
    const u = new URL(baseUrl);
    u.searchParams.set("pageSize", "100");
    if (offset) u.searchParams.set("offset", offset);
    const r = await fetch(u.toString(), { headers });
    if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { records: AirtableRecord[]; offset?: string };
    all.push(...j.records);
    offset = j.offset;
    pages++;
  } while (offset && pages < 20);
  return all;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Admin gate (mirrors airtable-list-models auth pattern)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
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
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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

    // Airtable secrets
    const pat    = Deno.env.get("AIRTABLE_PAT");
    const baseId = Deno.env.get("AIRTABLE_BASE_ID");
    if (!pat || !baseId) {
      return new Response(JSON.stringify({ error: "Airtable secrets not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache check
    const reqUrl       = new URL(req.url);
    const forceRefresh = reqUrl.searchParams.get("force_refresh") === "true";
    const cacheKey     = `${baseId}:tasks_overlay`;
    const now          = Date.now();
    if (!forceRefresh) {
      const hit = cache.get(cacheKey);
      if (hit && hit.expiresAt > now) {
        return new Response(JSON.stringify(hit.data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const atHeaders  = { Authorization: `Bearer ${pat}` };
    const TASKS_TABLE = "tbleHaU9DxHyvixdL";

    // ── 1. Metadata: resolve Users table ID from Accountable-to linked field ──
    let usersTableId: string | null = null;
    try {
      const metaRes = await fetch(
        `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
        { headers: atHeaders },
      );
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as {
          tables: Array<{
            id: string;
            fields: Array<{
              name: string;
              type: string;
              options?: { linkedTableId?: string };
            }>;
          }>;
        };
        const tasksTable = meta.tables.find((t) => t.id === TASKS_TABLE);
        const accountableField = tasksTable?.fields.find(
          (f) =>
            f.name.toLowerCase().includes("accountable") &&
            f.type === "multipleRecordLinks",
        );
        usersTableId = accountableField?.options?.linkedTableId ?? null;
        console.log(`[timeline-airtable-overlay] Users table ID resolved: ${usersTableId ?? "not found"}`);
      }
    } catch (e) {
      console.warn("[timeline-airtable-overlay] metadata fetch failed:", e);
    }

    // ── 2. Fetch Tasks table (Deadline + Accountable to + Status) ─────────────
    const taskUrl = new URL(`https://api.airtable.com/v0/${baseId}/${TASKS_TABLE}`);
    taskUrl.searchParams.append("fields[]", "Deadline");
    taskUrl.searchParams.append("fields[]", "Accountable to");
    taskUrl.searchParams.append("fields[]", "Status");
    const tasks = await paginatedList(taskUrl.toString(), atHeaders);
    console.log(`[timeline-airtable-overlay] tasks fetched: ${tasks.length}`);

    // ── 3. Collect unique user record IDs referenced by Accountable-to ────────
    const userRecordIds = new Set<string>();
    for (const t of tasks) {
      const accountable = t.fields["Accountable to"];
      if (Array.isArray(accountable)) {
        for (const id of accountable) {
          if (typeof id === "string") userRecordIds.add(id);
        }
      }
    }
    console.log(`[timeline-airtable-overlay] unique user record IDs: ${userRecordIds.size}`);

    // ── 4. Fetch Users table for name resolution ───────────────────────────────
    const userMap = new Map<string, string>(); // Airtable record ID → display name
    if (usersTableId && userRecordIds.size > 0) {
      try {
        const userRecords = await paginatedList(
          `https://api.airtable.com/v0/${baseId}/${usersTableId}`,
          atHeaders,
        );
        for (const rec of userRecords) {
          if (userRecordIds.has(rec.id)) {
            const name = resolveUserName(rec.fields);
            if (name) userMap.set(rec.id, name);
          }
        }
        console.log(`[timeline-airtable-overlay] users resolved: ${userMap.size} / ${userRecordIds.size}`);
      } catch (e) {
        console.warn("[timeline-airtable-overlay] users table fetch failed:", e);
      }
    }

    // ── 5. Build overlay keyed by Airtable task record ID ─────────────────────
    type OverlayEntry = {
      deadline:     string | null;
      managerName:  string | null;
      managerColor: string | null;
      status:       string | null;
    };
    const overlay: Record<string, OverlayEntry> = {};
    let deadlineCount          = 0;
    let resolvedManagerCount   = 0;

    for (const t of tasks) {
      const deadlineRaw = t.fields["Deadline"];
      let deadline: string | null = null;
      if (typeof deadlineRaw === "string" && deadlineRaw) {
        deadline = deadlineRaw.slice(0, 10); // date-only YYYY-MM-DD
        deadlineCount++;
      }

      const accountable = t.fields["Accountable to"];
      let managerName: string | null = null;
      if (Array.isArray(accountable) && accountable.length > 0 && typeof accountable[0] === "string") {
        managerName = userMap.get(accountable[0]) ?? null;
      }
      if (managerName) resolvedManagerCount++;

      overlay[t.id] = {
        deadline,
        managerName,
        managerColor: resolveManagerColor(managerName),
        status: pickString(t.fields["Status"]),
      };
    }

    const payload = {
      overlay,
      cachedAt: new Date(now).toISOString(),
      taskCount:             tasks.length,
      deadlineCount,
      resolvedManagerCount,
    };
    cache.set(cacheKey, { data: payload, expiresAt: now + CACHE_TTL_MS });

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[timeline-airtable-overlay]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
