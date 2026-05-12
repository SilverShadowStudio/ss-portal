import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const dropboxAppKey = Deno.env.get("DROPBOX_APP_KEY");

    if (!dropboxAppKey) {
      return new Response(
        JSON.stringify({ error: "Dropbox App Key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the user is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use anon key client for user auth validation
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    // Use service role for privileged operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);

    if (userError || !user) {
      console.error("Auth error:", userError?.message || "No user found");
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate state parameter for CSRF protection
    const state = crypto.randomUUID();
    
    // Store state in database temporarily (we'll clean it up in callback)
    // For simplicity, encode user_id and state together
    const statePayload = btoa(JSON.stringify({ userId: user.id, state, exp: Date.now() + 600000 }));

    // Parse optional reconnect flag from request body
    let reconnect = false;
    try {
      const body = await req.json().catch(() => ({}));
      reconnect = !!body.reconnect;
    } catch { /* no body is fine */ }

    // Build Dropbox OAuth URL
    const redirectUri = `${supabaseUrl}/functions/v1/dropbox-oauth-callback`;
    const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
    authUrl.searchParams.set("client_id", dropboxAppKey);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("token_access_type", "offline"); // Get refresh token
    authUrl.searchParams.set("state", statePayload);
    if (reconnect) {
      // Force Dropbox to show the consent screen so a new token is issued with current scopes
      authUrl.searchParams.set("force_reapprove", "true");
    }

    console.log("Generated Dropbox OAuth URL for user:", user.id);

    return new Response(
      JSON.stringify({ authUrl: authUrl.toString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in dropbox-oauth-start:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
