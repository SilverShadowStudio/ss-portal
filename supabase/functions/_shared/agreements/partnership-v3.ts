// SSS-CA-PARTNERSHIP-v3.0 — Placeholder.
//
// The Partnership schedule content is not yet finalised. Until it is supplied,
// `buildPartnershipV3Document()` returns null and callers must handle that
// case — typically by rendering a "Partnership agreement is being prepared.
// Please contact the studio." message rather than crashing.
//
// TODO(partnership-v3): replace this placeholder with the full agreement
// content once SSS-CA-PARTNERSHIP-v3.0 is supplied. Structure should mirror
// project-v3.ts exactly — same Clause / Paragraph / NoticeItem types, same
// AgreementDocument shape, schedule: "partnership".

import type { AgreementDocument, ClientPartyInput } from "./types.ts";

export const PARTNERSHIP_V3_VERSION = "SSS-CA-PARTNERSHIP-v3.0";

export function buildPartnershipV3Document(_input: {
  client: ClientPartyInput;
  effectiveDate: string;
}): AgreementDocument | null {
  return null;
}
