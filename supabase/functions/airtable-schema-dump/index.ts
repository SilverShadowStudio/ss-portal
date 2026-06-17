// airtable-schema-dump/index.ts
// Diagnostic only — returns full Airtable base schema for boundary mapping.
// Not called from any portal flow. Deployed with --no-verify-jwt.

Deno.serve(async () => {
  const pat = Deno.env.get("AIRTABLE_PAT");
  const baseId = Deno.env.get("AIRTABLE_BASE_ID");

  if (!pat || !baseId) {
    return new Response(
      JSON.stringify({ error: "AIRTABLE_PAT or AIRTABLE_BASE_ID not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${pat}` },
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});
