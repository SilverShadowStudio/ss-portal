import React, { forwardRef, useEffect } from "react";
import { SILVERSHADOW_LOGO_DATA_URL } from "@/lib/brandLogo";

const FONT_LINK_ID = "quotation-doc-fonts";

export interface QuotationDocumentData {
  quotation_number?: string | null;
  reference_number?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
  currency?: string | null;
  amount?: number | null;
  subtotal?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  notes?: string | null;
  line_items?: Array<{ description?: string; quantity?: number; unit_price?: number }>;
  project_name?: string | null;
  client_company?: string | null;
  client_name?: string | null;
  client_address?: string | null;
  client_country?: string | null;
  client_registration?: string | null;
  client_position?: string | null;
  client_email?: string | null;
}

function fmtMoney(amount: number, currency = "GBP") {
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `${currency} ${n}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export const QuotationDocument = forwardRef<HTMLDivElement, { data: QuotationDocumentData }>(
  function QuotationDocument({ data }, ref) {
    useEffect(() => {
      if (document.getElementById(FONT_LINK_ID)) return;
      const link = document.createElement("link");
      link.id = FONT_LINK_ID;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Cormorant+SC:wght@300;400&display=swap";
      document.head.appendChild(link);
    }, []);

    const serif = `'Cormorant Garamond', 'Times New Roman', serif`;
    const labelFont = `'Cormorant SC', 'Cormorant Garamond', serif`;
    const sans = `'Neue Haas Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif`;
    const ink = "#1A1814";
    const muted = "#6B6358";
    const ruleLight = "#C8C0B0";
    const ruleHeavy = "#1A1814";
    const paper = "#D9D3C4";
    const page = "#FAF8F4";

    const label: React.CSSProperties = {
      fontFamily: labelFont,
      fontSize: 8.5,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: muted,
      fontWeight: 300,
    };
    const body: React.CSSProperties = {
      fontFamily: serif,
      fontSize: 13.5,
      lineHeight: 1.65,
      fontWeight: 300,
      color: ink,
      wordSpacing: "normal",
    };
    // Prose body text: same as body but line-length constrained
    const prose: React.CSSProperties = { ...body, maxWidth: "65%" };

    // Recessive category labels for metadata fields (Quotation, Date, Project, The Client)
    const metaLabel: React.CSSProperties = {
      fontFamily: sans,
      fontSize: 7,
      letterSpacing: "0.2em",
      textTransform: "uppercase",
      color: muted,
      fontWeight: 400,
      opacity: 0.5,
    };
    // Value style for Project / The Client fields
    const metaValue: React.CSSProperties = {
      fontFamily: serif,
      fontSize: 10,
      lineHeight: 1.65,
      fontWeight: 300,
      color: ink,
      wordSpacing: "normal",
      marginTop: 6,
    };

    const currency = data.currency || "GBP";
    const items =
      data.line_items && data.line_items.length > 0
        ? data.line_items
        : [{ description: "CGI Still Visuals", quantity: 1, unit_price: Number(data.amount) || 0 }];

    const computedSubtotal = items.reduce(
      (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
      0,
    );
    const subtotal = Number(data.subtotal ?? computedSubtotal);
    const vatRate = Number(data.vat_rate ?? 20);
    const vatAmount = Number(data.vat_amount ?? (subtotal * vatRate) / 100);
    const grand = Number(data.amount ?? subtotal + vatAmount);
    const number = data.quotation_number || data.reference_number || "—";

    const addressParts = (data.client_address || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const country = data.client_country || "United Kingdom";
    const billedAddress = addressParts.length
      ? (addressParts.some((l) => l.toLowerCase() === country.toLowerCase())
          ? addressParts
          : [...addressParts, country])
      : ["—"];

    const ruleLine = (heavy = false): React.CSSProperties => ({
      height: 0,
      borderTop: heavy ? `1px solid ${ruleHeavy}` : `1px solid ${ruleLight}`,
    });

    const Section = ({ children }: { children: React.ReactNode }) => (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>{children}</div>
    );

    // MetaField: recessive 7pt label + 10pt serif value (Project, The Client)
    const MetaField = ({ heading, children }: { heading: string; children: React.ReactNode }) => (
      <div>
        <div style={metaLabel}>{heading}</div>
        <div style={metaValue}>{children}</div>
      </div>
    );

    const ClientBlock = () => (
      <MetaField heading="The Client">
        {data.client_company || "—"}
        <br />
        {billedAddress.map((l, i) => (
          <React.Fragment key={i}>
            {l}
            <br />
          </React.Fragment>
        ))}
        {data.client_registration ? (
          <span>Co. No. {data.client_registration}</span>
        ) : null}
      </MetaField>
    );

    return (
      <div
        ref={ref}
        style={{
          background: paper,
          width: 794,
          padding: 0,
          margin: "0 auto",
          fontFamily: sans,
          color: ink,
        }}
      >
        <div
          style={{
            background: page,
            width: 794,
            margin: "0 auto",
            padding: "48px 60px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Logo — centred */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <img
              src={SILVERSHADOW_LOGO_DATA_URL}
              alt="Silvershadow Studio"
              style={{ width: 150, height: "auto", display: "block" }}
              crossOrigin="anonymous"
            />
          </div>

          <div style={{ ...ruleLine(false), marginTop: 36 }} />

          {/* Title block — Quotation at 32pt, Date at 18pt; labels recessive at 7pt */}
          <div style={{ marginTop: 28 }}>
            <Section>
              <div>
                <div style={metaLabel}>Quotation</div>
                <div style={{ fontFamily: serif, fontSize: 32, fontWeight: 400, color: ink, marginTop: 6, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", fontVariantLigatures: "none" }}>
                  {number}
                </div>
              </div>
              <div>
                <div style={metaLabel}>Date</div>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 400, color: ink, marginTop: 6, lineHeight: 1.3 }}>
                  {fmtDate(data.issued_at || data.created_at)}
                </div>
              </div>
            </Section>
          </div>

          {/* Project / client — project row omitted if null */}
          <div style={{ marginTop: 24 }}>
            {data.project_name ? (
              <Section>
                <MetaField heading="Project">{data.project_name}</MetaField>
                <ClientBlock />
              </Section>
            ) : (
              <ClientBlock />
            )}
          </div>

          {/* Brief */}
          <div style={{ ...ruleLine(false), marginTop: 28 }} />
          <div style={{ marginTop: 20 }}>
            <div style={label}>Brief</div>
            <div style={{ ...prose, marginTop: 10 }}>
              The Client hereby commissions the production of the deliverables
              listed below. These will be produced to Silvershadow Studio's
              signature standard, suitable for premium presentations and
              distribution.
            </div>
          </div>

          {/* Fee table */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Fee</div>
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "1fr 80px 120px 120px",
                gap: 16,
                paddingBottom: 8,
                borderBottom: `0.5px solid ${ink}`,
              }}
            >
              <div style={{ ...label, letterSpacing: "0.15em", opacity: 0.6 }}>Description</div>
              <div style={{ ...label, letterSpacing: "0.15em", opacity: 0.6, textAlign: "right" }}>Qty</div>
              <div style={{ ...label, letterSpacing: "0.15em", opacity: 0.6, textAlign: "right" }}>Unit</div>
              <div style={{ ...label, letterSpacing: "0.15em", opacity: 0.6, textAlign: "right" }}>Total</div>
            </div>
            {items.map((it, i) => {
              const qty = Number(it.quantity) || 0;
              const unit = Number(it.unit_price) || 0;
              const total = qty * unit;
              return (
                <div
                  key={i}
                  style={{
                    paddingTop: 12,
                    paddingBottom: 12,
                    display: "grid",
                    gridTemplateColumns: "1fr 80px 120px 120px",
                    gap: 16,
                    alignItems: "baseline",
                    borderTop: i === 0 ? "none" : `1px solid ${ruleLight}`,
                  }}
                >
                  <div style={body}>{it.description || "—"}</div>
                  <div style={{ ...body, textAlign: "right" }}>{qty}</div>
                  <div style={{ ...body, textAlign: "right" }}>{fmtMoney(unit, currency)}</div>
                  <div style={{ ...body, textAlign: "right" }}>{fmtMoney(total, currency)}</div>
                </div>
              );
            })}
          </div>

          <div style={{ ...ruleLine(false), marginTop: 8 }} />
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, rowGap: 6 }}>
              <div style={{ ...body, fontSize: 11, color: muted }}>Net Total</div>
              <div style={{ ...body, fontSize: 11, color: muted, textAlign: "right" }}>{fmtMoney(subtotal, currency)}</div>
              <div style={{ ...body, fontSize: 11, color: muted }}>VAT {vatRate}%</div>
              <div style={{ ...body, fontSize: 11, color: muted, textAlign: "right" }}>{fmtMoney(vatAmount, currency)}</div>
            </div>
          </div>

          <div style={{ ...ruleLine(true), marginTop: 16 }} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 24,
              alignItems: "baseline",
              padding: "14px 0",
            }}
          >
            <div
              style={{
                fontFamily: labelFont,
                fontSize: 8,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: ink,
                fontWeight: 300,
              }}
            >
              Gross Total
            </div>
            <div
              style={{
                fontFamily: serif,
                fontSize: 32,
                fontWeight: 300,
                color: ink,
                fontVariantNumeric: "lining-nums tabular-nums",
              }}
            >
              <span style={{ whiteSpace: "nowrap", wordSpacing: 0, letterSpacing: "0.02em" }}>
                {fmtMoney(grand, currency)}
              </span>
            </div>
          </div>
          <div style={ruleLine(true)} />

          {/* Required Documentation — plain text, no list markers */}
          <div style={{ marginTop: 28 }}>
            <div style={label}>Required Documentation</div>
            <div style={{ ...prose, marginTop: 10 }}>
              The following comprehensive architectural and decorative documentation must be provided:
            </div>
            <div style={{ ...prose, marginTop: 8 }}>
              <span style={{ fontFamily: sans, fontWeight: 500 }}>Architectural Plans</span>
              {" — "}
              <span>DWG floor plans, elevations, and ceiling plans.</span>
            </div>
            <div style={{ ...prose, marginTop: 6 }}>
              <span style={{ fontFamily: sans, fontWeight: 500 }}>Design and Finishes</span>
              {" — "}
              <span>Detailed finishes schedule (walls, windows, fabrics, etc.), FF&amp;E layout plan, lighting and atmosphere mood board.</span>
            </div>
            <div style={{ ...prose, marginTop: 6 }}>
              <span style={{ fontFamily: sans, fontWeight: 500 }}>Reference Material</span>
              {" — "}
              <span>Site photography, existing 3D models.</span>
            </div>
          </div>

          {/* Scope of Services & Workflow */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Scope of Services &amp; Workflow</div>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>1. Round 01 — Design Realisation Round</div>
            <ul style={{ ...body, marginTop: 4, paddingLeft: 22, maxWidth: "65%" }}>
              <li><em>Room Modelling</em>{" — "}Creation of accurate 3D volumes for each space based on approved architectural drawings.</li>
              <li><em>Furniture &amp; Accessory Integration</em>{" — "}Bespoke modelling and placement of furniture, fixtures, and decorative elements as per the Client's specifications.</li>
              <li><em>Lighting &amp; Material Development</em>{" — "}Application of materials, textures, and lighting to define the atmosphere and visual realism of each scene.</li>
            </ul>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>2. Round 02 — Finalisation Round</div>
            <ul style={{ ...body, marginTop: 4, paddingLeft: 22, maxWidth: "65%" }}>
              <li><em>Virtual Photoshoot</em>{" — "}Upon receipt of the Client's feedback on Round 01, a meeting with our Director of Photography determines optimal camera angles and framing aligned with the design intent.</li>
              <li><em>Finalisation</em>{" — "}Incorporates the Client's feedback from Round 01, limited to corrections required to align with the initial design brief: refinements to positions, dimensions, finishes, lighting, and overall visual composition.</li>
              <li><em>Post-Production</em>{" — "}Final adjustments to colour, balance, and contrast applied to achieve Silvershadow Studio's signature standard of realism and photographic quality.</li>
              <li>No new design concepts or modelling changes are permitted at this stage. Any new direction or major modification will require an additional Redesign Round.</li>
            </ul>
            <div style={{ ...prose, marginTop: 10 }}>
              Each image undergoes this structured process to ensure both aesthetic quality and technical accuracy, with the Client fully involved at each feedback stage. This outline represents Silvershadow Studio's standard process and can be adapted to specific client requirements by mutual agreement.
            </div>
          </div>

          {/* Production Schedule */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Production Schedule</div>
            <div style={{ ...prose, marginTop: 10 }}>
              A detailed production schedule will be shared with the Client. To secure the current production slot, the Client must, within 5 calendar days prior to the agreed start date:
            </div>
            <ol style={{ ...body, marginTop: 8, paddingLeft: 22, maxWidth: "65%" }}>
              <li>Return this signed quotation.</li>
              <li>Provide all Required Documentation.</li>
              <li>Proceed with the downpayment.</li>
            </ol>
            <div style={{ ...prose, marginTop: 8 }}>
              Failure to do so will result in the timeline being pushed back by one week, in line with our weekly production schedule, and then again accordingly until all conditions have been met.
            </div>
          </div>

          {/* Production Guidelines */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Production Guidelines</div>
            <div style={{ ...prose, marginTop: 10 }}>
              We believe open communication and precise planning are key to achieving visual excellence. To maintain quality and ensure an efficient, transparent process:
            </div>
            <ol style={{ ...body, marginTop: 8, paddingLeft: 22, maxWidth: "65%" }}>
              <li>Work on any round will commence only once all required reference information has been provided.</li>
              <li>Each round requires a minimum of one calendar week for completion, counted from the latest receipt of instructions.</li>
              <li>Once a round is in progress, no new instructions or design changes may be introduced. Any additional input will be considered in the next scheduled round.</li>
            </ol>
          </div>

          {/* Additional Work */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Additional Work</div>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>Initial Rounds</div>
            <div style={{ ...prose, marginTop: 4 }}>
              The initial cost includes bespoke architecture, interior design, and furniture modelling services, limited to one design concept: Round 01 — Design Realisation; Round 02 — Finalisation Round.
            </div>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>Redesign Rounds</div>
            <div style={{ ...prose, marginTop: 4 }}>
              Redesign Rounds are additional Design Realisation Rounds, required if new design instructions are provided. Available at £1,000+VAT per scene, per round. Each new instruction is confirmed through a Revision Control Notice before production continues, and related charges appear on the final balance invoice.
            </div>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>Working Hours</div>
            <div style={{ ...prose, marginTop: 4 }}>
              Work during weekends and public holidays is not included in the scope of this contract.
            </div>
          </div>

          {/* Delivery Format */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Delivery Format</div>
            <div style={{ ...prose, marginTop: 10 }}>
              <strong style={{ fontWeight: 400 }}>Stills</strong>{" — "}Delivered at 5,000 pixels on the longest edge, ~A3 at 300 DPI.<br />
              <strong style={{ fontWeight: 400 }}>Virtual Tours</strong>{" — "}Delivered at 15,000 × 10,000 pixels.<br />
              <strong style={{ fontWeight: 400 }}>Films</strong>{" — "}Delivered in 1920 × 1080 (Full HD) at 30 fps.<br />
              <strong style={{ fontWeight: 400 }}>Larger Formats</strong>{" — "}Available on request and may incur additional fees. Confirm any higher-resolution requirements at the start of the project.
            </div>
          </div>

          {/* Commercial Terms */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Commercial Terms</div>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>Payment Terms</div>
            <ul style={{ ...body, marginTop: 4, paddingLeft: 22, maxWidth: "65%" }}>
              <li>A 40% deposit is required to initiate production.</li>
              <li>The remaining 60% is due within 30 calendar days of delivery.</li>
              <li>Bank transfer and currency exchange fees are to be borne by the Client. Prices in {currency}.</li>
            </ul>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>Non-Payment and Delivery Clause</div>
            <div style={{ ...prose, marginTop: 4 }}>
              Delivery of any visuals or scenes is contingent upon receipt of payments as scheduled. If any instalment is not paid by its due date, Silvershadow Studio reserves the right to withhold delivery of any pending visuals until such payments are fully received.
            </div>
            <div style={{ ...body, marginTop: 10, fontWeight: 400 }}>Late Payment Policy</div>
            <div style={{ ...prose, marginTop: 4 }}>
              A late payment fee of 5% of the outstanding balance will be added every 10 days from the due date until payment is received. This fee covers administrative costs associated with managing late payments and encourages timely settlement.
            </div>
          </div>

          {/* Project Inactivity */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Project Inactivity</div>
            <div style={{ ...prose, marginTop: 10 }}>
              If the Client provides no feedback or communication for more than 30 calendar days, Silvershadow Studio reserves the right to terminate the project. In such cases, the Studio will issue an invoice covering the pro-rata value of the work completed to date, along with any confirmed external or recoverable production costs incurred during that period. Reactivation of a suspended or terminated project will require a new quotation, revised timeline, and written confirmation of reactivation.
            </div>
          </div>

          {/* Intellectual Property */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Intellectual Property</div>
            <div style={{ ...prose, marginTop: 10 }}>
              All work remains the property of Silvershadow Studio until full payment has been received. Upon full payment, the copyright and intellectual property rights for the completed work shall transfer to the Client. Silvershadow Studio may, at its discretion, feature the commissioned visuals within its professional portfolio and in award submissions. The Studio must be credited as the creator of the visual content in any publications or media exposure.
            </div>
          </div>

          {/* Confidentiality */}
          <div style={{ marginTop: 24 }}>
            <div style={label}>Confidentiality</div>
            <div style={{ ...prose, marginTop: 10 }}>
              All data and information provided by the Client will be treated with the utmost confidentiality and securely destroyed upon project completion. All employees are bound by our internal Non-Disclosure Agreement (NDA), which applies to all company materials. All renderings are processed offline using our in-house render farm at our London studio, ensuring maximum security and data protection.
            </div>
          </div>

          {data.notes ? (
            <div style={{ marginTop: 20 }}>
              <div style={label}>Notes</div>
              <div style={{ ...prose, marginTop: 10, whiteSpace: "pre-wrap" }}>{data.notes}</div>
            </div>
          ) : null}

          {/* Signature */}
          <div style={{ marginTop: 36 }}>
            <div style={label}>Signature</div>
            <div style={{ ...prose, marginTop: 10 }}>
              By signing below, I affirm that I have read, understood, and agreed to the terms outlined in this quotation document. A photocopy or scan of this document is as valid as the original.
            </div>
            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, rowGap: 18 }}>
              {[
                ["Name", data.client_name || ""],
                ["Position", data.client_position || ""],
                ["Date", ""],
                ["Signature", ""],
              ].map(([heading, value]) => (
                <div key={heading as string}>
                  <div style={label}>{heading}</div>
                  <div style={{ ...body, marginTop: 6, borderBottom: `1px solid ${ruleLight}`, minHeight: 22 }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: 28, borderTop: `1px solid ${ruleLight}`, paddingTop: 14, textAlign: "center" }}>
            <div
              style={{
                fontFamily: labelFont,
                fontSize: 7.5,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: muted,
                fontWeight: 300,
              }}
            >
              silvershadowstudio.com
            </div>
          </div>
        </div>
      </div>
    );
  },
);
