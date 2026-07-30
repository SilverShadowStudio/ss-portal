// _shared/signedState.ts
//
// HMAC-SHA256 helpers (WebCrypto, no deps) for two callers:
//   * dropbox-webhook — verify Dropbox's X-Dropbox-Signature over the raw
//     request body (keyed on DROPBOX_APP_SECRET, hex encoded, per Dropbox docs).
//   * dropbox-oauth-start / -callback — sign the OAuth state payload so the
//     callback can reject forged or tampered state. Format:
//     base64(json) + "." + hex(hmac(base64(json))).

import { constantTimeEqual } from "./cronAuth.ts";

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signStatePayload(
  secret: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const encoded = btoa(JSON.stringify(payload));
  const sig = await hmacSha256Hex(secret, encoded);
  return `${encoded}.${sig}`;
}

/** Returns the decoded payload, or null when the signature is missing/invalid. */
export async function verifyStatePayload(
  secret: string,
  state: string,
): Promise<Record<string, unknown> | null> {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = await hmacSha256Hex(secret, encoded);
  if (!constantTimeEqual(expected, sig)) return null;
  try {
    return JSON.parse(atob(encoded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
