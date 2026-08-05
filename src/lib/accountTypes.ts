/**
 * Which account types each admin surface is about.
 *
 * Shared so a page and anything counting for it can't drift apart. They did:
 * the Clients sidebar badge counted every account row, so adding a team member
 * showed "1 new client".
 */
export const CLIENT_ACCOUNT_TYPES = ["partnership", "project"] as const;
export const TEAM_ACCOUNT_TYPES = ["team"] as const;
