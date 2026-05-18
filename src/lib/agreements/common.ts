// Reserved for clauses or notice items shared between SSS-CA-PROJECT-v3.0
// and the forthcoming SSS-CA-PARTNERSHIP-v3.0. Intentionally empty at v3.0
// — every clause currently lives inside `project-v3.ts` verbatim. When
// Partnership content is supplied and substantial overlap with Project is
// identified, the duplicated clauses move here and both schedule files
// import them.
//
// Do not pre-emptively factor here. Wait until the Partnership content
// arrives and the actual overlap is known.

import type { PartyBlock } from "./types";

// Hardcoded studio party block — Silvershadow Studio Ltd. Shared by both
// schedules since the studio identity is the same regardless of the
// engagement model.
export const STUDIO_PARTY: PartyBlock = {
  legalName: "Silvershadow Studio Ltd",
  country: "England & Wales",
  registrationNumber: "09178937",
  registeredAddress: "332 Ladbroke Grove, London W10 5AD",
};
