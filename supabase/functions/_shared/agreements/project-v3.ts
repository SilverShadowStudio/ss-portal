// SSS-CA-PROJECT-v3.0 — Client Agreement for Project clients.
// Content is verbatim from the Appendix A of the v3.0 implementation brief.
// Every word has been chosen for legal effect — do not paraphrase, do not
// reformat. Punctuation (em-dashes, apostrophes, comma series) matters.

import type {
  AgreementDocument,
  Clause,
  ClientPartyInput,
  NoticeItem,
} from "./types.ts";
import { STUDIO_PARTY } from "./common.ts";

export const PROJECT_V3_VERSION = "SSS-CA-PROJECT-v3.0";

const NOTICE_ITEMS: NoticeItem[] = [
  { clauseRef: "7", text: "what you own and what we retain on completed work." },
  { clauseRef: "8", text: "prohibited uses of our deliverables, including a prohibition on use for artificial intelligence training." },
  { clauseRef: "10", text: "your portal account is binding. Any confirmation given through the portal is a binding contractual instruction." },
  { clauseRef: "11", text: "our liability is capped, and we exclude consequential losses." },
  { clauseRef: "12", text: "non-solicitation of our team carries a liquidated sum." },
];

const CLAUSES: Clause[] = [
  {
    number: "1",
    title: "Who we are and what we do",
    paragraphs: [
      { type: "prose", text: "Silver Shadow Studio is an architectural and interior visualisation studio based in London. We produce CGI stills, virtual reality, film, and related visual content for interior designers, developers, and architects worldwide." },
      { type: "prose", text: "You get access to our full production capability — 3D modelling, rendering, post-production, asset libraries, and a dedicated project manager throughout your engagement." },
    ],
  },
  {
    number: "2",
    title: "Definitions",
    paragraphs: [
      { type: "prose", text: "In this agreement, the following terms have the meanings below." },
      { type: "definition", term: "Order", text: "a confirmed instruction from you to us through the portal, by email, or by signed quotation, for a defined body of work. A signed Quotation is an Order. A confirmation given through the portal is an Order." },
      { type: "definition", term: "Quotation", text: "our written quotation document detailing scope, deliverables, rounds of review, fees, and timeline. Quotations are valid for 30 days from the date issued unless otherwise stated." },
      { type: "definition", term: "Scope", text: "the specification for the deliverables as set out in an accepted Order." },
      { type: "definition", term: "Deliverables", text: "the final approved CGI renders, films, VR experiences, or other visual outputs identified in an Order, in their published formats. Production files (3D scene files, working source files) are not Deliverables." },
      { type: "definition", term: "Round", text: "a single cycle of production and submission within a Scene or Order, beginning when we receive the relevant brief or correction set, and ending when we resubmit the updated Deliverable for your review." },
      { type: "definition", term: "Revision", text: "a change requested within the Scope of an Order — for example a different camera angle, adjusted lighting, or material swap." },
      { type: "definition", term: "Completion", text: "has the meaning given in clause 5." },
      { type: "definition", term: "Client Material", text: "all information, drawings, references, specifications, and other material you provide to us for use in performing the Order." },
      { type: "definition", term: "Business Day", text: "any day other than a Saturday, Sunday, or bank holiday in England." },
      { type: "prose", text: "Headings are for convenience only. References to writing include email and portal confirmations. Words in the singular include the plural and vice versa." },
    ],
  },
  {
    number: "3",
    title: "How work gets defined",
    paragraphs: [
      { type: "prose", text: "Every piece of work begins with an Order. You see the scope and the price in your portal — or in a Quotation we send you — and you confirm. That confirmation, whether by clicking through the portal or by signing the Quotation, is a binding Order under this agreement." },
      { type: "prose", text: "A Quotation becomes binding when (a) you sign it electronically through the portal, or (b) both parties have countersigned it by other written means, and (c) the deposit invoice referenced in clause 7 has been paid." },
      { type: "prose", text: "This agreement governs all Orders placed during its term. Where any conflict arises between this agreement and the terms of a specific Order or Quotation, the Order or Quotation prevails for that engagement only." },
    ],
  },
  {
    number: "4",
    title: "Delivery",
    paragraphs: [
      { type: "prose", text: "Work is delivered progressively as tasks and scenes are completed. Files are shared live through your portal and through Dropbox or an equivalent shared environment. You have access to production files throughout — not only at the end." },
      { type: "prose", text: "Delivery timelines are estimates. Complexity, scope changes, and delays in your feedback all affect timing. We will always communicate proactively if something is going to take longer than indicated." },
      { type: "prose", text: "Each Round of production requires a minimum of one calendar week from receipt of all required instructions. Once a Round is in progress, no new instructions may be introduced — additional input is addressed in the next Round." },
    ],
  },
  {
    number: "5",
    title: "Acceptance and completion",
    paragraphs: [
      { type: "prose", text: "On delivery of any Deliverable, you have seven calendar days to review and provide corrections — meaning deviations from the agreed Scope. We will address corrections promptly and resubmit for further review." },
      { type: "prose", text: "Where the Order specifies a number of permitted Rounds, Completion is deemed to occur on the date we resubmit the Deliverables following the final permitted Round, whether or not further corrections have been submitted." },
      { type: "prose", text: "Where the Order does not limit the number of Rounds, Completion is deemed to occur on the earlier of (a) your written confirmation that the Deliverables are complete, or (b) the expiry of seven calendar days following our resubmission without further corrections from you." },
      { type: "prose", text: "If you provide no feedback or communication for thirty consecutive calendar days following any delivery, the Order is deemed paused. After sixty consecutive days of silence, we may treat the Order as complete at its current stage, invoice the balance pro rata, and require a new Order to recommence the work." },
    ],
  },
  {
    number: "6",
    title: "What we need from you",
    paragraphs: [
      { type: "prose", text: "A visualisation is only as good as the information behind it. We need clear briefs, good reference material, and consolidated feedback. Fragmented or contradictory input costs everyone time." },
      {
        type: "bullet_list",
        items: [
          "Provide complete briefs before work begins on each task or scene.",
          "Supply all required drawings, specifications, finishes schedules, and reference material.",
          "Consolidate feedback from all stakeholders into a single structured response.",
          "Respond within seven calendar days of delivery. Silence beyond seven calendar days constitutes approval. Changes after approval are a new Order.",
          "If you provide no feedback for more than thirty calendar days, the Order may be paused; see clause 5.",
        ],
      },
      { type: "note", text: "Where feedback is fragmented or where a single Order generates an unreasonable volume of micro-revisions, we reserve the right to reclassify the additional work as a new Order and agree scope accordingly. Delays on your side do not suspend or reduce fees properly due." },
    ],
  },
  {
    number: "7",
    title: "Fees and payment",
    paragraphs: [
      { type: "prose", text: "Fees, payment milestones, and any expenses are set out in the applicable Order." },
      { type: "prose", text: "Unless an Order provides otherwise, the following payment structure applies:" },
      {
        type: "bullet_list",
        items: [
          "Fifty per cent of the total fee is invoiced as a deposit on acceptance of the Quotation, due within seven days of receipt of the invoice and in any event no later than seven days before the agreed project start date.",
          "Work commences on the agreed start date, subject to receipt of the deposit.",
          "The remaining fifty per cent is invoiced on final delivery, due within fourteen days of receipt of the balance invoice. Deliverables are released against payment of the balance invoice.",
        ],
      },
      { type: "prose", text: "All fees are exclusive of VAT, which is added at the applicable rate. Invoices are payable in full without deduction, set-off, or counterclaim. Late payment accrues interest, calculated daily, at five per cent per annum above the Bank of England base rate from time to time in force, from the due date until the date of actual payment." },
      { type: "prose", text: "If any sum remains unpaid more than thirty days after the due date, we may suspend services and withhold delivery of any Deliverables until the outstanding amount, including accrued interest, is paid in full." },
    ],
  },
  {
    number: "8",
    title: "What you own",
    paragraphs: [
      { type: "prose", text: "On full payment of all sums due under the relevant Order, we grant you an irrevocable, royalty-free, worldwide, non-exclusive, perpetual, transferable and sub-licensable licence to use, copy, modify, adapt, and commercially exploit the Deliverables for your business purposes, including for the marketing and sale of the project they depict." },
      { type: "prose", text: "We retain ownership of all underlying assets — 3D models, scenes, textures, lighting setups, technical data, workflows, processes, asset libraries, and the portal infrastructure itself. These are never transferred. Production files are retained by us and are not provided to you as a Deliverable except where expressly set out in the Order." },
      { type: "prose", text: "You grant us a non-exclusive, worldwide, royalty-free licence to use, copy, store, and reproduce any Client Material you supply for the purposes of performing the Order. We may sub-licence this right to our subcontractors as required to perform our obligations." },
      { type: "prose", text: "We retain the right to feature completed work in our portfolio and marketing. If you wish to restrict this, you must notify us in writing — by email is sufficient — before, or at any time after, an Order is confirmed. Such notice applies prospectively to materials not yet published; we will make reasonable efforts to remove already-published materials on request." },
      { type: "prose", text: "You warrant that any Client Material you supply does not infringe the rights of any third party, and you indemnify us against any claims arising from our permitted use of that material." },
    ],
  },
  {
    number: "9",
    title: "Prohibited use",
    paragraphs: [
      { type: "prose", text: "Without our prior written consent, you must not:" },
      {
        type: "bullet_list",
        items: [
          "Use the Deliverables, or any production files associated with them, to train, develop, fine-tune, or feed any artificial intelligence system, generative tool, model, or dataset, in any form, direct or indirect. Breach of this sub-clause is a material breach of this agreement.",
          "Provide the Deliverables, or any production files associated with them, to a competing visualisation studio, third-party production house, or any party engaged to produce derivative or competing visual content.",
          "Resell, redistribute, or make available for download the Deliverables in editable or source format on any publicly accessible online channel, including websites, marketplaces, NFT platforms, and auctions.",
          "Reverse engineer any content, tool, workflow, or asset accessed through the portal.",
          "Use the Deliverables outside the scope confirmed in the relevant Order.",
        ],
      },
    ],
  },
  {
    number: "10",
    title: "The portal",
    paragraphs: [
      { type: "prose", text: "Any confirmation, approval, signature, or instruction you give through the portal is legally binding on you and constitutes written agreement to its subject matter. This includes — without limitation — accepting Quotations, approving Rounds, confirming Orders, and authorising additional work. Portal records are conclusive evidence of those acts." },
      { type: "prose", text: "Your account is personal to your company and is non-exclusive, non-transferable, and revocable. You are responsible for all actions taken under your account by your authorised users, and for keeping your access credentials secure." },
      { type: "prose", text: "We provide the portal in good faith but do not guarantee uninterrupted access. We are not liable for downtime, scheduled maintenance, or data loss arising from causes outside our reasonable control." },
    ],
  },
  {
    number: "11",
    title: "Liability",
    paragraphs: [
      { type: "prose", text: "We deliver our services with professional skill and care. Subject to the paragraph below, our total aggregate liability to you under or in connection with this agreement and any Order, whether arising in contract, tort (including negligence), breach of statutory duty, or otherwise, is capped at the fees paid by you to us under the Order giving rise to the claim in the twelve months immediately preceding the date the claim arose." },
      { type: "prose", text: "We are not liable to you for any indirect or consequential loss, including loss of profit, loss of revenue, loss of data, loss of business opportunity, loss of anticipated savings, loss of goodwill, or cost of management time, regardless of how those losses arise and whether or not we were advised of their possibility." },
      { type: "prose", text: "Nothing in this agreement limits or excludes our liability for death or personal injury caused by our negligence, for fraud or fraudulent misrepresentation, or for any other liability that cannot be limited or excluded under English law." },
    ],
  },
  {
    number: "12",
    title: "Non-solicitation",
    paragraphs: [
      { type: "prose", text: "During the term of this agreement and for twelve months after it ends, you agree not to — directly or indirectly, on your own behalf or through any third party — solicit, approach, employ, engage, or offer to employ or engage any individual who has worked on your account in the twelve months preceding the approach, whether as employee, freelancer, or subcontractor of Silver Shadow Studio." },
      { type: "prose", text: "This restriction applies whether or not the individual would commit a breach of contract by accepting such an approach." },
      { type: "prose", text: "Breach of this clause causes us identifiable harm — replacement cost, recruitment cost, training cost, and disruption to ongoing work — that is genuinely difficult to quantify in advance. The parties agree that a fair pre-estimate of that loss is six months of the individual's total compensation at the time of the breach. That sum is payable on demand. The parties agree this is a genuine pre-estimate and not a penalty." },
    ],
  },
  {
    number: "13",
    title: "Confidentiality",
    paragraphs: [
      { type: "prose", text: "Each party will keep confidential all non-public information disclosed by the other in connection with this agreement, including designs, processes, technical and commercial data, pricing, client identities, methods of working, and portal contents. Each party will use such information only for the purposes of this agreement, and will not disclose it to any third party without the prior written consent of the disclosing party." },
      { type: "prose", text: "You may identify Silver Shadow Studio as your visualisation studio in your own marketing. Our pricing, workflows, and the contents of the portal are confidential and may not be shared without our written consent." },
      { type: "prose", text: "We treat all material you supply with strict confidentiality. Our team operates under internal non-disclosure agreements. We apply reasonable technical and organisational security measures, including in-house infrastructure for rendering and storage." },
      { type: "prose", text: "These obligations do not apply to information that is already publicly available, was already lawfully known to the receiving party, is independently developed without reference to the confidential information, or is required to be disclosed by law (in which case the receiving party will give as much prior notice as is legally permissible)." },
      { type: "prose", text: "These obligations apply during the term of this agreement and for three years after it ends. On written request or on termination, the receiving party will return or delete the disclosing party's confidential information, subject to standard backup retention periods and any legal obligation to retain records." },
    ],
  },
  {
    number: "14",
    title: "Data protection",
    paragraphs: [
      { type: "prose", text: "Where we process personal data on your behalf or under your instruction in connection with this agreement, both parties will comply with applicable data protection law, including the UK General Data Protection Regulation and the Data Protection Act 2018. We will process such data only for the purposes of performing the Order, apply appropriate technical and organisational security measures, and assist you in responding to data subject requests on reasonable terms. A separate data processing agreement will be entered into on request where required." },
    ],
  },
  {
    number: "15",
    title: "Force majeure",
    paragraphs: [
      { type: "prose", text: "Neither party is liable for any delay or failure to perform its obligations under this agreement caused by events beyond its reasonable control, including acts of God, war, civil unrest, fire, flood, sustained power or network outage, pandemic, governmental action, the unavailability of key infrastructure providers, or the serious illness or unavailability of key personnel." },
      { type: "prose", text: "The affected party will notify the other promptly and use reasonable efforts to mitigate the effect of the event and resume performance. If the event continues for more than sixty days, either party may terminate this agreement on written notice, without further liability except for fees properly due up to the date of termination." },
    ],
  },
  {
    number: "16",
    title: "Term and termination",
    paragraphs: [
      { type: "prose", text: "This agreement begins on the Effective Date and continues until terminated by either party on three months' written notice. Termination of this agreement does not affect any Order that is in progress at the date of termination — those Orders continue under the terms of this agreement until completed, unless separately terminated under this clause." },
      { type: "prose", text: "Either party may terminate this agreement, or any individual Order, immediately on written notice if the other party commits a material breach which is not remedied within thirty days of written notice requiring remedy." },
      { type: "prose", text: "Either party may terminate this agreement immediately on written notice if the other party becomes unable to pay its debts within the meaning of section 123 of the Insolvency Act 1986, enters administration or liquidation, has a receiver or administrator appointed, makes any voluntary arrangement with its creditors, ceases or threatens to cease trading, or suffers any analogous event in any jurisdiction." },
      { type: "prose", text: "We may suspend or terminate your access to the portal and any active Order immediately on written notice if you (a) fail to pay any sum due more than thirty days after the due date, (b) breach clause 9 (Prohibited use), or (c) engage in conduct which materially threatens our intellectual property or reputation." },
      { type: "prose", text: "On termination of this agreement or any Order: all sums properly due become immediately payable; we will deliver to you all completed Deliverables for which payment has been received in full; the licences granted under clause 8 take effect only in respect of fully paid Deliverables; and clauses 8, 9, 11, 12, 13, 14, 18, 19, 20, 21, and this clause 16 survive termination." },
    ],
  },
  {
    number: "17",
    title: "Notices",
    paragraphs: [
      { type: "prose", text: "All notices under this agreement must be in writing. Notice may be given by email to the email address on the Order or registered in your portal account, by recorded delivery to the registered office of the receiving party, or through a formal communication on the portal." },
      { type: "prose", text: "A notice is deemed received: if delivered personally, at the time of delivery; if sent by email, at the time of transmission, provided no bounce notification is received within twenty-four hours; if sent by recorded delivery, forty-eight hours after posting. If deemed receipt would occur outside business hours, receipt is deemed at the start of the next Business Day." },
    ],
  },
  {
    number: "18",
    title: "Variation and assignment",
    paragraphs: [
      { type: "prose", text: "No variation of this agreement is effective unless agreed in writing by both parties. The portal is a written medium for this purpose: a confirmation given through the portal — to add work, accept a Quotation, or approve a Round — constitutes written agreement to the terms of that confirmation." },
      { type: "prose", text: "You may not assign or transfer your rights or obligations under this agreement without our prior written consent, not to be unreasonably withheld. We may assign or sub-contract our obligations to any subcontractor or successor body, provided this does not reduce the standard of service you receive." },
    ],
  },
  {
    number: "19",
    title: "Anti-bribery",
    paragraphs: [
      { type: "prose", text: "Each party will comply with the Bribery Act 2010 and maintain its own policies and procedures, including adequate procedures within the meaning of section 7(2) of that Act, to prevent bribery in connection with this agreement." },
    ],
  },
  {
    number: "20",
    title: "Entire agreement",
    paragraphs: [
      { type: "prose", text: "This agreement, together with any Order accepted under it, constitutes the entire agreement between the parties and supersedes all prior agreements, discussions, and arrangements relating to its subject matter." },
      { type: "prose", text: "Each party acknowledges that it has not relied on any statement, representation, assurance, or warranty (whether made innocently or negligently) that is not set out in this agreement, and waives any claim for innocent or negligent misrepresentation based on any statement made before the Effective Date." },
    ],
  },
  {
    number: "21",
    title: "General",
    paragraphs: [
      { type: "prose", text: "If any provision of this agreement is found to be unenforceable, the remainder continues in full force. If an unenforceable provision would be enforceable with modification, it applies with the minimum modification necessary to give effect to the parties' commercial intention." },
      { type: "prose", text: "No third party has any rights to enforce any term of this agreement under the Contracts (Rights of Third Parties) Act 1999." },
      { type: "prose", text: "Failure or delay by either party in exercising any right under this agreement does not waive that right." },
    ],
  },
  {
    number: "22",
    title: "Governing law and jurisdiction",
    paragraphs: [
      { type: "prose", text: "This agreement and any dispute or claim arising out of or in connection with it or its subject matter or formation (including non-contractual disputes or claims) is governed by and construed in accordance with the laws of England and Wales." },
      { type: "prose", text: "The parties irrevocably agree that the courts of England and Wales have exclusive jurisdiction to settle any such dispute or claim." },
    ],
  },
];

