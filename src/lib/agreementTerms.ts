// Single source of truth for the Silver Shadow Studio Client Agreement.
// Rendered in the portal at signup and server-side into the signed PDF.

// CHANGELOG:
//   v2.1 (2026-05-18) — Project payment terms updated: 50/50 split (was 40/60),
//     deposit Net 7 max 7 days before start (was vague "on commencement"),
//     balance Net 14 (was Net 30). Clause 2 and Clause 6 amended.
//   v2.0 — Initial published version.
export const CURRENT_AGREEMENT_VERSION = "SSS-CA-v2.1";

export const ACCEPTANCE_CHECKBOX_TEXT =
  "I confirm that I am authorised to bind the Client and agree to the Silver Shadow Studio Client Agreement on behalf of the Client. I understand that every order I place through the platform is a binding transaction under these terms.";

export interface AgreementSection {
  number: string;
  title: string;
  body: string[];
}

export const AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    number: "1",
    title: "WHO WE ARE AND WHAT WE DO",
    body: [
      "Silver Shadow Studio is an architectural and interior visualisation studio based in London. We produce CGI stills, VR, film, and related visual content for interior designers, developers, and architects worldwide.",
      "You get access to our full production capability: 3D modelling, rendering, post-production, asset libraries, and a dedicated project manager throughout your engagement.",
    ],
  },
  {
    number: "2",
    title: "HOW WORK GETS DEFINED",
    body: [
      "Every piece of work begins with an order confirmation. This is either a monthly lane subscription or a project order. You see the scope and the price in your portal and confirm with a single click. That confirmation is a binding order under this agreement.",
      "Subscription — Lanes: A Lane is one unit of dedicated production capacity, equivalent to a full-time visualiser working eight hours a day, five days a week. You subscribe to the number of Lanes that matches your workload. Each Lane runs one active task at a time. When a task is complete, the next begins immediately. There is no cap on requests or complexity.",
      "Project — Per Order: A project order defines a specific scope — the scenes, cameras, rounds of review, and total fee. Work begins on the agreed project start date, subject to confirmation of the order and receipt of the deposit invoice.",
    ],
  },
  {
    number: "3",
    title: "DELIVERY",
    body: [
      "Work is delivered progressively as tasks and scenes are completed. Files are shared live through your portal and via Dropbox or equivalent.",
      "Delivery timelines are estimates. Complexity, scope changes, and delays in your feedback all affect timing.",
      "Each round of production requires a minimum of one calendar week from receipt of all required instructions. Once a round is in progress, no new instructions may be introduced — additional input is addressed in the next round.",
    ],
  },
  {
    number: "4",
    title: "WHAT WE NEED FROM YOU",
    body: [
      "• Provide complete briefs before work begins on each task or scene.",
      "• Supply all required drawings, specifications, finishes schedules, and reference material.",
      "• Consolidate feedback from all stakeholders into a single structured response.",
      "• Respond within five working days of delivery. Silence beyond five working days constitutes approval. Changes after approval are a new order.",
      "• If you provide no feedback or communication for more than 30 calendar days, we may terminate the project, invoice for work completed at pro-rata value, and require a new order to recommence.",
    ],
  },
  {
    number: "5",
    title: "REVISIONS AND SCOPE",
    body: [
      "Revisions within the agreed scope of a task or scene are included — a different camera angle, adjusted lighting, a material swap.",
      "A revision becomes a new order when it requires a fundamentally different direction, new asset creation outside the original scope, or contradicts previously approved decisions. We will always flag this before proceeding.",
      "Formal approval — by click, email, or written confirmation — closes the task or scene.",
    ],
  },
  {
    number: "6",
    title: "FEES AND PAYMENT",
    body: [
      "Subscription: Monthly, upfront, aligned to calendar months. Adding Lanes mid-month is billed pro rata. Reducing Lanes requires 30 days written notice — all Lanes remain billable throughout. All subscription fees are non-refundable once a billing period commences.",
      "Project: 50% deposit invoice issued on quotation acceptance, due within 7 days of receipt and in any event no later than 7 days before the agreed project start date. Work commences on the agreed start date subject to receipt of the deposit. The remaining 50% balance invoice is issued on final delivery, due within 14 days of receipt. Deliverables are released against payment of the balance invoice.",
      "All orders: Fees are exclusive of VAT. Late payment accrues interest at 5% per annum above the Bank of England base rate, applied every 10 days. Non-payment entitles us to suspend platform access and withhold delivery.",
    ],
  },
  {
    number: "7",
    title: "WHAT YOU OWN",
    body: [
      "On full payment, you own the final deliverables with full commercial usage rights.",
      "We retain ownership of all underlying assets — 3D models, scenes, textures, lighting setups, technical data, workflows, processes, and the platform itself. These are never transferred.",
      "We retain the right to feature completed work in our portfolio and marketing. Request confidentiality in writing before your order is confirmed.",
      "You warrant that materials you supply do not infringe third-party rights and indemnify us against any related claims.",
    ],
  },
  {
    number: "8",
    title: "WHAT YOU CANNOT DO WITH OUR WORK",
    body: [
      "The following are prohibited without our prior written consent:",
      "• Use deliverables to train, develop, or feed any artificial intelligence system, generative tool, or dataset — in any form, direct or indirect. Breach is a material breach of this agreement.",
      "• Provide deliverables or production files to a competing studio or third-party production house.",
      "• Resell or distribute deliverables in editable or source format.",
      "• Reverse engineer any content, tool, or workflow accessed through the platform.",
      "• Use deliverables outside the scope confirmed in your order.",
    ],
  },
  {
    number: "9",
    title: "CONFIDENTIALITY",
    body: [
      "Both parties treat each other's non-public information as confidential for the duration of the engagement and three years thereafter.",
      "You may identify Silver Shadow Studio as your visualisation studio. Pricing, workflows, and portal contents are confidential and not to be shared without our written consent.",
      "We treat all materials you provide with strict confidentiality. Our team operates under internal NDAs. All rendering is processed on our in-house infrastructure.",
    ],
  },
  {
    number: "10",
    title: "PLATFORM",
    body: [
      "Your account is personal to your company — non-exclusive, non-transferable, and revocable. You are responsible for all users under your account.",
      "Any confirmation, approval, or instruction given through the platform is legally binding. Platform records are conclusive.",
      "We provide the platform in good faith but do not guarantee uninterrupted access. We are not liable for downtime or data loss outside our control.",
    ],
  },
  {
    number: "11",
    title: "LIABILITY",
    body: [
      "Our total liability is capped at three months of fees paid in the twelve months before the claim.",
      "We are not liable for indirect or consequential losses — lost profit, revenue, data, or business opportunity.",
      "Nothing here limits liability for death or personal injury caused by negligence, or for fraud.",
    ],
  },
  {
    number: "12",
    title: "NON-SOLICITATION",
    body: [
      "During this agreement and for twelve months after it ends, you agree not to approach, solicit, employ, or engage any member of our team — directly or through a third party.",
      "Breach carries a fee equivalent to six months of that individual's total compensation, payable on demand.",
    ],
  },
  {
    number: "13",
    title: "ENDING THE AGREEMENT",
    body: [
      "Subscription: Either party may end the subscription with 30 days written notice. All lanes remain active and billable throughout.",
      "Project: Either party may terminate for material breach unremedied after 30 days notice. Completed work is delivered on receipt of fees owed.",
      "All clients: We may suspend or terminate access immediately for non-payment, breach of clause 8, or conduct threatening our intellectual property. Clauses 7, 8, 9, 11, and 12 survive termination.",
    ],
  },
  {
    number: "14",
    title: "GENERAL",
    body: [
      "• Email notices are valid and received at the time of transmission.",
      "• Changes require written consent from both parties. Platform confirmations constitute written consent for commercial orders.",
      "• If any clause is unenforceable, the remainder continues in force.",
      "• You may not transfer your rights without our written consent.",
      "• This is the entire agreement between the parties, superseding all prior discussions.",
      "• No third party has any rights under this agreement.",
      "• Governed by the laws of England and Wales. Exclusive jurisdiction of the courts of England and Wales.",
    ],
  },
];
