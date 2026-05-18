// MIRROR — keep in sync with src/lib/agreements/types.ts.
// Edge functions cannot import from src/ (Vite-only). When the React-side
// agreements library changes, copy the files across so the rendered PDF
// matches what the client sees on /contract.

// Structured types for the Client Agreement v3.0 family of documents.
// Every clause is a structured object (not a markdown blob) so that:
//  - The Contract.tsx page can render the document with full visual control.
//  - The accept-agreement and preview-agreement-pdf edge functions can build
//    identical PDFs from the same source.
//  - Changes are reviewable as code, not as prose diffs.
//
// Naming reconciliation: the brief refers to `signed_by_name` /
// `signed_by_position`. The live `agreements` table uses
// `signatory_name` / `signatory_position` (older naming). The code uses the
// existing DB column names everywhere; no aliases are introduced.

export type Paragraph =
  | { type: "prose"; text: string }
  | { type: "bullet_list"; items: string[] }
  | { type: "definition"; term: string; text: string }
  | { type: "note"; text: string };

export interface Clause {
  number: string;
  title: string;
  paragraphs: Paragraph[];
}

export interface NoticeItem {
  clauseRef: string;
  text: string;
}

export interface PartyBlock {
  legalName: string;
  country?: string | null;
  registrationNumber?: string | null;
  registeredAddress?: string | null;
}

export interface AgreementDocument {
  version: string;
  schedule: "project" | "partnership";
  cover: {
    studio: PartyBlock;
    client: PartyBlock;
    effectiveDate: string;
    engagementModel: string;
    footer: string;
  };
  notice: {
    heading: string;
    intro: string;
    items: NoticeItem[];
    closing: string;
  };
  clauses: Clause[];
  execution: {
    intro: string;
    confirmation: string;
  };
}

export interface ClientPartyInput {
  legalName: string;
  country?: string | null;
  registrationNumber?: string | null;
  registeredAddress?: string | null;
}

export interface GetAgreementInput {
  schedule: "project" | "partnership";
  client: ClientPartyInput;
  /** ISO date or display date (server-set at acceptance). */
  effectiveDate: string;
}