export function buildProjectV3Document(input: {
  client: ClientPartyInput;
  effectiveDate: string;
}): AgreementDocument {
  return {
    version: PROJECT_V3_VERSION,
    schedule: "project",
    cover: {
      studio: STUDIO_PARTY,
      client: {
        legalName: input.client.legalName,
        country: input.client.country ?? null,
        registrationNumber: input.client.registrationNumber ?? null,
        registeredAddress: input.client.registeredAddress ?? null,
      },
      effectiveDate: input.effectiveDate,
      engagementModel: "Project — Per Order",
      footer: "This agreement is governed by the laws of England and Wales. All amounts are exclusive of VAT.",
    },
    notice: {
      heading: "Important — Please read carefully",
      intro: "This agreement contains terms that materially affect your commercial and legal position. The following sections are drawn to your specific attention before you accept:",
      items: NOTICE_ITEMS,
      closing: "By accepting this agreement, you confirm you have read these sections and understand their effect.",
    },
    clauses: CLAUSES,
    execution: {
      intro: "This agreement is executed electronically through the Silver Shadow Studio portal. Acceptance is captured by a drawn signature, IP address, user agent, and timestamp, and recorded in an immutable audit log. A signed PDF copy is delivered to the email address registered to the Client account on completion.",
      confirmation: "By accepting this agreement, the individual signing confirms they are duly authorised to bind the Client and to accept these terms on the Client's behalf, and confirms that they have read and understood the matters drawn to their attention at the start of this document.",
    },
  };
}
