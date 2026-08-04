// The Anthropic model id for the Sales Director module — ONE place, so moving a
// generation is a one-line change. Access verified against GET /v1/models
// (2026-08-04): claude-sonnet-5 is available to this key.
//
// Note: claude-sonnet-4-6 was historically an INVALID id in this project and
// always 400'd (see parse-document). Do not "upgrade" by guessing an id — check
// GET https://api.anthropic.com/v1/models first.
export const SALES_MODEL = "claude-sonnet-5";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/** Transient statuses worth retrying (same set as draft-sales-pitch). */
export const TRANSIENT_STATUSES = [429, 500, 502, 503, 529];
