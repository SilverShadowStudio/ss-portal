// Entry point for the v3.0 agreement family.
//
// `getAgreement()` is pure: it takes a schedule + client party block +
// effective date and returns the assembled AgreementDocument. No DB calls,
// no network, no side effects. The Contract.tsx page and the
// `accept-agreement` / `preview-agreement-pdf` edge functions all call this
// to get the same document tree, so the rendered HTML and generated PDF
// match exactly.
//
// `SUPPORTED_AGREEMENT_VERSIONS` is the set of versions the route-level
// gate accepts as "active". Clients with a signed agreement whose
// `agreement_version` is not in this set are sent back to /contract to
// re-accept the current version. When v3.1 ships, bump this constant only
// after the re-acceptance UX in Contract.tsx is built (see the route-gate
// TODO in App.tsx).

import type { AgreementDocument, GetAgreementInput } from "./types";
import { buildProjectV3Document, PROJECT_V3_VERSION } from "./project-v3";
import { buildPartnershipV3Document, PARTNERSHIP_V3_VERSION } from "./partnership-v3";

export const SUPPORTED_AGREEMENT_VERSIONS = [
  PROJECT_V3_VERSION,
  PARTNERSHIP_V3_VERSION,
] as const;

export type SupportedAgreementVersion = (typeof SUPPORTED_AGREEMENT_VERSIONS)[number];

export function isSupportedAgreementVersion(v: string | null | undefined): boolean {
  if (!v) return false;
  return (SUPPORTED_AGREEMENT_VERSIONS as readonly string[]).includes(v);
}

/**
 * Build the agreement document for a given schedule.
 * Returns `null` for partnership until SSS-CA-PARTNERSHIP-v3.0 is supplied.
 * Callers must handle the null case.
 */
export function getAgreement(input: GetAgreementInput): AgreementDocument | null {
  if (input.schedule === "project") {
    return buildProjectV3Document({
      client: input.client,
      effectiveDate: input.effectiveDate,
    });
  }
  return buildPartnershipV3Document({
    client: input.client,
    effectiveDate: input.effectiveDate,
  });
}

export { PROJECT_V3_VERSION, PARTNERSHIP_V3_VERSION };
export * from "./types";
