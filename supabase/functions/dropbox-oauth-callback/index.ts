import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { verifyStatePayload } from "../_shared/signedState.ts";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const dropboxAppKey = Deno.env.get("DROPBOX_APP_KEY")!;
    const dropboxAppSecret = Deno.env.get("DROPBOX_APP_SECRET")!;

    const frontendUrl = "https://portal.silvershadowstudio.com";

    if (error) {
      console.error("Dropbox OAuth error:", error);
      return Response.redirect(`${frontendUrl}/admin?dropbox_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return Response.redirect(`${frontendUrl}/admin?dropbox_error=missing_params`);
    }

    // Verify HMAC signature and decode state (signed by dropbox-oauth-start).
    const stateData = await verifyStatePayload(dropboxAppSecret, state);
    if (!stateData) {
      return Response.redirect(`${frontendUrl}/admin?dropbox_error=invalid_state`);
    }
    if (Date.now() > (stateData.exp as number)) {
      return Response.redirect(`${frontendUrl}/admin?dropbox_error=state_expired`);
    }

    const userId = stateData.userId;
    console.log("Processing OAuth callback for user:", userId);

    // Exchange code for tokens
    const redirectUri = `${supabaseUrl}/functions/v1/dropbox-oauth-callback`;
    const tokenResponse = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${dropboxAppKey}:${dropboxAppSecret}`)}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return Response.redirect(`${frontendUrl}/admin?dropbox_error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    // SECURITY: Only log account_id, never log access_token or refresh_token
    console.log("Token exchange successful for account:", tokenData.account_id);

    // Calculate token expiry
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    // Store tokens in database
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: upsertError } = await supabase
      .from("dropbox_connections")
      .upsert({
        user_id: userId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        account_id: tokenData.account_id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id",
      });

    if (upsertError) {
      console.error("Failed to store tokens:", upsertError);
      return Response.redirect(`${frontendUrl}/admin?dropbox_error=storage_failed`);
    }

    console.log("Dropbox connection stored successfully for user:", userId);
    return Response.redirect(`${frontendUrl}/admin?dropbox_connected=true`);
  } catch (error) {
    console.error("Error in dropbox-oauth-callback:", error);
    const frontendUrl = "https://ss-client.lovable.app";
    return Response.redirect(`${frontendUrl}/admin?dropbox_error=internal_error`);
  }
});
